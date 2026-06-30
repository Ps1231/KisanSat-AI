import React, { useEffect, useState } from 'react';
import { Sun, CloudRain, Cloud, Wind } from 'lucide-react';
import { WeatherData } from '../types';
import { useTheme } from '../context/ThemeContext';

export default function WeatherForecast() {
  const [forecast, setForecast] = useState<WeatherData[]>([]);
  const { darkMode } = useTheme();

  useEffect(() => {
    fetch('/api/weather')
      .then(res => res.json())
      .then(data => setForecast(data));
  }, []);

  const WeatherIcon = ({ condition }: { condition: string }) => {
    switch (condition) {
      case 'Sunny': return <Sun className="w-6 h-6 text-yellow-500" />;
      case 'Rainy': return <CloudRain className="w-6 h-6 text-blue-500" />;
      default: return <Cloud className="w-6 h-6 text-gray-500" />;
    }
  };

  return (
    <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-6 rounded-lg shadow-sm border`}>
      <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-white' : 'text-emerald-900'}`}>7-Day Weather Outlook</h3>
      <div className="grid grid-cols-7 gap-2">
        {forecast.map((day, index) => (
          <div key={index} className={`flex flex-col items-center p-2 rounded ${darkMode ? 'bg-gray-700' : 'bg-emerald-50'}`}>
            <span className={`text-xs ${darkMode ? 'text-gray-300' : 'text-emerald-800'}`}>{day.day}</span>
            <WeatherIcon condition={day.condition} />
            <span className={`text-sm font-bold ${darkMode ? 'text-white' : 'text-emerald-900'}`}>{day.temp}°C</span>
            <span className={`text-[10px] mt-1 px-1 rounded ${
              day.waterNeeds === 'High' ? 'bg-red-100 text-red-800' :
              day.waterNeeds === 'Moderate' ? 'bg-orange-100 text-orange-800' :
              'bg-blue-100 text-blue-800'
            }`}>{day.waterNeeds}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
