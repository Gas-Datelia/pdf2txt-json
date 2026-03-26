import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    const config = {
      temperature: 1.0,
      maxOutputTokens: 65536,
      thinkingConfig: { thinkingLevel: "medium" },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: { answer: { type: Type.STRING } }
      }
    };
    const resp = await genAI.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: "Hello",
      config: config
    });
    console.log("Success:", resp.text);
  } catch (e) {
    if (e.status) console.error("Status:", e.status);
    console.error(e.message);
  }
}
run();
