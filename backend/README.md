# Crop Irrigation Advisor — GEE Backend

FastAPI backend for the Satellite Data Pipeline.  
Works **without GEE credentials** (simulation mode) so you can demo/record a video immediately.

---

## Architecture

```
POST /pipeline/run
      │
      ├─ GEE credentials present? ──YES──▶ run_real_gee_pipeline()   (Sentinel-2 + S1 live)
      │                                          │ error / quota?
      │                                          └──▶ fallback ─────▶ run_simulated_gee_pipeline()
      └─ No creds ──────────────────────▶ run_simulated_gee_pipeline()
```

### Feature Matrix output (per pixel per time step)

| Source     | Features                                     |
|------------|----------------------------------------------|
| Sentinel-2 | B2, B3, B4, B8, B11, B12 (raw reflectance)  |
| S2 Indices | NDVI, EVI, NDWI, LSWI, NDMI                 |
| Sentinel-1 | VV, VH (raw dB), VV_filtered, VH_filtered (3×3 boxcar), VH_VV_ratio |

With `num_steps=3` → **53 columns × 100 pixels** (10×10 grid) per run.

---

## Quick Start

```bash
# 1. Install deps
pip install -r requirements.txt

# 2. Smoke test — no credentials needed
python test_pipeline.py

# 3. Start API server
uvicorn python_api.main:app --reload --port 8000
```

Open http://localhost:8000/docs for the Swagger UI.

### Zero-config test endpoint
```
GET  http://localhost:8000/pipeline/test
```

### Run the pipeline
```bash
curl -X POST http://localhost:8000/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{
    "aoi": [[-120.50,37.50],[-120.48,37.50],[-120.48,37.52],[-120.50,37.52],[-120.50,37.50]],
    "start_date": "2023-05-01",
    "end_date": "2023-09-01",
    "num_steps": 3
  }'
```

---

## Connecting Real GEE

1. Create a GEE Cloud Project → enable Earth Engine API
2. Create a Service Account → download JSON key
3. Set env vars:
   ```
   GEE_SERVICE_ACCOUNT_EMAIL=svc@project.iam.gserviceaccount.com
   GEE_KEY_PATH=/path/to/key.json
   ```
4. POST to `/gee/init` or pass creds in the pipeline request body

---

## Endpoints

| Method | Path               | Description                                          |
|--------|--------------------|------------------------------------------------------|
| GET    | `/health`          | Liveness + GEE init status                           |
| GET    | `/gee/status`      | Detailed GEE initialization info                     |
| POST   | `/gee/init`        | (Re-)initialize GEE with service account             |
| POST   | `/pipeline/run`    | **Main pipeline** → flat feature matrix              |
| POST   | `/pipeline/ndvi-summary` | NDVI per pixel per timestep (good for maps)   |
| GET    | `/pipeline/test`   | Zero-config smoke test                               |
| GET    | `/docs`            | Swagger UI                                           |

# Steps 3–5: New Backend Modules

## Files Added / Replaced

| File | What it does |
|------|-------------|
| `lulc_labels.py` | **Step 3** — ESRI LULC label fetch (GEE) + Punjab-realistic simulation fallback |
| `rf_model.py` | **Steps 4+5** — RF 70/30 training, confusion matrix, predict → GeoJSON |
| `app.py` | Updated FastAPI with 4 new endpoints |

## New API Endpoints

### POST `/lulc/labels`  (Step 3)
Fetches ESRI LULC 10m labels for sampled pixels.
Falls back to simulated Punjab crop distribution when GEE is offline.

```bash
curl -X POST http://localhost:8000/lulc/labels \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2023-11-01","end_date":"2024-03-31","num_steps":3}'
```

### POST `/train`  (Step 4)
Trains RF on 70% split, evaluates on 30%.
Returns accuracy, confusion matrix, per-class F1, feature importances.

```bash
curl -X POST http://localhost:8000/train \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2023-11-01","end_date":"2024-03-31","num_steps":3}'
```

### POST `/crop-map`  (Step 5 — single layer)
```bash
# Crop type map
curl -X POST http://localhost:8000/crop-map \
  -d '{"layer":"crop","start_date":"2023-11-01","end_date":"2024-03-31"}'

# Stress map
curl -d '{"layer":"stress",...}' http://localhost:8000/crop-map

# Irrigation advisory map
curl -d '{"layer":"irrigation",...}' http://localhost:8000/crop-map
```

### POST `/crop-map/all`  (Steps 3+4+5 combined — recommended for frontend)
Returns all 3 GeoJSON layers + training report + time-series in one call.
```bash
curl -X POST http://localhost:8000/crop-map/all \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2023-11-01","end_date":"2024-03-31","num_steps":3}'
```

Response shape:
```json
{
  "status": "ok",
  "mode": "simulated_gee",
  "train_report": {
    "accuracy_pct": 76.67,
    "confusion_matrix": [[...]],
    "top10_feature_importances": [...]
  },
  "summary": { "avg_ndvi": 0.70, "avg_deficit_mm": 25.3, ... },
  "layers": {
    "crop":       { "type": "FeatureCollection", "features": [...] },
    "stress":     { "type": "FeatureCollection", "features": [...] },
    "irrigation": { "type": "FeatureCollection", "features": [...] }
  },
  "timeseries": [...]
}
```

### GET `/pipeline/test`
End-to-end smoke test. No GEE creds needed.

## Leaflet Integration (frontend side)

```javascript
const res = await fetch('/crop-map/all', { method: 'POST', body: JSON.stringify({...}) });
const data = await res.json();

// Render active layer
L.geoJSON(data.layers[activeLayer], {
  style: f => ({
    fillColor: f.properties.color,
    weight: 0.5, fillOpacity: 0.75
  }),
  onEachFeature: (f, layer) => {
    const p = f.properties;
    layer.bindPopup(`
      <b>${p.crop_type}</b> (${(p.crop_confidence*100).toFixed(0)}%)<br/>
      Stress: ${p.stress_level}  |  NDVI: ${p.NDVI_t2}<br/>
      Advisory: <b>${p.advisory}</b> (deficit ${p.deficit_mm} mm)
    `);
  }
}).addTo(map);
```