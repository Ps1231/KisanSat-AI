import React, { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { CheckCircle2, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface PipelineStatus {
  data_processing: string;
  crop_classification_model: string;
  crop_phenology_model: string;
  moisture_stress_model: string;
  irrigation_advisory: string;
}

export default function PipelineStatus() {
  const { darkMode } = useTheme();
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(() => {
    setLoading(true);
    fetch('/api/pipeline-status')
      .then(res => res.json())
      .then(data => {
        setStatus(data);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (!status) return <div className="text-gray-500">Loading pipeline status...</div>;

  const getStatusIcon = (s: string) => {
    if (s === 'ready' || s === 'active' || s === 'generated') return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
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
        {Object.entries(status).map(([key, value]) => (
          <div key={key} className="flex flex-col items-center gap-2">
            <div className={`p-2 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                {getStatusIcon(value as string)}
            </div>
            <span className={`text-xs text-center capitalize ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{key.replace(/_/g, ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
