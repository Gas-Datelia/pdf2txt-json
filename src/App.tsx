/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  FileText, 
  Link as LinkIcon, 
  Loader2, 
  Copy, 
  CheckCircle2, 
  AlertCircle,
  FileJson,
  LayoutList
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [mode, setMode] = useState<'text' | 'json'>('json');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [status, setStatus] = useState<string>('');

  const handleExtract = async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStatus('Descargando PDF...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout for fetch

    try {
      const fetchResponse = await fetch(`/api/fetch-pdf?url=${encodeURIComponent(url)}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!fetchResponse.ok) {
        const errData = await fetchResponse.json();
        throw new Error(errData.error || 'No se pudo obtener el PDF de la URL proporcionada.');
      }
      
      setStatus('Procesando con IA (esto puede tardar varios minutos en PDFs grandes)...');
      const { base64, mimeType } = await fetchResponse.json();

      // Use gemini-3.1-pro-preview for complex reasoning and long documents
      const model = "gemini-3.1-pro-preview";
      
      const prompt = mode === 'json' 
        ? "Extrae TODA la información de este pedido en formato JSON. Estructura la respuesta en tres secciones principales: 'generalInfo', 'ordersByDestination' y 'totals'. IMPORTANTE: Si falta algún dato (como el cliente, el número de pedido o incluso si no hay destinos/sucursales especificados), deja esos campos como null o vacíos, pero NUNCA dejes de devolver las líneas de producto encontradas. Si no hay destinos claros, agrupa todos los productos en un único objeto dentro de 'ordersByDestination' con destination: 'General'. Asegúrate de capturar CADA línea de pedido sin excepción. NO incluyas ningún texto introductorio ni comentarios, solo el JSON puro."
        : "Extrae TODO el texto de este pedido de forma limpia y clara. No omitas ninguna línea de producto ni detalle importante. Si faltan datos de cabecera, extrae al menos el detalle de productos. NO incluyas ningún texto introductorio ni comentarios, solo el contenido del pedido.";

      const config = mode === 'json' ? {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            generalInfo: {
              type: Type.OBJECT,
              properties: {
                orderNumber: { type: Type.STRING, nullable: true },
                provider: { type: Type.STRING, nullable: true },
                location: { type: Type.STRING, nullable: true },
                adminCentral: { type: Type.STRING, nullable: true },
                emissionDate: { type: Type.STRING, nullable: true },
                buyer: { type: Type.STRING, nullable: true },
                deliveryDate: { type: Type.STRING, nullable: true },
                paymentCondition: { type: Type.STRING, nullable: true },
                currency: { type: Type.STRING, nullable: true }
              }
            },
            ordersByDestination: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  destination: { type: Type.STRING, nullable: true },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        code: { type: Type.STRING, nullable: true },
                        provCode: { type: Type.STRING, nullable: true },
                        description: { type: Type.STRING },
                        listPrice: { type: Type.NUMBER, nullable: true },
                        variations: { type: Type.STRING, nullable: true },
                        unitPrice: { type: Type.NUMBER, nullable: true },
                        ii: { type: Type.STRING, nullable: true },
                        uxb: { type: Type.NUMBER, nullable: true },
                        quantity: { type: Type.NUMBER, nullable: true },
                        ump: { type: Type.STRING, nullable: true },
                        total: { type: Type.NUMBER, nullable: true }
                      },
                      required: ["description"]
                    }
                  },
                  subTotal: { type: Type.NUMBER, nullable: true }
                }
              }
            },
            totals: {
              type: Type.OBJECT,
              properties: {
                totalNeto: { type: Type.NUMBER, nullable: true },
                impInt: { type: Type.NUMBER, nullable: true },
                iva: { type: Type.NUMBER, nullable: true },
                total: { type: Type.NUMBER, nullable: true }
              }
            }
          },
          required: ["ordersByDestination"]
        }
      } : undefined;

      // Wrap Gemini call in a timeout promise
      const geminiPromise = genAI.models.generateContent({
        model,
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: base64,
                  mimeType: mimeType
                }
              }
            ]
          }
        ],
        config: config as any
      });

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('La IA está tardando demasiado. El PDF podría ser excesivamente grande o complejo.')), 600000) // 10 min total
      );

      const response = await Promise.race([geminiPromise, timeoutPromise]) as any;

      console.log("Gemini Response:", response);

      const text = response.text;
      if (!text) {
        const finishReason = response.candidates?.[0]?.finishReason;
        if (finishReason === 'SAFETY') {
          throw new Error("El contenido fue bloqueado por los filtros de seguridad.");
        }
        throw new Error(`No se recibió respuesta del modelo. Razón: ${finishReason || 'Desconocida'}`);
      }
      setResult(text);
      setStatus('');
    } catch (err: any) {
      console.error("Error in handleExtract:", err);
      if (err.name === 'AbortError') {
        setError('Tiempo de espera agotado al descargar el PDF.');
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
          <h1 className="text-4xl font-serif italic text-[#141414] mb-2">Analizador de Pedidos PDF</h1>
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

              <div className="p-0 bg-[#151619] h-[600px] overflow-auto">
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
