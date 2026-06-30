#!/usr/bin/env python3
"""
train_crop_model.py — ONE-TIME TRAINING SCRIPT
Run: python3 backend/train_crop_model.py

Saves to backend/trained_output/:
  rf_model.pkl          — trained Random Forest
  labeled_pixels.json   — raw GEE/simulated pixels with crop labels
  enriched_pixels.json  — predictions + stress + irrigation
  train_report.json     — accuracy, confusion matrix, feature importances
  crop_map.geojson      — Leaflet-ready GeoJSON
  stress_map.geojson
  irrigation_map.geojson
"""

import os
import sys
import json
import pickle
from pathlib import Path
from datetime import datetime
from collections import Counter

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

# ── Load .env ─────────────────────────────────────────────────────────────────
for env_path in [Path(__file__).parent / ".env", Path(__file__).parent.parent / ".env"]:
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        break

try:
    import ee
    HAS_EE = True
except ImportError:
    HAS_EE = False

try:
    import numpy as np
    HAS_NP = True
except ImportError:
    HAS_NP = False

try:
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
    HAS_SK = True
except ImportError:
    HAS_SK = False

from gee_pipeline import run_real_gee_pipeline, run_simulated_gee_pipeline, init_gee, PUNJAB_AOI, RABI_START, RABI_END
from lulc_labels import attach_lulc_labels
from rf_model import (
    train_rf, predict_all, pixels_to_geojson, compute_summary,
    CROP_LABELS, LABEL_TO_ID, FEATURE_COLS
)

SAVE_DIR = THIS_DIR / "trained_output"
SAVE_DIR.mkdir(exist_ok=True)


# ── Phenology-based crop labeling ─────────────────────────────────────────────

def assign_crop_label(props: dict) -> str:
    """
    Phenology + LULC rule-based labeling for Punjab crops.

    Dynamic World masking already removes urban/water/forest pixels before
    this function is called, so lulc classes 0,1,6,8 should be rare here.
    We still guard against them for safety.

    NDVI trajectory logic covers both seasons:
      Rabi (Wheat):  t1 low → t2/t3 high peak → t4 drop  (Jan–Apr)
      Kharif (Rice): t1/t2 rising flood signal → t3 peak → t4 drop (Jun–Oct)
      Cotton:        Kharif, low early NDVI, moderate peak, high SWIR
      Fallow:        persistently low NDVI across all timesteps
    """
    ndvi = [props.get(f"NDVI_t{t}", 0.0) for t in range(1, 5)]
    lswi = [props.get(f"LSWI_t{t}", 0.0) for t in range(1, 5)]
    ndwi = [props.get(f"NDWI_t{t}", 0.0) for t in range(1, 5)]
    vv   = [props.get(f"VV_t{t}",   0.0) for t in range(1, 5)]
    lulc = props.get("lulc_class", 4)

    # Hard exclude non-ag DW classes (safety net — mask should handle this)
    if lulc in (0, 1, 6, 8):
        return "Fallow"

    ndvi_max  = max(ndvi)
    ndvi_min  = min(ndvi)
    ndvi_mean = sum(ndvi) / len(ndvi)

    # ── Fallow / bare: no meaningful vegetation at any timestep ──────────────
    if ndvi_max < 0.28:
        return "Fallow"

    # ── Wheat (Rabi) ──────────────────────────────────────────────────────────
    # Classic Punjab wheat: low t1 → rapid rise → peak t2/t3 (>0.50) → drop t4
    # LSWI stays moderate (no flooding), VV increases during grain fill
    wheat_peak = ndvi[1] > 0.45 or ndvi[2] > 0.45
    wheat_drop = ndvi[3] < ndvi[2] - 0.05 if ndvi[2] > 0 else False
    lswi_dry   = lswi[1] < 0.25  # no waterlogging in Rabi
    if wheat_peak and lswi_dry:
        return "Wheat"

    # ── Rice (Kharif / flooded paddy) ─────────────────────────────────────────
    # Flooded signature: high LSWI / NDWI in early timesteps (transplanting)
    # Dynamic World lulc=3 (flooded_veg) is strong indicator
    rice_flood = lswi[0] > 0.15 or lswi[1] > 0.15 or ndwi[0] > 0.05
    rice_lulc  = lulc == 3
    if (rice_flood or rice_lulc) and ndvi_max > 0.30:
        return "Rice"

    # ── Cotton (Kharif) ───────────────────────────────────────────────────────
    # Cotton: bare Jan–Feb (post-harvest), low LSWI (dryland), moderate NDVI peak
    # High VH/VV ratio due to rough open boll canopy
    vh_vv_t2   = props.get("VH_VV_ratio_t2", 0.0)
    cotton_sar = vh_vv_t2 > 0.18
    cotton_ndvi = 0.25 < ndvi_max < 0.65
    cotton_bare = ndvi[0] < 0.28 and ndvi[1] < 0.30
    if cotton_bare and cotton_ndvi and cotton_sar:
        return "Cotton"

    # ── Residual Fallow check ─────────────────────────────────────────────────
    if ndvi_mean < 0.22:
        return "Fallow"

    # Default to Wheat if cropland LULC and nothing else matched
    return "Wheat" if lulc == 4 else "Fallow"


def main():
    print("=" * 65)
    print("  CROP IRRIGATION ADVISOR — MODEL TRAINING")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  AOI    : Punjab Ludhiana-Patiala belt (75.50–76.20°E, 30.50–31.30°N)")
    print(f"  DATES  : Rabi season Jan 2024 → Apr 2024 (4 monthly timesteps)")
    print(f"  MASKING: Dynamic World cropland mask (excludes urban/water/forest)")
    print("=" * 65)

    # ── Step 1: GEE Init ──────────────────────────────────────────
    print("\n[1/6] Connecting to Google Earth Engine...")
    gee_ready = False
    if HAS_EE:
        gee_ready, msg = init_gee()
        print(f"  {'✓' if gee_ready else '⚠'} {msg}")
    else:
        print("  ⚠ earthengine-api not installed → using simulation")

    data_mode = "live_gee" if gee_ready else "simulated_gee"

    # ── Step 2: Fetch pixels ──────────────────────────────────────
    print(f"\n[2/6] Fetching Sentinel-2 + Sentinel-1 data ({data_mode})...")
    pixels = []

    if gee_ready:
        try:
            punjab_aoi_ee = ee.Geometry.Polygon(PUNJAB_AOI)
            result = run_real_gee_pipeline(
                aoi=PUNJAB_AOI,
                start_date=RABI_START,
                end_date=RABI_END,
                num_steps=4,
            )
            if "error" in result:
                raise RuntimeError(result["error"])
            pixels = result["data"]
            print(f"  ✓ Live GEE: {len(pixels)} pixels fetched at 30m scale (cropland-masked)")
        except Exception as e:
            print(f"  ❌ GEE fetch failed: {e}")
            print("  → Falling back to simulated Punjab data...")
            gee_ready = False
            data_mode = "simulated_gee"

    if not pixels:
        result = run_simulated_gee_pipeline(
            aoi=PUNJAB_AOI,
            start_date=RABI_START,
            end_date=RABI_END,
            num_steps=4,
        )
        pixels = result["data"]
        print(f"  ✓ Simulated: {len(pixels)} Punjab Rabi pixels (10×10 grid)")

    # Ensure t4 columns exist (GEE may return fewer timesteps under cloud cover)
    for p in pixels:
        for base in ["NDVI", "EVI", "NDWI", "LSWI", "NDMI", "VV", "VH", "VH_VV_ratio"]:
            if f"{base}_t4" not in p:
                p[f"{base}_t4"] = p.get(f"{base}_t3", 0.0)

    # ── Step 3: LULC labels ───────────────────────────────────────
    print(f"\n[3/6] Attaching Dynamic World LULC labels...")
    labeled = attach_lulc_labels(pixels, gee_initialized=gee_ready)

    # ── Step 4: Phenology-based crop label ───────────────────────
    print(f"\n[4/6] Assigning Rabi crop labels from phenology rules...")
    for p in labeled:
        p["crop_label"] = assign_crop_label(p)

    dist = dict(Counter(p["crop_label"] for p in labeled))
    print(f"  Label distribution: {dist}")

    (SAVE_DIR / "labeled_pixels.json").write_text(json.dumps(labeled, indent=2))
    print(f"  ✓ Saved labeled_pixels.json ({len(labeled)} pixels)")

    # ── Step 5: Train RF ─────────────────────────────────────────
    print(f"\n[5/6] Training Random Forest (70/30 split)...")
    rf, report = train_rf(labeled)

    report["trained_at"]   = datetime.now().isoformat()
    report["data_mode"]    = data_mode
    report["aoi"]          = PUNJAB_AOI
    report["date_range"]   = [RABI_START, RABI_END]
    report["num_steps"]    = 4
    report["feature_cols"] = FEATURE_COLS
    report["label_method"] = "phenology_rules_dynamic_world" if gee_ready else "simulated_punjab"
    report["label_distribution"] = dist

    if rf is not None:
        with open(SAVE_DIR / "rf_model.pkl", "wb") as f:
            pickle.dump(rf, f)
        print(f"  ✓ Saved rf_model.pkl")

    (SAVE_DIR / "feature_cols.json").write_text(json.dumps(FEATURE_COLS))
    (SAVE_DIR / "train_report.json").write_text(json.dumps(report, indent=2))
    print(f"  ✓ Accuracy: {report.get('accuracy_pct', 'N/A')}%")
    print(f"  ✓ Saved train_report.json")

    # ── Step 6: Predict + GeoJSON ─────────────────────────────────
    print(f"\n[6/6] Predicting all pixels + building GeoJSON layers...")
    enriched = predict_all(rf, labeled)

    (SAVE_DIR / "enriched_pixels.json").write_text(json.dumps(enriched, indent=2))
    print(f"  ✓ Saved enriched_pixels.json")

    for layer in ["crop", "stress", "irrigation"]:
        gj = pixels_to_geojson(enriched, layer=layer)
        (SAVE_DIR / f"{layer}_map.geojson").write_text(json.dumps(gj, indent=2))
        print(f"  ✓ Saved {layer}_map.geojson")

    summary = compute_summary(enriched)
    (SAVE_DIR / "summary.json").write_text(json.dumps(summary, indent=2))

    print(f"\n{'='*65}")
    print(f"  TRAINING COMPLETE ✓")
    print(f"  Mode      : {data_mode}")
    print(f"  Pixels    : {len(enriched)}")
    print(f"  Accuracy  : {report.get('accuracy_pct', 'N/A')}%")
    print(f"  Crops     : {dist}")
    print(f"  Output    : {SAVE_DIR}")
    print(f"{'='*65}\n")
    print("  Next step: python3 backend/app.py   (or uvicorn app:app --reload)")


if __name__ == "__main__":
    main()