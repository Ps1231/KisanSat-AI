#!/usr/bin/env python3
"""
FastAPI backend for Crop Irrigation Advisor.
Exposes rich analytics, validation, and multi-spectral GIS maps.
"""

import os
import json
import pickle
import logging
from pathlib import Path
from typing import Optional, List, Dict

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

THIS_DIR   = Path(__file__).resolve().parent
OUTPUT_DIR = THIS_DIR / "trained_output"
OUTPUT_DIR.mkdir(exist_ok=True)

# ── GEE Init ──────────────────────────────────────────────────────────────────
GEE_INITIALIZED = False
try:
    import ee
    HAS_EE = True
    email = os.environ.get("GEE_SERVICE_ACCOUNT_EMAIL", "").strip()
    key_direct = os.environ.get("GEE_SERVICE_ACCOUNT_KEY", "").strip()
    key_path_env = os.environ.get("GEE_KEY_PATH", "").strip()

    if email:
        if key_direct:
            try:
                key_dict = json.loads(key_direct)
                cred = ee.ServiceAccountCredentials(email, json.dumps(key_dict))
            except Exception:
                cred = ee.ServiceAccountCredentials(email, key_direct)
            ee.Initialize(cred)
            GEE_INITIALIZED = True
            log.info(f"[GEE] ✓ Initialized directly using service key env")
        elif key_path_env:
            k_path = Path(key_path_env)
            if not k_path.is_absolute():
                for b in [THIS_DIR, THIS_DIR.parent, Path.cwd()]:
                    cand = b / key_path_env
                    if cand.exists():
                        k_path = cand
                        break
            if k_path.exists():
                try:
                    content = k_path.read_text(encoding="utf-8")
                    try:
                        key_dict = json.loads(content)
                        cred = ee.ServiceAccountCredentials(email, json.dumps(key_dict))
                    except Exception:
                        cred = ee.ServiceAccountCredentials(email, str(k_path))
                    ee.Initialize(cred)
                    GEE_INITIALIZED = True
                    log.info(f"[GEE] ✓ Initialized using key file {k_path}")
                except Exception as e:
                    log.error(f"[GEE] Failed to initialize GEE with key file: {e}")
    else:
        # Try default init
        try:
            ee.Initialize()
            GEE_INITIALIZED = True
            log.info("[GEE] ✓ Initialized with GEE defaults")
        except Exception:
            pass
except Exception as e:
    HAS_EE = False
    log.warning(f"[GEE] Init failed: {e}")

# ── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Crop Irrigation Advisor API",
    description="ISRO Hackathon — Crop Detection + Stress + Irrigation Advisory",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Self-Healing Data Fetcher ─────────────────────────────────────────────────
def get_or_create_labeled_pixels() -> List[Dict]:
    """
    Returns labeled pixels list. If they do not exist on disk,
    runs the simulated Punjab pipeline on the fly to self-heal.
    """
    px_path = OUTPUT_DIR / "labeled_pixels.json"
    if px_path.exists():
        try:
            return json.loads(px_path.read_text())
        except Exception:
            pass

    # Self-heal by running simulation
    log.info("[Self-Healing] labeled_pixels.json not found. Running simulated Punjab data on the fly.")
    from train_model import fetch_pixels_simulated
    try:
        pixels = fetch_pixels_simulated()
        px_path.write_text(json.dumps(pixels, indent=2))
        return pixels
    except Exception as e:
        log.error(f"[Self-Healing] Failed to generate simulated pixels: {e}")
        return []

def get_or_create_enriched_pixels() -> List[Dict]:
    """
    Returns enriched pixels. If not found, trains and predicts on the fly.
    """
    en_path = OUTPUT_DIR / "enriched_pixels.json"
    if en_path.exists():
        try:
            return json.loads(en_path.read_text())
        except Exception:
            pass

    labeled = get_or_create_labeled_pixels()
    from rf_model import train_rf, predict_all
    rf, report = train_rf(labeled)
    enriched = predict_all(rf, labeled)
    
    # Save files
    en_path.write_text(json.dumps(enriched, indent=2))
    
    # Save maps as GeoJSON too
    from rf_model import pixels_to_geojson
    for layer in ["crop", "stress", "irrigation"]:
        gj = pixels_to_geojson(enriched, layer=layer)
        (OUTPUT_DIR / f"{layer}_map.geojson").write_text(json.dumps(gj, indent=2))
        
    # Save training report
    (OUTPUT_DIR / "training_report.json").write_text(json.dumps(report, indent=2))
    return enriched

# ── Helper to load JSON with fallback ─────────────────────────────────────────
def load_json_with_fallback(filename: str, layer: str = "crop") -> Dict:
    path = OUTPUT_DIR / filename
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    # If file not found or malformed, trigger enrichment and build GeoJSON
    enriched = get_or_create_enriched_pixels()
    from rf_model import pixels_to_geojson
    gj = pixels_to_geojson(enriched, layer=layer)
    path.write_text(json.dumps(gj, indent=2))
    return gj

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    """Check server + model status"""
    model_exists = (OUTPUT_DIR / "rf_model.pkl").exists()
    return {
        "status":            "ok",
        "gee_connected":     GEE_INITIALIZED,
        "model_trained":     model_exists,
        "output_dir":        str(OUTPUT_DIR),
    }


@app.get("/gee/status")
def gee_status():
    """GEE connection status"""
    return {
        "ee_installed":  HAS_EE,
        "initialized":   GEE_INITIALIZED,
        "service_email": os.environ.get("GEE_SERVICE_ACCOUNT_EMAIL", "not set"),
    }


@app.get("/api/fields")
def get_fields():
    """Return all field predictions"""
    enriched = get_or_create_enriched_pixels()
    fields = []
    for p in enriched:
        fields.append({
            "pixel_id":     p["pixel_id"],
            "lat":          p["latitude"],
            "lon":          p["longitude"],
            "crop_type":    p["crop_type"],
            "confidence":   p["crop_confidence"],
            "stress_level": p["stress_level"],
            "stress_color": p["stress_color"],
            "advisory":     p["irrigation"]["advisory"],
            "deficit_mm":   p["irrigation"]["deficit_mm"],
            "crop_color":   p["crop_color"],
            "ndvi_series":  [p.get("NDVI_t1", 0.2), p.get("NDVI_t2", 0.6), p.get("NDVI_t3", 0.3)],
        })
    return {"fields": fields, "total": len(fields)}


@app.get("/api/crop-map")
def crop_map():
    """Return crop type GeoJSON for Leaflet map"""
    return load_json_with_fallback("crop_map.geojson", "crop")


@app.get("/api/stress-map")
def stress_map():
    """Return moisture stress GeoJSON"""
    return load_json_with_fallback("stress_map.geojson", "stress")


@app.get("/api/irrigation-map")
def irrigation_map():
    """Return irrigation advisory GeoJSON"""
    return load_json_with_fallback("irrigation_map.geojson", "irrigation")


@app.get("/api/advisory/{pixel_id}")
def get_advisory(pixel_id: int):
    """Detailed advisory for a specific pixel"""
    enriched = get_or_create_enriched_pixels()
    pixel = next((p for p in enriched if p["pixel_id"] == pixel_id), None)
    if not pixel:
        raise HTTPException(404, f"Pixel {pixel_id} not found")
    return {
        "pixel_id":      pixel_id,
        "location":      {"lat": pixel["latitude"], "lon": pixel["longitude"]},
        "crop":          pixel["crop_type"],
        "confidence":    pixel["crop_confidence"],
        "stress":        pixel["stress_level"],
        "irrigation":    pixel["irrigation"],
        "raw_features":  {k: pixel[k] for k in pixel if k.startswith(("NDVI", "EVI", "NDWI", "VV", "VH"))},
    }


@app.get("/api/validation/metrics")
def validation_metrics():
    """Return training accuracy metrics"""
    report_path = OUTPUT_DIR / "train_report.json"
    if not report_path.exists():
        # Trigger training report creation
        get_or_create_enriched_pixels()
    
    try:
        return json.loads(report_path.read_text())
    except Exception:
        raise HTTPException(500, "Error loading training report")


@app.get("/api/timeseries")
def timeseries():
    """NDVI time series for all pixels — for frontend chart"""
    enriched = get_or_create_enriched_pixels()
    from collections import defaultdict
    by_crop = defaultdict(list)
    for p in enriched:
        by_crop[p["crop_type"]].append({
            "pixel_id":    p["pixel_id"],
            "crop":        p["crop_type"],
            "ndvi_series": [p.get("NDVI_t1", 0.2), p.get("NDVI_t2", 0.6), p.get("NDVI_t3", 0.3)],
            "stress":      p["stress_level"],
        })
    result = []
    for crop, pxs in by_crop.items():
        result.extend(pxs[:5])
    return {"timeseries": result, "num_timesteps": 3}


@app.get("/api/summary")
def summary():
    """Dashboard summary stats"""
    enriched = get_or_create_enriched_pixels()
    from collections import Counter
    crop_dist   = Counter(p["crop_type"]             for p in enriched)
    stress_dist = Counter(p["stress_level"]           for p in enriched)
    adv_dist    = Counter(p["irrigation"]["advisory"] for p in enriched)

    avg_ndvi = round(sum(p.get("NDVI_t2", 0) for p in enriched) / max(len(enriched), 1), 3)

    return {
        "total_pixels":      len(enriched),
        "crop_distribution": dict(crop_dist),
        "stress_distribution": dict(stress_dist),
        "advisory_distribution": dict(adv_dist),
        "avg_peak_ndvi":     avg_ndvi,
    }


@app.get("/pipeline/test")
def pipeline_test():
    """Quick smoke test — check if everything is connected"""
    enriched = get_or_create_enriched_pixels()
    return {
        "model_loaded":     True,
        "predictions_ready": enriched is not None,
        "pixel_count":       len(enriched) if enriched else 0,
        "gee_connected":     GEE_INITIALIZED,
    }


@app.post("/api/crop-map/all")
def crop_map_all(request: dict = None):
    """Frontend endpoint — Returns all 3 layers + summary + timeseries in one single request"""
    enriched = get_or_create_enriched_pixels()
    
    from rf_model import pixels_to_geojson
    crop_gj = pixels_to_geojson(enriched, "crop")
    stress_gj = pixels_to_geojson(enriched, "stress")
    irr_gj = pixels_to_geojson(enriched, "irrigation")

    from collections import Counter
    crop_dist   = dict(Counter(p.get("crop_type", "?") for p in enriched))
    stress_dist = dict(Counter(p.get("stress_level", "?") for p in enriched))
    adv_dist    = dict(Counter(p.get("irrigation", {}).get("advisory", "?") for p in enriched))
    
    avg_ndvi    = round(sum(p.get("NDVI_t2", 0) for p in enriched) / max(len(enriched), 1), 3)
    avg_deficit = round(sum(p.get("irrigation", {}).get("deficit_mm", 0) for p in enriched) / max(len(enriched), 1), 1)
    avg_conf    = round(sum(p.get("crop_confidence", 0) for p in enriched) / max(len(enriched), 1), 3)

    # Timeseries data for sample pixels
    timeseries_data = []
    for p in enriched[:20]:
        timeseries_data.append({
            "pixel_id":  p.get("pixel_id", 0),
            "crop_type": p.get("crop_type", "?"),
            "lat":       p.get("latitude", 0),
            "lon":       p.get("longitude", 0),
            "ndvi": [p.get("NDVI_t1", 0.2), p.get("NDVI_t2", 0.6), p.get("NDVI_t3", 0.3)],
            "ndwi": [p.get("NDWI_t1", 0.0), p.get("NDWI_t2", 0.2), p.get("NDWI_t3", 0.0)],
            "vv":   [p.get("VV_t1", -12.0), p.get("VV_t2", -10.0), p.get("VV_t3", -12.0)],
            "stress":   p.get("stress_level", "none"),
            "advisory": p.get("irrigation", {}).get("advisory", "OK"),
        })

    # Load train report metrics
    report_path = OUTPUT_DIR / "train_report.json"
    train_report = {}
    if report_path.exists():
        try:
            train_report = json.loads(report_path.read_text())
        except Exception:
            pass

    return {
        "status":  "ok",
        "mode":    "live_gee" if GEE_INITIALIZED else "simulated_gee_ts",
        "summary": {
            "total_pixels":        len(enriched),
            "avg_ndvi":            avg_ndvi,
            "avg_deficit_mm":      avg_deficit,
            "avg_confidence":      avg_conf,
            "crop_distribution":   crop_dist,
            "stress_distribution": stress_dist,
            "advisory_distribution": adv_dist,
        },
        "layers": {
            "crop":       crop_gj,
            "stress":     stress_gj,
            "irrigation": irr_gj,
        },
        "timeseries": timeseries_data,
        "train_report": train_report,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
