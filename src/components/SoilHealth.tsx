import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useTheme } from '../context/ThemeContext';
import { SoilHealth } from '../types';

export default function SoilHealthView() {
  const { darkMode } = useTheme();
  const [data, setData] = useState<SoilHealth[]>([]);

  useEffect(() => {
    fetch('/api/soil-health')
      .then(res => res.json())
      .then(data => setData(data));
  }, []);

  return (
    <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-6 rounded-lg shadow-sm border space-y-4`}>
      <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-emerald-900'}`}>Soil Health & NPK Trends</h3>
      
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#444' : '#ccc'} />
          <XAxis dataKey="date" stroke={darkMode ? '#ccc' : '#666'} />
          <YAxis stroke={darkMode ? '#ccc' : '#666'} />
          <Tooltip contentStyle={{ backgroundColor: darkMode ? '#1f2937' : '#fff', borderColor: darkMode ? '#374151' : '#ccc', color: darkMode ? '#fff' : '#000' }} />
          <Legend />
          <Line type="monotone" dataKey="nitrogen" stroke="#ef4444" name="Nitrogen (N)" />
          <Line type="monotone" dataKey="phosphorus" stroke="#3b82f6" name="Phosphorus (P)" />
          <Line type="monotone" dataKey="potassium" stroke="#10b981" name="Potassium (K)" />
        </LineChart>
      </ResponsiveContainer>

      <h3 className={`text-lg font-semibold mt-6 ${darkMode ? 'text-white' : 'text-emerald-900'}`}>Salinity Trends</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#444' : '#ccc'} />
          <XAxis dataKey="date" stroke={darkMode ? '#ccc' : '#666'} />
          <YAxis stroke={darkMode ? '#ccc' : '#666'} />
          <Tooltip contentStyle={{ backgroundColor: darkMode ? '#1f2937' : '#fff', borderColor: darkMode ? '#374151' : '#ccc', color: darkMode ? '#fff' : '#000' }} />
          <Line type="monotone" dataKey="salinity" stroke="#f59e0b" name="Salinity (dS/m)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
