import React, { useState, useEffect } from "react";
import { Camera, X, Sparkles, AlertCircle, Save, CheckCircle2 } from "lucide-react";
import { db, auth } from "../lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

interface SaveSnapshotModalProps {
  onClose: () => void;
  onSuccess: (message: string) => void;
  activeSubject: string;
}

export const SaveSnapshotModal: React.FC<SaveSnapshotModalProps> = ({
  onClose,
  onSuccess,
  activeSubject
}) => {
  const [topicTitle, setTopicTitle] = useState(`${activeSubject} - Lecture Concept`);
  const [description, setDescription] = useState("Discussed active math derivations and chalkboard notes on this topic today with Cherry Ma'am.");
  const [isCapturing, setIsCapturing] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [capturedImg, setCapturedImg] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const currentUser = auth.currentUser;

  // Render HTML element to a compressed Base64 JPEG via html2canvas
  const captureWhiteboard = async () => {
    setIsCapturing(true);
    setCaptureError(null);
    try {
      // Ensure html2canvas CDN script is loaded
      const html2canvas = await new Promise<any>((resolve, reject) => {
        if ((window as any).html2canvas) {
          resolve((window as any).html2canvas);
          return;
        }
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
        script.onload = () => resolve((window as any).html2canvas);
        script.onerror = () => reject(new Error("Failed to load screenshot software. Check your network."));
        document.head.appendChild(script);
      });

      const element = document.getElementById("chalkboard-main-slate");
      if (!element) {
        throw new Error("Whiteboard container not found. Make sure classroom is open.");
      }

      // Hide temporary items during snapshot to keep chalkboard clean
      const canvas = await html2canvas(element, {
        useCORS: true,
        backgroundColor: "#0c201a",
        scale: 1, // Capture at 1x to keep data size ultra light
        scrollX: 0,
        scrollY: 0,
        logging: false
      });

      // Compress and Downscale the canvas to extremely light Base64 JPEG (fits perfectly inside Firestore Document limits)
      const maxW = 480; // Small width is perfect for preview thumbnails
      let w = canvas.width;
      let h = canvas.height;
      if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = maxW;
      }

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = w;
      tempCanvas.height = h;
      const ctx = tempCanvas.getContext("2d");
      if (ctx) {
        // Draw chalkboard dark background
        ctx.fillStyle = "#0c201a";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(canvas, 0, 0, w, h);
      }

      const compressedBase64 = tempCanvas.toDataURL("image/jpeg", 0.70); // High compression for fast DB sync and tiny payload
      setCapturedImg(compressedBase64);
    } catch (err: any) {
      console.error("Snapshot error:", err);
      setCaptureError(err.message || "Whiteboard capture failed.");
    } finally {
      setIsCapturing(false);
    }
  };

  useEffect(() => {
    // Take screenshot immediately on mount
    setTimeout(() => {
      captureWhiteboard();
    }, 400);
  }, []);

  const handleSaveToProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !capturedImg) return;

    setIsSaving(true);
    try {
      const snapshotId = `snap_${Date.now()}`;
      const snapRef = collection(db, "studentProfiles", currentUser.uid, "boardSnapshots");
      
      await addDoc(snapRef, {
        snapshotId,
        userId: currentUser.uid,
        topicTitle: topicTitle.trim(),
        description: description.trim(),
        imgData: capturedImg,
        timestamp: serverTimestamp()
      });

      onSuccess(`Chalkboard snapshot saved to your student account section! ☁️📸`);
      onClose();
    } catch (err: any) {
      console.error("Firestore save error:", err);
      setCaptureError(`Could not save snapshot to cloud database: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-chalk-fade">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-teal-100 overflow-hidden flex flex-col text-left">
        
        {/* Header */}
        <div className="bg-[#0a3641] p-4 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-mono uppercase tracking-wider font-extrabold text-[#c4f500]">
            <Camera className="w-4 h-4 animate-pulse" />
            <span>Save whiteboard screenshot</span>
          </div>
          <button 
            onClick={onClose}
            className="text-teal-100 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <form onSubmit={handleSaveToProfile} className="p-5 space-y-4">
          
          {/* Snapshot Thumbnail Preview */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono text-[#486a73] uppercase font-bold block">Whiteboard Snapshot Preview</span>
            <div className="h-36 bg-[#0c201a] rounded-xl border border-teal-900/20 relative overflow-hidden flex items-center justify-center">
              {isCapturing ? (
                <div className="flex flex-col items-center justify-center space-y-2 text-teal-400">
                  <span className="animate-spin text-lg">📸</span>
                  <span className="text-[9px] font-mono uppercase tracking-widest font-bold">Scanning Blackboard...</span>
                </div>
              ) : captureError ? (
                <div className="flex items-center gap-2 text-rose-450 text-xs px-4 text-center">
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                  <p className="font-mono text-[10px] text-zinc-300">{captureError}</p>
                </div>
              ) : capturedImg ? (
                <img 
                  src={capturedImg} 
                  alt="Board Thumbnail" 
                  className="w-full h-full object-contain filter brightness-110"
                  referrerPolicy="no-referrer"
                />
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-mono text-[#486a73] uppercase font-bold block">Topic Title / विषय का शीर्षक</label>
            <input 
              type="text" 
              required
              value={topicTitle}
              onChange={(e) => setTopicTitle(e.target.value)}
              placeholder="E.g., Newton's Second Law Formula..." 
              className="w-full bg-[#f7f9f6] border border-[#dae1dd] focus:border-[#0a3641] focus:ring-1 focus:ring-[#0a3641]/10 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-mono text-[#486a73] uppercase font-bold block">Short Description / छोटा विवरण</label>
            <textarea 
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide a quick summary or notes of what was discussed on the board..." 
              className="w-full bg-[#f7f9f6] border border-[#dae1dd] focus:border-[#0a3641] focus:ring-1 focus:ring-[#0a3641]/10 rounded-lg px-3 py-2 text-xs font-medium focus:outline-none resize-none leading-relaxed"
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2.5 pt-2 border-t border-zinc-150">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-zinc-200 hover:bg-slate-50 text-[11px] font-black uppercase text-zinc-650 rounded-xl cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || isCapturing || !capturedImg}
              className="flex-1 py-2.5 bg-[#0a3641] hover:bg-[#124e5d] disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-wider rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? "Saving..." : "Save to Profile ☁️"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
