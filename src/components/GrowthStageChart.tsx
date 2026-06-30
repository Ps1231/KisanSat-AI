import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useTheme } from '../context/ThemeContext';
import YieldPredictor from './YieldPredictor';

const datasets: Record<string, { date: string, stage: number, moisture: number }[]> = {
  'Field A': [
    { date: 'Jan', stage: 1, moisture: 60 },
    { date: 'Feb', stage: 2, moisture: 65 },
    { date: 'Mar', stage: 3, moisture: 55 },
    { date: 'Apr', stage: 4, moisture: 70 },
  ],
  'Field B': [
    { date: 'Jan', stage: 1, moisture: 50 },
    { date: 'Feb', stage: 2, moisture: 55 },
    { date: 'Mar', stage: 3, moisture: 60 },
    { date: 'Apr', stage: 4, moisture: 65 },
  ],
  'Field C': [
    { date: 'Jan', stage: 1, moisture: 70 },
    { date: 'Feb', stage: 2, moisture: 60 },
    { date: 'Mar', stage: 3, moisture: 50 },
    { date: 'Apr', stage: 4, moisture: 55 },
  ],
};

export default function GrowthStageChart() {
  const { darkMode } = useTheme();
  const [field1, setField1] = useState('Field A');
  const [field2, setField2] = useState('Field B');

  const exportToCSV = () => {
    const headers = ['Date', 'Field', 'Stage', 'Moisture'];
    const csvContent = [
      headers.join(','),
      ...datasets[field1].map(row => `${row.date},${field1},${row.stage},${row.moisture}`),
      ...datasets[field2].map(row => `${row.date},${field2},${row.stage},${row.moisture}`)
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comparison_${field1}_${field2}.csv`;
    a.click();
  };

  return (
    <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-6 rounded-lg shadow-sm border space-y-4`}>
      <div className="flex justify-between items-center">
        <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-emerald-900'}`}>Field Comparison</h3>
        <button onClick={exportToCSV} className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700">
          Export CSV
        </button>
      </div>
      <div className="flex gap-4">
        <select value={field1} onChange={(e) => setField1(e.target.value)} className={`p-2.5 rounded-full border ${darkMode ? 'bg-gray-700 text-white border-gray-600' : 'bg-white border-gray-300'} transition-all duration-200 ease-in-out`}>
          {Object.keys(datasets).map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={field2} onChange={(e) => setField2(e.target.value)} className={`p-2.5 rounded-full border ${darkMode ? 'bg-gray-700 text-white border-gray-600' : 'bg-white border-gray-300'} transition-all duration-200 ease-in-out`}>
          {Object.keys(datasets).map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart>
          <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#444' : '#ccc'} />
          <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} stroke={darkMode ? '#ccc' : '#666'} />
          <YAxis stroke={darkMode ? '#ccc' : '#666'} />
          <Tooltip contentStyle={{ backgroundColor: darkMode ? '#1f2937' : '#fff', borderColor: darkMode ? '#374151' : '#ccc', color: darkMode ? '#fff' : '#000' }} />
          <Legend />
          <Line data={datasets[field1]} type="monotone" dataKey="moisture" stroke="#059669" name={`${field1} Moisture`} />
          <Line data={datasets[field2]} type="monotone" dataKey="moisture" stroke="#f59e0b" name={`${field2} Moisture`} />
        </LineChart>
      </ResponsiveContainer>
      <YieldPredictor />
    </div>
  );
}
