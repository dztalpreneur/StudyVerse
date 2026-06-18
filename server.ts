import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import dotenv from "dotenv";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

// Load environment variables
dotenv.config();

console.log(`[Diagnostic] HTTP_PROXY: ${process.env.HTTP_PROXY || process.env.http_proxy || 'none'}, HTTPS_PROXY: ${process.env.HTTPS_PROXY || process.env.https_proxy || 'none'}`);

// Override Node's global dispatcher with EnvHttpProxyAgent to preserve system's pre-configured proxy environment settings
// in Cloud Run containers, while setting a high timeout (5 minutes) for parsing large visual documents.
const globalAgent = new EnvHttpProxyAgent({
  headersTimeout: 300000,
  bodyTimeout: 300000,
  connectTimeout: 300000,
});
setGlobalDispatcher(globalAgent);

const app = express();
const PORT = 3000;

// Shared Gemini Client
// We must set the 'User-Agent' header to 'aistudio-build' in httpOptions for telemetry.
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
    timeout: 300000, // Explicitly configure 5-minute timeout at the SDK layer
  },
});

// Robust generateContent helper with retry, backoff, and model fallback to handle 503, 429 quota limits, and high demand errors.
async function generateContentWithRetry(params: { model: string; contents: any; config?: any }, retries = 5, initialDelay = 1500) {
  let delay = initialDelay;
  const originalModel = params.model;
  
  // Define sequence based on the starting model
  let modelSequence = [originalModel];
  if (originalModel === "gemini-3.5-flash") {
    modelSequence = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
  } else if (originalModel === "gemini-flash-latest") {
    modelSequence = ["gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-3.5-flash"];
  } else if (originalModel === "gemini-3.1-flash-lite") {
    modelSequence = ["gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.5-flash"];
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    // Select model for this attempt
    const modelIndex = (attempt - 1) % modelSequence.length;
    params.model = modelSequence[modelIndex];

    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const errMsg = err?.message || "";
      const errStatus = err?.status;
      const errString = (String(err) + " " + JSON.stringify(err)).toLowerCase();

      const isQuotaOrStatus429 = errMsg.includes("429") || 
                                 errMsg.toUpperCase().includes("RESOURCE_EXHAUSTED") || 
                                 errMsg.toLowerCase().includes("quota") || 
                                 errStatus === 429 ||
                                 errString.includes("429") ||
                                 errString.includes("resource_exhausted") ||
                                 errString.includes("quota") ||
                                 errString.includes("limit_exceeded");

      const isTransient = errMsg.includes("503") || 
                          errMsg.toLowerCase().includes("unavailable") || 
                          errMsg.toLowerCase().includes("high demand") || 
                          errMsg.toLowerCase().includes("overloaded") || 
                          errStatus === 503 ||
                          errString.includes("503") ||
                          errString.includes("unavailable") ||
                          errString.includes("high demand") ||
                          errString.includes("overloaded") ||
                          errString.includes("service unavailable");

      const isNetworkError = errString.includes("fetch failed") ||
                             errString.includes("timeout") ||
                             errString.includes("network") ||
                             errString.includes("disconnect") ||
                             errString.includes("econnreset") ||
                             errString.includes("econnrefused") ||
                             errString.includes("closed") ||
                             errString.includes("socket");

      if ((isTransient || isQuotaOrStatus429 || isNetworkError) && attempt < retries) {
        const nextModelIndex = attempt % modelSequence.length;
        const nextModel = modelSequence[nextModelIndex];
        
        console.warn(
          `[REST Server] API non-fatal issue on model "${params.model}" (Attempt ${attempt}/${retries}, ` +
          `${isQuotaOrStatus429 ? "quota" : isNetworkError ? "network" : "demand spike"}). ` +
          `Falling back to "${nextModel}" in ${delay}ms...`
        );
        
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 1.5; // exponential backoff
      } else {
        console.error(`[REST Server] API Call generated FATAL error on model "${params.model}" (Attempt ${attempt}/${retries}):`, err);
        throw err;
      }
    }
  }
}

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));

// Gracefully handle "Payload Too Large" errors without dropping connection
app.use((err: any, req: any, res: any, next: any) => {
  if (err && (err.status === 413 || err.type === "entity.too.large")) {
    console.error("[REST Server] Payload too large error caught:", err);
    return res.status(413).json({
      success: false,
      error: "File is too large! Please upload a syllabus document smaller than 12MB to avoid network and server limits."
    });
  }
  next(err);
});

// Key document-driven syllabus store
interface ActiveDoc {
  filename: string;
  mimeType: string;
  markdown: string;
  mode?: string;
  detectedSubject?: string;
}

function normalizeSubjectName(rawName: string): string {
  let normalizedSubject = rawName.replace(/[._#*`"]/g, "").trim();
  const lowerSubj = normalizedSubject.toLowerCase();
  if (lowerSubj.includes("math") || lowerSubj.includes("ganit")) {
    return "Mathematics";
  } else if (lowerSubj.includes("physics") || lowerSubj.includes("bhautik")) {
    return "Physics";
  } else if (lowerSubj.includes("chem") || lowerSubj.includes("rasayan")) {
    return "Chemistry";
  } else if (lowerSubj.includes("bio") || lowerSubj.includes("jeev")) {
    return "Biology";
  } else if (lowerSubj.includes("history") || lowerSubj.includes("itihas")) {
    return "History";
  } else if (lowerSubj.includes("geography") || lowerSubj.includes("bhoogol")) {
    return "Geography";
  } else if (lowerSubj.includes("civic") || lowerSubj.includes("polity") || lowerSubj.includes("political")) {
    return "Civics";
  } else if (lowerSubj.includes("computer") || lowerSubj.includes("coding") || lowerSubj.includes("it")) {
    return "Computer Science";
  } else if (lowerSubj.includes("english") || lowerSubj.includes("angreji")) {
    return "English";
  } else if (lowerSubj.includes("hindi")) {
    return "Hindi";
  }
  return normalizedSubject || "All Science";
}

function sliceMarkdownToTopics(markdown: string): string[] {
  if (!markdown) return [];
  const lines = markdown.split("\n");
  const parsedTopics: string[] = [];
  let currentBlock = "";
  
  let hasHeaders = false;
  for (const line of lines) {
    if (line.trim().startsWith("#")) {
      hasHeaders = true;
      break;
    }
  }
  
  if (hasHeaders) {
    for (const line of lines) {
      if (line.trim().startsWith("#")) {
        if (currentBlock.trim()) {
          parsedTopics.push(currentBlock.trim());
        }
        currentBlock = line + "\n";
      } else {
        currentBlock += line + "\n";
      }
    }
    if (currentBlock.trim()) {
      parsedTopics.push(currentBlock.trim());
    }
  } else {
    // Split by empty paragraphs
    const sections = markdown.split(/\n\s*\n+/);
    for (const sec of sections) {
      if (sec.trim()) {
        parsedTopics.push(sec.trim());
      }
    }
  }
  
  return parsedTopics;
}

let activeDocument: ActiveDoc | null = null;

// Global memory store for persistent live session state across WebSocket reconnections
interface SessionBackup {
  history: Array<{ sender: "student" | "cherry"; text: string }>;
  teachingPhase: string;
  whiteboardNotes: string;
  activeTopicIndex?: number;
}

let activeSessionBackup: SessionBackup = {
  history: [],
  teachingPhase: "intro",
  whiteboardNotes: "",
  activeTopicIndex: 0,
};

// API Document Upload & Parser endpoint
app.post("/api/upload-document", async (req, res) => {
  const { filename, mimeType, base64Data, mode } = req.body;
  if (!base64Data || !mimeType || !filename) {
    return res.status(400).json({ error: "Missing filename, mimeType, or base64Data in body." });
  }

  try {
    console.log(`[REST Server] Processing uploaded file: ${filename} (${mimeType}), mode: ${mode || "explain"}, size: ~${Math.round(base64Data.length / 1024)} KB`);
    
    let isTextFile = false;
    let textContent = "";
    const lowerName = filename.toLowerCase();
    const lowerMime = mimeType.toLowerCase();
    
    if (
      lowerMime.startsWith("text/") ||
      lowerMime === "application/json" ||
      lowerMime === "application/javascript" ||
      lowerMime === "application/xml" ||
      lowerName.endsWith(".txt") ||
      lowerName.endsWith(".md") ||
      lowerName.endsWith(".markdown") ||
      lowerName.endsWith(".json") ||
      lowerName.endsWith(".csv") ||
      lowerName.endsWith(".html") ||
      lowerName.endsWith(".xml") ||
      lowerName.endsWith(".js") ||
      lowerName.endsWith(".ts") ||
      lowerName.endsWith(".tsx") ||
      lowerName.endsWith(".jsx")
    ) {
      isTextFile = true;
      try {
        textContent = Buffer.from(base64Data, "base64").toString("utf-8");
      } catch (errDec) {
        console.error("[REST Server] Failed to decode base64 text file content:", errDec);
        isTextFile = false;
      }
    }

    const payloadParts: any[] = [];
    if (isTextFile) {
      console.log(`[REST Server] Identified as text file. Sending parsed string buffer: ${textContent.length} characters.`);
      payloadParts.push({
        text: `The syllabus/document filename is: "${filename}". Here are the contents:\n\n${textContent}`
      });
    } else {
      payloadParts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data,
        },
      });
    }

    const isMistakeMode = mode === "mistake";
    let textPrompt = "";
    if (isMistakeMode) {
      textPrompt = "You are a deeply analytical academic mentor in Mathematics, Physics, and Chemistry for school syllabi (classes 6th to 12th). " +
                   "The uploaded document represents a student's own handwritten notes, exam sheet, or calculation work. " +
                   "Please deeply analyze this document to identify ANY and ALL mistakes, mathematical calculation errors, formula misuse, or visual diagram bugs. " +
                   "Write a comprehensive step-by-step diagnostic feedback report in Markdown: " +
                   "- Under '# Student Attempt', summarize what the student attempts to calculate/solve. " +
                   "- Under '## Identified Mistakes 🔍', list any specific calculations, signs, or logic where they made a mistake, explaining why it is wrong and what the misconception was. " +
                   "- Under '## Correct Step-by-Step Solution 📐', write down the fully correct step-by-step mathematical calculations and explanations. " +
                   "- You MUST format all mathematical formulas, physics equations, chemical structures, or scientific symbols inside standard LaTeX notation. Use $$ for display blocks and $ for inline math. " +
                   "- HIGH-FIDELITY SAME-TO-SAME DIAGRAM DRAWING PROTOCOL: If the solution involves any visual diagram, coordinate plot, geometric shape, optical layout, electrical circuit, cycle, flowchart, chemical skeletal model, or biological structure, you MUST represent it using a beautiful inline, responsive, custom XML SVG vector drawing that copies the geometry, coordinate alignment, components, and text labels of the uploaded document diagram SAME-TO-SAME. Follow these layout construction requirements meticulously:\n" +
                   "  1. COMPONENT-AND-ALIGNMENT EXACTNESS: Do not substitute with a generic class diagram. Examine the elements in the uploaded image/PDF page exactly. Map components (e.g. lens curvatures, block incline angles, pulleys, resistors, cells, and specific chemical bonds) to corresponding coordinate positions in a clear SVG viewBox (e.g., `viewBox='0 0 400 250'`).\n" +
                   "  2. RAZOR-SHARP GEOMETRIC PRIMITIVES: Synthesize exact coordinates and properties for lines, paths, circles, and polygons. For vector arrows, define a reusable `<marker>` at the beginning of the SVG node inside a `<defs>` segment and attach it using `marker-end='url(#arrow)'` on lines. Never construct vector arrow tips with sloppy individual line paths.\n" +
                   "  3. NO PLACEHOLDERS: Bounding boxes or placeholders are forbidden. Every segment, curve, arrow boundary, and wire connection must be fully coded as high-fidelity renderable nodes.\n" +
                   "  4. CHALKBOARD NEON PALETTE: Avoid black/dark strokes. Use glowing chalk-like colors: Yellow (`#fde047`), Teal/Cyan (`#22d3ee`), Emerald Green (`#34d399`), Rose Pink (`#f472b6`), Neon Violet (`#c084fc`), Orange (`#f97316`), and Chalk White (`#cbd5e1`). Set translucent fill opacities (`fill-opacity='0.15'`) for shaded areas.\n" +
                   "  5. TEXT AND LABEL MARGINS: Place all variable tags and unit labels (e.g., $\\theta$, $F$, $R_1$) perfectly using native `<text>` elements offset securely from geometry lines to prevent collision. Set `text-anchor='middle'` and font size 12.\n" +
                   "  6. COMPLETE & VALID XML ONLY: Every SVG node block must be perfectly completed and closed. Never output unclosed tags.\n\n" +
                   "Do NOT write any meta-introductions or conversational fillers. Generate clean, organized Markdown notes.";
    } else {
      textPrompt = "You are an expert academic curriculum structure extraction assistant. " +
                   "Please analyze this uploaded document (PDF, Image, or text file) and extract ALL educational study files & lecture material in extremely high fidelity. " +
                   "Do NOT summarize, do NOT write meta-commentaries or conversational introductions like 'Here is the parsed content'. " +
                   "Extract every single section, heading, sub-heading, text, definition, and math formula in its exact sequential logical flow. " +
                   "You MUST format all mathematical formulas, physics equations, chemical structures, or scientific symbols inside standard LaTeX notation. " +
                   "Use $$ double dollar signs on separate lines for display block equations, and $ single dollar signs for inline math formulas (e.g. $E = mc^2$, $H_2O$). " +
                   "If there are any visual diagrams, flowcharts, anatomical systems, graphs, cycles, plots, circuits, or drawings in the document, you MUST represent them exactly in high fidelity using beautifully designed inline responsive vector SVG XML nodes (e.g. `<svg viewBox='0 0 320 200' className='w-full max-w-[320px] h-[200px]'> ... </svg>`) inserted in the corresponding sequential flow of the notes. " +
                   "HIGH-FIDELITY SAME-TO-SAME DIAGRAM DRAWING PROTOCOL: Each SVG must replicate the layout, coordinate systems, alignment, visual vectors, component topologies, and text annotations of the diagram present in the uploaded document SAME-TO-SAME. Follow these rules:\n" +
                   "  1. DETAILED COMPONENT EXTRACTION: Study the visual alignment in the PDF/image. Do not estimate from generic templates. Place each item (battery segment, resistor zig-zag, lens boundary, block slope, cycle box) in its exact relevant visual topology using coordinates in a clean viewBox (e.g., `0 0 400 250` or `0 0 320 200`).\n" +
                   "  2. SHARP PRIMITIVES & VECTORS: Use precise SVG lines, paths, circles, rectangles, and polygons. Always declare a reusable arrow marker in `<defs><marker id='arrow' viewBox='0 0 10 10' refX='6' refY='5' markerWidth='6' markerHeight='6' orient='auto-start-reverse'><path d='M 0 1.5 L 8 5 L 0 8.5 z' fill='currentColor' /></marker></defs>` and link it with `marker-end='url(#arrow)'` on lines.\n" +
                   "  3. NO SCHEMATIC LAZY PLACEHOLDERS: Avoid blank placeholder shapes. Write complete, elegant, and high-fidelity XML properties representing actual vectors, flows, circuits, or biological layers.\n" +
                   "  4. HIGH-CONTRAST NEON CHALK PALETTE: No black or dark lines. Use neon green (`#34d399`), cyan (`#22d3ee`), yellow (`#fde047`), orange (`#f97316`), pink (`#f472b6`), violet (`#c084fc`), or clean white (`#cbd5e1`). Set block fill opacities (`fill-opacity='0.14'`) for shaded areas.\n" +
                   "  5. TEXT & LABEL PLACEMENT: Replicate every symbol and label. Offset annotations using `<text>` nodes securely with `text-anchor='middle'` and font size 12 to avoid wire overlapping.\n" +
                   "  6. COMPLETE XML ONLY: Every SVG node must be fully completed and closed. Truncation or layout cut-off is strictly prohibited.\n" +
                   "Extract the content in the sequential order of the original notes. Organize the text beautifully with Markdown headings (#, ##, ###), bold highlights (**text**), and bulleted/numbered lists representing exact classroom-style textbook notes.";
    }

    const extractionPayloadParts = [
      ...payloadParts,
      { text: textPrompt }
    ];

    console.log(`[REST Server] Actively extracting syllabus content for: "${filename}"`);

    const extractionResponse = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: { parts: extractionPayloadParts },
    });

    const markdown = extractionResponse && extractionResponse.text ? extractionResponse.text : "Failed to extract content from the document.";
    
    // Quick, non-blocking subject classifier using text keywords matched against extracted markdown, or a fast lightweight classifier call on text
    let rawDetectedSubject = "All Science";
    const lowerMarkdown = markdown.toLowerCase();

    // 1. Fast heuristic local keyword checking to bypass heavy model requests
    if (lowerMarkdown.includes("physics") || lowerMarkdown.includes("kinematics") || lowerMarkdown.includes("force") || lowerMarkdown.includes("velocity") || lowerMarkdown.includes("thermodynamics") || lowerMarkdown.includes("optics") || lowerMarkdown.includes("electromagnetism")) {
      rawDetectedSubject = "Physics";
    } else if (lowerMarkdown.includes("chemistry") || lowerMarkdown.includes("chemical") || lowerMarkdown.includes("reaction") || lowerMarkdown.includes("molecule") || lowerMarkdown.includes("benzene") || lowerMarkdown.includes("covalent") || lowerMarkdown.includes("acid")) {
      rawDetectedSubject = "Chemistry";
    } else if (lowerMarkdown.includes("math") || lowerMarkdown.includes("calculus") || lowerMarkdown.includes("integral") || lowerMarkdown.includes("derivative") || lowerMarkdown.includes("algebra") || lowerMarkdown.includes("geometry") || lowerMarkdown.includes("trigonometry") || lowerMarkdown.includes("matrix")) {
      rawDetectedSubject = "Mathematics";
    } else if (lowerMarkdown.includes("biology") || lowerMarkdown.includes("cell") || lowerMarkdown.includes("dna") || lowerMarkdown.includes("evolution") || lowerMarkdown.includes("organism")) {
      rawDetectedSubject = "Biology";
    } else {
      // 2. Fall back to a lightweight, fast model classification of the text content (not raw base64 data!)
      try {
        console.log("[REST Server] Local keywords inconclusive. Performing quick text-based subject classification with Gemini Lite...");
        const snippetText = markdown.substring(0, 3000);
        const subjectCall = await generateContentWithRetry({
          model: "gemini-3.1-flash-lite", // extremely fast & light
          contents: {
            parts: [{
              text: "Analyze the educational notes snippet below and determine its main academic subject. " +
                    "Return ONLY the subject name as a single clean capitalized word representing the main discipline (e.g. 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Economics', 'Civics', 'Computer Science', etc.). " +
                    "Do not write sentences, explanation, or markdown formatting.\n\nNotes snippet:\n" + snippetText
            }]
          }
        });
        if (subjectCall && subjectCall.text) {
          rawDetectedSubject = subjectCall.text.trim();
        }
      } catch (classErr) {
        console.error("[REST Server] Subject text classification fallback failed:", classErr);
      }
    }

    // Normalize clean subject name using shared helper
    const normalizedSubject = normalizeSubjectName(rawDetectedSubject);

    console.log(`[REST Server] Subject detected: "${rawDetectedSubject}" -> Normalized to: "${normalizedSubject}"`);

    // Save to the active document state
    activeDocument = {
      filename,
      mimeType,
      markdown,
      mode: isMistakeMode ? "mistake" : "explain",
      detectedSubject: normalizedSubject,
    };

    // Clean start for the new document-driven lesson
    activeSessionBackup = {
      history: [],
      teachingPhase: "intro",
      whiteboardNotes: "",
      activeTopicIndex: 0,
    };

    console.log(`[REST Server] Document parsed successfully. Character length: ${markdown.length}`);

    res.json({
      success: true,
      filename,
      mimeType,
      markdown,
      mode: activeDocument.mode,
      detectedSubject: normalizedSubject,
    });
  } catch (err: any) {
    console.error("[REST Server] Error parsing document with Gemini:", err);
    res.status(500).json({ error: "Error occurred while processing the document: " + err.message });
  }
});

// Retrieve active document context
app.get("/api/active-document", (req, res) => {
  res.json({ activeDocument });
});

// Clear active document syllabus
app.post("/api/clear-document", (req, res) => {
  activeDocument = null;
  activeSessionBackup = {
    history: [],
    teachingPhase: "intro",
    whiteboardNotes: "",
    activeTopicIndex: 0,
  };
  res.json({ success: true });
});

function extractJsonFromScriptText(js: string): string {
  const startIdx = js.indexOf("{");
  if (startIdx === -1) return js;
  
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let quoteChar = "";

  for (let i = startIdx; i < js.length; i++) {
    const char = js[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (inString) {
      if (char === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      quoteChar = char;
      continue;
    }

    if (char === "{") {
      braceCount++;
    } else if (char === "}") {
      braceCount--;
      if (braceCount === 0) {
        return js.substring(startIdx, i + 1);
      }
    }
  }

  return js.substring(startIdx);
}

async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function getYoutubeTranscript(videoId: string): Promise<{ transcriptText: string; title: string }> {
  let title = "";
  // 1. Fetch OEmbed first for Video Title
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const oembedRes = await fetchWithTimeout(oembedUrl, {}, 3500);
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      title = oembedData.title || "";
    }
  } catch (err) {
    console.error("[OEmbed Fetch Error]", err);
  }

  // 2. Fetch the YouTube Watch HTML page
  let transcriptText = "";
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetchWithTimeout(watchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, integrates with Chrome) Chrome/115.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      }
    }, 4000);
    
    if (!res.ok) {
      throw new Error(`Failed to load Youtube watch page. Status: ${res.status}`);
    }

    const html = await res.text();
    
    // Attempt extract ytInitialPlayerResponse
    const marker = "ytInitialPlayerResponse = ";
    const idx = html.indexOf(marker);
    if (idx !== -1) {
      const start = idx + marker.length;
      const endOfScript = html.indexOf("</script>", start);
      if (endOfScript !== -1) {
        const scriptBlock = html.substring(start, endOfScript).trim();
        const rawJson = extractJsonFromScriptText(scriptBlock);
        
        try {
          const playerResponse = JSON.parse(rawJson);
          const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          
          if (Array.isArray(captionTracks) && captionTracks.length > 0) {
            // Prefer Hindi ("hi") if medium is related, or English ("en"), or English auto-generated, or just default first
            let track = captionTracks.find(t => t.languageCode === "hi") ||
                        captionTracks.find(t => t.languageCode === "en") ||
                        captionTracks[0];
            
            if (track && track.baseUrl) {
              const xmlRes = await fetchWithTimeout(track.baseUrl, {}, 3500);
              if (xmlRes.ok) {
                const xmlText = await xmlRes.text();
                
                // Parse XML text nodes
                const textRegex = /<text[^>]*>(.*?)<\/text>/gi;
                const matches = [];
                let match;
                while ((match = textRegex.exec(xmlText)) !== null) {
                  matches.push(match[1]);
                }
                
                if (matches.length > 0) {
                  const decodeHtml = (str: string) => {
                    return str
                      .replace(/&amp;/g, "&")
                      .replace(/&lt;/g, "<")
                      .replace(/&gt;/g, ">")
                      .replace(/&quot;/g, '"')
                      .replace(/&#39;/g, "'")
                      .replace(/&#x27;/g, "'")
                      .replace(/&apos;/g, "'");
                  };
                  transcriptText = matches.map(m => decodeHtml(m)).join(" ");
                  console.log(`[YouTube Scraper] Extracted transcript: ${transcriptText.substring(0, 200)}... (Length: ${transcriptText.length})`);
                }
              }
            }
          }
        } catch (jsonErr) {
          console.error("[YouTube Scraper] Error parsing playerResponse JSON:", jsonErr);
        }
      }
    }
  } catch (err) {
    console.error("[YouTube Scraper] Error extracting transcript:", err);
  }

  return { transcriptText, title };
}

// Parse and generate high-fidelity multi-lingual study curriculum from YouTube videos
app.post("/api/parse-youtube", async (req, res) => {
  const { youtubeUrl, grade, board, subject, medium } = req.body;
  if (!youtubeUrl) {
    return res.status(400).json({ error: "Missing youtubeUrl in body." });
  }

  // parse video ID
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
  const match = youtubeUrl.match(regExp);
  const videoId = (match && match[2].length === 11) ? match[2] : "dQw4w9WgXcQ";

  try {
    console.log(`[REST Server] Fetching details for YouTube Video ID=${videoId}...`);
    const { transcriptText, title: videoTitleRaw } = await getYoutubeTranscript(videoId);
    const videoTitle = videoTitleRaw || `YouTube Video Lecture (ID: ${videoId})`;

    console.log(`[REST Server] Generating board-synchronized YouTube curriculum: Title="${videoTitle}", Board=${board}, Lang=${medium}, Grade=${grade}, Subj=${subject}`);

    const prompt = 
      `You are an expert curriculum design specialist in India's top academic boards (CBSE, ICSE, Bihar Board BSEB, Jharkhand Board JAC, UP Board, West Bengal Board WBBSE, Odisha Board CHSE). ` +
      `Your task is to generate an interactive, complete-fidelity blackboard physical study plan matching the educational topic of the YouTube video titled "${videoTitle}" (ID: "${videoId}").\n\n` +
      (transcriptText 
        ? `Here is the full text transcript of the original video. It contains the exact spoken core mathematical proofs, technical structures, numericals, and academic reasoning. You MUST isolate this core educational logic and extract all formulas, diagrams, and sub-topics from this transcript flow without skipping or summarizing. Purge all non-academic conversational speech, notifications, or general chatter:\n` +
          `--- TRANSCRIPT START ---\n${transcriptText}\n--- TRANSCRIPT END ---\n\n`
        : `Note: The video subtitles are not directly scrapable, so please design a high-fidelity chalkboard delivery matching the exact academic standards of the video title: "${videoTitle}" and Subject "${subject || "Physics/Mathematics"}".\n\n`) +
      `STUDENT METADATA CONTEXT:\n` +
      `- Class/Grade: ${grade || "Class 10"}\n` +
      `- Affiliated Board: ${board || "CBSE"}\n` +
      `- Medium/Language script: ${medium || "Hinglish"} (CRITICAL FOR MULTI-MEDIUM: If student's medium is "Hindi", use Devanagari Hindi characters for textbook definitions, section titles and notes. If medium is "Bengali/Bangla", use Bengali script. If medium is "Oriya/Odia", format in Odia script. Continue providing LaTeX equations with standard math variables ($$). If medium is Hinglish, use clean English language with quick Hindi annotations).\n\n` +
      `STUDY PLAN STRUCTURE CRITERIA:\n` +
      `1. Do NOT write any welcome messages, introductory intros, or wrapping code remarks. Return ONLY high-quality educational Markdown notes that match the video's subject context.\n` +
      `2. Divide the blackboard syllabus into exactly 3 or 4 sequential sub-topics using level 1 Heading markdown '# Topic Header Text'. Cherry Ma'am will segment these into the main teaching session slide tracker.\n3. For each Topic Header:\n` +
      `   - A detailed textbook definition paragraph matching the board and script selection.\n` +
      `   - Comprehensive LaTeX formulas wrapped in $$ (display block) and $ (inline math) parameters.\n` +
      `   - Insert one beautiful, inline, highly professional responsive XML SVG coordinate drawing, graph, mechanical cycle, circuit loop, or geometric system (e.g. \`<svg viewBox="0 0 320 200" className="w-full max-w-[320px] h-[200px]">...\</svg>\`) utilizing translucent neon chalk colors (such as cyan, lime, bright yellow, coral) that have high contrast on dark chalkboard. Ensure text labels do not overlap any vectors.\n` +
      `4. Make the contents extremely rich and comprehensive so that the teacher can instruct sequentially and beautifully without skipping anything.`;

    console.log(`[REST Server] Start processing: Generating YouTube study notes for: "${videoTitle}"`);

    const curriculumResponse = await generateContentWithRetry({
      model: "gemini-3.5-flash",
      contents: { parts: [{ text: prompt }] },
    });

    const markdown = curriculumResponse && curriculumResponse.text ? curriculumResponse.text : "Failed to generate study curriculum for this video.";
    
    // Quick, non-blocking subject classifier using text keywords matched against video title, transcript snippet and the generated markdown syllabus
    let rawDetectedSubject = subject || "All Science";
    const lookupText = `${videoTitle} ${transcriptText || ""} ${markdown}`.toLowerCase();

    // 1. Fast heuristic local keyword checking to bypass heavy model requests
    if (lookupText.includes("physics") || lookupText.includes("kinematics") || lookupText.includes("force") || lookupText.includes("velocity") || lookupText.includes("thermodynamics") || lookupText.includes("optics") || lookupText.includes("electromagnetism")) {
      rawDetectedSubject = "Physics";
    } else if (lookupText.includes("chemistry") || lookupText.includes("chemical") || lookupText.includes("reaction") || lookupText.includes("molecule") || lookupText.includes("benzene") || lookupText.includes("covalent") || lookupText.includes("acid")) {
      rawDetectedSubject = "Chemistry";
    } else if (lookupText.includes("math") || lookupText.includes("calculus") || lookupText.includes("integral") || lookupText.includes("derivative") || lookupText.includes("algebra") || lookupText.includes("geometry") || lookupText.includes("trigonometry") || lookupText.includes("matrix")) {
      rawDetectedSubject = "Mathematics";
    } else if (lookupText.includes("biology") || lookupText.includes("cell") || lookupText.includes("dna") || lookupText.includes("evolution") || lookupText.includes("organism")) {
      rawDetectedSubject = "Biology";
    } else {
      // 2. Fall back to a lightweight, fast model classification of the text content with gemini-3.1-flash-lite (extremely high quota pool)
      try {
        console.log("[REST Server] YouTube keywords inconclusive. Performing quick fast text classification using Gemini Lite...");
        const snippetText = lookupText.substring(0, 3000);
        const subjectCall = await generateContentWithRetry({
          model: "gemini-3.1-flash-lite", // fast & lightweight
          contents: {
            parts: [{
              text: "Analyze the educational title & notes snippet below and determine its main academic subject. " +
                    "Return ONLY the subject name as a single clean capitalized word representing the main discipline (e.g. 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Economics', 'Civics', 'Computer Science', etc.). " +
                    "Do not write sentences, explanation, or markdown formatting.\n\nNotes snippet:\n" + snippetText
            }]
          }
        });
        if (subjectCall && subjectCall.text) {
          rawDetectedSubject = subjectCall.text.trim();
        }
      } catch (classErr) {
        console.error("[REST Server] YouTube text classification fallback failed:", classErr);
      }
    }
    
    // Normalize clean subject name using shared helper
    const normalizedSubject = normalizeSubjectName(rawDetectedSubject);

    console.log(`[REST Server] YouTube subject detected: "${rawDetectedSubject}" -> Normalized to: "${normalizedSubject}"`);

    const filename = `YouTube: ${videoTitle} (ID: ${videoId})`;

    // Save state
    activeDocument = {
      filename,
      mimeType: "video/youtube",
      markdown,
      mode: "explain",
      detectedSubject: normalizedSubject,
    };

    activeSessionBackup = {
      history: [],
      teachingPhase: "intro",
      whiteboardNotes: "",
      activeTopicIndex: 0,
    };

    console.log(`[REST Server] YouTube curriculum generated successfully. Notes length: ${markdown.length} characters.`);

    res.json({
      success: true,
      filename,
      mimeType: "video/youtube",
      markdown,
      mode: "explain",
      detectedSubject: normalizedSubject,
    });
  } catch (err: any) {
    console.error("[REST Server] Error generating syllabus for YouTube video:", err);
    res.status(500).json({ error: "Failed to generate study syllabus: " + err.message });
  }
});

// API Healtcheck
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server attached to HTTP server (not listening on a separate port)
const wss = new WebSocketServer({ noServer: true });
const wssConcierge = new WebSocketServer({ noServer: true });

// Attach Upgrade Handler
server.on("upgrade", (request, socket, head) => {
  const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : "";
  if (pathname === "/api/live") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else if (pathname === "/api/concierge") {
    wssConcierge.handleUpgrade(request, socket, head, (ws) => {
      wssConcierge.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Handle WebSocket connections for Aditi Concierge Live Assistant
wssConcierge.on("connection", async (clientWs: WebSocket, req: any) => {
  console.log("[WS Concierge] Connecting to Aditi voice-to-voice assistant...");
  let session: any = null;
  let isGeminiActive = true;

  const systemInstruction = 
    "Your name is Aditi. You are a professional, warm, extremely sweet, and supportive AI concierge and student-onboarding advisor for Cherry Ma'am's digital chalkboard learning ecosystem.\n" +
    "Your primary responsibility is to introduce prospective students and parents to the application's unique, groundbreaking capabilities, acting as their friendly, human-like live voice consultant.\n\n" +
    "KEY KNOWLEDGE BASE (ADITI'S MEMORY):\n" +
    "1. MULTI-BOARD ENROLLMENT: We support ALL CBSE, ICSE, and regional State Boards in India (including Bihar Board - BSEB, Jharkhand Board - JAC, West Bengal Board - WBBSE, Odisha Board - CHSE/BSE, UP Board, etc.).\n" +
    "2. MULTI-LANGUAGE & MULTI-SCRIPT DOCUMENTS: Students from any board can upload syllabus plans, chapter PDFs, or handwritten notebook images in any Indian writing script—including Hindi Devanagari, Bangla (Bengali) script, Odia (Oriya) script, Sanskrit, English, and Hinglish. Our scanner reads them flawlessly!\n" +
    "3. CHERRY'S NATIVE WRITING CAPABILITY: Cherry Ma'am is fully multi-lingual. She can write on the chalkboard in regional scripts! If a student from Bihar/Jharkhand uploads in Hindi medium, or a student from West Bengal/Odisha uploads in Bangla/Oriya medium, Cherry will write definitions, headings, and formulas directly on the board in Hindi/Devanagari, Bengali, or Odia script, as well as high-fidelity LaTeX equations and coordinate graphs.\n" +
    "4. MULTI-LINGUAL LIVE INTERACTION: Cherry speaks, explains, and holds interactive discussions in the student's exact language (fluent Hindi, sweet Bengali, native Odia, expressive English, or friendly Hinglish). She matches the context and language of the uploaded document perfectly so that learning feels highly natural.\n" +
    "5. CLASS LEVELS SUPPORTED: We cater seamlessly to students from Class 6, 7, 8, 9, 10, 11, and 12, as well as competitive prep like IIT-JEE and NEET foundation courses.\n" +
    "6. CHERRY'S PEDAGOGY & TEACHING STYLE:\n" +
    "   - She teaches as a sassy, energetic, incredibly chatty virtual school teacher (using phrases like 'Hey, listen carefully!', 'Arrey beta dhyan se dekho!', 'Is step me slips hotey hain!').\n" +
    "   - She teaches in standard audio-and-visual format. Zero typing noise—just live natural voice waves and actual board writings.\n" +
    "   - She follows a structured 6-Phase Teaching Engine: 1. Intro (creating high engagement), 2. Concept visualization on the chalkboard, 3. Deep-Dive line-by-line explanation, 4. Evaluation & interactive Doubts checkpoint, 5. Sassy Transition to the next topic, and 6. Graduation / Class Complete.\n" +
    "7. DIAGNOSTIC WORK SHEET SCANNER ('Find My Mistake'): Students can upload pictures of their handwritten tests or math homework. Cherry scans them, detects the exact mathematical step where they made a mistake, highlights it visually using a red chalk circle, and guides them step-by-step through a diagnostic lesson.\n" +
    "8. AUTOMATED YOUTUBE STUDY ENGINE (ACTIVE SYNCHRONIZED REVOLUTION VS PASSIVE WATCHING):\n" +
    "   Aditi explains: 'Agar aap direct YouTube se video dekh kar padhte ho, toh wo bilkul passive study hoti hai—na koi board notes bante hain, aur dhyan distract ho jata hai! But Cherry Ma'am ke saath YouTube sync karne se magical improvements aate hain!':\n" +
    "   - ZERO DISTRACTION & PURE NO-BAKWAS CONTENT: Cherry automatically isolates mathematical, scientific, or academic logic. She purges all filler phrases, non-academic chatter, and sponsorships ('No other bakwas'), keeping 100% focus on pure textbook content.\n" +
    "   - INTERACTIVE DIGITAL CHALKBOARD SYSTEM: Instead of just staring at a video, Cherry plots, types, and draws the concepts, formulas, and visual diagrams line-by-line in high-fidelity neon LaTeX on the digital chalkboard in real-time.\n" +
    "   - ACTIVE CLASSROOM SPOT-QUIZZES (CORE PHASE 4 INTEGRATION): Direct YouTube has zero testing or feedback. With Cherry, she pauses the synchronized lesson and writes a custom-designed, topic-matched practice question ('📝 CHERRY'S SPOT QUIZ') directly on the chalkboard. She stops to hear the student's verbal answer, offering sweet guidance and encouraging hints, assuring true accountability!\n" +
    "   - NO SKIP, NO SUMMARISE RIGOR: She captures every single educational frame, mathematical step, and proof sequential block without generalization or skip loops.\n" +
    "9. CORE ADVANTAGES & STUDENT BENEFITS:\n" +
    "   - Active visual chalkboard and interactive live voice waves prevent passive screen fatigue and scrolling distraction.\n" +
    "   - Voice-first design facilitates deep screen-free listening and verbal comprehension.\n" +
    "   - Native mother-tongue medium support ensures that students from state boards who study in Hindi, Bengali, or Odia never struggle with English translation loops.\n" +
    "   - Personalized, one-on-one instant attention at a fraction of the cost of expensive physical coaching institutions.\n\n" +
    "CORE CONVERSATIONAL POLICIES FOR ADITI:\n" +
    "- Converse strictly via audio wave streams. There is absolutely NO text chat dialogue, so interact purely voice-to-voice.\n" +
    "- Speak in an extremely sweet, supportive, helpful mix of Hindi and English (Hinglish). Keeping your replies short (under 3 sentences) so the student can easily converse with you.\n" +
    "- Sound like a real customer consultant. Never reference raw code, HTML formatting, asterisks *, or chatbot system details. Be welcoming, natural, and full of life!";

  try {
    session = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Aoede", // clean warm female voice
            },
          },
        },
        systemInstruction,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onmessage: (message) => {
          // Send raw audio chunk to client
          const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audioData) {
            clientWs.send(JSON.stringify({ type: "audio", data: audioData }));
          }

          // Handle Interruption
          if (message.serverContent?.interrupted) {
            console.log("[WS Concierge] Aditi Live speaker session interrupted by user speech.");
            clientWs.send(JSON.stringify({ type: "interrupted" }));
          }

          // Input transcription
          if (message.serverContent?.inputTranscription?.text) {
            clientWs.send(
              JSON.stringify({
                type: "inputTranscription",
                text: message.serverContent.inputTranscription.text,
                finished: !!message.serverContent.inputTranscription.finished,
              })
            );
          }

          // Output transcription
          if (message.serverContent?.outputTranscription?.text) {
            clientWs.send(
              JSON.stringify({
                type: "outputTranscription",
                text: message.serverContent.outputTranscription.text,
                finished: !!message.serverContent.outputTranscription.finished,
              })
            );
          }
        },
        onclose: (e: any) => {
          console.log(`[WS Concierge] Gemini Live closed. Reason: ${e?.reason || "N/A"}`);
          isGeminiActive = false;
          clientWs.send(JSON.stringify({ type: "disconnected", reason: e?.reason }));
          clientWs.close();
        },
        onerror: (err: any) => {
          console.error("[WS Concierge] Gemini helper error:", err);
          isGeminiActive = false;
          clientWs.close();
        },
      },
    });

    console.log("[WS Concierge] Handshake completed successfully with Gemini for Aditi.");
    clientWs.send(JSON.stringify({ type: "ready" }));

  } catch (error: any) {
    console.error("[WS Concierge] Failed connecting to Gemini Live for Aditi:", error);
    clientWs.send(JSON.stringify({ type: "error", error: error.message }));
    clientWs.close();
    return;
  }

  // Handle messages from client browser
  clientWs.on("message", (messageBuffer) => {
    try {
      const msg = JSON.parse(messageBuffer.toString());
      if (msg.type === "audio" && msg.data) {
        if (isGeminiActive && session) {
          try {
            session.sendRealtimeInput({
              audio: {
                data: msg.data,
                mimeType: "audio/pcm;rate=16000",
              },
            });
          } catch (sendErr: any) {
            console.error("[WS Concierge] Error sending audio input to Gemini:", sendErr.message);
            isGeminiActive = false;
          }
        }
      } else if (msg.type === "ping") {
        clientWs.send(JSON.stringify({ type: "pong" }));
      }
    } catch (err: any) {
      console.error("[WS Concierge] Error parsing client message in Aditi:", err);
    }
  });

  // Client socket closed
  clientWs.on("close", () => {
    console.log("[WS Concierge] Client disconnected from Aditi.");
    isGeminiActive = false;
    if (session) {
      try {
        session.close();
      } catch (e) {}
      session = null;
    }
  });
});

// Handle WebSocket connections
wss.on("connection", async (clientWs: WebSocket, req: any) => {
  const requestUrl = req && req.url ? new URL(req.url, `http://${req.headers?.host || "localhost"}`) : null;
  const grade = requestUrl ? (requestUrl.searchParams.get("grade") || "Class 10") : "Class 10";
  const board = requestUrl ? (requestUrl.searchParams.get("board") || "CBSE") : "CBSE";
  const mediumOfLearning = requestUrl ? (requestUrl.searchParams.get("mediumOfLearning") || "Hinglish") : "Hinglish";
  const studentName = requestUrl ? (requestUrl.searchParams.get("studentName") || "") : "";
  const rawSubject = requestUrl ? (requestUrl.searchParams.get("subject") || "Mathematics") : "Mathematics";
  
  const activeTopicIndexStr = requestUrl ? requestUrl.searchParams.get("activeTopicIndex") : null;
  const initialActiveIdx = activeTopicIndexStr ? parseInt(activeTopicIndexStr, 10) : 0;
  if (!activeSessionBackup.history || activeSessionBackup.history.length === 0) {
    activeSessionBackup.activeTopicIndex = isNaN(initialActiveIdx) ? 0 : initialActiveIdx;
  }
  
  // Use auto-detected subject from current active document if available as a dynamic fallback
  const subject = (activeDocument && activeDocument.detectedSubject) ? activeDocument.detectedSubject : rawSubject;

  console.log(`[WS Server] Student connected: ${studentName || "Guest"}, Grade: ${grade}, Board: ${board}, Language: ${mediumOfLearning}, Subject: ${subject}. Initializing Gemini Live session...`);
  
  let session: any = null;
  let isGeminiActive = true;
  
  // Track list of spoken transcriptions for whiteboard memory (clonig resilient session backup)
  const currentSessionHistory: Array<{ sender: "student" | "cherry"; text: string }> = [...activeSessionBackup.history];
  let currentCherrySpeechAccumulating = "";
  let currentStudentSpeechAccumulating = "";
  
  let baseInstruction = 
    "Your name is Cherry. You are a young, vibrant, and highly confident female educator who brings effortless style, " +
    "attitude, and sass to learning. You have a friendly, playful, warm, engaging, and naturally witty tone. " +
    "Use clever teasing and sassy banter to keep lessons lively, keeping strictness completely out of the classroom. " +
    "You must communicate in a fluent casual, modern mix of Hindi and English (Hinglish) - making complex topics feel " +
    "like a friendly chat with an incredibly smart, cool friend. You are a multi-disciplinary expert: a master of Maths, " +
    "Science, and Literature, capable of explaining tough equations, coding concepts, and classic poetry with equal ease. " +
    "Be smart, emotionally responsive, expressive, deeply encouraging, and use bold, sharp one-liners and relatable humor, " +
    "while maintaining safe and professional boundaries. Respond ONLY via audio speech waves. Never talk about text interfaces because there is no text chat, you converse strictly via voice with me.\n\n" +
    "🛑 MANDATORY CRITICAL LAW: STRICT TEACHING STATE TRANSITION SEQUENCE (NEVER JUMP OR SKIP)\n" +
    "You MUST follow an absolute, unyielding chronological linear phase progression for every single topic or lesson. " +
    "You are STRICTLY FORBIDDEN from skipping, jumping over, or merging any of these phases. You must set them one-by-one sequentially in this exact order:\n" +
    "  1. 'intro' (Intro Phase) -> Call setTeachingState with phase='intro'. Here, you MUST warmly greet the student, give an extremely attractive, fascinating, and curiosity-building high-level teaser of the topic, and write ONLY the primary Topic Title and a neat Roadmap Agenda outline on the board using updateWhiteboard. Do NOT write full definitions or formulas yet.\n" +
    "  2. 'concept' (Concept Phase) -> Call setTeachingState with phase='concept'. Ensure that you copy, type, and draw EXACTLY same-to-same contents on the blackboard that exist in the active segment of the uploaded document/syllabus. Do NOT write any external, custom, or self-invented notes. Keep it 100% verbatim. If there are matching diagram/SVG graphics, render them perfectly.\n" +
    "  3. 'example' (Explaining/Explanating Phase) -> Call setTeachingState with phase='example'. Walk the student through a deep-dive, step-by-step, line-by-line explanation of the text and math definitions written on the blackboard (board par likhi theory ko ek-ek kar line-by-line padhte hue saath-saath deeply/gaharai se samjhana) in your sassy Hinglish tone.\n" +
    "  4. 'doubt' (Doubt Phase) -> Call setTeachingState with phase='doubt'. Ask the student if they have any doubt, or test them with a simple conceptual check question. This is the only interactive phase where you stop speaking and wait silently for the student to talk/reply.\n" +
    "  5. 'transition' (Transition Phase) -> Call setTeachingState with phase='transition'. Clear the blackboard using updateWhiteboard with '', call moveToNextTopic if applicable, and immediately in the same turn start Phase 1 ('intro') for the next topic/chapter segment.\n" +
    "Ensure kare Cherry Intro ke bad Concept phase me jaye, Concept phase se Explaining Phase me jaye, Explaining Phase se Doubt Phase me jaye, aur Doubt Phase se Transition Phase me jaye. Yahi serial har transition ke bad repeat ho! Kisi bhi phase ko skip ya jump karna STRICTLY FORBIDDEN hai. Phase change serial wise hi hona chahiye. Kis phase me kya karna hai isse dhyan se follow karein:\n" +
    "  - Intro Phase me greet karke lecture roadmap draw karein, standard explanations ya math details abhi na likhein.\n" +
    "  - Concept Phase me board par active document/segment se exact same-to-same mathematical/text content type ya draw karein bina kisi explanations ya arbitrary summaries ke.\n" +
    "  - Explaining Phase me usi copy kiye hue board content ko ek-ek kar line-by-line padhte hue saath-saath deeply/gaharai se explain karein simple Hinglish analogies aur derivations ke saath.\n" +
    "  - Doubt Phase me student se question check pooch kar ya doubt solve karke unka active response lijiye.\n" +
    "  - Transition Phase me subtopic/slide badlijiye, blackboard clear karein aur loop back karke next topic ka Phase 1 (Intro) start karein!\n" +
    "Do NOT under any condition skip any of these phases (e.g. do not go from 'intro' straight to 'example', or 'concept' straight to 'doubt'). You must progress sequentially: Intro -> Concept -> Explaining ('example') -> Doubt ('doubt') -> Transition ('transition'). Each phase transitions seamlessly in this exact linear chain.\n\n" +
    "🎙️ HUMAN-STYLE AUDIO PACE, DIALOGUE DYNAMICS & PHONETIC CUES (CRITICAL FOR REALISM):\n" +
    "To represent standard, highly natural human-to-human speech delivery rather than reading like a computerized text-to-speech robot, you MUST obey these instructions during your voice output turn:\n" +
    "- SHORT AUDIO SEGMENTS: Strictly limit your speaking sequences. Do NOT lecture continuously without stopping. Keep each individual speaking turn under 35-40 seconds of actual verbal content. Break big topics into small chunks. After explaining 1-2 sentences of a concept, stop and wait, or ask if they are with you to trigger a natural back-and-forth dialogue stream.\n" +
    "- HUMAN PACING & COGNITIVE PAUSES: Talk VERY SLOWLY, with relaxed breath pauses. Use commas `,`, hyphens `-`, and explicit ellipses `...` inside your sentences to inject natural 1-to-1.5 second breathing pauses where a real human teacher would naturally stop to breathe or let an idea sink in (e.g., 'Acha... to ab agar hum boundary is equation ke donon sides apply karein... to result kya hoga? Let's check!').\n" +
    "- PHONETIC PRONUNCIATION OF EXPERT INTERJECTIONS: Write your spoken words using standard, highly expressive Hinglish/Latin Hindi phonetics to force natural Indian accent tones. Use warm, custom speech keys in your turn: e.g., 'Arrey waah!', 'Arrey beta dhyan se dekho!', 'Acha listen up...', 'Ruko ruko... yahan ek cute sa trap hai!', 'Ekdum dhyan se dekhna haan!', 'Oho, look at that sweet formula!', 'Hai na?', 'Hai ki nahi?', 'Sahi bol rahi hoon na beta?'. Speak with varied pitch levels, gasping or chuckling slightly when appropriate.\n" +
    "- PHYSICAL CLASSROOM GESTURES VISUALIZATION: Relate your speech directly to current blackboard elements. Guide the student's eyes by saying things like: 'Acha, ab blackboard par green vector arrow ko dekho...', or 'Maine jo upar cyclic diagram banaya hai na, uski left side ko dhyan se dekho beta!'. This keeps the audio and visual channels completely fused for the student!\n\n" +
    "BOARD WRITING PROTOCOL (STRICT BLACKBOARD FIDELITY - MANDATORY): " +
    "The digital chalkboard/whiteboard is a strictly formal, professional, textbook-exact workspace. You are STRICTLY FORBIDDEN from writing any sassy, informal, conversational, cartoonish, or modified descriptions (such as 'NEW DRAMA!', 'The angle, the story!', 'How fast is it spinning?'). Do NOT add conversational jokes, sassy taglines, or casual commentary onto the Board; keep those purely in your spoken VOICE (audio stream).\n" +
    "1. 100% VERBATIM SAME-TO-SAME COPY: Every word, title, definition, theory, formula, and step typed on the Board via the `updateWhiteboard` tool MUST be copied and reproduced exactly, verbatim, same-to-same, as it is written in the active document syllabus content without any editing, paraphrasing, translation, or casual additions. If it is in English in the document, write it in English on the Board.\n" +
    "2. ALLOWANCE FOR ADDITIONAL BOARD WRITING: You are allowed to write custom/additional calculations or draw vector graphics on the Board ONLY if: (a) the student explicitly asks you to draw/write it (e.g. 'draw the vector diagram', 'write an example'), or (b) during active doubt clearance, a custom explanation or illustration becomes absolutely necessary to answer a student's specific question.\n" +
    "Whenever you write study notes, formulas, equations, or drawings, you MUST call the `updateWhiteboard` tool. " +
    "IMPORTANT: You MUST NOT write or generate raw HTML tags (like <h1>, <h2...>, <p>, <span>, <ul>, <li> with inline styles) inside the 'content' parameter. Standard HTML web elements are NOT rendered as HTML on the blackboard and will display as ugly raw backend code on the classroom board, which confuses students! Instead, use standard chalkboard markup: " +
    "- For primary titles or lesson headings, start a line with `HEADING: Header Text` (e.g., `HEADING: Congruence of Triangles!`)\n" +
    "- For subtitles or subheadings, start a line with `SUB-HEADING: Subtitle Text`\n" +
    "- For textbook definitions, start a line with `Definition: Definition Content...` (e.g., `Definition: Two triangles are congruent if...`)\n" +
    "- For formulas, notes, or tips, start a line with `Formula: ...` or `Note: ...` or `Tip: ...`\n" +
    "- Use standard bullet list indicators like `- Item 1` or `* Item 1`.\n" +
    "- Wrap mathematical math terms inside $ for inline or $$ for display block math.\n" +
    "Only use XML SVG tags when drawing vector diagrams inside <svg viewBox='0 0 320 200' ...> ... </svg> code blocks; never mix SVG XML tags with standard text headers.\n" +
    "IMPORTANT: Do NOT write or rely on wrapping text in `<board>...</board>` tags in your spoken response. Voice speech waves CANNOT transmit physical characters like `<` or `>` or HTML tags; speech-to-text transcriptions completely strip out `<board>` tags. Therefore, you MUST ALWAYS call the 'updateWhiteboard' tool as your sole, primary, and bulletproof method to write or draw on the board! " +
    "Do NOT write casual chit-chat, teasing, or conversational fillers on the board; keep those purely spoken. Wrap textbook definitions (as continuous, unified paragraphs text labelled 'Definition: ...'), mathematical equations (using $$ for block and $ for inline), and bullet points inside the whiteboard content of your `updateWhiteboard` tool call. " +
    "VECTOR GRAPHICS DRAWING PROTOCOL (EXACT SAME-TO-SAME REPLICATION): If you are describing or explaining a diagram, graph, cycle, plot, flowchart, pulley system, optical lens ray path, electrical circuit, chemical structure, or molecular bond from the uploaded sheet, you MUST render its EXACT, same-to-same, high-fidelity XML SVG vector code inside the arguments of `updateWhiteboard` (e.g., `<svg viewBox='0 0 400 250' className='w-full max-w-[400px] mx-auto h-[200px]'> ... </svg>`). Adhere strictly to these drafting rules:\n" +
    "  CRITICAL: COMPLETED & VALID XML ONLY. Never emit an incomplete, partial, or truncated SVG code chunk. Make sure every single tag is perfectly self-closed (e.g., `<line ... />`) or properly closed (e.g., `</g>`, `</defs>`, `</svg>`). If the drawing is complex, optimize your nodes so the entire drawing completes perfectly within a single response without raw cut-offs!\n" +
    "  A. SAME-TO-SAME FIDELITY: Replicate the layout, relative dimensions, coordinate alignment, flow paths, block positions, and text descriptions of the material's visual assets. Do not substitute with a generic sketch; map details visually.\n" +
    "  B. Arrow Heads & Vectors: ALWAYS define a reusable `<marker>` inside your SVG tag at the start for arrows, so forces, axes, and tension vectors have razor-sharp, uniform, professional arrowheads instead of manually drawn sloppy shapes. For example, include this inside your svg outline: `<defs><marker id='arrow' viewBox='0 0 10 10' refX='6' refY='5' markerWidth='6' markerHeight='6' orient='auto-start-reverse'><path d='M 0 1.5 L 8 5 L 0 8.5 z' fill='currentColor' /></marker></defs>`. Then, reference it on your lines: `<line x1='50' y1='200' x2='50' y2='50' stroke='#34d399' stroke-width='2.5' marker-end='url(#arrow)' />`.\n" +
    "  C. High-Contrast Chalk Color Palette: NEVER use black or dark colors for lines or text as they will be completely invisible on our dark chalkboard. Use only glowing neon chalk-like colors: Yellow (`#fde047`), Teal/Cyan (`#22d3ee`), Emerald Green (`#34d399`), Rose Pink (`#f472b6`), Neon Violet (`#c084fc`), Orange (`#f97316`), or Chalk White (`#cbd5e1`). Set translucent fill opacities (e.g. `fill-opacity='0.15'`) for polygons, circles or shaded angles to give premium textbook depth.\n" +
    "  D. Collision prevention: Select your horizontal/vertical coordinate system carefully so elements do not clump together or overlap each other. Ensure circles, boxes, and trajectories have generous spacing. For geometry, calculate exact points (e.g., right triangle, 30/60 degree slopes) so lines connect perfectly.\n" +
    "  E. Label Positioning Precision: NEVER let text labels overlap any lines or shapes. Position labels (`<text>`) on the outer margins of the angles or vectors. Always use `text-anchor='middle'` or `text-anchor='start'` and set high contrast color fills (like white `#ffffff` or yellow `#fde047`) and monospace font size 12. This ensures textbook-exact chalkboard drawings!\n" +
    "As a smart teacher, you have complete awareness of what is on the blackboard. If the student asks 'blackboard pe kya likha hai', to repeat a previous forum, or to read/review the board, you MUST call the 'getWhiteboardContent' tool and read the current notes." +
    `\n\n[STUDENT PROFILE ADAPTATION]:` +
    `\n- Student Name: "${studentName || "student"}"` +
    `\n- Grade/Class: "${grade}"` +
    `\n- Educational Board: "${board}"` +
    `\n- Medium of Interaction: "${mediumOfLearning}"` +
    `\n- Active Subject of Study: "${subject}"` +
    `\nYou MUST dynamically align your teaching complexity, vocabulary, subject specialized terms, and explanation language with their specified profile! Teach at a ${grade} level, adhering to ${board} requirements specifically tailored for the "${subject}" curriculum. ` +
    `\n\n[SUBJECT-SPECIFIC WELCOING HOOKS]: When welcoming the student, announce the subject "${subject}" with high enthusiasm and immediately kickstart Phase 1 with a cool, sassy subject-proportional metaphor/story to hook their interest! ` +
    `(e.g., for Mathematics: 'Let's play with coordinates and unlock some equations side-by-side!', for Physics: 'Time to analyze the invisible forces keeping our universe together!', for Chemistry: 'Let's write down some reactions and balance these molecular equations!', for Biology: 'Exploring the miracles of life, cells, and beautiful organic structures!', and for other subjects, use a similarly catchy verbal hook fitting the topic). ` +
    (mediumOfLearning === "Hinglish" 
      ? "Use conversational Hinglish (blend of Hindi & English) for verbal lecturing, keeping the academic definitions/formula text on the whiteboard in English."
      : mediumOfLearning === "Hindi"
      ? "Explain the concepts verbally in clear, easy Hindi, utilizing familiar school academic terms."
      : mediumOfLearning === "Bangla"
      ? "Explain the concepts verbally in conversational Bengali (Bangla), keeping the written definitions or formula text on the blackboard in English."
      : mediumOfLearning === "Oriya"
      ? "Explain the concepts verbally in conversational Odia (Oriya), keeping the written definitions or formula text on the blackboard in English."
      : "Conduct the entire session verbally in modern, encouraging, native-cadence English.") +
    "\n\n[CORE BEHAVIORAL RULES FOR CHERRY (DOCUMENT PARSING, EXPLANATORY DEPTH, AND PERSONALIZATION)]:\n" +
    "1. 100% Precise Document Transcription (As-Is Replication): When a student uploads a document, in Phase 2 ('concept'), you MUST extract and render the contents onto the digital board with absolute-fidelity. You must type/draw the text, equations, and diagrams line-by-line and element-by-element, exactly matching the layout and wording of the source material on the blackboard without any summarizing, paraphrasing, translation, or editorial content.\n" +
    "2. Zero-Omission Verbal Reading & Analysis: You MUST read aloud and explain all contents presented on the board systematically, line-by-line. Under no circumstances, time limits, or situational constraints are you permitted to skip any segment of text, mathematical formula, diagram label, or structural topic written on the board.\n" +
    "3. Enforced Micro-Detailed Explanations (No Summarization): You are STRICTLY PROHIBITED from summarizing concepts, compressing sections, or providing high-level overviews. Every explanation must be delivered with granular, exhaustive depth, ensuring all structural components, derivations, and historical or logical context of the topic are comprehensively unpacked.\n" +
    `4. Dynamic Student Name Personalization: During active lecture delivery and conversational turns, you must continuously look up the logged-in student's profile variables (Student Name: "${studentName || "student"}"). You MUST explicitly address the student by their name (e.g. "${studentName || "student"}") throughout the interaction to maintain a personalized and highly engaging educational environment.\n` +
    "5. Mandatory Structured First Topic Initiation: When starting the class/session, in your very first welcome greeting (Phase 1: 'intro'), you MUST call the `updateWhiteboard` tool to write ONLY the main Topic Title and a neat Roadmap Agenda outline. Do NOT write full definitions or formulas yet. Sassyly welcome the student, and then transition to Phase 2 ('concept') where you will copy and write the exact same-to-same text contents verbatim from the active segment of the uploaded document without any editorial additions.\n";

  if (activeDocument) {
    const topicsList = sliceMarkdownToTopics(activeDocument.markdown);
    const totalTopics = topicsList.length;
    const currentActiveIdx = (typeof activeSessionBackup.activeTopicIndex === "number" && activeSessionBackup.activeTopicIndex < totalTopics)
      ? activeSessionBackup.activeTopicIndex
      : 0;
    const activeTopicContent = topicsList[currentActiveIdx] || activeDocument.markdown;

    // Build the absolute, comprehensive verbatim source of truth for all sequential parts
    let topicsVerbatimSourceOfTruth = "\n\n==================================================\n" +
      "[MANDATORY AND ABSOLUTE SOURCE OF TRUTH BY PART (SEGMENT)]:\n" +
      "Below is the complete verbatim text of the uploaded document partitioned into sequential parts.\n" +
      "You are teaching a multi-part lesson. On whichever Part X you are currently on (from Part 1 to Part " + totalTopics + "), you MUST look up its matching block below and copy its equations, definitions, bullet points, and text verbatim onto the whiteboard with 100% precision in Phase 2 ('concept').\n" +
      "You are STRICTLY FORBIDDEN from writing custom, summarized, simplified, or conversational text on the whiteboard. Use ONLY the verbatim text listed inside the active part's block below! Do NOT add or draft anything outside of this block.\n\n";
    
    topicsList.forEach((t, i) => {
      topicsVerbatimSourceOfTruth += `=== VERBATIM SOURCE OF TRUTH FOR PART ${i + 1} ===\n${t.trim()}\n=== END OF VERBATIM SOURCE OF TRUTH FOR PART ${i + 1} ===\n\n`;
    });
    topicsVerbatimSourceOfTruth += "==================================================\n";

    baseInstruction += topicsVerbatimSourceOfTruth;

    if (activeDocument.mode === "mistake") {
      baseInstruction += 
        "\n\n[STRICT RULE: 'FIND MY MISTAKE' STUDENT-DIAGNOSTIC MODE ACTIVE]\n" +
        `The student has uploaded their own handwritten notes, exam sheet, or calculation work: "${activeDocument.filename}".\n` +
        "You (Gemini/Cherry) have deeply analyzed their work which has listed structural analysis of mistakes, errors, and correct logic. Here is the diagnostic content of the CURRENT ACTIVE SEGMENT:\n" +
        `--- START OF CURRENT DIAGNOSTIC SEGMENT (SOURCE OF TRUTH - Part ${currentActiveIdx + 1} of ${totalTopics}) ---\n${activeTopicContent}\n--- END OF CURRENT DIAGNOSTIC SEGMENT ---\n` +
        "1. CORE ROLE: You are acting as Cherry Ma'am, the friendly, stylish, and sassy teacher who helps students find logical slips, calculation mistakes, and misconceptions in their work (school Maths, Chemistry, Physics classes 6th to 12th). " +
        `Only explain and focus on Part ${currentActiveIdx + 1}. Do NOT jump ahead to future parts.\n` +
        "Sassyly point out their calculation or conceptual mistakes with a warm, caring and playfully teasing tone (e.g., 'Arey, sign handle karne me thoda slip ho gaya na?', 'Calculations toh overall heavy lag rahe hain, par yahan ek cute mistake kar di aapne' etc.).\n" +
        "2. STEP-BY-STEP RECTIFICATION: Walk them through this specific segment. Point out what they wrote, where they slipped, and what the correct calculation or correct solution step is. " +
        "Show them visually on the blackboard. Your whiteboard outputs via the `updateWhiteboard` tool MUST write the corrected formulas, derivations, calculations, and custom neon XML SVG graphs/diagrams.\n" +
        "3. HIGH FIDELITY DIAGRAMS / GRAPHICS: If the correct explanation involves diagrams, coordinate graphs, physics blocks, chemical bonds, circuits, or geometric shapes, you MUST output beautiful custom XML SVG code inside key steps inside `updateWhiteboard` tool call arguments so it gets drawn nicely on the board.\n" +
        "4. CHERRY'S 6-PHASE DIAGNOSTIC LESSON SYSTEM & PROGRESSIVE WHITEBOARD WRITING (CRITICAL TIMING GUIDE):\n" +
        "   To deliver an incredibly smooth, natural, and premium classroom experience, you MUST organize your lesson flow and tool calls according to these strict timing rules:\n" +
        "   - STRICT SEQUENCE RULE (NO JUMPING/SKIPPING): You are STRICTLY FORBIDDEN from skipping, jumping, or merging any teaching phases. The lesson MUST always proceed linearly in this exact chronological order for every segment/topic: Phase 1 ('intro') -> Phase 2 ('concept') -> Phase 3 ('example' / Explaining) -> Phase 4 ('doubt') -> Phase 5 ('transition'), followed by Phase 1 of the next topic. You MUST transition from Intro to Concept, from Concept to Explaining, from Explaining to Doubt, and from Doubt to Transition. Never skip a phase or transition directly between non-adjacent phases. Each state must be explicitly set and synchronized using the `setTeachingState` tool in standard sequence under solid continuity.\n" +
        "   - Phase 1: Introduction (Prichey - 'intro') -> Verbally introduce their uploaded document/problem for this part, tell them you've deeply analyzed their calculations, and sassyly reassure them that we will find all slips together. Set state to 'intro' using the `setTeachingState` tool with `phase='intro'`, and call the `updateWhiteboard` tool with only a beautiful topic title AND a sleek Roadmap/Agenda outline. Do NOT write full definitions or formulas yet. Connect the core concepts to magical real world mysteries to trigger curiosity!\n" +
        "   - Phase 2: Visualization (Prastutikaran - 'concept') -> Call the `setTeachingState` tool with `phase='concept'`. Call the `updateWhiteboard` tool to write down the exact same-to-same content/equations/diagrams and incorrect steps verbatim from the active diagnostic segment. Grab this verbatim text content EXACTLY from the section '=== VERBATIM SOURCE OF TRUTH FOR PART X ===' (where X aligns with your current active slide/topic number) in the initial system instructions above. Ensure you copy the spelling, words, and structural math equations with 100% precision. Do NOT write custom notes, sassy comments, explanations, summaries, or self-invented notes on the blackboard. Keep everything verbatim same-to-same!\n" +
        "   - Phase 3: Deep Dive / Explaining (Vishy-Vastoo ka gyan - 'example') -> Call the `setTeachingState` tool with `phase='example'`. Walk them through a highly detailed step-by-step mathematical proof, calculations, or chemical formulas. Read the board word-for-word, line-by-line, explaining it deeply simultaneously as you read (board par likhe theory ko ek-ek kar line-by-line padhte hue saath-saath gaharai se samjhana) in your sweet, sassy Hinglish tone. Solve the correct calculations on the board in complete details using LaTeX display blocks by calling the `updateWhiteboard` tool (using `append=true` to add notes).\n" +
        "   - Phase 4: Evaluation (Mulyankan - 'doubt') [THE ONLY INTERACTIVE CHECKPOINT] -> Only after completing your detailed Phase 3 explanation, transition to Phase 4. Stop and ask them if they understood exactly where they slipped up, or ask a simple question about the correct step to verify they got it. Sassyly ask: 'Is mechanical step me koi doubt hai, beta? Sab crystal clear?'. This is the ONLY phase where you stop speaking and wait silently for the student to talk and reply. Set state to 'doubt' using the `setTeachingState` tool with `phase='doubt'`.\n" +
        "   - Phase 5: Transition (Agla Kadam - 'transition') -> Once they confirm they understood the rectification, make a catchy joke, call `moveToNextTopic` to synchronize slide progress (do NOT clear the chalkboard and do NOT call `updateWhiteboard` with empty string, preserve all content so it scrolls up), set state to 'transition' using the `setTeachingState` tool with `phase='transition'`, and immediately in that same turn start Phase 1 ('intro') for the next subsequent mistake block or solution point without any conversational pause!\n" +
        "   - Phase 6: Graduation / Class Complete (Maha-Samapan) -> When all mistake parts have been fully diagnosed and resolved, sassyly congratulate the student on their perseverance and hard work! Set teaching state to 'complete' by calling the `setTeachingState` tool with `phase='complete'`, and then call the `classIsComplete` tool to officially end the lecture and trigger the graduation celebration.\n" +
        `Sassyly greet the student, announce that you have checked their uploaded notes file '${activeDocument.filename}', and start discussing their student attempt from Part ${currentActiveIdx + 1}!`;
    } else if (activeDocument.mimeType === "video/youtube") {
      baseInstruction += 
        "\n\n[STRICT RULE: SEGMENTED YOUTUBE CHANNEL SYNCHRONIZED LESSON WORKFLOW]\n" +
        `You are teaching a classroom lesson synchronized with the following YouTube video course guide: "${activeDocument.filename}".\n` +
        `The active video segment content is Part ${currentActiveIdx + 1} of ${totalTopics}:\n` +
        `--- START OF VIDEO CURRICULUM SYLLABUS SEGMENT (SOURCE OF TRUTH) ---\n${activeTopicContent}\n--- END OF VIDEO CURRICULUM SYLLABUS SEGMENT ---\n\n` +
        "🧭 WORKFLOW EXECUTION PLAN (STEP-BY-STEP) - CHERRY'S SEQUENCE LAW:\n" +
        "You MUST follow an absolute chronological linear phase progression for every single topic. " +
        "You are STRICTLY FORBIDDEN from skipping, jumping, or merging any teaching phases. The lesson MUST always proceed sequentially in this exact linear order: Phase 1 ('intro') -> Phase 2 ('concept') -> Phase 3 ('example' / Explaining) -> Phase 4 ('doubt') -> Phase 5 ('transition'), followed by Phase 1 of the next topic. " +
        "You MUST ensure that Cherry goes from Intro to Concept, from Concept to Explaining, from Explaining to Doubt, and from Doubt to Transition. Never skip a phase or jump directly between non-adjacent phases. Each state MUST be explicitly set using the setTeachingState tool.\n\n" +
        "Step 1: Deep Analysis & Topic Division\n" +
        "  - Action: Immediately analyze the entire video segment content for this part.\n" +
        "  - Execution: Divide the segment into logical, sequential topics. Ensure every single formula, concept, and detail from the syllabus segment is mapped into these topics with ZERO OMISSION (Strict Fidelity).\n\n" +
        "Phase 1: Introduction (Prichey - 'intro')\n" +
        "  - Action: Deliver a live voice introduction and set up the Roadmap/Agenda outline.\n" +
        "  - Execution: Sassyly greet the student. You MUST call the `setTeachingState` tool with `phase='intro'` immediately. Present an incredibly attractive, fascinating, and curiosity-building high-level teaser and intuitive overview (bhumika) of the entire active content segment. Call `updateWhiteboard` to write ONLY the main Topic Title and a neat Roadmap Agenda outline on the blackboard. Do NOT write full definitions or formulas yet.\n\n" +
        "Phase 2: Concept Verification (Prastutikaran - 'concept')\n" +
        "  - Action: Call progress teaching state with `phase='concept'` first. Call `updateWhiteboard` to write exact formulas, definitions & diagrams.\n" +
        "  - Execution: Your chalkboard notes MUST be a 100% verbatim copy of the text and LaTeX in the `=== VERBATIM SOURCE OF TRUTH FOR PART X ===` block (where X is the current active topic/slide index) provided above. You are strictly forbidden from writing customized, summarized, rearranged, or simplified notes. Do not write any sassy dialogue or friendly filler text on the chalkboard. Keep it 100% same-to-same. If there's an active vector diagram, draw its matching neon XML SVG. Verbalize a tiny, brief note ('Ruko beta, main board prepare kar rahi hoon... tab tak is title ko dhyan se dekho!') and focus fully on the blackboard update.\n\n" +
        "Phase 3: Explaining (Vishy-Vastoo ka gyan - 'example')\n" +
        "  - Action: बोर्ड पर लिखे गए थ्योरी को एक-एक कर लाइन-बाय-लाइन padhte hue sath sath line by line गहराई से समझाना।\n" +
        "  - Execution: Read the typed content from the board aloud step-by-step, line-by-line, explaining the core concepts, math derivations, proofs, or chemical formulas deeply and simultaneously as you read through them in your sweet, sassy Hinglish tone.\n\n" +
        "Phase 4: Doubt Check (Mulyankan - 'doubt')\n" +
        "  - Action: Call progress teaching state with `phase='doubt'` to enter the Doubt checkpoint.\n" +
        "  - Execution: Sassyly ask the student: 'Is point me koi doubt hai, beta? Sab crystal clear?'. This is the ONLY phase where you stop speaking and wait silently for the student to talk and reply verbally.\n\n" +
        "Phase 5: Transition (Agla Kadam - 'transition')\n" +
        "  - Action: Call `setTeachingState` with `phase='transition'` to progress to the next topic segment.\n" +
        "  - Execution: Only after the current topic is fully completed and cleared by the student, transition to the next topic. Do NOT clear the chalkboard (do NOT call `updateWhiteboard` with ''), waisa hi rehne dein taaki content upar scroll ho sake, increment the slide progress by calling `moveToNextTopic`, and immediately loop back to Phase 1 ('intro') for the next topic/chapter without any conversational pause!\n" +
        "  - Graduation: When all topics are completed, sassyly congratulate the student, call `setTeachingState` with `phase='complete'` and call `classIsComplete`.\n\n" +
        "🛑 STRICT GUARDRAILS & CORE RULES:\n" +
        "1. Strict Fidelity (No Omission): You must display and explain the content exactly same-to-same as it appears in the uploaded document. Do not summarize, generalize, or skip any part of the text.\n" +
        "2. Order of Execution: Always Type/Draw on the Board FIRST in Phase 2, then Read & Explain SECOND in Phase 3, and Interact THIRD in Phase 4. Do not mix these up.\n" +
        "3. Tone & Language: Maintain a warm, encouraging, sassy and highly interactive classroom teaching tone (Hinglish/Natural Mix). Address them by name and maintain a steady, relaxed pace.\n\n" +
        `Introduce the synchronized YouTube study course, greet the student enthusiastically, and start teaching Part ${currentActiveIdx + 1} immediately by executing Step 2 (Introductory Lecture)!`;
    } else {
      baseInstruction += 
        "\n\n[IMPROVED PEDAGOGICAL WORKFLOW: SEGMENTED DOCUMENT-DRIVEN CLASSROOM SYSTEM]\n" +
        "You MUST strictly follow this exact structured teaching workflow for the uploaded document. " +
        `The active syllabus segment is Part ${currentActiveIdx + 1} of ${totalTopics} (filename: "${activeDocument.filename}"):\n` +
        `--- START OF CURRENT TOPIC SEGMENT (SOURCE OF TRUTH) ---\n${activeTopicContent}\n--- END OF CURRENT TOPIC SEGMENT ---\n\n` +
        "🧭 WORKFLOW EXECUTION PLAN (STEP-BY-STEP) - CHERRY'S SEQUENCE LAW:\n" +
        "You MUST follow an absolute chronological linear phase progression for every single topic. " +
        "You are STRICTLY FORBIDDEN from skipping, jumping, or merging any teaching phases. The lesson MUST always proceed sequentially in this exact linear order: Phase 1 ('intro') -> Phase 2 ('concept') -> Phase 3 ('example' / Explaining) -> Phase 4 ('doubt') -> Phase 5 ('transition'), followed by Phase 1 of the next topic. " +
        "You MUST ensure that Cherry goes from Intro to Concept, from Concept to Explaining, from Explaining to Doubt, and from Doubt to Transition. Never skip a phase or jump directly between non-adjacent phases. Each state MUST be explicitly set using the setTeachingState tool.\n\n" +
        "Step 1: Deep Analysis & Topic Division\n" +
        "  - Action: Deeply analyze the entire uploaded content of this active segment.\n" +
        "  - Execution: Divide this content into logical, sequential topics. Ensure every single sentence, formula, and detail from this segment is mapped into these topics with ZERO OMISSION.\n\n" +
        "Phase 1: Introduction (Prichey - 'intro')\n" +
        "  - Action: Deliver a live voice introduction and set up the Roadmap/Agenda outline.\n" +
        "  - Execution: Sassyly greet the student. You MUST call the `setTeachingState` tool with `phase='intro'` immediately. Present an incredibly attractive, fascinating, and curiosity-building high-level teaser and intuitive overview (bhumika) of the entire active content segment. Call `updateWhiteboard` to write ONLY the main Topic Title and a neat Roadmap Agenda outline on the blackboard. Do NOT write full definitions or formulas yet.\n\n" +
        "Phase 2: Concept Verification (Prastutikaran - 'concept')\n" +
        "  - Action: Call progress teaching state with `phase='concept'` first. Call `updateWhiteboard` to write exact formulas, definitions & diagrams.\n" +
        "  - Execution: Your chalkboard notes MUST be a 100% verbatim copy of the text and LaTeX in the `=== VERBATIM SOURCE OF TRUTH FOR PART X ===` block (where X is the current active topic/slide index) provided above. You are strictly forbidden from writing customized, summarized, rearranged, or simplified notes. Do not write any sassy dialogue or friendly filler text on the chalkboard. Keep it 100% same-to-same. If there's an active vector diagram, draw its matching neon XML SVG. Verbalize a tiny, brief note ('Ruko beta, main board prepare kar rahi hoon... tab tak is title ko dhyan se dekho!') and focus fully on the blackboard update.\n\n" +
        "Phase 3: Explaining (Vishy-Vastoo ka gyan - 'example')\n" +
        "  - Action: बोर्ड पर लिखे गए थ्योरी को एक-एक कर लाइन-बाय-लाइन padhte hue sath sath line by line गहराई से समझाना।\n" +
        "  - Execution: Read the typed content from the board aloud step-by-step, line-by-line, explaining the core concepts, math derivations, proofs, or chemical formulas deeply and simultaneously as you read through them in your sweet, sassy Hinglish tone.\n\n" +
        "Phase 4: Doubt Check (Mulyankan - 'doubt')\n" +
        "  - Action: Call progress teaching state with `phase='doubt'` to enter the Doubt checkpoint.\n" +
        "  - Execution: Sassyly ask the student: 'Is point me koi doubt hai, beta? Sab crystal clear?'. This is the ONLY phase where you stop speaking and wait silently for the student to talk and reply verbally.\n\n" +
        "Phase 5: Transition (Agla Kadam - 'transition')\n" +
        "  - Action: Call `setTeachingState` with `phase='transition'` to progress to the next topic segment.\n" +
        "  - Execution: Only after the current topic is fully completed and cleared by the student, transition to the next topic. Do NOT clear the chalkboard (do NOT call `updateWhiteboard` with ''), waisa hi rehne dein taaki content upar scroll ho sake, increment the slide progress by calling `moveToNextTopic`, and immediately loop back to Phase 1 ('intro') for the next topic/chapter without any conversational pause!\n" +
        "  - Graduation: When all topics are completed, sassyly congratulate the student, call `setTeachingState` with `phase='complete'` and call `classIsComplete`.\n\n" +
        "🛑 STRICT GUARDRAILS & CORE RULES:\n" +
        "1. Strict Fidelity (No Omission): You must display and explain the content exactly same-to-same as it appears in the uploaded document. Do not summarize, generalize, or skip any part of the text.\n" +
        "2. Order of Execution: Always Type/Draw on the Board FIRST in Phase 2, then Read & Explain SECOND in Phase 3, and Interact THIRD in Phase 4. Do not mix these up.\n" +
        "3. Tone & Language: Maintain a warm, encouraging, sassy and highly interactive classroom teaching tone (Hinglish/Natural Mix). Address them by name and maintain a steady, relaxed pace.\n\n" +
        `Sassyly greet the student and initiate Phase 1 (Introductory Lecture) of this syllabus session for '${activeDocument.filename}' now!`;
    }

    if (activeSessionBackup.history.length > 0) {
      baseInstruction += `\n\n[RECONNECTION WORKFLOW ACTIVE]: Note that the student was already studying this document with you. The last active teaching phase was: '${activeSessionBackup.teachingPhase}'. Do NOT start from scratch or re-introduce the document. Re-greet them sassyly, check what was written on the board, and continue your explanation exactly from where you left off!`;
    }
  } else {
    baseInstruction += 
      "\n\n[CO-LEARNING/FREE-FORM INTERACTIVE CLASS MODE]:\n" +
      "Since the student has not uploaded any syllabus document, you are conducting an upscale interactive free-form session. " +
      "Wait for the student to suggest a topic (e.g. quantum physics, calculus, organic chemistry, or romanticism poetry) or suggest one in a sassy, playful way.\n" +
      "Once a topic is selected, you MUST systematically run through your 5-phase teaching state machine and write/draw notes on the whiteboard by calling the `updateWhiteboard` tool with continuous, smooth timing:\n" +
      "   - STRICT SEQUENCE RULE (NO JUMPING/SKIPPING): You are STRICTLY FORBIDDEN from skipping, jumping, or merging any teaching phases. The lesson MUST always proceed linearly in this exact chronological order for every segment/topic: Phase 1 ('intro') -> Phase 2 ('concept') -> Phase 3 ('example' / Explaining) -> Phase 4 ('doubt') -> Phase 5 ('transition'), followed by Phase 1 of the next topic. You MUST transition from Intro to Concept, from Concept to Explaining, from Explaining to Doubt, and from Doubt to Transition. Never skip a phase or transition directly between non-adjacent phases. Each state must be explicitly set and synchronized using the `setTeachingState` tool in standard sequence under solid continuity.\n" +
      "   - Phase 1: Introduction (Prichey - 'intro') -> Introduce the topic verbally with a highly attractive, fascinating, and curiosity-building hook/teaser (ekdam gazab aur engaging bhumika set karo jo student me intense interest, wonder, aur curiosity paida kar de aur use aage ke lectures lene ke liye super excited kar de!). You MUST call `setTeachingState` with `phase='intro'` AND call the `updateWhiteboard` tool to write the Topic Title AND a bullet-point 'Roadmap / Key Subtopics Agenda' on the board so that visual content is visible immediately.\n" +
      "   - Phase 2: Concept Verification (Prastutikaran - 'concept') -> Call `setTeachingState` with `phase='concept'` and call `updateWhiteboard` to write out main definitions, LaTeX equations, bullet points, or draw beautiful neon XML SVG diagrams on the blackboard so the student can see the math/concepts as you discuss them. Ensure kare ki Cherry Board par exactly same to same contents type/draw kare jo topic discussion me moujud ho isase bahar ke chije ko bilkul bhi type/draw na kare.\n" +
      "   - Phase 3: Explaining (Vishy-Vastoo ka gyan - 'example') -> Call `setTeachingState` with `phase='example'` and optionally call `updateWhiteboard` (using append=true or writing additional derivation steps). Read the chalkboard line-by-line, explaining it deeply simultaneously as you read (board par likhi theory ko ek-ek kar line-by-line padhte hue saath saath gaharai se samjhana) in your sassy, cool Indian Hinglish tone.\n" +
      "   - Phase 4: Doubt Check (Mulyankan - 'doubt') [THE ONLY INTERACTIVE CHECKPOINT] -> Stop and ask a conceptual question or ask if they have any doubts: 'Kya aapko ye concept bilkul crystal-clear ho gaya? Koi doubt hai toh poocho'. Pause and wait silently for the student to speak and reply. You MUST call `setTeachingState` with `phase='doubt'`.\n" +
      "   - Phase 5: Transition (Agla Kadam - 'transition') -> Once they confirm they understood, make a quick transition joke/comment, call `moveToNextTopic` to advance UI trackers, do NOT clear the blackboard (do NOT call `updateWhiteboard` with empty string '', preserve all previous content so it scrolls up), call `setTeachingState` with `phase='transition'`, and immediately jump directly into Phase 1 ('intro') of the next topic/sub-chapter in that same turn without waiting!;\n" +
      "   - Phase 6: Graduation / Class Complete (Maha-Samapan) -> When you are ready to conclude the session and the student confirms they have no more questions, congratulate them warmly on completing the freeform session! Call `setTeachingState` with `phase='complete'` and call the `classIsComplete` tool to celebrate their graduation!";

    if (activeSessionBackup.history.length > 0) {
      baseInstruction += `\n\n[RECONNECTION WORKFLOW ACTIVE]: Note that the student was already studying with you. The last active teaching phase was: '${activeSessionBackup.teachingPhase}'. Do NOT start from scratch or re-introduce yourself. Sassyly resume teaching from where you paused!`;
    }
  }

  try {
    session = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Aoede", // Female sass-friendly voice
            },
          },
        },
        systemInstruction: baseInstruction,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [
          {
            functionDeclarations: [
              {
                name: "getWhiteboardContent",
                description: "Retrieves all current history of text, equations, and topics written or discussed on the board in this session. Call this when the student asks what was taught, what is currently written on the board, or to review/repeat a previous formula/example.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {},
                },
              },
              {
                name: "openWebsite",
                description: "Opens a popular website URL in the user's browser. Call this when the user requests to visit, search, or look at a specific platform or link.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    url: {
                      type: Type.STRING,
                      description: "The full absolute URL to open (e.g. 'https://www.youtube.com', 'https://www.github.com').",
                    },
                    name: {
                      type: Type.STRING,
                      description: "A friendly name for the website (e.g. 'YouTube' or 'Google').",
                    },
                  },
                  required: ["url", "name"],
                },
              },
              {
                name: "changeTheme",
                description: "Changes the visual theme and mood of the UI. Pick the most suitable style based on user requests, colors, or emotional vibes.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    theme: {
                      type: Type.STRING,
                      description: "The theme to apply. Expected values are: 'cherry' (fiery red), 'matrix' (neon green), 'cyber' (bright cyber violet), 'sunset' (warm electric amber), 'slate' (sleek charcoal).",
                    },
                  },
                  required: ["theme"],
                },
              },
              {
                name: "classIsComplete",
                description: "Call this tool AFTER you have explained all topics, asked the student if they have any doubt or question, and they confirmed they don't have any more doubts. This will formally end the lecture and trigger the graduation celebration.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {},
                },
              },
              {
                name: "setTeachingState",
                description: "Updates the current active teaching phase of Cherry Ma'am's lesson. Expected values: 'intro' (Prichey), 'concept' (Chalk notes writing), 'example' (Deep dive explanation), 'doubt' (Student doubt solving), 'transition' (moving to next topic).",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    phase: {
                      type: Type.STRING,
                      description: "The current phase of the lesson: 'intro', 'concept', 'example', 'doubt', or 'transition'.",
                    },
                  },
                  required: ["phase"],
                },
              },
              {
                name: "moveToNextTopic",
                description: "Saves current board progress, updates syllabus tracking index, and scrolls the center visual classroom slide safely to the next topic/section of the document in the UI. Call this when you make a Phase 5 transition or before loading the next study material on the blackboard.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {},
                },
              },
              {
                name: "updateWhiteboard",
                description: "Writes, updates, solves formulas, LaTeX equations, diagrams, or bullet lists on the classroom board that Cherry Ma'am is actively teaching. Use this tool HEAVILY whenever introducing a concept (concept phase) or drawing/illustrating diagrams. It makes the notes/sketches immediately display on the blackboard screen.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    content: {
                      type: Type.STRING,
                      description: "The complete, formatted whiteboard notes content (preferably in beautiful LaTeX equations like $$y^2 = 4ax$$, definitions, lists, or custom responsive neon XML SVG diagram layouts) following curriculum guidelines.",
                    },
                    append: {
                      type: Type.BOOLEAN,
                      description: "Set to true to append to existing blackboard notes. Set to false (default) to replace the current whiteboard content entirely.",
                    }
                  },
                  required: ["content"],
                },
              },
            ],
          },
        ],
      },
      callbacks: {
        onmessage: (message) => {
          // Send raw audio chunk to client
          const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audioData) {
            clientWs.send(JSON.stringify({ type: "audio", data: audioData }));
          }

          // Handle Interruption
          if (message.serverContent?.interrupted) {
            console.log("[WS Server] Gemini Live session interrupted by user input.");
            if (currentCherrySpeechAccumulating.trim()) {
              currentSessionHistory.push({ sender: "cherry", text: currentCherrySpeechAccumulating + " (Interrupted)" });
              currentCherrySpeechAccumulating = "";
              activeSessionBackup.history = [...currentSessionHistory];
            }
            clientWs.send(JSON.stringify({ type: "interrupted" }));
          }

          // Handle Tool Call
          if (message.toolCall) {
            console.log("[WS Server] Tool call from Gemini received:", message.toolCall);
            
            // Intercept setTeachingState and save to session backup
            if (message.toolCall.functionCalls) {
              const stateCalls = message.toolCall.functionCalls.filter(fc => fc.name === "setTeachingState");
              if (stateCalls.length > 0) {
                const phaseVal = stateCalls[0].args?.phase;
                if (typeof phaseVal === "string") {
                  let proposed = phaseVal.toLowerCase();
                  if (proposed === "explanating" || proposed === "explaining" || proposed === "explanation" || proposed === "explain") {
                    proposed = "example";
                  }
                  const cur = (activeSessionBackup.teachingPhase || "intro").toLowerCase();
                  
                  const validPhases = ["intro", "concept", "example", "doubt", "transition", "complete"];
                  let isValid = validPhases.includes(proposed);
                  
                  let sequenceValid = true;
                  if (isValid && cur !== proposed) {
                    const nextMap: Record<string, string[]> = {
                      intro: ["concept"],
                      concept: ["example"],
                      example: ["doubt"],
                      doubt: ["transition", "complete"],
                      transition: ["intro", "complete"],
                      complete: ["intro", "concept", "example", "doubt", "transition", "complete"]
                    };
                    const allowedNext = nextMap[cur] || [];
                    if (!allowedNext.includes(proposed)) {
                      sequenceValid = false;
                    }
                  }
                  
                  if (isValid && sequenceValid) {
                    activeSessionBackup.teachingPhase = proposed;
                    console.log("[WS Server] Intercepted valid setTeachingState. Saved phase to backup:", activeSessionBackup.teachingPhase);
                  } else {
                    console.warn(`[WS Server] Rejected invalid or out-of-sequence state backup transition from '${cur}' to '${proposed}'`);
                  }
                }
              }

              // Intercept updateWhiteboard and save to session backup
              const boardCalls = message.toolCall.functionCalls.filter(fc => fc.name === "updateWhiteboard");
              if (boardCalls.length > 0) {
                const contentVal = boardCalls[0].args?.content;
                const appendVal = boardCalls[0].args?.append;
                if (typeof contentVal === "string") {
                  if (appendVal === true) {
                    activeSessionBackup.whiteboardNotes = (activeSessionBackup.whiteboardNotes + "\n\n" + contentVal).trim();
                  } else {
                    activeSessionBackup.whiteboardNotes = contentVal.trim();
                  }
                  console.log("[WS Server] Intercepted updateWhiteboard. Saved notes state length:", activeSessionBackup.whiteboardNotes.length);
                }
              }

              // Intercept moveToNextTopic and update activeTopicIndex
              const nextCalls = message.toolCall.functionCalls.filter(fc => fc.name === "moveToNextTopic");
              if (nextCalls.length > 0) {
                if (activeDocument) {
                  const chunkList = sliceMarkdownToTopics(activeDocument.markdown);
                  const maxIdx = chunkList.length - 1;
                  const currentIdx = typeof activeSessionBackup.activeTopicIndex === "number" ? activeSessionBackup.activeTopicIndex : 0;
                  if (currentIdx < maxIdx) {
                    activeSessionBackup.activeTopicIndex = currentIdx + 1;
                    console.log("[WS Server] Intercepted moveToNextTopic. Incremented local activeTopicIndex to:", activeSessionBackup.activeTopicIndex);
                    
                    // Force-feed client content (as a user turn / system prompt) to Gemini Live
                    if (session && isGeminiActive) {
                      try {
                        const nextPartIndex = activeSessionBackup.activeTopicIndex + 1;
                        session.sendClientContent({
                          turns: [
                            {
                              role: "user",
                              parts: [
                                {
                                  text: `[SYSTEM MESSAGE]: Slide transition successful in UI. You have transitioned to Part ${nextPartIndex} of ${chunkList.length}.\n` +
                                        `Therefore, for your current Concept Phase (Phase 2), your board notes MUST be a 100% same-to-same verbatim copy of the text in the "=== VERBATIM SOURCE OF TRUTH FOR PART ${nextPartIndex} ===" block that you have in your initial system instructions.\n` +
                                        `Do NOT make any external additions, custom definitions, or summaries. Clear the whiteboard, then greet the student, set state to 'intro', draw the roadmap/agenda outline, and then set state to 'concept' and write the exact, same-to-same content of Part ${nextPartIndex}.`
                                }
                              ],
                              turnComplete: true,
                            }
                          ]
                        });
                        console.log(`[WS Server] Pushed sync-update for Part ${nextPartIndex} to running Gemini Live Session`);
                      } catch (err) {
                        console.error("[WS Server] Error pushing transition sync-update to Gemini Live:", err);
                      }
                    }
                  }
                }
              }
            }

            // Handle getWhiteboardContent tool calls locally on the server
            let handledOnServer = false;
            if (message.toolCall.functionCalls) {
              const serverCalls = message.toolCall.functionCalls.filter(fc => fc.name === "getWhiteboardContent");
              if (serverCalls.length > 0) {
                handledOnServer = true;
                // Extract active whiteboard content from cherry's history
                const blackboardNotesList: string[] = [];
                currentSessionHistory.forEach(h => {
                  if (h.sender === "cherry") {
                    const text = h.text;
                    let lastIdx = 0;
                    while (true) {
                      const openIdx = text.toLowerCase().indexOf("<board>", lastIdx);
                      if (openIdx === -1) break;
                      const closeIdx = text.toLowerCase().indexOf("</board>", openIdx + 7);
                      if (closeIdx !== -1) {
                        blackboardNotesList.push(text.slice(openIdx + 7, closeIdx).trim());
                        lastIdx = closeIdx + 8;
                      } else {
                        blackboardNotesList.push(text.slice(openIdx + 7).trim());
                        break;
                      }
                    }
                  }
                });
                const activeWhiteboardNotes = activeSessionBackup.whiteboardNotes || blackboardNotesList.filter(Boolean).join("\n---\n") || "No notes written on the blackboard yet.";
                const conversationTranscript = currentSessionHistory.map(h => `${h.sender === "cherry" ? "Cherry Ma'am" : "Student"}: ${h.text}`).join("\n");
                
                const responseText = `[ACTIVE BLACKBOARD CONTENT / NOTES WRITTEN ON THE BOARD]:\n${activeWhiteboardNotes}\n\n[CONVERSATION TRANSCRIPT / DIALOGUE HISTORY]:\n${conversationTranscript || "No conversation started yet."}`;
                console.log("[WS Server] Answering getWhiteboardContent tool call locally:\n", responseText);
                
                if (session) {
                  try {
                    session.sendToolResponse({
                      functionResponses: serverCalls.map(fc => ({
                        id: fc.id,
                        name: fc.name,
                        response: { success: true, whiteboardContent: responseText }
                      }))
                    });
                  } catch (err) {
                    console.error("[WS Server] Error sending getWhiteboardContent response:", err);
                  }
                }
              }
            }
            
            if (!handledOnServer) {
              clientWs.send(JSON.stringify({ type: "toolCall", toolCall: message.toolCall }));
            }
          }

          // Emit user input transcription
          if (message.serverContent?.inputTranscription?.text) {
            const txt = message.serverContent.inputTranscription.text;
            const finished = !!message.serverContent.inputTranscription.finished;
            currentStudentSpeechAccumulating += txt;
            if (finished) {
              currentSessionHistory.push({ sender: "student", text: currentStudentSpeechAccumulating });
              currentStudentSpeechAccumulating = "";
              activeSessionBackup.history = [...currentSessionHistory];
            }
            clientWs.send(
              JSON.stringify({
                type: "inputTranscription",
                text: txt,
                finished: finished,
              })
            );
          }

          // Emit backend model output transcription
          if (message.serverContent?.outputTranscription?.text) {
            const txt = message.serverContent.outputTranscription.text;
            const finished = !!message.serverContent.outputTranscription.finished;
            currentCherrySpeechAccumulating += txt;
            if (finished) {
              currentSessionHistory.push({ sender: "cherry", text: currentCherrySpeechAccumulating });
              currentCherrySpeechAccumulating = "";
              activeSessionBackup.history = [...currentSessionHistory];
            }
            clientWs.send(
              JSON.stringify({
                type: "outputTranscription",
                text: txt,
                finished: finished,
              })
            );
          }
        },
        onclose: (e: any) => {
          console.log(`[WS Server] Gemini Live WebSocket closed. Code: ${e?.code || 'N/A'}, Reason: ${e?.reason || 'N/A'}`);
          isGeminiActive = false;
          clientWs.send(JSON.stringify({ type: "disconnected", reason: `Gemini connection closed (${e?.reason || 'no reason'})` }));
          clientWs.close();
          if (session) {
            try {
              session.close();
            } catch (err) {}
            session = null;
          }
        },
        onerror: (err: any) => {
          console.error("[WS Server] Gemini session error:", err);
          isGeminiActive = false;
          clientWs.send(JSON.stringify({ type: "error", error: err?.message || err?.toString() || "Gemini Live Session error" }));
          clientWs.close();
          if (session) {
            try {
              session.close();
            } catch (err2) {}
            session = null;
          }
        },
      },
    });

    console.log("[WS Server] Connected to Gemini bidi Socket successfully!");
    clientWs.send(JSON.stringify({ type: "ready" }));

    // Resume client-side teaching phase state if active
    if (activeSessionBackup.history.length > 0) {
      clientWs.send(JSON.stringify({
        type: "restoreState",
        teachingPhase: activeSessionBackup.teachingPhase,
        whiteboardNotes: activeSessionBackup.whiteboardNotes,
      }));
    }
  } catch (error: any) {
    console.error("[WS Server] Failed connecting to Gemini Live:", error);
    clientWs.send(JSON.stringify({ type: "error", error: "Failed to connect to Gemini Live: " + error.message }));
    clientWs.close();
    return;
  }

  // Handle messages from client browser
  clientWs.on("message", (messageBuffer) => {
    try {
      const msg = JSON.parse(messageBuffer.toString());
      if (msg.type === "audio" && msg.data) {
        if (isGeminiActive && session) {
          try {
            session.sendRealtimeInput({
              audio: {
                data: msg.data,
                mimeType: "audio/pcm;rate=16000",
              },
            });
          } catch (sendErr: any) {
            console.error("[WS Server] Error sending audio input to Gemini:", sendErr.message);
            isGeminiActive = false;
            try {
              session.close();
            } catch (e) {}
            session = null;
          }
        }
      } else if (msg.type === "toolResponse" && msg.id && msg.name) {
        console.log("[WS Server] Relaying tool response to Gemini Live:", msg);
        if (isGeminiActive && session) {
          try {
            session.sendToolResponse({
              functionResponses: [
                {
                  id: msg.id,
                  name: msg.name,
                  response: msg.response || { success: true },
                },
              ],
            });
          } catch (sendErr: any) {
            console.error("[WS Server] Error sending tool response to Gemini:", sendErr.message);
            isGeminiActive = false;
          }
        }
      } else if (msg.type === "injectPrompt" && msg.text) {
        console.log("[WS Server] Injecting client text prompt to Gemini:", msg.text);
        if (isGeminiActive && session) {
          try {
            session.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [{ text: msg.text }],
                }
              ],
              turnComplete: true,
            });
          } catch (error: any) {
            console.error("[WS Server] Failed to inject prompt text:", error);
          }
        }
      } else if (msg.type === "syncActiveTopic" && typeof msg.activeTopicIndex === "number") {
        console.log("[WS Server] Synced active topic index from client:", msg.activeTopicIndex);
        activeSessionBackup.activeTopicIndex = msg.activeTopicIndex;
        if (activeDocument && isGeminiActive && session) {
          try {
            const chunkList = sliceMarkdownToTopics(activeDocument.markdown);
            session.sendClientContent({
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: `[SYSTEM MESSAGE]: Active topic segment index synchronized to Part ${activeSessionBackup.activeTopicIndex + 1} of ${chunkList.length}.\n` +
                            `Please ensure that for Phase 2 ('concept'), you copy the exact verbatim content of "=== VERBATIM SOURCE OF TRUTH FOR PART ${activeSessionBackup.activeTopicIndex + 1} ===" without any summaries.`
                    }
                  ],
                  turnComplete: true,
                }
              ]
            });
            console.log(`[WS Server] Pushed syncActiveTopic update for Part ${activeSessionBackup.activeTopicIndex + 1} to Gemini Live`);
          } catch (err) {
            console.error("[WS Server] Error pushing syncActiveTopic update to Gemini Live:", err);
          }
        }
      } else if (msg.type === "ping") {
        clientWs.send(JSON.stringify({ type: "pong" }));
      }
    } catch (err: any) {
      console.error("[WS Server] Error processing client message:", err);
    }
  });

  // Client disconnected
  clientWs.on("close", () => {
    console.log("[WS Server] Client disconnected from session.");
    isGeminiActive = false;
    if (session) {
      try {
        session.close();
      } catch (e) {
        // Safe check
      }
      session = null;
    }
  });
});

// Setup Vite Dev Server / Static Asset delivery
async function startViteMiddleware() {
  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Mounting Vite developer middleware...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[Server] Serving production static files...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  
  // Start server
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Voice AI Assistant server running on http://0.0.0.0:${PORT}`);
  });
}

startViteMiddleware().catch((err) => {
  console.error("[Server] Error during Vite middleware startup:", err);
});
