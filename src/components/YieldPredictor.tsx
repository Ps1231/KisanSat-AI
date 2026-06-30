import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useTheme } from '../context/ThemeContext';

interface YieldData {
  field: string;
  projected: number;
  historical: number;
}

export default function YieldPredictor() {
  const { darkMode } = useTheme();
  const [data, setData] = useState<YieldData[]>([]);

  useEffect(() => {
    fetch('/api/yield-prediction')
      .then(res => res.json())
      .then(data => setData(data));
  }, []);

  return (
    <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-6 rounded-lg shadow-sm border space-y-4`}>
      <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-emerald-900'}`}>Yield Predictor (Seasonal)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#444' : '#ccc'} />
          <XAxis dataKey="field" stroke={darkMode ? '#ccc' : '#666'} />
          <YAxis stroke={darkMode ? '#ccc' : '#666'} />
          <Tooltip contentStyle={{ backgroundColor: darkMode ? '#1f2937' : '#fff', borderColor: darkMode ? '#374151' : '#ccc', color: darkMode ? '#fff' : '#000' }} />
          <Legend />
          <Bar dataKey="projected" fill="#10b981" name="Projected Yield" />
          <Bar dataKey="historical" fill="#6b7280" name="Historical Average" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
