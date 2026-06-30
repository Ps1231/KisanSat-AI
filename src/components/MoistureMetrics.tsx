import React from 'react';
import { Droplets, Thermometer, AlertTriangle } from 'lucide-react';
import { DashboardStats } from '../types';
import { useTheme } from '../context/ThemeContext';

interface Props {
  stats: DashboardStats;
}

export default function MoistureMetrics({ stats }: Props) {
  const { darkMode } = useTheme();

  const metrics = [
    { title: 'Soil Moisture', value: `${stats.avgMoisture}%`, icon: Droplets, color: 'text-emerald-500' },
    { title: 'Evapotranspiration', value: `${stats.etRate} mm/day`, icon: Thermometer, color: 'text-emerald-500' },
    { title: 'Water Deficit Alert', value: stats.waterDeficit, icon: AlertTriangle, color: 'text-emerald-500' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {metrics.map((metric, index) => (
        <div key={index} className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-6 rounded-lg shadow-sm border flex items-center space-x-4`}>
          <div className={`p-3 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-100'} ${metric.color}`}>
            <metric.icon className="w-6 h-6" />
          </div>
          <div>
            <h4 className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{metric.title}</h4>
            <p className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{metric.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
