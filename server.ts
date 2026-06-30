import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from 'url';
import { spawn } from "child_process";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.get("/api/dashboard", (req, res) => {
    const mockData = {
      stats: {
        totalArea: 1500, // hectares
        avgMoisture: 65,
        etRate: 4.2,
        waterDeficit: 'Low',
        cropDistribution: [
          { name: 'Wheat', value: 40 },
          { name: 'Corn', value: 35 },
          { name: 'Soy', value: 25 },
        ],
      },
      fields: [
        { id: '1', name: 'Field North', moistureLevel: 72, growthStage: 'vegetative', stressLevel: 'low', advisory: 'No action needed' },
        { id: '2', name: 'Field South', moistureLevel: 45, growthStage: 'flowering', stressLevel: 'high', advisory: 'Light irrigation recommended' },
      ],
    };
    res.json(mockData);
  });

  app.get("/api/weather", (req, res) => {
    const mockForecast = [
      { day: 'Mon', temp: 24, condition: 'Sunny', waterNeeds: 'High' },
      { day: 'Tue', temp: 22, condition: 'Sunny', waterNeeds: 'High' },
      { day: 'Wed', temp: 20, condition: 'Cloudy', waterNeeds: 'Moderate' },
      { day: 'Thu', temp: 18, condition: 'Rainy', waterNeeds: 'Low' },
      { day: 'Fri', temp: 19, condition: 'Rainy', waterNeeds: 'Low' },
      { day: 'Sat', temp: 21, condition: 'Sunny', waterNeeds: 'Moderate' },
      { day: 'Sun', temp: 23, condition: 'Sunny', waterNeeds: 'High' },
    ];
    res.json(mockForecast);
  });

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

  app.get("/api/pipeline-status", (req, res) => {
    res.json({
      data_processing: "ready",
      crop_classification_model: "active",
      crop_phenology_model: "active",
      moisture_stress_model: "active",
      irrigation_advisory: "generated"
    });
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.all("/api/satellite/process", (req, res) => {
    const isPost = req.method === "POST";
    const body = isPost ? req.body : req.query;

    const defaultAoi = [
      [-120.50, 37.50],
      [-120.48, 37.50],
      [-120.48, 37.52],
      [-120.50, 37.52],
      [-120.50, 37.50]
    ];

    let aoi = defaultAoi;
    if (body.aoi) {
      try {
        aoi = typeof body.aoi === "string" ? JSON.parse(body.aoi) : body.aoi;
      } catch (e) {
        console.error("Failed to parse input AOI:", e);
      }
    }

    const startDate = body.startDate || "2023-05-01";
    const endDate = body.endDate || "2023-09-01";
    const numSteps = parseInt((body.numSteps as string) || "3", 10);

    let serviceAccountKey = process.env.GEE_SERVICE_ACCOUNT_KEY || null;
    if (!serviceAccountKey && process.env.GEE_KEY_PATH) {
      try {
        let keyPath = process.env.GEE_KEY_PATH;
        if (!path.isAbsolute(keyPath)) {
          keyPath = path.join(process.cwd(), keyPath);
        }
        if (fs.existsSync(keyPath)) {
          serviceAccountKey = fs.readFileSync(keyPath, "utf8");
          console.log(`[GEE] Successfully loaded service account key from GEE_KEY_PATH: ${process.env.GEE_KEY_PATH}`);
        } else {
          console.warn(`[GEE] GEE_KEY_PATH file not found at: ${keyPath}`);
        }
      } catch (err) {
        console.error("[GEE] Error reading GEE_KEY_PATH:", err);
      }
    }

    const inputData = {
      aoi,
      start_date: startDate,
      end_date: endDate,
      num_steps: numSteps,
      service_account_email: process.env.GEE_SERVICE_ACCOUNT_EMAIL || null,
      service_account_key: serviceAccountKey
    };

    const scriptPath = path.join(__dirname, "backend", "gee_pipeline.py");
    const py = spawn("python3", [scriptPath]);
    let output = "";
    let errorOutput = "";

    try {
      py.stdin.write(JSON.stringify(inputData));
      py.stdin.end();
    } catch (err) {
      console.error("Error writing to python process stdin:", err);
    }

    py.stdout.on("data", (data) => {
      output += data.toString();
    });

    py.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    py.on("close", (code) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(output);
          return res.json(parsed);
        } catch (e) {
          return returnFallback("JSON parse error on python output", output);
        }
      } else {
        // Try fallback to "python" if "python3" was not found
        const py2 = spawn("python", [scriptPath]);
        let output2 = "";
        let errorOutput2 = "";

        try {
          py2.stdin.write(JSON.stringify(inputData));
          py2.stdin.end();
        } catch (err) {
          console.error("Error writing to python2 process stdin:", err);
        }

        py2.stdout.on("data", (data) => { output2 += data.toString(); });
        py2.stderr.on("data", (data) => { errorOutput2 += data.toString(); });

        py2.on("close", (code2) => {
          if (code2 === 0) {
            try {
              return res.json(JSON.parse(output2));
            } catch (e) {
              return returnFallback("JSON parse error on python fallback output", output2);
            }
          } else {
            return returnFallback(`Python execution failed (code3 ${code2})`, errorOutput2 || errorOutput);
          }
        });
      }
    });

    // High-fidelity TypeScript fallback simulator
    function returnFallback(reason: string, details: string) {
      console.warn(`Fallback triggered: ${reason}. Running high-fidelity TS mock.`);
      
      const lons = aoi.map((pt: any) => pt[0]);
      const lats = aoi.map((pt: any) => pt[1]);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      const gridSize = 10;
      const numPixels = gridSize * gridSize;
      const fieldTypes = ["Wheat", "Corn", "Soy", "Soil/Fallow"];
      const data: any[] = [];

      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const lon = minLon + (maxLon - minLon) * (i / (gridSize - 1));
          const lat = minLat + (maxLat - minLat) * (j / (gridSize - 1));
          const fieldIdx = i < 5 && j < 5 ? 0 : i >= 5 && j < 5 ? 1 : i < 5 && j >= 5 ? 2 : 3;
          const fieldType = fieldTypes[fieldIdx];
          const elevation = Number((150.0 + Math.sin(i * 0.5) * 12.0 + Math.cos(j * 0.5) * 8.0).toFixed(2));

          const row: any = {
            pixel_id: i * gridSize + j,
            longitude: lon,
            latitude: lat,
            elevation,
            field_type: fieldType
          };

          for (let t = 1; t <= numSteps; t++) {
            const suffix = `_t${t}`;
            let red = 0.15, green = 0.12, blue = 0.08, nir = 0.20, swir1 = 0.25, swir2 = 0.18;
            let vv = -12.0, vh = -18.0;

            if (fieldType === "Wheat") {
              if (t === 1) { red = 0.04; green = 0.08; blue = 0.03; nir = 0.45; swir1 = 0.15; swir2 = 0.08; vv = -9.0; vh = -15.0; }
              else if (t === 2) { red = 0.02; green = 0.09; blue = 0.02; nir = 0.62; swir1 = 0.11; swir2 = 0.05; vv = -7.5; vh = -13.0; }
              else { red = 0.15; green = 0.16; blue = 0.08; nir = 0.32; swir1 = 0.35; swir2 = 0.22; vv = -11.0; vh = -17.0; }
            } else if (fieldType === "Corn") {
              if (t === 1) { red = 0.08; green = 0.09; blue = 0.05; nir = 0.30; swir1 = 0.22; swir2 = 0.12; vv = -10.5; vh = -16.5; }
              else if (t === 2) { red = 0.03; green = 0.11; blue = 0.03; nir = 0.58; swir1 = 0.14; swir2 = 0.06; vv = -7.0; vh = -12.5; }
              else { red = 0.05; green = 0.08; blue = 0.04; nir = 0.48; swir1 = 0.18; swir2 = 0.09; vv = -8.5; vh = -14.0; }
            } else if (fieldType === "Soy") {
              if (t === 1) { red = 0.07; green = 0.08; blue = 0.04; nir = 0.32; swir1 = 0.20; swir2 = 0.11; vv = -10.0; vh = -16.0; }
              else if (t === 2) { red = 0.03; green = 0.10; blue = 0.02; nir = 0.65; swir1 = 0.10; swir2 = 0.04; vv = -6.5; vh = -12.0; }
              else { red = 0.09; green = 0.12; blue = 0.06; nir = 0.38; swir1 = 0.25; swir2 = 0.14; vv = -9.0; vh = -15.0; }
            }

            // Noise
            const noise = () => (Math.random() - 0.5) * 0.02;
            red = Math.max(0.01, red + noise());
            green = Math.max(0.01, green + noise());
            blue = Math.max(0.01, blue + noise());
            nir = Math.max(0.02, nir + noise());
            swir1 = Math.max(0.01, swir1 + noise());
            swir2 = Math.max(0.01, swir2 + noise());
            vv = vv + (Math.random() - 0.5) * 0.4;
            vh = vh + (Math.random() - 0.5) * 0.4;

            row[`B2${suffix}`] = Number(blue.toFixed(4));
            row[`B3${suffix}`] = Number(green.toFixed(4));
            row[`B4${suffix}`] = Number(red.toFixed(4));
            row[`B8${suffix}`] = Number(nir.toFixed(4));
            row[`B11${suffix}`] = Number(swir1.toFixed(4));
            row[`B12${suffix}`] = Number(swir2.toFixed(4));

            const ndvi = (nir - red) / (nir + red);
            const evi = 2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1);
            const ndwi = (green - nir) / (green + nir);
            const lswi = (nir - swir1) / (nir + swir1);
            const ndmi = (nir - swir1) / (nir + swir1);

            row[`NDVI${suffix}`] = Number(ndvi.toFixed(4));
            row[`EVI${suffix}`] = Number(evi.toFixed(4));
            row[`NDWI${suffix}`] = Number(ndwi.toFixed(4));
            row[`LSWI${suffix}`] = Number(lswi.toFixed(4));
            row[`NDMI${suffix}`] = Number(ndmi.toFixed(4));
            row[`VV${suffix}`] = Number(vv.toFixed(2));
            row[`VH${suffix}`] = Number(vh.toFixed(2));
          }
          data.push(row);
        }
      }

      // 3x3 Speckle filter for S1 (smooth neighbors)
      for (let t = 1; t <= numSteps; t++) {
        const suffix = `_t${t}`;
        for (let idx = 0; idx < numPixels; idx++) {
          const currRow = data[idx];
          const r = Math.floor(idx / gridSize);
          const c = idx % gridSize;
          let vvSum = 0, vhSum = 0, count = 0;

          for (const dr of [-1, 0, 1]) {
            for (const dc of [-1, 0, 1]) {
              const nr = r + dr;
              const nc = c + dc;
              if (nr >= 0 && nr < gridSize && nc >= 0 && nc < gridSize) {
                const nIdx = nr * gridSize + nc;
                const neighbor = data[nIdx];
                vvSum += neighbor[`VV${suffix}`];
                vhSum += neighbor[`VH${suffix}`];
                count++;
              }
            }
          }

          const vv_filtered = vvSum / count;
          const vh_filtered = vhSum / count;
          currRow[`VV_filtered${suffix}`] = Number(vv_filtered.toFixed(2));
          currRow[`VH_filtered${suffix}`] = Number(vh_filtered.toFixed(2));

          const vv_linear = Math.pow(10, vv_filtered / 10);
          const vh_linear = Math.pow(10, vh_filtered / 10);
          currRow[`VH_VV_ratio${suffix}`] = Number((vh_linear / vv_linear).toFixed(4));
        }
      }

      res.json({
        status: "success",
        mode: "simulated_gee_fallback",
        reason,
        details,
        aoi,
        date_range: [startDate, endDate],
        num_pixels: data.length,
        columns: Object.keys(data[0]),
        data
      });
    }
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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
