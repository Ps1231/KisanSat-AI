#!/usr/bin/env python3
"""
gee_pipeline.py — Step 1: Satellite Feature Extraction
Punjab Rabi Season (Jan–Apr) | Sentinel-2 + Sentinel-1
AOI: Ludhiana–Patiala belt, Punjab, India
"""

import sys
import json
import math
import random

try:
    import ee
    HAS_EE = True
except ImportError:
    HAS_EE = False

# ── Punjab AOI: Ludhiana–Patiala belt ────────────────────────────────────────
# Lon: 75.50–76.20  |  Lat: 30.50–31.30
PUNJAB_AOI = [
    [75.50, 30.50],
    [76.20, 30.50],
    [76.20, 31.30],
    [75.50, 31.30],
    [75.50, 30.50],
]

# Rabi season: Jan–Apr 2024
RABI_START = "2024-01-01"
RABI_END   = "2024-05-01"


def init_gee(service_account=None, private_key=None):
    """
    Initialize GEE using service account JSON key stored in env variable.
    GEE_SERVICE_ACCOUNT_KEY must be the full JSON string (not a file path).
    GEE_KEY_PATH is used only as fallback if the JSON env var is absent.
    """
    if not HAS_EE:
        return False, "ee library not installed"

    import os
    from pathlib import Path

    try:
        email = service_account or os.environ.get("GEE_SERVICE_ACCOUNT_EMAIL", "").strip()
        if not email:
            return False, "GEE_SERVICE_ACCOUNT_EMAIL not set"

        # Priority 1: JSON string directly in env (most common deployment)
        key_str = private_key or os.environ.get("GEE_SERVICE_ACCOUNT_KEY", "").strip()
        if key_str:
            try:
                key_dict = json.loads(key_str)
            except json.JSONDecodeError:
                # Try stripping outer quotes added by some .env parsers
                key_dict = json.loads(key_str.strip("'\""))
            # ee.ServiceAccountCredentials needs the JSON as a string
            cred = ee.ServiceAccountCredentials(email, key_data=json.dumps(key_dict))
            ee.Initialize(cred)
            return True, f"Initialized with service account JSON key ({email})"

        # Priority 2: Key file path (GEE_KEY_PATH)
        key_path_env = os.environ.get("GEE_KEY_PATH", "").strip()
        if key_path_env:
            k_path = Path(key_path_env)
            if not k_path.is_absolute():
                # Search: cwd, backend dir, project root, project root's parent
                search_bases = [
                    Path.cwd(),
                    Path(__file__).resolve().parent,          # backend/
                    Path(__file__).resolve().parent.parent,   # project root
                    Path(__file__).resolve().parent.parent.parent,
                ]
                for base in search_bases:
                    cand = base / key_path_env
                    if cand.exists():
                        k_path = cand
                        break
            if k_path.exists():
                key_dict = json.loads(k_path.read_text(encoding="utf-8"))
                cred = ee.ServiceAccountCredentials(email, key_data=json.dumps(key_dict))
                ee.Initialize(cred)
                return True, f"Initialized with key file: {k_path}"
            else:
                # Show all searched paths to help debug
                searched = [str(Path.cwd() / key_path_env),
                            str(Path(__file__).resolve().parent.parent / key_path_env)]
                return False, f"GEE key file not found: {key_path_env}\n  Searched: {searched}"

        # Priority 3: Default gcloud credentials
        ee.Initialize()
        return True, "Initialized with default gcloud credentials"

    except Exception as e:
        return False, f"GEE init failed: {e}"


def _build_cropland_mask(geom, year):
    """
    Binary mask: 1 = agricultural land, 0 = non-crop.
    Excludes water(0), trees(1), built_area(6), snow(8) using Dynamic World annual mode.
    """
    dw = (ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
          .filterBounds(geom)
          .filterDate(f"{year}-01-01", f"{year+1}-01-01")
          .select("label")
          .mode())
    non_ag = [0, 1, 6, 8]
    ag     = [2, 3, 4, 5, 7]
    mask = dw.remap(non_ag + ag, [0]*len(non_ag) + [1]*len(ag)).rename("crop_mask")
    return mask


def _make_grid_fc(aoi, scale_deg):
    """
    Creates a regular grid of point features covering the AOI at `scale_deg` spacing.
    Returns ee.FeatureCollection of grid points.
    """
    lons = [pt[0] for pt in aoi]
    lats = [pt[1] for pt in aoi]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)

    pts = []
    lon = min_lon + scale_deg / 2
    while lon < max_lon:
        lat = min_lat + scale_deg / 2
        while lat < max_lat:
            pts.append(ee.Feature(ee.Geometry.Point([lon, lat])))
            lat += scale_deg
        lon += scale_deg
    return ee.FeatureCollection(pts)


def _build_stacked_image(geom, start_date, end_date, num_steps):
    """
    Builds the multi-temporal Sentinel-2 + Sentinel-1 stacked ee.Image used by
    both the point-sampling pipeline and the raster pipeline. Returns the
    cropland-masked stacked image. Single source of truth for the index math.
    """
    s_date = ee.Date(start_date)
    e_date = ee.Date(end_date)
    year   = int(str(start_date)[:4])
    step_days = e_date.difference(s_date, "days").divide(num_steps)

    s2_col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
              .filterBounds(geom)
              .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30)))
    s1_col = (ee.ImageCollection("COPERNICUS/S1_GRD")
              .filterBounds(geom)
              .filter(ee.Filter.eq("instrumentMode", "IW"))
              .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
              .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH")))

    crop_mask = _build_cropland_mask(geom, year)

    def s2_indices(img):
        img  = img.divide(10000)
        ndvi = img.normalizedDifference(["B8", "B4"]).rename("NDVI")
        ndwi = img.normalizedDifference(["B3", "B8"]).rename("NDWI")
        lswi = img.normalizedDifference(["B8", "B11"]).rename("LSWI")
        return img.addBands([ndvi, ndwi, lswi])

    bands = []
    for i in range(num_steps):
        t0 = s_date.advance(step_days.multiply(i), "days")
        t1 = s_date.advance(step_days.multiply(i + 1), "days")
        sfx = f"_t{i+1}"
        s2  = s2_indices(s2_col.filterDate(t0, t1).median())
        s2r = s2.select(["NDVI", "NDWI", "LSWI"]).rename([b + sfx for b in ["NDVI", "NDWI", "LSWI"]])
        s1  = s1_col.filterDate(t0, t1).median()
        vhvv = (ee.Image(10).pow(s1.select("VH").divide(10))
                .divide(ee.Image(10).pow(s1.select("VV").divide(10)))).rename("VH_VV_ratio" + sfx)
        bands.extend([s2r, vhvv])

    return ee.Image.cat(bands).updateMask(crop_mask)


def _classify_crop_image(stacked, num_steps):
    """
    Per-pixel crop class as a continuous ee.Image (server-side, no sampling).
    Returns an integer band: 0=Fallow, 1=Wheat, 2=Rice, 3=Cotton.
    Same heuristic logic as _quick_crop_label but expressed in ee operations
    so it runs on every pixel of the raster, not just sampled points.
    """
    # NDVI max across timesteps
    ndvi_bands = [stacked.select(f"NDVI_t{t}") for t in range(1, num_steps + 1)]
    ndvi_max = ee.Image.cat(ndvi_bands).reduce(ee.Reducer.max())

    ndwi1 = stacked.select("NDWI_t1")
    lswi1 = stacked.select("LSWI_t1")
    vhvv2 = stacked.select("VH_VV_ratio_t2") if num_steps >= 2 else stacked.select("VH_VV_ratio_t1")

    is_fallow = ndvi_max.lt(0.28)
    is_rice   = ndwi1.gt(0.05).Or(lswi1.gt(0.15))
    is_cotton = vhvv2.gt(0.22).And(ndvi_max.gt(0.30)).And(ndvi_max.lt(0.65))

    # Priority: Fallow > Rice > Cotton > Wheat (default 1)
    crop = ee.Image(1)                          # Wheat default
    crop = crop.where(is_cotton, 3)             # Cotton
    crop = crop.where(is_rice, 2)               # Rice
    crop = crop.where(is_fallow, 0)             # Fallow
    return crop.rename("crop_class").updateMask(stacked.select("NDVI_t1").mask())


def run_gee_raster_pipeline(aoi=None, start_date=RABI_START, end_date=RABI_END, num_steps=4):
    """
    PPT-accurate continuous raster pipeline.

    Instead of sampling points, this classifies EVERY pixel server-side and
    returns Leaflet-ready XYZ tile URLs (via getMapId) for:
      - crop      : categorical crop-class raster (sharp colored zones)
      - moisture  : continuous NDWI-based stress gradient (blue→red)
      - ndvi      : continuous NDVI vegetation gradient

    Tile URLs embed a short-lived token (~24h). Re-run to refresh.
    """
    if aoi is None:
        aoi = PUNJAB_AOI
    try:
        geom = ee.Geometry.Polygon(aoi)
    except Exception as e:
        return {"error": f"Invalid AOI: {e}"}

    try:
        stacked = _build_stacked_image(geom, start_date, end_date, num_steps)

        # ── Crop classification raster (categorical) ──
        crop_img = _classify_crop_image(stacked, num_steps)
        crop_vis = {
            "min": 0, "max": 3,
            "palette": ["92400E", "F59E0B", "3B82F6", "8B5CF6"],  # Fallow, Wheat, Rice, Cotton
        }
        crop_tiles = crop_img.clip(geom).getMapId(crop_vis)["tile_fetcher"].url_format

        # ── Moisture stress raster (continuous, mid-season NDWI) ──
        mid = max(1, num_steps // 2)
        ndwi_mid = stacked.select(f"NDWI_t{mid}")
        # Invert so dry(low NDWI)=red, wet(high)=blue → stress gradient
        moisture_vis = {
            "min": -0.2, "max": 0.3,
            "palette": ["dc2626", "f97316", "facc15", "3b82f6", "1e3a8a"],
        }
        moisture_tiles = ndwi_mid.clip(geom).getMapId(moisture_vis)["tile_fetcher"].url_format

        # ── NDVI raster (continuous vegetation) ──
        ndvi_mid = stacked.select(f"NDVI_t{mid}")
        ndvi_vis = {
            "min": 0.0, "max": 0.8,
            "palette": ["451a03", "ca8a04", "6ee7b7", "22c55e", "166534"],
        }
        ndvi_tiles = ndvi_mid.clip(geom).getMapId(ndvi_vis)["tile_fetcher"].url_format

        # AOI center for map fly-to
        lons = [pt[0] for pt in aoi]; lats = [pt[1] for pt in aoi]
        center = [sum(lats) / len(lats), sum(lons) / len(lons)]

        return {
            "status": "success",
            "mode":   "live_gee_raster",
            "masking": "dynamic_world_cropland",
            "aoi":    aoi,
            "center": center,
            "date_range": [start_date, end_date],
            "tiles": {
                "crop":     crop_tiles,
                "moisture": moisture_tiles,
                "ndvi":     ndvi_tiles,
            },
            "legends": {
                "crop":     {"Fallow": "#92400E", "Wheat": "#F59E0B", "Rice": "#3B82F6", "Cotton": "#8B5CF6"},
                "moisture": {"Severe": "#dc2626", "Mild": "#facc15", "Optimal": "#1e3a8a"},
                "ndvi":     {"Bare": "#451a03", "Vegetating": "#6ee7b7", "Lush": "#166534"},
            },
        }
    except Exception as e:
        return {"error": f"Raster pipeline failed: {e}"}


def _quick_crop_label(row):
    """
    Lightweight crop proxy for live GEE pixels (no ground-truth labels).
    Uses NDVI trajectory + NDWI/LSWI wetness. This is a display heuristic for
    the demo map, NOT the trained RF classifier (that lives in rf_model.py).
    """
    ndvis = [row.get(f"NDVI_t{t}") for t in range(1, 5) if row.get(f"NDVI_t{t}") is not None]
    if not ndvis:
        return "Fallow"
    ndvi_max = max(ndvis)
    ndwi1 = row.get("NDWI_t1", 0) or 0
    lswi1 = row.get("LSWI_t1", 0) or 0
    vhvv2 = row.get("VH_VV_ratio_t2", 0) or 0

    if ndvi_max < 0.28:
        return "Fallow"
    if (ndwi1 > 0.05 or lswi1 > 0.15):
        return "Rice"
    if vhvv2 > 0.22 and 0.30 < ndvi_max < 0.65:
        return "Cotton"
    return "Wheat"


# ─────────────────────────────────────────────────────────────────────────────
# RASTER TILE PIPELINE — real continuous classified maps (PPT-accurate)
# Builds server-side ee.Image classifications and returns XYZ tile URLs that
# Leaflet overlays directly with L.tileLayer. This is a true raster across the
# whole command area — NOT scattered sample points. Non-crop pixels (urban,
# water, forest) are masked transparent via Dynamic World, so no dots land on
# construction sites or roads.
# ─────────────────────────────────────────────────────────────────────────────

# Palettes (index order maps to class value 0..3 for crop)
STAGE_PALETTE  = ["451a03", "ca8a04", "6ee7b7", "22c55e", "166534"]


def run_real_gee_pipeline(aoi=None, start_date=RABI_START, end_date=RABI_END, num_steps=4):
    """
    Continuous-coverage GEE pipeline with Dynamic World cropland masking.

    Strategy: sample on a regular grid (not random points) so pixels are
    spatially contiguous and cover the entire AOI uniformly.

    Scale selection:
      SAMPLE_SCALE_DEG = 0.004° ≈ 400m grid → ~200–400 pixels for a 0.04°×0.04° AOI
      For larger AOIs increase SAMPLE_SCALE_DEG to avoid GEE getInfo() payload limits.

    Only agricultural pixels are returned — urban, water, forest masked out.
    """
    if aoi is None:
        aoi = PUNJAB_AOI

    try:
        geom = ee.Geometry.Polygon(aoi)
    except Exception as e:
        return {"error": f"Invalid AOI: {e}"}

    year      = int(str(start_date)[:4])
    s_date    = ee.Date(start_date)
    e_date    = ee.Date(end_date)
    total_days = e_date.difference(s_date, "days")
    step_days  = total_days.divide(num_steps)

    # ── Collections ──────────────────────────────────────────────
    s2_col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
              .filterBounds(geom)
              .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30)))

    s1_col = (ee.ImageCollection("COPERNICUS/S1_GRD")
              .filterBounds(geom)
              .filter(ee.Filter.eq("instrumentMode", "IW"))
              .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
              .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH")))

    # ── Cropland mask ─────────────────────────────────────────────
    crop_mask = _build_cropland_mask(geom, year)

    def compute_s2_indices(img):
        img  = img.divide(10000)
        ndvi = img.normalizedDifference(["B8", "B4"]).rename("NDVI")
        evi  = img.expression(
            "2.5 * ((B8 - B4) / (B8 + 6*B4 - 7.5*B2 + 1))",
            {"B8": img.select("B8"), "B4": img.select("B4"), "B2": img.select("B2")}
        ).rename("EVI")
        ndwi = img.normalizedDifference(["B3", "B8"]).rename("NDWI")
        lswi = img.normalizedDifference(["B8", "B11"]).rename("LSWI")
        ndmi = img.normalizedDifference(["B8", "B11"]).rename("NDMI")
        return img.addBands([ndvi, evi, ndwi, lswi, ndmi])

    def compute_s1_features(img):
        vv_f  = img.select("VV").focal_mean(1.5, "square", "pixels").rename("VV_filtered")
        vh_f  = img.select("VH").focal_mean(1.5, "square", "pixels").rename("VH_filtered")
        vv_l  = ee.Image(10).pow(img.select("VV").divide(10))
        vh_l  = ee.Image(10).pow(img.select("VH").divide(10))
        ratio = vh_l.divide(vv_l).rename("VH_VV_ratio")
        return img.addBands([vv_f, vh_f, ratio])

    # ── Build multi-temporal stacked image ───────────────────────
    composite_bands = []
    for i in range(num_steps):
        t_start = s_date.advance(step_days.multiply(i), "days")
        t_end   = s_date.advance(step_days.multiply(i + 1), "days")
        suffix  = f"_t{i+1}"

        s2_img   = s2_col.filterDate(t_start, t_end).median()
        s2_proc  = compute_s2_indices(s2_img)
        s2_bands = ["NDVI", "EVI", "NDWI", "LSWI", "NDMI"]
        s2_ren   = s2_proc.select(s2_bands).rename([b + suffix for b in s2_bands])

        s1_img   = s1_col.filterDate(t_start, t_end).median()
        s1_proc  = compute_s1_features(s1_img)
        s1_bands = ["VV_filtered", "VH_filtered", "VH_VV_ratio"]
        s1_ren   = s1_proc.select(s1_bands).rename([b + suffix for b in s1_bands])

        composite_bands.extend([s2_ren, s1_ren])

    # Mask non-agricultural pixels before stacking
    stacked = ee.Image.cat(composite_bands).updateMask(crop_mask)

    # ── Continuous grid sampling ──────────────────────────────────
    # Compute AOI extent to pick appropriate grid spacing
    lons = [pt[0] for pt in aoi]
    lats = [pt[1] for pt in aoi]
    lon_span = max(lons) - min(lons)
    lat_span = max(lats) - min(lats)
    area_deg2 = lon_span * lat_span

    # Target ~300-500 pixels; adjust grid spacing based on AOI size
    # Small AOI (<0.01 deg²): 0.001° ≈ 100m grid
    # Medium AOI (<0.1 deg²): 0.003° ≈ 300m grid
    # Large AOI (>=0.1 deg²): 0.008° ≈ 800m grid  (avoids GEE payload limit)
    if area_deg2 < 0.005:
        SCALE_DEG = 0.001   # ~100m
    elif area_deg2 < 0.05:
        SCALE_DEG = 0.003   # ~300m
    elif area_deg2 < 0.5:
        SCALE_DEG = 0.008   # ~800m
    else:
        SCALE_DEG = 0.020   # ~2km  (full Punjab belt AOI)

    grid_fc = _make_grid_fc(aoi, SCALE_DEG)

    # sampleRegions on the grid — gives one value per grid point
    # scale=500 matches the grid spacing (avoid sub-pixel aliasing)
    scale_m = max(100, int(SCALE_DEG * 111000))  # deg → approx metres
    sampled = stacked.sampleRegions(
        collection=grid_fc,
        scale=scale_m,
        geometries=True,
        tileScale=4,
    )

    try:
        info = sampled.getInfo()
    except Exception as e:
        return {"error": f"GEE sampleRegions failed: {e}"}

    flat = []
    for idx, feat in enumerate(info.get("features", [])):
        props  = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [0, 0])

        # Skip pixels where mask filtered everything (all bands null)
        ndvi_check = props.get("NDVI_t1") or props.get("NDVI_t2")
        if ndvi_check is None:
            continue

        row = {"pixel_id": idx, "longitude": coords[0], "latitude": coords[1]}
        for k, v in props.items():
            key = k.replace("VV_filtered", "VV").replace("VH_filtered", "VH")
            row[key] = v if v is not None else 0.0

        # Assign a crop label so the frontend crop map renders in live mode too.
        # (Real pipeline has no simulated field_type — derive a quick proxy.)
        row["field_type"] = _quick_crop_label(row)
        flat.append(row)

    # Re-index pixel_ids sequentially after mask filtering
    for i, p in enumerate(flat):
        p["pixel_id"] = i

    return {
        "status":      "success",
        "mode":        "live_gee",
        "masking":     "dynamic_world_cropland",
        "grid_spacing": f"{SCALE_DEG}° (~{scale_m}m)",
        "aoi":         aoi,
        "date_range":  [start_date, end_date],
        "num_pixels":  len(flat),
        "columns":     list(flat[0].keys()) if flat else [],
        "data":        flat,
    }


def run_simulated_gee_pipeline(aoi=None, start_date=RABI_START, end_date=RABI_END, num_steps=4):
    """
    Simulates Sentinel-2 + Sentinel-1 data for Punjab Rabi crops.
    Crops: Wheat (55%) | Rice residue (20%) | Cotton stubble (15%) | Fallow (10%)
    4 timesteps matching Jan → Feb → Mar → Apr phenology.
    Grid: 10×10 = 100 pixels over Punjab AOI.
    """
    if aoi is None:
        aoi = PUNJAB_AOI

    lons = [pt[0] for pt in aoi]
    lats = [pt[1] for pt in aoi]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)

    grid_size = 26          # 26×26 = 676 pixels — dense enough for a smooth heat raster
    num_pixels = grid_size * grid_size

    # Punjab Rabi field block assignment (spatial coherence).
    # Thresholds expressed as fractions of grid_size so blocks scale with density.
    def field_type(pid):
        r = pid // grid_size
        c = pid  % grid_size
        rf = r / grid_size
        cf = c / grid_size
        if rf <= 0.5 and cf <= 0.55:  return "Wheat"    # top-left large block
        if rf <= 0.5 and cf > 0.55:   return "Cotton"   # top-right
        if rf > 0.5 and cf <= 0.35:   return "Rice"     # bottom-left
        if rf > 0.75 and cf > 0.35:   return "Fallow"   # bottom-right corner
        return "Wheat"

    # Punjab Rabi phenology lookup per timestep
    # t1=Jan, t2=Feb, t3=Mar, t4=Apr
    PHENOLOGY = {
        "Wheat": [
            # t1: early tillering — moderate NDVI
            dict(red=0.06, nir=0.38, grn=0.09, swir1=0.18, vv=-9.5,  vh=-15.5),
            # t2: peak growth — high NDVI
            dict(red=0.03, nir=0.65, grn=0.11, swir1=0.10, vv=-7.5,  vh=-13.0),
            # t3: grain fill — NDVI still high
            dict(red=0.04, nir=0.60, grn=0.10, swir1=0.12, vv=-8.0,  vh=-13.5),
            # t4: senescence — NDVI drops
            dict(red=0.18, nir=0.30, grn=0.14, swir1=0.35, vv=-11.5, vh=-17.5),
        ],
        "Rice": [
            # Jan: post-harvest, bare / residue
            dict(red=0.14, nir=0.22, grn=0.12, swir1=0.30, vv=-13.0, vh=-19.0),
            dict(red=0.13, nir=0.20, grn=0.11, swir1=0.28, vv=-13.5, vh=-19.5),
            dict(red=0.12, nir=0.18, grn=0.10, swir1=0.26, vv=-14.0, vh=-20.0),
            dict(red=0.10, nir=0.16, grn=0.09, swir1=0.24, vv=-14.5, vh=-20.5),
        ],
        "Cotton": [
            # Jan–Feb: harvested stubble, bare
            dict(red=0.16, nir=0.20, grn=0.13, swir1=0.32, vv=-14.0, vh=-20.0),
            dict(red=0.15, nir=0.19, grn=0.12, swir1=0.30, vv=-14.5, vh=-20.5),
            dict(red=0.14, nir=0.18, grn=0.11, swir1=0.28, vv=-15.0, vh=-21.0),
            dict(red=0.12, nir=0.16, grn=0.10, swir1=0.26, vv=-15.5, vh=-21.5),
        ],
        "Fallow": [
            dict(red=0.20, nir=0.24, grn=0.15, swir1=0.35, vv=-15.0, vh=-21.0),
            dict(red=0.20, nir=0.23, grn=0.15, swir1=0.35, vv=-15.5, vh=-21.5),
            dict(red=0.19, nir=0.22, grn=0.14, swir1=0.34, vv=-16.0, vh=-22.0),
            dict(red=0.18, nir=0.21, grn=0.14, swir1=0.33, vv=-16.5, vh=-22.5),
        ],
    }

    flat_matrix = []
    lon_step = (max_lon - min_lon) / grid_size
    lat_step = (max_lat - min_lat) / grid_size

    for pid in range(num_pixels):
        r = pid // grid_size
        c = pid  % grid_size
        lon = min_lon + (c + 0.5) * lon_step
        lat = min_lat + (r + 0.5) * lat_step
        ftype = field_type(pid)
        row = {
            "pixel_id":   pid,
            "longitude":  round(lon, 6),
            "latitude":   round(lat, 6),
            "field_type": ftype,
        }

        pheno = PHENOLOGY[ftype]
        for t in range(1, num_steps + 1):
            p = pheno[min(t - 1, len(pheno) - 1)]
            suffix = f"_t{t}"
            n = 0.01  # noise

            red   = max(0.01, p["red"]   + random.uniform(-n, n))
            nir   = max(0.02, p["nir"]   + random.uniform(-n, n))
            grn   = max(0.01, p["grn"]   + random.uniform(-n, n))
            swir1 = max(0.01, p["swir1"] + random.uniform(-n, n))
            vv    = p["vv"] + random.uniform(-0.3, 0.3)
            vh    = p["vh"] + random.uniform(-0.3, 0.3)

            ndvi = (nir - red) / (nir + red) if (nir + red) > 0 else 0
            evi  = 2.5 * (nir - red) / (nir + 6*red - 7.5*0.05 + 1) if (nir + 6*red - 7.5*0.05 + 1) != 0 else 0
            ndwi = (grn - nir) / (grn + nir) if (grn + nir) > 0 else 0
            lswi = (nir - swir1) / (nir + swir1) if (nir + swir1) > 0 else 0
            ndmi = lswi

            vv_lin   = 10 ** (vv / 10)
            vh_lin   = 10 ** (vh / 10)
            vhvv_rat = round(vh_lin / vv_lin, 4) if vv_lin > 0 else 0

            row[f"NDVI{suffix}"]       = round(ndvi, 4)
            row[f"EVI{suffix}"]        = round(evi,  4)
            row[f"NDWI{suffix}"]       = round(ndwi, 4)
            row[f"LSWI{suffix}"]       = round(lswi, 4)
            row[f"NDMI{suffix}"]       = round(ndmi, 4)
            row[f"VV{suffix}"]         = round(vv,   2)
            row[f"VH{suffix}"]         = round(vh,   2)
            row[f"VH_VV_ratio{suffix}"]= vhvv_rat

        flat_matrix.append(row)

    # 3×3 speckle filter on SAR
    for t in range(1, num_steps + 1):
        suffix = f"_t{t}"
        for idx in range(num_pixels):
            r = idx // grid_size
            c = idx  % grid_size
            vv_vals, vh_vals = [], []
            for dr in [-1, 0, 1]:
                for dc in [-1, 0, 1]:
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < grid_size and 0 <= nc < grid_size:
                        nb = flat_matrix[nr * grid_size + nc]
                        vv_vals.append(nb[f"VV{suffix}"])
                        vh_vals.append(nb[f"VH{suffix}"])
            avg_vv = sum(vv_vals) / len(vv_vals)
            avg_vh = sum(vh_vals) / len(vh_vals)
            flat_matrix[idx][f"VV{suffix}"] = round(avg_vv, 2)
            flat_matrix[idx][f"VH{suffix}"] = round(avg_vh, 2)
            vv_l = 10 ** (avg_vv / 10)
            vh_l = 10 ** (avg_vh / 10)
            flat_matrix[idx][f"VH_VV_ratio{suffix}"] = round(vh_l / vv_l, 4) if vv_l > 0 else 0

    return {
        "status":     "success",
        "mode":       "simulated_gee",
        "warning":    "Simulated Punjab Rabi data — set GEE credentials for live Sentinel data",
        "aoi":        aoi,
        "date_range": [start_date, end_date],
        "num_pixels": len(flat_matrix),
        "columns":    list(flat_matrix[0].keys()) if flat_matrix else [],
        "data":       flat_matrix,
    }


def main():
    try:
        input_data = sys.stdin.read().strip()
        if not input_data:
            params = {
                "aoi":        PUNJAB_AOI,
                "start_date": RABI_START,
                "end_date":   RABI_END,
                "num_steps":  4,
            }
        else:
            params = json.loads(input_data)

        aoi        = params.get("aoi", PUNJAB_AOI)
        start_date = params.get("start_date", RABI_START)
        end_date   = params.get("end_date",   RABI_END)
        num_steps  = int(params.get("num_steps", 4))

        gee_ready = False
        if HAS_EE:
            gee_ready, msg = init_gee(
                params.get("service_account_email"),
                params.get("service_account_key"),
            )

        if gee_ready:
            result = run_real_gee_pipeline(aoi, start_date, end_date, num_steps)
            if "error" in result:
                result = run_simulated_gee_pipeline(aoi, start_date, end_date, num_steps)
        else:
            result = run_simulated_gee_pipeline(aoi, start_date, end_date, num_steps)

        print(json.dumps(result, indent=2))

    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()