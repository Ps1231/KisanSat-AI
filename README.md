# 🛰️ KisanSat AI — Satellite-Powered Crop Irrigation Advisor

**KisanSat AI** turns free Sentinel-1/Sentinel-2 satellite imagery into field-level crop classification, growth-stage tracking, moisture-stress detection, and irrigation advisories — with an AI chatbot on top. Built around Punjab's Rabi (wheat) cropping season, but the pipeline works for any AOI.

It's a full-stack project: a **React + TypeScript** dashboard, an **Express** server that also proxies to Gemini for chat, and a **FastAPI + scikit-learn** backend that talks to **Google Earth Engine** (or falls back to a realistic simulation when GEE credentials aren't configured, so the whole thing runs and demos out of the box).

---

## Table of Contents

- [How it works](#how-it-works)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Frontend / Node server setup](#1-frontend--node-server-setup)
  - [2. Python backend setup](#2-python-backend-setup)
  - [3. Run everything](#3-run-everything)
- [Connecting Real Google Earth Engine](#connecting-real-google-earth-engine)
- [API Reference](#api-reference)
  - [Node/Express layer (port 3000)](#nodeexpress-layer-port-3000)
  - [FastAPI layer (port 8000)](#fastapi-layer-port-8000)
- [The ML Pipeline](#the-ml-pipeline)
- [The Chatbot](#the-chatbot)
- [Frontend Pages](#frontend-pages)
- [Building for Production](#building-for-production)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## How it works

1. Pick an Area of Interest (AOI) — one of a few pre-defined Punjab farmland polygons — and a date range covering the Rabi season.
2. The FastAPI backend pulls **Sentinel-2** (optical) and **Sentinel-1** (SAR) imagery for that AOI over 2–4 temporal slices via **Google Earth Engine**, computes spectral indices (NDVI, EVI, NDWI, LSWI, NDMI) and SAR features (VV/VH backscatter, speckle-filtered, VH/VV ratio), and stacks them into a flat feature matrix (pixels × ~50 features).
3. A **Random Forest** classifier (trained on ESRI LULC labels, 70/30 split) predicts crop type per pixel, and rule-based logic derives growth stage, moisture-stress level, and an irrigation deficit/advisory.
4. The React frontend renders this as an interactive **Leaflet** map (categorical crop tiles or continuous heat rasters for stage/moisture), a pixel inspector, a stacked feature-matrix table (CSV-exportable), field comparisons, weather, soil health, and yield charts.
5. A chatbot (Gemini-powered when an API key is set, rule-based otherwise) answers natural-language questions grounded in the live dashboard/pipeline data.
6. If GEE credentials aren't configured, every endpoint transparently falls back to a **statistically realistic simulation** of Punjab cropland (correct crop mix, seasonal NDVI curves, SAR ranges) so the app is fully demoable with zero external setup.

---

## Features

- 🗺️ **Interactive satellite analysis maps** — Crop Type, Growth Stage (Phenology), Moisture Stress, and a raw GEE Feature Pipeline layer, each with legends, a pixel inspector, and per-timestep sliders.
- 🤖 **Random Forest crop classifier** — trained on Sentinel-1/2 features against ESRI LULC labels, with confusion matrix, per-class F1, and feature-importance reporting.
- 💧 **Irrigation advisory engine** — per-field stress levels (low/moderate/high), a plain-language advisory, and a downloadable PDF summary report (via `jspdf`).
- 📊 **Dashboard** — drag-and-drop reorderable widgets (pipeline status, moisture metrics, weather, crop distribution), with a one-click PNG snapshot export.
- 🌦️ **7-day weather outlook** with per-day irrigation water-need levels.
- 🌱 **Soil health & NPK trends** and a **seasonal yield predictor** (projected vs. historical).
- 📡 **Raw GEE feature pipeline explorer** — pick any spectral/SAR layer, any timestep, and download the full feature matrix as CSV.
- 💬 **AI chatbot** — Gemini-powered free-text Q&A grounded in live farm data, with instant rule-based answers for common intents (moisture, irrigation, weather, crop stage) and full offline fallback.
- 🌓 **Dark mode**, responsive layout, and a collapsible sidebar.
- 🧪 **Zero-config demo mode** — no GEE keys, no trained model on disk, no Gemini key required. Everything self-heals by generating simulated data/models on first request.

---

## Architecture

```
┌─────────────────────────┐        ┌──────────────────────────┐        ┌────────────────────────────┐
│   React + Vite frontend │  HTTP  │   Express server (Node)  │  HTTP  │   FastAPI backend (Python)  │
│   (src/, port 3000 UI)  │ ─────▶ │   server.ts (port 3000)  │ ─────▶ │   backend/app.py (port 8000)│
│                          │        │                          │        │                              │
│  Dashboard, Maps, Chat,  │        │  - Serves the Vite app   │        │  - GEE pipeline (real/sim)   │
│  Advisory, Soil, etc.    │        │  - Mock dashboard/weather│        │  - RF crop classifier        │
│                          │        │    /soil/yield endpoints │        │  - Growth stage / moisture   │
│                          │        │  - Gemini chat + rule-   │        │    stress / irrigation logic │
│                          │        │    based fallback        │        │  - Chat context data          │
│                          │        │  - Proxies /api/satellite│        │                              │
│                          │        │    and /api/chat to      │        │                              │
│                          │        │    FastAPI               │        │                              │
└─────────────────────────┘        └──────────────────────────┘        └──────────────┬───────────────┘
                                                                                        │
                                                                                        ▼
                                                                          ┌──────────────────────────┐
                                                                          │   Google Earth Engine     │
                                                                          │   (Sentinel-1 / Sentinel-2│
                                                                          │   optional — falls back   │
                                                                          │   to simulation if unset) │
                                                                          └──────────────────────────┘
```

**Why two servers?** The Node/Express layer (`server.ts`) owns the frontend build (Vite middleware in dev, static `dist/` in prod), serves fast mock endpoints for dashboard/weather/soil/yield data, and holds the Gemini API key server-side so it never reaches the browser. The Python/FastAPI layer (`backend/app.py`) owns everything satellite- and ML-related — it initializes GEE once at startup and keeps the trained Random Forest model in memory, which would be slow/awkward to do per-request from Node.

---

## Tech Stack

**Frontend**
- React 19 + TypeScript, Vite 6
- Tailwind CSS 4
- `recharts` (charts), `motion` (animations), `@dnd-kit` (drag & drop dashboard), `leaflet` + `leaflet.heat` (maps, loaded via CDN at runtime), `lucide-react` (icons)
- `jspdf` + `jspdf-autotable` (PDF export), `html-to-image` (dashboard snapshot)

**Node server**
- Express 4, `tsx` (dev runtime), `esbuild` (prod bundle), `@google/genai` (Gemini SDK), `dotenv`

**Python backend**
- FastAPI, Pydantic, Uvicorn
- `earthengine-api` (Google Earth Engine Python client)
- `scikit-learn` (Random Forest), NumPy

---

## Project Structure

```
KisanSat-AI/
├── src/                          # React frontend
│   ├── App.tsx                   # Shell: sidebar nav, dark mode, tab routing
│   ├── main.tsx
│   ├── index.css
│   ├── types.ts                  # Shared frontend TypeScript interfaces
│   ├── context/
│   │   └── ThemeContext.tsx      # Dark/light mode provider
│   ├── data/
│   │   └── adviceTree.ts         # Decision-tree style advisory content
│   └── components/
│       ├── Dashboard.tsx         # Drag-and-drop widget dashboard + PNG snapshot
│       ├── AnalysisMaps.tsx      # Leaflet map, GEE pipeline runner, feature table
│       ├── PipelineStatus.tsx
│       ├── MoistureMetrics.tsx
│       ├── WeatherForecast.tsx
│       ├── IrrigationAdvisory.tsx# Field advisories + PDF export
│       ├── SoilHealth.tsx        # NPK + salinity trend charts
│       ├── YieldPredictor.tsx    # Projected vs historical yield chart
│       ├── GrowthStageChart.tsx
│       ├── Chatbot.tsx           # Floating chat widget
│       └── Settings.tsx
│
├── backend/                      # FastAPI + ML backend
│   ├── app.py                    # API endpoints, self-healing data/model cache
│   ├── gee_pipeline.py           # GEE init, real + simulated pipelines, raster tiles
│   ├── rf_model.py               # RF training, prediction, GeoJSON conversion
│   ├── lulc_labels.py            # ESRI LULC label fetch + simulated fallback
│   ├── chat_engine.py            # Hybrid Gemini/rule-based chat handler
│   ├── train_crop_model.py       # Simulated Punjab pixel generator
│   ├── train_model.py
│   ├── test_gee_pipeline.py / test_raster.py
│   ├── trained_output/           # Generated: model + GeoJSON layers (gitignored)
│   ├── requirements.txt
│   └── README.md                 # Backend-specific API notes
│
├── server.ts                     # Express server: mock APIs, Gemini chat, FastAPI proxy
├── index.html                    # Vite entry point
├── vite.config.ts
├── tsconfig.json
├── package.json
├── .env.example                  # GEMINI_API_KEY template
└── metadata.json
```

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+ and pip
- *(Optional)* A [Gemini API key](https://aistudio.google.com/apikey) for full AI chat responses
- *(Optional)* A Google Earth Engine service account for live satellite data

> Nothing above marked "optional" is required to run the app — it works fully offline with simulated data and rule-based chat out of the box.

### 1. Frontend / Node server setup

```bash
cd KisanSat-AI

# Install JS dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local and set GEMINI_API_KEY (optional — leave blank for offline chat mode)
```

### 2. Python backend setup

```bash
cd backend

# (Recommended) create a virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt
```

### 3. Run everything

You need **two processes** running side by side:

```bash
# Terminal 1 — FastAPI backend (port 8000)
cd backend
uvicorn app:app --reload --port 8000

# Terminal 2 — Node/Vite dev server (port 3000)
cd KisanSat-AI
npm run dev
```

Then open **http://localhost:3000**.

- Dashboard, weather, soil health, and yield widgets use fast mock data served directly by Express.
- The **Analysis Maps** tab and **Chatbot** call through to the FastAPI backend on port 8000. If FastAPI isn't running, these gracefully degrade (satellite calls return a 502 with a clear message telling you to start `uvicorn`; chat falls back to an "offline" notice).
- Without GEE credentials configured, `/api/satellite/process` automatically uses `run_simulated_gee_pipeline()` — a statistically realistic stand-in for real Sentinel data, so the maps, feature matrix, and RF classifier all still work end-to-end.

---

## Connecting Real Google Earth Engine

1. Create a Google Cloud project and enable the **Earth Engine API**.
2. Create a **Service Account**, grant it Earth Engine access, and download its JSON key.
3. Set these environment variables (in `backend/.env` or your shell) before starting `uvicorn`:
   ```
   GEE_SERVICE_ACCOUNT_EMAIL=svc@your-project.iam.gserviceaccount.com
   GEE_KEY_PATH=/absolute/path/to/key.json
   ```
4. Restart the FastAPI backend. Check status via:
   ```bash
   curl http://localhost:8000/gee/status
   ```
   `initialized: true` means live Sentinel-1/2 pulls are active. `/api/satellite/raster` (continuous raster tile overlays) **requires** live GEE and returns an explicit error if it isn't configured — the point-based `/api/satellite/process` endpoint works either way.

---

## API Reference

### Node/Express layer (port 3000)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard` | Mock dashboard stats + field list |
| GET | `/api/weather` | 7-day mock weather forecast with irrigation water-need levels |
| GET | `/api/soil-health` | Mock NPK + salinity trend data |
| GET | `/api/yield-prediction` | Mock projected vs. historical yield data |
| GET | `/api/pipeline-status` | Mock model/pipeline status flags |
| GET | `/api/health` | Node server liveness check |
| ALL | `/api/satellite/process` | Proxies to FastAPI `POST /api/satellite/process` |
| ALL | `/api/satellite/raster` | Proxies to FastAPI `POST /api/satellite/raster` |
| ALL | `/api/chat` | Proxies to FastAPI `POST /api/chat` (Gemini-backed advisory chat) |

### FastAPI layer (port 8000)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server + model status |
| GET | `/gee/status` | GEE init status and configured service account |
| GET | `/api/fields` | Per-pixel crop/confidence/stress/advisory predictions |
| GET | `/api/crop-map` | Crop type layer as GeoJSON |
| GET | `/api/stress-map` | Moisture stress layer as GeoJSON |
| GET | `/api/irrigation-map` | Irrigation advisory layer as GeoJSON |
| GET | `/api/advisory/{pixel_id}` | Detailed advisory + raw spectral features for one pixel |
| GET | `/api/validation/metrics` | RF training accuracy, confusion matrix, feature importances |
| GET | `/api/timeseries` | NDVI time series sampled per crop type |
| GET | `/api/summary` | Dashboard-level aggregate stats |
| GET | `/pipeline/test` | Zero-config smoke test (no credentials needed) |
| POST | `/api/crop-map/all` | All 3 GeoJSON layers + training report + timeseries in one call (recommended for frontend use) |
| POST | `/api/satellite/process` | Runs the GEE (or simulated) feature-extraction pipeline for an AOI/date range |
| POST | `/api/satellite/raster` | Live GEE `getMapId` tile URLs for continuous raster overlays (crop/stage/moisture/NDVI) |
| POST | `/api/chat` | Hybrid Gemini/rule-based advisory chatbot, grounded in live pipeline data |

See [`backend/README.md`](backend/README.md) for full request/response examples, `curl` snippets, and the Leaflet integration pattern used by the frontend.

---

## The ML Pipeline

1. **Label acquisition** (`lulc_labels.py`) — samples ESRI 10 m Land Use/Land Cover labels over the AOI via GEE, or generates a simulated Punjab-realistic crop distribution (Wheat/Rice/Cotton/Fallow) when GEE is unavailable.
2. **Feature extraction** (`gee_pipeline.py`) — for each of 2–4 temporal slices, computes:
   - Sentinel-2 raw bands: B2, B3, B4, B8, B11, B12
   - Spectral indices: NDVI, EVI, NDWI, LSWI, NDMI
   - Sentinel-1 SAR: VV, VH (raw dB), 3×3 boxcar-filtered VV/VH, VH/VV ratio
   - → a flat matrix of ~50+ columns × N sampled pixels
3. **Training** (`rf_model.py`) — a Random Forest is trained on a 70/30 split, reporting accuracy, confusion matrix, per-class F1, and top feature importances.
4. **Inference & advisory logic** — the trained model predicts crop type per pixel; NDVI drives growth-stage classification; NDWI drives a moisture-stress level (optimal/mild/severe) and irrigation deficit (mm), producing a plain-language advisory ("No irrigation required" → "⚠️ Severe deficit! Irrigate immediately").
5. **Self-healing cache** — `backend/app.py` lazily generates and caches (`trained_output/`) labeled pixels, the trained model, GeoJSON layers, and the training report on first request, so a fresh clone works with zero manual setup steps.

---

## The Chatbot

`Chatbot.tsx` (frontend) talks to `POST /api/chat`, which is proxied by Express to FastAPI's `chat_engine.py`. The handler:

- Answers common intents (crop overview, irrigation advice, moisture stress) instantly using live pipeline data — no LLM call needed.
- Routes free-text questions to **Gemini** (via `@google/genai` on the Node side, scoped with a live farm-data system context built in `server.ts`'s `buildFarmContext()`), when `GEMINI_API_KEY` is set.
- Falls back to a fully rule-based responder (`ruleBasedReply` in `server.ts`) when no Gemini key is configured or the FastAPI backend is unreachable — the chat never hard-fails, it just tells the user it's in offline mode.

---

## Frontend Pages

| Tab | Component | Highlights |
|-----|-----------|-----------|
| Dashboard | `Dashboard.tsx` | Drag-and-drop widgets, crop distribution pie chart, PNG snapshot export |
| Analysis Maps | `AnalysisMaps.tsx` | Interactive Leaflet map (4 layers), pixel inspector, GEE config panel, live terminal-style pipeline logger, feature-matrix table + CSV export, field comparison |
| Irrigation Advisory | `IrrigationAdvisory.tsx` | Per-field advisory cards, PDF report export |
| Analytics | `GrowthStageChart.tsx` | Growth-stage trend visualization |
| Soil Health | `SoilHealth.tsx` | NPK and salinity trend line charts |
| Settings | `Settings.tsx` | App preferences |

---

## Building for Production

```bash
# Build the frontend (Vite) and bundle the Node server
npm run build

# Run the production server
NODE_ENV=production npm start
```

The Python FastAPI backend runs the same way in both dev and prod — deploy it separately (e.g. with `uvicorn app:app --host 0.0.0.0 --port 8000` behind a process manager) and point `FASTAPI_URL` at it:

```bash
FASTAPI_URL=https://your-backend-host:8000 npm start
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Analysis Maps tab shows "Backend unreachable" | Start the FastAPI server: `cd backend && uvicorn app:app --reload --port 8000` |
| Chatbot says it's in "offline mode" | Set `GEMINI_API_KEY` in `.env.local` and restart the Node server |
| `/api/satellite/raster` returns an error | Continuous raster tiles require **live** GEE credentials — see [Connecting Real Google Earth Engine](#connecting-real-google-earth-engine). The point-based map layers work without it. |
| GEE init fails silently at backend startup | Check `GEE_SERVICE_ACCOUNT_EMAIL` / `GEE_KEY_PATH` are set and the key file is readable; check backend logs for `[GEE]` warnings |
| Model/GeoJSON files missing on fresh clone | Expected — `backend/app.py` self-heals by generating `trained_output/` on first relevant request |

---

## Roadmap

- [ ] Learned degradation encoder (DAN-style) as an alternative to hardcoded Wald's-protocol-style feature scaling
- [ ] Multi-region AOI support beyond the current predefined Punjab polygons
- [ ] Persisted user accounts / saved field boundaries
- [ ] Historical yield validation against ground-truth records
