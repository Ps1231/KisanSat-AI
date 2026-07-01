import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, X, Send, Loader2, ChevronLeft, Home, Leaf } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { ADVICE_TREE, ROOT_ID, TreeNode, AdviceCard } from '../data/adviceTree';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  advice?: AdviceCard;
  options?: { label: string; next: string }[];
  nodeId?: string;
  freeText?: boolean;
}

const SEVERITY_STYLE: Record<string, { bar: string; chip: string }> = {
  info:    { bar: 'border-l-blue-500',    chip: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  good:    { bar: 'border-l-emerald-500', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  warning: { bar: 'border-l-yellow-500',  chip: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  urgent:  { bar: 'border-l-red-500',     chip: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

function rootMessage(): ChatMessage {
  const node = ADVICE_TREE[ROOT_ID];
  return { role: 'model', text: node.reply, options: node.options, nodeId: ROOT_ID };
}

export default function Chatbot() {
  const { darkMode } = useTheme();
  const [isOpen, setIsOpen]       = useState(false);
  const [messages, setMessages]   = useState<ChatMessage[]>([rootMessage()]);
  const [input, setInput]         = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [navStack, setNavStack]   = useState<string[]>([ROOT_ID]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => { if (isOpen) inputRef.current?.focus(); }, [isOpen]);

  function goToNode(nodeId: string, userLabel: string) {
    const node: TreeNode | undefined = ADVICE_TREE[nodeId];
    if (!node) return;
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: userLabel },
      { role: 'model', text: node.reply, advice: node.advice, options: node.options, nodeId },
    ]);
    setNavStack((prev) => [...prev, nodeId]);
  }

  function goBack() {
    setNavStack((prev) => {
      if (prev.length <= 1) return prev;
      const newStack = prev.slice(0, -1);
      const parentId = newStack[newStack.length - 1];
      const node = ADVICE_TREE[parentId];
      setMessages((m) => [...m, { role: 'model', text: node.reply, advice: node.advice, options: node.options, nodeId: parentId }]);
      return newStack;
    });
  }

  function goHome() {
    setNavStack([ROOT_ID]);
    setMessages((m) => [...m, rootMessage()]);
  }

  async function sendFreeText(text: string) {
    const clean = text.trim();
    if (!clean || isLoading) return;
    const next = [...messages, { role: 'user' as const, text: clean }];
    setMessages(next);
    setInput('');
    setIsLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: clean,
          history: next.filter((m) => !m.advice).map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'model', text: data.reply, freeText: true, nodeId: navStack[navStack.length - 1] }]);
    } catch {
      setMessages((prev) => [...prev, {
        role: 'model',
        text: "I couldn't reach the advisory server. Make sure the backend is running on port 8000.",
        freeText: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); sendFreeText(input); }
  }

  const lastModelIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'model') return i;
    return -1;
  })();

  const canGoBack = navStack.length > 1;
  const atRoot = navStack.length === 1;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {isOpen ? (
        <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-2xl shadow-2xl border w-[440px] max-w-[92vw] h-[600px] max-h-[85vh] flex flex-col overflow-hidden`}>
          <div className="px-4 py-3 flex justify-between items-center bg-gradient-to-r from-emerald-600 to-green-500 text-white">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-white/20 rounded-lg"><Leaf className="w-5 h-5" /></div>
              <div>
                <h3 className="font-semibold leading-tight">Crop Advisor</h3>
                <p className="text-[11px] text-emerald-50/80">Guided help • ask anything</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} aria-label="Close chat" className="hover:bg-white/20 p-1 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className={`px-3 py-2 flex items-center gap-2 border-b text-xs ${darkMode ? 'border-gray-700 bg-gray-900/40' : 'border-gray-100 bg-gray-50'}`}>
            <button onClick={goBack} disabled={!canGoBack}
              className={`flex items-center gap-1 px-2 py-1 rounded-md transition ${canGoBack ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30' : 'text-gray-400 cursor-not-allowed'}`}>
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button onClick={goHome} disabled={atRoot}
              className={`flex items-center gap-1 px-2 py-1 rounded-md transition ${!atRoot ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30' : 'text-gray-400 cursor-not-allowed'}`}>
              <Home className="w-3.5 h-3.5" /> Main Menu
            </button>
            <span className="ml-auto text-gray-400 truncate">{navStack.length > 1 ? navStack[navStack.length - 1].replace(/_/g, ' ') : 'home'}</span>
          </div>

          <div ref={scrollRef} className={`flex-1 p-4 overflow-y-auto text-sm space-y-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {messages.map((msg, i) => (
              <div key={i} className="space-y-2">
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] rounded-2xl px-3 py-2 whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-emerald-600 text-white rounded-br-sm'
                      : darkMode ? 'bg-gray-700 text-gray-100 rounded-bl-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                  }`}>
                    {msg.text}
                  </div>
                </div>

                {msg.advice && (
                  <div className={`ml-1 rounded-lg border-l-4 p-3 ${SEVERITY_STYLE[msg.advice.severity].bar} ${darkMode ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className={`font-semibold text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>{msg.advice.title}</h4>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${SEVERITY_STYLE[msg.advice.severity].chip}`}>{msg.advice.severity}</span>
                    </div>
                    <ul className="space-y-1.5">
                      {msg.advice.steps.map((s, k) => (
                        <li key={k} className="flex gap-2 text-xs leading-snug">
                          <span className="text-emerald-500 mt-0.5">▸</span><span>{s}</span>
                        </li>
                      ))}
                    </ul>
                    {msg.advice.note && (
                      <p className={`mt-2 text-[11px] italic ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{msg.advice.note}</p>
                    )}
                  </div>
                )}

                {msg.role === 'model' && i === lastModelIdx && msg.options && msg.options.length > 0 && !isLoading && (
                  <div className="flex flex-wrap gap-2 ml-1">
                    {msg.options.map((opt) => (
                      <button key={opt.next} onClick={() => goToNode(opt.next, opt.label)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition ${
                          darkMode ? 'border-emerald-700 text-emerald-300 hover:bg-emerald-900/40' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className={`rounded-2xl px-3 py-2 flex items-center gap-2 ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                  <Loader2 className="w-4 h-4 animate-spin" /><span>Thinking…</span>
                </div>
              </div>
            )}
          </div>

          <div className={`p-3 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'} flex`}>
            <input ref={inputRef} type="text" value={input}
              onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={isLoading}
              placeholder="Ask your own question…"
              className={`flex-1 border rounded-lg p-2 text-sm disabled:opacity-50 ${darkMode ? 'bg-gray-900 text-white border-gray-700' : 'border-gray-300'}`} />
            <button onClick={() => sendFreeText(input)} disabled={isLoading || !input.trim()} aria-label="Send"
              className="ml-2 bg-emerald-600 text-white p-2 rounded-lg disabled:opacity-50 hover:bg-emerald-700 transition">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setIsOpen(true)} aria-label="Open advisor chat"
          className="bg-gradient-to-r from-emerald-600 to-green-500 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition">
          <MessageSquare className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}