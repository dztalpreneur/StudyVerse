import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, MicOff, Volume2, PhoneOff, PhoneCall, Sparkles, AlertCircle, PlayCircle } from "lucide-react";
import { useAditiLiveSession } from "../hooks/useAditiLiveSession";

export const ConciergeAssistant: React.FC = () => {
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "info" | "success" | "error" } | null>(null);

  // Trigger local toast notifications inside the Concierge frame
  const handleToast = (text: string, type: "info" | "success" | "error") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const {
    state,
    userVolume,
    aditiVolume,
    connect,
    disconnect,
  } = useAditiLiveSession({ onToast: handleToast });

  // Compute visual voice bar sizes rescaled dynamically
  const userVolScale = Math.min(2.5, 1 + userVolume * 15);
  const aditiVolScale = Math.min(2.5, 1 + aditiVolume * 15);

  const isActive = state !== "disconnected" && state !== "connecting" && state !== "error";

  return (
    <div className="relative bg-[#0a3641] border-2 border-[#cbd5e1]/10 rounded-3xl overflow-hidden shadow-xl flex flex-col h-[500px]">
      
      {/* Decorative top title panel resembling high-end console */}
      <div className="bg-[#124e5d]/60 px-5 py-4 border-b border-[#dae1dd]/15 flex items-center justify-between text-left shrink-0">
        <div className="flex items-center space-x-3">
          <div className="relative shrink-0">
            {/* Pulsating live visual ring */}
            {state === "speaking" && (
              <div className="absolute -inset-1.5 rounded-full bg-[#c4f500] opacity-40 animate-ping" />
            )}
            {state === "listening" && (
              <div className="absolute -inset-1.5 rounded-full bg-emerald-400 opacity-40 animate-pulse" />
            )}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg z-15 relative text-white border-2 ${
              isActive ? "border-[#c4f500] bg-emerald-900" : "border-slate-500 bg-slate-800"
            }`}>
              👩‍💼
            </div>
          </div>
          <div>
            <h4 className="text-xs font-black tracking-widest uppercase flex items-center gap-1.5 text-white font-mono">
              <span>ADITI (CONCIERGE)</span>
              {isActive && (
                <span className="p-0.5 px-1.5 rounded-md text-[8px] bg-emerald-900 border border-emerald-500 text-[#c4f500] font-mono leading-none animate-pulse">
                  VOICE API ACTIVE
                </span>
              )}
            </h4>
            <p className="text-[10px] text-teal-100/50 font-mono mt-0.5">
              {state === "disconnected" && "Offline • Click Call to Speak"}
              {state === "connecting" && "Initializing Live Stream..."}
              {state === "idle" && "Ready • Speak in Mic"}
              {state === "listening" && "Listening to Your Sound..."}
              {state === "speaking" && "Speaking audio waves..."}
              {state === "error" && "Stream error occurred"}
            </p>
          </div>
        </div>

        {/* Small Live indicator dot */}
        <div className="flex items-center space-x-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${
            state === "speaking" ? "bg-[#c4f500] animate-bounce" :
            state === "listening" ? "bg-emerald-400 animate-pulse" :
            isActive ? "bg-[#c4f500]" : "bg-slate-500"
          }`} />
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-teal-100/60">
            {state}
          </span>
        </div>
      </div>

      {/* Main Terminal Screen Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col items-center justify-between p-6 bg-gradient-to-b from-[#0a3641] to-[#041a20]">
        
        {/* Floating notifications */}
        <AnimatePresence>
          {toastMessage && (
            <motion.div
              initial={{ opacity: 0, y: -15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute top-4 left-4 right-4 z-30 p-2.5 rounded-xl border flex items-start space-x-2 text-left font-sans text-xs font-bold leading-normal shadow-lg bg-[#124e5d] border-teal-500/20 text-teal-50"
            >
              <AlertCircle className="w-4 h-4 text-[#c4f500] shrink-0 mt-0.5" />
              <span>{toastMessage.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center Calling State Graphics */}
        <div className="flex-1 w-full flex flex-col items-center justify-center relative select-none">
          {state === "disconnected" && (
            <div className="text-center space-y-4 max-w-xs animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-slate-800/40 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-400">
                <Mic className="w-7 h-7 stroke-[1.5]" />
              </div>
              <div className="space-y-1">
                <h5 className="text-xs font-bold text-[#c4f500] font-mono tracking-wide uppercase">Audio-to-Audio Connection</h5>
                <p className="text-[10px] text-teal-100/60 leading-relaxed font-sans">
                  Talk directly in Hinglish or English to explain things live! Click on the call icon below to establish a real-time web socket.
                </p>
              </div>
            </div>
          )}

          {state === "connecting" && (
            <div className="text-center space-y-4">
              <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                <Sparkles className="w-6 h-6 text-[#c4f500]" />
              </div>
              <div className="space-y-1">
                <h5 className="text-xs font-bold text-white font-mono uppercase tracking-widest animate-pulse">Establishing Stream...</h5>
                <p className="text-[9px] text-[#c4f500] font-mono uppercase">Negotiating PCM at 16,000Hz</p>
              </div>
            </div>
          )}

          {isActive && (
            <div className="w-full h-full flex flex-col items-center justify-between py-2 relative">
              
              {/* Dynamic Sound Equalizer Visualization */}
              <div className="flex-1 flex items-center justify-center space-x-4 w-full relative">
                
                {/* User Mic Visualizer Orbit */}
                <div className="flex flex-col items-center space-y-1">
                  <div 
                    className="w-16 h-16 rounded-full border border-teal-500/20 bg-[#124e5d]/30 flex items-center justify-center transition-all duration-75 relative"
                    style={{ transform: `scale(${userVolScale})` }}
                  >
                    <Mic className={`w-5 h-5 ${state === "listening" ? "text-emerald-400" : "text-white/60"}`} />
                    {state === "listening" && (
                      <div className="absolute inset-0 rounded-full border border-emerald-400 animate-ping opacity-60" />
                    )}
                  </div>
                  <span className="text-[8px] font-mono text-teal-200/55 tracking-wider uppercase font-bold mt-1">
                    Your Mic
                  </span>
                </div>

                {/* Connection Core Sparkle */}
                <div className="h-[2px] bg-gradient-to-r from-emerald-500/20 via-[#c4f500] to-emerald-500/20 w-12 relative">
                  <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#c4f500] ${
                    state === "speaking" || state === "listening" ? "animate-ping" : ""
                  }`} />
                </div>

                {/* Aditi Audio Output Orbit */}
                <div className="flex flex-col items-center space-y-1">
                  <div 
                    className="w-16 h-16 rounded-full border border-emerald-500/20 bg-emerald-950/40 flex items-center justify-center transition-all duration-75 relative"
                    style={{ transform: `scale(${aditiVolScale})` }}
                  >
                    <Volume2 className={`w-5 h-5 ${state === "speaking" ? "text-[#c4f500]" : "text-white/60"}`} />
                    {state === "speaking" && (
                      <div className="absolute inset-0 rounded-full border border-[#c4f500] animate-ping opacity-60" />
                    )}
                  </div>
                  <span className="text-[8px] font-mono text-[#c4f500] tracking-wider uppercase font-bold mt-1">
                    Aditi Voice
                  </span>
                </div>

              </div>

              {/* Sound visualizers occupying the center cleanly as captions are deactivated */}

            </div>
          )}
        </div>

        {/* Bottom Interactive Voice control pads */}
        <div className="w-full pt-4 border-t border-[#dae1dd]/10 flex flex-col items-center justify-center space-y-3 shrink-0">
          
          <div className="flex items-center justify-center space-x-4">
            {isActive ? (
              <button
                type="button"
                onClick={disconnect}
                className="bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-black py-3 px-8 rounded-full flex items-center space-x-2.5 transition-all shadow-lg hover:scale-105 active:scale-95 cursor-pointer relative"
              >
                <PhoneOff className="w-4 h-4 stroke-[2.5]" />
                <span>DISCONNECT SEAMLESS</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={state === "connecting"}
                onClick={connect}
                className="bg-[#c4f500] hover:bg-[#a9d400] text-[#0a3641] font-mono text-xs font-black py-4 px-10 rounded-full flex items-center space-x-2.5 transition-all shadow-lg hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50 relative"
              >
                <PhoneCall className="w-4.5 h-4.5 stroke-[2.5]" />
                <span>DIAL IN ADITI (LIVE CALL)</span>
              </button>
            )}
          </div>

          <p className="text-[9px] font-mono tracking-wide text-teal-100/40 text-center">
            {isActive ? "Audio-to-audio is active. Feel free to interrupt or ask questions!" : "Using Gemini Live Multimodal streaming for direct audio response."}
          </p>
        </div>

      </div>

    </div>
  );
};
