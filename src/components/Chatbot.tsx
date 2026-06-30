import React, { useState } from 'react';
import { MessageSquare, X, Send } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const { darkMode } = useTheme();

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {isOpen ? (
        <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg shadow-xl border w-80 h-96 flex flex-col`}>
          <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-emerald-600 text-white rounded-t-lg">
            <h3 className="font-semibold">Advisor Chat</h3>
            <button onClick={() => setIsOpen(false)}><X className="w-5 h-5" /></button>
          </div>
          <div className={`flex-1 p-4 overflow-y-auto text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            <p>How can I help you with your irrigation today?</p>
          </div>
          <div className={`p-3 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'} flex`}>
            <input type="text" placeholder="Type a message..." className={`flex-1 border rounded-lg p-2 text-sm ${darkMode ? 'bg-gray-900 text-white border-gray-700' : 'border-gray-300'}`} />
            <button className="ml-2 bg-emerald-600 text-white p-2 rounded-lg"><Send className="w-4 h-4" /></button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-emerald-600 text-white p-4 rounded-full shadow-lg hover:bg-emerald-700"
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}
