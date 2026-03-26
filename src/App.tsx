/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  FileText,
  Link as LinkIcon,
  Loader2,
  Copy,
  CheckCircle2,
  AlertCircle,
  FileJson,
  LayoutList,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';


export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [mode, setMode] = useState<'text' | 'json'>('json');
  const [useChunked, setUseChunked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [status, setStatus] = useState<string>('');

  const handleExtract = async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStatus(useChunked ? 'Procesando página por página (se paraleliza en lotes de 5)...' : 'Procesando (esto puede tardar varios minutos en PDFs grandes)...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minute timeout

    try {
      const endpoint = useChunked ? '/api/extract-chunked' : '/api/extract';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, mode }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Ocurrió un error al procesar el PDF.');
      }
      
      const responseData = await response.json();
      const resultData = responseData.data;
      setResult(typeof resultData === 'string' ? resultData : JSON.stringify(resultData));
      setStatus('');
    } catch (err: any) {
      console.error("Error in handleExtract:", err);
      if (err.name === 'AbortError') {
        setError('Tiempo de espera agotado al procesar el PDF.');
      } else {
        setError(err.message || 'Ocurrió un error inesperado al procesar el PDF.');
      }
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  const copyToClipboard = () => {
    if (result) {
      navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="mb-12 text-center">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-block p-3 bg-white rounded-2xl shadow-sm mb-4"
          >
            <FileText size={32} className="text-[#5A5A40]" />
          </motion.div>
          <h1 className="text-4xl font-serif italic text-[#141414] mb-2">Convierte PDFs a texto o JSON estructurado</h1>
          <p className="text-[#5A5A40] opacity-80">Extracción técnica y precisa de datos</p>
        </header>

        {/* Input Section */}
        <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-[#E4E3E0] mb-8">
          <div className="flex flex-col gap-6">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-[#5A5A40] mb-2 ml-1">
                URL del PDF
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40] opacity-50">
                  <LinkIcon size={18} />
                </div>
                <input
                  type="url"
                  placeholder="https://ejemplo.com/pedido.pdf"
                  className="w-full pl-12 pr-4 py-4 bg-[#F5F5F0] border-none rounded-2xl focus:ring-2 focus:ring-[#5A5A40] transition-all outline-none"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex bg-[#F5F5F0] p-1 rounded-xl">
                <button
                  onClick={() => setMode('json')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'json' ? 'bg-white shadow-sm text-[#141414]' : 'text-[#5A5A40] opacity-60'}`}
                >
                  <FileJson size={16} />
                  JSON
                </button>
                <button
                  onClick={() => setMode('text')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'text' ? 'bg-white shadow-sm text-[#141414]' : 'text-[#5A5A40] opacity-60'}`}
                >
                  <LayoutList size={16} />
                  Texto
                </button>
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useChunked}
                  onChange={(e) => setUseChunked(e.target.checked)}
                  className="w-4 h-4 rounded border-[#5A5A40] text-[#5A5A40] focus:ring-[#5A5A40]"
                />
                <Layers size={16} className="text-[#5A5A40]" />
                <span className="text-sm text-[#5A5A40] font-medium">Página x Página</span>
              </label>

              <button
                onClick={handleExtract}
                disabled={loading || !url}
                className="flex items-center gap-2 px-8 py-4 bg-[#5A5A40] text-white rounded-2xl font-medium hover:bg-[#4A4A30] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-[#5A5A40]/20"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : <FileText size={20} />}
                {loading ? 'Procesando...' : 'Extraer'}
              </button>
            </div>
            {status && (
              <div className="flex items-center gap-2 text-sm text-[#5A5A40] italic animate-pulse">
                <Loader2 size={14} className="animate-spin" />
                {status}
              </div>
            )}
          </div>
        </div>

        {/* Error State */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl mb-8 flex items-center gap-3"
            >
              <AlertCircle size={20} />
              <p className="text-sm">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Result Section */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl shadow-sm border border-[#E4E3E0] overflow-hidden"
            >
              <div className="flex items-center justify-between p-6 border-b border-[#F5F5F0]">
                <h2 className="text-lg font-serif italic">Validación de Datos</h2>
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#5A5A40] hover:text-[#141414] transition-colors"
                >
                  {copied ? <CheckCircle2 size={16} className="text-green-600" /> : <Copy size={16} />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>

              <div className="p-0 bg-[#151619] max-h-[80vh] overflow-auto">
                <pre className="p-6 font-mono text-sm text-[#00FF00] leading-relaxed">
                  {mode === 'json' ? JSON.stringify(JSON.parse(result), null, 2) : result}
                </pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="mt-12 text-center text-[#5A5A40] opacity-40 text-[10px] uppercase tracking-[0.2em]">
          PDF Data Extraction Tool • Restricted Output Mode
        </footer>
      </div>
    </div>
  );
}
