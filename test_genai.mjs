import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    const config = {
      temperature: 1.0,
      maxOutputTokens: 65536,
      thinkingConfig: { thinkingLevel: "medium" }
    };
    console.log("Testing with config:", config);
    const resp = await genAI.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: "Hello",
      config: config
    });
    console.log("Success:", resp.text);
  } catch (e) {
    console.error("FAILED!");
    console.error(e.message);
    if (e.status) console.error("Status:", e.status);
    if (e.response) console.error("Response:", e.response);
  }
}
run();
