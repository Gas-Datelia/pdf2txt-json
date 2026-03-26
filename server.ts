import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import cors from "cors";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";

import { AI_CONFIG } from "./config/ai_config";

dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: { timeout: 300_000 } // 5 minutos — necesario para thinkingLevel: high con PDFs grandes
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API to fetch PDF and return as base64 (already here, but /api/extract is better)
  app.get("/api/fetch-pdf", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      const base64 = Buffer.from(response.data).toString("base64");
      const contentType = response.headers["content-type"] || "application/pdf";
      
      console.log(`Fetched PDF from ${url}. Size: ${response.data.length} bytes. Content-Type: ${contentType}`);
      
      res.json({ 
        base64, 
        mimeType: contentType 
      });
    } catch (error: any) {
      console.error("Error fetching PDF:", error.message);
      res.status(500).json({ error: "Failed to fetch PDF from URL" });
    }
  });

  // NEW API: Extract content from PDF URL
  app.post("/api/extract", async (req, res) => {
    const { url, mode = 'json' } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: "PDF URL is required" });
    }

    try {
      console.log(`Extracting ${mode} from ${url}...`);
      
      // 1. Fetch PDF
      const pdfResponse = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
      const mimeType = pdfResponse.headers["content-type"] || "application/pdf";

      // Write to temp file
      const tmpFilePath = path.join(os.tmpdir(), `pdf-${Date.now()}.pdf`);
      fs.writeFileSync(tmpFilePath, Buffer.from(pdfResponse.data));

      let uploadResult;
      try {
        console.log("Uploading PDF to Gemini Files API...");
        uploadResult = await genAI.files.upload({
          file: tmpFilePath,
          config: { mimeType: mimeType }
        });
        console.log(`Uploaded to ${uploadResult.uri}`);
        
        // Wait for document processing
        let attempt = 0;
        let currentState = uploadResult.state;
        while (currentState === 'PROCESSING' && attempt < 15) {
          console.log(`Waiting for PDF processing... attempt ${attempt + 1}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          const check = await genAI.files.get({ name: uploadResult.name });
          currentState = check.state;
          attempt++;
        }

        if (currentState === 'FAILED') {
          throw new Error("Gemini failed to process the PDF document.");
        }

        const prompt = mode === 'json' ? AI_CONFIG.prompts.json_extraction : AI_CONFIG.prompts.text_extraction;

        const config: any = {
          temperature: AI_CONFIG.temperature,
          maxOutputTokens: AI_CONFIG.maxOutputTokens,
        };

        if (mode === 'json') {
          config.responseMimeType = "application/json";
          config.responseSchema = AI_CONFIG.schemas.order_extraction;
        }

        console.log("Generating content...");
        const extractResult = await genAI.models.generateContent({
          model: AI_CONFIG.model,
          contents: [
            {
              parts: [
                { fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType } },
                { text: prompt }
              ]
            }
          ],
          config: config as any
        });

        let text = extractResult.text;
        
        // Debugging information
        const candidate = extractResult.candidates?.[0];
        const finishReason = candidate?.finishReason;
        const usageMetadata = extractResult.usageMetadata;
        
        console.log("\n--- DEBUG INFO ---");
        console.log(`Finish Reason: ${finishReason}`);
        console.log(`Usage Metadata: ${JSON.stringify(usageMetadata)}`);
        console.log(`Text Length: ${text.length} characters`);
        console.log("Ultimas 100 letras del texto:");
        console.log(text.substring(text.length - 100));
        console.log("------------------\n");

        if (mode === 'json') {
          try {
            const parsed = JSON.parse(text);
            
            // --- VALIDACIÓN CRUZADA (Zero Data Loss) ---
            let totalItems = 0;
            if (parsed.sucursales && Array.isArray(parsed.sucursales)) {
              for (const suc of parsed.sucursales) {
                if (suc.items && Array.isArray(suc.items)) {
                  totalItems += suc.items.length;
                }
              }
            }
            
            const totalExtraido = parsed.totales_verificacion?.total || 0;
            const totalNeto = parsed.totales_verificacion?.total_neto || 0;
            const numSucursales = parsed.sucursales?.length || 0;
            
            console.log("\n--- VALIDACIÓN CRUZADA ---");
            console.log(`Total Items extraídos: ${totalItems}`);
            console.log(`Sucursales: ${numSucursales}`);
            console.log(`es_multisucursal: ${parsed.es_multisucursal}`);
            console.log(`Total Neto: ${totalNeto}`);
            console.log(`Total Final: ${totalExtraido}`);
            console.log("--------------------------\n");
            
            res.json({ 
              type: 'json', 
              data: parsed,
              validation: {
                total_items: totalItems,
                total_sucursales: numSucursales,
                total_financiero: totalExtraido,
                status: totalItems > 0 && totalExtraido > 0 ? 'OK' : 'REVIEW'
              }
            });
          } catch (e) {
            res.json({ type: 'text', data: text, error: "Invalid JSON from AI" });
          }
        } else {
          res.json({ type: 'text', data: text });
        }

        // Cleanup remotely
        await genAI.files.delete({ name: uploadResult.name }).catch(e => console.error("Failed to delete remote file:", e));

      } finally {
        if (fs.existsSync(tmpFilePath)) {
          fs.unlinkSync(tmpFilePath);
        }
      }

    } catch (error: any) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: error.message || "Error processing PDF" });
    }
  });

  // =============================================
  // CHUNKED EXTRACTION (Map-Reduce, page by page)
  // =============================================
  app.post("/api/extract-chunked", async (req, res) => {
    const { url, mode = 'json' } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: "PDF URL is required" });
    }

    try {
      const { PDFDocument } = await import("pdf-lib");
      const { AI_CONFIG_CHUNKED } = await import("./config/ai_config_chunked");

      console.log(`\n========== CHUNKED EXTRACTION ==========`);
      console.log(`URL: ${url}`);
      console.log(`Mode: ${mode}`);
      
      // 1. Fetch PDF
      const pdfResponse = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
      const pdfBuffer = Buffer.from(pdfResponse.data);
      console.log(`PDF downloaded: ${pdfBuffer.length} bytes`);

      // 2. Split PDF into individual pages using pdf-lib
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
      console.log(`Split into ${pageBuffers.length} individual page PDFs`);

      // 3. Process pages in parallel batches
      const BATCH_SIZE = 5;
      const allPageResults: any[] = new Array(totalPages).fill(null);

      for (let batchStart = 0; batchStart < pageBuffers.length; batchStart += BATCH_SIZE) {
        const batch = pageBuffers.slice(batchStart, batchStart + BATCH_SIZE);
        const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(pageBuffers.length / BATCH_SIZE);
        console.log(`\nProcessing batch ${batchNum}/${totalBatches} (pages ${batch[0].pageNum}-${batch[batch.length - 1].pageNum})...`);

        const batchPromises = batch.map(async ({ pageNum, buffer }) => {
          const tmpPath = path.join(os.tmpdir(), `pdf-chunk-p${pageNum}-${Date.now()}.pdf`);
          fs.writeFileSync(tmpPath, buffer);

          try {
            // Upload single page to Files API
            const uploadResult = await genAI.files.upload({
              file: tmpPath,
              config: { mimeType: "application/pdf" }
            });

            // Wait for processing
            let attempt = 0;
            let state = uploadResult.state;
            while (state === 'PROCESSING' && attempt < 10) {
              await new Promise(r => setTimeout(r, 1500));
              const check = await genAI.files.get({ name: uploadResult.name });
              state = check.state;
              attempt++;
            }

            if (state === 'FAILED') {
              throw new Error(`Gemini failed to process page ${pageNum}`);
            }

            const prompt = mode === 'json' 
              ? `${AI_CONFIG_CHUNKED.prompts.json_extraction}\n\nEsta es la PÁGINA ${pageNum} de ${totalPages} del pedido.`
              : `${AI_CONFIG_CHUNKED.prompts.text_extraction}\n\nPágina ${pageNum} de ${totalPages}.`;

            const config: any = {
              temperature: AI_CONFIG_CHUNKED.temperature,
              maxOutputTokens: AI_CONFIG_CHUNKED.maxOutputTokens,
            };

            if (mode === 'json') {
              config.responseMimeType = "application/json";
              config.responseSchema = AI_CONFIG_CHUNKED.schemas.order_extraction;
            }

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

            // Cleanup remote file
            await genAI.files.delete({ name: uploadResult.name }).catch(() => {});

            const text = result.text;
            console.log(`  ✓ Page ${pageNum}: ${text.length} chars`);
            return { pageNum, text, success: true };

          } catch (err: any) {
            console.error(`  ✗ Page ${pageNum} error: ${err.message}`);
            return { pageNum, text: null, success: false, error: err.message };
          } finally {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          }
        });

        const batchResults = await Promise.all(batchPromises);
        for (const r of batchResults) {
          allPageResults[r.pageNum - 1] = r;
        }
      }

      // 4. Check for failures
      const failed = allPageResults.filter(r => !r?.success);
      if (failed.length > 0) {
        console.warn(`\n⚠ ${failed.length} pages failed: ${failed.map(f => f?.pageNum).join(', ')}`);
      }

      if (mode === 'text') {
        // Simple text mode: concatenate all pages in order
        const fullText = allPageResults
          .filter(r => r?.success)
          .map(r => `--- Página ${r.pageNum} ---\n${r.text}`)
          .join('\n\n');
        return res.json({ type: 'text', data: fullText, pages: totalPages });
      }

      // 5. JSON Mode: MERGE (Reduce) all page results
      console.log(`\n--- MERGING ${totalPages} page results ---`);

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
        if (!pageResult?.success || !pageResult.text) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(pageResult.text);
        } catch {
          console.warn(`  Page ${pageResult.pageNum}: invalid JSON, skipping`);
          continue;
        }

        // Extract metadata from wherever it appears first
        if (!clienteNombre && parsed.cliente_nombre) clienteNombre = parsed.cliente_nombre;
        if (!proveedorNombre && parsed.proveedor_nombre) proveedorNombre = parsed.proveedor_nombre;
        if (!numeroPedido && parsed.numero_pedido) numeroPedido = parsed.numero_pedido;
        if (!fechaPedido && parsed.fecha_pedido) fechaPedido = parsed.fecha_pedido;
        if (!fechaEntrega && parsed.fecha_entrega) fechaEntrega = parsed.fecha_entrega;
        if (!moneda && parsed.moneda) moneda = parsed.moneda;

        // Merge sucursales
        if (parsed.sucursales && Array.isArray(parsed.sucursales)) {
          for (const suc of parsed.sucursales) {
            let key = suc.sucursal_nombre?.trim().toLowerCase() || "desconocida";

            // Handle continuation from previous page
            if (key === "continuacion_pagina_anterior" && lastSucursalKey) {
              key = lastSucursalKey;
            }

            if (sucursalMap.has(key)) {
              // Append items to existing sucursal
              const existing = sucursalMap.get(key)!;
              if (suc.items && Array.isArray(suc.items)) {
                existing.items.push(...suc.items);
              }
            } else {
              // New sucursal
              sucursalMap.set(key, {
                sucursal_nombre: key === lastSucursalKey ? sucursalMap.get(key)!.sucursal_nombre : suc.sucursal_nombre,
                items: suc.items || []
              });
            }

            // Track last sucursal for continuations
            if (key !== "desconocida") {
              lastSucursalKey = key;
            }
          }
        }

        // Take totals from the page that actually has them (non-zero)
        if (parsed.totales_verificacion) {
          const t = parsed.totales_verificacion;
          if (t.total && t.total > 0) {
            totalesVerificacion = t;
          }
        }
      }

      // Build final merged JSON
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

      console.log(`\n--- VALIDACIÓN CRUZADA (CHUNKED) ---`);
      console.log(`Total Pages Processed: ${totalPages - failed.length}/${totalPages}`);
      console.log(`Total Items extraídos: ${totalItems}`);
      console.log(`Sucursales: ${sucursalesArray.length}`);
      console.log(`es_multisucursal: ${mergedResult.es_multisucursal}`);
      console.log(`Total Neto: ${totalesVerificacion.total_neto}`);
      console.log(`Total Final: ${totalesVerificacion.total}`);
      console.log(`------------------------------------\n`);

      res.json({
        type: 'json',
        data: mergedResult,
        validation: {
          total_pages: totalPages,
          pages_ok: totalPages - failed.length,
          pages_failed: failed.length,
          total_items: totalItems,
          total_sucursales: sucursalesArray.length,
          total_financiero: totalesVerificacion.total,
          status: failed.length === 0 && totalItems > 0 && totalesVerificacion.total > 0 ? 'OK' : 'REVIEW'
        }
      });

    } catch (error: any) {
      console.error("Chunked extraction error:", error);
      res.status(500).json({ error: error.message || "Error in chunked extraction" });
    }
  });

  // Vite middleware for development
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
