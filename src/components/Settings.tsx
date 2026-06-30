import React from 'react';
import { useTheme } from '../context/ThemeContext';

export default function Settings() {
  const { darkMode, toggleDarkMode } = useTheme();

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Application Settings</h3>
      <div className={`p-4 rounded-lg border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center justify-between">
          <span className={`${darkMode ? 'text-gray-200' : 'text-gray-600'}`}>Dark Mode</span>
          <button
            onClick={toggleDarkMode}
            className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-emerald-700 text-white' : 'bg-emerald-600 text-white'} hover:bg-emerald-700`}
          >
            {darkMode ? 'Disable Dark Mode' : 'Enable Dark Mode'}
          </button>
        </div>
      </div>
    </div>
  );
}
