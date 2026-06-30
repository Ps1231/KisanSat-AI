import React, { useEffect, useState, useRef } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toPng } from 'html-to-image';
import { motion } from 'motion/react';
import { CropData, DashboardStats } from '../types';
import { useTheme } from '../context/ThemeContext';
import MoistureMetrics from './MoistureMetrics';
import WeatherForecast from './WeatherForecast';
import PipelineStatus from './PipelineStatus';

interface SortableItemProps {
  id: string;
  children: React.ReactNode;
  key?: string;
}

import { GripVertical } from 'lucide-react';
// ... (imports)

function SortableItem({ id, children }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <motion.div ref={setNodeRef} style={style} layout transition={{ duration: 0.3 }} className="relative group">
      <div {...attributes} {...listeners} className="absolute left-2 top-2 p-2 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="w-5 h-5 text-gray-400" />
      </div>
      {children}
    </motion.div>
  );
}

export default function Dashboard() {
  const { darkMode } = useTheme();
  const [data, setData] = useState<{ stats: DashboardStats; fields: CropData[] } | null>(null);
  const [items, setItems] = useState(['pipeline', 'moisture', 'weather', 'charts']);
  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(res => res.json())
      .then(data => setData(data));
  }, []);

  const takeSnapshot = () => {
    if (dashboardRef.current) {
      toPng(dashboardRef.current)
        .then((dataUrl) => {
          const link = document.createElement('a');
          link.download = 'dashboard-snapshot.png';
          link.href = dataUrl;
          link.click();
        })
        .catch((err) => console.error('Snapshot failed', err));
    }
  };

  if (!data) return <div>Loading...</div>;

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const widgetMap: { [key: string]: React.ReactNode } = {
    pipeline: <PipelineStatus />,
    moisture: <MoistureMetrics stats={data.stats} />,
    weather: <WeatherForecast />,
    charts: (
      <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} p-6 rounded-lg shadow-sm border h-80`}>
        <h3 className={`text-lg font-semibold mb-4 ${darkMode ? 'text-white' : 'text-emerald-900'}`}>Crop Distribution</h3>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.stats.cropDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#8884d8">
              {data.stats.cropDistribution.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={['#3b82f6', '#10b981', '#f59e0b'][index % 3]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    ),
  };

  return (
    <div className="space-y-4">
      <button 
        onClick={takeSnapshot}
        className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
      >
        Quick Snapshot
      </button>
      <div ref={dashboardRef} className={`${darkMode ? 'bg-gray-900' : 'bg-emerald-50'} p-4 rounded-xl`}>
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <div className="space-y-8">
              {items.map((id) => (
                <SortableItem key={id} id={id}>
                  {widgetMap[id]}
                </SortableItem>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
