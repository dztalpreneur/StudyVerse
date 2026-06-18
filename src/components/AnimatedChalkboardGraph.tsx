import React, { useState, useEffect, useMemo, useRef } from "react";
import katex from "katex";
import { motion } from "motion/react";

export const AnimatedChalkboardGraph: React.FC = () => {
  const [progress, setProgress] = useState(0); // 0 to 1
  const animatingRef = useRef(true);

  // Animate the scanner point back and forth or continuously along the curve
  useEffect(() => {
    let lastTime = performance.now();
    let direction = 1;
    let currentProgress = 0;

    const animate = (time: number) => {
      if (!animatingRef.current) return;
      
      const delta = (time - lastTime) / 1000; // in seconds
      lastTime = time;

      // Complete one sweep in 4 seconds
      currentProgress += direction * (delta / 4);

      if (currentProgress >= 1) {
        currentProgress = 1;
        direction = -1; // reverse directions
      } else if (currentProgress <= 0) {
        currentProgress = 0;
        direction = 1;
      }

      setProgress(currentProgress);
      requestAnimationFrame(animate);
    };

    const handle = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(handle);
    };
  }, []);

  // Generate mathematical curve points
  // f(x) = sin(x) * e^(-0.35 * x)
  const plotData = useMemo(() => {
    const points: { x: number; y: number; svgX: number; svgY: number }[] = [];
    const steps = 100;
    // We plot from x = 0 to 3.5 (slightly past pi ≈ 3.14159)
    const xMax = 3.5;
    
    for (let i = 0; i <= steps; i++) {
      const xVal = (i / steps) * xMax;
      const yVal = Math.sin(xVal) * Math.exp(-0.35 * xVal);
      
      // Map to SVG coordinates (Width: 480, Height: 180)
      // Origin at (40, 150)
      const svgX = 40 + (xVal / xMax) * 400;
      const svgY = 150 - yVal * 190; // scale y-value up to fit nicely
      
      points.push({ x: xVal, y: yVal, svgX, svgY });
    }
    return points;
  }, []);

  // Curve path string for drawing
  const pathD = useMemo(() => {
    if (plotData.length === 0) return "";
    return `M ${plotData.map(p => `${p.svgX.toFixed(1)},${p.svgY.toFixed(1)}`).join(" L ")}`;
  }, [plotData]);

  // Area under curve path string (shaded integral from 0 to pi)
  const integralAreaD = useMemo(() => {
    if (plotData.length === 0) return "";
    
    // Filter points between x = 0 and x = pi (≈ 3.14159)
    const integralPoints = plotData.filter(p => p.x <= Math.PI);
    if (integralPoints.length === 0) return "";

    const firstPt = integralPoints[0];
    const lastPt = integralPoints[integralPoints.length - 1];

    const startX = firstPt.svgX.toFixed(1);
    const startY = "150.0"; // baseline Y
    const endX = lastPt.svgX.toFixed(1);
    const endY = "150.0"; // baseline Y

    const curvePointsStr = integralPoints
      .map(p => `L ${p.svgX.toFixed(1)},${p.svgY.toFixed(1)}`)
      .join(" ");

    return `M ${startX},${startY} ${curvePointsStr} L ${endX},${endY} Z`;
  }, [plotData]);

  // Current active animated state parameters
  const currentMetrics = useMemo(() => {
    const xMax = 3.5;
    const currentX = progress * Math.PI; // animate from 0 to pi
    const currentY = Math.sin(currentX) * Math.exp(-0.35 * currentX);
    
    // Map to SVG coordinates
    const svgX = 40 + (currentX / xMax) * 400;
    const svgY = 150 - currentY * 190;

    // Approximate the integral value from 0 to currentX (simulated integration)
    // Integral of e^(-ax) sin(x) dx is e^(-ax) * (-a sin x - cos x) / (1 + a^2)
    // We can calculate the definite integral value exactly
    const a = 0.35;
    const evaluateAntiderivative = (val: number) => {
      const num = Math.exp(-a * val) * (-a * Math.sin(val) - Math.cos(val));
      const den = 1 + a * a;
      return num / den;
    };
    const integralVal = evaluateAntiderivative(currentX) - evaluateAntiderivative(0);

    return {
      x: currentX,
      y: currentY,
      svgX,
      svgY,
      integral: integralVal,
    };
  }, [progress]);

  // Compile math equation with KaTeX
  const equationsHtml = useMemo(() => {
    try {
      const eqMain = katex.renderToString(
        "f(x) = \\sin(x) \\cdot e^{-0.35x}",
        { displayMode: false, throwOnError: false }
      );
      const eqIntegral = katex.renderToString(
        "A(x) = \\int_{0}^{x} \\sin(t) e^{-0.35t} \\, dt",
        { displayMode: false, throwOnError: false }
      );
      const eqLimits = katex.renderToString(
        "x \\in [0, \\pi]",
        { displayMode: false, throwOnError: false }
      );
      return { eqMain, eqIntegral, eqLimits };
    } catch (err) {
      return {
        eqMain: "f(x) = \\sin(x) \\cdot e^{-0.35x}",
        eqIntegral: "A(x) = \\int_{0}^{x} \\sin(t) e^{-0.35t} \\, dt",
        eqLimits: "x \\in [0, \\pi]",
      };
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Equations displays using true KaTeX */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[#111f1d] border border-teal-500/10 rounded-2xl p-4">
        <div className="space-y-1">
          <div className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-wider">
            Current Function / फ़ंक्शन समीकरण
          </div>
          <div 
            className="text-white text-sm md:text-base font-medium select-all"
            dangerouslySetInnerHTML={{ __html: equationsHtml.eqMain }}
          />
        </div>

        <div className="h-px w-full sm:h-8 sm:w-px bg-white/10" />

        <div className="space-y-1">
          <div className="text-[10px] font-mono text-[#c4f500] font-bold uppercase tracking-wider">
            Definite Integral Area / निश्चित समाकलन क्षेत्रफल
          </div>
          <div 
            className="text-white text-xs md:text-sm font-medium select-all"
            dangerouslySetInnerHTML={{ __html: equationsHtml.eqIntegral }}
          />
        </div>
      </div>

      {/* Grid Canvas Board Container */}
      <div className="border border-white/10 rounded-2xl bg-[#122320]/95 p-4 relative overflow-hidden">
        {/* Animated Grid lines back layer */}
        <div className="absolute inset-0 bg-grid-white opacity-[0.02] pointer-events-none" />

        {/* Dynamic Holographic HUD Overlay */}
        <div className="flex items-center justify-between text-[10px] font-mono font-bold text-teal-400/80 mb-3 border-b border-white/5 pb-2">
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 bg-[#c4f500] rounded-full animate-pulse" />
            <span>REAL-TIME ANALYSIS PLOT</span>
          </div>
          <div className="flex items-center space-x-4">
            <span dangerouslySetInnerHTML={{ __html: equationsHtml.eqLimits }} />
            <span>y_max ≈ 0.57</span>
          </div>
        </div>

        {/* The Math SVG Blackboard */}
        <svg 
          viewBox="0 0 480 180" 
          className="w-full h-auto text-[#c4f500] z-10 relative select-none overflow-visible"
        >
          {/* Sytem Grids lines */}
          <line x1="40" y1="30" x2="480" y2="30" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 2" />
          <line x1="40" y1="70" x2="480" y2="70" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 2" />
          <line x1="40" y1="110" x2="480" y2="110" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 2" />
          
          <line x1="154.2" y1="10" x2="154.2" y2="150" stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="2 2" />
          <line x1="268.5" y1="10" x2="268.5" y2="150" stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="2 2" />
          <line x1="399.1" y1="10" x2="399.1" y2="150" stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="2 2" />

          {/* Coordinate Axes */}
          {/* Horizontal X Axis */}
          <line x1="30" y1="150" x2="470" y2="150" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="1.5" />
          {/* Vertical Y Axis */}
          <line x1="40" y1="10" x2="40" y2="160" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="1.5" />

          {/* X-axis Ticks and Labels */}
          <line x1="40" y1="150" x2="40" y2="154" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
          <text x="40" y="166" className="fill-slate-400 font-mono text-[9px] font-bold" textAnchor="middle">0</text>

          <line x1="199.2" y1="150" x2="199.2" y2="154" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
          <text x="199.2" y="166" className="fill-slate-400 font-mono text-[9px] font-bold" textAnchor="middle">π/2</text>

          {/* x = pi marker axis line */}
          <line x1="399.1" y1="150" x2="399.1" y2="154" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
          <text x="399.1" y="166" className="fill-slate-400 font-mono text-[9px] font-bold" textAnchor="middle">π</text>

          {/* Shaded Area showing definite integral */}
          {integralAreaD && (
            <path 
              d={integralAreaD}
              fill="rgba(196, 245, 0, 0.08)"
              stroke="rgba(196, 245, 0, 0.2)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          )}

          {/* Actual mathematical curve line */}
          {pathD && (
            <path 
              d={pathD}
              fill="none" 
              stroke="#c4f500" 
              strokeWidth="2.5" 
              strokeLinecap="round"
              className="drop-shadow-[0_0_4px_rgba(196,245,0,0.4)]"
            />
          )}

          {/* Active Integration Shaded Sweep Line */}
          <line 
            x1={currentMetrics.svgX} 
            y1="150" 
            x2={currentMetrics.svgX} 
            y2={currentMetrics.svgY} 
            stroke="rgba(255, 112, 67, 0.5)" 
            strokeWidth="1.5"
            strokeDasharray="1 1"
          />

          {/* Animated tracking pulse point */}
          <circle 
            cx={currentMetrics.svgX} 
            cy={currentMetrics.svgY} 
            r="8" 
            fill="rgba(255, 112, 67, 0.25)" 
            className="animate-ping" 
          />
          <circle 
            cx={currentMetrics.svgX} 
            cy={currentMetrics.svgY} 
            r="4" 
            fill="#ff7043" 
            stroke="#ffffff"
            strokeWidth="1"
            className="drop-shadow-[0_0_6px_rgba(255,112,67,0.8)]"
          />
        </svg>

        {/* Dynamic coordinate value panel */}
        <div className="grid grid-cols-3 gap-2 mt-2 bg-[#101b1a] p-3 rounded-xl border border-white/5 font-mono text-[10px] font-bold text-left">
          <div className="space-y-0.5">
            <span className="text-slate-400 uppercase tracking-widest block text-[8px]">Coordinates (X)</span>
            <span className="text-[#c4f500]">x = {currentMetrics.x.toFixed(4)} rad</span>
          </div>
          <div className="space-y-0.5">
            <span className="text-slate-400 uppercase tracking-widest block text-[8px]">Function (Y)</span>
            <span className="text-cyan-400">f(x) = {currentMetrics.y.toFixed(4)}</span>
          </div>
          <div className="space-y-0.5">
            <span className="text-slate-400 uppercase tracking-widest block text-[8px]">Definite Area (A)</span>
            <span className="text-orange-400">Area = {currentMetrics.integral.toFixed(4)}</span>
          </div>
        </div>
      </div>
      
      {/* Control panel buttons to freeze / play animation */}
      <div className="flex items-center justify-between text-[11px] px-1 font-sans">
        <span className="text-[#486a73] font-medium">
          💡 Drag cursor on actual Study Desk to test more integration limits.
        </span>
        <button
          type="button"
          onClick={() => {
            animatingRef.current = !animatingRef.current;
            if (animatingRef.current) {
              // trigger reactivation frame loop
              const animate = (time: number) => {
                if (!animatingRef.current) return;
                setProgress(p => {
                  let next = p + 0.003;
                  if (next > 1) next = 0;
                  return next;
                });
                requestAnimationFrame(animate);
              };
              requestAnimationFrame(animate);
            }
          }}
          className="text-emerald-400 px-3 py-1 bg-[#102320] border border-emerald-500/10 hover:border-emerald-500/30 rounded-lg transition-colors font-mono font-bold cursor-pointer hover:bg-[#142d2a]"
        >
          {animatingRef.current ? "⏸ Pause Sync" : "▶ Play Sync"}
        </button>
      </div>
    </div>
  );
};
