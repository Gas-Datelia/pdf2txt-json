import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API to fetch PDF and return as base64
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
