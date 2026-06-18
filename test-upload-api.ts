import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

dotenv.config();

console.log("=== DIAGNOSTIC START ===");
const globalAgent = new EnvHttpProxyAgent({
  headersTimeout: 300000,
  bodyTimeout: 300000,
  connectTimeout: 300000,
});
setGlobalDispatcher(globalAgent);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
    timeout: 300000,
  },
});

async function run() {
  try {
    const payloadParts = [
      {
        text: "The syllabus/document filename is: 'test.html'. Here are the contents:\n\nHello World Math Concept: E = mc^2"
      }
    ];
    const textPrompt = "You are an expert academic curriculum structure extraction assistant. Extract everything and format math in LaTeX.";
    const extractionPayloadParts = [
      ...payloadParts,
      { text: textPrompt }
    ];

    console.log("Calling generateContent with contents: { parts: ... }");
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: { parts: extractionPayloadParts }
    });
    console.log("Got response successfully:", response.text ? response.text.substring(0, 100) + "..." : "empty");
  } catch (err: any) {
    console.error("SDK Call failed!");
    console.error("Error Message:", err?.message || err);
    console.error("Error Stack:", err?.stack);
  }
}

run().then(() => console.log("=== DIAGNOSTIC END ==="));
