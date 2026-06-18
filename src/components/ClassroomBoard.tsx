import React, { useRef, useState, useEffect } from "react";
import { MathRenderer } from "./MathRenderer";
import { ChalkTypewriter } from "./ChalkTypewriter";
import { Trash2, GraduationCap, RefreshCw, Maximize2, Minimize2, BookOpen, Sparkles, HelpCircle, Send, Printer, ChevronDown, Power, MicOff } from "lucide-react";
import { extractBoardContent } from "../utils/boardFilter";

interface ClassroomBoardProps {
  latestSpeech: string;
  state: string;
  primaryColor: string;
  accentColor: string;
  onClearBoard?: () => void;
  // Let student trigger interactive lesson prompts with Cherry out loud
  onSelectPrompt?: (promptText: string) => void;
  overrideBlank?: boolean;
  activeDocumentText?: string;
  hasActiveDocument?: boolean;
  studentAskedForWritingOrDrawing?: boolean;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  cherryVolume?: number;
  onOpenSyllabus?: () => void;
  onWakeUp?: () => void;
  teachingPhase?: string;
  customBoardContent?: string;
  onSaveSnapshot?: () => void;
  // Infinite scroll vertical timeline properties
  topics?: string[];
  activeTopicIndex?: number;
  topicBoardsContent?: Record<number, string>;
  onSyncBoardContent?: (topicIndex: number, content: string) => void;
}

export const ClassroomBoard: React.FC<ClassroomBoardProps> = ({
  latestSpeech,
  state,
  primaryColor,
  accentColor,
  onClearBoard,
  onSelectPrompt,
  overrideBlank = false,
  activeDocumentText,
  hasActiveDocument,
  studentAskedForWritingOrDrawing = false,
  isFullScreen = false,
  onToggleFullScreen,
  cherryVolume = 0,
  onOpenSyllabus,
  onWakeUp,
  teachingPhase = "intro",
  customBoardContent,
  onSaveSnapshot,
  topics = [],
  activeTopicIndex = 0,
  topicBoardsContent = {},
  onSyncBoardContent,
}) => {
    const [activeBoardContent, setActiveBoardContent] = useState("");
  const [isBoardTagActive, setIsBoardTagActive] = useState(false);
  const [isDeskExpanded, setIsDeskExpanded] = useState(false);
  const lastProcessedSpeechRef = useRef("");
  const boardSliceRef = useRef<HTMLDivElement>(null);
  const activeBlockRef = useRef<HTMLDivElement>(null);
  const [showJumpBadge, setShowJumpBadge] = useState(false);

  // Propagate real-time whiteboard updates (derived from speaker transcript) back up to parent App
  useEffect(() => {
    if (onSyncBoardContent && activeBoardContent !== undefined) {
      onSyncBoardContent(activeTopicIndex, activeBoardContent);
    }
  }, [activeBoardContent, activeTopicIndex, onSyncBoardContent]);

  // Synchronically align vertical viewport to focus on the active topic block when it changes
  useEffect(() => {
    if (boardSliceRef.current && activeBlockRef.current) {
      const parent = boardSliceRef.current;
      const child = activeBlockRef.current;
      const scrollOffset = child.offsetTop - parent.offsetTop;
      
      parent.scrollTo({
        top: Math.max(0, scrollOffset - 24), // Leave a little padding at the top for aesthetic breathing room
        behavior: "smooth"
      });
    }
  }, [activeTopicIndex]);

  // Keep scrolling to match active writing updates if the student was already near the bottom
  useEffect(() => {
    if (boardSliceRef.current) {
      const el = boardSliceRef.current;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240;
      if (isAtBottom && activeBoardContent) {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: "smooth"
        });
      }
    }
  }, [activeBoardContent, teachingPhase]);

  // Handle manual scroll to show/hide the "Jump to Live Focus" floating badge
  const handleScroll = () => {
    if (boardSliceRef.current) {
      const el = boardSliceRef.current;
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 180;
      setShowJumpBadge(!isAtBottom);
    }
  };

  // Jump to active topic handler for student review convenience
  const handleJumpToActive = () => {
    if (boardSliceRef.current && activeBlockRef.current) {
      const parent = boardSliceRef.current;
      const child = activeBlockRef.current;
      const scrollOffset = child.offsetTop - parent.offsetTop;
      
      parent.scrollTo({
        top: Math.max(0, scrollOffset - 24),
        behavior: "smooth"
      });
    }
  };

  const isConnected = state !== "disconnected" && state !== "connecting" && state !== "error";

  interface AutoSavedDraft {
    id: string;
    timestamp: string;
    topicTitle: string;
    blobUrl: string;
    filename: string;
  }

  const [autoSavedDrafts, setAutoSavedDrafts] = useState<AutoSavedDraft[]>([]);
  const [isPrinting, setIsPrinting] = useState(false);
  const lastSavedContentRef = useRef<string>("");

  const handlePrintSession = async (silentFileName?: string): Promise<Blob | undefined> => {
    setIsPrinting(true);
    const originalGetComputedStyle = window.getComputedStyle;
    let iframeOriginalGetComputedStyle: any = null;
    let iframeWindowRef: any = null;

    // Safe replace of oklch and oklab if colors were not pre-calculated as standard RGB
    const resolveOklch = (prop: string, val: string): string => {
      if (!val || typeof val !== "string") return val;
      
      // Match OKLCH / OKLAB case insensitively
      const replaced = val.replace(/(oklch|oklab)\(([^)]+)\)/gi, (match, type, content) => {
        // Replace commas with space, and replace '/' slash with space to easily split
        const normalizedContent = content.replace(/,/g, " ").replace(/\//g, " ");
        const parts = normalizedContent.trim().split(/\s+/);
        const cleanParts = parts.filter(p => p !== "");
        
        let l = 1;
        const lPart = cleanParts[0];
        if (lPart) {
          if (lPart.endsWith("%")) {
            l = parseFloat(lPart) / 100;
          } else {
            l = parseFloat(lPart);
          }
        }
        if (isNaN(l)) l = 1;

        let opacity = 1;
        const lastPart = cleanParts[cleanParts.length - 1];
        // If there are 4 parts, or if slash was used, the last part represents opacity
        if (cleanParts.length >= 4) {
          if (lastPart.endsWith("%")) {
            opacity = parseFloat(lastPart) / 100;
          } else {
            opacity = parseFloat(lastPart);
          }
        }
        if (isNaN(opacity)) opacity = 1;

        const tLow = type.toLowerCase();
        if (tLow === "oklch" && cleanParts.length >= 3) {
          let h = parseFloat(cleanParts[2]);
          if (isNaN(h)) h = 0;
          let c = parseFloat(cleanParts[1]);
          if (isNaN(c)) c = 0;
          const s = Math.min(100, Math.round(c * 150));
          const lightness = Math.min(100, Math.round(l * 100));
          return `hsla(${Math.round(h)}, ${s}%, ${lightness}%, ${opacity})`;
        }

        if (tLow === "oklab" && cleanParts.length >= 3) {
          let a = parseFloat(cleanParts[1]);
          let b = parseFloat(cleanParts[2]);
          if (isNaN(a)) a = 0;
          if (isNaN(b)) b = 0;
          
          let r = Math.round(l * 255);
          let g = Math.round(l * 255);
          let bl = Math.round(l * 255);
          
          if (a > 0.02) {
            r = Math.min(255, r + 50);
            g = Math.max(0, g - 20);
          } else if (a < -0.02) {
            g = Math.min(255, g + 50);
            r = Math.max(0, r - 20);
          }
          if (b > 0.02) {
            r = Math.min(255, r + 30);
            g = Math.min(255, g + 30);
            bl = Math.max(0, bl - 40);
          } else if (b < -0.02) {
            bl = Math.min(255, bl + 50);
            r = Math.max(0, r - 20);
          }
          
          return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bl)}, ${opacity})`;
        }

        const val255 = Math.round(l * 255);
        return `rgba(${val255}, ${val255}, ${val255}, ${opacity})`;
      });

      return replaced;
    };

    const makeSafeComputedStyle = (style: CSSStyleDeclaration) => {
      return new Proxy(style, {
        get(target, prop) {
          if (prop === 'getPropertyValue') {
            return function(propertyName: string) {
              const val = target.getPropertyValue(propertyName);
              return resolveOklch(propertyName, val);
            };
          }
          const val = Reflect.get(target, prop);
          if (typeof val === 'string') {
            return resolveOklch(String(prop), val);
          }
          if (typeof val === 'function') {
            return val.bind(target);
          }
          return val;
        }
      });
    };

    try {
      const html2pdf = await new Promise<any>((resolve, reject) => {
        if ((window as any).html2pdf) {
          resolve((window as any).html2pdf);
          return;
        }
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
        script.onload = () => resolve((window as any).html2pdf);
        script.onerror = () => reject(new Error("Failed to load PDF engine"));
        document.head.appendChild(script);
      });

      const element = document.getElementById("chalkboard-main-slate");
      if (!element) {
        if (!silentFileName) alert("Board content container not found!");
        return undefined;
      }

      // Create an iframe to render the element completely isolated (with no parent oklch stylesheets)
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.left = "-9999px";
      iframe.style.top = "0";
      iframe.style.width = `${element.clientWidth || 1024}px`;
      iframe.style.height = `${element.clientHeight || 768}px`;
      iframe.style.border = "none";
      document.body.appendChild(iframe);

      const iframeWindow = iframe.contentWindow;
      const iframeDoc = iframe.contentDocument || iframeWindow?.document;
      if (!iframeDoc || !iframeWindow) {
        throw new Error("Could not access iframe document");
      }

      iframeDoc.open();
      iframeDoc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Export PDF</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Reenie+Beanie&family=Schoolbell&display=swap');
              body {
                margin: 0;
                padding: 0;
                background-color: #0c201a !important;
                color: #ffffff !important;
              }
            </style>
          </head>
          <body></body>
        </html>
      `);
      iframeDoc.close();

      // Hook up getComputedStyle overrides
      window.getComputedStyle = function(el, pseudoElt) {
        const style = originalGetComputedStyle.call(window, el, pseudoElt);
        return makeSafeComputedStyle(style);
      };

      iframeOriginalGetComputedStyle = iframeWindow.getComputedStyle;
      iframeWindowRef = iframeWindow;
      iframeWindow.getComputedStyle = function(el, pseudoElt) {
        const style = iframeOriginalGetComputedStyle.call(iframeWindow, el, pseudoElt);
        return makeSafeComputedStyle(style);
      };

      // Clone stylesheet links except tailwind
      const parentStyleSheets = document.querySelectorAll("link[rel='stylesheet'], style");
      parentStyleSheets.forEach(sheetNode => {
        const href = sheetNode.getAttribute("href") || "";
        const isTailwind = href.includes("tailwind") || sheetNode.textContent?.includes("@import");
        if (!isTailwind) {
          iframeDoc.head.appendChild(sheetNode.cloneNode(true));
        }
      });

      // Clone root element
      const clone = element.cloneNode(true) as HTMLElement;
      // Strip interactive elements
      const controls = clone.querySelectorAll("button, form, input, textarea, a");
      controls.forEach(ctrl => ctrl.remove());

      // Essential styles to copy
      const PROPERTIES_TO_COPY = [
        "display", "flex-direction", "justify-content", "align-items", "flex-wrap", "flex-grow", "flex-shrink", "gap",
        "position", "top", "right", "bottom", "left", "z-index",
        "width", "height", "min-width", "min-height", "max-width", "max-height",
        "box-sizing",
        "padding-top", "padding-right", "padding-bottom", "padding-left",
        "margin-top", "margin-right", "margin-bottom", "margin-left",
        "font-family", "font-size", "font-weight", "line-height", "text-align", "text-transform", "letter-spacing",
        "color", "background-color", "background-image", "background-size", "background-position", "background-repeat",
        "border-top-width", "border-top-style", "border-top-color",
        "border-right-width", "border-right-style", "border-right-color",
        "border-bottom-width", "border-bottom-style", "border-bottom-color",
        "border-left-width", "border-left-style", "border-left-color",
        "border-radius", "border-collapse", "border-spacing",
        "box-shadow", "opacity", "overflow", "transform", "vertical-align"
      ];

      const inlineStylesRecursively = (srcNode: Element, destNode: Element) => {
        if (srcNode instanceof HTMLElement && destNode instanceof HTMLElement) {
          const computed = window.getComputedStyle(srcNode);
          for (const prop of PROPERTIES_TO_COPY) {
            const rawVal = computed.getPropertyValue(prop);
            const cleanVal = resolveOklch(prop, rawVal);
            destNode.style.setProperty(prop, cleanVal);
          }
        }
        const srcChildren = srcNode.children;
        const destChildren = destNode.children;
        for (let i = 0; i < srcChildren.length; i++) {
          if (srcChildren[i] && destChildren[i]) {
            inlineStylesRecursively(srcChildren[i], destChildren[i]);
          }
        }
      };

      inlineStylesRecursively(element, clone);

      // Force pixel measurements and stretch height to fit the full chronological vertical scrolling timeline!
      clone.style.width = `${element.getBoundingClientRect().width || 1024}px`;
      clone.style.height = "auto";
      clone.style.maxHeight = "none";
      clone.style.overflow = "visible";

      const clonedInnerSheet = clone.querySelector(".overflow-y-auto");
      if (clonedInnerSheet instanceof HTMLElement) {
        clonedInnerSheet.style.height = "auto";
        clonedInnerSheet.style.maxHeight = "none";
        clonedInnerSheet.style.overflow = "visible";
        clonedInnerSheet.style.paddingBottom = "40px"; // Spacing at the bottom for clean padding in PDF
      }

      iframeDoc.body.appendChild(clone);

      const nameToUse = silentFileName || `Cherry_Classroom_Session_${new Date().toISOString().slice(0, 10)}.pdf`;
      const opt = {
        margin: [10, 10, 10, 10],
        filename: nameToUse,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { 
          scale: 2, 
          useCORS: true, 
          backgroundColor: "#0c201a", 
          scrollX: 0,
          scrollY: 0
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
      };

      if (silentFileName) {
        const pdfBlob = await html2pdf().from(clone).set(opt).outputPdf("blob");
        document.body.removeChild(iframe);
        return pdfBlob;
      } else {
        await html2pdf().from(clone).set(opt).save();
      }

      document.body.removeChild(iframe);
    } catch (error) {
      console.error("Failed to generate PDF:", error);
    } finally {
      // Restore original getComputedStyle globally to avoid side effects
      window.getComputedStyle = originalGetComputedStyle;
      if (iframeWindowRef && iframeOriginalGetComputedStyle) {
        iframeWindowRef.getComputedStyle = iframeOriginalGetComputedStyle;
      }
      setIsPrinting(false);
    }
    return undefined;
  };

  // Automated background save functionality
  const triggerBackgroundAutoSave = async (reason: string) => {
    if (!activeBoardContent || activeBoardContent.trim() === "" || activeBoardContent === lastSavedContentRef.current) {
      return;
    }
    lastSavedContentRef.current = activeBoardContent;

    const timestampStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const filename = `Session_Auto_Draft_${Date.now()}.pdf`;

    const pdfBlob = await handlePrintSession(filename);
    if (pdfBlob && pdfBlob instanceof Blob) {
      const blobUrl = URL.createObjectURL(pdfBlob);
      const newDraft: AutoSavedDraft = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: timestampStr,
        topicTitle: reason,
        blobUrl: blobUrl,
        filename: `Cherry_Classroom_Whiteboard_Draft_${timestampStr.replace(/[:\s]/g, "_")}.pdf`
      };

      setAutoSavedDrafts(prev => [newDraft, ...prev].slice(0, 5));
    }
  };

  // Class completion trigger
  const lastStateRef = useRef(state);
  useEffect(() => {
    const prev = lastStateRef.current;
    const curr = state;
    lastStateRef.current = state;

    if ((prev === "connected" || prev === "idle") && curr === "disconnected") {
      triggerBackgroundAutoSave("Class Ended (Automatic Save)");
    }
  }, [state, activeBoardContent]);

  // Major section / Phase change complete trigger
  const lastPhaseRef = useRef(teachingPhase);
  useEffect(() => {
    const prev = lastPhaseRef.current;
    const curr = teachingPhase;
    lastPhaseRef.current = teachingPhase;

    if (prev && curr && prev !== curr) {
      triggerBackgroundAutoSave(`Phase Complete: ${prev.toUpperCase()}`);
    }
  }, [teachingPhase, activeBoardContent]);

  // Sync customBoardContent if provided by the parent
  useEffect(() => {
    if (customBoardContent !== undefined) {
      setActiveBoardContent(customBoardContent);
      setIsBoardTagActive(customBoardContent.trim() !== "");
    }
  }, [customBoardContent]);
  const [customDoubtText, setCustomDoubtText] = useState("");

  const phasesList = ["intro", "concept", "example", "doubt", "transition"];

  // Sync latest speech to active blackboard state with persistent note rendering
  useEffect(() => {
    if (!latestSpeech || latestSpeech.trim() === "") {
      lastProcessedSpeechRef.current = "";
      return;
    }
    
    // Skip if we already fully processed this exact speech string to prevent endless state resets or stomp-overs on re-render
    if (latestSpeech === lastProcessedSpeechRef.current) return;
    lastProcessedSpeechRef.current = latestSpeech;
    
    // Check if the model explicitly wants to wipe/clear the board (empty board tag or clear board text trigger)
    const isWipeTrigger = latestSpeech.toLowerCase().includes("<board></board>") || 
                          latestSpeech.toLowerCase().includes("<board> //clear") ||
                          latestSpeech.toLowerCase().includes("<board>clear</board>") ||
                          latestSpeech.toLowerCase().includes("//clear board") ||
                          latestSpeech.toLowerCase().includes("clear the board") ||
                          latestSpeech.toLowerCase().includes("board clear kare");
                          
    if (isWipeTrigger) {
      setActiveBoardContent("");
      setIsBoardTagActive(false);
      return;
    }

    if (hasActiveDocument) {
      // If there is an active/uploaded document, the chalkboard is a Textbook-exact space.
      // Only the `updateWhiteboard` tool called by Cherry (which maps to customBoardContent) is allowed to write or draw.
      // This strictly prevents spoken speech transcriptions or microphone-derived lyrics (<board> tags in spoken voice) from appearing on the board.
      return;
    }

    const hasBoardTags = latestSpeech.toLowerCase().includes("<board>");
    const hasActiveToolContent = customBoardContent && customBoardContent.trim() !== "";

    // Extract board tags if present in the current speech wave, or fall back to extracting noteworthy academic notes
    const extracted = extractBoardContent(latestSpeech);
    if (extracted && extracted.trim() !== "") {
      // SECURITY GUARD: If we have high-quality, pre-planned notes written by the 'updateWhiteboard' tool,
      // ONLY let spoken speech overwrite it if she explicitly voiced/typed the <board> tags.
      // This protects textbook definitions & clean vector drawings from being ruined by conversational fillers.
      if (hasActiveToolContent && !hasBoardTags) {
        return;
      }
      setActiveBoardContent(extracted);
      setIsBoardTagActive(true);
    }
  }, [latestSpeech, state, customBoardContent, hasActiveDocument]);
  
  // Subject Auto-Detector based on keywords
  const getSubject = (text: string) => {
    if (!text) return { name: "Classroom Introduction", icon: "🎒", theme: "text-rose-300 border-rose-500/30 bg-rose-950/20" };
    const norm = text.toLowerCase();
    if (norm.match(/\\frac|\\sum|\\prod|\\int|equation|quadratic|theorem|trigonometr|algebra|math|matrix|calculus|derive|coefficient|proof/)) {
      return { name: "Mathematics", icon: "📐", theme: "text-amber-300 border-amber-500/30 bg-amber-950/20" };
    }
    if (norm.match(/physics|gravity|mass|velocity|acceleration|quantum|photon|relativity|energy|force|newton|joule|einstein|thermodynamic|numerical/)) {
      return { name: "Physics", icon: "⚛️", theme: "text-blue-300 border-blue-500/30 bg-blue-950/20" };
    }
    if (norm.match(/chemistry|molecule|atom|bond|reaction|covalent|periodic|element|carbon|acid|base|h_2|h2o|co2|catalyst|molecular/)) {
      return { name: "Sci / Chemistry", icon: "🧬", theme: "text-emerald-300 border-emerald-500/30 bg-emerald-950/20" };
    }
    if (norm.match(/poetry|poem|literature|classic|shakespeare|sonnet|epic|rhyme|strophe|verse|metaphor|playwright/)) {
      return { name: "Literature & Art", icon: "📖", theme: "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-950/20" };
    }
    return { name: "Cherry's Class Lecture", icon: "📚", theme: "text-zinc-300 border-zinc-700 bg-zinc-900/30" };
  };

  const subject = getSubject(activeBoardContent || latestSpeech);

  const fullClassroomReset = () => {
    setActiveBoardContent("");
    setIsBoardTagActive(false);
    if (onClearBoard) {
      onClearBoard();
    }
  };

  return (
    <div className="flex flex-col h-full w-full select-none" id="classroom-whiteboard-main">
      {/* Subject Line & Top Chalk Controls Bar */}
      <div className="flex flex-wrap items-center justify-between px-5 py-3 border-b border-[#dae1dd] bg-white gap-3 z-10 font-mono text-xs text-[#486a73]">
        <div className="flex items-center space-x-2.5">
          <span className={`px-2.5 py-1 rounded-full border text-[10px] font-bold tracking-wider flex items-center gap-1.5 ${
            subject.name === "Mathematics"
              ? "bg-[#c4f500]/25 border-[#0a3641]/20 text-[#0a3641]"
              : "bg-teal-50 border-teal-200 text-teal-800"
          }`}>
            <span>{subject.icon}</span>
            <span className="uppercase">{subject.name}</span>
          </span>

          {state !== "disconnected" && (
            (teachingPhase || "intro").toLowerCase() === "concept" && state === "speaking" ? (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold font-mono tracking-wider border bg-amber-50 border-amber-200 text-amber-800 animate-pulse flex items-center gap-1 uppercase select-none">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>🎙️ MIC AUTO-LOCKED (BOARD WRITING...)</span>
              </span>
            ) : (
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold font-mono tracking-wider border flex items-center gap-1 uppercase select-none ${
                state === "connecting"
                  ? "bg-amber-100 border-amber-200 text-amber-800 animate-pulse"
                  : state === "speaking"
                  ? "bg-emerald-100 border-emerald-200 text-emerald-800"
                  : state === "listening"
                  ? "bg-sky-100 border-sky-200 text-sky-800 animate-pulse"
                  : "bg-zinc-100 border-zinc-200 text-zinc-700"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  state === "connecting"
                    ? "bg-amber-400"
                    : state === "speaking"
                    ? "bg-emerald-500"
                    : state === "listening"
                    ? "bg-sky-500"
                    : "bg-zinc-400"
                }`} />
                <span>{state}</span>
              </span>
            )
          )}
        </div>



        {/* Blackboard Chalk Box Utilities */}
        <div className="flex items-center space-x-2.5">
          {/* Sassy Cherry Session Activation / Recess Button */}
          {onWakeUp && (
            <button
              onClick={onWakeUp}
              className={`p-1 px-2.5 text-[10px] rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer font-bold font-mono uppercase tracking-wider ${
                state === "disconnected"
                  ? "bg-[#c4f500] hover:bg-[#b0dc00] border-[#0a3641]/20 text-[#0a3641]"
                  : state === "connecting"
                  ? "bg-amber-100 border-amber-200 text-amber-800"
                  : state === "error"
                  ? "bg-rose-100 border-rose-300 text-rose-800 animate-pulse"
                  : "bg-rose-50 border-rose-250 text-rose-800 hover:bg-rose-100"
              }`}
              title={state === "disconnected" ? "Wake Up Cherry Ma'am" : "Halt Lesson / Recess"}
            >
              {state === "disconnected" ? (
                <>
                  <Power className="w-3.5 h-3.5 text-emerald-700 animate-pulse" />
                  <span>Wake Up 🎙️</span>
                </>
              ) : state === "connecting" ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : state === "error" ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-rose-600" />
                  <span>Reconnect</span>
                </>
              ) : (
                <>
                  <MicOff className="w-3.5 h-3.5 text-rose-700 animate-pulse" />
                  <span>Halt Lesson (Recess) 🛑</span>
                </>
              )}
            </button>
          )}

          {/* Full Screen blackboard toggle */}
          {onToggleFullScreen && (
            <button
              id="toggle-fullscreen-board-btn"
              onClick={onToggleFullScreen}
              className={`px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all ${
                isFullScreen 
                  ? "bg-[#c4f500]/25 border-[#0a3641]/30 text-[#0a3641]" 
                  : "bg-[#f7f9f6] border-[#dae1dd] text-[#0a3641] hover:bg-[#c4f500]/10"
              } cursor-pointer`}
              title="Toggle Full Screen classroom board width"
            >
              {isFullScreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-[#0a3641]" />
                  <span>Standard Screen 📊</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-[#0a3641]" />
                  <span>Full Screen Board 🖥️</span>
                </>
              )}
            </button>
          )}

          {/* Multi-discipline classroom wipe */}
          <button
            id="wipe-board-btn"
            onClick={fullClassroomReset}
            className="p-1 px-2.5 text-[10px] bg-[#f7f9f6] hover:bg-[#dae1dd] text-rose-700 border border-[#dae1dd] rounded-lg flex items-center gap-1.5 transition-all cursor-pointer font-bold font-mono"
            title="Clear active chalkboard & notes"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
            <span>Erasor All board</span>
          </button>
        </div>
      </div>

      {/* Active Teaching Flow Phase Progress Tracker (State Machine Visualizer) */}
      <div 
        className="flex flex-col sm:flex-row items-center justify-between px-5 py-2.5 bg-[#f7f9f6] border-b border-[#dae1dd] gap-3 z-10 select-none w-full" 
        id="teaching-phase-tracker"
      >
        <div className="flex items-center gap-2 font-mono text-[9px] text-[#486a73] uppercase tracking-widest leading-none font-bold">
          <span className="flex h-1.5 w-1.5 shrink-0 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0a3641] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#0a3641]"></span>
          </span>
          <span>🧠 Teach-Flow State:</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 text-[10px] font-sans font-semibold tracking-wide text-[#486a73]">
          {[
            { key: "intro", label: "🎒 Intro", desc: "Prichey" },
            { key: "concept", label: "🖊️ Concept", desc: "Chalk Notes" },
            { key: "example", label: "🔍 Explaining", desc: "Deep Dive" },
            { key: "doubt", label: "❓ Doubts", desc: "Sawal-Jawab" },
            { key: "transition", label: "🚀 Transition", desc: "Agla Topic" },
            { key: "complete", label: "🎓 Graduation", desc: "Class End" },
          ].map((phaseInfo, pIdx, arr) => {
            const isCurrent = (teachingPhase || "intro").toLowerCase() === phaseInfo.key.toLowerCase();
            const themeColors = isCurrent 
              ? "text-[#0a3641] border-[#0a3641]/35 bg-[#c4f500]/25 shadow-sm scale-[1.03] font-bold" 
              : "text-[#486a73] border-[#dae1dd] bg-white hover:text-[#0a3641] hover:border-[#0a3641]/20";
              
            return (
              <React.Fragment key={phaseInfo.key}>
                <div className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-xl border flex items-center gap-1.5 transition-all duration-300 select-none cursor-default ${themeColors}`}>
                  <span className="font-bold whitespace-nowrap text-[8.5px] sm:text-[10px] leading-tight">{phaseInfo.label}</span>
                  <span className="hidden sm:inline-block h-2 w-[1px] bg-[#dae1dd]" />
                  <span className="text-[8px] opacity-75 font-mono select-none hidden sm:inline-block font-semibold">{phaseInfo.desc}</span>
                </div>
                {pIdx < arr.length - 1 && (
                  <span className={`text-[10px] font-mono select-none transition-colors duration-300 ${isCurrent ? "text-[#0a3641] animate-pulse font-extrabold" : "text-[#dae1dd] font-bold"}`}>
                    ➔
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* 💾 Background Whiteboard Backups Bar */}
      {autoSavedDrafts.length > 0 && (
        <div id="whiteboard-auto-drafts-bar" className="bg-emerald-950/20 border-b border-zinc-900 px-5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 z-10 select-none animate-chalk-fade">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
            <Sparkles className="w-3.5 h-3.5 animate-pulse text-emerald-450 shrink-0" />
            <span className="uppercase tracking-widest font-bold">Auto-Saved Blackboard Drafts:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {autoSavedDrafts.map((draft, idx) => (
              <a
                key={draft.id}
                href={draft.blobUrl}
                download={draft.filename}
                className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-emerald-900/40 text-emerald-300 hover:text-white transition-all text-[9px] font-mono font-bold flex items-center gap-1 cursor-pointer select-none"
                title={`Autosaved during: ${draft.topicTitle || "Session"}`}
              >
                <span>💾 Backup #{autoSavedDrafts.length - idx} ({draft.timestamp})</span>
                <span className="text-[7.5px] bg-emerald-950 text-emerald-450 px-1 py-0.2 rounded uppercase font-bold tracking-tight shrink-0">{draft.topicTitle.includes(":") ? draft.topicTitle.split(":")[1].trim() : draft.topicTitle}</span>
                <span>⬇️</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Blackboard Content Area */}
      <div 
        className="relative blackboard-chalk z-0 overflow-hidden flex flex-col w-full h-[55vh] max-h-[55vh] md:h-[640px] md:max-h-[640px]"
        id="chalkboard-main-slate"
      >
        {/* Inner Scrollable Slate Sheet */}
        <div
          ref={boardSliceRef}
          onScroll={handleScroll}
          className={`flex-1 overflow-y-auto p-4 md:p-6 flex flex-col items-center ${
            (activeBoardContent || hasActiveDocument || (activeDocumentText && !overrideBlank) || (topics && topics.length > 0)) 
              ? "justify-start" 
              : "justify-center"
          } select-text scrollbar-thin scrollbar-thumb-emerald-900/60 scrollbar-track-transparent w-full pb-28 touch-pan-y`}
        >
          {/* TEACHER'S ACTIVE EXPLANATIONS (Rendered like realistic chalk equations) */}
          <div className="w-full max-w-4xl lg:max-w-5xl text-center space-y-4 z-10 relative pointer-events-auto">
          {topics && topics.length > 0 ? (
            <div className="w-full text-left space-y-8 py-2 animate-chalk-fade">
              {topics.slice(0, activeTopicIndex + 1).map((topicText, idx) => {
                const isCurrent = idx === activeTopicIndex;
                const headerLine = topicText.split("\n")[0] || "";
                const cleanHeader = headerLine.replace(/[\#\*\_]/g, "").trim() || `Topic Part ${idx + 1}`;
                
                // Live topic gets activeBoardContent, previous topics get structural content
                // Fallback to topicText (the part's verbatim syllabus contents) during Concept/Example/Doubt phases if not yet written, satisfying user intent that slide contents should show up in Concept phase.
                const currentPhase = (teachingPhase || "").toLowerCase();
                const isIntroPhase = currentPhase === "intro";
                const isConceptOrLaterActive = currentPhase === "concept" || currentPhase === "example" || currentPhase === "doubt" || currentPhase === "transition";
                
                const introFallbackText = `🎓 WELCOME TO PART ${idx + 1}: ${cleanHeader}
==================================================

📌 SESSION LEARNING ROADMAP:
• 🌟 STEP 1: Sassy Overview & Intuitive Teaser (Right Now)
• 🔍 STEP 2: Verbatim Concept Verification & Verification Notes
• 📝 STEP 3: Deep-Dive Math Derivations & Line-by-Line Explaining
• 💬 STEP 4: Real-time Doubt Resolution & Queries

🔮 THE MYSTERY TODAY:
"Hum is topic me chhupe tiny mathematical gaps ko milkar trace aur solve karenge. Start scanning write now! ✍️☘️"`;

                const isCurrentFallback = isCurrent && !activeBoardContent && (isConceptOrLaterActive || isIntroPhase);
                const blockContent = isCurrent 
                  ? (activeBoardContent || (isIntroPhase ? introFallbackText : (isConceptOrLaterActive ? topicText : ""))) 
                  : (topicBoardsContent[idx] || topicText || "");
                
                return (
                  <div
                    key={idx}
                    ref={isCurrent ? activeBlockRef : null}
                    className={`w-full border-b border-[#dae1dd]/10 pb-8 pt-4 transition-all duration-300 relative ${
                      isCurrent
                        ? "bg-[#0b241e]/25 border-l-4 border-l-[#c4f500] pl-4 pr-2 md:pl-6 rounded-r-xl"
                        : "opacity-50 hover:opacity-85 pl-4 pr-1 border-l-4 border-l-transparent"
                    }`}
                  >
                    {/* Header bar */}
                    <div className="flex items-center justify-between mb-4 select-none">
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-mono tracking-widest font-bold ${
                          isCurrent ? "bg-[#c4f500]/25 text-[#c4f500]" : "bg-zinc-800 text-zinc-400"
                        }`}>
                          TOPIC {idx + 1}
                        </span>
                        <h4 className={`text-xs md:text-sm font-sans font-black tracking-wide ${
                          isCurrent ? "text-zinc-100" : "text-zinc-400"
                        }`}>
                          {cleanHeader}
                        </h4>
                      </div>
                      <div>
                        {isCurrent ? (
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/25 text-rose-450 border border-rose-500/30 text-[8.5px] font-mono tracking-wider font-extrabold flex items-center gap-1 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                            <span>LIVE FOCUS ✍️</span>
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20 text-[8.5px] font-mono tracking-wider font-bold">
                            PAST LECTURE NOTE 📚
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Chalk calculations content */}
                    <div className="chalk-font px-2 md:px-4 leading-loose tracking-wide text-zinc-100 select-text w-full text-left">
                      {blockContent ? (
                        <ChalkTypewriter
                          text={blockContent}
                          state={isCurrent ? state : "idle"}
                          cherryVolume={isCurrent ? cherryVolume : 0}
                          latestSpeech={isCurrent ? latestSpeech : ""}
                          isAcademicNotes={!isCurrent || !!(customBoardContent && customBoardContent.trim() !== "")}
                          isFallback={isCurrentFallback}
                        />
                      ) : (
                        <p className="text-zinc-500 font-mono text-[10px] uppercase tracking-widest italic py-3 select-none">
                          {isCurrent ? "Waiting for Cherry Ma'am to start writing notes..." : "No notes written on this topic."}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : activeBoardContent ? (
            <div className="animate-chalk-fade text-left w-full">
              {/* Slate text details and calculations */}
              <div className="chalk-font px-2 md:px-4 leading-loose tracking-wide text-zinc-100 select-text w-full">
                <ChalkTypewriter 
                  text={activeBoardContent} 
                  state={state} 
                  cherryVolume={cherryVolume} 
                  latestSpeech={latestSpeech} 
                  isAcademicNotes={!!(customBoardContent && customBoardContent.trim() !== "")}
                />
              </div>
            </div>
          ) : hasActiveDocument ? (
            <div className="text-zinc-400 py-10 space-y-5 text-center flex flex-col items-center justify-center animate-chalk-fade">
              <BookOpen className="w-14 h-14 mx-auto stroke-[1.2] opacity-40 text-amber-400 animate-pulse-slow" />
              <div className="space-y-1.5 font-mono text-xs tracking-widest leading-relaxed">
                <p className="font-bold uppercase text-amber-400">📚 Syllabus Document Sync Mode</p>
                <p className="text-[10.5px] text-zinc-300 font-sans tracking-wide max-w-md mx-auto normal-case font-medium leading-relaxed px-4">
                  Today's chapters are synced inside Cherry Ma'am's memory! She will write notes on this board topic-by-topic as we discuss each section.
                </p>
                <p className="text-[10px] text-emerald-450 max-w-sm mx-auto flex items-center justify-center gap-1.5 mt-2 bg-emerald-950/20 border border-emerald-900/30 py-1.5 px-3 rounded-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Topic-wise chalkboard flow active</span>
                </p>
              </div>
              {state === "disconnected" && onWakeUp && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onWakeUp();
                  }}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-600 hover:shadow-[0_0_15px_rgba(244,63,94,0.4)] text-white font-bold font-mono text-[10px] tracking-wider uppercase rounded-xl transition-all duration-300 hover:scale-105 cursor-pointer flex items-center gap-2 relative z-10 pointer-events-auto shadow-md"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/80 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-200"></span>
                  </span>
                  <span>WAKE UP CHERRY MA'AM TO START CLASS 🎙️🎓</span>
                </button>
              )}
            </div>
          ) : overrideBlank ? (
            <div className="text-stone-400/50 py-10 space-y-3 text-center animate-pulse">
              <span className="text-2xl">⚡</span>
              <p className="font-mono text-[10px] uppercase tracking-widest font-bold">Cherry is ready. Waiting for "Wake Up" click...</p>
            </div>
          ) : (
            <div className="text-stone-400/70 py-10 space-y-5 text-center flex flex-col items-center justify-center">
              <GraduationCap className="w-14 h-14 mx-auto stroke-[1.2] opacity-35 text-emerald-400/80 animate-pulse" />
              <div className="space-y-1 font-mono text-xs tracking-widest leading-relaxed">
                <p className="font-bold uppercase text-zinc-300">Welcome to Cherry Ma'am's Classroom blackboard</p>
                <p className="text-[10px] text-zinc-500 leading-normal max-w-md mx-auto normal-case italic">
                  Ab terminal class ke interactive blackboard me convert ho chuka h! Chalk writing, drawing/scribbling features, dynamic syllabus sync & charts are fully loaded!
                </p>
              </div>
              
              {state === "disconnected" && onWakeUp ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onWakeUp();
                  }}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-600 hover:shadow-[0_0_15px_rgba(244,63,94,0.4)] text-white font-bold font-mono text-[10px] tracking-wider uppercase rounded-xl transition-all duration-300 hover:scale-105 cursor-pointer flex items-center gap-2 relative z-10 pointer-events-auto shadow-md"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/80 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-200"></span>
                  </span>
                  <span>WAKE UP CHERRY MA'AM TO START CLASS 🎙️🎓</span>
                </button>
              ) : (
                onOpenSyllabus && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSyllabus();
                    }}
                    className="px-4 py-2 border border-dashed border-emerald-500/40 hover:border-emerald-400 bg-emerald-950/20 hover:bg-emerald-900/10 text-emerald-300 hover:text-white rounded-xl text-[10px] font-mono tracking-wider uppercase font-bold transition-all duration-300 scale-95 hover:scale-100 flex items-center gap-2 cursor-pointer relative z-10 pointer-events-auto shadow-sm"
                  >
                    <span>📚 Upload Course Syllabus or Lesson Plan</span>
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-medium">Click Here</span>
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Floating Jump to Active Topic Focus Button */}
        {showJumpBadge && topics && topics.length > 0 && (
          <button
            onClick={handleJumpToActive}
            className="absolute bottom-6 right-6 z-30 bg-[#c4f500] hover:bg-[#b0dc00] text-[#0a3641] px-3.5 py-2 rounded-xl text-xs font-extrabold tracking-wider uppercase shadow-lg flex items-center gap-1.5 hover:scale-105 active:scale-100 transition-all cursor-pointer border border-[#0a3641]/20 group"
            title="Jump back to the active topic focus"
          >
            <ChevronDown className="w-4 h-4 stroke-[2.5]" />
            <span>Jump to Active Focus</span>
          </button>
        )}
        </div>

        {/* Wood frame Chalk Ledge aesthetic bottom bar */}
        <div className="absolute bottom-0 inset-x-0 h-2 bg-[#422204] z-10 border-t border-black/30 flex items-center shadow-lg pointer-events-none select-none">
          <div className="w-12 h-1 bg-amber-100 rounded opacity-60 ml-10 shadow-inner" title="White Chalk stick" />
          <div className="w-8 h-1 bg-yellow-250 rounded opacity-60 ml-4 shadow-inner" title="Yellow Chalk stick" />
          <div className="w-10 h-1 bg-rose-200 rounded opacity-60 ml-3 shadow-inner" title="Pink Chalk stick" />
          <div className="w-14 h-2 bg-[#8c5a2b] rounded-t border-t border-black/40 ml-auto mr-12 shadow" title="Wooden Eraser block" />
        </div>
      </div>

      {/* 🛠️ CONTROL PANEL & INTERACTIVE DESK SLOTS (Pristinely separated from the physical blackboard) */}
      {false && (isDeskExpanded || (teachingPhase || "").toLowerCase() === "doubt" || (teachingPhase || "").toLowerCase() === "example") && (
        <div className="border-t border-zinc-900 bg-zinc-955/40 p-4" id="classroom-active-overlay-desks">
          <div className="max-w-7xl mx-auto">
            
            {/* STATE 2 FLOW DIAGRAM OVERLAY (Doubt-Buster State Machine Map / Phase 4 Evaluation Desk) */}
            {(teachingPhase || "").toLowerCase() === "doubt" && (
              <div className="p-4 border border-dashed border-amber-500/35 bg-zinc-900/40 backdrop-blur rounded-xl space-y-4 max-w-4xl mx-auto text-left pointer-events-auto shadow-[0_0_20px_rgba(245,158,11,0.12)] animate-chalk-fade relative z-10 select-none">
                <div className="flex items-center justify-between font-mono text-[9px] tracking-wider border-b border-zinc-900 pb-2">
                  <span className="text-amber-400 font-bold flex items-center gap-1.5 uppercase animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping shrink-0" />
                    🎓 PHASE 4 ACTIVE: EVALUATION (MULYANKAN & SAWAL-JAWAB)
                  </span>
                  <span className="text-zinc-500 font-semibold uppercase">Interactive Desk</span>
                </div>
                
                <p className="text-[11px] text-zinc-350 leading-relaxed font-sans">
                  Cherry Ma'am has paused the active syllabus queue to conduct a <strong>quick conceptual check / feedback loop</strong>. Assess your understanding or answer her queries instantly using the desk controllers below:
                </p>

                {/* Interactive Confidence Level Grader - "Crystal-Clear Meter" */}
                <div className="bg-zinc-950/80 border border-zinc-800/85 p-3 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-amber-300 font-bold uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-400" /> Rate Your Understanding:
                    </span>
                    <span className="text-[9px] font-mono text-zinc-500">Generates custom doubt/feedback prompt</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { 
                        label: "🌟 100% Clear!", 
                        desc: "Duniya hila denge!", 
                        promptText: "Haan Ma'am, bilkul crystal-clear ho gaya! Koi doubt nahi h, dynamic concept completely clear. Let's move to the next topic of the syllabus! 🚀" 
                      },
                      { 
                        label: "🧐 75% Clear!", 
                        desc: "Need small recap", 
                        promptText: "Ma'am, 75% thoda-thoda samajh aya, but is concept ka real-life application example dubaara ek baar samjhao na please! 🔄" 
                      },
                      { 
                        label: "⚠️ 50% Clear!", 
                        desc: "Formula is confusing", 
                        promptText: "Ma'am, concept me maza toh aya par whiteboard pe jo mathematical formula likha h use dubaara expand karke batao na, thoda doubt h." 
                      },
                    ].map((lvl, index) => (
                      <button
                        key={index}
                        type="button"
                        disabled={!isConnected}
                        onClick={() => onSelectPrompt && onSelectPrompt(lvl.promptText)}
                        className="p-2 border border-zinc-800 hover:border-amber-500/80 bg-zinc-950/50 hover:bg-amber-500/10 text-left rounded-lg transition-all cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="text-[10px] font-bold text-zinc-150 group-hover:text-amber-300 leading-tight">{lvl.label}</div>
                        <div className="text-[8px] text-zinc-500 font-mono tracking-tight mt-0.5 leading-none group-hover:text-zinc-400">{lvl.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dynamic Q&A Responses for Mulyankan Phase */}
                <div className="bg-zinc-950/80 border border-zinc-800/85 p-3 rounded-xl space-y-2.5">
                  <div className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-wider">
                    <HelpCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Quick Response Cards:
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { title: "👍 'Bilkul clear hai' Response", text: "Haan Ma'am, sab samajh aa gaya! Main ready hoon agla topic padhne ke liye." },
                      { title: "🔄 'Repeat please' request", text: "Ma'am, whiteboard par jo abhi cyclic notes ya mathematical definition likhi hai use thoda high-level recap kardo please." },
                      { title: "⚡ Ask for shortcut trick", text: "Ma'am, is topic me standard formula solve karne ki koi simple mathematical shortcut key ya trick hai kya? Bataiye na!" },
                      { title: "🎨 Quick SVG vector inquiry", text: "Ma'am, can you draw a quick geometric SVG layout or graph mapping this circular diagram on the blackboard?" }
                    ].map((res, index) => (
                      <button
                        key={index}
                        type="button"
                        disabled={!isConnected}
                        onClick={() => onSelectPrompt && onSelectPrompt(res.text)}
                        className="px-2.5 py-1.5 border border-zinc-800/80 hover:border-emerald-500 bg-zinc-955/20 hover:bg-emerald-500/10 text-left rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="text-[9.5px] font-semibold text-zinc-350 hover:text-white leading-tight">{res.title}</div>
                        <div className="text-[7.5px] text-zinc-500 truncate mt-1 leading-none">{res.text}</div>
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Dynamic Step visual map */}
                <div className="grid grid-cols-5 gap-2 text-center pt-2 select-none border-t border-zinc-900">
                  {[
                    { label: "1. Intro Story", desc: "Prichey Hook", key: "intro" },
                    { label: "2. Chalk Board", desc: "Notes-making", key: "concept" },
                    { label: "3. Deep Dive", desc: "Explanation", key: "example" },
                    { label: "4. Sawal Jawab", desc: "Doubt-solving", key: "doubt" },
                    { label: "5. Next Step", desc: "Transition", key: "transition" },
                  ].map((step, sIdx) => {
                    const isStepCurrent = (teachingPhase || "intro").toLowerCase() === step.key;
                    const isStepDone = phasesList.indexOf((teachingPhase || "intro").toLowerCase()) > sIdx;
                    return (
                      <div key={sIdx} className={`p-1 px-1.5 rounded-lg border text-[8.2px] flex flex-col items-center justify-between h-[45px] transition-all duration-300 ${
                        isStepCurrent 
                          ? "border-amber-400 bg-amber-500/10 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)] scale-[1.01]" 
                          : isStepDone 
                            ? "border-emerald-500/30 bg-emerald-950/10 text-emerald-400" 
                            : "border-zinc-900 bg-zinc-950/45 text-zinc-650"
                      }`}>
                        <span className="font-bold tracking-wide uppercase leading-tight whitespace-nowrap">{step.label}</span>
                        <span className="text-[7px] opacity-75 mt-0.5 font-mono leading-none">{step.desc}</span>
                      </div>
                    );
                  })}
                </div>
                
                <div className="text-[8px] text-zinc-500 text-center font-mono leading-tight">
                  💡 Hint: When you are content with her answer, say "Samajh gaya Ma'am, next topic!" to proceed to Phase 5: Transition.
                </div>
              </div>
            )}

            {/* STATE 3 FLOW DIAGRAM OVERLAY (Deep Dive / Lab Simulation Map) */}
            {((isDeskExpanded && (teachingPhase || "").toLowerCase() !== "doubt") || (teachingPhase || "").toLowerCase() === "example") && (
              <div className="p-4 border border-dashed border-emerald-500/35 bg-zinc-900/40 backdrop-blur rounded-xl space-y-3 max-w-4xl mx-auto text-left pointer-events-auto shadow-[0_0_15px_rgba(16,185,129,0.08)] animate-chalk-fade relative z-10 select-none">
                <div className="flex items-center justify-between font-mono text-[9px] tracking-wider">
                  <span className="text-emerald-400 font-bold flex items-center gap-1.5 uppercase animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    🔬 ORCHESTRATOR STATE MACHINE: STATE 3 ACTIVE (DEEP-DIVE LAB SIMULATION)
                  </span>
                  <span className="text-zinc-500 font-medium">Virtual Interactive Lab Desk</span>
                </div>
                <p className="text-[10.5px] text-zinc-350 leading-relaxed font-sans">
                  You are in <strong className="text-emerald-400">Class Phase 3: Deep Dive (Vishy-Vastoo ka gyan)</strong>! Cherry Ma'am is actively breaking down terms and math formulas. The orchestrator has enabled an <strong className="text-amber-300">interactive dynamic laboratory sketchpad</strong> representing your active course syllabus below:
                </p>
                
                <div className="grid grid-cols-5 gap-2 text-center pt-2 select-none">
                  {[
                    { label: "1. Intro Story", desc: "Prichey Hook", key: "intro" },
                    { label: "2. Chalk Board", desc: "Notes-making", key: "concept" },
                    { label: "3. Deep Dive", desc: "Explanation", key: "example" },
                    { label: "4. Sawal Jawab", desc: "Doubt-solving", key: "doubt" },
                    { label: "5. Next Step", desc: "Transition", key: "transition" },
                  ].map((step, sIdx) => {
                    const isStepCurrent = (teachingPhase || "intro").toLowerCase() === step.key;
                    const isStepDone = phasesList.indexOf((teachingPhase || "intro").toLowerCase()) > sIdx;
                    return (
                      <div key={sIdx} className={`p-1 px-1.5 rounded-lg border text-[8.2px] flex flex-col items-center justify-between h-[45px] transition-all duration-300 ${
                        isStepCurrent 
                          ? "border-emerald-400 bg-emerald-500/10 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.25)] scale-[1.02]" 
                          : isStepDone 
                            ? "border-amber-500/35 bg-amber-950/10 text-amber-400" 
                            : "border-zinc-900 bg-zinc-955/45 text-zinc-650"
                      }`}>
                        <span className="font-bold tracking-wide uppercase leading-tight whitespace-nowrap">{step.label}</span>
                        <span className="text-[7px] opacity-75 mt-0.5 font-mono leading-none">{step.desc}</span>
                      </div>
                    );
                  })}
                </div>
                
                <div className="text-[8.5px] text-zinc-500 text-center font-mono pt-1 leading-tight">
                  💡 Tip: Drag the slider knobs, shift prices, or change inputs in the vector chalkboard tab below to study formulas live!
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* 🙋‍♂️ STUDENT DESK: VOICE INTERRUPTION & DUAL-CHANNEL DOUBT BAR */}
      <div className="hidden w-full bg-zinc-950 border-t border-zinc-900 px-5 py-4 shrink-0 font-sans z-10" id="student-deskside-interrupter">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Left info column - Dynamic Interaction Panel Toggle */}
          <div className="flex items-center space-x-3 shrink-0">
            <button
              type="button"
              onClick={() => setIsDeskExpanded(!isDeskExpanded)}
              className={`px-3 py-1.5 rounded-lg border text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                isDeskExpanded
                  ? "bg-amber-500/10 border-amber-500 text-amber-300"
                  : "bg-zinc-900 border-zinc-805 text-zinc-400 hover:text-white"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              {isDeskExpanded ? "Close Learn Desk" : "Open Learn Desk"}
            </button>
            <div className="flex flex-col text-left font-mono">
              <span className="text-[10px] font-bold text-zinc-400 capitalize">Phase: {teachingPhase}</span>
              <span className="text-[8px] text-zinc-650">Sawal-jawab & Status</span>
            </div>
          </div>

          {/* Right action area: Dual-channel Doubt bars */}
          <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
            {/* Quick chips container */}
            <div className="flex-1 flex flex-wrap gap-1.5 items-center justify-start">
              {[
                { text: "Ma'am, ye concept dubaara samjhao na? 🔄", label: "Explain Again" },
                { text: "Can you draw a quick diagram/SVG to show this? 🎨", label: "Draw Diagram" },
                { text: "Isko solve karne ki mathematical shortcut trick batao ⚡", label: "Math Trick" },
                { text: "Is term ka daily life practical application kya hai? 🌍", label: "Real Use" },
              ].map((chip) => (
                <button
                  key={chip.label}
                  disabled={!isConnected}
                  onClick={() => onSelectPrompt && onSelectPrompt(chip.text)}
                  className={`px-2.5 py-1 text-[10px] font-semibold border rounded-lg transition-all text-left truncate max-w-[170px] ${
                    isConnected
                      ? "border-zinc-800 bg-zinc-900/60 text-zinc-350 hover:text-white hover:border-amber-500 hover:bg-amber-500/10 cursor-pointer"
                      : "border-zinc-900 bg-zinc-950/20 text-zinc-650 cursor-not-allowed"
                  }`}
                  title={chip.text}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Custom Input Form section */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                if (!customDoubtText.trim() || !isConnected) return;
                if (onSelectPrompt) {
                  onSelectPrompt(customDoubtText.trim());
                  setCustomDoubtText("");
                }
              }}
              className="flex items-center bg-zinc-900/60 border border-zinc-800 focus-within:border-amber-500/80 rounded-xl px-2.5 py-1.5 gap-2 min-w-[240px]"
            >
              <input
                type="text"
                value={customDoubtText}
                onChange={(e) => setCustomDoubtText(e.target.value)}
                disabled={!isConnected}
                placeholder={isConnected ? "Ask custom doubt..." : "Connect lecture to ask..."}
                className="bg-transparent text-[11px] text-zinc-100 placeholder-zinc-500 focus:outline-none flex-1 font-sans disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!customDoubtText.trim() || !isConnected}
                className={`p-1.5 rounded-lg transition-all ${
                  customDoubtText.trim() && isConnected
                    ? "bg-amber-500 text-black hover:scale-105 hover:shadow-[0_0_10px_rgba(245,158,11,0.3)] cursor-pointer"
                    : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                }`}
                title="Send custom doubt"
              >
                <Send className="w-3 h-3" />
              </button>
            </form>
          </div>

        </div>
      </div>

    </div>
  );
};
