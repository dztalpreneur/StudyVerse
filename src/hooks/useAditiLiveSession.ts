// useAditiLiveSession.ts
// Decoupled voice session hook for Aditi, implementing standard AudioStreamer calls separately

import { useState, useRef, useEffect, useCallback } from "react";
import { AudioStreamer } from "../utils/AudioStreamer";
import { LiveTranscription } from "../types";

export type AditiState = "disconnected" | "connecting" | "idle" | "listening" | "speaking" | "error";

interface UseAditiLiveSessionProps {
  onToast: (message: string, type: "info" | "success" | "error") => void;
}

export function useAditiLiveSession({ onToast }: UseAditiLiveSessionProps) {
  const [sessionState, setSessionState] = useState<AditiState>("disconnected");
  const [userVolume, setUserVolume] = useState<number>(0);
  const [aditiVolume, setAditiVolume] = useState<number>(0);
  const [userTranscript, setUserTranscript] = useState<LiveTranscription>({ text: "", finished: true });
  const [aditiTranscript, setAditiTranscript] = useState<LiveTranscription>({ text: "", finished: true });

  const wsRef = useRef<WebSocket | null>(null);
  const streamerRef = useRef<AudioStreamer | null>(null);
  const aditiTurnIdRef = useRef<string | null>(null);

  // Lazy initialize streamer instance
  const getStreamer = (): AudioStreamer => {
    if (!streamerRef.current) {
      streamerRef.current = new AudioStreamer();
    }
    return streamerRef.current;
  };

  // Instantly halts audio output schedule
  const stopAditiPlayback = useCallback(() => {
    if (streamerRef.current) {
      streamerRef.current.stopPlayback();
    }
    setAditiVolume(0);
  }, []);

  // Safe and graceful session teardown
  const disconnectAditi = useCallback(() => {
    setSessionState("disconnected");
    
    if (streamerRef.current) {
      streamerRef.current.destroy();
      streamerRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }

    setUserVolume(0);
    setAditiVolume(0);
    setUserTranscript({ text: "", finished: true });
    setAditiTranscript({ text: "", finished: true });
    aditiTurnIdRef.current = null;
  }, []);

  // Receive server message
  const handleServerMessage = useCallback(
    async (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        // Play/Schedule Audio chunks
        if (msg.type === "audio" && msg.data) {
          setSessionState("speaking");
          const streamer = getStreamer();
          await streamer.playAudioChunk(msg.data, () => {
            // Callback when single queued chunk ends
            if (streamer.getPlaybackVolume() === 0) {
              setSessionState((prev) => (prev === "speaking" ? "idle" : prev));
              setAditiVolume(0);
            }
          });
        }

        // Interruption
        else if (msg.type === "interrupted") {
          console.log("[Aditi Hook] Assistant interrupted by user voice.");
          stopAditiPlayback();
          setSessionState("listening");
          setAditiTranscript((prev) => ({ ...prev, finished: true }));
          aditiTurnIdRef.current = null;
        }

        // Transcriptions (Input)
        else if (msg.type === "inputTranscription") {
          setUserTranscript({
            text: msg.text,
            finished: msg.finished,
          });
        }

        // Transcriptions (Output)
        else if (msg.type === "outputTranscription") {
          if (!aditiTurnIdRef.current) {
            aditiTurnIdRef.current = "aditi-" + Math.random().toString(36).substring(2, 11);
            setAditiTranscript({
              text: msg.text,
              finished: msg.finished,
              id: aditiTurnIdRef.current,
            });
          } else {
            setAditiTranscript((prev) => {
              const currentId = aditiTurnIdRef.current || prev.id;
              const originalText = prev.id === currentId ? prev.text : "";
              return {
                text: originalText + msg.text,
                finished: msg.finished,
                id: currentId!,
              };
            });
          }

          if (msg.finished) {
            aditiTurnIdRef.current = null;
          }

          if (!msg.finished) {
            setSessionState("speaking");
          }
        }

        // Socket ready handshaked
        else if (msg.type === "ready") {
          console.log("[Aditi Hook] Handshake completed.");
          setSessionState("idle");
          onToast("Aditi is online! Start speaking with her whenever you're ready. 🌸", "success");
        }

        // Explicit disconnection or error
        else if (msg.type === "disconnected" || msg.type === "error") {
          console.warn("[Aditi Hook] Connection finished/errored:", msg.error);
          disconnectAditi();
          if (msg.type === "error") {
            onToast(msg.error || "A connection fault occurred with Aditi.", "error");
          }
        }
      } catch (err) {
        console.error("[Aditi Hook] Error processing server packet:", err);
      }
    },
    [onToast, stopAditiPlayback, disconnectAditi]
  );

  // Connect
  const connectAditi = async () => {
    if (sessionState !== "disconnected") return;

    setSessionState("connecting");
    onToast("Connecting with Aditi...", "info");

    try {
      const streamer = getStreamer();

      // Setup WebSocket
      const isHttps = window.location.protocol === "https:";
      const wsProtocol = isHttps ? "wss:" : "ws:";
      const targetHost = window.location.host;
      const wsUrl = `${wsProtocol}//${targetHost}/api/concierge`;

      console.log("[Aditi Hook] Opening WebSocket stream for Aditi:", wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = handleServerMessage;
      ws.onclose = () => {
        console.log("[Aditi Hook] WebSocket closed.");
        disconnectAditi();
      };
      ws.onerror = (e) => {
        console.error("[Aditi Hook] WebSocket error:", e);
        setSessionState("error");
        onToast("Aditi connection interrupted. Please try again! 🎙️", "error");
        disconnectAditi();
      };

      // Handle raw mic recording streams
      await streamer.startRecording(
        (base64PCM) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "audio",
                data: base64PCM,
              })
            );
          }
        },
        (micVolume) => {
          setUserVolume(micVolume);
          // Auto transition state to listening if mic is capturing high volume output
          if (micVolume > 0.02) {
            setSessionState((prev) => (prev === "idle" ? "listening" : prev));
          }
        }
      );

      // Web Socket keepalive Ping loop
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);

      ws.addEventListener("close", () => clearInterval(pingInterval));

    } catch (err: any) {
      console.error("[Aditi Hook] Mic authorization or connection failed:", err);
      setSessionState("error");
      onToast(err.message || "Failed starting your microphone. Please grant permission.", "error");
      disconnectAditi();
    }
  };

  // Speaker nodes real-time feedback volume loop
  useEffect(() => {
    let animId: number;
    const monitorVolume = () => {
      if (streamerRef.current && sessionState === "speaking") {
        const vol = streamerRef.current.getPlaybackVolume();
        setAditiVolume(vol);
      } else {
        setAditiVolume(0);
      }
      animId = requestAnimationFrame(monitorVolume);
    };
    monitorVolume();
    return () => cancelAnimationFrame(animId);
  }, [sessionState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectAditi();
    };
  }, [disconnectAditi]);

  return {
    state: sessionState,
    userVolume,
    aditiVolume,
    userTranscript,
    aditiTranscript,
    connect: connectAditi,
    disconnect: disconnectAditi,
  };
}
