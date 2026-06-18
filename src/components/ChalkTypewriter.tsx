import React, { useState, useEffect, useRef } from "react";
import { MathRenderer } from "./MathRenderer";

interface ChalkTypewriterProps {
  text: string;
  state?: string;       // e.g. "speaking", "listening", "idle", etc.
  cherryVolume?: number; // 0.0 to 1.0 (real-time voice volume)
  latestSpeech?: string;
  isAcademicNotes?: boolean;
  isFallback?: boolean;
}

export const ChalkTypewriter: React.FC<ChalkTypewriterProps> = ({ 
  text, 
  state = "disconnected", 
  cherryVolume = 0, 
  latestSpeech, 
  isAcademicNotes = false,
  isFallback = false
}) => {
  const isStatic = state === "idle" || state === "disconnected" || state === "listening";

  const [displayedText, setDisplayedText] = useState(isStatic || isFallback ? text : "");
  const indexRef = useRef(isStatic || isFallback ? text.length : 0);
  const textRef = useRef(text);
  const isTypingActiveRef = useRef(false);
  const timerIdRef = useRef<any>(null);

  // Sync state reference to avoid stale closures in timeouts
  const stateRef = useRef(state);
  const volumeRef = useRef(cherryVolume);
  const isAcademicNotesRef = useRef(isAcademicNotes);
  const wasFallbackRef = useRef(isFallback);

  useEffect(() => {
    stateRef.current = state;
    // If we transition to static, instantly finish typing
    if (state === "idle" || state === "disconnected" || state === "listening") {
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
        timerIdRef.current = null;
      }
      indexRef.current = textRef.current.length;
      setDisplayedText(textRef.current);
      isTypingActiveRef.current = false;
    }
  }, [state]);
  useEffect(() => {
    volumeRef.current = cherryVolume;
  }, [cherryVolume]);
  useEffect(() => {
    isAcademicNotesRef.current = isAcademicNotes;
  }, [isAcademicNotes]);

  // Synchronize when incoming text changes with smart transduction-noise filtering.
  // Avoids catastrophic typing resets on trivial word adjustments, formatting edits, or punctuation corrections mid-stream.
  useEffect(() => {
    const wasFallback = wasFallbackRef.current;
    wasFallbackRef.current = isFallback;

    // Is it fallback mode right now? Ensure instant rendering!
    if (isFallback) {
      textRef.current = text;
      indexRef.current = text.length;
      setDisplayedText(text);
      isTypingActiveRef.current = false;
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
        timerIdRef.current = null;
      }
      return;
    }

    // Did we just exit fallback mode (e.g., actual notes arrived)?
    // Ensure we transition to the actual notes instantly without clearing/wiping or double-typing!
    if (wasFallback && !isFallback) {
      textRef.current = text;
      indexRef.current = text.length;
      setDisplayedText(text);
      isTypingActiveRef.current = false;
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
        timerIdRef.current = null;
      }
      return;
    }

    if (stateRef.current === "idle" || stateRef.current === "disconnected" || stateRef.current === "listening") {
      textRef.current = text;
      indexRef.current = text.length;
      setDisplayedText(text);
      isTypingActiveRef.current = false;
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
        timerIdRef.current = null;
      }
      return;
    }

    const prevText = textRef.current;
    
    // Normalize and clean both strings
    const prevClean = prevText ? prevText.replace(/[\\/\s\n]+$/g, "").trim() : "";
    const textClean = text ? text.replace(/[\\/\s\n]+$/g, "").trim() : "";
    
    // Determine if we need a hard reset.
    // We only reset to character 0 if:
    // a. The text has been explicitly wiped or is empty
    // b. The text length is substantially shrunk (board cleared or massive deletion)
    // c. The subject prefix has completely changed (shifted topics or new sentence started)
    const isWiped = !textClean;
    const isMuchShorter = prevClean && textClean && textClean.length < prevClean.length - 15;
    const isPrefixChanged = prevClean && textClean && !textClean.toLowerCase().startsWith(prevClean.toLowerCase().substring(0, Math.min(10, prevClean.length)));
    
    const needsReset = isWiped || isMuchShorter || isPrefixChanged;

    if (!needsReset) {
      // Just update the target text we're typing towards
      textRef.current = text;
      
      // If we are already ahead of the new text length, clamp the index and text
      if (indexRef.current > text.length) {
        indexRef.current = text.length;
        setDisplayedText(text);
      }
      
      // If the typing loop had stopped or wasn't running, trigger it to type the new additions
      if (!isTypingActiveRef.current) {
        startTypingLoop();
      }
    } else {
      // Complete reset for brand new content (e.g., topic switches or manual board clearance)
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
        timerIdRef.current = null;
      }
      setDisplayedText("");
      indexRef.current = 0;
      textRef.current = text;
      if (text) {
        startTypingLoop();
      } else {
        isTypingActiveRef.current = false;
      }
    }
  }, [text]);

  const startTypingLoop = () => {
    isTypingActiveRef.current = true;

    // Clear any existing active timer
    if (timerIdRef.current) {
      clearTimeout(timerIdRef.current);
    }

    const runTypewriter = () => {
      const currentTarget = textRef.current;
      const currentIndex = indexRef.current;
      const currentState = stateRef.current;
      const currentVolume = volumeRef.current;

      if (!currentTarget) {
        setDisplayedText("");
        indexRef.current = 0;
        isTypingActiveRef.current = false;
        return;
      }

      // 1. ACTIVE UNCLOSED SVG ATOMIC BLOCK PROTECTION:
      // If our cursor is inside of an unclosed SVG tag, or if the current slice is about to start one,
      // we must atomic-skip standard typing entirely. This keeps raw XML syntax off the screen
      // and guarantees SVG elements rendering properly without getting typed as garbage strings.
      const prefix = currentTarget.slice(0, currentIndex);
      const lastOpenSvg = prefix.toLowerCase().lastIndexOf("<svg");
      const lastCloseSvg = prefix.toLowerCase().lastIndexOf("</svg>");
      const isInsideSvgRange = lastOpenSvg !== -1 && lastOpenSvg > lastCloseSvg;

      if (isInsideSvgRange) {
        const fullRemaining = currentTarget.slice(lastOpenSvg);
        const closeTagIndex = fullRemaining.toLowerCase().indexOf("</svg>");
        if (closeTagIndex !== -1) {
          // Found closing tag! Jump past it dynamically.
          const nextIndex = lastOpenSvg + closeTagIndex + 6;
          indexRef.current = nextIndex;
          setDisplayedText(currentTarget.slice(0, nextIndex));
          timerIdRef.current = setTimeout(runTypewriter, 40);
          return;
        } else {
          // SVG is still streaming and incomplete. Bypass typing to the end and wait for additions.
          indexRef.current = currentTarget.length;
          setDisplayedText(currentTarget);
          isTypingActiveRef.current = false;
          return;
        }
      }

      if (currentIndex < currentTarget.length) {
        const sliceFromCurrent = currentTarget.slice(currentIndex);
        const lowerSlice = sliceFromCurrent.toLowerCase();
        
        if (lowerSlice.startsWith("<svg") || lowerSlice.startsWith("```xml\n<svg") || lowerSlice.startsWith("```svg\n<svg")) {
          const svgStartOffset = lowerSlice.indexOf("<svg");
          const absoluteOpenSvg = currentIndex + svgStartOffset;
          const fullRemaining = currentTarget.slice(absoluteOpenSvg);
          const closeTagIndex = fullRemaining.toLowerCase().indexOf("</svg>");
          
          if (closeTagIndex !== -1) {
            const nextIndex = absoluteOpenSvg + closeTagIndex + 6;
            indexRef.current = nextIndex;
            setDisplayedText(currentTarget.slice(0, nextIndex));
            timerIdRef.current = setTimeout(runTypewriter, 40);
            return;
          } else {
            // Incomplete SVG starts here. Display everything immediately so rendering can form, and wait.
            indexRef.current = currentTarget.length;
            setDisplayedText(currentTarget);
            isTypingActiveRef.current = false;
            return;
          }
        }

        // Calculate adaptive chunk sizing (characters per step) and pacing based on current states
        let charsPerStep = 1;
        let baseInterval = 15; // default fluid delay

        const lagLength = currentTarget.length - currentIndex;
        const isAcademic = isAcademicNotesRef.current || 
                           !!currentTarget.match(/\\begin|\\end|\$\$|\$|<svg|<path|```|#|\\frac|\\sum|\\lambda|\+|-|=/i);

        if (currentState === "speaking" && !isAcademic) {
          // VOICE SYNCED MODE: Cherry is talking right now and we are animating her spoken transcript captions!
          if (lagLength > 180) {
            charsPerStep = 10;
            baseInterval = 5;
          } else if (lagLength > 90) {
            charsPerStep = 5;
            baseInterval = 8;
          } else if (lagLength > 40) {
            charsPerStep = 3;
            baseInterval = 10;
          } else if (lagLength > 15) {
            charsPerStep = 2;
            baseInterval = 12;
          } else {
            // Perfect syllabic and phonemic sync zone (lagLength <= 15)
            charsPerStep = 1;
            
            // Note: currentVolume is calculated in real time by the browser audio AnalyserNode on playback buffer
            if (currentVolume > 0.003) {
              // Active vocalization! Type matching the natural cadence of Indian/English speech (approx. 18-22 chars per second)
              baseInterval = 35 + Math.floor(Math.random() * 15);
            } else {
              // Whisper/pause fallback: slow down typing slightly but keep it moving (45ms to 65ms delay) so it never feels stuck
              baseInterval = 45 + Math.floor(Math.random() * 20);
            }
          }
        } else {
          // CATCH-UP / LECTURE SYLLABUS OR ACADEMIC NOTES MODE:
          // Fast and fluent blackboard writing (approx. 60-200 chars/sec) that never feels stuck!
          if (lagLength > 180) {
            charsPerStep = Math.ceil(lagLength / 8); // extremely rapid dump for long texts/SVGs
            baseInterval = 5;
          } else if (lagLength > 90) {
            charsPerStep = 8;
            baseInterval = 6;
          } else if (lagLength > 40) {
            charsPerStep = 4;
            baseInterval = 8;
          } else if (lagLength > 15) {
            charsPerStep = 2;
            baseInterval = 10;
          } else {
            charsPerStep = 1;
            baseInterval = 12;
          }
        }

        let nextIndex = Math.min(currentIndex + charsPerStep, currentTarget.length);
        
        // Minor dynamic punctuation breathing pauses to resemble real hands writing on the slate
        let delay = baseInterval;
        if (charsPerStep === 1 && currentState === "speaking") {
          const lastTypedChar = currentTarget[currentIndex];
          if (lastTypedChar === "." || lastTypedChar === "?" || lastTypedChar === "!") {
            delay = 350; // speech period slice pause
          } else if (lastTypedChar === "," || lastTypedChar === ";" || lastTypedChar === "-") {
            delay = 180; // natural breathing pause
          } else if (lastTypedChar === "\n") {
            delay = 250; // paragraph line jump delay
          }
        }

        indexRef.current = nextIndex;
        setDisplayedText(currentTarget.slice(0, nextIndex));
        
        timerIdRef.current = setTimeout(runTypewriter, delay);
      } else {
        // Reached target end, pause loop
        isTypingActiveRef.current = false;
      }
    };

    timerIdRef.current = setTimeout(runTypewriter, 10);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
      }
    };
  }, []);

  return (
    <span className="relative inline-wrap w-full select-text">
      <MathRenderer text={displayedText} latestSpeech={latestSpeech} />
      {displayedText.length < text.length && (
        <span 
          className="inline-block w-2.5 h-4 ml-1 rounded bg-emerald-400 animate-pulse shrink-0 font-medium" 
          style={{ 
            boxShadow: "0 0 10px rgba(52, 211, 153, 0.9)",
            verticalAlign: "middle"
          }} 
        />
      )}
    </span>
  );
};
