import React from "react";
import katex from "katex";
import { VectorDisplay } from "./VectorDisplay";

// Highly efficient caching mechanism to avoid running expensive synchronous KaTeX compilation
// multiple times per second for identical equations on keyframe updates.
const katexCache = new Map<string, string>();

const renderKatexCached = (formula: string, displayMode: boolean): string => {
  const cacheKey = `${displayMode ? "block" : "inline"}:${formula}`;
  if (katexCache.has(cacheKey)) {
    return katexCache.get(cacheKey)!;
  }
  const preprocessed = preprocessMathFormula(formula);
  const html = katex.renderToString(preprocessed, {
    displayMode,
    throwOnError: false,
  });
  katexCache.set(cacheKey, html);
  return html;
};

const highlightSmartKeywords = (text: string, idx: number | string) => {
  const keywordRegex = /\b(cell|plants?|chloroplast|photosynthesis|mitochondria|nucleus|vacuole|organelle|cellular|biology|organic|harmonics?|force|gravity|velocity|acceleration|circuit|voltage|current|logic|binary|gate|boolean|bit|input|output|theorem|formula|equation|hypotenuse|trigonometry|calculus|derivative|syllabus|syllable|molecule|atoms?|electron|proton|neutron|covalent|methane|bohr|equilibrium|skeletal|supply|demand|price|quantity|market)\b/gi;
  
  const parts = text.split(keywordRegex);
  if (parts.length <= 1) {
    return <span key={idx} className="text-zinc-100/95 font-sans tracking-wide">{text}</span>;
  }

  return (
    <span key={idx} className="inline-wrap">
      {parts.map((part, pIdx) => {
        if (pIdx % 2 === 0) {
          return part ? <span key={pIdx} className="text-zinc-100/95 font-sans tracking-wide">{part}</span> : null;
        } else {
          const lower = part.toLowerCase();
          let colorClass = "text-zinc-100/95";
          let glowColor = "rgba(255, 255, 255, 0.2)";

          if (/^(cell|plants?|chloroplast|photosynthesis|mitochondria|nucleus|vacuole|organelle|cellular|biology|organic)$/.test(lower)) {
            colorClass = "text-emerald-300 font-bold";
            glowColor = "rgba(52, 211, 153, 0.4)";
          } else if (/^(harmonics?|force|gravity|velocity|acceleration|circuit|voltage|current|logic|binary|gate|boolean|bit|input|output)$/.test(lower)) {
            colorClass = "text-cyan-300 font-bold";
            glowColor = "rgba(34, 211, 238, 0.4)";
          } else if (/^(theorem|formula|equation|hypotenuse|trigonometry|calculus|derivative|syllabus|syllable)$/.test(lower)) {
            colorClass = "text-rose-300 font-bold";
            glowColor = "rgba(244, 114, 182, 0.4)";
          } else if (/^(molecule|atoms?|electron|proton|neutron|covalent|methane|bohr|equilibrium|skeletal)$/.test(lower)) {
            colorClass = "text-yellow-200 font-bold";
            glowColor = "rgba(253, 224, 71, 0.4)";
          } else if (/^(supply|demand|price|quantity|market)$/.test(lower)) {
            colorClass = "text-orange-300 font-bold";
            glowColor = "rgba(249, 115, 22, 0.4)";
          }

          return (
            <span
              key={pIdx}
              className={`${colorClass} px-0.5 mx-0.5 rounded-sm inline-block transition-transform hover:scale-105 duration-200`}
              style={{ textShadow: `0 0 4px ${glowColor}` }}
            >
              {part}
            </span>
          );
        }
      })}
    </span>
  );
};

function preprocessMathFormula(formula: string): string {
  let cleaned = formula.trim();

  // Normalize multi-backslashes to single backslash for LaTeX macros/symbols before processing,
  // preventing double-backslash rendering and KaTeX syntax failures on standard LaTeX commands.
  cleaned = cleaned.replace(/\\\\([a-zA-Z]+)/g, "\\$1");
  cleaned = cleaned.replace(/\\\\([{}_^#&%|])/g, "\\$1");
  
  // Clean spaces inside \begin{env} and \end{env} so KaTeX parses them correctly
  cleaned = cleaned.replace(/\\begin\s*\{\s*([a-zA-Z*]+)\s*\}/gi, "\\begin{$1}");
  cleaned = cleaned.replace(/\\end\s*\{\s*([a-zA-Z*]+)\s*\}/gi, "\\end{$1}");

  // Match backslash-less vector representations first: "vecOP" or "vec OP" or "\vec OP"
  cleaned = cleaned.replace(/\\?vec\s*([a-zA-Z]{1,3})/g, "\\vec{$1}");
  
  // Replace standalone vector variable OP to \vec{OP} when inside math tags, unless already part of LaTeX macro
  cleaned = cleaned.replace(/\bOP\b/g, "\\vec{OP}");

  const mathSymbolsMap: { [key: string]: string } = {
    "Delta\\s*theta": "\\Delta\\theta",
    "Delta\\s*t": "\\Delta t",
    "Deltat": "\\Delta t",
    "dtheta": "d\\theta",
    "d\\s*theta": "d\\theta",
    "theta": "\\theta",
    "Delta": "\\Delta",
    "delta": "\\delta",
    "alpha": "\\alpha",
    "beta": "\\beta",
    "gamma": "\\gamma",
    "Gamma": "\\Gamma",
    "omega": "\\omega",
    "Omega": "\\Omega",
    "phi": "\\phi",
    "pi": "\\pi",
    "lambda": "\\lambda",
    "mu": "\\mu",
    "tau": "\\tau",
    "sigma": "\\sigma",
  };

  for (const [key, replacement] of Object.entries(mathSymbolsMap)) {
    const regex = new RegExp(`(?<!\\\\)\\b${key}\\b`, 'g');
    cleaned = cleaned.replace(regex, replacement);
  }

  // Support numbered variables like theta1, theta2, phi1, phi2
  cleaned = cleaned.replace(/(?<!\\)\btheta([0-9]+)\b/g, "\\theta_$1");
  cleaned = cleaned.replace(/(?<!\\)\bphi([0-9]+)\b/g, "\\phi_$1");

  return cleaned;
};

// Clean representation for formula and text highlight in real-time




interface MathRendererProps {
  text: string;
  latestSpeech?: string;
}

// 1. Helper to parse inline tokens like bold, backticks, quotes, brackets, and math symbols to colorful chalk styles
const parseLineToSpans = (line: string, lineKey: string) => {
  // Tokenize by bold (**...**), backticks (`...`), and double quotes ("...")
  const tokenRegex = /(\*\*.*?\*\*|`.*?`|"[^"]*")/g;
  const tokens = line.split(tokenRegex);

  return (
    <span key={lineKey} className="inline-wrap leading-relaxed select-text">
      {tokens.map((token, idx) => {
        if (token.startsWith("**") && token.endsWith("**")) {
          const content = token.slice(2, -2);
          return (
            <strong key={idx} className="font-extrabold text-yellow-300 bg-yellow-500/15 px-1.5 py-0.5 rounded mx-0.5 font-sans" style={{ textShadow: "0 0 4px rgba(253, 224, 71, 0.4)" }}>
              {content}
            </strong>
          );
        } else if (token.startsWith("`") && token.endsWith("`")) {
          const content = token.slice(1, -1);
          return (
            <code key={idx} className="font-mono text-cyan-200 bg-cyan-950/70 border border-cyan-900/40 px-1.5 py-0.5 rounded text-[11px] mx-0.5">
              {content}
            </code>
          );
        } else if (token.startsWith('"') && token.endsWith('"')) {
          const content = token.slice(1, -1);
          return (
            <span key={idx} className="text-emerald-300 italic font-medium pr-0.5">
              "{content}"
            </span>
          );
        } else {
          // Split by punctuation brackets, mathematical operators, and punctuation marks to apply beautiful soft glowing colors
          const symRegex = /(\(|\)|\{|\}|\[|\]|=|\+|-|\*|\/|:|;|,|\.)/g;
          const subparts = token.split(symRegex);
          return (
            <React.Fragment key={idx}>
              {subparts.map((sub, sIdx) => {
                const isBracket = /^[(){}[\]]$/.test(sub);
                const isOp = /^[=+\-*/]$/.test(sub);
                const isColonOrSemi = /^[:;]$/.test(sub);
                const isCommaOrDot = /^[,.]$/.test(sub);
                const isNumber = /^\d+$/.test(sub.trim());

                if (isBracket) {
                  return (
                    <span key={sIdx} className="text-sky-300 font-bold font-mono px-0.5 animate-pulse-slow" style={{ textShadow: "0 0 3px rgba(125, 211, 252, 0.4)" }}>
                      {sub}
                    </span>
                  );
                } else if (isOp) {
                  return (
                    <span key={sIdx} className="text-rose-400 font-bold mx-1 font-mono hover:scale-105 inline-block" style={{ textShadow: "0 0 3px rgba(244, 114, 182, 0.4)" }}>
                      {sub}
                    </span>
                  );
                } else if (isColonOrSemi) {
                  return (
                    <span key={sIdx} className="text-amber-400 font-extrabold mx-0.5 font-mono">
                      {sub}
                    </span>
                  );
                } else if (isCommaOrDot) {
                  return (
                    <span key={sIdx} className="text-stone-400 font-mono font-bold mr-0.5">
                      {sub}
                    </span>
                  );
                } else if (isNumber) {
                  return (
                    <span key={sIdx} className="text-amber-300 font-bold font-mono tracking-tight" style={{ textShadow: "0 0 3px rgba(253, 224, 71, 0.3)" }}>
                      {sub}
                    </span>
                  );
                } else {
                  return highlightSmartKeywords(sub, sIdx);
                }
              })}
            </React.Fragment>
          );
        }
      })}
    </span>
  );
};

// 2. Helper to render text with inline math formulas horizontally
const renderInlineLineContent = (lineText: string, prefixKey: string) => {
  const inlineMathRegex = /(\$.*?\$)/g;
  const parts = lineText.split(inlineMathRegex);

  return (
    <span key={prefixKey} className="inline-wrap leading-relaxed select-text font-normal">
      {parts.map((part, idx) => {
        if (part.startsWith("$") && part.endsWith("$")) {
          const formula = part.slice(1, -1).trim();
          try {
            const html = renderKatexCached(formula, false);
            return (
              <span
                key={`${prefixKey}-inline-math-${idx}`}
                className="inline-block px-1.5 py-0.5 my-0.5 rounded bg-emerald-950/40 border border-emerald-900/30 font-mono text-emerald-300 font-bold select-all text-xs sm:text-sm"
                style={{ textShadow: "0 0 3px rgba(52, 211, 153, 0.4)" }}
                dangerouslySetInnerHTML={{ __html: html }}
                id={`math-inline-${prefixKey}-${idx}`}
              />
            );
          } catch (e) {
            return (
              <span key={`${prefixKey}-inline-math-err-${idx}`} className="text-red-400 font-mono">
                {part}
              </span>
            );
          }
        } else {
          return parseLineToSpans(part, `${prefixKey}-text-${idx}`);
        }
      })}
    </span>
  );
};

const isValidDefinitionLabel = (label: string): boolean => {
  const clean = label.trim();
  // Structural heading is always valid
  if (/^(HEADING|SUB-HEADING|TITLE|TOPIC)$/i.test(clean)) return true;
  // Otherwise, it must be reasonably short (<= 30 characters)
  if (clean.length > 30) return false;
  // It must not contain math/formatting symbols that suggest it's a formula / complex prose
  if (clean.match(/[\$\*\\\{\}\^\[\]_<>]/)) return false;
  // It must not end with typical sentence punctuation except maybe some emojis
  if (clean.match(/[.!?]$/)) return false;
  // Or it could be one of the known labels (case insensitive matching)
  const knownLabels = /^(definition|formula|equation|note|important|hint|instruction|warning|alert|tip|goal|case|proof|theorem|lemma|corollary|syllabus|exercise|question|answer|explanation|key\s+concept|concept|step|recall|observe|परिभाषा|सूत्र|समीकरण|नोट|महत्वपूर्ण|उदाहरण|प्रश्न|उत्तर)$/i;
  if (knownLabels.test(clean)) return true;
  // Otherwise, if it starts with an emoji or contains 1-3 simple words
  const wordsList = clean.split(/\s+/);
  if (wordsList.length > 3) return false;
  return true;
};

// 3. Main plain text formatting function using slate dust & chalkboard layers
const renderPlainTextWithChalkStyle = (textPart: string, keyPrefix: string = "plain", activeHighlightedText?: string) => {
  const lines = textPart.split("\n");
  return (
    <div className="flex flex-col space-y-2 mt-1 w-full select-text">
      {lines.map((line, lineIndex) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={lineIndex} className="h-2" />;
        }

        const isHighlighted = !!(activeHighlightedText && line && line.trim() === activeHighlightedText.trim());

        // Is this a list item containing a definition, formula, or note? e.g. "- Definition: ..."
        const listDefMatch = line.match(/^(\s*)(–|-|\*|\d+\.\s+)(definition|formula|equation|note|important|hint|instruction|परिभाषा|सूत्र|समीकरण|नोट|महत्वपूर्ण|उदाहरण)\s*:\s*(.*)/i);
        if (listDefMatch) {
          const indent = listDefMatch[1];
          const rawLabel = listDefMatch[3].trim();
          const content = listDefMatch[4];
          return (
            <div 
              key={lineIndex} 
              className={`relative text-left py-2 px-4 rounded-r-xl space-y-1 my-2 animate-chalk-fade shadow-sm border-l-4 transition-all duration-300 ${
                isHighlighted 
                  ? "bg-amber-500/20 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.25)] scale-[1.01]" 
                  : "border-amber-500/85 bg-amber-500/5"
              }`}
              style={{ marginLeft: `${indent.length * 8 + 12}px` }}
            >
              <span className="text-amber-300 font-extrabold tracking-widest text-[10px] sm:text-xs select-none block uppercase font-mono" style={{ textShadow: "0 0 4px rgba(253, 224, 71, 0.5)" }}>
                🌟 {rawLabel}
              </span>
              <div className="text-zinc-100/95 text-xs sm:text-sm leading-relaxed antialiased">
                {renderInlineLineContent(content, `${keyPrefix}-listdef-${lineIndex}`)}
              </div>
            </div>
          );
        }

        // Is this a list item bullet point?
        const listMatch = line.match(/^(\s*)(-\s*|\*\s*|\d+\.\s+)(.*)/);
        if (listMatch) {
          const indent = listMatch[1];
          const bullet = listMatch[2];
          const content = listMatch[3];
          
          return (
            <div 
              key={lineIndex} 
              className={`relative flex items-start text-left pl-3 sm:pl-5 py-1.5 animate-chalk-fade rounded-lg transition-all duration-350 ${
                isHighlighted 
                  ? "bg-[#c4f500]/15 border border-[#c4f500]/30 shadow-[0_0_12px_rgba(196,245,0,0.15)] scale-[1.01]" 
                  : "hover:bg-white/[0.01] transition-all duration-200"
              }`}
              style={{ paddingLeft: `${indent.length * 8 + 16}px` }}
            >
              <span className="text-rose-300 font-bold mr-2 select-none shrink-0 font-mono text-xs sm:text-sm bg-rose-950/30 px-1.5 py-0.5 rounded border border-rose-900/20" style={{ textShadow: "0 0 3px rgba(244, 114, 182, 0.5)" }}>
                {bullet.trim()}
              </span>
              <span className="flex-1 text-zinc-150 leading-relaxed text-xs sm:text-sm">
                {renderInlineLineContent(content, `${keyPrefix}-list-${lineIndex}`)}
              </span>
            </div>
          );
        }

        // Is this a definition key? e.g. "Definition: ...", "Note: ...", "Formula: ...", "परिभाषा: ...", "नोट: ..."
        const definitionMatch = line.match(/^([^:]+:\s*)(.*)/);
        if (definitionMatch && !trimmed.startsWith("http")) {
          const rawLabel = definitionMatch[1].replace(/:\s*$/, "").trim();
          const content = definitionMatch[2];
          
          if (isValidDefinitionLabel(rawLabel)) {
            const isStructureHeading = /^(HEADING|SUB-HEADING|TITLE|TOPIC)$/i.test(rawLabel);
            
            if (isStructureHeading) {
              const isSub = /^SUB-HEADING$/i.test(rawLabel);
              return (
                <div 
                  key={lineIndex} 
                  className={`relative text-left py-3 border-b border-emerald-950/35 mb-3 mt-1 animate-chalk-fade rounded-lg px-2 transition-all duration-350 ${
                    isHighlighted 
                      ? "bg-[#c4f500]/15 border border-[#c4f500]/30 shadow-[0_0_12px_rgba(196,245,0,0.15)] scale-[1.01]" 
                      : ""
                  }`}
                >
                  <span className={`${isSub ? "text-cyan-300 text-sm sm:text-base" : "text-amber-300 text-base sm:text-lg"} font-extrabold block tracking-wider uppercase font-sans`} style={{ textShadow: isSub ? "0 0 4px rgba(34, 211, 238, 0.3)" : "0 0 5px rgba(253, 224, 71, 0.4)" }}>
                    📌 {renderInlineLineContent(content, `${keyPrefix}-heading-${lineIndex}`)}
                  </span>
                </div>
              );
            }

            return (
              <div 
                key={lineIndex} 
                className={`relative text-left py-2 px-4 rounded-r-xl space-y-1 my-2.5 animate-chalk-fade shadow-md border-l-4 transition-all duration-300 ${
                  isHighlighted 
                    ? "bg-amber-500/20 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.25)] scale-[1.01]" 
                    : "border-l-4 border-amber-500/85 bg-amber-500/5"
                }`}
              >
                <span className="text-amber-300 font-extrabold tracking-widest text-[10px] sm:text-xs select-none block uppercase font-mono" style={{ textShadow: "0 0 4px rgba(253, 224, 71, 0.5)" }}>
                  🌟 {rawLabel}
                </span>
                <div className="text-zinc-100/95 text-xs sm:text-sm leading-relaxed antialiased">
                  {renderInlineLineContent(content, `${keyPrefix}-def-${lineIndex}`)}
                </div>
              </div>
            );
          }
        }

        // Standard plain text line
        return (
          <p 
            key={lineIndex} 
            className={`relative text-left leading-relaxed text-xs sm:text-sm py-1 animate-chalk-fade px-3 rounded-lg transition-all duration-350 ${
              isHighlighted 
                ? "bg-[#c4f500]/15 border border-[#c4f500]/30 shadow-[0_0_12px_rgba(196,245,0,0.15)] scale-[1.01] text-white" 
                : "hover:bg-white/[0.01]"
            }`}
          >
            {renderInlineLineContent(line, `${keyPrefix}-plain-${lineIndex}`)}
          </p>
        );
      })}
    </div>
  );
};

// Clean up and convert standard HTML elements to chalkboard-friendly clean markdown notation
const cleanAndFormatHtmlTags = (rawText: string): string => {
  let cleaned = rawText;

  // 1. Strip block level opening/closing containers
  cleaned = cleaned.replace(/<\s*\/?\s*(ul|ol|div)[^>]*>/gi, "\n");

  // 2. Convert standard HTML tags individually (so stream displays beautifully even without closing tags)
  cleaned = cleaned.replace(/<\s*h1[^>]*>/gi, "\nHEADING: ");
  cleaned = cleaned.replace(/<\s*\/\s*h1\s*>/gi, "\n");

  cleaned = cleaned.replace(/<\s*h2[^>]*>/gi, "\nSUB-HEADING: ");
  cleaned = cleaned.replace(/<\s*\/\s*h2\s*>/gi, "\n");

  cleaned = cleaned.replace(/<\s*h3[^>]*>/gi, "\nSUB-HEADING: ");
  cleaned = cleaned.replace(/<\s*\/\s*h3\s*>/gi, "\n");

  cleaned = cleaned.replace(/<\s*h[4-6][^>]*>/gi, "\nSUB-HEADING: ");
  cleaned = cleaned.replace(/<\s*\/\s*h[4-6]\s*>/gi, "\n");

  // Convert list items
  cleaned = cleaned.replace(/<\s*li[^>]*>/gi, "\n- ");
  cleaned = cleaned.replace(/<\s*\/\s*li\s*>/gi, "\n");

  // Convert paragraphs
  cleaned = cleaned.replace(/<\s*p[^>]*>/gi, "\n");
  cleaned = cleaned.replace(/<\s*\/\s*p\s*>/gi, "\n");

  // 3. Strip inline formatting tags (replace with markdown equivalent or empty)
  cleaned = cleaned.replace(/<\s*(strong|b)[^>]*>/gi, "**");
  cleaned = cleaned.replace(/<\s*\/\s*(strong|b)\s*>/gi, "**");

  cleaned = cleaned.replace(/<\s*(em|i)[^>]*>/gi, "*");
  cleaned = cleaned.replace(/<\s*\/\s*(em|i)\s*>/gi, "*");

  cleaned = cleaned.replace(/<\s*\/?\s*(span|font)[^>]*>/gi, "");

  // 4. Convert line breaks
  cleaned = cleaned.replace(/<\s*br\s*\/?>/gi, "\n");

  // 5. Hide any unclosed trailing/incomplete HTML tags at the end of the text stream
  // (e.g. text ending with "<h1 style=" or "<li" or "<p" - strip it from the end so it doesn't leak as raw code)
  cleaned = cleaned.replace(/<[^>]*$/g, "");

  // 6. Clean up excessive sequential newlines
  cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, "\n\n");

  return cleaned;
};

// Helper to clean up punctuation, common Hindi/Hinglish filler words, and map spoken mathematical terms to their formula equivalents
const getNormalizedWords = (rawText: string): Set<string> => {
  const norm = rawText
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'🎙️🎓]/g, " ")
    .replace(/\\/g, " ");
  
  // Split into words, filter minor filler words (both English and Hinglish)
  // this filters things like "hai", "ko", "or", "to", "the", "and", "is", "se", "ki", etc.
  // so we find pure keywords and formula variables!
  const ignoreSet = new Set([
    "the", "and", "or", "to", "in", "of", "on", "at", "by", "for", "with", "about", "against", "after", "before", "each", "every",
    "is", "am", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "a", "an", "this", "that", "these", "those",
    "ko", "se", "ke", "ki", "ka", "me", "par", "hai", "hain", "tha", "thi", "the", "ho", "gaya", "gayi", "aur", "ya", "toh", "ek", "do", "teen",
    "hoga", "hogi", "karo", "kya", "kyun", "kab", "kahan", "kaise", "bhi", "hi", "ne", "re", "arey", "ab", "isame", "isase", "ye", "woh", "voh", "tum",
    "aap", "hum", "main", "mera", "meri", "mere", "apna", "apni", "apne", "use", "usase", "usaki", "usaka", "usake"
  ]);

  const words = norm.split(/\s+/);
  const cleanWordsSet = new Set<string>();

  for (let w of words) {
    w = w.trim();
    if (w.length < 2) continue; // single characters except main variables
    if (ignoreSet.has(w)) continue;
    
    // Map spoken word variants to common LaTeX representations to allow math indexing
    if (w === "theta") { cleanWordsSet.add("theta"); cleanWordsSet.add("\\theta"); }
    else if (w === "omega") { cleanWordsSet.add("omega"); cleanWordsSet.add("\\omega"); }
    else if (w === "alpha") { cleanWordsSet.add("alpha"); cleanWordsSet.add("\\alpha"); }
    else if (w === "beta") { cleanWordsSet.add("beta"); cleanWordsSet.add("\\beta"); }
    else if (w === "gamma") { cleanWordsSet.add("gamma"); cleanWordsSet.add("\\gamma"); }
    else if (w === "delta") { cleanWordsSet.add("delta"); cleanWordsSet.add("delta\\theta"); cleanWordsSet.add("\\delta"); cleanWordsSet.add("\\Delta"); }
    else if (w === "lambda") { cleanWordsSet.add("lambda"); cleanWordsSet.add("\\lambda"); }
    else if (w === "pi") { cleanWordsSet.add("pi"); cleanWordsSet.add("\\pi"); }
    else if (w === "tau") { cleanWordsSet.add("tau"); cleanWordsSet.add("\\tau"); }
    else if (w === "frac" || w === "fraction" || w === "divided" || w === "upon") { cleanWordsSet.add("frac"); cleanWordsSet.add("\\frac"); }
    else {
      cleanWordsSet.add(w);
    }
  }

  return cleanWordsSet;
};

const calculateMatchScore = (lineText: string, speechText: string): number => {
  if (!lineText || !speechText) return 0;
  
  const lineWords = getNormalizedWords(lineText);
  const speechWords = getNormalizedWords(speechText);
  
  if (lineWords.size === 0 || speechWords.size === 0) return 0;

  let commonCount = 0;
  for (const lw of lineWords) {
    if (speechWords.has(lw)) {
      commonCount++;
    } else {
      // Fuzzy match for stems (e.g., matching displacement -> displacements)
      for (const sw of speechWords) {
        if (lw.length >= 4 && sw.length >= 4) {
          if (lw.includes(sw) || sw.includes(lw)) {
            commonCount += 0.7; // slight weight for partial stems
            break;
          }
        }
      }
    }
  }

  // Calculate percentage of matched terms in the line (relative density)
  const lineDensity = commonCount / lineWords.size;
  const speechDensity = commonCount / speechWords.size;

  // Let's also check for direct sequence match of 2 or more sequential words!
  let sequentialBonus = 0;
  const cleanLineLower = lineText.toLowerCase().replace(/[#*$`_\\]/g, " ").replace(/\s+/g, " ").trim();
  const cleanSpeechLower = speechText.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ").replace(/\s+/g, " ").trim();
  
  // Find parts of 2-3 words from the line in the speech
  const rawWordsInLine = cleanLineLower.split(/\s+/).filter(w => w.length >= 3 && !new Set(["the", "and", "this", "that"]).has(w));
  for (let i = 0; i <= rawWordsInLine.length - 2; i++) {
    const bigram = `${rawWordsInLine[i]} ${rawWordsInLine[i+1]}`;
    if (cleanSpeechLower.includes(bigram)) {
      sequentialBonus += 3;
    }
  }

  return commonCount * 3 + lineDensity * 12 + speechDensity * 5 + sequentialBonus;
};

const getBestMatchingBlock = (boardText: string, speechText: string): { text: string; score: number } => {
  if (!boardText || !speechText || speechText.trim().length < 4) {
    return { text: "", score: 0 };
  }

  const rawLines = boardText.split("\n");
  const candidates: string[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Direct latex displays can also be candidates
    if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) {
      candidates.push(trimmed);
      continue;
    }

    // Isolate pure text from markdown list prefix, definition label, and headers
    let cleaner = trimmed;
    cleaner = cleaner.replace(/^(\s*)(–|-|\*|\d+\.\s+)(definition|formula|equation|note|important|hint|instruction|परिभाषा|सूत्र|समीकरण|नोट|महत्वपूर्ण|उदाहरण)\s*:\s*(.*)/i, "");
    cleaner = cleaner.replace(/^(\s*)(-\s*|\*\s*|\d+\.\s+)/, "");
    cleaner = cleaner.replace(/^HEADING:\s*/gi, "");
    cleaner = cleaner.replace(/^SUB-HEADING:\s*/gi, "");
    cleaner = cleaner.replace(/^([^:]+:\s*)/, ""); // general definition labels

    const cleanedText = cleaner.replace(/[\\/*$#`_]/g, " ").trim();
    if (cleanedText.length >= 4) {
      candidates.push(trimmed); // Store raw original line to match render exact key
    }
  }

  let bestText = "";
  let bestScore = 0;

  for (const cand of candidates) {
    const score = calculateMatchScore(cand, speechText);
    if (score > bestScore) {
      bestScore = score;
      bestText = cand;
    }
  }

  return { text: bestText, score: bestScore };
};

export const MathRenderer: React.FC<MathRendererProps> = ({ text, latestSpeech }) => {
  if (!text) return null;

  // Memoize computing the active explained portion in real-time
  const bestBlock = React.useMemo(() => {
    return getBestMatchingBlock(text, latestSpeech || "");
  }, [text, latestSpeech]);

  // If match score is strong enough, consider it active
  const activeHighlightedText = bestBlock.score >= 3.0 ? bestBlock.text : undefined;

  // Clean SVG code block fences if they exist
  const cleanSvgCode = (code: string) => {
    return code
      .replace(/```xml/gi, "")
      .replace(/```html/gi, "")
      .replace(/```svg/gi, "")
      .replace(/```/g, "")
      .trim();
  };

  // Strip <board> and </board> tags and markdown block code fences to prevent interference with rendering
  let cleanedText = text
    .replace(/<\/?board>/gi, "")
    .replace(/```(markdown|text|latex|html|xml|svg|math)?/gi, "")
    .replace(/```/g, "")
    .trim();
  
  // Clean up streaming artifacts: strip trailing slashes, backslashes, or literal /n, \n at the absolute end
  cleanedText = cleanedText.replace(/[\\/]+n$/gi, "").trim();
  cleanedText = cleanedText.replace(/[\\/]+$/g, "").trim();

  // Pre-normalize double backslashes for commands and delimiters to avoid KaTeX and regex parser failures
  let normalizedRawText = cleanedText
    .replace(/\\\\([a-zA-Z]+)/g, "\\$1")
    .replace(/\\\\([{}_^#&%|()[\]])/g, "\\$1");

  // Normalize spaces inside \begin{...} and \end{...} so that the environment name is normalized and easier to match & render.
  normalizedRawText = normalizedRawText.replace(/\\begin\s*\{\s*([a-zA-Z*]+)\s*\}/gi, "\\begin{$1}");
  normalizedRawText = normalizedRawText.replace(/\\end\s*\{\s*([a-zA-Z*]+)\s*\}/gi, "\\end{$1}");

  // Robust real-time parser to separate plain text chunks from SVG diagrams (handles ongoing stream incomplete SVGs)
  const parseSegments = (rawText: string) => {
    const segments: { type: "text" | "svg"; content: string; isComplete?: boolean }[] = [];
    let remaining = rawText;
    
    while (remaining.length > 0) {
      const svgIndex = remaining.toLowerCase().indexOf("<svg");
      if (svgIndex === -1) {
        segments.push({ type: "text", content: remaining });
        break;
      }
      
      if (svgIndex > 0) {
        segments.push({ type: "text", content: remaining.slice(0, svgIndex) });
      }
      
      const rest = remaining.slice(svgIndex);
      const closeIndex = rest.toLowerCase().indexOf("</svg>");
      
      if (closeIndex !== -1) {
        const svgContent = rest.slice(0, closeIndex + 6);
        segments.push({ type: "svg", content: svgContent, isComplete: true });
        remaining = rest.slice(closeIndex + 6);
      } else {
        // Incomplete SVG being streamed — auto-close so it forms a valid render node in VectorDisplay
        let incompleteSvg = rest;
        if (!incompleteSvg.toLowerCase().trim().endsWith("</svg>")) {
          incompleteSvg = incompleteSvg + "\n</svg>";
        }
        segments.push({ type: "svg", content: incompleteSvg, isComplete: false });
        break;
      }
    }
    
    return segments;
  };

  const segments = parseSegments(normalizedRawText);

  return (
    <div className="math-renderer-container inline-wrap whitespace-pre-wrap break-words leading-relaxed select-text w-full space-y-4">
      {/* Chalk roughness filter declaration for dynamic vector drawings */}
      <svg className="absolute w-0 h-0" xmlns="http://www.w3.org/2000/svg" data-html2canvas-ignore="true">
        <defs>
          <filter id="vector-chalk-roughness" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.5" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {segments.map((segment, segIdx) => {
        if (segment.type === "svg") {
          const rawSvg = cleanSvgCode(segment.content);
          return (
            <VectorDisplay 
              key={`vector-svg-${segIdx}`}
              rawSvg={rawSvg}
              index={segIdx}
              isComplete={segment.isComplete}
            />
          );
        }

        // 2. Normalize LaTeX delimiters for mathematical formulas
        const cleanedText = cleanAndFormatHtmlTags(segment.content);
        const normalizedText = cleanedText
          .replace(/\\\[/g, "$$")
          .replace(/\\\]/g, "$$")
          .replace(/\\\(/g, "$")
          .replace(/\\\)/g, "$");

        // This regex matches BOTH display math delimiters ($$ ... $$ with potential newlines) and latex environments starting with \begin and ending with \end
        const displayMathRegex = /(\$\$[\s\S]*?\$\$|\\begin\s*\{\s*[a-zA-Z*]+\s*\}[\s\S]*?\\end\s*\{\s*[a-zA-Z*]+\s*\})/gi;
        const subParts = normalizedText.split(displayMathRegex);

        return (
          <React.Fragment key={`text-seg-${segIdx}`}>
            {subParts.map((part, index) => {
              const trimmedPart = part.trim();
              const isBlockMath = (trimmedPart.startsWith("$$") && trimmedPart.endsWith("$$")) || 
                                  /^\\begin\s*\{\s*[a-zA-Z*]+\s*\}/i.test(trimmedPart);

              if (isBlockMath) {
                const isEnv = /^\\begin\s*\{\s*[a-zA-Z*]+\s*\}/i.test(trimmedPart);
                const formula = isEnv ? trimmedPart : trimmedPart.slice(2, -2).trim();
                const isMathHighlighted = !!(activeHighlightedText && (part.trim() === activeHighlightedText.trim() || trimmedPart === activeHighlightedText.trim()));
                try {
                  const html = renderKatexCached(formula, true);
                  return (
                    <div
                      key={`block-math-${index}`}
                      className={`my-4 overflow-x-auto p-4 rounded-2xl text-center font-mono text-emerald-300 text-sm sm:text-base leading-normal shadow-2xl max-w-full custom-math-block relative transition-all duration-300 border-2 ${
                        isMathHighlighted 
                          ? "bg-emerald-900/30 border-[#c4f500]/60 shadow-[0_0_20px_rgba(196,245,0,0.25)] scale-[1.01]" 
                          : "bg-[#081f18] border-emerald-500/40"
                      }`}
                      style={{
                        boxShadow: isMathHighlighted 
                          ? "inset 0 0 10px rgba(16, 185, 129, 0.2), 0 0 20px rgba(196, 245, 0, 0.25)" 
                          : "inset 0 0 10px rgba(16, 185, 129, 0.1), 0 0 15px rgba(16, 185, 129, 0.05)",
                        borderColor: isMathHighlighted ? "rgba(196,245,0,0.6)" : "rgba(52, 211, 153, 0.25)"
                      }}
                      id={`math-block-${segIdx}-${index}`}
                    >
                      <div dangerouslySetInnerHTML={{ __html: html }} />
                    </div>
                  );
                } catch (e) {
                  return (
                    <span key={`error-block-math-${index}`} className="text-red-400 font-mono">
                      {part}
                    </span>
                  );
                }
              } else {
                // Beautiful colorful chalk styled plain text containing inline math
                let cleanedPart = part.replace(/[\\/]n(?![a-z])/gi, "\n");
                // Remove any leftover raw XML/HTML tags (like <p>, <span>, etc.) to keep the blackboard 100% clean of blackboard/frontend HTML
                cleanedPart = cleanedPart.replace(/<[^>]*>/gi, "");
                return (
                   <React.Fragment key={`plain-${index}`}>
                     {renderPlainTextWithChalkStyle(cleanedPart, `seg-${segIdx}-part-${index}`, activeHighlightedText)}
                   </React.Fragment>
                );
              }
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
};
