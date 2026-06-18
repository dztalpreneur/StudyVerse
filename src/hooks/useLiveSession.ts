import { useState, useRef, useEffect, useCallback } from "react";
import { SessionState, ThemeType, LiveTranscription } from "../types";

interface UseLiveSessionProps {
  onThemeChange: (theme: ThemeType) => void;
  onToast: (message: string, type: "info" | "success" | "error") => void;
  onNextTopic?: () => void;
  onClassComplete?: () => void;
  onTeachingPhaseChange?: (phase: string) => void;
  onUpdateWhiteboard?: (content: string, append: boolean) => void;
  studentName?: string;
  grade?: string;
  board?: string;
  mediumOfLearning?: string;
  subject?: string;
  activeTopicIndex?: number;
}

export function useLiveSession({ 
  onThemeChange, 
  onToast, 
  onNextTopic, 
  onClassComplete, 
  onTeachingPhaseChange, 
  onUpdateWhiteboard,
  studentName,
  grade,
  board,
  mediumOfLearning,
  subject,
  activeTopicIndex
}: UseLiveSessionProps) {
  const [sessionState, setSessionState] = useState<SessionState>("disconnected");
  const sessionStateRef = useRef<SessionState>("disconnected");
  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  const [teachingPhase, setTeachingPhase] = useState<string>("intro");
  
  const teachingPhaseRef = useRef<string>("intro");
  useEffect(() => {
    teachingPhaseRef.current = teachingPhase;
  }, [teachingPhase]);
  
  const nextTopicRef = useRef(onNextTopic);
  const classCompleteRef = useRef(onClassComplete);
  const updateWhiteboardRef = useRef(onUpdateWhiteboard);
  const lastActiveTopicIndexRef = useRef<number | undefined>(activeTopicIndex);

  useEffect(() => {
    nextTopicRef.current = onNextTopic;
  }, [onNextTopic]);

  useEffect(() => {
    classCompleteRef.current = onClassComplete;
  }, [onClassComplete]);

  useEffect(() => {
    updateWhiteboardRef.current = onUpdateWhiteboard;
  }, [onUpdateWhiteboard]);

  useEffect(() => {
    lastActiveTopicIndexRef.current = activeTopicIndex;
  }, [activeTopicIndex]);
  
  // Realtime floating volume visualizer floats (0.0 to 1.0)
  const [userVolume, setUserVolume] = useState<number>(0);
  const [cherryVolume, setCherryVolume] = useState<number>(0);
  const [isMicActive, setIsMicActive] = useState<boolean>(true);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  
  // Transcriptions for floating subtitles
  const [userTranscript, setUserTranscript] = useState<LiveTranscription>({ text: "", finished: true });
  const [cherryTranscript, setCherryTranscript] = useState<LiveTranscription>({ text: "", finished: true });

  const wsRef = useRef<WebSocket | null>(null);
  const cherryTurnIdRef = useRef<string | null>(null);
  
  // Web Audio Contexts
  const micCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  
  // Nodes
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  
  // Speaker state Scheduling
  const activeSources = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);
  
  // Volume stabilization
  const userVolSmoothed = useRef<number>(0);
  const cherryVolSmoothed = useRef<number>(0);

  // Helper: helper function to compute PCM16 output back to standard Float32
  const pcm16ToFloat32 = (buffer: ArrayBuffer): Float32Array => {
    const view = new DataView(buffer);
    const length = buffer.byteLength / 2;
    const result = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const val = view.getInt16(i * 2, true);
      result[i] = val / 32768.0;
    }
    return result;
  };

  // Helper: convert binary array buffer safely to Base64 string
  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Stop playback instantly on interruption
  const stopPlayback = useCallback(() => {
    // Stop all active audio speaker sources
    activeSources.current.forEach((src) => {
      try {
        src.stop();
      } catch (e) {
        // Suppress if already stopped
      }
    });
    activeSources.current = [];
    nextStartTimeRef.current = 0;
    setCherryVolume(0);
    cherryVolSmoothed.current = 0;
  }, []);

  // Shutdown hook session safely
  const disconnectSession = useCallback(() => {
    setSessionState("disconnected");
    
    // Stop mic stream track
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    // Disconnect processors
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (e) {}
      processorRef.current = null;
    }

    // Stop audio playback
    stopPlayback();

    // Close contexts
    if (micCtxRef.current) {
      try { micCtxRef.current.close(); } catch (e) {}
      micCtxRef.current = null;
    }
    if (playbackCtxRef.current) {
      try { playbackCtxRef.current.close(); } catch (e) {}
      playbackCtxRef.current = null;
    }

    // Disconnect WebSockets
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }

    setUserVolume(0);
    userVolSmoothed.current = 0;
    
    // Reset live transcripts
    setUserTranscript({ text: "", finished: true });
    setCherryTranscript({ text: "", finished: true });
    cherryTurnIdRef.current = null;
  }, [stopPlayback]);

  // Handle server JSON messages
  const handleServerMessage = useCallback(
    async (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        // A. Gemini is speaking
        if (msg.type === "audio" && msg.data) {
          // Playback context lazy initialization
          if (!playbackCtxRef.current) return;
          const ctx = playbackCtxRef.current;
          
          if (ctx.state === "suspended") {
            await ctx.resume();
          }

          setSessionState("speaking");

          // Convert PCM byte array data to playable Float32Array
          const binary = atob(msg.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const float32Data = pcm16ToFloat32(bytes.buffer);

          // Build context buffer
          const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000);
          audioBuffer.getChannelData(0).set(float32Data);

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          
          if (playbackAnalyserRef.current) {
            source.connect(playbackAnalyserRef.current);
          } else {
            source.connect(ctx.destination);
          }

          // Schedule gapless playback
          const currentTime = ctx.currentTime;
          if (nextStartTimeRef.current < currentTime) {
            nextStartTimeRef.current = currentTime + 0.05; // 50ms startup smoothing pad
          }

          source.start(nextStartTimeRef.current);

          // Track active nodes
          activeSources.current.push(source);
          source.onended = () => {
            activeSources.current = activeSources.current.filter((s) => s !== source);
            // Transition back to idle if speak queue goes dry
            if (activeSources.current.length === 0) {
              setSessionState((prev) => (prev === "speaking" ? "idle" : prev));
              setCherryVolume(0);
              cherryVolSmoothed.current = 0;
            }
          };

          nextStartTimeRef.current += audioBuffer.duration;
        }

        // B. Gemini got interrupted by user voice
        else if (msg.type === "interrupted") {
          console.log("[Client Hook] Gemini speaker interrupted.");
          stopPlayback();
          setSessionState("listening");
          // Keep accumulated text on interruption, just mark it as finished
          setCherryTranscript((prev) => {
            if (prev.id && prev.id === cherryTurnIdRef.current) {
              return { ...prev, finished: true };
            }
            return prev;
          });
          cherryTurnIdRef.current = null;
        }

        // C. Gemini triggered tool execution block
        else if (msg.type === "toolCall") {
          const { toolCall } = msg;
          if (!toolCall || !toolCall.functionCalls) return;

          for (const fc of toolCall.functionCalls) {
            const { name, args, id } = fc;
            console.log("[Client Hook] Executing Cherry action:", name, args);

            let toolResult: any = { success: true };

            if (name === "openWebsite") {
              try {
                let targetUrl = args.url;
                if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
                  targetUrl = "https://" + targetUrl;
                }
                window.open(targetUrl, "_blank");
                onToast(`Launching ${args.name || "requested page"}! 🚀`, "success");
                toolResult = { success: true, status: "opened", url: targetUrl };
              } catch (err: any) {
                console.error("openWebsite failed:", err);
                toolResult = { success: false, error: err.message };
                onToast("Darn, I couldn't open that tab! Check permissions.", "error");
              }
            } else if (name === "changeTheme") {
              try {
                onThemeChange(args.theme);
                onToast(`Changed style dashboard to '${args.theme}'! 🎨`, "info");
                toolResult = { success: true, theme: args.theme };
              } catch (err: any) {
                toolResult = { success: false, error: err.message };
              }
            } else if (name === "moveToNextTopic") {
              try {
                if (nextTopicRef.current) {
                  nextTopicRef.current();
                  toolResult = { success: true, message: "Successfully transitioned the classroom slide to next topic." };
                } else {
                  console.warn("[Client Hook] onNextTopic callback is not registered.");
                  toolResult = { success: false, error: "onNextTopic callback not registered on front-end" };
                }
              } catch (err: any) {
                console.error("[Client Hook] moveToNextTopic trigger failed:", err);
                toolResult = { success: false, error: err.message };
              }
            } else if (name === "classIsComplete") {
              try {
                if (classCompleteRef.current) {
                  classCompleteRef.current();
                  toolResult = { success: true, message: "Class graduation sequence completed successfully." };
                } else {
                  console.warn("[Client Hook] onClassComplete callback is not registered.");
                  toolResult = { success: false, error: "onClassComplete callback not registered on front-end" };
                }
              } catch (err: any) {
                console.error("[Client Hook] classIsComplete trigger failed:", err);
                toolResult = { success: false, error: err.message };
              }
            } else if (name === "setTeachingState") {
              try {
                let phase = (args.phase || "intro").toLowerCase();
                if (phase === "explaining" || phase === "explanation" || phase === "explain" || phase === "explanating") {
                  phase = "example";
                }
                const curPhase = (teachingPhaseRef.current || "intro").toLowerCase();
                
                const validPhases = ["intro", "concept", "example", "doubt", "transition", "complete"];
                let isValid = validPhases.includes(phase);

                let sequenceValid = true;
                let expectedNext = "";
                
                const topicChanged = activeTopicIndex !== undefined && lastActiveTopicIndexRef.current !== activeTopicIndex;
                if (topicChanged) {
                  lastActiveTopicIndexRef.current = activeTopicIndex;
                }

                if (isValid && curPhase !== phase) {
                  // We do not allow bypassing/skipping unless we are initially restoring
                  // Define the strict next transitions map which encourages standard progressions but allows realistic teaching loops and resets
                  const nextMap: Record<string, string[]> = {
                    intro: ["concept", "intro"],
                    concept: ["example", "intro"],
                    example: ["doubt", "concept", "intro"],
                    doubt: ["transition", "complete", "intro"],
                    transition: ["intro", "complete"],
                    complete: ["intro", "concept", "example", "doubt", "transition", "complete"] // allow reset if restarting
                  };
                  
                  const allowedNext = [...(nextMap[curPhase] || [])];
                  if (topicChanged) {
                    allowedNext.push("intro", "concept");
                  }

                  if (!allowedNext.includes(phase)) {
                    sequenceValid = false;
                    expectedNext = allowedNext.join(" or ");
                  }
                }

                if (!isValid) {
                  const errorMsg = `Invalid teaching state: '${phase}'. Allowed phases are: intro, concept, example, doubt, transition, complete.`;
                  console.warn("[Client Hook]", errorMsg);
                  toolResult = { success: false, error: errorMsg };
                } else if (!sequenceValid) {
                  const errorMsg = `Sequence violation! You cannot transit directly from '${curPhase}' to '${phase}'. You MUST follow the absolute sequential workflow: intro -> concept -> example -> doubt -> transition -> intro. Your current state is '${curPhase}', so your NEXT transition MUST be setTeachingState with phase='${expectedNext}'. Please call setTeachingState for the correct next phase!`;
                  console.warn("[Client Hook]", errorMsg);
                  toolResult = { success: false, error: errorMsg };
                } else {
                  console.log(`[Client Hook] Phase transition: ${curPhase} -> ${phase}`);
                  setTeachingPhase(phase);
                  teachingPhaseRef.current = phase;
                  if (onTeachingPhaseChange) {
                    onTeachingPhaseChange(phase);
                  }
                  toolResult = { success: true, phase };
                }
              } catch (err: any) {
                console.error("[Client Hook] setTeachingState trigger failed:", err);
                toolResult = { success: false, error: err.message };
              }
            } else if (name === "updateWhiteboard") {
              try {
                const content = args.content || "";
                const append = !!args.append;
                if (updateWhiteboardRef.current) {
                  updateWhiteboardRef.current(content, append);
                  toolResult = { success: true, message: "Whiteboard updated successfully" };
                } else {
                  console.warn("[Client Hook] onUpdateWhiteboard callback not registered.");
                  toolResult = { success: false, error: "onUpdateWhiteboard callback not registered" };
                }
              } catch (err: any) {
                console.error("[Client Hook] updateWhiteboard trigger failed:", err);
                toolResult = { success: false, error: err.message };
              }
            }

            // Immediately post response back to socket
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: "toolResponse",
                  id,
                  name,
                  response: toolResult,
                })
              );
            }
          }
        }

        // D. Captions: Input transcription
        else if (msg.type === "inputTranscription") {
          setUserTranscript({
            text: msg.text,
            finished: msg.finished,
          });
        }

        // E. Captions: Output transcription
        else if (msg.type === "outputTranscription") {
          if (!cherryTurnIdRef.current) {
            cherryTurnIdRef.current = "cherry-" + Math.random().toString(36).substring(2, 11);
            setCherryTranscript({
              text: msg.text,
              finished: msg.finished,
              id: cherryTurnIdRef.current,
            });
          } else {
            setCherryTranscript((prev) => {
              const currentId = cherryTurnIdRef.current || prev.id;
              const originalText = prev.id === currentId ? prev.text : "";
              return {
                text: originalText + msg.text,
                finished: msg.finished,
                id: currentId!,
              };
            });
          }

          if (msg.finished) {
            cherryTurnIdRef.current = null;
          }

          // Avoid clearing the screen completely if transcribing continuous turns
          if (!msg.finished) {
            setSessionState("speaking");
          }
        }

        // F. Socket bidi connected successfully
        else if (msg.type === "ready") {
          console.log("[Client Hook] Handshake completed with Gemini Live!");
          setSessionState("idle");
          onToast("Cherry's online! Start talking whenever you're ready. 😘", "success");
        }

        // G. Restore session backup phase
        else if (msg.type === "restoreState") {
          if (msg.teachingPhase) {
            console.log("[Client Hook] Restoring teaching phase state to:", msg.teachingPhase);
            setTeachingPhase(msg.teachingPhase);
            if (onTeachingPhaseChange) {
              onTeachingPhaseChange(msg.teachingPhase);
            }
          }
          if (msg.whiteboardNotes && updateWhiteboardRef.current) {
            console.log("[Client Hook] Restoring whiteboard notes:", msg.whiteboardNotes.length);
            updateWhiteboardRef.current(msg.whiteboardNotes, false);
          }
        }

        // G. Error in socket stream
        else if (msg.type === "error") {
          console.error("[Client Hook] Server error:", msg.error);
          setSessionState("error");
          onToast(msg.error || "A connection fault occurred.", "error");
        }
      } catch (err) {
        console.error("[Client Hook] WS process message failed:", err);
      }
    },
    [onThemeChange, onToast, stopPlayback]
  );

  // Initialize and connect to full-stack WebSocket
  const connectSession = async () => {
    if (sessionState !== "disconnected") return;

    setSessionState("connecting");
    onToast("Connecting to Cherry...", "info");

    let stream: MediaStream | null = null;
    let micCtx: AudioContext | null = null;
    let scriptProcessor: ScriptProcessorNode | null = null;
    let fallbackMic = false;

    // 1. Try to open microphone streaming node
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setIsMicActive(true);
    } catch (micErr: any) {
      console.warn("[Client Hook] Microphone access denied or failed. Operating in Speaker-Only mode:", micErr);
      fallbackMic = true;
      setIsMicActive(false);
      onToast("Speaker-Only Mode active! (Mic access blocked or failed). You can still listen and type questions below! 🔊💬", "info");
    }

    try {
      // 2. Initialize Web Audio Contexts
      if (!fallbackMic && stream) {
        // Setup separate recording Context at exactly 16000Hz to force automatic browser resampling
        micCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 16000,
        });
        micCtxRef.current = micCtx;
        if (micCtx.state === "suspended") await micCtx.resume();

        const sourceNode = micCtx.createMediaStreamSource(stream);
        
        // Capturing PCM 16kHz
        scriptProcessor = micCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = scriptProcessor;

        sourceNode.connect(scriptProcessor);
        scriptProcessor.connect(micCtx.destination);
      }

      const playbackCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      playbackCtxRef.current = playbackCtx;
      if (playbackCtx.state === "suspended") await playbackCtx.resume();

      // Master output level analyzer
      const analyser = playbackCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(playbackCtx.destination);
      playbackAnalyserRef.current = analyser;

      // 3. Mount WebSocket connection
      const isHttps = window.location.protocol === "https:";
      const wsProtocol = isHttps ? "wss:" : "ws:";
      const targetHost = window.location.host;
      
      const params = new URLSearchParams();
      if (grade) params.append("grade", grade);
      if (board) params.append("board", board);
      if (mediumOfLearning) params.append("mediumOfLearning", mediumOfLearning);
      if (studentName) params.append("studentName", studentName);
      if (subject) params.append("subject", subject);
      if (typeof activeTopicIndex === "number") params.append("activeTopicIndex", String(activeTopicIndex));
      
      const wsUrl = `${wsProtocol}//${targetHost}/api/live?${params.toString()}`;

      console.log("[Client Hook] Connecting to WebSocket stream:", wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = handleServerMessage;
      
      ws.onclose = (ev) => {
        console.log("[Client Hook] WebSocket connection closed.", ev);
        disconnectSession();
      };

      ws.onerror = (err) => {
        console.error("[Client Hook] WebSocket error:", err);
        setSessionState("error");
        onToast("Mic socket disconnected. Is server running?", "error");
      };

      // 4. Processing mic callbacks (only if mic was successfully started!)
      if (scriptProcessor && ws) {
        scriptProcessor.onaudioprocess = (e) => {
          const floatData = e.inputBuffer.getChannelData(0);

          // Compute Mic dynamic volume
          let sum = 0;
          for (let i = 0; i < floatData.length; i++) {
            sum += floatData[i] * floatData[i];
          }
          const rms = Math.sqrt(sum / floatData.length);
          userVolSmoothed.current = userVolSmoothed.current * 0.75 + rms * 0.25;
          setUserVolume(userVolSmoothed.current);

          // Set visual states based on volume activity threshold
          if (rms > 0.02) {
            setSessionState((prev) => {
              if (prev === "idle") {
                return "listening";
              }
              return prev;
            });
          }

          // Convert F32 to standard Int16 signed binary PCM buffer
          const pcm16Buffer = new Int16Array(floatData.length);
          for (let i = 0; i < floatData.length; i++) {
            const sample = Math.max(-1, Math.min(1, floatData[i]));
            pcm16Buffer[i] = sample < 0 ? sample * 32768 : sample * 32767;
          }

          // Push standard Base64 chunks inside WS live socket
          if (ws.readyState === WebSocket.OPEN) {
            // Software Auto-Mute during Board Writing Phase ("concept") to prevent backend synchronization & tool interruptions ONLY while Cherry is actively speaking
            if ((teachingPhaseRef.current || "intro").toLowerCase() === "concept" && sessionStateRef.current === "speaking") {
              return;
            }
            const base64Str = arrayBufferToBase64(pcm16Buffer.buffer);
            ws.send(
              JSON.stringify({
                type: "audio",
                data: base64Str,
              })
            );
          }
        };
      }

      // Setup websocket keepalive Ping interval every 15s to keep container connection fresh
      const interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);

      // Save key interval cleanup callback
      ws.addEventListener("close", () => clearInterval(interval));

    } catch (err: any) {
      console.error("[Client Hook] Failed opening mic or web socket session:", err);
      setSessionState("error");
      onToast(err.message || "Failed initializing audio streams. Make sure standard speaker permissions are allowed.", "error");
      disconnectSession();
    }
  };

  // Safe release on unmount
  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  // Pitch/Volume visual output monitor loop
  useEffect(() => {
    let animId: number;
    const bufferLength = 128;
    const dataArray = new Uint8Array(bufferLength);

    const updateVolume = () => {
      if (playbackAnalyserRef.current && sessionState === "speaking") {
        playbackAnalyserRef.current.getByteTimeDomainData(dataArray);
        
        // Calculate root-mean-square (RMS) of output signal
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = (dataArray[i] - 128) / 128; // Normalize to [-1.0, 1.0]
          sum += v * v;
        }
        const rms = Math.sqrt(sum / bufferLength);
        
        // Apply responsive smoothing filter
        cherryVolSmoothed.current = cherryVolSmoothed.current * 0.75 + rms * 0.25;
        
        // Avoid setting state unnecessarily if value is trace small
        const targetVol = cherryVolSmoothed.current > 0.002 ? cherryVolSmoothed.current : 0;
        setCherryVolume(targetVol);
      } else {
        setCherryVolume((prev) => {
          if (prev !== 0) {
            return 0;
          }
          return prev;
        });
        cherryVolSmoothed.current = 0;
      }
      animId = requestAnimationFrame(updateVolume);
    };

    updateVolume();
    return () => cancelAnimationFrame(animId);
  }, [sessionState]);

  const injectPromptText = useCallback((text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "injectPrompt",
          text,
        })
      );
    }
  }, []);

  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && typeof activeTopicIndex === "number") {
      console.log("[Client Hook] Syncing active topic index with server:", activeTopicIndex);
      wsRef.current.send(JSON.stringify({ type: "syncActiveTopic", activeTopicIndex }));
    }
  }, [activeTopicIndex]);

  return {
    state: sessionState,
    userVolume,
    cherryVolume,
    userTranscript,
    cherryTranscript,
    connect: connectSession,
    disconnect: disconnectSession,
    stopPlayback,
    injectPromptText,
    isMicActive,
    teachingPhase,
    setTeachingPhase,
  };
}
