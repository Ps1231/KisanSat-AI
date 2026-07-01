import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// FastAPI backend (app.py, port 8000) — loads .env, initializes GEE once.
const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";

// Generic proxy helper for the FastAPI satellite endpoints.
async function proxyToFastAPI(reqBody: any, endpoint: string, res: express.Response) {
  try {
    const r = await fetch(`${FASTAPI_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    console.error(`[${endpoint}] FastAPI proxy failed:`, e);
    return res.status(502).json({
      status: "error",
      error: "Backend unreachable",
      detail: "Could not reach the FastAPI pipeline at " + FASTAPI_URL +
              ". Start it with: uvicorn app:app --port 8000",
    });
  }
}

// GET proxy helper for FastAPI dashboard endpoints.
async function getFromFastAPI(endpoint: string, res: express.Response) {
  try {
    const r = await fetch(`${FASTAPI_URL}${endpoint}`);
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    console.error(`[${endpoint}] FastAPI GET proxy failed:`, e);
    return res.status(502).json({ error: "Backend unreachable" });
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  // Real dashboard data from the GEE/RF pipeline (FastAPI /api/dashboard)
  app.get("/api/dashboard", (req, res) => getFromFastAPI("/api/dashboard", res));

  // Real 7-day weather for the AOI (FastAPI → Open-Meteo)
  app.get("/api/weather", (req, res) => getFromFastAPI("/api/weather", res));

  app.get("/api/soil-health", (req, res) => {
    const mockSoilHealth = [
      { date: 'Jan', nitrogen: 45, phosphorus: 30, potassium: 50, salinity: 2.1 },
      { date: 'Feb', nitrogen: 47, phosphorus: 32, potassium: 52, salinity: 2.0 },
      { date: 'Mar', nitrogen: 42, phosphorus: 28, potassium: 48, salinity: 2.3 },
      { date: 'Apr', nitrogen: 50, phosphorus: 35, potassium: 55, salinity: 1.9 },
    ];
    res.json(mockSoilHealth);
  });

  app.get("/api/yield-prediction", (req, res) => {
    const mockYield = [
      { field: 'Field A', projected: 85, historical: 80 },
      { field: 'Field B', projected: 75, historical: 78 },
      { field: 'Field C', projected: 90, historical: 88 },
    ];
    res.json(mockYield);
  });

  // Pipeline status (FastAPI — hardcoded demo view, real code commented there)
  app.get("/api/pipeline-status", (req, res) => getFromFastAPI("/api/pipeline-status", res));

  // Real RF-model data endpoints (used by IrrigationAdvisory / SoilHealth / Analytics)
  app.get("/api/fields", (req, res) => getFromFastAPI("/api/fields", res));
  app.get("/api/summary", (req, res) => getFromFastAPI("/api/summary", res));
  app.get("/api/validation/metrics", (req, res) => getFromFastAPI("/api/validation/metrics", res));
  app.get("/api/timeseries", (req, res) => getFromFastAPI("/api/timeseries", res));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // ── Chatbot endpoint ─────────────────────────────────────────────────────
  // Body: { message: string, history?: { role: 'user' | 'model', text: string }[] }

  // ── Satellite pipeline: proxy straight to the FastAPI backend ──────────────
  // FastAPI (app.py, port 8000) loads .env and initializes GEE *once* at
  // startup. Spawning a fresh python process per request (the old approach)
  // re-ran ee.Initialize() every call AND never received credentials, because
  // this Node process never loaded .env — so it always fell back to simulation.
  // Proxying to the already-initialized FastAPI session is faster and uses
  // live GEE whenever the backend has working credentials.
  app.all("/api/advisory-summary", async (req, res) => {
    const payload = req.method === "POST" ? req.body : req.query;
    return proxyToFastAPI(payload, "/api/advisory-summary", res);
  });

  app.all("/api/satellite/process", async (req, res) => {
    const payload = req.method === "POST" ? req.body : req.query;
    return proxyToFastAPI(payload, "/api/satellite/process", res);
  });

  // Chatbot — proxy to FastAPI hybrid chat engine
  app.all("/api/chat", async (req, res) => {
    const payload = req.method === "POST" ? req.body : req.query;
    try {
      const r = await fetch(`${FASTAPI_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      return res.json(data);
    } catch (e) {
      console.error("[chat] FastAPI proxy failed:", e);
      return res.status(502).json({
        reply: "Advisory server is offline. Start the backend on port 8000 and retry.",
        options: ["Crop overview", "Irrigation advice", "Moisture stress"],
      });
    }
  });

  // Continuous raster layers (GEE getMapId tile URLs) — PPT-accurate map
  app.all("/api/satellite/raster", async (req, res) => {
    const payload = req.method === "POST" ? req.body : req.query;
    return proxyToFastAPI(payload, "/api/satellite/raster", res);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://locahttps://drive.google.com/drive/folders/1FyJjeKC26fbuEALupd_UblVR5i50fkNF?usp=sharinglhost:${PORT}`);
  });
}

startServer();