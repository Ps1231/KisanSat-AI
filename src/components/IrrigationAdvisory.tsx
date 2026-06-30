import React, { useEffect, useState } from 'react';
import { CropData } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useTheme } from '../context/ThemeContext';

export default function IrrigationAdvisory() {
  const [fields, setFields] = useState<CropData[]>([]);
  const { darkMode } = useTheme();

  useEffect(() => {
    fetch('/api/dashboard')
      .then(res => res.json())
      .then(data => setFields(data.fields));
  }, []);

  const getAdvisoryColor = (stressLevel: string) => {
    if (darkMode) {
      switch (stressLevel) {
        case 'high': return 'bg-red-900/30 text-red-300 border-red-800';
        case 'moderate': return 'bg-yellow-900/30 text-yellow-300 border-yellow-800';
        default: return 'bg-emerald-900/30 text-emerald-300 border-emerald-800';
      }
    }
    switch (stressLevel) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'moderate': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    }
  };

  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    doc.text('Irrigation Summary Report', 20, 10);
    const tableColumn = ["Field Name", "Status", "Stress Level"];
    const tableRows: any[] = [];
    fields.forEach(field => {
      tableRows.push([field.name, field.advisory, field.stressLevel]);
    });
    autoTable(doc, { head: [tableColumn], body: tableRows });
    doc.save('irrigation_report.pdf');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-emerald-900'}`}>Irrigation Advisory</h3>
        <button onClick={handleDownloadPDF} className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700">
          Download Summary Report
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {fields.map(field => (
          <div key={field.id} className={`p-6 rounded-lg border ${getAdvisoryColor(field.stressLevel)}`}>
            <h4 className="font-bold text-lg mb-2">{field.name}</h4>
            <p className="mb-1"><strong>Status:</strong> {field.advisory}</p>
            <p className="text-sm"><strong>Stress Level:</strong> {field.stressLevel}</p>
          </div>
        ))}
      </div>
      <div className={`p-6 rounded-lg border ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
        <h4 className={`font-bold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>General Irrigation Recommendations</h4>
        <ul className="list-disc list-inside space-y-2 text-sm">
          <li>Check soil moisture levels daily at 7:00 AM.</li>
          <li>Adjust irrigation schedules based on local weather forecasts.</li>
          <li>Ensure drip irrigation lines are clear of blockages.</li>
          <li>Apply water during early morning or late evening to reduce evaporation.</li>
        </ul>
      </div>
    </div>
  );
}
