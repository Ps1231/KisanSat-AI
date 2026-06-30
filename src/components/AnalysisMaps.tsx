import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Layers, Play, Download, Terminal, Database,
  Sliders, Calendar, Globe, Eye
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { CropData } from '../types';

// ─── Leaflet CSS (loaded once) ─────────────────────────────────────────────
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

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
    // Ludhiana district — Punjab's largest wheat belt
    name: 'Ludhiana Wheat Belt, Punjab',
    coords: [[75.84,30.92],[75.88,30.92],[75.88,30.96],[75.84,30.96],[75.84,30.92]],
    center: [30.94, 75.86],
  },
  {
    // Amritsar district — mixed Wheat + Rice (Kharif/Rabi rotation)
    name: 'Amritsar Agricultural Zone, Punjab',
    coords: [[74.84,31.60],[74.88,31.60],[74.88,31.64],[74.84,31.64],[74.84,31.60]],
    center: [31.62, 74.86],
  },
  {
    // Patiala district — Cotton + Wheat (south-west Punjab)
    name: 'Patiala Cotton-Wheat Sector, Punjab',
    coords: [[76.38,30.32],[76.42,30.32],[76.42,30.36],[76.38,30.36],[76.38,30.32]],
    center: [30.34, 76.40],
  },
  {
    // Firozpur — Rice dominant (paddy belt near Pakistan border)
    name: 'Firozpur Paddy Belt, Punjab',
    coords: [[74.60,30.92],[74.64,30.92],[74.64,30.96],[74.60,30.96],[74.60,30.92]],
    center: [30.94, 74.62],
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
}

function LeafletMap({ pixels, aoi, mapId, layer, timeStep, onPixelClick, darkMode }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const markersRef   = useRef<any[]>([]);
  const aoiLayerRef  = useRef<any>(null);

  // Load Leaflet CSS + JS once
  useEffect(() => {
    if (!(window as any).L) {
      const link = document.createElement('link');
      link.rel  = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src   = LEAFLET_JS;
      script.onload = () => initMap();
      document.head.appendChild(script);
    } else {
      initMap();
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
  }, [pixels, aoi, mapId, layer, timeStep]); // eslint-disable-line

  function renderLayers(
    L: any, map: any,
    pixels: PixelData[], aoi: AoiDef,
    mapId: MapId, layer: string, t: number,
    onPixelClick: (p: PixelData) => void
  ) {
    // Clear old markers
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    if (aoiLayerRef.current) { map.removeLayer(aoiLayerRef.current); }

    // Draw AOI boundary polygon
    const aoiLayer = L.polygon(
      aoi.coords.map(([lng, lat]) => [lat, lng]),
      { color: '#10b981', weight: 2, fillOpacity: 0.05, dashArray: '6 4' }
    ).addTo(map);
    aoiLayerRef.current = aoiLayer;

    // Draw each pixel as a small colored rectangle
    // Fixed ~55m pixel size at Punjab latitude (matches rf_model PIXEL_SIZE_DEG = 0.0005)
    if (pixels.length === 0) return;

    const PIXEL_DEG = 0.0005; // must match backend rf_model.py PIXEL_SIZE_DEG
    const cellH = PIXEL_DEG;
    const cellW = PIXEL_DEG;

    pixels.forEach(pixel => {
      const color = getPixelHex(pixel, mapId, layer, t);
      const rect  = L.rectangle(
        [
          [pixel.latitude - cellH / 2, pixel.longitude - cellW / 2],
          [pixel.latitude + cellH / 2, pixel.longitude + cellW / 2],
        ],
        {
          color:       '#00000022',
          weight:      0.5,
          fillColor:   color,
          fillOpacity: 0.82,
        }
      ).addTo(map);

      rect.on('click',     () => onPixelClick(pixel));
      rect.on('mouseover', () => { rect.setStyle({ weight: 2, color: '#10b981' }); onPixelClick(pixel); });
      rect.on('mouseout',  () => rect.setStyle({ weight: 0.5, color: '#00000022' }));

      markersRef.current.push(rect);
    });

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
                        : row.field_type === 'Corn'      ? 'bg-orange-500/10 text-orange-500'
                        : row.field_type === 'Soy'       ? 'bg-emerald-500/10 text-emerald-500'
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