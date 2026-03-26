import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import axios from "axios";
import os from "os";
import path from "path";

dotenv.config({ path: ".env.local" });
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    const url = 'https://dzzizjwrrncifohammdu.supabase.co/storage/v1/object/public/uploads/pdf/Orden_de_Compra_11_paginas.pdf';
    const pdfResponse = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
    const mimeType = pdfResponse.headers["content-type"] || "application/pdf";

    const tmpFilePath = path.join(os.tmpdir(), `pdf-${Date.now()}.pdf`);
    fs.writeFileSync(tmpFilePath, Buffer.from(pdfResponse.data));

    console.log("Uploading...");
    const uploadResult = await genAI.files.upload({
      file: tmpFilePath,
      config: { mimeType: mimeType }
    });
    
    // Wait for document processing
    let attempt = 0;
    let currentState = uploadResult.state;
    while (currentState === 'PROCESSING' && attempt < 15) {
      console.log(`Waiting... ${attempt}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      const check = await genAI.files.get({ name: uploadResult.name });
      currentState = check.state;
      attempt++;
    }

    const config = {
      temperature: 1.0,
      maxOutputTokens: 65536,
      thinkingConfig: { thinkingLevel: "medium" }
    };
    
    console.log("Generating Content with fileData...");
    const resp = await genAI.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [
        {
          parts: [
            { fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType } },
            { text: "Extrae texto" }
          ]
        }
      ],
      config: config
    });
    console.log("Success:", resp.text.length);
  } catch (e) {
    console.error("FAILED!");
    console.error(e.message);
    if (e.status) console.error("Status:", e.status);
    if (e.response && e.response.data) {
        console.error("Data Buffer string:", e.response.data.toString());
    }
  }
}
run();
