import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    // Let's draw a dummy 1-page PDF base64
    const mockPDFBase64 = "JVBERi0xLjQKMSAwIG9iagogIDw8IC9UeXBlIC9DYXRhbG9nCiAgICAgL1BhZ2VzIDIgMCBSCiAgPj4KZW5kb2JqCjIgMCBvYmoKICA8PCAvVHlwZSAvUGFnZXMKICAgICAvS2lkcyBbIDMgMCBSIF0KICAgICAvQ291bnQgMQogID4+CmVuZG9iagozIDAgb2JqCiAgPDwgL1R5cGUgL1BhZ2UKICAgICAvUGFyZW50IDIgMCBSCiAgICAgL01lZGlhQm94IFsgMCAwIDU5NSA4NDIgXQogICAgIC9Db250ZW50cyA0IDAgUgogID4+CmVuZG9iago0IDAgb2JqCiAgPDwgL0xlbmd0aCAxNSA+PgpzdHJlYW0KQlQgL0YxIDEyIFRmIEVUKQplbmRzdHJlYW0KZW5kb2JqCnRyYWlsZXIKICA8PCAvUm9vdCAxIDAgUgogID4+CiUlRU9G";
    
    console.log("Testing with PDF via inlineData on gemini-3.5-flash...");
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "application/pdf",
            data: mockPDFBase64
          }
        },
        "Describe this document."
      ]
    });
    console.log("PDF inlineData success:", response.text);
  } catch (err: any) {
    console.error("PDF inlineData failed!");
    console.error("Error Message:", err?.message || err);
    console.error("Error Status:", err?.status);
  }
}

run();
