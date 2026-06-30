import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LayoutDashboard, Droplets, Map, BarChart3, Settings as SettingsIcon, Search, Menu, X, Moon, Sun } from 'lucide-react';
import Dashboard from './components/Dashboard';
import AnalysisMaps from './components/AnalysisMaps';
import GrowthStageChart from './components/GrowthStageChart';
import SoilHealthView from './components/SoilHealth';
import IrrigationAdvisory from './components/IrrigationAdvisory';
import Settings from './components/Settings';
import Chatbot from './components/Chatbot';
import { useTheme } from './context/ThemeContext';

export default function App() {
  const { darkMode, toggleDarkMode } = useTheme();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMenuOpen, setIsMenuOpen] = useState(window.innerWidth >= 768);

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-emerald-50 text-emerald-900'} flex`}>
      <AnimatePresence>
        {isMenuOpen && (
          <motion.nav
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={`w-full md:w-64 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-emerald-100'} border-r p-6 flex-col absolute md:relative z-20 h-full`}
          >
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-xl font-bold">Crop Irrigation Advisor</h1>
              <button className="md:hidden" onClick={() => setIsMenuOpen(false)}>
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="space-y-4">
              {[
                { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
                { id: 'maps', label: 'Analysis Maps', icon: Map },
                { id: 'advisory', label: 'Irrigation Advisory', icon: Droplets },
                { id: 'analytics', label: 'Analytics', icon: BarChart3 },
                { id: 'soil', label: 'Soil Health', icon: Droplets },
                { id: 'settings', label: 'Settings', icon: SettingsIcon },
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); if (window.innerWidth < 768) setIsMenuOpen(false); }}
                  className={`w-full flex items-center space-x-3 p-3 rounded-lg ${activeTab === item.id ? (darkMode ? 'bg-emerald-900 text-emerald-100' : 'bg-emerald-100 text-emerald-800') : (darkMode ? 'text-emerald-300 hover:bg-gray-700' : 'text-emerald-700 hover:bg-emerald-100')}`}
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
      <main className="flex-1 p-4 md:p-8 w-full overflow-x-hidden">
        <header className="mb-8 flex flex-wrap gap-4 items-center justify-between">
          <button onClick={() => setIsMenuOpen(!isMenuOpen)}>
            <Menu className="w-6 h-6" />
          </button>
          <h2 className="text-2xl font-semibold capitalize">{activeTab}</h2>
          <div className="flex items-center space-x-4">
            <button
              onClick={toggleDarkMode}
              className={`p-2 rounded-lg ${darkMode ? 'bg-gray-800 text-yellow-400' : 'bg-white text-emerald-600'} border ${darkMode ? 'border-gray-700' : 'border-emerald-100'}`}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <div className={`flex items-center px-4 py-2 rounded-lg border ${darkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-emerald-100'}`}>
              <Search className="w-5 h-5 mr-2 text-emerald-500" />
              <input type="text" placeholder="Search..." className={`bg-transparent outline-none ${darkMode ? 'text-white' : 'text-emerald-900'} w-20 sm:w-32 md:w-64`} />
            </div>
          </div>
        </header>
        <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-emerald-100'} rounded-lg shadow-sm border p-4 md:p-6 min-h-[500px] overflow-hidden`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'dashboard' && <Dashboard />}
              {activeTab === 'maps' && <AnalysisMaps />}
              {activeTab === 'advisory' && <IrrigationAdvisory />}
              {activeTab === 'analytics' && <GrowthStageChart />}
              {activeTab === 'soil' && <SoilHealthView />}
              {activeTab === 'settings' && <Settings />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <Chatbot />
    </div>
  );
}
