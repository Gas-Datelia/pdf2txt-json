import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";

dotenv.config({ path: ".env.local" });
dotenv.config();

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: { timeout: 300_000 }
});

// ─── JSON Repair ────────────────────────────────────────────────────────────

/**
 * Try to parse JSON, and if it fails, attempt to repair truncated JSON
 * by closing unclosed brackets/braces.
 */
function tryParseJSON(text: string): any {
  // First try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // Attempt repair: close unclosed brackets/braces
  }

  let repaired = text.trim();

  // Remove trailing comma if present
  repaired = repaired.replace(/,\s*$/, '');

  // Count unclosed brackets/braces
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }

  // Close unclosed structures
  while (brackets > 0) { repaired += ']'; brackets--; }
  while (braces > 0) { repaired += '}'; braces--; }

  try {
    const parsed = JSON.parse(repaired);
    console.log(`    🔧 JSON repaired (closed ${repaired.length - text.trim().length} brackets)`);
    return parsed;
  } catch {
    throw new Error(`Invalid JSON response (${text.length} chars, starts with: "${text.substring(0, 80)}...")`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse sucursal_nombre "CO01 Comodin 1 - Necochea 445 - San Salvador de Jujuy"
 * → { sucursal_codigo: "CO01 Comodin 1", sucursal_direccion: "Necochea 445", sucursal_nombre: "San Salvador de Jujuy" }
 */
function parseSucursalNombre(raw: string): {
  sucursal_codigo: string | null;
  sucursal_nombre: string;
  sucursal_direccion: string | null;
} {
  const parts = raw.split(" - ").map(p => p.trim());

  if (parts.length >= 3) {
    return {
      sucursal_codigo: parts[0],
      sucursal_direccion: parts[1],
      sucursal_nombre: parts.slice(2).join(" - "),
    };
  } else if (parts.length === 2) {
    return {
      sucursal_codigo: parts[0],
      sucursal_nombre: parts[1],
      sucursal_direccion: null,
    };
  } else {
    return {
      sucursal_codigo: null,
      sucursal_nombre: raw,
      sucursal_direccion: null,
    };
  }
}

/**
 * Map merged extraction result to webhook payload format for a SINGLE sucursal.
 */
function buildWebhookPayloadForSucursal(
  mergedResult: any,
  sucursal: any,
  url: string,
  telegram_user_id: string | null,
  telegram_message_id: string | null
) {
  const parsed = parseSucursalNombre(sucursal.sucursal_nombre || "");
  
  return {
    pedidos: [
      {
        items: (sucursal.items || []).map((item: any) => ({
          raw_linea: [item.codigo, item.codigo_provincial, item.descripcion].filter(Boolean).join(" ").trim() || item.raw_linea || "",
          desc: item.descripcion || "",
          cantidad: item.cantidad || 0,
          unidad: item.ump || null,
          observaciones: null
        })),
        sucursal_codigo: parsed.sucursal_codigo,
        sucursal_nombre: parsed.sucursal_nombre,
        sucursal_direccion: parsed.sucursal_direccion
      }
    ],
    metadatos: {
      fecha_pedido: mergedResult.fecha_pedido || null,
      telegram_user_id: telegram_user_id || null,
      telegram_message_id: telegram_message_id || null,
      fecha_entrega_solicitada: mergedResult.fecha_entrega || null
    },
    raw_completo: mergedResult.raw_completo || JSON.stringify(mergedResult, null, 2),
    cliente_nombre: mergedResult.cliente_nombre || null,
    formato_origen: "PDF",
    url_archivo_origen: url
  };
}

// ─── Per-page extraction with JSON validation + retries ─────────────────────

const PAGE_MAX_RETRIES = 3;

async function extractSinglePage(
  pageNum: number,
  totalPages: number,
  buffer: Buffer,
  AI_CONFIG_CHUNKED: any
): Promise<{ pageNum: number; parsed: any | null; success: boolean; error?: string }> {

  for (let attempt = 1; attempt <= PAGE_MAX_RETRIES; attempt++) {
    const tmpPath = path.join(os.tmpdir(), `pdf-chunk-p${pageNum}-a${attempt}-${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, buffer);

    try {
      // Upload
      const uploadResult = await genAI.files.upload({
        file: tmpPath,
        config: { mimeType: "application/pdf" }
      });

      // Wait for processing
      let waitAttempt = 0;
      let state = uploadResult.state;
      while (state === 'PROCESSING' && waitAttempt < 10) {
        await new Promise(r => setTimeout(r, 1500));
        const check = await genAI.files.get({ name: uploadResult.name });
        state = check.state;
        waitAttempt++;
      }

      if (state === 'FAILED') throw new Error(`Gemini failed to process page ${pageNum}`);

      // Generate
      const prompt = `${AI_CONFIG_CHUNKED.prompts.json_extraction}\n\nEsta es la PÁGINA ${pageNum} de ${totalPages} del pedido.`;
      const config: any = {
        temperature: AI_CONFIG_CHUNKED.temperature,
        maxOutputTokens: AI_CONFIG_CHUNKED.maxOutputTokens,
        responseMimeType: "application/json",
        responseSchema: AI_CONFIG_CHUNKED.schemas.order_extraction,
      };

      const result = await genAI.models.generateContent({
        model: AI_CONFIG_CHUNKED.model,
        contents: [{
          parts: [
            { fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType } },
            { text: prompt }
          ]
        }],
        config: config as any
      });

      // Cleanup remote
      await genAI.files.delete({ name: uploadResult.name }).catch(() => {});

      const text = result.text;

      // ⚠️ VALIDATE JSON immediately — repair truncation if needed
      let parsed: any;
      try {
        parsed = tryParseJSON(text);
      } catch (parseErr: any) {
        throw parseErr; // tryParseJSON already throws a descriptive error
      }

      // Validate structure
      if (!parsed.sucursales || !Array.isArray(parsed.sucursales)) {
        throw new Error(`JSON missing 'sucursales' array`);
      }

      console.log(`  ✓ Page ${pageNum}: ${parsed.sucursales.length} sucursales, ${parsed.sucursales.reduce((s: number, su: any) => s + (su.items?.length || 0), 0)} items`);
      return { pageNum, parsed, success: true };

    } catch (err: any) {
      const errMsg = err.message || "Unknown error";
      if (attempt < PAGE_MAX_RETRIES) {
        const delay = attempt * 2000; // 2s, 4s
        console.warn(`  ⚠ Page ${pageNum} attempt ${attempt}/${PAGE_MAX_RETRIES}: ${errMsg} — retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`  ✗ Page ${pageNum} FAILED after ${PAGE_MAX_RETRIES} attempts: ${errMsg}`);
        return { pageNum, parsed: null, success: false, error: errMsg };
      }
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  // Should never reach here, but TypeScript needs it
  return { pageNum, parsed: null, success: false, error: "Exhausted retries" };
}

// ─── Extraction logic ───────────────────────────────────────────────────────

async function runChunkedExtraction(url: string) {
  const { PDFDocument } = await import("pdf-lib");
  const { AI_CONFIG_CHUNKED } = await import("./config/ai_config_chunked");

  // 1. Fetch PDF
  const pdfResponse = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
  const pdfBuffer = Buffer.from(pdfResponse.data);
  console.log(`PDF downloaded: ${pdfBuffer.length} bytes`);

  // 2. Split PDF
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  console.log(`Total pages: ${totalPages}`);

  const pageBuffers: { pageNum: number; buffer: Buffer }[] = [];
  for (let i = 0; i < totalPages; i++) {
    const singlePageDoc = await PDFDocument.create();
    const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [i]);
    singlePageDoc.addPage(copiedPage);
    const singlePageBytes = await singlePageDoc.save();
    pageBuffers.push({ pageNum: i + 1, buffer: Buffer.from(singlePageBytes) });
  }

  // 3. Process pages in batches — each page has its own 3x retry
  const BATCH_SIZE = 5;
  const allPageResults: { pageNum: number; parsed: any | null; success: boolean; error?: string }[] = new Array(totalPages).fill(null);

  for (let batchStart = 0; batchStart < pageBuffers.length; batchStart += BATCH_SIZE) {
    const batch = pageBuffers.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(pageBuffers.length / BATCH_SIZE);
    console.log(`\nBatch ${batchNum}/${totalBatches} (pages ${batch[0].pageNum}-${batch[batch.length - 1].pageNum})...`);

    const batchPromises = batch.map(({ pageNum, buffer }) =>
      extractSinglePage(pageNum, totalPages, buffer, AI_CONFIG_CHUNKED)
    );

    const batchResults = await Promise.all(batchPromises);
    for (const r of batchResults) {
      allPageResults[r.pageNum - 1] = r;
    }
  }

  // 4. Count failures (API + JSON combined — extractSinglePage handles both)
  const failedPages = allPageResults.filter(r => !r?.success);
  const okPages = allPageResults.filter(r => r?.success);

  console.log(`\n--- PAGE RESULTS: ${okPages.length} OK, ${failedPages.length} FAILED ---`);
  if (failedPages.length > 0) {
    console.warn(`Failed pages: ${failedPages.map(f => `${f?.pageNum} (${f?.error})`).join(', ')}`);
  }

  // 5. MERGE (Reduce)
  console.log(`\n--- MERGING ${okPages.length} page results ---`);

  let clienteNombre: string | null = null;
  let proveedorNombre: string | null = null;
  let numeroPedido: string | null = null;
  let fechaPedido: string | null = null;
  let fechaEntrega: string | null = null;
  let moneda: string | null = null;
  const sucursalMap = new Map<string, { sucursal_nombre: string; items: any[] }>();
  let totalesVerificacion = { total_neto: 0, imp_int: 0, iva: 0, total: 0 };
  let lastSucursalKey: string | null = null;

  for (const pageResult of allPageResults) {
    if (!pageResult?.success || !pageResult.parsed) continue;

    const parsed = pageResult.parsed;

    if (!clienteNombre && parsed.cliente_nombre) clienteNombre = parsed.cliente_nombre;
    if (!proveedorNombre && parsed.proveedor_nombre) proveedorNombre = parsed.proveedor_nombre;
    if (!numeroPedido && parsed.numero_pedido) numeroPedido = parsed.numero_pedido;
    if (!fechaPedido && parsed.fecha_pedido) fechaPedido = parsed.fecha_pedido;
    if (!fechaEntrega && parsed.fecha_entrega) fechaEntrega = parsed.fecha_entrega;
    if (!moneda && parsed.moneda) moneda = parsed.moneda;

    if (parsed.sucursales && Array.isArray(parsed.sucursales)) {
      for (const suc of parsed.sucursales) {
        let key = suc.sucursal_nombre?.trim().toLowerCase() || "desconocida";

        if (key === "continuacion_pagina_anterior" && lastSucursalKey) {
          key = lastSucursalKey;
        }

        if (sucursalMap.has(key)) {
          const existing = sucursalMap.get(key)!;
          if (suc.items && Array.isArray(suc.items)) {
            existing.items.push(...suc.items);
          }
        } else {
          sucursalMap.set(key, {
            sucursal_nombre: suc.sucursal_nombre,
            items: suc.items || []
          });
        }

        if (key !== "desconocida") {
          lastSucursalKey = key;
        }
      }
    }

    if (parsed.totales_verificacion) {
      const t = parsed.totales_verificacion;
      if (t.total && t.total > 0) {
        totalesVerificacion = t;
      }
    }
  }

  const sucursalesArray = Array.from(sucursalMap.values());
  let totalItems = 0;
  for (const s of sucursalesArray) totalItems += s.items.length;

  const mergedResult = {
    cliente_nombre: clienteNombre,
    proveedor_nombre: proveedorNombre,
    numero_pedido: numeroPedido,
    fecha_pedido: fechaPedido,
    fecha_entrega: fechaEntrega,
    moneda: moneda,
    es_multisucursal: sucursalesArray.length > 1,
    sucursales: sucursalesArray,
    totales_verificacion: totalesVerificacion
  };

  // Validation — now counts ALL failures properly
  const validation = {
    total_pages: totalPages,
    pages_ok: okPages.length,
    pages_failed: failedPages.length,
    failed_page_numbers: failedPages.map(f => f?.pageNum),
    total_items: totalItems,
    total_sucursales: sucursalesArray.length,
    total_financiero: totalesVerificacion.total,
    status: failedPages.length === 0 && totalItems > 0 && totalesVerificacion.total > 0 ? 'OK' : 'REVIEW'
  };

  console.log(`\n--- VALIDACIÓN CRUZADA ---`);
  console.log(`Pages: ${validation.pages_ok}/${validation.total_pages} OK`);
  if (failedPages.length > 0) console.log(`Failed: pages ${validation.failed_page_numbers.join(', ')}`);
  console.log(`Items: ${validation.total_items}`);
  console.log(`Sucursales: ${validation.total_sucursales}`);
  console.log(`Total Financiero: ${totalesVerificacion.total}`);
  console.log(`Status: ${validation.status}`);
  console.log(`-------------------------\n`);

  return { mergedResult, validation };
}

// ─── Server ─────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // =============================================
  // CHUNKED EXTRACTION (Map-Reduce, page by page)
  // =============================================
  app.post("/api/pdf-extract/chunked", async (req, res) => {
    const { url, telegram_user_id, telegram_message_id } = req.body;

    if (!url) {
      return res.status(400).json({ error: "PDF URL is required" });
    }

    console.log(`\n========== CHUNKED EXTRACTION ==========`);
    console.log(`URL: ${url}`);
    console.log(`Telegram User: ${telegram_user_id || 'N/A'} | Message: ${telegram_message_id || 'N/A'}`);

    // ── Extraction with 3 global retries ────────────────────────────────
    const MAX_RETRIES = 3;
    let mergedResult: any = null;
    let validation: any = null;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`\n[Extraction] Global attempt ${attempt}/${MAX_RETRIES}...`);
        const result = await runChunkedExtraction(url);
        mergedResult = result.mergedResult;
        validation = result.validation;

        if (validation.status === 'OK') {
          console.log(`[Extraction] ✓ Fully validated on attempt ${attempt}`);
          lastError = null;
          break;
        } else {
          lastError = `Validation REVIEW: ${validation.pages_failed} pages failed, ${validation.total_items} items, ${validation.total_sucursales} sucursales`;
          console.warn(`[Extraction] ⚠ ${lastError}`);
        }
      } catch (err: any) {
        lastError = err.message || "Unknown error";
        console.error(`[Extraction] ✗ Error: ${lastError}`);
      }

      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[Extraction] Waiting ${delay / 1000}s before global retry...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    if (!mergedResult || !validation || validation.status !== 'OK') {
      console.error(`[Extraction] ✗ Failed after ${MAX_RETRIES} global attempts`);
      return res.status(400).json({
        error: "Extraction failed after all retries",
        detail: lastError,
        validation: validation || null,
        telegram_user_id: telegram_user_id || null,
        telegram_message_id: telegram_message_id || null,
      });
    }

    console.log(`\n✅ EXTRACTION COMPLETE`);
    const sucursales = mergedResult.sucursales || [];
    console.log(`Found ${sucursales.length} sucursales. Sending to webhook...`);

    const webhookResponses = [];

    for (const suc of sucursales) {
      const payload = buildWebhookPayloadForSucursal(mergedResult, suc, url, telegram_user_id, telegram_message_id);
      
      try {
        const webhookUrl = process.env.WEBHOOK_URL || "https://dzzizjwrrncifohammdu.supabase.co/functions/v1/pedidos-webhook";
        const anonKey = process.env.SUPABASE_ANON_KEY || "";
        const webhookSecret = process.env.MAKE_WEBHOOK_SECRET || "";

        const response = await axios.post(webhookUrl, payload, {
          headers: {
            "Content-Type": "application/json",
            "x-webhook-secret": webhookSecret,
            "Authorization": `Bearer ${anonKey}`
          }
        });
        console.log(`  ✓ Webhook call for ${payload.pedidos[0].sucursal_nombre} SUCCESS: ${response.status}`);
        webhookResponses.push({ sucursal: payload.pedidos[0].sucursal_nombre, status: "success", data: response.data });
      } catch (err: any) {
        console.error(`  ✗ Webhook call for ${payload.pedidos[0].sucursal_nombre} FAILED:`, err.message);
        webhookResponses.push({ sucursal: payload.pedidos[0].sucursal_nombre, status: "error", error: err.message });
      }
    }

    res.status(200).json({
      message: "Procesamiento completado",
      validation,
      webhookResponses,
      telegram_user_id: telegram_user_id || null,
      telegram_message_id: telegram_message_id || null,
    });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
