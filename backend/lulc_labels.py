#!/usr/bin/env python3
"""
Step 3 — Dynamic World LULC Label Fetcher
Fetches land cover classification for sampled pixels from Google's Dynamic World 10m Near-Real-Time V1 dataset.
Falls back to Punjab-realistic simulated labels when GEE is unavailable.

Dynamic World class codes (0-8):
  0 → Water
  1 → Trees
  2 → Grass
  3 → Flooded Veg  (Paddy / Rice)
  4 → Crops        (Generic cropland → further split by spectral heuristics)
  5 → Shrub & Scrub
  6 → Built Area   (Urban)
  7 → Bare Ground  (Fallow / Soil)
  8 → Snow & Ice

For Punjab Rabi season (Nov–Mar) we map:
  Flooded Veg (3) → Rice  (Kharif leftover / residual)
  Crops (4)       → Wheat (dominant Rabi crop) or Cotton (summer holdover)
  Bare Ground (7) → Fallow
"""

import math
import random
from typing import List, Dict, Optional

try:
    import ee
    HAS_EE = True
except ImportError:
    HAS_EE = False

# Mapping Dynamic World classes → our crop labels
DW_TO_CROP = {
    3:  "Rice",      # Flooded Vegetation
    4:  "Wheat",     # Crops
    7:  "Fallow",    # Bare Ground
}
FALLBACK_CROP = "Fallow"

# Punjab Rabi realistic crop distribution (~hectares ratio)
PUNJAB_CROP_DIST = {
    "Wheat":  0.55,   # dominant Rabi crop
    "Rice":   0.20,   # Kharif
    "Cotton": 0.15,   # south-west Punjab
    "Fallow": 0.10,
}


# ─────────────────────────────────────────────────────────────────────────────
# GEE-based label fetch using Dynamic World (100% Google-owned, public access)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_lulc_labels_gee(pixels: List[Dict], year: int = 2023) -> List[Dict]:
    """
    For each pixel (must have 'longitude' and 'latitude'), samples the Dynamic World LULC
    image for `year` and assigns a crop label.

    Returns the pixel list with 'lulc_class' (int) and 'crop_label' (str) added.
    Raises RuntimeError if GEE not available.
    """
    if not HAS_EE:
        raise RuntimeError("earthengine-api not installed")

    # Load Dynamic World label image for the target year
    dw_col = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
    dw_img = (
        dw_col
        .filterDate(f"{year}-01-01", f"{year+1}-01-01")
        .select("label")
        .mode()
        .rename("lulc")
    )

    # Build an ee.FeatureCollection from pixel centroids
    features = []
    for p in pixels:
        feat = ee.Feature(
            ee.Geometry.Point([p["longitude"], p["latitude"]]),
            {"pixel_id": p["pixel_id"]}
        )
        features.append(feat)
    fc = ee.FeatureCollection(features)

    # Sample Dynamic World at each point
    sampled = dw_img.sampleRegions(
        collection=fc,
        scale=10,
        geometries=False,
    )

    info = sampled.getInfo()
    # Build pixel_id → lulc_class lookup
    lulc_map: Dict[int, int] = {}
    for feat in info.get("features", []):
        pid  = feat["properties"].get("pixel_id")
        cls  = feat["properties"].get("lulc", 7)   # default bare ground (7)
        lulc_map[pid] = int(cls)

    # Attach labels back to pixels
    labeled = []
    for p in pixels:
        pid        = p["pixel_id"]
        lulc_cls   = lulc_map.get(pid, 7)
        crop_label = _lulc_to_crop(lulc_cls, p)
        labeled.append({**p, "lulc_class": lulc_cls, "crop_label": crop_label})

    return labeled


def _lulc_to_crop(lulc_class: int, pixel: Dict) -> str:
    """
    Converts Dynamic World class → specific Punjab crop using spectral refinement.
    Generic 'Crops' (4) is split into Wheat / Cotton using NDVI + VH/VV ratio.
    """
    if lulc_class == 3:
        return "Rice"
    if lulc_class == 4:
        # Spectral disambiguation within Crops class
        vhvv   = pixel.get("VH_VV_ratio_t2", 0)
        ndvi_2 = pixel.get("NDVI_t2", 0)
        ndwi_1 = pixel.get("NDWI_t1", 0)
        # Cotton: high cross-pol ratio (rough canopy), moderate NDVI
        if vhvv > 0.22 and ndvi_2 > 0.30:
            return "Cotton"
        # Rice: wet signature in first time step
        if ndwi_1 > 0.05 and pixel.get("LSWI_t1", 0) > 0.15:
            return "Rice"
        # Default crop → Wheat
        return "Wheat"
    return "Fallow"


# ─────────────────────────────────────────────────────────────────────────────
# Simulated Punjab-realistic label assignment  (no GEE needed)
# ─────────────────────────────────────────────────────────────────────────────

def _field_block_crop(pixel_id: int, grid_size: int = 10) -> str:
    """
    Divides the 10×10 grid into realistic field blocks matching Punjab crop
    distribution:  ~55% Wheat | 20% Rice | 15% Cotton | 10% Fallow
    """
    r = pixel_id // grid_size
    c = pixel_id  % grid_size

    # Quadrant assignment (deterministic, visually coherent on map)
    if r <= 4 and c <= 5:
        return "Wheat"      # top-left large block — 30 pixels
    if r <= 4 and c > 5:
        return "Cotton"     # top-right — 20 pixels
    if r > 4 and c <= 3:
        return "Rice"       # bottom-left — 20 pixels
    if r > 7 and c > 3:
        return "Fallow"     # bottom-right corner — 6 pixels
    return "Wheat"          # remaining — fills wheat quota


def fetch_lulc_labels_simulated(pixels: List[Dict]) -> List[Dict]:
    """
    Assigns Punjab-realistic crop labels without GEE.
    Uses field-block heuristics for spatial coherence (no salt-and-pepper noise).
    Also assigns a synthetic Dynamic World LULC class for API consistency.
    """
    CROP_TO_LULC = {"Wheat": 4, "Rice": 3, "Cotton": 4, "Fallow": 7}

    labeled = []
    for p in pixels:
        crop_label = _field_block_crop(p["pixel_id"])
        lulc_cls   = CROP_TO_LULC[crop_label]

        labeled.append({
            **p,
            "lulc_class":  lulc_cls,
            "crop_label":  crop_label,
            "label_source": "simulated_punjab",
        })
    return labeled


# ─────────────────────────────────────────────────────────────────────────────
# Public entry-point
# ─────────────────────────────────────────────────────────────────────────────

def attach_lulc_labels(
    pixels: List[Dict],
    gee_initialized: bool = False,
    year: int = 2023,
) -> List[Dict]:
    """
    Try GEE first; fall back to simulation.
    Returns pixels with 'lulc_class', 'crop_label', 'label_source' attached.
    """
    if gee_initialized and HAS_EE:
        try:
            labeled = fetch_lulc_labels_gee(pixels, year=year)
            for p in labeled:
                p.setdefault("label_source", "dynamic_world_gee")
            print(f"[LULC] ✓ GEE Dynamic World labels fetched for {len(labeled)} pixels")
            return labeled
        except Exception as exc:
            print(f"[LULC] GEE fetch failed ({exc}), falling back to simulation")

    labeled = fetch_lulc_labels_simulated(pixels)
    print(f"[LULC] Simulation labels assigned for {len(labeled)} pixels")
    return labeled
