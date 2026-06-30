import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const GREETING: ChatMessage = {
  role: 'model',
  text: 'How can I help you with your irrigation today?',
};

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { darkMode } = useTheme();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMessage: ChatMessage = { role: 'user', text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          // Send prior turns (excluding the greeting) so the backend can keep context.
          history: nextMessages.slice(0, -1).filter((m) => m !== GREETING),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed with status ${res.status}`);
      }

      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'model', text: data.reply as string }]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages((prev) => [
        ...prev,
        { role: 'model', text: "Sorry, I couldn't reach the server. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {isOpen ? (
        <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-lg shadow-xl border w-80 h-96 flex flex-col`}>
          <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-emerald-600 text-white rounded-t-lg">
            <h3 className="font-semibold">Advisor Chat</h3>
            <button onClick={() => setIsOpen(false)} aria-label="Close chat">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div ref={scrollRef} className={`flex-1 p-4 overflow-y-auto text-sm space-y-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-emerald-600 text-white'
                      : darkMode
                      ? 'bg-gray-700 text-gray-100'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className={`rounded-lg px-3 py-2 flex items-center gap-2 ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Thinking...</span>
                </div>
              </div>
            )}
          </div>

          <div className={`p-3 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'} flex`}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder="Type a message..."
              className={`flex-1 border rounded-lg p-2 text-sm disabled:opacity-50 ${darkMode ? 'bg-gray-900 text-white border-gray-700' : 'border-gray-300'}`}
            />
            <button
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              aria-label="Send message"
              className="ml-2 bg-emerald-600 text-white p-2 rounded-lg disabled:opacity-50 hover:bg-emerald-700 transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-emerald-600 text-white p-4 rounded-full shadow-lg hover:bg-emerald-700"
          aria-label="Open advisor chat"
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}
