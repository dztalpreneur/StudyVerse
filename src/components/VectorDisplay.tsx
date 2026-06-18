import React, { useState, useRef, useEffect } from "react";
import { Maximize2, X, Download, RefreshCw, ZoomIn, ZoomOut, Sliders, Sparkles, Box } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface VectorDisplayProps {
  rawSvg: string;
  index: number;
  isComplete?: boolean;
}

export const VectorDisplay: React.FC<VectorDisplayProps> = ({ rawSvg, index, isComplete = true }) => {
  const [renderMode, setRenderMode] = useState<"rough" | "laser">("rough");
  const [glowIntensity, setGlowIntensity] = useState<number>(1); // 1px default as requested
  const [chalkTurbulence, setChalkTurbulence] = useState<number>(0.5); // 0.5 default as requested
  const [isZoomModalOpen, setIsZoomModalOpen] = useState(false);
  const [animationKey, setAnimationKey] = useState(0); // Trigger draw animate
  const [localZoom, setLocalZoom] = useState(1);
  const [shouldAnimate, setShouldAnimate] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);
  const modalCanvasRef = useRef<HTMLDivElement>(null);

  // Student Annotation Canvas scribble layers
  const [isScribbleActive, setIsScribbleActive] = useState(false);
  const [scribbleColor, setScribbleColor] = useState("#c4f500"); // Yellow neon chalk default
  const scribbleCanvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(400);
  const [canvasHeight, setCanvasHeight] = useState(250);
  const [isDrawing, setIsDrawing] = useState(false);

  // ResizeObserver to physically size the canvas elements matching the parent container
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasWidth(width);
        setCanvasHeight(height);
        
        const canvas = scribbleCanvasRef.current;
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [canvasRef, isScribbleActive]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = scribbleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {}

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = scribbleColor;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    
    // Glowing handdrawn chalk properties
    ctx.shadowBlur = 4;
    ctx.shadowColor = scribbleColor;

    setIsDrawing(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = scribbleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = scribbleCanvasRef.current;
    if (!canvas) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
    setIsDrawing(false);
  };

  const clearScribbles = () => {
    const canvas = scribbleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // Force 100% stable static SVG illustration drawing instantly (no tracing animation or truncation risk)
  useEffect(() => {
    setShouldAnimate(false);
    const makeStatic = (container: HTMLDivElement | null) => {
      if (!container) return;
      const svg = container.querySelector("svg");
      if (!svg) return;
      const shapes = svg.querySelectorAll<SVGGeometryElement>(
        "path, line, circle, rect, ellipse, polyline, polygon, g, text, tspan"
      );
      shapes.forEach((shape) => {
        shape.style.strokeDasharray = "";
        shape.style.strokeDashoffset = "";
        shape.style.transition = "";
        shape.style.opacity = "1";
        shape.style.animation = "";
      });
      svg.style.opacity = "1";
    };

    // Make static immediately on mount & setup
    makeStatic(canvasRef.current);
    if (isZoomModalOpen) {
      makeStatic(modalCanvasRef.current);
    }

    const timer = setTimeout(() => {
      makeStatic(canvasRef.current);
      if (isZoomModalOpen) {
        makeStatic(modalCanvasRef.current);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [rawSvg, animationKey, isZoomModalOpen, isComplete]);

  // Helper to convert raw LaTeX chunks of mathematical and greek characters to fully formatted unicode strings
  const cleanLatexInSvg = (text: string): string => {
    if (!text) return text;
    let clean = text;
    
    // Replace LaTeX inline/math delimiters
    clean = clean.replace(/\$/g, "");
    
    // Convert subscripts like _{initial} to _initial
    clean = clean.replace(/_{(.*?)}/g, "_$1");
    // Convert superscripts like ^{2} to ² or simple super expressions
    clean = clean.replace(/\^{(.*?)}/g, "^$1");
    
    // Pre-convert standard squared/cubed symbols for high fidelity representation
    clean = clean.replace(/\^2\b/g, "²");
    clean = clean.replace(/\^3\b/g, "³");
    
    // Clean up typical LaTeX commands using standard unicode equivalents
    const latexMap: Record<string, string> = {
      "\\\\theta": "θ", "\\theta": "θ",
      "\\\\Delta": "Δ", "\\Delta": "Δ",
      "\\\\omega": "ω", "\\omega": "ω",
      "\\\\alpha": "α", "\\alpha": "α",
      "\\\\beta": "β", "\\beta": "β",
      "\\\\gamma": "γ", "\\gamma": "γ",
      "\\\\delta": "δ", "\\delta": "δ",
      "\\\\pi": "π", "\\pi": "π",
      "\\\\sigma": "σ", "\\sigma": "σ",
      "\\\\mu": "μ", "\\mu": "μ",
      "\\\\phi": "φ", "\\phi": "φ",
      "\\\\psi": "ψ", "\\psi": "ψ",
      "\\\\lambda": "λ", "\\lambda": "λ",
      "\\\\eta": "η", "\\eta": "η",
      "\\\\tau": "τ", "\\tau": "τ",
      "\\\\chi": "χ", "\\chi": "χ",
      "\\\\rho": "ρ", "\\rho": "ρ",
      "\\\\epsilon": "ε", "\\epsilon": "ε",
      "\\\\zeta": "ζ", "\\zeta": "ζ",
      "\\\\infty": "∞", "\\infty": "∞",
      "\\\\partial": "∂", "\\partial": "∂",
      "\\\\nabla": "∇", "\\nabla": "∇",
      "\\\\times": "×", "\\times": "×",
      "\\\\div": "÷", "\\div": "÷",
      "\\\\pm": "±", "\\pm": "±",
      "\\\\mp": "∓", "\\mp": "∓",
      "\\\\le": "≤", "\\le": "≤",
      "\\\\ge": "≥", "\\ge": "≥",
      "\\\\neq": "≠", "\\neq": "≠",
      "\\\\approx": "≈", "\\approx": "≈",
      "\\\\propto": "∝", "\\propto": "∝",
      "\\\\rightarrow": "→", "\\rightarrow": "→",
      "\\\\leftarrow": "←", "\\leftarrow": "←",
      "\\\\cdot": "·", "\\cdot": "·",
      "\\\\text": "", "\\text": "",
      "\\\\mathrm": "", "\\mathrm": "",
      "\\\\mathbf": "", "\\mathbf": "",
      "\\\\mathit": "", "\\mathit": "",
      "\\\\vec": "vec ", "\\vec": "vec ",
      "\\\\bar": "bar ", "\\bar": "bar ",
      "\\\\hat": "hat ", "\\hat": "hat "
    };

    const sortedKeys = Object.keys(latexMap).sort((a, b) => b.length - a.length);
    for (const k of sortedKeys) {
      const escaped = k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const rx = new RegExp(escaped, "g");
      clean = clean.replace(rx, latexMap[k]);
    }
    
    // Explicit general cleanup of any trailing backslashes and redundant syntax braces
    clean = clean.replace(/\\/g, "").replace(/[{}]/g, "");
    
    return clean;
  };

  // Process SVG to inject glowing neon properties on lines and paths dynamically if not already styled
  const processSvgString = (rawXml: string) => {
    let processed = rawXml;

    // 1. Convert any embedded LaTeX tags inside SVG text and tspan tag bodies into high fidelity readable Unicode text
    processed = processed.replace(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gi, (match, attrs, content) => {
      return `<tspan${attrs}>${cleanLatexInSvg(content)}</tspan>`;
    });

    processed = processed.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi, (match, attrs, content) => {
      return `<text${attrs}>${cleanLatexInSvg(content)}</text>`;
    });

    // 2. Process text and tspan tags first to convert dark colors to currentColor and default empty fills to currentColor
    processed = processed.replace(/<(text|tspan)\b([^>]*)/gi, (match, tag, attrs) => {
      let refinedAttrs = attrs;
      if (attrs.includes("fill=")) {
        refinedAttrs = refinedAttrs.replace(/fill=(['"])(black|#000000|#000|#111|#111111|#1a1a1a|#222|#222222)\1/gi, 'fill="currentColor"');
      } else if (!attrs.toLowerCase().includes("style=") || !attrs.toLowerCase().includes("fill")) {
        // If there's no fill attribute or style containing fill, append fill="currentColor"
        refinedAttrs += ' fill="currentColor"';
      }
      
      // Clean up any inline text styles with dark colors
      refinedAttrs = refinedAttrs.replace(/fill\s*:\s*(black|#000000|#000|#111|#111111|#1a1a1a|#222|#222222)/gi, "fill: currentColor");
      refinedAttrs = refinedAttrs.replace(/stroke\s*:\s*(black|#000000|#000|#111|#111111|#1a1a1a|#222|#222222)/gi, "stroke: currentColor");
      
      return `<${tag}${refinedAttrs}`;
    });

    // 2. Standardize dark colors inside embed style blocks
    processed = processed.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, cssContent) => {
      let refinedCss = cssContent
        .replace(/(stroke|fill)\s*:\s*(black|#000000|#000|#111|#111111|#1a1a1a|#222|#222222)/gi, "$1: currentColor")
        .replace(/#000000|#000|#111111|#111/gi, "currentColor");
      return `<style${attrs}>${refinedCss}</style>`;
    });

    // 3. Standardize dark colors / black lines on general shape tags so they are perfectly visible as chalk white / neon lines on dark board
    processed = processed
      .replace(/stroke=(['"])(black|#000000|#000|#111|#111111|#1a1a1a|#222|#222222)\1/gi, 'stroke="currentColor"')
      .replace(/fill=(['"])(black|#000000|#000|#111|#111111|#1a1a1a|#222|#222222)\1/gi, 'fill="none"')
      // Support standard styled strokes/fills inside elements or general tags
      .replace(/stroke\s*:\s*(black|#000000|#000|#111|#111111|#1a1a1a|#222|#222222)/gi, 'stroke: currentColor')
      .replace(/fill\s*:\s*(black|#000000|#000|#111|#111111|#1a1a1a|#222|#222222)/gi, 'fill: none')
      // If there are standard strokes from PDF/sheet templates without specific width, make them thicker for blackboard chalk effect
      .replace(/stroke-width=(['"])1(\.0)?px?\1/gi, 'stroke-width="2"')
      .replace(/stroke-width=(['"])0\.5px?\1/gi, 'stroke-width="1.5"');

    // 4. Ensure every path, line, polyline, polygon, circle, rect has beautiful round caps and linejoins for handdrawn feel
    const tagsToRefine = ["path", "line", "polyline", "polygon", "circle", "rect"];
    tagsToRefine.forEach(tag => {
      // Capture structural attributes and optional self-closing slash separately to preserve valid XML/SVG syntax
      const tagRegex = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, "gi");
      processed = processed.replace(tagRegex, (match, attrs, selfClosing) => {
        let refinedAttrs = attrs;
        if (!attrs.includes("stroke-linecap")) {
          refinedAttrs += ' stroke-linecap="round"';
        }
        if (!attrs.includes("stroke-linejoin")) {
          refinedAttrs += ' stroke-linejoin="round"';
        }
        return `<${tag}${refinedAttrs}${selfClosing}>`;
      });
    });

    // 5. Ensure svg has standard viewbox (case-insensitive checks)
    if (!processed.includes("viewBox") && !processed.includes("viewbox")) {
      processed = processed.replace(/<svg/i, "<svg viewBox='0 0 400 250'");
    }

    // 6. Inject standard responsive width and height metrics on root SVG tag and strip rigid pixel/decimal/percentage widths/heights
    const svgTagMatch = processed.match(/<svg([^>]*)/i);
    if (svgTagMatch) {
      let attrs = svgTagMatch[1];
      // Strip any existing width or height attribute value cleanly (supporting integers, decimals, spaces, or percentages)
      attrs = attrs.replace(/\b(width|height)\s*=\s*(['"])[^'"]*\2/gi, "");
      processed = processed.replace(svgTagMatch[1], `${attrs} width="100%" height="auto" style="display: block; max-height: 480px; margin: 0 auto;"`);
    }

    // 7. Inject custom glow styles based on the glowIntensity state safely
    const glowColorFilter = `drop-shadow(0 0 ${glowIntensity}px rgba(52, 211, 153, 0.6))`;
    const injectStyles = `filter: ${glowColorFilter}; transition: filter 0.3s ease;`;

    const finalSvgMatch = processed.match(/<svg([^>]*)/i);
    if (finalSvgMatch) {
      const fullOpeningAttributes = finalSvgMatch[1];
      const styleMatch = fullOpeningAttributes.match(/style=(['"])(.*?)\1/i);
      if (styleMatch) {
        const quote = styleMatch[1];
        const existingStyleValues = styleMatch[2];
        const updatedStyleAttribute = `style=${quote}${injectStyles} ${existingStyleValues}${quote}`;
        const oldStyleString = styleMatch[0];
        const updatedAttributes = fullOpeningAttributes.replace(oldStyleString, updatedStyleAttribute);
        processed = processed.replace(fullOpeningAttributes, updatedAttributes);
      } else {
        processed = processed.replace(/<svg/i, `<svg style="${injectStyles}"`);
      }
    }

    return processed;
  };

  const processedSvgString = processSvgString(rawSvg);

  const handleDownload = () => {
    try {
      const blob = new Blob([processedSvgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cherry-chalkboard-diagram-${index}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed downloading SVG vector asset:", e);
    }
  };

  const triggerAnimationReset = () => {
    setAnimationKey((prev) => prev + 1);
  };

  return (
    <div 
      key={animationKey}
      className="my-5 p-4 bg-[#051512] border-2 border-emerald-900/35 rounded-2xl flex flex-col items-center justify-center shadow-xl relative overflow-hidden group max-w-full select-none"
      id={`interactive-drawing-${index}`}
      data-html2canvas-ignore="true"
    >
      {/* Dynamic Chalk-stroke Hybrid rendering details banner style */}
      <style>{`
        .hybrid-glow-pulse {
          animation: hybridGlowPulse 2.5s infinite alternate ease-in-out;
        }
        @keyframes hybridGlowPulse {
          from { filter: drop-shadow(0 0 1px rgba(52, 211, 153, 0.4)); }
          to { filter: drop-shadow(0 0 4px rgba(52, 211, 153, 0.75)); }
        }
      `}</style>

      {/* Grid coordinate background overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.035)_1.2px,transparent_1.2px)] bg-[size:15px_15px] pointer-events-none" />

      {/* Unique chalk texture roughness selector declaration */}
      <svg className="absolute w-0 h-0" xmlns="http://www.w3.org/2000/svg" data-html2canvas-ignore="true">
        <defs>
          <filter id={`chalk-rough-filter-${index}`} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="4" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={chalkTurbulence} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {/* Diagram Title Board Header */}
      <div className="w-full flex flex-wrap items-center justify-between px-2 pb-1 mb-2.5 gap-2 relative z-20">
        <div className="flex items-center space-x-2">
          <Box className="w-4 h-4 text-emerald-400 animate-spin duration-3000" />
          <span className="text-[10px] font-mono font-bold text-emerald-300 select-none tracking-widest uppercase">
            ⚡ Advanced Chalk Vector Diagram
          </span>
        </div>
        
        {/* Rapid Utility Quick Actions */}
        <div className="flex items-start justify-end gap-1.5 shrink-0">
          <button
            onClick={() => {
              setIsScribbleActive(!isScribbleActive);
              if (isScribbleActive) {
                clearScribbles();
              }
            }}
            className={`px-2 py-0.5 rounded text-[9px] font-mono font-extrabold uppercase border cursor-pointer transition-all duration-200 ${
              isScribbleActive
                ? "bg-rose-950/50 border-rose-500/40 text-rose-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
            }`}
            title="Toggle interactive student chalk overlay to scribble or highlight on diagram"
          >
            {isScribbleActive ? "🖍️ Scribbling: ON" : "🖍️ Student Scribble"}
          </button>

          <button
            onClick={() => setRenderMode(renderMode === "rough" ? "laser" : "rough")}
            className={`px-2 py-0.5 rounded text-[9px] font-mono font-extrabold uppercase border cursor-pointer transition-all duration-200 ${
              renderMode === "rough"
                ? "bg-amber-950/40 border-amber-500/30 text-amber-300"
                : "bg-emerald-950/60 border-emerald-400/40 text-emerald-300"
            }`}
            title="Toggle between Hand-drawn Chalk Roughness vs Clean High-Fidelity Laser"
          >
            {renderMode === "rough" ? "🎨 Texture: Rough" : "⚡ Style: HD Laser"}
          </button>
          
          <button
            onClick={triggerAnimationReset}
            className="p-1 rounded bg-zinc-900 border border-zinc-850 hover:border-emerald-500/30 text-zinc-400 hover:text-emerald-300 transition-all cursor-pointer"
            title="Redraw diagram stroke animations"
          >
            <RefreshCw className="w-3 h-3" />
          </button>

          <button
            onClick={handleDownload}
            className="p-1 rounded bg-zinc-900 border border-zinc-850 hover:border-emerald-500/30 text-zinc-400 hover:text-emerald-300 transition-all cursor-pointer"
            title="Export precise SVG to device"
          >
            <Download className="w-3 h-3" />
          </button>

          <button
            onClick={() => setIsZoomModalOpen(true)}
            className="p-1 rounded bg-zinc-900 border border-zinc-850 hover:border-emerald-500/30 text-zinc-400 hover:text-emerald-300 transition-all cursor-pointer"
            title="Open in Zoomable Full-Sized Workspace"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* RENDER CANVAS CONTAINER WITH CHALK BRUSH FILTER AND VECTOR ANIMATION */}
      <div 
        ref={canvasRef}
        className="w-full flex items-center justify-center p-4 bg-black/35 border border-emerald-950/30 rounded-xl relative z-10 transition-transform duration-300 min-h-[160px] overflow-hidden"
      >
        {/* Real-time Streaming State Watermark Badge */}
        {!isComplete && (
          <div className="absolute top-2 left-2 z-30 flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/85 border border-emerald-500/35 text-[8px] font-mono text-emerald-300 animate-pulse uppercase select-none tracking-widest font-extrabold shadow-md pointer-events-none">
            <RefreshCw className="w-2.5 h-2.5 text-emerald-400 animate-spin" />
            <span>Cherry is Drawing Live...</span>
          </div>
        )}

        {/* Floating Student Scribble Palette and Erase menu */}
        {isScribbleActive && (
          <div className="absolute top-2 right-2 z-30 flex items-center gap-1.5 p-1 px-1.5 bg-black/85 border border-zinc-850 rounded-lg shadow-2xl select-none" onClick={e => e.stopPropagation()}>
            <span className="text-[7.5px] font-mono text-zinc-400 uppercase tracking-wider font-semibold">Chalk:</span>
            {[
              { color: "#ffffff", title: "White" },
              { color: "#c4f500", title: "Yellow Neon" },
              { color: "#ff6b8b", title: "Hot Pink" },
              { color: "#10b981", title: "Neon Emerald" }
            ].map(item => (
              <button
                key={item.color}
                onClick={() => setScribbleColor(item.color)}
                className={`w-3.5 h-3.5 rounded-full border transition-transform cursor-pointer hover:scale-115 ${
                  scribbleColor === item.color ? "border-white scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: item.color, boxShadow: `0 0 6px ${item.color}` }}
                title={item.title}
              />
            ))}
            <div className="w-px h-3.5 bg-zinc-800 mx-0.5" />
            <button
              onClick={clearScribbles}
              className="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 hover:border-rose-500/40 text-rose-400 hover:text-rose-300 text-[8px] font-mono font-black uppercase rounded cursor-pointer transition-colors"
              title="Clear all student scribbles"
            >
              🧹 Clear
            </button>
          </div>
        )}

        {/* Always render the dynamic SVG node so streaming elements draw step-by-step */}
        <div 
          className="w-full flex items-center justify-center max-w-full md:max-w-2xl mx-auto relative hybrid-glow-pulse text-emerald-300 z-10"
          style={renderMode === "rough" ? { filter: `url(#chalk-rough-filter-${index})` } : {}}
          dangerouslySetInnerHTML={{ __html: processedSvgString }}
        />

        {/* Transparent Interactive Drawing Stage */}
        <canvas
          ref={scribbleCanvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={`absolute inset-0 z-20 cursor-crosshair rounded-xl ${
            isScribbleActive ? "pointer-events-auto block" : "pointer-events-none hidden"
          }`}
          style={{ width: "100%", height: "100%", touchAction: "none" }}
        />
      </div>

      {/* FULL-SCREEN IMMERSIVE VECTOR STUDY MODAL */}
      <AnimatePresence>
        {isZoomModalOpen && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-[#051310] border-2 border-emerald-800/40 w-full max-w-3xl h-[85vh] rounded-3xl flex flex-col overflow-hidden relative shadow-2xl">
              
              {/* Grid backdrop */}
              <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.025)_2px,transparent_2px)] bg-[size:18px_18px] pointer-events-none" />

              {/* Modal slate header */}
              <div className="p-5 border-b border-emerald-950/60 bg-black/20 flex items-center justify-between z-10">
                <div className="space-y-1">
                  <h3 className="text-xs font-bold font-mono text-emerald-400 tracking-wider uppercase flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                    Interactive Full-Screen Drawing Board
                  </h3>
                  <p className="text-[10px] text-zinc-500 font-medium">
                    Analyze handwritten vectors, physics cycles, and diagram equations in absolute detail
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setLocalZoom(prev => Math.max(0.5, prev - 0.25))}
                    className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] font-mono font-bold text-zinc-400 select-none w-8 text-center bg-zinc-950 py-0.5 rounded">
                    {Math.round(localZoom * 100)}%
                  </span>
                  <button
                    onClick={() => setLocalZoom(prev => Math.min(3, prev + 0.25))}
                    className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  
                  <div className="w-0.5 h-6 bg-zinc-900" />

                  <button
                    onClick={() => setIsZoomModalOpen(false)}
                    className="p-1.5 rounded-lg bg-zinc-900 hover:bg-rose-950/30 border border-zinc-800 hover:border-rose-900/40 text-zinc-400 hover:text-rose-400 transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Large responsive drawing viewer */}
              <div ref={modalCanvasRef} className="flex-1 overflow-auto flex items-center justify-center p-6 relative">
                {!isComplete && (
                  <div className="absolute top-3 left-4 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/75 border border-emerald-500/35 text-[8px] font-mono text-emerald-300 animate-pulse uppercase tracking-widest font-extrabold shadow-md">
                    <RefreshCw className="w-2.5 h-2.5 text-emerald-400 animate-spin" />
                    <span>Drawing SVG live...</span>
                  </div>
                )}
                
                <div 
                  className="transition-transform duration-200 origin-center hybrid-glow-pulse text-emerald-300"
                  style={{ 
                    transform: `scale(${localZoom})`,
                    filter: renderMode === "rough" ? `url(#chalk-rough-filter-${index})` : ""
                  }}
                  dangerouslySetInnerHTML={{ __html: processedSvgString }}
                />
              </div>

              {/* Modal footer hints */}
              <div className="p-4 bg-black/40 border-t border-emerald-950/40 font-mono text-[9px] text-zinc-500 text-center flex items-center justify-between px-6 z-10">
                <span>Diagram No: #{index}</span>
                <span className="text-amber-450 uppercase tracking-widest font-bold">Press ESC or click close to return to class</span>
              </div>

            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
