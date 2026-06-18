import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Mic, MicOff, Power, Sparkles, ExternalLink, RefreshCw, Volume2, Info, Palette, HelpCircle, Flame, Trash2, Terminal, GraduationCap, BookOpen, Upload, FileText, User, ArrowLeft, CheckCircle, ChevronRight, LogOut, Download, Library, Youtube, Video } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useLiveSession } from "./hooks/useLiveSession";
import { compressImageIfPossible } from "./utils/imageCompressor";
import WaveVisualizer from "./components/WaveVisualizer";
import { THEME_CONFIGS, ThemeType } from "./types";
import { MathRenderer } from "./components/MathRenderer";
import { ClassroomBoard } from "./components/ClassroomBoard";
import { StudentAccountHub } from "./components/StudentAccountHub";
import { StudentOnboardingForm } from "./components/StudentOnboardingForm";
import { AnimatedChalkboardGraph } from "./components/AnimatedChalkboardGraph";
import { ConciergeAssistant } from "./components/ConciergeAssistant";
import katex from "katex";

// Firebase and Firestore integration
import { 
  db, 
  auth, 
  googleProvider, 
  OperationType, 
  handleFirestoreError 
} from "./lib/firebase";
import { 
  signInWithPopup, 
  signInAnonymously, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from "firebase/auth";
import { 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  deleteDoc,
  collection, 
  addDoc,
  query, 
  where, 
  getDocs, 
  orderBy,
  serverTimestamp
} from "firebase/firestore";

interface Toast {
  id: string;
  message: string;
  type: "info" | "success" | "error";
}

/**
 * Extract YouTube Video ID from standard, mobile, shorts, or embed URLs
 */
export function extractYoutubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

export default function App() {
  const [theme, setTheme] = useState<ThemeType>("cherry");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showTips, setShowTips] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"board" | "document">("board");
  const [isFullScreenBoard, setIsFullScreenBoard] = useState(true);
  
  // Custom screen state routing: home state -> syllabus configuration -> immersive classroom whiteboard
  const [currentScreen, setCurrentScreen] = useState<"home" | "syllabus" | "classroom">("home");
  const [studentDetails, setStudentDetails] = useState<{ name: string; grade: string; subject: string; board?: string; mediumOfLearning?: string }>({
    name: "",
    grade: "Class 10",
    subject: "Mathematics",
    board: "CBSE",
    mediumOfLearning: "Hinglish"
  });

  // --- Firebase integration states ---
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pastSessions, setPastSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showStudentAccountHub, setShowStudentAccountHub] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  // Document-driven teaching system states
  const [activeDocument, setActiveDocument] = useState<{ filename: string; mimeType: string; markdown: string; mode?: string; detectedSubject?: string } | null>(null);
  const [uploadMode, setUploadMode] = useState<"explain" | "mistake">("explain");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedButWaitingWakeup, setUploadedButWaitingWakeup] = useState(false);
  const [activeTopicIndex, setActiveTopicIndex] = useState(0);
  const [customBoardContent, setCustomBoardContent] = useState("");
  const [topicBoardsContent, setTopicBoardsContent] = useState<Record<number, string>>({});
  const [sessionSnapshots, setSessionSnapshots] = useState<any[]>([]);
  const sessionSnapshottedTopics = useRef<Set<string>>(new Set());

  // YouTube Course Explanation states
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isYoutubeLoading, setIsYoutubeLoading] = useState(false);
  const [isYtPlayerExpanded, setIsYtPlayerExpanded] = useState(true);
  const [showMobileYtPlayer, setShowMobileYtPlayer] = useState(false);

  // Parse markdown content into distinct sequential slides or topics
  const topics = useMemo(() => {
    if (!activeDocument?.markdown) return [];
    
    const raw = activeDocument.markdown;
    const lines = raw.split("\n");
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
      const sections = raw.split(/\n\s*\n+/);
      for (const sec of sections) {
        if (sec.trim()) {
          parsedTopics.push(sec.trim());
        }
      }
    }
    
    return parsedTopics;
  }, [activeDocument]);

  // Sync active syllabus document on mount with auto-retry
  useEffect(() => {
    let active = true;
    const fetchWithRetry = (retries = 5, delay = 800) => {
      fetch("/api/active-document")
        .then((res) => {
          if (!res.ok) {
            throw new Error(`HTTP error: ${res.status}`);
          }
          return res.text();
        })
        .then((text) => {
          if (text.trim().startsWith("{")) {
            return JSON.parse(text);
          }
          throw new Error("Invalid json response payload format");
        })
        .then((data) => {
          if (!active) return;
          if (data && data.activeDocument) {
            setActiveDocument(data.activeDocument);
            setActiveTopicIndex(0);
          }
        })
        .catch((err) => {
          if (!active) return;
          if (retries > 0) {
            console.warn(`[Client] Fetch active document failed, retrying in ${delay}ms... (${retries} attempts left)`);
            setTimeout(() => {
              fetchWithRetry(retries - 1, delay * 1.5);
            }, delay);
          } else {
            console.error("Error fetching active document on load after retries:", err);
          }
        });
    };

    fetchWithRetry();

    return () => {
      active = false;
    };
  }, []);

  // Subtitle history and autoscroll ASR components
  const [dialogueHistory, setDialogueHistory] = useState<Array<{ id: string; sender: "user" | "cherry"; text: string }>>([]);
  const [typedInput, setTypedInput] = useState("");
  const subtitlesScrollRef = useRef<HTMLDivElement | null>(null);

  // Trigger floating notifications
  const addToast = useCallback((message: string, type: "info" | "success" | "error") => {
    const id = Math.random().toString(36).substring(3);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // --- Firebase integration logic helpers ---

  const loadPastSessions = useCallback(async (uid: string) => {
    setSessionsLoading(true);
    try {
      const q = query(
        collection(db, "classSessions"),
        where("userId", "==", uid),
        orderBy("updatedAt", "desc")
      );
      const snapshot = await getDocs(q);
      const sessions = snapshot.docs.map(d => d.data());
      setPastSessions(sessions);
      localStorage.setItem(`pastSessions_${uid}`, JSON.stringify(sessions));
    } catch (error) {
      console.error("Error loading past sessions, falling back to local storage:", error);
      const cached = localStorage.getItem(`pastSessions_${uid}`);
      if (cached) {
        try {
          const sessions = JSON.parse(cached);
          setPastSessions(sessions);
          addToast("Loaded study activities from local cache! 🏛️📱", "info");
        } catch (_) {}
      }
    } finally {
      setSessionsLoading(false);
    }
  }, [addToast]);

  // Listen for Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
      
      if (firebaseUser) {
        try {
          const profileRef = doc(db, "studentProfiles", firebaseUser.uid);
          let profileSnap;
          try {
            profileSnap = await getDoc(profileRef);
          } catch (dbErr: any) {
            console.warn("Could not load profile from Firestore: student is offline/backend unreachable.", dbErr);
            const cachedProfile = localStorage.getItem(`studentProfile_${firebaseUser.uid}`);
            if (cachedProfile) {
              const data = JSON.parse(cachedProfile);
              setStudentDetails({
                name: data.name || "",
                grade: data.grade || "Class 10",
                subject: data.subject || "Mathematics",
                board: data.board || "CBSE",
                mediumOfLearning: data.mediumOfLearning || "Hinglish"
              });
              addToast(`Offline mode: Restored profile ${data.name}! 🏠📡`, "info");
              setCurrentScreen("syllabus");
              setShowLoginModal(false);
            } else {
              setStudentDetails((prev) => ({
                ...prev,
                name: firebaseUser.displayName || prev.name || "Student",
                board: "CBSE",
                mediumOfLearning: "Hinglish"
              }));
              setCurrentScreen("syllabus");
              setShowLoginModal(false);
            }
            loadPastSessions(firebaseUser.uid);
            return;
          }

          if (profileSnap.exists()) {
            const data = profileSnap.data();
            const profileData = {
              name: data.name || "",
              grade: data.grade || "Class 10",
              subject: data.subject || "Mathematics",
              board: data.board || "CBSE",
              mediumOfLearning: data.mediumOfLearning || "Hinglish"
            };
            setStudentDetails(profileData);
            localStorage.setItem(`studentProfile_${firebaseUser.uid}`, JSON.stringify(profileData));
            addToast(`Cloud profile restored for ${data.name}! ☁️✨`, "success");
            setCurrentScreen("syllabus");
            setShowLoginModal(false);
          } else {
            if (firebaseUser.displayName) {
              setStudentDetails((prev) => ({
                ...prev,
                name: firebaseUser.displayName || prev.name,
                board: "CBSE",
                mediumOfLearning: "Hinglish"
              }));
            }
            // Trigger onboarding flow for first-time Google sign-ins (ignores anonymous guest users)
            if (!firebaseUser.isAnonymous) {
              setShowOnboarding(true);
              setShowLoginModal(false);
            }
          }
          loadPastSessions(firebaseUser.uid);
        } catch (error) {
          console.error("Error loading student profile:", error);
        }
      } else {
        setPastSessions([]);
      }
    });

    return () => unsubscribe();
  }, [addToast, loadPastSessions]);

  const handleOnboardingSubmit = async (data: { name: string; grade: string; board: string; mediumOfLearning: string }) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error("No authenticated student session found.");
    }

    try {
      const profileData = {
        name: data.name,
        grade: data.grade,
        board: data.board,
        mediumOfLearning: data.mediumOfLearning,
        subject: studentDetails.subject || "Mathematics"
      };

      setStudentDetails(profileData);
      localStorage.setItem(`studentProfile_${currentUser.uid}`, JSON.stringify(profileData));

      setShowOnboarding(false);
      setCurrentScreen("syllabus"); 
      addToast(`Namaste, ${data.name}! Your student profile setup is complete! 🎓🎒`, "success");

      // Write to Firestore in the background
      const profileRef = doc(db, "studentProfiles", currentUser.uid);
      setDoc(profileRef, {
        userId: currentUser.uid,
        name: data.name,
        grade: data.grade,
        board: data.board,
        mediumOfLearning: data.mediumOfLearning,
        subject: studentDetails.subject || "Mathematics",
        updatedAt: serverTimestamp()
      }).then(() => {
        loadPastSessions(currentUser.uid);
      }).catch((dbErr: any) => {
        console.warn("[Onboarding] background Firestore sync issue:", dbErr);
      });
    } catch (offlineErr: any) {
      console.warn("[Onboarding] offline setup:", offlineErr);
      const offlineProfileData = {
        name: data.name,
        grade: data.grade,
        board: data.board,
        mediumOfLearning: data.mediumOfLearning,
        subject: studentDetails.subject || "Mathematics"
      };
      setStudentDetails(offlineProfileData);
      localStorage.setItem(`studentProfile_${currentUser.uid}`, JSON.stringify(offlineProfileData));
      setShowOnboarding(false);
      setCurrentScreen("syllabus");
      addToast(`Profile setup in offline/fallback mode! 🎒`, "info");
      loadPastSessions(currentUser.uid);
    }
  };

  // Google authentication triggers
  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      addToast(`Logged in successfully as ${result.user.displayName}! 🧑‍🎓✨`, "success");
    } catch (error: any) {
      addToast(`Authentication failed: ${error.message}`, "error");
    }
  };

  // Sign out triggers
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setStudentDetails({ name: "", grade: "Class 10", subject: "Mathematics", board: "CBSE", mediumOfLearning: "Hinglish" });
      setSessionId(null);
      setDialogueHistory([]);
      setCustomBoardContent("");
      setTopicBoardsContent({});
      addToast("Signed out successfully. Guest session loaded. 👋", "info");
    } catch (error: any) {
      addToast(`Sign-out failed: ${error.message}`, "error");
    }
  };

  // Persist Dialogue History messages to Firestore subcollection
  const syncedMessagesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!sessionId || !auth.currentUser) return;
    
    dialogueHistory.forEach((msg) => {
      const cacheKey = `${msg.id}_${msg.text}`;
      if (!syncedMessagesRef.current.has(cacheKey)) {
        syncedMessagesRef.current.add(cacheKey);
        
        const msgRef = doc(db, "classSessions", sessionId, "dialogueMessages", msg.id);
        setDoc(msgRef, {
          messageId: msg.id,
          sessionId: sessionId,
          sender: msg.sender,
          text: msg.text,
          timestamp: serverTimestamp()
        }).catch((err) => {
          console.warn("Dialogue message sync failure:", err);
        });
      }
    });
  }, [dialogueHistory, sessionId]);

  // Whiteboard drawings debounced save to cloud
  useEffect(() => {
    if (!sessionId || !auth.currentUser) return;
    
    const timeout = setTimeout(async () => {
      const sessionRef = doc(db, "classSessions", sessionId);
      try {
        await updateDoc(sessionRef, {
          customBoardContent: customBoardContent,
          updatedAt: serverTimestamp()
        });
      } catch (dbErr) {
        console.warn("Cloud blackboard sync failed:", dbErr);
      }
    }, 1500);

    return () => clearTimeout(timeout);
  }, [customBoardContent, sessionId]);

  // Automatically capture the whiteboard content as a snapshot for a given topic
  const autoCaptureSnapshot = useCallback(async (topicIndex: number, boardContent: string, isManual = false) => {
    const currentUser = auth.currentUser;
    if (!boardContent || !boardContent.trim()) return;

    const topicContent = topics[topicIndex] || "";
    let topicTitle = `Topic ${topicIndex + 1}`;
    let topicDescription = "Interactive whiteboard mathematical derivation or chalkboard notes.";

    if (topicContent) {
      const lines = topicContent.split("\n");
      // Find the first non-empty line as a heading candidate
      for (const line of lines) {
        const trimmed = line.replace(/[#*📌$]/g, "").trim();
        if (trimmed) {
          topicTitle = trimmed;
          break;
        }
      }
      
      // Extract a short description
      let descCandidate = "";
      for (let i = 1; i < lines.length; i++) {
        const lineVal = lines[i].replace(/[#*📌$]/g, "").trim();
        if (lineVal && lineVal.length > 8) {
          descCandidate = lineVal;
          break;
        }
      }
      if (descCandidate) {
        topicDescription = descCandidate;
      }
    }

    if (topicDescription.length > 90) {
      topicDescription = topicDescription.substring(0, 87) + "...";
    }

    // Capture unique snapshots based on topic title & content length so we don't spam duplicate snapshot calls
    const key = `${topicTitle}_${boardContent.trim().length}`;
    if (!isManual && sessionSnapshottedTopics.current.has(key)) return;
    sessionSnapshottedTopics.current.add(key);

    try {
      // Lazy load html2canvas from CDN if not already on window
      const html2canvas = await new Promise<any>((resolve, reject) => {
        if ((window as any).html2canvas) {
          resolve((window as any).html2canvas);
          return;
        }
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
        script.onload = () => resolve((window as any).html2canvas);
        script.onerror = () => reject(new Error("html2canvas download error"));
        document.head.appendChild(script);
      });

      const element = document.getElementById("chalkboard-main-slate");
      if (!element) return;

      const canvas = await html2canvas(element, {
        useCORS: true,
        backgroundColor: "#0c201a",
        scale: 1,
        scrollX: 0,
        scrollY: 0,
        logging: false
      });

      const maxW = 480;
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
        ctx.fillStyle = "#0c201a";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(canvas, 0, 0, w, h);
      }

      const imgData = tempCanvas.toDataURL("image/jpeg", 0.65);
      
      const newSnapshot = {
        id: `local_snap_${Date.now()}`,
        snapshotId: `auto_snap_${Date.now()}`,
        userId: currentUser?.uid || "guest",
        topicTitle,
        description: topicDescription,
        imgData,
        timestamp: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }
      };

      // Add to local state so guests and users have immediate access during the session
      setSessionSnapshots((prev) => [newSnapshot, ...prev]);

      if (currentUser) {
        try {
          const snapRef = collection(db, "studentProfiles", currentUser.uid, "boardSnapshots");
          await addDoc(snapRef, {
            snapshotId: newSnapshot.snapshotId,
            userId: currentUser.uid,
            topicTitle,
            description: topicDescription,
            imgData,
            timestamp: serverTimestamp()
          });
        } catch (dbErr) {
          console.warn("Could not sync snapshot to firestore database:", dbErr);
        }
      }
      
      addToast(
        isManual 
          ? `Chalkboard snapshot saved of "${topicTitle}"! 📸📘`
          : `Automatically captured whiteboard for topic: "${topicTitle}"! 📸☁️`, 
        "success"
      );
    } catch (err) {
      console.warn("Whiteboard snapshot capture failed:", err);
    }
  }, [topics, addToast]);

  // Handle manual/instant save snapshots triggered by onClick handler on active Blackboard
  const handleManualSaveSnapshot = useCallback(async () => {
    if (!customBoardContent || !customBoardContent.trim()) {
      addToast("Blackboard matches an empty slate! Write something first. 📝✍️", "warning");
      return;
    }
    await autoCaptureSnapshot(activeTopicIndex, customBoardContent, true);
  }, [activeTopicIndex, customBoardContent, autoCaptureSnapshot, addToast]);

  // Automatic snapshot trigger that takes a screenshot of the blackboard 
  // after writing stabilizes (e.g., 6 seconds of inactivity)
  useEffect(() => {
    if (!customBoardContent || !customBoardContent.trim()) return;

    const delayDebounceFn = setTimeout(() => {
      autoCaptureSnapshot(activeTopicIndex, customBoardContent);
    }, 6000); // 6 seconds debounce to ensure writing has completed

    return () => clearTimeout(delayDebounceFn);
  }, [customBoardContent, activeTopicIndex, autoCaptureSnapshot]);

  const handleLoadPastSession = async (sess: any) => {
    try {
      setSessionId(sess.sessionId);
      
      setStudentDetails((prev) => ({
        ...prev,
        grade: sess.grade || prev.grade,
        subject: sess.subject || prev.subject
      }));
      setCustomBoardContent(sess.customBoardContent || "");
      
      const messagesRef = collection(db, "classSessions", sess.sessionId, "dialogueMessages");
      const q = query(messagesRef, orderBy("timestamp", "asc"));
      const querySnap = await getDocs(q);
      const dialogueLogs = querySnap.docs.map(docSnap => {
        const item = docSnap.data();
        return {
          id: item.messageId,
          sender: item.sender as "user" | "cherry",
          text: item.text
        };
      });
      setDialogueHistory(dialogueLogs);
      
      if (sess.activeDocumentName) {
        addToast(`Loading syllabus file: "${sess.activeDocumentName}" from cloud session...`, "info");
        fetch("/api/active-document")
          .then((res) => {
            if (!res.ok) throw new Error("Network error");
            return res.text();
          })
          .then((text) => {
            if (text.trim().startsWith("{")) {
              return JSON.parse(text);
            }
            throw new Error("Invalid json format");
          })
          .then((data) => {
            if (data && data.activeDocument && data.activeDocument.filename === sess.activeDocumentName) {
              setActiveDocument(data.activeDocument);
            } else {
              setActiveDocument({
                 filename: sess.activeDocumentName,
                 mimeType: "text/markdown",
                 markdown: `# ${sess.subject} Study Session\nWelcome back to your saved classroom board! Here you can resume explaining equations or diagnostics with Cherry Ma'am.\n`
              });
            }
          })
          .catch(() => {
             setActiveDocument({
                filename: sess.activeDocumentName,
                mimeType: "text/markdown",
                markdown: `# ${sess.subject} Study Session\nWelcome back to your saved classroom board! Here you can resume explaining equations or diagnostics with Cherry Ma'am.\n`
             });
          });
      } else {
        setActiveDocument(null);
      }
      
      setCurrentScreen("classroom");
      addToast(`Restored cloud session successfully! ☁️🖊️`, "success");
    } catch (error: any) {
      addToast(`Could not restore cloud session: ${error.message}`, "error");
    }
  };

  const handleDeletePastSession = async (sessId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    
    try {
      await deleteDoc(doc(db, "classSessions", sessId));
      addToast("Cloud session deleted successfully! 🗑️", "success");
      loadPastSessions(currentUser.uid);
    } catch (dbErr) {
      handleFirestoreError(dbErr, OperationType.DELETE, `classSessions/${sessId}`);
    }
  };

  const handleThemeChange = useCallback((newTheme: ThemeType) => {
    const sanitized = (newTheme || "").toString().toLowerCase() as ThemeType;
    if (THEME_CONFIGS[sanitized]) {
      setTheme(sanitized);
    } else {
      setTheme("cherry");
    }
  }, []);

  const onNextTopicRef = useRef<() => void>();
  const onClassCompleteRef = useRef<() => void>();

  // Hook live session handlers
  const {
    state,
    userVolume,
    cherryVolume,
    userTranscript,
    cherryTranscript,
    connect,
    disconnect,
    injectPromptText,
    teachingPhase,
  } = useLiveSession({
    onThemeChange: handleThemeChange,
    onToast: addToast,
    onNextTopic: () => onNextTopicRef.current?.(),
    onClassComplete: () => onClassCompleteRef.current?.(),
    onTeachingPhaseChange: (phase) => {
      const phaseLabels: Record<string, string> = {
        intro: "Intro (Prichey) 🎒",
        concept: "Concept (Chalk Notes) 🖊️",
        example: "Deep Dive (Explanations) 🔍",
        doubt: "Doubts Solving (Sawal-Jawab) ❓",
        transition: "Transition Sequence 🚀"
      };
      addToast(`Cherry Ma'am moved to: ${phaseLabels[phase] || phase}`, "info");
    },
    onUpdateWhiteboard: (content, append) => {
      setCustomBoardContent((prev) => {
        if (append) {
          if (prev.trim() === "") return content.trim();
          return (prev + "\n\n" + content).trim();
        }
        return content.trim();
      });
    },
    studentName: studentDetails.name,
    grade: studentDetails.grade,
    board: studentDetails.board,
    mediumOfLearning: studentDetails.mediumOfLearning,
    subject: studentDetails.subject,
    activeTopicIndex: activeTopicIndex
  });

  const activeColors = THEME_CONFIGS[theme] || THEME_CONFIGS.cherry;

  // Slide player transitions and Cherry notifications (seamless, in-place, no disconnects!)
  const handleNextTopic = useCallback(() => {
    if (customBoardContent && customBoardContent.trim()) {
      autoCaptureSnapshot(activeTopicIndex, customBoardContent);
    }
    setActiveTopicIndex((prev) => {
      const nextIndex = prev + 1 < topics.length ? prev + 1 : prev;
      if (nextIndex !== prev) {
        addToast(`Syllabus screen updated to topic: Part ${nextIndex + 1}! 📖`, "info");
        setCustomBoardContent(topicBoardsContent[nextIndex] || "");
      }
      return nextIndex;
    });
  }, [topics, addToast, activeTopicIndex, customBoardContent, autoCaptureSnapshot, topicBoardsContent]);

  const handlePrevTopic = useCallback(() => {
    if (customBoardContent && customBoardContent.trim()) {
      autoCaptureSnapshot(activeTopicIndex, customBoardContent);
    }
    setActiveTopicIndex((prev) => {
      const prevIndex = prev > 0 ? prev - 1 : prev;
      if (prevIndex !== prev) {
        addToast(`Syllabus screen updated to topic: Part ${prevIndex + 1}! 📖`, "info");
        setCustomBoardContent(topicBoardsContent[prevIndex] || "");
      }
      return prevIndex;
    });
  }, [addToast, activeTopicIndex, customBoardContent, autoCaptureSnapshot, topicBoardsContent]);

  const handleClassComplete = useCallback(() => {
    disconnect();
    addToast("Congratulations! Class is complete. Cherry is heading to the staff room! 🎓🎉☕", "success");
  }, [disconnect, addToast]);

  const handleSyncBoardContent = useCallback((idx: number, content: string) => {
    setTopicBoardsContent((prev) => {
      if (prev[idx] === content) return prev;
      return {
        ...prev,
        [idx]: content
      };
    });
  }, []);

  // Synchronize customBoardContent with topics when transitioning to concept/example/doubt phases so the board displays slide contents immediately
  useEffect(() => {
    const currentPhase = (teachingPhase || "intro").toLowerCase();
    const isConceptOrLater = currentPhase === "concept" || currentPhase === "example" || currentPhase === "doubt" || currentPhase === "transition";
    
    if (isConceptOrLater && topics && topics.length > 0 && activeTopicIndex < topics.length) {
      const activeTopicText = topics[activeTopicIndex] || "";
      if (activeTopicText.trim() !== "") {
        const isCurrentlyEmptyOrIntro = !customBoardContent || 
                                        customBoardContent.trim() === "" || 
                                        customBoardContent.toLowerCase().includes("roadmap") || 
                                        customBoardContent.toLowerCase().includes("agenda");
                                        
        if (isCurrentlyEmptyOrIntro && customBoardContent !== activeTopicText) {
          console.log(`[Concept Sync Hook] Displaying Part ${activeTopicIndex + 1} contents on the blackboard.`);
          setCustomBoardContent(activeTopicText);
        }
      }
    }
  }, [teachingPhase, activeTopicIndex, topics, customBoardContent]);

  useEffect(() => {
    onNextTopicRef.current = handleNextTopic;
  }, [handleNextTopic]);

  useEffect(() => {
    onClassCompleteRef.current = handleClassComplete;
  }, [handleClassComplete]);

  // Automatically start teaching the continuous document when class connects
  const lastStateRef = useRef<string>("disconnected");
  useEffect(() => {
    if (state === "idle" && lastStateRef.current === "connecting" && activeDocument) {
      const isMistakeMode = activeDocument.mode === "mistake";
      const isYoutubeMode = activeDocument.mimeType === "video/youtube";
      
      let prompt = "";
      let toastMessage = "";
      
      if (isMistakeMode) {
        prompt = `Hello Cherry Ma'am! Main classroom me baith gaya hoon. Maine apni math/physics/chemistry calculation/notes sheet upload ki hai jiska automatic analysis ho chuka hai 'Find My Mistake' mode me. Please is document ko analyze karke, step-by-step mere calculations check karo aur batao ki maine kahan mistake ki hai. Meri mistake ko sweet aur sassy Hinglish me samjhao! Bolte samay bilkul ek real, dynamic classroom teacher ki tarah dynamic expression modulations, organic tone shifts aur periodic vocal pauses (jaise ellipses '...') ka use karna, aur beech beech me spontaneous interjections jaise "Hey, listen carefully!", "Arrey beta dhyan se dekho yaara!", "Is calculation me aksar sabhi slip karte hain..." jaisi humorous, strict-free, styling line and snappy remarks bolna.

IMPORTANT: Ensure kare Cherry Intro ke bad Concept phase me jaye, Concept phase se Explaining Phase me jaye, Explaining Phase se Doubt Phase me jaye, aur Doubt Phase se Transition Phase me jaye. Yahi sequence har transition ke baad strictly repeat ho! Kisi bhi phase ko skip ya jump karna ya do phases ko merge karna strictly forbidden hai. Har subtopic ya mistake segment par yahi cyclic serial chalta rahega. Kis phase me kya karna hai wo dhyan se samajh lijiye:
- **Phase 1: Introduction (phase='intro')**: Warm greeting dekar slide ka neat roadmap aur topic title blackboard par updateWhiteboard tool se show karein. No explanation yet!
- **Phase 2: Concept (phase='concept')**: Blackboard par active segment/mistake block ka content bilkul verbatim same-to-same type ya draw karein. Koi extra explanation ya friendly filler board par nahi hona chahiye! Keep chalk notes 100% focused on source copy.
- **Phase 3: Explaining (phase='example')**: बोर्ड पर लिखे गए थ्योरी को एक-एक कर लाइन-बाय-लाइन padhte hue sath sath line by line गहराई से समझाना, aur deep maths calculations solve karke use Hinglish me sikhayein.
- **Phase 4: Doubt Check (phase='doubt')**: Student se feedback ya interactively doubt poochte hue standard silence me pause karein.
- **Phase 5: Transition (phase='transition')**: Board ko clear ya saf na karein, purana content waisa hi rehne dein, slide badlein (moveToNextTopic), set phase to 'transition' (jis-se purani samagri upar scroll ho jaye aur board par bani rahe), aur bina ruke usi turn me agle topic/part ka Phase 1 start karein!

Start checking now with Phase 1!`;
        toastMessage = "Cherry is starting to diagnose your mistakes step-by-step! 🎙️🔍";
      } else if (isYoutubeMode) {
        prompt = `Hello Cherry Ma'am! Main classroom me baith gaya hoon. Chaliye YouTube video course ke chronological curriculum ke hisab se padhna start karte hain!
Aap is video syllabus contents ko bilkul usi exact SAME sequence, timeline flow, aur chronological order me deliver karein jis sequence me original teacher ne video me padhaya hai, taki main aapse doubts poochte samay use youtube video se aasaani se link kar saku.
- **Slower Pedagogical Delivery & natural pauses (Anti-Express Train)**: Beta, ruko... dhire-dhire padhao! Ekdum slow tempo me deliver karna aur har point/thought ke beech commas ya explicit ellipses '...' use karke 1.5 seconds ka natural verbal pause lijiye. Humorous aur expressive lines ke sath vocal attention cues use karein jo meri eyes ko blackboard ke active elements se align karein (e.g., "Acha beta, ab board par green color ke is vector point ko dhyan se dekho yaara...", "Toh chaliye is calculation ke dono sides ko solve charts hain...").

IMPORTANT: Ensure kare Cherry Intro ke bad Concept phase me jaye, Concept phase se Explaining Phase me jaye, Explaining Phase se Doubt Phase me jaye, aur Doubt Phase se Transition Phase me jaye. Yahi sequence har transition ke baad strictly repeat ho! Kisi bhi phase ko skip ya jump karna ya do phases ko merge karna strictly forbidden hai. Har subtopic ya syllabus segment par yahi cyclic serial chalta rahega. Kis phase me kya karna hai wo dhyan se samajh lijiye:
- **Phase 1: Introduction (phase='intro')**: Greet the student, deliver an incredibly attractive, fascinating teaser and overview (bhumika) of contents to spark immense interest and wonder. Write the main Topic Title and a bullet-points roadmap of key subtopics immediately on the blackboard using updateWhiteboard. Sassy welcome greeting dekar slide ka neat roadmap aur topic title blackboard par updateWhiteboard tool se show karein. No explanation yet!
- **Phase 2: Concept (phase='concept')**: Blackboard par active segment ka content bilkul verbatim same-to-same type ya draw karein. Koi extra explanation ya friendly filler board par nahi hona chahiye! Keep chalk notes 100% focused on source copy. Set phase to 'concept' first, write exact formulas, definitions & diagrams.
- **Phase 3: Explaining (phase='example')**: बोर्ड पर लिखे गए थ्योरी को एक-एक कर लाइन-बाय-लाइन padhte hue sath sath line by line गहराई से समझाना. Let's call setTeachingState with phase='example' (known as Explaining Phase) and explain it deeply.
- **Phase 4: Doubt Check (phase='doubt')**: Student se feedback ya interactively doubt poochte hue standard silence me pause karein. Ask: 'Is point me koi doubt hai, beta? Sab crystal clear?'. Wait silently for response.
- **Phase 5: Transition (phase='transition')**: Board ko clear ya saf na karein (do NOT clear), purane text ko waisa hi rehne dein, moveToNextTopic call karein, set phase to 'transition' (jis-se purani samagri upar scroll ho jaye aur board par bani rahe), aur usi turn me agle topic/part ka Phase 1 start karein!

Start teaching now with Phase 1!`;
        toastMessage = "Cherry is beginning the board-synchronized YouTube lesson! 🎙️🎥";
      } else {
        prompt = `Hello Cherry Ma'am! Main classroom me baith gaya hoon. Board par pure syllabus document ke topics load ho chuke hain. Please is document ke saare contents ko suru se le kar ant tak step-by-step aur line-by-line padhte hue student ko sweet aur sassy Indian Hinglish tone me samjhao! Lecture deliver karte samay bilkul ek authentic, live, chatty classroom teacher ki tarah dynamic voice modulation, organic tone shifts aur breathing pauses (use ellipses '...' explicitly for pauses) ke saath samjhana. Beech-beech me spontaneous sassy interjections jaise "Hey, listen carefully!", "Arrey beta dhyan se dekho!", "Is step me sabse zyada slips hote hain!" use karna. 

Strictly follow Cherry's workflow execution sequence without skipping or jumping any state. Transition linearly from Phase 1 ('intro') -> Phase 2 ('concept') -> Phase 3 ('example' / Explaining) -> Phase 4 ('doubt') -> Phase 5 ('transition'), and repeat. Ensure kare Cherry Intro ke bad Concept phase me jaye, Concept phase se Explaining Phase me jaye, Explaining Phase se Doubt Phase me jaye, aur Doubt Phase se Transition Phase me jaye. Yahi sequence har transition ke sath ho kisi bhi phase ko skip ya jump na kare, aur kis phase me cherry ko kya karna hai is chij ko achhe se cherry ko samjha diya gaya hai:

- **Phase 1: Introduction (phase='intro')**: Greet the student, deliver an incredibly attractive, fascinating teaser and overview (bhumika) of contents to spark immense interest and wonder. Write the main Topic Title and a bullet-points roadmap of key subtopics immediately on the blackboard using updateWhiteboard.
- **Phase 2: Concept (phase='concept')**: Ensure Cherry Board par exactly same to same contents type/draw kare jo uploaded document me moujud ho isase bahar ke chije ko bilkul bhi type/draw na kare. Write the actual formulas, definitions, LaTeX equations, and neon SVG vector diagrams from the active document on the blackboard. Do not start explaining yet.
- **Phase 3: Explaining (phase='example')**: बोर्ड पर लिखे गए थ्योरी को एक-एक कर लाइन-बाय-लाइन padhte hue sath sath line by line गहराई से समझाना. Read the written chalkboard content line-by-line and explain it deeply, breaking it down into simple real-world stories or step-by-step derivations in Hinglish.
- **Phase 4: Doubt Check (phase='doubt')**: Pivot to interactive check. Ask if they understood: 'Kya aapko ye concept bilkul crystal-clear ho gaya? Is point me koi doubt hai, beta?'. Wait silently for their response.
- **Phase 5: Transition (phase='transition')**: Move to the next subtopic slider, do NOT clear the chalkboard (do NOT call updateWhiteboard with empty string, preserve all content so it scrolls up), set phase to 'transition', and loop back to Phase 1 immediately.

Start teaching now with Phase 1!`;
        toastMessage = "Cherry is beginning the continuous syllabus lecture! 🎙️🎓";
      }
      
      const timer = setTimeout(() => {
        injectPromptText(prompt);
        addToast(toastMessage, "success");
      }, 1200);
      return () => clearTimeout(timer);
    }
    lastStateRef.current = state;
  }, [state, activeDocument, injectPromptText, addToast]);

  // Sync state to automatically exit the uploaded waiting screen as soon as state is active
  useEffect(() => {
    if (state !== "disconnected") {
      setUploadedButWaitingWakeup(false);
    }
  }, [state]);

  // ASR Live Dialogue Sync Logic
  useEffect(() => {
    if (cherryTranscript.text && cherryTranscript.text.trim() && cherryTranscript.id) {
      setDialogueHistory((prev) => {
        const index = prev.findIndex((item) => item.id === cherryTranscript.id);
        if (index !== -1) {
          const next = [...prev];
          next[index] = { ...next[index], text: cherryTranscript.text };
          return next;
        } else {
          return [
            ...prev,
            { id: cherryTranscript.id!, sender: "cherry", text: cherryTranscript.text },
          ];
        }
      });
    }
  }, [cherryTranscript.text, cherryTranscript.id]);

  // Keep subtitles terminal scrolled to latest subtitle
  useEffect(() => {
    if (subtitlesScrollRef.current) {
      subtitlesScrollRef.current.scrollTop = subtitlesScrollRef.current.scrollHeight;
    }
  }, [dialogueHistory, cherryTranscript.text, cherryTranscript.id]);

  const handlePowerToggle = () => {
    if (state === "disconnected") {
      setUploadedButWaitingWakeup(false);
      connect();
    } else {
      disconnect();
      addToast("Cherry Ma'am is heading to the staff room. Talk later! 📚☕", "info");
    }
  };

  // Human-friendly sass helper based on active states
  const getSubTitleText = () => {
    switch (state) {
      case "disconnected":
        return "Class is at recess. Wake up Cherry Ma'am to start studying! 🤓🎒";
      case "connecting":
        return "Cherry Ma'am is preparing today's sassy lesson slides... Brief moment... ☕📝";
      case "idle":
        return "Ask anything—Maths, Physics formulas, or poetic classics! 📐✨";
      case "listening":
        return "Tell me your query... I'm listening like an incredibly smart friend! 🧠👂";
      case "speaking":
        return "Listen closely, I'm delivering some effortless intellect! 🎙️🌟";
      case "error":
        return "Oops student, class network dropped. Let's hit reconnect... 💔🔌";
      default:
        return "Connected and ready to learn.";
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setIsUploading(true);

    const isImage = file.type && file.type.startsWith("image/");
    const isPDFOrDoc = !isImage;

    // Strict 3MB limit for PDF / raw text files to guarantee secure API Gateway transfer
    if (isPDFOrDoc && file.size > 3 * 1024 * 1024) {
      addToast(`Syllabus document size of ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds the 3MB gateway limit for non-image files. Please upload a more compact PDF or text file.`, "error");
      setIsUploading(false);
      return;
    }

    addToast(isImage ? "Optimizing calculations image..." : "Analyzing document with Gemini...", "info");

    try {
      // Compress if it's an image (resized to max 1200px, 0.70 quality to compress under ~200KB)
      // Otherwise reads normally as Data URL via FileReader fallback inside our promise utility.
      const result = await compressImageIfPossible(file, 1200, 0.70);
      if (!result) {
        throw new Error("Failed to read document contents safely.");
      }

      const splitResult = result.split(",");
      if (splitResult.length < 2) {
        throw new Error("Invalid base64 payload returned from document reader.");
      }

      const base64Data = splitResult[1];
      const payload = {
        filename: file.name,
        mimeType: file.type || "application/pdf",
        base64Data,
        mode: uploadMode,
      };

      let response: Response | null = null;
      const attempts = 3;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const res = await fetch("/api/upload-document", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          response = res;
          // Break immediately on success, or on specific handled HTTP statuses (like 413 too large or 500 server error)
          if (res.ok || res.status === 413 || res.status === 500) {
            break;
          }
          throw new Error(`Server returned HTTP status ${res.status}`);
        } catch (fetchErr: any) {
          console.warn(`Upload attempt ${attempt} failed:`, fetchErr);
          if (attempt === attempts) {
            throw fetchErr; // Out of attempts, let the outer catch deal with it
          }
          addToast(`Upload interrupted. Retrying automatically (attempt ${attempt + 1}/${attempts})...`, "info");
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Handle server-side non-ok responses (e.g. 413, 500)
      if (!response || !response.ok) {
        let errorMsg = "Internal server or gateway error during upload";
        if (response) {
          try {
            const rawText = await response.text();
            if (rawText.trim().startsWith("{")) {
              const errData = JSON.parse(rawText);
              errorMsg = errData.error || errorMsg;
            } else if (rawText.toLowerCase().includes("payload too large") || response.status === 413) {
              errorMsg = "File is too large! Please upload a syllabus document or image smaller than 3MB to avoid network timeouts.";
            } else {
              errorMsg = `Server error (Status ${response.status}). Please try optimizing your document content or try again.`;
            }
          } catch (pErr) {
            if (response.status === 413) {
              errorMsg = "Request entity too large! Please upload a smaller document (< 4MB) to bypass server buffers.";
            }
          }
        }
        addToast(errorMsg, "error");
        setIsUploading(false);
        return;
      }

      let data: any;
      try {
        const rawText = await response.text();
        if (!rawText.trim().startsWith("{")) {
          throw new Error("Invalid response format received from the server.");
        }
        data = JSON.parse(rawText);
      } catch (jsonErr: any) {
        throw new Error(jsonErr?.message || "The classroom portal received an unreadable response from the diagnostic server. Please try a smaller or more optimized document file.");
      }
      
      if (data.success) {
        disconnect();
        setDialogueHistory([]);
        setUploadedButWaitingWakeup(true);
        setActiveDocument({
          filename: data.filename,
          mimeType: data.mimeType,
          markdown: data.markdown,
          mode: data.mode,
          detectedSubject: data.detectedSubject,
        });
        setActiveTopicIndex(0);
        
        const finalSb = data.detectedSubject || studentDetails.subject;
        setStudentDetails(prev => ({ ...prev, subject: finalSb }));

        // Auto-redirect to immersive Classroom Blackboard Room screen
        setCurrentScreen("classroom");

        const newSessionId = "session_" + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
        setSessionId(newSessionId);

        // Sync with Firestore database in background
        const firestoreSync = async () => {
          let currentUser = auth.currentUser;
          if (!currentUser) {
            try {
              const anonResult = await signInAnonymously(auth);
              currentUser = anonResult.user;
            } catch (err) {
              console.error("Anonymous authentication failed:", err);
            }
          }

          if (currentUser) {
            const profileRef = doc(db, "studentProfiles", currentUser.uid);
            setDoc(profileRef, { subject: finalSb, updatedAt: serverTimestamp() }, { merge: true })
              .catch(profileErr => console.warn("Could not sync detected subject to student profile:", profileErr));

            const sessionRef = doc(db, "classSessions", newSessionId);
            setDoc(sessionRef, {
              sessionId: newSessionId,
              userId: currentUser.uid,
              grade: studentDetails.grade,
              subject: finalSb,
              activeDocumentName: data.filename || "Uploaded Notes",
              customBoardContent: "",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            }).then(() => {
              loadPastSessions(currentUser!.uid);
            }).catch(dbErr => {
              console.warn("Could not sync session to Firestore:", dbErr);
            });
          }
        };
        firestoreSync();

        addToast(data.mode === "mistake" 
          ? "Calculations notes diagnostic processed. Click 'Wake Up' to check your mistakes! 🔍✨" 
          : "Syllabus document loaded silently in Cherry's memory. Press 'Wake Up' to start the board! 📚✨", "success");
      } else {
        addToast(data.error || "Failed to analyze document.", "error");
      }
    } catch (err: any) {
      console.error("Upload fetch error inside reader load:", err);
      addToast("Gateway upload failed. Try optimizing the file size (under 3MB for PDF documents, or use jpeg/png images).", "error");
    } finally {
      setIsUploading(false);
    }
  };

  const handleClearDocument = async () => {
    try {
      const res = await fetch("/api/clear-document", { method: "POST" });
      const rawText = await res.text();
      let data: any = {};
      if (rawText.trim().startsWith("{")) {
        data = JSON.parse(rawText);
      }
      if (data.success) {
        setActiveDocument(null);
        setUploadedButWaitingWakeup(false);
        setActiveTopicIndex(0);
        setCustomBoardContent("");
        setTopicBoardsContent({});
        addToast("Syllabus cleared. General teaching mode active!", "info");
      } else {
        throw new Error(data.error || "Failed to parse clear-document JSON response.");
      }
    } catch (err) {
      console.error("Failed clearing document:", err);
      // Clean up client-side state anyway for better UX resilience
      setActiveDocument(null);
      setUploadedButWaitingWakeup(false);
      setActiveTopicIndex(0);
      setCustomBoardContent("");
      setTopicBoardsContent({});
      addToast("Active document state reset locally.", "info");
    }
  };

  const handleOpenSyllabus = () => {
    setActiveWorkspaceTab("document");
    setIsFullScreenBoard(false);
    addToast("Opening Syllabus Doc view...", "info");
    // Soft delay to wait for React tab transitions
    setTimeout(() => {
      document.getElementById("file-syllabus-upload")?.click();
    }, 200);
  };

  const handleSendPromptText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedInput.trim()) return;
    
    const safeMsgId = "student_typed_" + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    
    // Add prompt text to local history immediately for student feedback
    setDialogueHistory((prev) => [
      ...prev,
      {
        id: safeMsgId,
        sender: "user",
        text: typedInput,
      }
    ]);
    
    // Inject the prompt text into Gemini socket loop!
    injectPromptText(typedInput);
    addToast(`Prompt sent to Cherry Ma'am!`, "success");
    setTypedInput("");
  };

  const studentAskedForWritingOrDrawing = useMemo(() => {
    const keywords = [
      // English keywords
      "write", "draw", "sketch", "diagram", "plot", "graph", "formula", "equation", "solve", 
      "calculate", "show me", "explain on board", "table", "chart", "figure", "visualize", "illustrate", "derive",
      // Hindi / Indian keywords
      "likh", "likho", "likhiye", "bana", "banao", "banaye", "draw karo", "solve karo", "dikhao", "dikhaye", "diagram banao", "graph banao", "figure banao", "board pe"
    ];

    // 1. Check current real-time spoken transcript of user
    if (userTranscript?.text) {
      const lower = userTranscript.text.toLowerCase();
      if (keywords.some((kw) => lower.includes(kw))) {
        return true;
      }
    }

    // 2. Check the last user message in the history
    const userMessages = dialogueHistory.filter((item) => item.sender === "user");
    if (userMessages.length > 0) {
      const lastMsg = userMessages[userMessages.length - 1].text.toLowerCase();
      if (keywords.some((kw) => lastMsg.includes(kw))) {
        return true;
      }
    }

    return false;
  }, [dialogueHistory, userTranscript?.text]);

  const latestSpeechText = cherryTranscript.text || (dialogueHistory.filter((item) => item.sender === "cherry").slice(-1)[0]?.text || "");

  const handleSelectPrompt = (promptText: string) => {
    const isLive = state !== "disconnected" && state !== "connecting" && state !== "error";
    if (isLive) {
      injectPromptText(promptText);
      addToast(`Sending query: "${promptText}"`, "info");
    } else {
      addToast(`To ask Cherry Ma'am, read aloud: "${promptText}" or connect the live session first!`, "warning");
    }
  };

  return (
    <div
      className={`min-h-screen bg-gradient-to-b ${activeColors.bgGradient} text-[#0a3641] flex flex-col justify-between selection:bg-[#c4f500] selection:text-[#0a3641] overflow-hidden relative font-sans transition-all duration-1000`}
    >
      {/* Visual Ambient Cyber-Grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-40 mix-blend-overlay z-0" />

      {/* Orbiting cybernetic floating lights */}
      <div className="absolute top-1/4 left-1/4 w-[40vw] h-[40vw] rounded-full blur-[120px] opacity-[0.08] pointer-events-none transition-all duration-1000 z-0"
        style={{ background: `radial-gradient(circle, ${activeColors.primary} 0%, transparent 80%)` }} />
      <div className="absolute bottom-1/4 right-1/4 w-[45vw] h-[45vw] rounded-full blur-[150px] opacity-[0.08] pointer-events-none transition-all duration-1000 z-0"
        style={{ background: `radial-gradient(circle, ${activeColors.accent} 0%, transparent 80%)` }} />

      {/* =========================================
          SCREEN I: STUDENTS HOME PAGE & REGISTRATION
          ========================================= */}
      {currentScreen === "home" && (
        <div className="flex-1 flex flex-col justify-between z-10 w-full max-w-6xl mx-auto px-4 py-6 md:py-12">
          {/* Subtle Top Navigation bar */}
          <div className="flex items-center justify-between border-b border-[#dae1dd] pb-4 mb-8 md:mb-10">
            <div className="flex items-center space-x-2 md:space-x-3">
              <span className="p-1 px-2.5 rounded-lg text-[10px] font-mono uppercase bg-[#0a3641] text-[#c4f500] font-extrabold tracking-widest leading-none animate-pulse">Live</span>
              <span className="text-sm font-mono text-[#486a73] font-black">STUDY DESK HUB • चेरी मैम</span>
            </div>
            
            {/* Minimal top center navigation badges */}
            <div className="hidden md:flex items-center space-x-5 text-xs text-[#486a73] font-mono font-bold">
              <a href="#features" className="hover:text-[#0a3641] transition-colors">🔥 Features</a>
              <a href="#how-it-works" className="hover:text-[#0a3641] transition-colors">🎒 Journeys</a>
              <a href="#faq" className="hover:text-[#0a3641] transition-colors">🎯 FAQs</a>
            </div>

            {/* Top Right Action - Login / Register button */}
            <div>
              {user ? (
                studentDetails.name ? (
                  <div className="flex items-center space-x-2 md:space-x-3">
                    <div className="hidden sm:flex flex-col text-right">
                      <span className="text-[11px] font-black text-[#0a3641] leading-none">{studentDetails.name}</span>
                      <span className="text-[9px] text-[#486a73] font-mono leading-none mt-1 font-semibold">{studentDetails.grade}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCurrentScreen("syllabus")}
                      className="bg-[#0a3641] hover:bg-[#124e5d] text-[#c4f500] hover:scale-[1.01] text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all shadow-sm cursor-pointer select-none"
                    >
                      <span>Study Desk 🎒</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowStudentAccountHub(true)}
                      className="p-2 rounded-xl border border-[#dae1dd] hover:border-[#0a3641] text-[#0a3641] hover:bg-slate-50 transition-all cursor-pointer bg-white"
                      title="Open My Profile & Stats"
                    >
                      <User className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="p-2 rounded-xl border border-[#dae1dd] text-[#486a73] hover:text-red-500 hover:border-red-100 transition-colors cursor-pointer bg-white"
                      title="Sign Out"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setShowOnboarding(true)}
                      className="bg-[#0a3641] hover:bg-[#124e5d] text-[#c4f500] text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                    >
                      <span>Complete Setup 🎒</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="p-2 rounded-xl border border-[#dae1dd] text-[#486a73] hover:text-red-500 hover:border-red-100 transition-colors cursor-pointer bg-white"
                      title="Sign Out"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => setShowLoginModal(true)}
                  className="bg-[#0a3641] hover:bg-[#124e5d] text-[#c4f500] text-xs font-black tracking-wide uppercase px-4 py-2.5 rounded-xl flex items-center gap-1.5 transition-all shadow-md hover:shadow-lg cursor-pointer select-none active:translate-y-0.5"
                >
                  <User className="w-4 h-4 text-[#c4f500]" />
                  <span>Login / Register 🧑‍🎓</span>
                </button>
              )}
            </div>
          </div>

          {/* SECTION 1: MODERN HERO SPLIT VIEW */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center my-auto py-4 md:py-8 border-b border-[#dae1dd]/40 pb-12">
            
            {/* Left Column - Dynamic Value Pitch */}
            <div className="lg:col-span-7 space-y-6 text-left">
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-[#c4f500]/25 border border-[#0a3641]/15 text-[#0a3641] text-xs font-semibold font-mono"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#0a3641]" />
                <span>Next-Gen Interactive Hinglish Classroom</span>
              </motion.div>
              
              <motion.h1 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] font-sans text-[#0a3641]"
              >
                All Indian Boards & Multi-Lingual Study from <span className="bg-[#c4f500] text-[#0a3641] px-3.5 py-1 rounded-2xl shadow-sm border border-[#0a3641]/10 inline-block font-black rotate-[-1deg] hover:rotate-[1deg] transition-transform duration-300">Cherry Ma'am</span> Live!
              </motion.h1>

              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="text-sm md:text-base text-[#486a73] leading-relaxed max-w-2xl font-medium"
              >
                Cherrish the power of real-time voice conversations! Cherry Ma'am isn't just another boring, monotone bot. She is your encouraging, smart, sassy Hinglish tutor friend who writes customized chalk equations on the black board in perfect sync with her voice.
              </motion.p>

              {/* Call to Actions */}
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="flex flex-col sm:flex-row gap-3 pt-2"
              >
                {user ? (
                  <button
                    type="button"
                    onClick={() => setCurrentScreen("syllabus")}
                    className="bg-[#0a3641] hover:bg-[#124e5d] text-[#c4f500] hover:scale-[1.02] active:translate-y-0.5 text-xs font-black tracking-wider uppercase py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer select-none"
                  >
                    <span>Enter My Study Desk 🎒</span>
                    <ChevronRight className="w-4 h-4 stroke-[2.5]" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowLoginModal(true)}
                      className="bg-[#0a3641] hover:bg-[#1c4b57] text-[#c4f500] hover:scale-[1.02] active:translate-y-0.5 text-xs font-black tracking-wide uppercase py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg cursor-pointer select-none"
                    >
                      <User className="w-4 h-4 text-[#c4f500]" />
                      <span>Login or Register Now 🧑‍🎓</span>
                      <ChevronRight className="w-4 h-4 stroke-[2.5]" />
                    </button>
                    
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const anonResult = await signInAnonymously(auth);
                          if (anonResult.user) {
                            setStudentDetails({
                              name: "Quick Student",
                              grade: "Class 10",
                              subject: "Mathematics",
                              board: "CBSE"
                            });
                            // Trigger auto update profile in the background
                            const profileRef = doc(db, "studentProfiles", anonResult.user.uid);
                            setDoc(profileRef, {
                              userId: anonResult.user.uid,
                              name: "Quick Student",
                              grade: "Class 10",
                              subject: "Mathematics",
                              board: "CBSE",
                              mediumOfLearning: "Hinglish",
                              updatedAt: serverTimestamp()
                            }).catch((e) => {
                              console.warn("Could not write quick profile to database, staying local", e);
                            });
                            setCurrentScreen("syllabus");
                            addToast("Welcome! Entered custom Study Desk as Guest 🎒", "success");
                          }
                        } catch (err: any) {
                          addToast("Quick guest session failed, please use normal login", "error");
                        }
                      }}
                      className="bg-white hover:bg-[#f7f9f6] text-[#0a3641] border-2 border-[#0a3641]/20 text-xs font-black py-3.5 px-5 rounded-2xl flex items-center justify-center transition-all cursor-pointer font-bold"
                    >
                      <span>Try as Instant Guest ⚡</span>
                    </button>
                  </>
                )}
              </motion.div>

              {/* Quick Trust / Highlight metrics */}
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-[#dae1dd]/40 max-w-lg">
                <div>
                  <h4 className="text-base font-black text-[#0a3641] leading-none mb-1">Live AI</h4>
                  <p className="text-[10px] text-[#486a73] font-medium uppercase tracking-wider font-mono">Gemini Voice Sync</p>
                </div>
                <div>
                  <h4 className="text-base font-black text-[#0a3641] leading-none mb-1">Class 6-12</h4>
                  <p className="text-[10px] text-[#486a73] font-medium uppercase tracking-wider font-mono">IIT-JEE & Board Prep</p>
                </div>
                <div>
                  <h4 className="text-base font-black text-[#0a3641] leading-none mb-1">Instant Scan</h4>
                  <p className="text-[10px] text-[#486a73] font-medium uppercase tracking-wider font-mono">Mistake Pinpoint</p>
                </div>
              </div>
            </div>

            {/* Right Column - Premium Animated Virtual Chalkboard Mockup */}
            <div className="lg:col-span-5 relative mt-6 lg:mt-0">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className="w-full bg-[#1b2b29] border-[12px] border-[#392e27] rounded-3xl p-5 md:p-6 shadow-xl relative overflow-hidden flex flex-col justify-between text-left select-none group"
              >
                {/* Board gloss glares */}
                <div className="absolute inset-0 bg-gradient-to-tr from-white/0 to-white/[0.04] pointer-events-none" />
                <div className="absolute top-2 right-2 flex items-center space-x-1 font-mono text-[8px] text-slate-400 font-bold bg-[#14201e]/80 py-1 px-2.5 rounded-full border border-teal-500/10">
                  <span className="w-1.5 h-1.5 bg-[#c4f500] rounded-full animate-ping" />
                  <span>CHALK SLATE SIMULATION v2.4</span>
                </div>

                {/* Chalk board grids */}
                <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.015)_1.5px,transparent_1.5px)] [background-size:24px_24px] pointer-events-none" />

                {/* Drawn formula & dynamic annotations component */}
                <div className="space-y-4 pt-6 z-10 w-full">
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono font-bold tracking-widest text-emerald-400 uppercase bg-[#0f1d1c] px-2 py-0.5 rounded border border-emerald-500/15">
                      ACTIVE MATHEMATICAL SYSTEM
                    </span>
                  </div>

                  {/* Fully reactive real mathematical curve graph */}
                  <AnimatedChalkboardGraph />
                </div>

                {/* Simulated teacher live dialogue pop in real-time Hinglish */}
                <div className="mt-4 bg-[#14201e] border border-teal-500/10 rounded-xl p-3 text-left space-y-1 z-10">
                  <p className="text-[9px] font-mono text-[#c4f500] font-black uppercase tracking-wider flex items-center gap-1">
                    <span>💬 Cherry Ma'am's Blackboard Output:</span>
                  </p>
                  <p className="text-[11px] font-sans font-medium text-teal-150 leading-relaxed text-slate-100">
                    "Look at this graph! Calculus se darna nahi hai babu! Just integral coordinates focus karo and exact area visible ho jayega! 📐✨"
                  </p>
                </div>

              </motion.div>
            </div>

          </div>

          {/* SECTION 2: BENTO GRID VALUE PROPOSITION / FEATURES */}
          <div id="features" className="py-12 md:py-16 border-b border-[#dae1dd]/40">
            <div className="text-center space-y-3 max-w-2xl mx-auto mb-10">
              <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest text-[#0a3641] bg-[#c4f500]/30 px-3 py-1 rounded-full">Explore High-End Features</span>
              <h2 className="text-2xl md:text-3.5xl font-black text-[#0a3641] leading-tight">What makes Cherry Ma'am unlike any ordinary AI bot</h2>
              <p className="text-xs md:text-sm text-[#486a73] font-medium">Equipped with ultra-fast Gemini Live streaming, chalkslate physics renders, and student homework diagnostic scanners.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Feature 1: Real-time Voice Chat */}
              <div className="bg-white border border-[#dae1dd] hover:border-[#0a3641]/30 hover:shadow-lg transition-all rounded-3xl p-6 text-left space-y-4 flex flex-col justify-between group">
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#0a3641]/5 flex items-center justify-center text-xl text-[#0a3641] border border-[#0a3641]/10 group-hover:bg-[#c4f500]/25 transition-all">
                    🎙️
                  </div>
                  <h3 className="text-sm font-extrabold text-[#0a3641] uppercase tracking-wide">Dynamic Bi-directional Voice</h3>
                  <p className="text-xs text-[#486a73] leading-relaxed font-semibold">
                    Speak naturally. No delay, no awkward waiting. Interrupt whenever you want, just like a real class teacher!
                  </p>
                </div>
                <span className="text-[9px] font-mono font-extrabold text-[#0a3641]/40 uppercase tracking-widest">Powered by Gemini Live API</span>
              </div>

              {/* Feature 2: Synced Chalk Blackboard */}
              <div className="bg-white border border-[#dae1dd] hover:border-[#0a3641]/30 hover:shadow-lg transition-all rounded-3xl p-6 text-left space-y-4 flex flex-col justify-between group">
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#0a3641]/5 flex items-center justify-center text-xl text-[#0a3641] border border-[#0a3641]/10 group-hover:bg-[#c4f500]/25 transition-all">
                    📐
                  </div>
                  <h3 className="text-sm font-extrabold text-[#0a3641] uppercase tracking-wide">LaTeX Slate Chalkboard</h3>
                  <p className="text-xs text-[#486a73] leading-relaxed font-semibold">
                    Drawn formulas, step-by-step calculus steps, and physics state diagrams display dynamically on the slate as she speaks.
                  </p>
                </div>
                <span className="text-[9px] font-mono font-extrabold text-[#0a3641]/40 uppercase tracking-widest">Instant Math & graph rendering</span>
              </div>

              {/* Feature 3: Doubt Scan Diagnostic */}
              <div className="bg-white border border-[#dae1dd] hover:border-[#0a3641]/30 hover:shadow-lg transition-all rounded-3xl p-6 text-left space-y-4 flex flex-col justify-between group">
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#0a3641]/5 flex items-center justify-center text-xl text-[#0a3641] border border-[#0a3641]/10 group-hover:bg-[#c4f500]/25 transition-all">
                    🔍
                  </div>
                  <h3 className="text-sm font-extrabold text-[#0a3641] uppercase tracking-wide">Find My Mistake Tracker</h3>
                  <p className="text-xs text-[#486a73] leading-relaxed font-semibold">
                    Upload handwritten calculations or whiteboard sketches. Cherry scans lines, pinpoints exactly where your equation went wrong!
                  </p>
                </div>
                <span className="text-[9px] font-mono font-extrabold text-[#0a3641]/40 uppercase tracking-widest">Full Document/Image parsing</span>
              </div>

            </div>
          </div>

          {/* SECTION 3: STEP-BY-STEP COHESIVE LEARNING JOURNEY */}
          <div id="how-it-works" className="py-12 md:py-16 border-b border-[#dae1dd]/40">
            <div className="text-center space-y-3 max-w-2xl mx-auto mb-12">
              <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest text-[#0a3641]">How Study Desk Journey Operates</span>
              <h2 className="text-2xl md:text-3.5xl font-black text-[#0a3641] leading-tight">3 Simple steps to sitting on Cherry Ma'am's blackboard desk</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
              {/* Connector line behind on desktop */}
              <div className="hidden md:block absolute top-12 left-1/4 right-1/4 h-0.5 bg-gradient-to-r from-teal-100 via-[#c4f500]/50 to-teal-100 z-0 pointer-events-none" />

              {/* Step 1 */}
              <div className="text-center space-y-3 p-4 bg-white/40 border border-[#dae1dd]/60 rounded-3xl relative z-10 hover:shadow-sm">
                <div className="w-12 h-12 bg-[#0a3641] font-black text-[#c4f500] text-sm font-mono flex items-center justify-center rounded-2xl mx-auto shadow-md">
                  01
                </div>
                <h3 className="text-sm font-black text-[#0a3641] uppercase tracking-wide">Set Up Target Board & Class</h3>
                <p className="text-xs text-[#486a73] leading-relaxed max-w-xs mx-auto font-medium">
                  Define your exact academic profile (Class 6-12, IIT-JEE preparative, board guidelines). This teaches Cherry's brain to match your syllabus.
                </p>
              </div>

              {/* Step 2 */}
              <div className="text-center space-y-3 p-4 bg-white/40 border border-[#dae1dd]/60 rounded-3xl relative z-10 hover:shadow-sm">
                <div className="w-12 h-12 bg-[#0a3641] font-black text-[#c4f500] text-sm font-mono flex items-center justify-center rounded-2xl mx-auto shadow-md">
                  02
                </div>
                <h3 className="text-sm font-black text-[#0a3641] uppercase tracking-wide">Provide Your Homework or Document</h3>
                <p className="text-xs text-[#486a73] leading-relaxed max-w-xs mx-auto font-medium">
                  Drop math question sheets, coordinate papers, physics textbooks or PDF notes. Cherry reads them and designs live slate modules around them.
                </p>
              </div>

              {/* Step 3 */}
              <div className="text-center space-y-3 p-4 bg-white/40 border border-[#dae1dd]/60 rounded-3xl relative z-10 hover:shadow-sm">
                <div className="w-12 h-12 bg-[#0a3641] font-black text-[#c4f500] text-sm font-mono flex items-center justify-center rounded-2xl mx-auto shadow-md animate-pulse">
                  03
                </div>
                <h3 className="text-sm font-black text-[#0a3641] uppercase tracking-wide">Start Active Hinglish Dialogue</h3>
                <p className="text-xs text-[#486a73] leading-relaxed max-w-xs mx-auto font-medium">
                  Click live on the study desk. Start conversational speaking as she illustrates formulas on the slate with funny friendly feedback.
                </p>
              </div>

            </div>
          </div>

          {/* SECTION 4: STUDENT SPOTLIGHT / BUZZ OR TESTIMONIALS */}
          <div className="py-12 md:py-16 border-b border-[#dae1dd]/40 text-left">
            <div className="max-w-xl mb-10 space-y-2">
              <span className="text-[10px] font-mono font-black text-[#0a3641] uppercase tracking-widest bg-[#c4f500]/30 px-3 py-1 rounded-full">Hear the Student Buzz</span>
              <h2 className="text-2xl md:text-3xl font-black text-[#0a3641]">Indian Students are raving about Cherry's sassy classes!</h2>
              <p className="text-xs text-[#486a73] font-medium">Pure peer level motivation combined with brilliant scientific logical support.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Review 1 */}
              <div className="p-5 rounded-2xl bg-white border border-[#dae1dd] hover:scale-[1.01] transition-transform shadow-sm space-y-4">
                <p className="text-xs font-serif italic text-slate-700 leading-relaxed">
                  "Class 11 math was giving me serious trust issues, especially Calculus. But Cherry Ma'am's voice sync whiteboard matches perfectly. She literally roasted me for missing a negative sign but corrected it within 5 seconds! 😂 IIT preparation feels so much cleaner now."
                </p>
                <div className="flex items-center space-x-3 pt-2">
                  <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-xs font-black text-orange-700">R</div>
                  <div>
                    <h5 className="text-[11px] font-bold text-[#0a3641]">Rahul S.</h5>
                    <p className="text-[9px] font-mono text-emerald-600 font-bold">Class 12 student • KOTA DESK</p>
                  </div>
                </div>
              </div>

              {/* Review 2 */}
              <div className="p-5 rounded-2xl bg-white border border-[#dae1dd] hover:scale-[1.01] transition-transform shadow-sm space-y-4">
                <p className="text-xs font-serif italic text-slate-700 leading-relaxed">
                  "CBSE Science Board prep handles notes perfectly with her PDF syllabus scanner! I dropped my entire Term 1 syllabus document, and Cherry Ma'am designed study units for me. English-Hindi peer mix is super helpful and very native to study."
                </p>
                <div className="flex items-center space-x-3 pt-2">
                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-xs font-black text-purple-700">P</div>
                  <div>
                    <h5 className="text-[11px] font-bold text-[#0a3641]">Priya K.</h5>
                    <p className="text-[9px] font-mono text-emerald-600 font-bold">Class 10 CBSE • NCR REGION</p>
                  </div>
                </div>
              </div>

              {/* Review 3 */}
              <div className="p-5 rounded-2xl bg-white border border-[#dae1dd] hover:scale-[1.01] transition-transform shadow-sm space-y-4">
                <p className="text-xs font-serif italic text-slate-700 leading-relaxed">
                  "I was tired of static videos where nobody clears your specific doubt. With Cherry Ma'am, I simply upload my step calculation, she points out exact error lines, and we talk over the blackboard! This acts like a real personal tutor friend."
                </p>
                <div className="flex items-center space-x-3 pt-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-xs font-black text-emerald-700">K</div>
                  <div>
                    <h5 className="text-[11px] font-bold text-[#0a3641]">Kartik R.</h5>
                    <p className="text-[9px] font-mono text-emerald-600 font-bold">JEE aspirant • BIHAR BOARD</p>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* SECTION 5: FAQS ACCORDIONS SECTION */}
          <div id="faq" className="py-12 md:py-16 text-left max-w-6xl mx-auto">
            <div className="text-center space-y-3 max-w-xl mx-auto mb-10">
              <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest text-[#0a3641] bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">Frequently Asked Queries & Companion</span>
              <h2 className="text-2xl md:text-3.5xl font-black text-[#0a3641]">Aapke Sawaal, Cherry Ke Jawaab 🎯</h2>
              <p className="text-xs text-[#486a73] font-medium leading-relaxed">Read common questions, or simply ask our dynamic voice advisor assistant **Aditi** live about this applet's interactive classroom guidelines below!</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Column: Traditional FAQs */}
              <div className="lg:col-span-7 space-y-4">
                <div className="border-b-2 border-dashed border-[#dae1dd] pb-2 mb-4">
                  <h3 className="text-sm font-extrabold text-[#0a3641] uppercase tracking-wider flex items-center gap-2">
                    <span>📋 FAQ Cheat Sheet</span>
                  </h3>
                </div>

                {/* Question 1 */}
                <div className="border border-[#dae1dd] rounded-2xl bg-white overflow-hidden transition-all duration-300 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setActiveFaq(activeFaq === 0 ? null : 0)}
                    className="w-full flex items-center justify-between p-5 text-left text-xs font-bold text-[#0a3641] transition-colors hover:bg-[#f7f9f6]"
                  >
                    <span className="text-xs md:text-sm">Is Cherry Ma'am an actual teacher? / क्या चेरी मैम कोई सचमुच की टीचर हैं?</span>
                    <span className="text-xs text-emerald-600 font-black">{activeFaq === 0 ? "▲" : "▼"}</span>
                  </button>
                  {activeFaq === 0 && (
                    <div className="px-5 pb-5 pt-1 border-t border-[#dae1dd]/30 text-xs text-[#486a73] leading-relaxed font-semibold">
                      Cherry Ma'am is an interactive, voice-first AI virtual tutor powered by Google's Gemini Live API! She possesses infinite mathematical, algebraical and physical calculations knowledge, and responds in warm, sassy Hinglish peer dialogue to make tutoring completely fun.
                    </div>
                  )}
                </div>

                {/* Question 2 */}
                <div className="border border-[#dae1dd] rounded-2xl bg-white overflow-hidden transition-all duration-300 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setActiveFaq(activeFaq === 1 ? null : 1)}
                    className="w-full flex items-center justify-between p-5 text-left text-xs font-bold text-[#0a3641] transition-colors hover:bg-[#f7f9f6]"
                  >
                    <span className="text-xs md:text-sm">How does mistake pointing scanner scan? / मिस्टेक डिटेक्टर कैसे काम करता है?</span>
                    <span className="text-xs text-emerald-600 font-black">{activeFaq === 1 ? "▲" : "▼"}</span>
                  </button>
                  {activeFaq === 1 && (
                    <div className="px-5 pb-5 pt-1 border-t border-[#dae1dd]/30 text-xs text-[#486a73] leading-relaxed font-semibold">
                      Simply take a photo or screenshot of your handwritten mathematics calculation or physics schematic diagram, then set the Session Mode on your Study Desk to "Quick Hint & Diagnostic". Cherry scans the uploaded work, points out exactly which step of your algebraic operation has an error, and explains how to solve it correctly on her interactive blackboard.
                    </div>
                  )}
                </div>

                {/* Question 3 */}
                <div className="border border-[#dae1dd] rounded-2xl bg-white overflow-hidden transition-all duration-300 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setActiveFaq(activeFaq === 2 ? null : 2)}
                    className="w-full flex items-center justify-between p-5 text-left text-xs font-bold text-[#0a3641] transition-colors hover:bg-[#f7f9f6]"
                  >
                    <span className="text-xs md:text-sm">What school levels are supported? / क्लास लेवल कौन-कौन से सपोर्टेड हैं?</span>
                    <span className="text-xs text-emerald-600 font-black">{activeFaq === 2 ? "▲" : "▼"}</span>
                  </button>
                  {activeFaq === 2 && (
                    <div className="px-5 pb-5 pt-1 border-t border-[#dae1dd]/30 text-xs text-[#486a73] leading-relaxed font-semibold">
                      We fully support Class 6, 7, 8, 9, 10, 11, and 12, as well as competitive IIT-JEE and NEET foundation preparations across CBSE and national Board guidelines. The student can customize board syllabus dynamically inside the setup onboarding page.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Interactive Voice Concierge Assistant Aditi */}
              <div className="lg:col-span-5 space-y-4">
                <div className="border-b-2 border-dashed border-[#dae1dd] pb-2 mb-4">
                  <h3 className="text-sm font-extrabold text-[#0a3641] uppercase tracking-wider flex items-center gap-2">
                    <span>🎙️ Talk to Aditi Live (Hindi/English)</span>
                  </h3>
                </div>
                
                <ConciergeAssistant />
              </div>

            </div>
          </div>

          <div className="text-center pt-8 border-t border-[#dae1dd] mt-auto">
            <p className="text-[10px] text-[#486a73] font-mono font-bold tracking-wider">CHERRY MA'AM'S INTERACTIVE CLASS • POWERED BY GEMINI LIVE API</p>
          </div>
        </div>
      )}

      {/* =========================================
          SCREEN II: SYLLABUS & DOCUMENT DESK WORKSPACE
          ========================================= */}
      {currentScreen === "syllabus" && (
        <div className="flex-1 flex flex-col justify-between z-10 w-full max-w-3xl mx-auto px-4 py-6 md:py-12">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#dae1dd] pb-4 mb-6">
            <button
              onClick={() => setCurrentScreen("home")}
              className="flex items-center space-x-1 text-xs text-[#486a73] hover:text-[#0a3641] transition-colors cursor-pointer font-bold"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Login</span>
            </button>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowStudentAccountHub(true)}
                className="mr-2 px-3 py-1 bg-white hover:bg-[#c4f500]/10 text-xs border border-[#dae1dd] text-[#0a3641] rounded-lg cursor-pointer transition-all flex items-center gap-1 font-bold"
                title="Open My Profile and saved Blackboard snapshots"
              >
                <User className="w-3.5 h-3.5" />
                <span>My Account</span>
              </button>
              <span className="text-xs bg-[#0a3641]/10 border border-[#0a3641]/25 text-[#0a3641] px-2.5 py-1 rounded-full font-mono font-bold uppercase tracking-wider">
                Syllabus Desk • {studentDetails.grade}
              </span>
            </div>
          </div>

          <div className="space-y-6">
            {/* Greeting Card */}
            <div className="bg-white border border-[#dae1dd] p-5 rounded-2xl text-left relative overflow-hidden shadow-sm">
              <div className="absolute right-4 top-4 text-4xl opacity-15">📚</div>
              <h3 className="text-lg font-bold text-[#0a3641]">Namaste, {studentDetails.name}! 👋</h3>
              <p className="text-xs text-[#486a73] mt-1 leading-relaxed font-medium">
                Welcome to your interactive syllabus desk. Before starting the audio session, you can upload any Mathematics, Physics, or Chemistry syllabus, exam topics sheet, code, homework paper, or handwritten calculations file.
              </p>
              
              <div className="mt-3.5 flex flex-wrap gap-2 text-[10px] text-[#0a3641] font-mono">
                <span className="bg-[#f7f9f6] px-2 py-1 rounded border border-[#dae1dd] flex items-center gap-1 font-bold">
                  <CheckCircle className="w-3.5 h-3.5 text-[#0a3641]" /> Grade: {studentDetails.grade}
                </span>
                <span className="bg-[#f7f9f6] px-2 py-1 rounded border border-[#dae1dd] flex items-center gap-1 font-bold">
                  <CheckCircle className="w-3.5 h-3.5 text-[#0a3641]" /> Goal Subject: {studentDetails.subject}
                </span>
              </div>
            </div>

            {/* Document upload zone container */}
            <div className="bg-white border border-[#dae1dd] rounded-2xl p-5 md:p-6 shadow-md relative flex flex-col space-y-4">
              {/* Step 1: Active Subject Selection */}
              <div className="text-left space-y-2 pb-2 border-b border-[#dae1dd]/50">
                <h4 className="text-xs font-mono font-extrabold uppercase text-[#0a3641] flex items-center gap-1.5">
                  <span className="text-teal-600">Step 1:</span> Choose Active Subject / विषय चुनें
                </h4>
                <p className="text-[11px] text-[#486a73] font-medium">
                  Select the subject for your uploaded lesson or whiteboard study:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {(() => {
                    const defaultSubjects = ["Mathematics", "Physics", "Chemistry", "All Science"];
                    const dynamicSubjects = [...defaultSubjects];
                    const detected = activeDocument?.detectedSubject;
                    if (detected && !dynamicSubjects.includes(detected)) {
                      dynamicSubjects.push(detected);
                    }
                    if (studentDetails.subject && !dynamicSubjects.includes(studentDetails.subject)) {
                      dynamicSubjects.push(studentDetails.subject);
                    }
                    return dynamicSubjects.map((subj) => {
                      let translation = "विषय";
                      if (subj === "Mathematics") translation = "गणित";
                      else if (subj === "Physics") translation = "भौतिक विज्ञान";
                      else if (subj === "Chemistry") translation = "रसायन विज्ञान";
                      else if (subj === "All Science") translation = "विज्ञान";
                      else if (subj === "Biology") translation = "जीव विज्ञान";
                      else if (subj === "History") translation = "इतिहास";
                      else if (subj === "Geography") translation = "भूगोल";
                      else if (subj === "Civics") translation = "नागरिक शास्त्र";
                      else if (subj === "Economics") translation = "अर्थशास्त्र";
                      else if (subj === "English") translation = "अंग्रेज़ी";
                      else if (subj === "Hindi") translation = "हिंदी";
                      else if (subj === "Computer Science") translation = "कंप्यूटर विज्ञान";

                      const isAutoDetected = !defaultSubjects.includes(subj);

                      return (
                        <button
                          key={subj}
                          type="button"
                          onClick={async () => {
                            setStudentDetails(prev => ({ ...prev, subject: subj }));
                            // Update cloud profile active subject if logged in (in the background)
                            const currentUser = auth.currentUser;
                            if (currentUser && !currentUser.isAnonymous) {
                              const profileRef = doc(db, "studentProfiles", currentUser.uid);
                              setDoc(profileRef, { subject: subj }, { merge: true })
                                .catch((e) => console.warn("Could not sync subject to Firestore:", e));
                            }
                            addToast(`Subject set to ${subj}! 📚`, "success");
                          }}
                          className={`py-2 px-3 text-[10px] font-mono border rounded-xl transition-all font-bold cursor-pointer flex flex-col items-center justify-center text-center mt-1 select-none leading-tight ${
                            studentDetails.subject === subj 
                              ? isAutoDetected 
                                ? "bg-[#c4f500]/30 border-teal-600 text-teal-950 shadow-[0_0_12px_rgba(20,184,166,0.3)] animate-pulse scale-[1.01]"
                                : "bg-[#c4f500]/25 border-[#0a3641] text-[#0a3641] scale-[1.01]" 
                              : "bg-[#f7f9f6] border-[#dae1dd] text-[#486a73] hover:text-[#0a3641] hover:bg-slate-50"
                          }`}
                        >
                          <span className="font-extrabold flex items-center justify-center gap-1 flex-wrap">
                            {isAutoDetected && (
                              <Sparkles className="w-3.5 h-3.5 text-teal-600 animate-pulse" />
                            )}
                            {subj}
                            {isAutoDetected && (
                              <span className="text-[7px] bg-teal-100 text-teal-800 px-1 rounded-sm font-bold uppercase select-none font-sans">Auto</span>
                            )}
                          </span>
                          <span className="text-[8px] font-normal text-slate-500 mt-0.5">
                            {translation}
                          </span>
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>

              <div className="text-left">
                <h4 className="text-xs font-mono font-extrabold uppercase text-[#0a3641] flex items-center gap-1.5">
                  <span className="text-teal-600">Step 2:</span> Choose Your Session Action / Mode
                </h4>
                <p className="text-[11px] text-[#486a73] mt-1 font-medium">
                  Decide how Cherry Ma'am should approach your active calculation file or image:
                </p>
              </div>

              {/* Mode Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                <button
                  type="button"
                  onClick={() => {
                    setUploadMode("explain");
                    addToast("Mode set: Explain Course Content step-by-step! 📖", "info");
                  }}
                  className={`p-3.5 rounded-xl border text-left flex items-start gap-2.5 cursor-pointer transition-all ${
                    uploadMode === "explain"
                      ? "bg-[#c4f500]/20 border-[#0a3641]/55 text-[#0a3641] shadow-sm font-bold"
                      : "bg-[#f7f9f6] border-[#dae1dd] text-[#486a73] hover:text-[#0a3641] hover:border-[#0a3641]/30"
                  }`}
                >
                  <span className="text-lg mt-0.5">📖</span>
                  <div className="leading-tight">
                    <p className="text-xs font-bold leading-none text-[#0a3641]">Continuous Course Explanation</p>
                    <p className="text-[10px] text-[#486a73] mt-1 font-normal leading-relaxed">Cherry teaches topics sequence from start to end continuously.</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setUploadMode("mistake");
                    addToast("Mode set: Deeply analyze & Find My Mistake! 🔍", "info");
                  }}
                  className={`p-3.5 rounded-xl border text-left flex items-start gap-2.5 cursor-pointer transition-all ${
                    uploadMode === "mistake"
                      ? "bg-[#c4f500]/20 border-[#0a3641]/55 text-[#0a3641] shadow-sm font-bold"
                      : "bg-[#f7f9f6] border-[#dae1dd] text-[#486a73] hover:text-[#0a3641] hover:border-[#0a3641]/30"
                  }`}
                >
                  <span className="text-lg mt-0.5">🔍</span>
                  <div className="leading-tight">
                    <p className="text-xs font-bold leading-none text-[#0a3641]">Find & Explain My Mistake</p>
                    <p className="text-[10px] text-[#486a73] mt-1 font-normal leading-relaxed">Checks your calculations step-by-step to point out mistakes.</p>
                  </div>
                </button>
              </div>

              {/* Upload Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileUpload(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => document.getElementById("file-syllabus-upload")?.click()}
                className="border border-dashed border-[#dae1dd] hover:border-[#0a3641]/60 bg-[#f7f9f6]/40 hover:bg-[#c4f500]/5 rounded-xl flex flex-col items-center justify-center text-center p-8 space-y-4 transition-all duration-300 cursor-pointer group min-h-[220px]"
              >
                <input
                  type="file"
                  id="file-syllabus-upload"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileUpload(e.target.files[0]);
                    }
                  }}
                />
                
                {isUploading ? (
                  <div className="space-y-3 flex flex-col items-center">
                    <RefreshCw className="w-10 h-10 text-[#0a3641] animate-spin" />
                    <p className="text-xs font-mono font-bold text-[#0a3641] uppercase tracking-widest animate-pulse">
                      Analyzing Document...
                    </p>
                    <p className="text-[10px] text-[#486a73] leading-relaxed max-w-[280px]">
                      {uploadMode === "mistake"
                        ? "Gemini AI is checking your uploaded math formulas & homework calculation slips deeply..."
                        : "OCR-processing and preparing topics sequence list."}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="p-3.5 rounded-full bg-white border border-[#dae1dd] group-hover:border-[#0a3641]/40 transition-colors font-medium">
                      <Upload className="w-6 h-6 text-[#486a73] group-hover:text-[#0a3641] transition-colors" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-[#0a3641] group-hover:text-[#0a3641] transition-colors">
                        Upload handwritten sheets, calculations, or syllabus PDF
                      </p>
                      <p className="text-[10px] text-[#486a73] leading-relaxed max-w-[320px] mx-auto font-medium">
                        Drag & drop file or click to choose layout (PDF, PNG, JPG). Max limit 3MB.
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* YouTube Integration Component (Phase 1: UI and Verification Block) */}
              {uploadMode === "explain" && (
                <div className="bg-[#fff5f5]/65 hover:bg-[#fff5f5] border border-red-500/10 rounded-xl p-4 space-y-3.5 shadow-sm transition-all text-left">
                  <div className="flex items-start gap-2.5">
                    <div className="p-2 bg-red-600 rounded-lg text-white">
                      <Youtube className="w-4 h-4 shadow-sm shrink-0" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-[#0a3641] uppercase tracking-wide flex items-center gap-1.5 leading-none">
                        Learn from a YouTube Video
                        <span className="text-[8px] bg-red-100 text-red-650 border border-red-200 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider font-mono">Phase 4 Active</span>
                      </p>
                      <p className="text-[10px] text-[#486a73] font-medium leading-relaxed mt-1">
                        Input any educational YouTube video or Shorts. Cherry Ma'am will auto-extract concepts, write LaTeX summaries onto the chalkboard, and teach you step-by-step.
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Paste YouTube Link (e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ)"
                      value={youtubeUrl}
                      onChange={(e) => {
                        setYoutubeUrl(e.target.value);
                      }}
                      disabled={isYoutubeLoading}
                      className="w-full text-xs font-mono py-2.5 pl-3 pr-24 border border-red-200 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 bg-white/80 rounded-xl transition-all leading-relaxed placeholder:font-sans placeholder-red-300 placeholder:text-[11px]"
                    />
                    <div className="absolute right-1.5 top-1.5 flex items-center">
                      {youtubeUrl && (
                        <button
                          type="button"
                          onClick={() => setYoutubeUrl("")}
                          disabled={isYoutubeLoading}
                          className="p-1 px-2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          if (!youtubeUrl.trim()) {
                            addToast("Please enter a valid YouTube URL first! 🎥", "error");
                            return;
                          }
                          const vidId = extractYoutubeId(youtubeUrl);
                          if (!vidId) {
                            addToast("Could not recognize a valid YouTube Video ID! Please check your link format. ❌", "error");
                            return;
                          }
                          setIsYoutubeLoading(true);
                          addToast("Phase 2 Active: Initiating authentic lecture content generation...", "info");
                          
                          // Simulating server processing steps in background UI
                          const anim1 = setTimeout(() => addToast(`Analyzing YouTube Video ID: ${vidId}...`, "info"), 1000);
                          const anim2 = setTimeout(() => addToast(`Designing customized study module for ${studentDetails.board} (${studentDetails.mediumOfLearning || "Hinglish"})...`, "info"), 2200);
                          
                          try {
                            const resYt = await fetch("/api/parse-youtube", {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                youtubeUrl: youtubeUrl,
                                grade: studentDetails.grade || "Class 10",
                                board: studentDetails.board || "CBSE",
                                subject: studentDetails.subject || "Mathematics",
                                medium: studentDetails.mediumOfLearning || "Hinglish",
                              }),
                            });

                            clearTimeout(anim1);
                            clearTimeout(anim2);

                            if (!resYt.ok) {
                              const rawErrText = await resYt.text().catch(() => "");
                              let errorMsg = "Server could not generate curriculum";
                              if (rawErrText.trim().startsWith("{")) {
                                try {
                                  const errData = JSON.parse(rawErrText);
                                  errorMsg = errData.error || errorMsg;
                                } catch (_) {}
                              }
                              throw new Error(errorMsg);
                            }

                            const rawText = await resYt.text();
                            if (!rawText.trim().startsWith("{")) {
                              throw new Error("The YouTube parser received an invalid/empty response from the server.");
                            }
                            const result = JSON.parse(rawText);
                            setIsYoutubeLoading(false);
                            addToast("Success! Beautiful board-synchronized curriculum generated! 🎉", "success");
                            
                            const finalSubj = result.detectedSubject || studentDetails.subject;
                            setStudentDetails(prev => ({ ...prev, subject: finalSubj }));

                            disconnect();
                            setDialogueHistory([]);
                            setUploadedButWaitingWakeup(true);
                            setActiveDocument({
                              filename: result.filename,
                              mimeType: "video/youtube",
                              markdown: result.markdown,
                              mode: "explain",
                              detectedSubject: result.detectedSubject,
                            });
                            setActiveTopicIndex(0);
                            
                            // Redirect to classroom screen
                            setCurrentScreen("classroom");
                            
                            // Sync session with firestore in the background
                            const syncYTSession = async () => {
                              let currentUser = auth.currentUser;
                              if (!currentUser) {
                                try {
                                  const anonResult = await signInAnonymously(auth);
                                  currentUser = anonResult.user;
                                } catch (err) {}
                              }
                              
                              if (currentUser) {
                                // Sync legacy profile
                                const profileRef = doc(db, "studentProfiles", currentUser.uid);
                                setDoc(profileRef, { subject: finalSubj, updatedAt: serverTimestamp() }, { merge: true })
                                  .catch(err => console.warn("Could not sync parsed YouTube subject to profile:", err));

                                const newSessionId = "session_yt_" + Math.random().toString(36).substring(2, 11);
                                setSessionId(newSessionId);
                                const sessionRef = doc(db, "classSessions", newSessionId);
                                setDoc(sessionRef, {
                                  sessionId: newSessionId,
                                  userId: currentUser.uid,
                                  grade: studentDetails.grade,
                                  subject: finalSubj,
                                  activeDocumentName: result.filename,
                                  customBoardContent: "",
                                  createdAt: serverTimestamp(),
                                  updatedAt: serverTimestamp()
                                }).then(() => {
                                  loadPastSessions(currentUser!.uid);
                                }).catch(() => {});
                              }
                            };
                            syncYTSession();
                          } catch (ytErr: any) {
                            clearTimeout(anim1);
                            clearTimeout(anim2);
                            setIsYoutubeLoading(false);
                            console.error("[YouTube Parser UI] Error:", ytErr);
                            addToast(`Failed to parse: ${ytErr.message || "Unknown error"}`, "error");
                          }
                        }}
                        disabled={isYoutubeLoading || !youtubeUrl.trim() || !extractYoutubeId(youtubeUrl)}
                        className={`text-[10px] font-extrabold uppercase px-2.5 py-1.5 rounded-lg border flex items-center gap-1 transition-all ${
                          extractYoutubeId(youtubeUrl) && !isYoutubeLoading
                            ? "bg-red-600 hover:bg-red-700 text-white border-red-700 shadow-sm cursor-pointer"
                            : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                        }`}
                      >
                        {isYoutubeLoading ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>Parsing...</span>
                          </>
                        ) : (
                          <>
                            <Video className="w-3 h-3" />
                            <span>Proceed</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Immediate Video Detection Card */}
                  {youtubeUrl.trim() && (
                    <div className="border border-slate-200/65 bg-white rounded-xl p-2.5 flex items-center gap-3 animate-fade-in">
                      {extractYoutubeId(youtubeUrl) ? (
                        <>
                          <div className="relative w-20 h-12 bg-slate-100 rounded-lg overflow-hidden shrink-0 border border-slate-200 shadow-inner flex items-center justify-center">
                            <img
                              src={`https://img.youtube.com/vi/${extractYoutubeId(youtubeUrl)}/hqdefault.jpg`}
                              alt="YouTube Thumbnail preview"
                              onError={(e) => {
                                // Fallback icon if img doesn't load
                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                              <Youtube className="w-5 h-5 text-red-600 animate-pulse" />
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1 leading-none">
                              <CheckCircle className="w-3 h-3" /> Valid Video Detected
                            </p>
                            <p className="text-[11px] text-[#0a3641] font-mono leading-tight truncate mt-1">
                              ID: {extractYoutubeId(youtubeUrl)}
                            </p>
                            <p className="text-[9px] text-[#486a73] font-medium leading-[1.2] mt-0.5">
                              Phase 4: Live chalkboard spot-quizzes & interactive checkpoints synced!
                            </p>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 p-1 text-red-500">
                          <span className="text-sm">⚠️</span>
                          <span className="text-[10px] font-semibold leading-normal">
                            Invalid YouTube URL format. Please paste a standard watch link or Shorts.
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* BOLD OPTION BYPASS: DIRECT TO IMMERSIVE BLACKBOARD STUDY */}
              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-[#dae1dd]"></div>
                <span className="flex-shrink mx-3 text-[9px] font-mono tracking-widest text-[#486a73] uppercase font-bold">Or Bypass File</span>
                <div className="flex-grow border-t border-[#dae1dd]"></div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  let currentUser = auth.currentUser;
                  if (!currentUser) {
                    try {
                      const anonResult = await signInAnonymously(auth);
                      currentUser = anonResult.user;
                    } catch (err) {
                      console.error("Anonymous sign-in failed:", err);
                    }
                  }

                  const newSessionId = "session_" + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
                  setSessionId(newSessionId);
                  setDialogueHistory([]);
                  setCustomBoardContent("");
                  setTopicBoardsContent({});
                  setActiveDocument(null);
                  setCurrentScreen("classroom");

                  if (currentUser) {
                    const sessionRef = doc(db, "classSessions", newSessionId);
                    setDoc(sessionRef, {
                      sessionId: newSessionId,
                      userId: currentUser.uid,
                      grade: studentDetails.grade,
                      subject: studentDetails.subject,
                      activeDocumentName: "",
                      customBoardContent: "",
                      createdAt: serverTimestamp(),
                      updatedAt: serverTimestamp()
                    }).then(() => {
                      loadPastSessions(currentUser!.uid);
                    }).catch((dbErr) => {
                      console.warn("Could not sync session in background:", dbErr);
                    });
                  }
                  addToast("Entering Clean Blackboard Study! Lesson registered. 🖊️🎨☁️", "success");
                }}
                className="w-full py-4 px-4 rounded-xl border border-[#0a3641]/10 bg-[#0a3641] hover:bg-[#124e5d] text-white flex items-center justify-center space-x-2.5 transition-all text-xs font-bold uppercase tracking-wider cursor-pointer shadow-sm hover:shadow-md"
              >
                <span>Direct study: Blackboard / Clean White Board 🖊️🎨</span>
                <ChevronRight className="w-4 h-4 text-[#c4f500]" />
              </button>
            </div>
          </div>

          <div className="text-center pt-8 border-t border-[#dae1dd] mt-8">
            <p className="text-[10px] text-[#486a73] font-mono font-bold tracking-wider">CHERRY MA'AM SMART SCHOOL PLATFORM • SYLLABUS DIRECT TRANSFER LAYER</p>
          </div>
        </div>
      )}

      {/* =========================================
          SCREEN III: CLEAN IMMERSIVE CLASSROOM BOARD ROOM
          ========================================= */}
      {currentScreen === "classroom" && (
        <div className="flex-1 flex flex-col justify-between w-full h-[100dvh] md:h-screen overflow-hidden relative bg-[#04110e]">
          
          {/* Subtle Mobile Top HUD - Sleek Header Bar */}
          <header className="w-full bg-white border-b border-[#dae1dd] px-4 py-3 flex items-center justify-between z-20 shrink-0 font-mono select-none">
            <div className="flex items-center space-x-2 font-bold">
              <button
                onClick={() => {
                  disconnect();
                  setCurrentScreen("syllabus");
                }}
                className="p-1 px-2.5 rounded-lg text-[10px] font-extrabold uppercase border border-[#dae1dd] hover:border-[#0a3641] text-[#0a3641] hover:bg-[#c4f500]/10 transition-all flex items-center gap-1 cursor-pointer bg-[#f7f9f6]"
                title="Return to Study Desk"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Desk 🎒</span>
              </button>
              
              <span className="text-xs font-bold text-[#0a3641] hidden sm:inline ml-2 border-l border-[#dae1dd] pl-3">
                {studentDetails.name}'s Lesson
              </span>
            </div>

            {/* Cherry status indicator center */}
            <div className="flex items-center space-x-1.5 md:space-x-2.5">
              <span className={`w-2 h-2 rounded-full ${
                state === "disconnected" 
                  ? "bg-[#486a73] animate-pulse" 
                  : state === "error" 
                  ? "bg-red-500 animate-pulse" 
                  : (teachingPhase || "").toLowerCase() === "concept" && state === "speaking"
                  ? "bg-amber-500 animate-pulse"
                  : "bg-emerald-500 animate-ping"
              }`} />
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#0a3641]">
                {state === "disconnected" 
                  ? "Cherry: Recess" 
                  : state === "error"
                  ? "Cherry: Error"
                  : (teachingPhase || "").toLowerCase() === "concept" && state === "speaking"
                  ? "Cherry: Writing Board"
                  : `Cherry: ${state.toUpperCase()}`}
              </p>
            </div>

            <div className="flex items-center space-x-1.5 md:space-x-2">
              {/* Student Account profile triggers */}
              <button 
                onClick={() => setShowStudentAccountHub(true)}
                className="p-2 rounded-lg bg-[#f7f9f6] hover:bg-[#c4f500]/15 border border-[#dae1dd] text-[#0a3641] transition-all text-xs cursor-pointer flex items-center gap-1.5 font-bold"
                title="Open My Profile and Whiteboard Snapshots"
              >
                <User className="w-3.5 h-3.5 text-[#0a3641]" />
                <span className="text-[10px] hidden lg:inline">My Account</span>
              </button>

              {/* Theme quick toggler */}
              <button 
                onClick={() => {
                  const themesList: ThemeType[] = Object.keys(THEME_CONFIGS) as ThemeType[];
                  const nextIdx = (themesList.indexOf(theme) + 1) % themesList.length;
                  handleThemeChange(themesList[nextIdx]);
                }}
                className="p-2 rounded-lg bg-[#f7f9f6] hover:bg-[#c4f500]/15 border border-[#dae1dd] text-[#0a3641] transition-all text-xs cursor-pointer"
                title="Change Blackboard Theme"
              >
                <Palette className="w-3.5 h-3.5" />
              </button>

              <button 
                id="toggle-subtitles-btn"
                onClick={() => {
                  setShowCaptions(!showCaptions);
                  addToast(`Subtitles ${!showCaptions ? "Enabled" : "Disabled"}`, "info");
                }}
                className={`p-2 rounded-lg border transition-all text-xs flex items-center gap-1 cursor-pointer ${
                  showCaptions ? "bg-[#c4f500]/25 border-[#0a3641]/50 text-[#0a3641] font-bold" : "bg-[#f7f9f6] border-[#dae1dd] text-[#486a73]"
                }`}
                title="Toggle Captions"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
              
              <button 
                onClick={() => setShowTips(!showTips)}
                className="p-2 rounded-lg bg-[#f7f9f6] border border-[#dae1dd] text-[#0a3641] hover:bg-[#c4f500]/15 transition-all text-xs cursor-pointer"
                title="Help Guide"
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>

              {activeDocument && activeDocument.mimeType === "video/youtube" && (
                <button
                  onClick={() => setShowMobileYtPlayer(!showMobileYtPlayer)}
                  className={`p-2 rounded-lg border transition-all text-xs flex items-center gap-1.5 lg:hidden cursor-pointer ${
                    showMobileYtPlayer ? "bg-red-50 border-red-550 text-red-750 font-bold" : "bg-[#f7f9f6] border-[#dae1dd] text-[#486a73]"
                  }`}
                  title="Watch YouTube Source Video"
                >
                  <Youtube className="w-3.5 h-3.5 text-red-650" />
                  <span className="text-[9px] font-extrabold uppercase tracking-wide">Video</span>
                </button>
              )}
            </div>
          </header>

          {/* Core Interactive Blackboard Slate Section */}
          <div className="flex-1 flex flex-col md:flex-row relative min-h-0 w-full overflow-hidden">
            
            {/* WHITE BOARD: Spans entire layout width & height */}
            <div className="flex-1 flex flex-col relative h-full w-full min-h-0 bg-[#071613]">
              
              {/* Mobile YouTube Video Banner Overlay */}
              {showMobileYtPlayer && activeDocument?.mimeType === "video/youtube" && (() => {
                const matchYtId = activeDocument?.filename?.match(/\(ID:\s*([a-zA-Z0-9_-]{11})\)/);
                const currentVideoId = matchYtId ? matchYtId[1] : null;
                if (!currentVideoId) return null;
                return (
                  <div className="lg:hidden w-full bg-[#1e0a0a]/95 border-b border-red-500/20 p-2.5 space-y-2 animate-fade-in text-left">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-red-500 text-[10px] font-mono font-black uppercase">
                        <Youtube className="w-3.5 h-3.5 text-red-650 animate-pulse" />
                        <span>Source Video Guide</span>
                      </div>
                      <button
                        onClick={() => setShowMobileYtPlayer(false)}
                        className="text-[10px] font-bold text-red-400 hover:text-red-300 px-2 py-0.5 border border-red-500/30 rounded"
                      >
                        ✕ Close Player
                      </button>
                    </div>
                    <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black shadow-lg">
                      <iframe
                        src={`https://www.youtube.com/embed/${currentVideoId}?autoplay=0&rel=0`}
                        title="Chalkboard YouTube Mobile reference"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="absolute top-0 left-0 w-full h-full border-0"
                      />
                    </div>
                  </div>
                );
              })()}

              {uploadedButWaitingWakeup ? (
                <ClassroomBoard
                  latestSpeech=""
                  state={state}
                  primaryColor={activeColors.primary}
                  accentColor={activeColors.accent}
                  onClearBoard={() => {
                    setDialogueHistory([]);
                    setCustomBoardContent("");
                    setTopicBoardsContent({});
                  }}
                  onSelectPrompt={handleSelectPrompt}
                  overrideBlank={true}
                  activeDocumentText={activeDocument?.markdown || ""}
                  hasActiveDocument={!!activeDocument}
                  studentAskedForWritingOrDrawing={studentAskedForWritingOrDrawing}
                  isFullScreen={true}
                  onToggleFullScreen={() => {}}
                  cherryVolume={cherryVolume}
                  onOpenSyllabus={handleOpenSyllabus}
                  onWakeUp={handlePowerToggle}
                  teachingPhase={teachingPhase}
                  customBoardContent={customBoardContent}
                  onSaveSnapshot={handleManualSaveSnapshot}
                  topics={topics}
                  activeTopicIndex={activeTopicIndex}
                  topicBoardsContent={topicBoardsContent}
                  onSyncBoardContent={handleSyncBoardContent}
                />
              ) : state === "connecting" ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3 bg-[#0c201a] blackboard-chalk m-2 rounded-lg min-h-[300px]">
                  <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
                  <p className="text-zinc-400 text-xs font-mono tracking-widest uppercase">Preparing Blackboard slides...</p>
                </div>
              ) : (
                <ClassroomBoard
                  latestSpeech={latestSpeechText}
                  state={state}
                  primaryColor={activeColors.primary}
                  accentColor={activeColors.accent}
                  onClearBoard={() => {
                    setDialogueHistory([]);
                    setCustomBoardContent("");
                    setTopicBoardsContent({});
                  }}
                  onSelectPrompt={handleSelectPrompt}
                  activeDocumentText={activeDocument?.markdown || ""}
                  hasActiveDocument={!!activeDocument}
                  studentAskedForWritingOrDrawing={studentAskedForWritingOrDrawing}
                  isFullScreen={true}
                  onToggleFullScreen={() => {}}
                  cherryVolume={cherryVolume}
                  onOpenSyllabus={handleOpenSyllabus}
                  onWakeUp={handlePowerToggle}
                  teachingPhase={teachingPhase}
                  customBoardContent={customBoardContent}
                  onSaveSnapshot={handleManualSaveSnapshot}
                  topics={topics}
                  activeTopicIndex={activeTopicIndex}
                  topicBoardsContent={topicBoardsContent}
                  onSyncBoardContent={handleSyncBoardContent}
                />
              )}

              {/* FLOATING SUBTITLE FEED ON BOARD */}
              {showCaptions && dialogueHistory.length > 0 && (
                <div className="absolute bottom-16 inset-x-4 md:inset-x-8 z-20 pointer-events-none flex justify-center">
                  <div className="bg-white/95 backdrop-blur-md border border-[#0a3641]/20 text-[#0a3641] px-4 py-2.5 rounded-xl shadow-md text-[11px] sm:text-xs text-center max-w-xl animate-bounce-short leading-relaxed pointer-events-auto font-medium">
                    <span className="font-mono text-[#486a73] text-[10px] block uppercase tracking-wider mb-1 font-bold">Cherry Ma'am:</span>
                    <p className="italic">
                      &quot;{dialogueHistory.filter((item) => item.sender === "cherry").slice(-1)[0]?.text || "Speak loudly, let's learn!"}&quot;
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* SYLLABUS SPLIT DRAWER: Show side panel only on widescreen desktop (if user wants to monitor topics) */}
            {activeDocument && (
              <div className="hidden lg:flex flex-col w-80 bg-white border-l border-[#dae1dd] h-full overflow-hidden select-none">
                <div className="p-3 bg-[#f7f9f6] border-b border-[#dae1dd] flex items-center justify-between">
                  <span className="text-[10px] font-mono tracking-widest font-extrabold text-[#0a3641] uppercase flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#0a3641]" /> SYLLABUS TOPICS
                  </span>
                  <span className="text-[9px] bg-[#c4f500]/20 border border-[#0a3641]/15 px-2 py-0.5 rounded text-[#0a3641] uppercase font-mono font-extrabold shrink-0">
                    Topic {activeTopicIndex + 1}/{topics.length}
                  </span>
                </div>

                {/* Integrated YouTube Player Embed Block (Phase 3 Core Feature) */}
                {activeDocument.mimeType === "video/youtube" && (() => {
                  const matchYtId = activeDocument?.filename?.match(/\(ID:\s*([a-zA-Z0-9_-]{11})\)/);
                  const currentVideoId = matchYtId ? matchYtId[1] : null;
                  if (!currentVideoId) return null;
                  
                  return (
                    <div className="border-b border-[#dae1dd] bg-[#f7f9f6]/40 p-3.5 space-y-2 text-left">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-black text-red-600 uppercase flex items-center gap-1.5 leading-none">
                          <Youtube className="w-3.5 h-3.5 animate-pulse" /> Source Video
                        </span>
                        <button
                          onClick={() => setIsYtPlayerExpanded(!isYtPlayerExpanded)}
                          className="text-[9px] font-bold text-[#0a3641] hover:underline cursor-pointer font-mono"
                        >
                          {isYtPlayerExpanded ? "✕ COLLAPSE" : "➕ EXPAND VIDEO"}
                        </button>
                      </div>

                      {isYtPlayerExpanded && (
                        <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-[#dae1dd] bg-black shadow-inner">
                          <iframe
                            src={`https://www.youtube.com/embed/${currentVideoId}?autoplay=0&rel=0`}
                            title="Chalkboard YouTube reference"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            className="absolute top-0 left-0 w-full h-full border-0"
                          />
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 scrollbar-thin bg-white">
                  {topics.map((topicContent, idx) => {
                    const isTeachingNow = idx === activeTopicIndex;
                    const headingText = topicContent.split("\n")[0].replace(/[#*]/g, "").trim();
                    
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          setActiveTopicIndex(idx);
                          if (state === "connected" || state === "speaking" || state === "idle") {
                            injectPromptText(`Ma'am, explain section: "${headingText}". Solve it!`);
                            addToast(`Requested: ${headingText}`, "info");
                          } else {
                            addToast(`Selected: ${headingText}`, "info");
                          }
                        }}
                        className={`p-2.5 border rounded-lg text-left cursor-pointer transition-colors ${
                          isTeachingNow
                            ? "border-[#0a3641] bg-[#c4f500]/25 text-[#0a3641] font-bold"
                            : "border-[#dae1dd] bg-[#f7f9f6] hover:border-[#0a3641]/40 hover:bg-[#c4f500]/10 text-[#486a73]"
                        }`}
                      >
                        <h4 className="text-[11px] font-bold truncate leading-tight">
                          {idx + 1}. {headingText || "Topic"}
                        </h4>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* FLOATING ACTION BOTTOM LEDGE BAR (Voice Activation Visualizer & Reconnection Switch) */}
          <div className="hidden w-full bg-white border-t border-[#dae1dd] py-3.5 px-4 flex flex-col md:flex-row items-center justify-between gap-3.5 shrink-0 z-10 select-none">
            
            {/* Connection Switch controller bar */}
            <div className="flex items-center space-x-3 w-full md:w-auto justify-between md:justify-start overflow-hidden">
              <button
                id="activate-cherry-btn"
                onClick={handlePowerToggle}
                className={`px-4 py-2 rounded-xl text-[10px] font-mono font-extrabold uppercase tracking-widest flex items-center gap-2 transition-all duration-300 cursor-pointer shadow-sm shrink-0 border ${
                  state === "disconnected" 
                    ? "bg-[#c4f500] hover:bg-[#b0dc00] border-[#0a3641]/20 text-[#0a3641] hover:shadow-[0_4px_12px_rgba(196,245,0,0.3)]" 
                    : state === "error"
                    ? "bg-red-850 hover:bg-red-700 border-red-500 text-white"
                    : "bg-[#f7f9f6] hover:bg-[#dae1dd] border-[#dae1dd] text-[#0a3641] hover:text-[#0a3641]"
                }`}
              >
                {state === "disconnected" ? (
                  <>
                    <Power className="w-4 h-4 text-[#0a3641] animate-pulse" />
                    <span>Start Session / Wake Up Ma'am</span>
                  </>
                ) : state === "connecting" ? (
                  <>
                    <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
                    <span>Connecting Slides...</span>
                  </>
                ) : state === "error" ? (
                  <>
                    <RefreshCw className="w-4 h-4 text-red-300" />
                    <span>Class Dropped • Reconnect</span>
                  </>
                ) : (
                  <>
                    <MicOff className="w-4 h-4 text-[#0a3641]" />
                    <span>Halt Lesson • Go Recess</span>
                  </>
                )}
              </button>

              <span className="text-[10px] text-[#486a73] italic font-mono truncate max-w-[180px] hidden sm:block font-bold">
                {getSubTitleText()}
              </span>
            </div>

            {/* Live voice activity wave animation */}
            {state !== "disconnected" && (
              <div className="w-full md:w-64 h-10 border border-[#dae1dd] bg-[#f7f9f6]/50 rounded-xl overflow-hidden shrink-0 flex items-center justify-center">
                <WaveVisualizer 
                  state={state} 
                  theme={activeColors} 
                  userVolume={userVolume}
                  cherryVolume={cherryVolume}
                />
              </div>
            )}

            {/* Direct manual LaTeX text assistant */}
            <div className="w-full md:w-auto flex items-center space-x-2.5 shrink-0">
              <span className="text-[9px] bg-[#c4f500]/25 border border-[#0a3641]/15 px-2.5 py-1.5 rounded-lg text-[#0a3641] uppercase font-extrabold tracking-wider font-mono">
                ASR Audio Synced
              </span>
            </div>
          </div>

        </div>
      )}

      {/* HELP INSTRUCTIONS & SIDEBAR DRAWER PANEL */}
      <AnimatePresence>
        {showTips && (
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="w-full bg-white border-t border-[#dae1dd] p-6 z-20"
          >
            <div className="max-w-xl mx-auto space-y-4 text-left">
              <div className="flex items-center justify-between border-b border-[#dae1dd] pb-2.5">
                <h3 className="text-sm font-mono tracking-wider text-[#0a3641] uppercase flex items-center gap-1.5 font-bold"><GraduationCap className="w-4 h-4 text-[#0a3641]"/> Class Information & Tips</h3>
                <button 
                  id="close-tips-btn"
                  onClick={() => setShowTips(false)} 
                  className="text-xs text-[#486a73] hover:text-[#0a3641] underline cursor-pointer font-bold"
                >
                  Close
                </button>
              </div>
              <ul className="text-xs text-[#486a73] space-y-2.5 list-disc pl-4 leading-relaxed p-1 font-medium">
                <li>
                  <strong className="text-[#0a3641]">Live Voice Learning</strong>: Cherry Ma'am communicates strictly over live interactive audio. No boring typing inputs required—just speak casually!
                </li>
                <li>
                  <strong className="text-[#0a3641]">Hinglish Medium</strong>: Ask in a blend of Hindi & English. She responds in a friendly, conversational mix of casual Hinglish, like a super-smart buddy.
                </li>
                <li>
                  <strong className="text-[#0a3641]">Math & Science Formulas</strong>: Ask for Maths calculations, Physics numerical equations, or Chemical bonds. She outputs formatted LaTeX equations, rendered live in pristine blackboard style on screen!
                </li>
                <li>
                  <strong className="text-[#0a3641]">Speech and Typing Parity</strong>: The blackboard typewriter automatically tracks and coordinates characters rendering dynamically matched with the exact pacing of her vocalization.
                </li>
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DRAWER FOOTER LOGO CREDITS (rendered only when on home screen for pristine cleanliness on board) */}
      {currentScreen === "home" && (
        <footer className="w-full text-center py-4 border-t border-[#dae1dd] text-[10px] font-mono tracking-widest text-[#486a73] z-10 select-none font-bold">
          CHERRY MA'AM • THE SASSY INTERACTIVE CLASSROOM • POWERED BY GEMINI LIVE BIDIRECTIONAL BATCH
        </footer>
      )}

      {/* Dynamic Student Account overlays & Whiteboard Camera Snapper */}
      <AnimatePresence>
        {showStudentAccountHub && (
          <StudentAccountHub
            onClose={() => setShowStudentAccountHub(false)}
            studentName={studentDetails.name}
            grade={studentDetails.grade}
            subject={studentDetails.subject}
            board={studentDetails.board}
            mediumOfLearning={studentDetails.mediumOfLearning}
            totalSessionsCount={pastSessions.length}
            customBoardContent={customBoardContent}
            pastSessions={pastSessions}
            sessionSnapshots={sessionSnapshots}
            topics={topics}
            activeTopicIndex={activeTopicIndex}
            topicBoardsContent={topicBoardsContent}
            sessionId={sessionId}
            onRefreshProfile={async () => {
              if (user) {
                try {
                  const profileRef = doc(db, "studentProfiles", user.uid);
                  const profileSnap = await getDoc(profileRef);
                  if (profileSnap.exists()) {
                     const data = profileSnap.data();
                     setStudentDetails({
                       name: data.name || "",
                       grade: data.grade || "Class 10",
                       subject: data.subject || "Mathematics",
                       board: data.board || "CBSE",
                       mediumOfLearning: data.mediumOfLearning || "Hinglish"
                     });
                  }
                } catch (e) {
                  console.error("Failed refreshing active settings:", e);
                }
              }
            }}
          />
        )}

        {showOnboarding && (
          <StudentOnboardingForm
            initialName={studentDetails.name}
            onSubmit={handleOnboardingSubmit}
          />
        )}

        {showLoginModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-teal-100/50 overflow-hidden relative"
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setShowLoginModal(false)}
                className="absolute top-4 right-4 text-slate-450 hover:text-slate-700 transition-colors w-8 h-8 rounded-full bg-slate-100/80 hover:bg-slate-200/80 flex items-center justify-center cursor-pointer font-bold text-xs"
              >
                ✕
              </button>

              {/* Header Banner */}
              <div className="bg-[#0a3641] px-6 py-6 text-white relative text-center">
                <div className="w-12 h-12 rounded-xl bg-[#c4f500]/10 border border-[#c4f500]/20 flex items-center justify-center mx-auto mb-3 text-[#c4f500]">
                  <GraduationCap className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold tracking-tight">Student Login & Registration</h3>
                <p className="text-teal-100/70 text-[11px] mt-1 max-w-xs mx-auto font-medium">
                  Connect your profile to save stats, classroom sessions, and custom syllabi.
                </p>
              </div>

              {/* Login Modal Body */}
              <div className="p-6 space-y-5 text-left">
                {/* Fast Access via Google */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#486a73] block">
                    Fast Access via Cloud Profile
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await handleGoogleSignIn();
                        setShowLoginModal(false);
                      } catch (err) {
                        console.error("Popup Error:", err);
                      }
                    }}
                    className="w-full bg-white hover:bg-slate-50 text-[#0a3641] border border-[#dae1dd] py-3 px-4 rounded-xl flex items-center justify-center gap-2.5 transition-all shadow-sm cursor-pointer text-xs font-bold hover:border-[#0a3641]/40"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                    <span>Login with Google Account</span>
                  </button>
                </div>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-[#dae1dd]"></div>
                  <span className="flex-shrink mx-3 text-[10px] font-mono text-slate-400 font-bold uppercase">Or Guest Access / या बिना अकाउंट</span>
                  <div className="flex-grow border-t border-[#dae1dd]"></div>
                </div>

                {/* Anonymous Guest Registration */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!studentDetails.name.trim()) {
                      addToast("Please tell us your name first to sit on the desk! 🧑‍🎓", "error");
                      return;
                    }

                    try {
                      let currentUser = auth.currentUser;
                      if (!currentUser) {
                        const anonResult = await signInAnonymously(auth);
                        currentUser = anonResult.user;
                      }

                      if (currentUser) {
                        const profileRef = doc(db, "studentProfiles", currentUser.uid);
                        setDoc(profileRef, {
                          userId: currentUser.uid,
                          name: studentDetails.name,
                          grade: studentDetails.grade,
                          subject: studentDetails.subject || "Mathematics",
                          board: studentDetails.board || "CBSE",
                          mediumOfLearning: studentDetails.mediumOfLearning || "Hinglish",
                          updatedAt: serverTimestamp()
                        }).then(() => {
                          loadPastSessions(currentUser!.uid);
                        }).catch((dbErr: any) => {
                          console.warn("Firestore guest profile issue background:", dbErr);
                        });
                        addToast(`Namaste, ${studentDetails.name}! Profile set up successfully! 🎒✨`, "success");
                      }
                      setShowLoginModal(false);
                      setCurrentScreen("syllabus");
                    } catch (err: any) {
                      console.error("Auth routing exception:", err);
                      setShowLoginModal(false);
                      setCurrentScreen("syllabus");
                    }
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-mono font-bold text-[#486a73] block">
                      Student Name / आपका नाम
                    </label>
                    <input
                      type="text"
                      required
                      value={studentDetails.name}
                      onChange={(e) => setStudentDetails({ ...studentDetails, name: e.target.value })}
                      placeholder="E.g., Nehal Sharma"
                      className="w-full bg-[#f7f9f6] border border-[#dae1dd] focus:border-[#0a3641] focus:ring-1 focus:ring-[#0a3641]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#0a3641] placeholder-[#486a73]/50 outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-mono font-bold text-[#486a73] block">
                      Your Grade Level / क्लास
                    </label>
                    <div className="relative">
                      <select
                        value={studentDetails.grade}
                        onChange={(e) => setStudentDetails({ ...studentDetails, grade: e.target.value })}
                        className="w-full bg-[#f7f9f6] text-[#0a3641] border border-[#dae1dd] focus:border-[#0a3641] rounded-xl px-3.5 py-2.5 text-xs outline-none appearance-none cursor-pointer font-medium"
                      >
                        <option value="Class 6">Class 6</option>
                        <option value="Class 7">Class 7</option>
                        <option value="Class 8">Class 8</option>
                        <option value="Class 9">Class 9</option>
                        <option value="Class 10">Class 10</option>
                        <option value="Class 11">Class 11</option>
                        <option value="Class 12">Class 12</option>
                      </select>
                      <div className="absolute inset-y-0 right-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-[9px]">
                        ▼
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-[#0a3641] hover:bg-[#124e5d] text-white font-extrabold text-xs py-3 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer select-none"
                  >
                    <span>Register & Study 🎒</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </form>
              </div>

              <div className="border-t border-[#dae1dd] py-3.5 bg-slate-50 text-center">
                <span className="text-[9px] font-mono font-bold text-[#486a73] flex items-center justify-center gap-1">
                  🔒 Encrypted instant guest/google session setup
                </span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ABSOLUTE FLOATING SYSTEM TOAST notifications */}
      <div id="toast-container" className="absolute top-20 right-6 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.9 }}
              className={`p-3.5 rounded-xl border backdrop-blur-md shadow-lg flex items-center space-x-2.5 text-xs font-mono pointer-events-auto select-none ${
                toast.type === "success" 
                  ? "bg-white border-[#dae1dd] text-[#0a3641] font-bold"
                  : toast.type === "error"
                  ? "bg-red-50 border-red-200 text-red-700 font-bold"
                  : "bg-white border-zinc-250 text-zinc-700"
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0 text-[#0a3641]" />
              <span>{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

    </div>
  );
}
