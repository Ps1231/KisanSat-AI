import React, { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { CheckCircle2, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface ModuleInfo {
  status: string;
  metric?: string;
}

interface PipelineResponse {
  modules?: Record<string, ModuleInfo>;
  [key: string]: any;   // flat keys (legacy fallback)
}

const MODULE_ORDER = [
  'data_processing',
  'crop_classification_model',
  'crop_phenology_model',
  'moisture_stress_model',
  'irrigation_advisory',
];

export default function PipelineStatus() {
  const { darkMode } = useTheme();
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(() => {
    setLoading(true);
    fetch('/api/pipeline-status')
      .then(res => res.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  if (!data) return <div className="text-gray-500">Loading pipeline status...</div>;

  // Prefer the rich `modules` shape; fall back to flat keys so it never breaks.
  const modules: Record<string, ModuleInfo> = data.modules
    ?? MODULE_ORDER.reduce((acc, k) => {
      if (data[k]) acc[k] = { status: data[k] as string };
      return acc;
    }, {} as Record<string, ModuleInfo>);

  const getStatusIcon = (s: string) => {
    if (['ready', 'active', 'generated'].includes(s)) return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
    if (s === 'processing') return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    return <AlertCircle className="w-5 h-5 text-red-500" />;
  };

  return (
    <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-6 rounded-lg shadow-sm border space-y-4`}>
      <div className="flex justify-between items-center">
        <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-emerald-900'}`}>Pipeline Status</h3>
        <button onClick={fetchStatus} disabled={loading} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''} ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {MODULE_ORDER.filter(k => modules[k]).map((key) => {
          const mod = modules[key];
          return (
            <div key={key} className={`flex flex-col items-center gap-2 p-3 rounded-lg ${darkMode ? 'bg-gray-900/40' : 'bg-gray-50'}`}>
              <div className={`p-2 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-white'}`}>
                {getStatusIcon(mod.status)}
              </div>
              <span className={`text-sm text-center capitalize font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                {key.replace(/_/g, ' ')}
              </span>
              {mod.metric && (
                <span className="text-xs text-center text-emerald-600 dark:text-emerald-400 font-mono">
                  {mod.metric}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}