import React, { useEffect, useState, useMemo } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Droplets, AlertTriangle, CheckCircle2, TrendingUp, Download } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

// ─── Types matching the FastAPI /api/fields + /api/summary contract ──────────
interface FieldPixel {
  pixel_id: number;
  lat: number;
  lon: number;
  crop_type: string;
  confidence: number;
  stress_level: string;
  advisory: string;
  deficit_mm: number;
  crop_color: string;
}

interface Summary {
  total_pixels: number;
  crop_distribution: Record<string, number>;
  stress_distribution: Record<string, number>;
  advisory_distribution: Record<string, number>;
  avg_peak_ndvi: number;
}

// Advisory → colour + icon, matches backend IRRIGATION_COLORS
const ADVISORY_STYLE: Record<string, { color: string; bg: string; text: string }> = {
  'OK':            { color: '#22C55E', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-800 dark:text-emerald-300' },
  'Monitor':       { color: '#EAB308', bg: 'bg-yellow-100 dark:bg-yellow-900/30',  text: 'text-yellow-800 dark:text-yellow-300' },
  'Irrigate Soon': { color: '#F97316', bg: 'bg-orange-100 dark:bg-orange-900/30',  text: 'text-orange-800 dark:text-orange-300' },
  'Urgent':        { color: '#EF4444', bg: 'bg-red-100 dark:bg-red-900/30',        text: 'text-red-800 dark:text-red-300' },
};

// Crop-specific FAO-56 irrigation guidance (real agronomy, not generic)
const CROP_GUIDANCE: Record<string, string> = {
  Wheat:  'Rabi wheat needs critical irrigation at crown-root initiation (21 days) and flowering. Maintain ~50mm per cycle.',
  Rice:   'Paddy requires standing water through tillering. Keep 5cm depth; avoid drainage before grain fill.',
  Cotton: 'Cotton is drought-tolerant early but sensitive at boll formation. Irrigate at 25% depletion of available water.',
  Fallow: 'No active crop. No irrigation scheduled — soil resting between seasons.',
};

export default function IrrigationAdvisory() {
  const { darkMode } = useTheme();
  const [fields, setFields]   = useState<FieldPixel[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/fields').then(r => r.json()).catch(() => ({ fields: [] })),
      fetch('/api/summary').then(r => r.json()).catch(() => null),
    ]).then(([f, s]) => {
      setFields(f.fields ?? []);
      setSummary(s);
      setLoading(false);
    });
  }, []);

  // Aggregate pixels into per-crop irrigation zones (real deficit averages)
  const zones = useMemo(() => {
    const byCrop: Record<string, FieldPixel[]> = {};
    for (const f of fields) {
      (byCrop[f.crop_type] ??= []).push(f);
    }
    return Object.entries(byCrop).map(([crop, pxs]) => {
      const avgDeficit = pxs.reduce((s, p) => s + (p.deficit_mm || 0), 0) / pxs.length;
      // Worst advisory in the zone drives the recommendation
      const order = ['OK', 'Monitor', 'Irrigate Soon', 'Urgent'];
      const worst = pxs.reduce((w, p) =>
        order.indexOf(p.advisory) > order.indexOf(w) ? p.advisory : w, 'OK');
      const stressedCount = pxs.filter(p => p.stress_level !== 'none').length;
      return {
        crop,
        color: pxs[0].crop_color,
        pixelCount: pxs.length,
        avgDeficit: Math.round(avgDeficit * 10) / 10,
        advisory: worst,
        stressedPct: Math.round((stressedCount / pxs.length) * 100),
        avgConfidence: Math.round((pxs.reduce((s, p) => s + p.confidence, 0) / pxs.length) * 100),
      };
    }).sort((a, b) => b.avgDeficit - a.avgDeficit);
  }, [fields]);

  const totalUrgent = summary?.advisory_distribution?.['Urgent'] ?? 0;
  const totalPixels = summary?.total_pixels ?? fields.length;

  const handleDownloadPDF = async () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Crop Irrigation Advisory Report', 14, 18);
    doc.setFontSize(10);
    doc.text(`Punjab Rabi Season  |  ${totalPixels} pixels analysed  |  Generated ${new Date().toLocaleDateString()}`, 14, 26);

    autoTable(doc, {
      startY: 34,
      head: [['Crop Zone', 'Pixels', 'Avg Deficit (mm)', 'Advisory', 'Stressed %', 'Confidence']],
      body: zones.map(z => [z.crop, z.pixelCount, z.avgDeficit, z.advisory, `${z.stressedPct}%`, `${z.avgConfidence}%`]),
      headStyles: { fillColor: [5, 150, 105] },
    });

    // Fetch simple farmer-friendly action points (AI-generated, with fallback)
    let points: string[] = [];
    try {
      const r = await fetch('/api/advisory-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      points = data.points ?? [];
    } catch {
      points = [];
    }

    if (points.length > 0) {
      // @ts-ignore — lastAutoTable is added by jspdf-autotable
      const y = (doc as any).lastAutoTable?.finalY ?? 90;
      doc.setFontSize(13);
      doc.text('What You Should Do', 14, y + 12);
      doc.setFontSize(11);
      points.forEach((pt, i) => {
        const lines = doc.splitTextToSize(`${i + 1}. ${pt}`, 180);
        doc.text(lines, 14, y + 22 + i * 8);
      });
    }

    doc.save('irrigation_advisory_report.pdf');
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading advisory data from pipeline…</div>;
  }

  const card = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';

  return (
    <div className="space-y-6">
      {/* Header + report */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-emerald-900'}`}>
            Irrigation Advisory
          </h3>
          <p className="text-xs text-gray-400">FAO-56 water deficit across {totalPixels} cropland pixels</p>
        </div>
        <button onClick={handleDownloadPDF}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition">
          <Download className="w-4 h-4" /> Download Report
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryStat icon={Droplets} label="Avg Peak NDVI" value={summary?.avg_peak_ndvi?.toFixed(3) ?? '—'} darkMode={darkMode} />
        <SummaryStat icon={AlertTriangle} label="Urgent Pixels" value={String(totalUrgent)} darkMode={darkMode} accent={totalUrgent > 0 ? 'text-red-500' : undefined} />
        <SummaryStat icon={TrendingUp} label="Crop Zones" value={String(zones.length)} darkMode={darkMode} />
        <SummaryStat icon={CheckCircle2} label="Total Pixels" value={String(totalPixels)} darkMode={darkMode} />
      </div>

      {/* Per-crop advisory zones (real data) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {zones.map(zone => {
          const style = ADVISORY_STYLE[zone.advisory] ?? ADVISORY_STYLE['OK'];
          return (
            <div key={zone.crop} className={`${card} border rounded-lg p-5 space-y-3`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: zone.color }} />
                  <h4 className={`font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{zone.crop}</h4>
                  <span className="text-xs text-gray-400">({zone.pixelCount} px)</span>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}>
                  {zone.advisory}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <Metric label="Deficit" value={`${zone.avgDeficit} mm`} darkMode={darkMode} />
                <Metric label="Stressed" value={`${zone.stressedPct}%`} darkMode={darkMode} />
                <Metric label="Confidence" value={`${zone.avgConfidence}%`} darkMode={darkMode} />
              </div>

              <p className="text-[11px] text-gray-400 italic leading-snug border-t border-gray-700/30 pt-2">
                {CROP_GUIDANCE[zone.crop] ?? 'Monitor field conditions and adjust per local schedule.'}
              </p>
            </div>
          );
        })}
      </div>

      {zones.length === 0 && (
        <div className={`${card} border rounded-lg p-6 text-center text-sm text-gray-400`}>
          No field data yet. Run the satellite pipeline to generate advisories.
        </div>
      )}
    </div>
  );
}

// ─── Small presentational helpers ────────────────────────────────────────────
function SummaryStat({ icon: Icon, label, value, darkMode, accent }: {
  icon: any; label: string; value: string; darkMode: boolean; accent?: string;
}) {
  return (
    <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} border rounded-lg p-4 flex items-center gap-3`}>
      <div className={`p-2 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
        <Icon className={`w-5 h-5 ${accent ?? 'text-emerald-500'}`} />
      </div>
      <div>
        <p className={`text-[11px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{label}</p>
        <p className={`text-lg font-bold ${accent ?? (darkMode ? 'text-white' : 'text-gray-900')}`}>{value}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, darkMode }: { label: string; value: string; darkMode: boolean }) {
  return (
    <div className={`rounded-md py-1.5 ${darkMode ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
      <p className="text-[9px] text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-bold font-mono ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>{value}</p>
    </div>
  );
}