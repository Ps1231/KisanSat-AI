import fs from "fs";
import path from "path";

type AoiPoint = [number, number];

const CROP_COLORS: Record<string, string> = {
  Wheat: "#F59E0B",
  Rice: "#3B82F6",
  Cotton: "#8B5CF6",
  Fallow: "#92400E",
};

const STRESS_COLORS: Record<string, string> = {
  none: "#22C55E",
  moderate: "#EAB308",
  high: "#EF4444",
};

const IRRIGATION_COLORS: Record<string, string> = {
  OK: "#22C55E",
  Monitor: "#EAB308",
  "Irrigate Soon": "#F97316",
  Urgent: "#EF4444",
};

const KC_MAP: Record<string, number> = {
  Wheat: 1.15,
  Rice: 1.2,
  Cotton: 1.05,
  Fallow: 0.3,
};

function fieldBlockCrop(pixelId: number, gridSize = 10): string {
  const r = Math.floor(pixelId / gridSize);
  const c = pixelId % gridSize;
  if (r <= 4 && c <= 5) return "Wheat";
  if (r <= 4 && c > 5) return "Cotton";
  if (r > 4 && c <= 3) return "Rice";
  if (r > 7 && c > 3) return "Fallow";
  return "Wheat";
}

function computeStress(pixel: Record<string, number>, numSteps: number): string {
  const ndvis = Array.from({ length: numSteps }, (_, i) => pixel[`NDVI_t${i + 1}`] ?? 0);
  if (!ndvis.length) return "none";
  const mn = Math.min(...ndvis);
  const mx = Math.max(...ndvis);
  const cur = ndvis[ndvis.length - 1];
  const vci = mx !== mn ? (cur - mn) / (mx - mn) : 1;
  const sarDrop = (pixel.VH_t1 ?? 0) - (pixel[`VH_t${numSteps}`] ?? 0);
  if (vci < 0.35 || sarDrop > 2) return "high";
  if (vci < 0.55 || sarDrop > 1) return "moderate";
  return "none";
}

function computeIrrigation(pixel: Record<string, number>, stress: string, crop: string) {
  const kc = KC_MAP[crop] ?? 0.8;
  const etc = 3 * 8 * kc;
  const ndwi = pixel.NDWI_t2 ?? 0;
  const lswi = pixel.LSWI_t2 ?? 0;
  const rainProxy = Math.max(0, ndwi * 25 + lswi * 15);
  let deficit = Math.max(0, etc - rainProxy);
  if (stress === "high") deficit = Math.min(deficit * 1.25, etc);
  else if (stress === "moderate") deficit = Math.min(deficit * 1.1, etc);

  let advisory = "OK";
  if (deficit >= 30) advisory = "Urgent";
  else if (deficit >= 18) advisory = "Irrigate Soon";
  else if (deficit >= 8) advisory = "Monitor";

  return {
    advisory,
    deficit_mm: Number(deficit.toFixed(1)),
    etc_mm: Number(etc.toFixed(1)),
    rain_proxy_mm: Number(rainProxy.toFixed(1)),
    vci: 0.5,
    color: IRRIGATION_COLORS[advisory],
  };
}

function simulatePixels(aoi: AoiPoint[], numSteps: number) {
  const lons = aoi.map((pt) => pt[0]);
  const lats = aoi.map((pt) => pt[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const gridSize = 10;
  const data: Record<string, any>[] = [];

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const lon = minLon + ((maxLon - minLon) * i) / (gridSize - 1);
      const lat = minLat + ((maxLat - minLat) * j) / (gridSize - 1);
      const pixelId = i * gridSize + j;
      const crop = fieldBlockCrop(pixelId, gridSize);
      const row: Record<string, any> = {
        pixel_id: pixelId,
        longitude: lon,
        latitude: lat,
        crop_type: crop,
        crop_confidence: 0.82,
        crop_color: CROP_COLORS[crop],
      };

      for (let t = 1; t <= numSteps; t++) {
        const ndvi = crop === "Fallow" ? 0.18 + Math.random() * 0.08 : 0.35 + Math.random() * 0.35;
        const ndwi = crop === "Rice" ? 0.05 + Math.random() * 0.1 : -0.05 + Math.random() * 0.08;
        const lswi = ndwi * 0.6;
        const vv = -8 - Math.random() * 4;
        const vh = vv - 6 - Math.random() * 2;
        row[`NDVI_t${t}`] = Number(ndvi.toFixed(3));
        row[`NDWI_t${t}`] = Number(ndwi.toFixed(3));
        row[`LSWI_t${t}`] = Number(lswi.toFixed(3));
        row[`VV_t${t}`] = Number(vv.toFixed(2));
        row[`VH_t${t}`] = Number(vh.toFixed(2));
        row[`VH_VV_ratio_t${t}`] = Number((0.15 + Math.random() * 0.1).toFixed(4));
      }

      const stress = computeStress(row, numSteps);
      const irrigation = computeIrrigation(row, stress, crop);
      row.stress_level = stress;
      row.stress_color = STRESS_COLORS[stress];
      row.advisory = irrigation.advisory;
      row.deficit_mm = irrigation.deficit_mm;
      row.irr_color = irrigation.color;
      data.push(row);
    }
  }

  return data;
}

function pixelsToGeojson(
  pixels: Record<string, any>[],
  layer: "crop" | "stress" | "irrigation",
) {
  const half = 0.003 / 2;
  const features = pixels.map((p) => {
    const lat = p.latitude;
    const lon = p.longitude;
    let fillColor = p.crop_color;
    if (layer === "stress") fillColor = p.stress_color;
    if (layer === "irrigation") fillColor = p.irr_color;

    return {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [lon - half, lat - half],
          [lon + half, lat - half],
          [lon + half, lat + half],
          [lon - half, lat + half],
          [lon - half, lat - half],
        ]],
      },
      properties: {
        pixel_id: p.pixel_id,
        lat: Number(lat.toFixed(5)),
        lon: Number(lon.toFixed(5)),
        crop_type: p.crop_type,
        crop_confidence: p.crop_confidence,
        crop_color: p.crop_color,
        stress_level: p.stress_level,
        stress_color: p.stress_color,
        advisory: p.advisory,
        deficit_mm: p.deficit_mm,
        irr_color: p.irr_color,
        color: fillColor,
        NDVI_t2: p.NDVI_t2 ?? 0,
        NDWI_t2: p.NDWI_t2 ?? 0,
        LSWI_t2: p.LSWI_t2 ?? 0,
        VV_t2: p.VV_t2 ?? 0,
        VH_VV_ratio_t2: p.VH_VV_ratio_t2 ?? 0,
      },
    };
  });

  return {
    type: "FeatureCollection",
    features,
    metadata: {
      layer,
      total_pixels: features.length,
      crop_legend: CROP_COLORS,
      stress_legend: STRESS_COLORS,
      irrigation_legend: IRRIGATION_COLORS,
    },
  };
}

export function buildSimulatedMapResponse(input: {
  aoi: AoiPoint[];
  start_date?: string;
  end_date?: string;
  num_steps?: number;
}) {
  const numSteps = input.num_steps ?? 3;
  const pixels = simulatePixels(input.aoi, numSteps);

  const cropDist: Record<string, number> = {};
  const stressDist: Record<string, number> = {};
  const advDist: Record<string, number> = {};
  let ndviSum = 0;
  let deficitSum = 0;

  for (const p of pixels) {
    cropDist[p.crop_type] = (cropDist[p.crop_type] ?? 0) + 1;
    stressDist[p.stress_level] = (stressDist[p.stress_level] ?? 0) + 1;
    advDist[p.advisory] = (advDist[p.advisory] ?? 0) + 1;
    ndviSum += Number(p.NDVI_t2 ?? 0);
    deficitSum += Number(p.deficit_mm ?? 0);
  }

  const timeseries = pixels.slice(0, 20).map((p) => ({
    pixel_id: p.pixel_id,
    crop_type: p.crop_type,
    lat: p.latitude,
    lon: p.longitude,
    ndvi: Array.from({ length: numSteps }, (_, i) => p[`NDVI_t${i + 1}`] ?? 0),
    ndwi: Array.from({ length: numSteps }, (_, i) => p[`NDWI_t${i + 1}`] ?? 0),
    vv: Array.from({ length: numSteps }, (_, i) => p[`VV_t${i + 1}`] ?? 0),
    stress: p.stress_level,
    advisory: p.advisory,
  }));

  return {
    status: "ok",
    mode: "simulated_gee_ts",
    summary: {
      total_pixels: pixels.length,
      avg_ndvi: Number((ndviSum / pixels.length).toFixed(3)),
      avg_deficit_mm: Number((deficitSum / pixels.length).toFixed(1)),
      avg_confidence: 0.82,
      crop_distribution: cropDist,
      stress_distribution: stressDist,
      advisory_distribution: advDist,
    },
    layers: {
      crop: pixelsToGeojson(pixels, "crop"),
      stress: pixelsToGeojson(pixels, "stress"),
      irrigation: pixelsToGeojson(pixels, "irrigation"),
    },
    timeseries,
  };
}

export function resolvePythonBin(projectRoot: string): string {
  const venvPython = path.join(projectRoot, ".venv", "bin", "python");
  return fs.existsSync(venvPython) ? venvPython : "python3";
}
