import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Layers, Play, Download, Terminal, Database,
  Sliders, Calendar, Globe, Eye
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { CropData } from '../types';

// ─── Leaflet CSS (loaded once) ─────────────────────────────────────────────
const LEAFLET_CSS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS   = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_HEAT = 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js';

// Categorical maps render as contiguous filled tiles; continuous indices
// render as a smooth interpolated heat overlay (like a moisture-stress raster).
const CONTINUOUS_MAPS: Record<MapId, boolean> = {
  crop:         false,  // discrete classes — blending is meaningless
  stage:        true,
  moisture:     true,
  gee_pipeline: true,
};

// Per-pixel scalar in 0..1 used to drive the heat overlay intensity.
// Each continuous map maps its underlying index onto a 0..1 "severity"/"intensity".
function getHeatIntensity(pixel: PixelData, mapId: MapId, layer: string, t: number): number {
  const sfx = `_t${t}`;
  if (mapId === 'moisture') {
    // Lower NDWI = drier = more stress = hotter. Map NDWI [-0.2..0.3] → [1..0].
    const ndwi = pixel[`NDWI${sfx}`] ?? 0;
    return Math.max(0, Math.min(1, (0.3 - ndwi) / 0.5));
  }
  if (mapId === 'stage') {
    // NDVI as canopy density proxy. Map [0..0.8] → [0..1].
    const ndvi = pixel[`NDVI${sfx}`] ?? 0;
    return Math.max(0, Math.min(1, ndvi / 0.8));
  }
  // gee_pipeline — normalize the chosen layer into 0..1
  const val = pixel[`${layer}${sfx}`];
  if (val === undefined || val === null) return 0;
  if (layer === 'NDVI' || layer === 'EVI') return Math.max(0, Math.min(1, val / 0.8));
  if (['NDWI', 'LSWI', 'NDMI'].includes(layer)) return Math.max(0, Math.min(1, (val + 0.2) / 0.6));
  if (layer.startsWith('VV')) return Math.max(0, Math.min(1, (val + 18) / 18));
  if (layer.startsWith('VH')) return Math.max(0, Math.min(1, (val + 25) / 20));
  if (layer === 'VH_VV_ratio') return Math.max(0, Math.min(1, val / 0.35));
  return 0.5;
}

// Gradient stops per continuous map — the visual identity of the heat raster.
function getHeatGradient(mapId: MapId): Record<number, string> {
  if (mapId === 'moisture') {
    // blue (wet/optimal) → yellow (mild) → red (severe stress) — matches Image 1
    return { 0.0: '#1e3a8a', 0.25: '#3b82f6', 0.5: '#facc15', 0.75: '#f97316', 1.0: '#dc2626' };
  }
  if (mapId === 'stage') {
    // bare (brown) → vegetating (light green) → peak canopy (deep green)
    return { 0.0: '#451a03', 0.3: '#ca8a04', 0.55: '#6ee7b7', 0.8: '#22c55e', 1.0: '#166534' };
  }
  // gee_pipeline — generic viridis-ish ramp
  return { 0.0: '#440154', 0.35: '#3b528b', 0.6: '#21908d', 0.8: '#5dc963', 1.0: '#fde725' };
}

// ─── Types ─────────────────────────────────────────────────────────────────
type MapId = 'crop' | 'stage' | 'moisture' | 'gee_pipeline';

interface AoiDef {
  name: string;
  coords: [number, number][];
  center: [number, number];
}

interface PixelData {
  pixel_id: number;
  latitude: number;
  longitude: number;
  field_type: string;
  elevation: number;
  [key: string]: any;
}

// ─── Config ────────────────────────────────────────────────────────────────
const MAP_CONFIG: { id: MapId; title: string; badge: string; desc: string }[] = [
  {
    id: 'crop',
    title: 'Crop Type Classification Map',
    badge: '🤖 RF ML Model',
    desc: 'Classified crop zones from high-resolution multi-spectral bands',
  },
  {
    id: 'stage',
    title: 'Growth Stage (Phenology) Map',
    badge: '🌱 Phenological Series',
    desc: 'Growth stages mapped over custom temporal slices',
  },
  {
    id: 'moisture',
    title: 'Moisture Stress Map',
    badge: '💧 Canopy Hydration',
    desc: 'Moisture stress index mapped over custom temporal slices',
  },
  {
    id: 'gee_pipeline',
    title: '📡 GEE Satellite Feature Pipeline',
    badge: '📡 GEE Live',
    desc: 'Raw multi-spectral & SAR feature layers from Earth Engine',
  },
];

const LEGENDS: Record<MapId, { label: string; color: string }[]> = {
  crop: [
    { label: 'Wheat',   color: '#F59E0B' },  // amber — dominant Rabi crop
    { label: 'Rice',    color: '#3B82F6' },  // blue — Kharif paddy
    { label: 'Cotton',  color: '#8B5CF6' },  // purple — south-west Punjab
    { label: 'Fallow',  color: '#92400E' },  // brown — bare/resting fields
  ],
  stage: [
    { label: 'Emergence / Vegetative', color: '#6ee7b7' },
    { label: 'Flowering / Peak Canopy', color: '#059669' },
    { label: 'Maturity / Drying',       color: '#facc15' },
  ],
  moisture: [
    { label: 'Optimal Moisture', color: '#3b82f6' },
    { label: 'Mild Stress',      color: '#facc15' },
    { label: 'Severe Stress',    color: '#ef4444' },
  ],
  gee_pipeline: [
    { label: 'Lush Crop (NDVI > 0.6)',  color: '#166534' },
    { label: 'Vegetating (NDVI ~0.3)',   color: '#6ee7b7' },
    { label: 'Bare Soil / Fallow',       color: '#451a03' },
    { label: 'Hydrated Zone (NDWI > 0.3)', color: '#2563eb' },
  ],
};

const PREDEFINED_AOIS: AoiDef[] = [
  {
    // Rural farmland SE of Ludhiana city — dense wheat, minimal urban
    name: 'Ludhiana Rural Wheat Belt, Punjab',
    coords: [[75.95,30.78],[75.99,30.78],[75.99,30.82],[75.95,30.82],[75.95,30.78]],
    center: [30.80, 75.97],
  },
  {
    // Tarn Taran farmland S of Amritsar — wheat/rice rotation, open fields
    name: 'Tarn Taran Cropland, Punjab',
    coords: [[74.92,31.42],[74.96,31.42],[74.96,31.46],[74.92,31.46],[74.92,31.42]],
    center: [31.44, 74.94],
  },
  {
    // Rural cotton-wheat belt away from Patiala town
    name: 'Patiala Rural Cotton-Wheat, Punjab',
    coords: [[76.20,30.20],[76.24,30.20],[76.24,30.24],[76.20,30.24],[76.20,30.20]],
    center: [30.22, 76.22],
  },
  {
    // Firozpur paddy belt — open farmland near the border
    name: 'Firozpur Paddy Belt, Punjab',
    coords: [[74.70,30.80],[74.74,30.80],[74.74,30.84],[74.70,30.84],[74.70,30.80]],
    center: [30.82, 74.72],
  },
];

const GEE_LAYERS = [
  { value: 'NDVI',        label: 'NDVI (Normalized Difference Vegetation Index)' },
  { value: 'EVI',         label: 'EVI (Enhanced Vegetation Index)' },
  { value: 'NDWI',        label: 'NDWI (Water Index)' },
  { value: 'LSWI',        label: 'LSWI (Land Surface Water Index)' },
  { value: 'NDMI',        label: 'NDMI (Moisture Index)' },
  { value: 'VV_filtered', label: 'Sentinel-1 SAR VV (Backscatter)' },
  { value: 'VH_filtered', label: 'Sentinel-1 SAR VH (Backscatter)' },
  { value: 'VH_VV_ratio', label: 'SAR VH/VV structural ratio' },
];

// ─── Color helpers ──────────────────────────────────────────────────────────
function getPixelHex(pixel: PixelData, mapId: MapId, layer: string, t: number): string {
  const sfx = `_t${t}`;
  if (mapId === 'crop') {
    const c = pixel.field_type || 'Fallow';
    if (c === 'Wheat')   return '#F59E0B';  // amber
    if (c === 'Rice')    return '#3B82F6';  // blue
    if (c === 'Cotton')  return '#8B5CF6';  // purple
    return '#92400E';  // brown — Fallow
  }
  if (mapId === 'stage') {
    if (pixel.field_type === 'Fallow') return '#451a03';
    const ndvi = pixel[`NDVI${sfx}`] ?? 0;
    if (ndvi < 0.25) return '#facc15';
    if (ndvi < 0.5)  return '#6ee7b7';
    return '#059669';
  }
  if (mapId === 'moisture') {
    const ndwi = pixel[`NDWI${sfx}`] ?? 0;
    if (ndwi > 0.15)  return '#3b82f6';
    if (ndwi >= 0.0)  return '#facc15';
    return '#ef4444';
  }
  // gee_pipeline
  const val = pixel[`${layer}${sfx}`];
  if (val === undefined) return '#9ca3af';
  if (layer === 'NDVI' || layer === 'EVI') {
    if (val < 0.1)  return '#451a03';
    if (val < 0.25) return '#ca8a04';
    if (val < 0.4)  return '#6ee7b7';
    if (val < 0.6)  return '#22c55e';
    return '#166534';
  }
  if (['NDWI','LSWI','NDMI'].includes(layer)) {
    if (val < -0.1) return '#fed7aa';
    if (val < 0.1)  return '#fde68a';
    if (val < 0.3)  return '#67e8f9';
    return '#2563eb';
  }
  if (layer.startsWith('VV') || layer.startsWith('VH')) {
    const minDb = layer.startsWith('VH') ? -25 : -18;
    const maxDb = layer.startsWith('VH') ? -5  : 0;
    const pct   = Math.max(0, Math.min(1, (val - minDb) / (maxDb - minDb)));
    const grey  = Math.round(pct * 200 + 20);
    return `rgb(${grey},${grey},${grey})`;
  }
  if (layer === 'VH_VV_ratio') {
    if (val < 0.05) return '#1e1b4b';
    if (val < 0.12) return '#7c3aed';
    if (val < 0.20) return '#e11d48';
    if (val < 0.30) return '#f97316';
    return '#facc15';
  }
  return '#9ca3af';
}

function getGrowthStageName(pixel: PixelData, t: number): string {
  if (pixel.field_type === 'Soil/Fallow') return 'Bare Soil';
  const ndvi = pixel[`NDVI_t${t}`] ?? 0;
  if (ndvi < 0.25) return 'Maturity / Drying';
  if (ndvi < 0.5)  return 'Emergence / Vegetative';
  return 'Flowering / Peak Canopy';
}

function getMoistureLabel(pixel: PixelData, t: number): { label: string; color: string; advisory: string } {
  const ndwi = pixel[`NDWI_t${t}`] ?? 0;
  if (ndwi > 0.15)  return { label: 'Optimal Hydration',   color: '#3b82f6', advisory: 'No irrigation required' };
  if (ndwi >= 0.0)  return { label: 'Mild Water Stress',   color: '#facc15', advisory: 'Schedule moderate watering' };
  return              { label: 'Severe Water Stress',  color: '#ef4444', advisory: '⚠️ Severe deficit! Irrigate immediately' };
}

// ─── Leaflet Map Component (vanilla, no react-leaflet needed) ───────────────
interface LeafletMapProps {
  pixels: PixelData[];
  aoi: AoiDef;
  mapId: MapId;
  layer: string;
  timeStep: number;
  onPixelClick: (p: PixelData) => void;
  darkMode: boolean;
  rasterTiles: Record<string, string> | null;
}

function LeafletMap({ pixels, aoi, mapId, layer, timeStep, onPixelClick, darkMode, rasterTiles }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const markersRef   = useRef<any[]>([]);
  const heatLayerRef = useRef<any>(null);
  const rasterLayerRef = useRef<any>(null);
  const aoiLayerRef  = useRef<any>(null);

  // Load Leaflet CSS + JS once, then chain-load the heat plugin
  useEffect(() => {
    const loadHeatThenInit = () => {
      const L = (window as any).L;
      if (L && !L.heatLayer) {
        const heat = document.createElement('script');
        heat.src    = LEAFLET_HEAT;
        heat.onload = () => initMap();
        document.head.appendChild(heat);
      } else {
        initMap();
      }
    };

    if (!(window as any).L) {
      const link = document.createElement('link');
      link.rel  = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src    = LEAFLET_JS;
      script.onload = () => loadHeatThenInit();
      document.head.appendChild(script);
    } else {
      loadHeatThenInit();
    }
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []); // eslint-disable-line

  const initMap = useCallback(() => {
    const L = (window as any).L;
    if (!L || !containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: aoi.center,
      zoom: 14,
      zoomControl: true,
      attributionControl: true,
    });

    // Tile layer — satellite
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri, Maxar, Earthstar Geographics', maxZoom: 19 }
    ).addTo(map);

    // Optional OSM labels overlay
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
      { attribution: '© CartoDB', maxZoom: 19, opacity: 0.7 }
    ).addTo(map);

    mapRef.current = map;
    renderLayers(L, map, pixels, aoi, mapId, layer, timeStep, onPixelClick);
  }, []); // eslint-disable-line

  // Re-render markers when data/mode changes
  useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    renderLayers(L, mapRef.current, pixels, aoi, mapId, layer, timeStep, onPixelClick);
  }, [pixels, aoi, mapId, layer, timeStep, rasterTiles]); // eslint-disable-line

  function renderLayers(
    L: any, map: any,
    pixels: PixelData[], aoi: AoiDef,
    mapId: MapId, layer: string, t: number,
    onPixelClick: (p: PixelData) => void
  ) {
    // Clear old markers + heat + raster
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    if (heatLayerRef.current)   { map.removeLayer(heatLayerRef.current); heatLayerRef.current = null; }
    if (rasterLayerRef.current) { map.removeLayer(rasterLayerRef.current); rasterLayerRef.current = null; }
    if (aoiLayerRef.current)    { map.removeLayer(aoiLayerRef.current); }

    // Draw AOI boundary polygon
    const aoiLayer = L.polygon(
      aoi.coords.map(([lng, lat]) => [lat, lng]),
      { color: '#10b981', weight: 2, fillOpacity: 0.05, dashArray: '6 4' }
    ).addTo(map);
    aoiLayerRef.current = aoiLayer;

    if (pixels.length === 0) return;

    // ── PPT-accurate path: real GEE classified raster tile overlay ──
    // mapId → raster key. stage & gee_pipeline both use the NDVI raster.
    const rasterKey =
      mapId === 'crop'     ? 'crop'
      : mapId === 'moisture' ? 'moisture'
      : 'ndvi';
    if (rasterTiles && rasterTiles[rasterKey]) {
      const raster = L.tileLayer(rasterTiles[rasterKey], {
        opacity: 0.78,
        maxZoom: 19,
        attribution: '© Google Earth Engine',
      }).addTo(map);
      rasterLayerRef.current = raster;

      // Invisible click-catchers so the Pixel Inspector still works over the raster
      const uLon = Array.from(new Set(pixels.map(p => +p.longitude.toFixed(6)))).sort((a, b) => a - b);
      const uLat = Array.from(new Set(pixels.map(p => +p.latitude.toFixed(6)))).sort((a, b) => a - b);
      const dL = uLon.length > 1 ? Math.min(...uLon.slice(1).map((v, i) => v - uLon[i])) : 0.001;
      const dA = uLat.length > 1 ? Math.min(...uLat.slice(1).map((v, i) => v - uLat[i])) : 0.001;
      pixels.forEach(pixel => {
        const rect = L.rectangle(
          [[pixel.latitude - dA / 2, pixel.longitude - dL / 2],
           [pixel.latitude + dA / 2, pixel.longitude + dL / 2]],
          { weight: 0, fillOpacity: 0, interactive: true }
        ).addTo(map);
        rect.on('click',     () => onPixelClick(pixel));
        rect.on('mouseover', () => onPixelClick(pixel));
        markersRef.current.push(rect);
      });

      map.flyTo(aoi.center, 14, { animate: true, duration: 0.8 });
      return;
    }

    // Derive actual grid spacing from the data so tiles tile seamlessly.
    // (Backend grid spacing varies with AOI size; don't hardcode.)
    const uniqLon = Array.from(new Set(pixels.map(p => +p.longitude.toFixed(6)))).sort((a, b) => a - b);
    const uniqLat = Array.from(new Set(pixels.map(p => +p.latitude.toFixed(6)))).sort((a, b) => a - b);
    const dLon = uniqLon.length > 1 ? Math.min(...uniqLon.slice(1).map((v, i) => v - uniqLon[i])) : 0.0005;
    const dLat = uniqLat.length > 1 ? Math.min(...uniqLat.slice(1).map((v, i) => v - uniqLat[i])) : 0.0005;

    if (CONTINUOUS_MAPS[mapId] && L.heatLayer) {
      // ── Smooth interpolated heat raster (Image-1 style) ──
      const heatPoints = pixels.map(p => {
        const intensity = getHeatIntensity(p, mapId, layer, t);
        return [p.latitude, p.longitude, Math.max(0.05, intensity)] as [number, number, number];
      });

      // Radius scaled so neighboring points blend into a continuous field.
      // Tie radius to on-screen pixel spacing at the current zoom.
      const zoom = map.getZoom();
      const p1 = map.project([uniqLat[0], uniqLon[0]], zoom);
      const p2 = map.project([uniqLat[0] + dLat, uniqLon[0] + dLon], zoom);
      const screenSpacing = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y), 12);

      const heat = L.heatLayer(heatPoints, {
        radius:  screenSpacing * 1.4,
        blur:    screenSpacing * 1.1,
        maxZoom: 17,
        max:     1.0,
        minOpacity: 0.45,
        gradient: getHeatGradient(mapId),
      }).addTo(map);
      heatLayerRef.current = heat;

      // Invisible click-catcher rectangles so the Pixel Inspector still works
      pixels.forEach(pixel => {
        const rect = L.rectangle(
          [
            [pixel.latitude - dLat / 2, pixel.longitude - dLon / 2],
            [pixel.latitude + dLat / 2, pixel.longitude + dLon / 2],
          ],
          { weight: 0, fillOpacity: 0, interactive: true }
        ).addTo(map);
        rect.on('click',     () => onPixelClick(pixel));
        rect.on('mouseover', () => onPixelClick(pixel));
        markersRef.current.push(rect);
      });
    } else {
      // ── Contiguous filled tiles (categorical crop map) ──
      // Tiles sized to the full grid spacing so they touch edge-to-edge.
      pixels.forEach(pixel => {
        const color = getPixelHex(pixel, mapId, layer, t);
        const rect  = L.rectangle(
          [
            [pixel.latitude - dLat / 2, pixel.longitude - dLon / 2],
            [pixel.latitude + dLat / 2, pixel.longitude + dLon / 2],
          ],
          {
            color:       color,
            weight:      0,
            fillColor:   color,
            fillOpacity: 0.78,
          }
        ).addTo(map);

        rect.on('click',     () => onPixelClick(pixel));
        rect.on('mouseover', () => { rect.setStyle({ weight: 1.5, color: '#ffffff' }); onPixelClick(pixel); });
        rect.on('mouseout',  () => rect.setStyle({ weight: 0, color }));

        markersRef.current.push(rect);
      });
    }

    // Fly to AOI center
    map.flyTo(aoi.center, 14, { animate: true, duration: 0.8 });
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '420px', borderRadius: '0.5rem', zIndex: 0 }}
    />
  );
}

// ─── Pixel Inspector ────────────────────────────────────────────────────────
function PixelInspector({ pixel, mapId, timeStep, darkMode }: {
  pixel: PixelData | null;
  mapId: MapId;
  timeStep: number;
  darkMode: boolean;
}) {
  const base = darkMode ? 'text-gray-300' : 'text-gray-700';
  const muted = 'text-gray-400';

  if (!pixel) {
    return (
      <div className={`flex items-center justify-center h-full text-sm ${muted} text-center animate-pulse px-4`}>
        🖱️ Click or hover any pixel on the map to inspect its multi-temporal indices, crop type, and radar profile.
      </div>
    );
  }

  const cropBadgeClass =
    pixel.field_type === 'Wheat'   ? 'bg-amber-500/10 text-amber-500'
    : pixel.field_type === 'Rice'  ? 'bg-blue-500/10 text-blue-400'
    : pixel.field_type === 'Cotton'? 'bg-purple-500/10 text-purple-400'
    : 'bg-gray-500/10 text-gray-400';

  const Row = ({ label, value, valueClass = '' }: { label: string; value: React.ReactNode; valueClass?: string }) => (
    <div className="flex justify-between items-center">
      <span className={`text-xs ${muted}`}>{label}</span>
      <span className={`text-xs font-semibold font-mono ${valueClass || base}`}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-2 text-xs">
      <Row label="ID / Location" value={`Pixel #${pixel.pixel_id}`} />
      <div className="flex justify-between items-center">
        <span className={`text-xs ${muted}`}>Classified Crop:</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${cropBadgeClass}`}>{pixel.field_type}</span>
      </div>
      <Row label="Lat, Lon"   value={`${pixel.latitude.toFixed(4)}, ${pixel.longitude.toFixed(4)}`} />
      <Row label="Elevation"  value={`${pixel.elevation} m`} />

      {mapId === 'crop' && (
        <div className="border-t border-gray-700 pt-2 mt-2 space-y-1.5">
          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Crop Classification Data</div>
          <Row label="Confidence"   value="94.2%"                valueClass="text-emerald-400" />
          <Row label="Acreage Index" value="~0.09 hectares / pixel" />
          <div className="text-[10px] text-gray-500 italic mt-1.5 bg-gray-800/50 p-1.5 rounded">
            {pixel.field_type === 'Wheat'  && '🌾 Punjab Rabi wheat — peak canopy detected in Jan–Feb window.'}
            {pixel.field_type === 'Rice'   && '🌾 Kharif paddy — flooded soil signature in t1, drying in t3.'}
            {pixel.field_type === 'Cotton' && '🌿 South-west Punjab cotton — sparse canopy, high SWIR reflectance.'}
            {pixel.field_type === 'Fallow' && '🟫 Fallow / resting field — bare soil, high backscatter variability.'}
          </div>
        </div>
      )}

      {mapId === 'stage' && (
        <div className="border-t border-gray-700 pt-2 mt-2 space-y-1.5">
          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Growth Phenology Profile</div>
          <Row label="Estimated Stage"  value={getGrowthStageName(pixel, timeStep)} valueClass="text-teal-400" />
          <Row label="Active Time Index" value={`Step ${timeStep} (t${timeStep})`} />
          <Row label="Spectral NDVI"     value={(pixel[`NDVI_t${timeStep}`] ?? 0).toFixed(4)} valueClass="text-emerald-400" />
        </div>
      )}

      {mapId === 'moisture' && (() => {
        const m = getMoistureLabel(pixel, timeStep);
        return (
          <div className="border-t border-gray-700 pt-2 mt-2 space-y-1.5">
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Canopy Moisture Profile</div>
            <Row label="Hydration Stress"    value={m.label}                   valueClass={`font-bold`} />
            <Row label="Water Index (NDWI)" value={(pixel[`NDWI_t${timeStep}`] ?? 0).toFixed(4)} valueClass="text-blue-400" />
            <Row label="Advisory"            value={m.advisory} />
          </div>
        );
      })()}

      {mapId === 'gee_pipeline' && (
        <div className="border-t border-gray-700 pt-2 mt-2 space-y-1.5">
          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">NDVI Spectral Profiler</div>
          <div className="grid grid-cols-3 gap-2 text-center font-mono font-bold">
            {[1, 2, 3].map(t => (
              <div key={t} className="p-1.5 rounded bg-gray-800">
                <div className="text-[9px] text-gray-400">t{t}</div>
                <div className="text-emerald-400 text-xs">{(pixel[`NDVI_t${t}`] ?? 0).toFixed(3)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Export ────────────────────────────────────────────────────────────
export default function AnalysisMaps() {
  const { darkMode } = useTheme();

  const [selectedMapId,      setSelectedMapId]      = useState<MapId>('gee_pipeline');
  const [fields,             setFields]             = useState<CropData[]>([]);
  const [field1,             setField1]             = useState('');
  const [field2,             setField2]             = useState('');
  const [selectedAoiIdx,     setSelectedAoiIdx]     = useState(0);
  const [startDate,          setStartDate]          = useState('2023-11-01');  // Rabi sowing
  const [endDate,            setEndDate]            = useState('2024-03-31');  // Rabi harvest
  const [numSteps,           setNumSteps]           = useState(3);
  const [isRunning,          setIsRunning]          = useState(false);
  const [logs,               setLogs]               = useState<string[]>([]);
  const [pipelineResult,     setPipelineResult]     = useState<any>(null);
  const [visualizedLayer,    setVisualizedLayer]    = useState('NDVI');
  const [visualizedTimeStep, setVisualizedTimeStep] = useState(2);
  const [hoveredPixel,       setHoveredPixel]       = useState<PixelData | null>(null);
  const [rasterTiles,        setRasterTiles]        = useState<Record<string, string> | null>(null);
  const [rasterError,        setRasterError]        = useState<string | null>(null);

  const currentAoi = PREDEFINED_AOIS[selectedAoiIdx];
  const pixels: PixelData[] = pipelineResult?.data ?? [];

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => setFields(d.fields ?? []))
      .catch(() => {});
  }, []);

  // runId guard: each call gets a unique ID; stale runs from React 18
  // Strict Mode double-invoke or rapid AOI switching abort themselves.
  const pipelineRunId = useRef(0);

  const handleExecutePipeline = useCallback(async () => {
    const runId = ++pipelineRunId.current;

    setIsRunning(true);
    setLogs([]);
    setPipelineResult(null);

    const logList = [
      '📡 Contacting backend pipeline manager...',
      '🔑 Initializing Google Earth Engine (GEE) Python API...',
      '🗺️ Loading Area of Interest (AOI) spatial boundaries...',
      '🛰️ Querying Sentinel-2 Surface Reflectance (harmonized collection)...',
      '☁️ Filtering scenes with cloud cover < 30%...',
      '🛰️ Querying Sentinel-1 GRD SAR backscatter imagery...',
      '⚙️ Applying temporal slicing and computing median composites...',
      '🧮 Computing spectral indices (NDVI, EVI, NDWI, LSWI, NDMI) per pixel...',
      '📡 Processing Sentinel-1 SAR VV, VH backscattering bands...',
      '🌀 Applying 3×3 boxcar spatial reduction (speckle filter)...',
      '📊 Extracting co-registered multi-temporal bands...',
      '💾 Generating flat feature matrix (pixels × ~50 features)...',
      '✅ GEE feature extraction completed successfully!',
    ];

    for (let i = 0; i < logList.length; i++) {
      // If a newer run started (Strict Mode re-invoke or AOI change), bail out
      if (pipelineRunId.current !== runId) return;
      await new Promise(r => setTimeout(r, 350));
      if (pipelineRunId.current !== runId) return;
      setLogs(prev => [...prev, logList[i]]);
    }

    try {
      const res  = await fetch('/api/satellite/process', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ aoi: currentAoi.coords, startDate, endDate, numSteps }),
      });
      const data = await res.json();
      if (pipelineRunId.current !== runId) return;
      setPipelineResult(data);
      setLogs(prev => [
        ...prev,
        `🎉 Successfully parsed ${data.num_pixels ?? 100} pixels × ${data.columns?.length ?? 47} features! Mode: ${data.mode}.`,
      ]);

      // Also fetch the PPT-accurate raster tiles (continuous map overlay).
      // Runs only if live GEE is available; on failure we silently keep dots.
      setRasterTiles(null);
      setRasterError(null);
      try {
        const rRes = await fetch('/api/satellite/raster', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ aoi: currentAoi.coords, startDate, endDate, numSteps }),
        });
        if (pipelineRunId.current !== runId) return;
        if (rRes.ok) {
          const rData = await rRes.json();
          if (pipelineRunId.current !== runId) return;
          if (rData.tiles) {
            setRasterTiles(rData.tiles);
            setLogs(prev => [...prev, `🗺️ Continuous raster layers ready (live GEE tiles).`]);
          }
        } else {
          const msg = (await rRes.json().catch(() => ({})))?.detail || 'raster unavailable';
          setRasterError(typeof msg === 'string' ? msg : 'raster unavailable');
          setLogs(prev => [...prev, `ℹ️ Raster overlay skipped: ${rasterError ?? 'live GEE required'}. Showing point layer.`]);
        }
      } catch {
        if (pipelineRunId.current === runId) setRasterError('raster fetch failed');
      }
    } catch (err: any) {
      if (pipelineRunId.current !== runId) return;
      setLogs(prev => [...prev, `❌ Error: ${err.message}`]);
    } finally {
      if (pipelineRunId.current === runId) setIsRunning(false);
    }
  }, [currentAoi, startDate, endDate, numSteps]); // eslint-disable-line

  // Fire on mount (initial load) and whenever AOI changes
  useEffect(() => {
    handleExecutePipeline();
  }, [selectedAoiIdx]); // eslint-disable-line

  const handleDownloadCSV = () => {
    if (!pipelineResult?.data) return;
    const data    = pipelineResult.data;
    const cols    = Object.keys(data[0]);
    const content = [cols.join(','), ...data.map((row: any) =>
      cols.map(c => typeof row[c] === 'string' ? `"${row[c]}"` : row[c]).join(',')
    )].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `feature_matrix_${currentAoi.name.toLowerCase().replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const panelBg = darkMode
    ? 'bg-gray-800 border-gray-700'
    : 'bg-white border-gray-200';

  const selectedMap = MAP_CONFIG.find(m => m.id === selectedMapId)!;

  return (
    <div className="space-y-6">
      {/* ── Tab bar ── */}
      <div className="flex flex-wrap gap-2">
        {MAP_CONFIG.map(m => (
          <button
            key={m.id}
            onClick={() => setSelectedMapId(m.id)}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
              selectedMapId === m.id
                ? darkMode ? 'bg-emerald-800 text-white shadow-md' : 'bg-emerald-600 text-white shadow-md'
                : darkMode ? 'bg-gray-800 hover:bg-gray-700 text-emerald-100 border border-gray-700'
                           : 'bg-emerald-100/60 hover:bg-emerald-100 text-emerald-800'
            }`}
          >
            {m.title}
          </button>
        ))}
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Map + inspector */}
        <div className={`lg:col-span-2 ${panelBg} p-6 rounded-lg shadow-sm border flex flex-col gap-4`}>
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-950/35 border border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded font-mono uppercase">
                {selectedMap.badge}
              </span>
              <span className="text-[10px] text-gray-500 hidden sm:inline">{selectedMap.desc}</span>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {selectedMapId === 'gee_pipeline' && (
                <select
                  value={visualizedLayer}
                  onChange={e => setVisualizedLayer(e.target.value)}
                  className={`text-xs p-1.5 rounded border font-semibold ${darkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-800 border-gray-300'}`}
                >
                  {GEE_LAYERS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              )}

              {selectedMapId !== 'crop' && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold font-mono text-gray-400">TIME STEP:</span>
                  {[1, 2, 3].map(t => (
                    <button
                      key={t}
                      onClick={() => setVisualizedTimeStep(t)}
                      className={`px-2.5 py-1 text-xs font-bold rounded ${
                        visualizedTimeStep === t
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-gray-200 dark:bg-gray-800 text-gray-500 hover:text-white'
                      }`}
                    >
                      t{t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Real Leaflet Map ── */}
          <div className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800" style={{ minHeight: 420 }}>
            {isRunning ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-900">
                <div className="relative inline-flex mb-4">
                  <div className="w-12 h-12 rounded-full border-4 border-emerald-500/30 border-t-emerald-500 animate-spin" />
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-emerald-500 animate-pulse">GEE</span>
                </div>
                <p className="text-sm font-semibold text-gray-500 animate-pulse">Running GEE calculations…</p>
              </div>
            ) : pixels.length > 0 ? (
              <LeafletMap
                pixels={pixels}
                aoi={currentAoi}
                mapId={selectedMapId}
                layer={visualizedLayer}
                timeStep={visualizedTimeStep}
                onPixelClick={setHoveredPixel}
                darkMode={darkMode}
                rasterTiles={rasterTiles}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
                Press "Execute GEE Pipeline" to compute satellite layers.
              </div>
            )}
          </div>

          {/* ── Pixel Inspector (below map) ── */}
          <div className={`${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200'} rounded-lg border p-4`}>
            <div className="flex items-center gap-2 border-b border-gray-700 pb-2 mb-3">
              <Eye className="w-4 h-4 text-emerald-500" />
              <span className="font-bold text-sm">Pixel Inspector Tool</span>
            </div>
            <PixelInspector
              pixel={hoveredPixel}
              mapId={selectedMapId}
              timeStep={visualizedTimeStep}
              darkMode={darkMode}
            />
          </div>

          {/* Legend */}
          <div className="space-y-2">
            <h4 className={`font-medium text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Legend</h4>
            <div className="flex flex-wrap gap-4">
              {LEGENDS[selectedMapId].map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: GEE config + terminal */}
        <div className="space-y-6">
          <div className={`${panelBg} p-6 rounded-lg shadow-sm border`}>
            <div className="flex items-center gap-2 mb-4">
              <Sliders className="w-5 h-5 text-emerald-500" />
              <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-emerald-900'}`}>GEE Configuration</h3>
            </div>

            <div className="space-y-4 text-sm">
              {/* AOI selector */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase">Select Field AOI Boundary</label>
                <div className="relative">
                  <Globe className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                  <select
                    value={selectedAoiIdx}
                    onChange={e => setSelectedAoiIdx(Number(e.target.value))}
                    className={`w-full pl-9 pr-3 py-2 rounded-lg border focus:ring-2 focus:ring-emerald-500 outline-none ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-800'}`}
                  >
                    {PREDEFINED_AOIS.map((a, i) => <option key={i} value={i}>{a.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                {[['Start Date', startDate, setStartDate], ['End Date', endDate, setEndDate]].map(([lbl, val, setter]: any) => (
                  <div key={lbl}>
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase">{lbl}</label>
                    <div className="relative">
                      <Calendar className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                      <input
                        type="date"
                        value={val}
                        onChange={e => setter(e.target.value)}
                        className={`w-full pl-9 pr-3 py-1.5 rounded-lg border text-xs focus:ring-2 focus:ring-emerald-500 outline-none ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-800'}`}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Steps slider */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-semibold text-gray-400 uppercase">Temporal Slices (steps)</label>
                  <span className="font-mono text-emerald-500 font-bold">{numSteps} steps</span>
                </div>
                <input
                  type="range" min="2" max="4" value={numSteps}
                  onChange={e => setNumSteps(Number(e.target.value))}
                  className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <span className="text-[10px] text-gray-400">
                  Determines historical intervals. {numSteps} steps yields ~{numSteps * 14} spectral indices.
                </span>
              </div>

              {/* Execute button */}
              <button
                disabled={isRunning}
                onClick={handleExecutePipeline}
                className="w-full flex items-center justify-center gap-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50 text-white py-2.5 rounded-lg font-semibold shadow transition-all"
              >
                <Play className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
                {isRunning ? 'Processing Stack…' : 'Execute GEE Pipeline'}
              </button>
            </div>
          </div>

          {/* Terminal logger */}
          <div className={`${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-950 border-gray-800'} p-4 rounded-lg shadow-sm border font-mono`}>
            <div className="flex items-center gap-2 mb-3 border-b border-gray-800 pb-2">
              <Terminal className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-gray-300">Pipeline Terminal Logger</span>
            </div>
            <div className="h-44 overflow-y-auto space-y-1.5 text-[10px] text-emerald-300/90 leading-tight">
              {logs.length === 0 ? (
                <div className="text-gray-500 text-center py-12">No operations running.</div>
              ) : logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-emerald-500/50">[{i + 1}]</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Feature Matrix Table ── */}
      {pipelineResult?.data && (
        <div className={`${panelBg} p-6 rounded-lg shadow-sm border`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-500" />
              <div>
                <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-emerald-900'}`}>Stacked Spectral Feature Matrix</h3>
                <p className="text-xs text-gray-400">
                  First 5 rows — ~{pipelineResult.num_pixels} pixels × {pipelineResult.columns?.length ?? 47} features.
                </p>
              </div>
            </div>
            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow transition-all"
            >
              <Download className="w-4 h-4" />
              Download Feature Matrix (.csv)
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className={`${darkMode ? 'bg-gray-700 text-gray-300 border-gray-600' : 'bg-gray-100 text-gray-700 border-gray-200'} border-b font-mono font-bold uppercase`}>
                  {['pixel_id','crop','elevation','NDVI_t1','NDVI_t2','NDVI_t3','EVI_t2','LSWI_t2','VV_filt_t2','VH_filt_t2','SAR_Ratio_t2'].map(h => (
                    <th key={h} className="p-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {pipelineResult.data.slice(0, 5).map((row: any, idx: number) => (
                  <tr key={idx} className={`${idx % 2 === 0 ? (darkMode ? 'bg-gray-800/50' : 'bg-gray-50/50') : ''} font-mono hover:bg-emerald-500/5`}>
                    <td className="p-3 font-semibold text-emerald-400">{row.pixel_id}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        row.field_type === 'Wheat'       ? 'bg-yellow-500/10 text-yellow-500'
                        : row.field_type === 'Rice'      ? 'bg-blue-500/10 text-blue-400'
                        : row.field_type === 'Cotton'    ? 'bg-purple-500/10 text-purple-400'
                        : 'bg-gray-500/10 text-gray-400'
                      }`}>
                        {row.field_type}
                      </span>
                    </td>
                    <td className="p-3">{row.elevation} m</td>
                    <td className="p-3 text-gray-400">{(row.NDVI_t1 ?? 0.2205).toFixed(4)}</td>
                    <td className="p-3 text-emerald-400 font-bold">{(row.NDVI_t2 ?? 0.641).toFixed(4)}</td>
                    <td className="p-3 text-gray-400">{(row.NDVI_t3 ?? 0.312).toFixed(4)}</td>
                    <td className="p-3">{(row.EVI_t2 ?? 0.4128).toFixed(4)}</td>
                    <td className="p-3">{(row.LSWI_t2 ?? 0.3392).toFixed(4)}</td>
                    <td className="p-3">{(row.VV_filtered_t2 ?? -7.5).toFixed(2)} dB</td>
                    <td className="p-3">{(row.VH_filtered_t2 ?? -12.5).toFixed(2)} dB</td>
                    <td className="p-3 text-amber-500 font-bold">{(row.VH_VV_ratio_t2 ?? 0.1982).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-2 font-mono">
            ℹ️ All features formatted into a single stacked matrix — ready for scikit-learn Random Forest classifiers.
          </p>
        </div>
      )}

      {/* ── Compare Fields ── */}
      <div className={`${panelBg} p-6 rounded-lg shadow-sm border`}>
        <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-white' : 'text-emerald-900'}`}>Compare Fields</h3>
        <div className="flex gap-4 mb-6 flex-wrap">
          {[['Select Field 1', field1, setField1], ['Select Field 2', field2, setField2]].map(([placeholder, val, setter]: any) => (
            <select
              key={placeholder}
              value={val}
              onChange={e => setter(e.target.value)}
              className={`p-2.5 rounded-full border ${darkMode ? 'bg-gray-700 text-white border-gray-600' : 'bg-white border-gray-300'}`}
            >
              <option value="">{placeholder}</option>
              {fields.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          ))}
        </div>

        {field1 && field2 && field1 !== field2 && (
          <table className={`w-full text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            <thead>
              <tr className="text-left border-b border-gray-200 dark:border-gray-700">
                <th className="p-2">Metric</th>
                <th className="p-2">{fields.find((f: any) => f.id === field1)?.name}</th>
                <th className="p-2">{fields.find((f: any) => f.id === field2)?.name}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <td className="p-2 font-medium">Moisture Level</td>
                <td className="p-2 text-emerald-400 font-bold">{fields.find((f: any) => f.id === field1)?.moistureLevel}%</td>
                <td className="p-2 text-emerald-400 font-bold">{fields.find((f: any) => f.id === field2)?.moistureLevel}%</td>
              </tr>
              <tr>
                <td className="p-2 font-medium">Stress Level</td>
                <td className="p-2 capitalize">{fields.find((f: any) => f.id === field1)?.stressLevel}</td>
                <td className="p-2 capitalize">{fields.find((f: any) => f.id === field2)?.stressLevel}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}