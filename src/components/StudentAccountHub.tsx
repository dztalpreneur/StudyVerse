import React, { useState, useEffect, useMemo } from "react";
import { 
  User, Award, Calendar, Clock, BookOpen, Download, Trash2, 
  Sparkles, X, LayoutGrid, FileText, Share2, Shield, Bookmark, HardDriveDownload,
  Search, ChevronRight, ChevronDown, Folder, FolderOpen, Youtube
} from "lucide-react";
import katex from "katex";
import { db, auth } from "../lib/firebase"; // Import database configuration
import { 
  collection, 
  getDocs, 
  addDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp,
  updateDoc
} from "firebase/firestore";

interface BoardSnapshot {
  id: string;
  snapshotId: string;
  userId: string;
  topicTitle: string;
  description: string;
  imgData: string; // Base64 Compressed Image
  timestamp: any;
}

interface StudentAccountHubProps {
  onClose: () => void;
  studentName: string;
  grade: string;
  subject: string;
  board?: string;
  mediumOfLearning?: string;
  totalSessionsCount?: number;
  onRefreshProfile?: () => void;
  customBoardContent?: string;
  pastSessions?: any[];
  sessionSnapshots?: any[];
  topics?: string[];
  activeTopicIndex?: number;
  topicBoardsContent?: Record<number, string>;
  sessionId?: string | null;
}

const escapeHTML = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const compileWhiteboardToHTML = (markdown: string): string => {
  if (!markdown || !markdown.trim()) {
    return `<div style="text-align: center; color: #64748b; font-family: sans-serif; padding: 40px; font-size: 13px;">No blackboard formulas written in this session yet.</div>`;
  }

  // Pre-normalize LaTeX markdown delimiters to standard $ and $$ for easier matching
  let normalized = markdown
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");

  // Clean SVG elements for PDF export
  normalized = normalized.replace(/<svg[\s\S]*?<\/svg>/gi, " <div class='def-pdf-card' style='background: #f0fdfa; border-left-color: #0d9488;'><span class='def-pdf-label' style='color: #0d9488;'>[Vector Blackboard Illustration]</span><span class='def-pdf-detail' style='color: #0f766e;'>Interactive diagram is active on the electronic whiteboard screen.</span></div> ");

  // Split content by display math blocks
  // Regex matches $$...$$ or \begin{env}...\end{env}
  const displayMathRegex = /(\$\$[\s\S]*?\$\$|\\begin\s*\{\s*[a-zA-Z*]+\s*\}[\s\S]*?\\end\s*\{\s*[a-zA-Z*]+\s*\})/gi;
  const parts = normalized.split(displayMathRegex);

  let htmlResult = "";

  parts.forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;

    const isBlockMath = (trimmed.startsWith("$$") && trimmed.endsWith("$$")) || 
                        /^\\begin\s*\{\s*[a-zA-Z*]+\s*\}/i.test(trimmed);

    if (isBlockMath) {
      const isEnv = /^\\begin\s*\{\s*[a-zA-Z*]+\s*\}/i.test(trimmed);
      let formula = isEnv ? trimmed : trimmed.slice(2, -2).trim();
      
      // Clean up double-backslashes inside formulas (preventing duplicate escaping)
      formula = formula.replace(/\\\\([a-zA-Z]+)/g, "\\$1");
      formula = formula.replace(/\\\\([{}_^#&%|()[\]])/g, "\\$1");
      // Normalize spaces inside \begin / \end
      formula = formula.replace(/\\begin\s*\{\s*([a-zA-Z*]+)\s*\}/gi, "\\begin{$1}");
      formula = formula.replace(/\\end\s*\{\s*([a-zA-Z*]+)\s*\}/gi, "\\end{$1}");

      try {
        const formulaHtml = katex.renderToString(formula, { displayMode: true, throwOnError: false });
        htmlResult += `
          <div class="block-math-pdf-container">
            ${formulaHtml}
          </div>
        `;
      } catch (err) {
        htmlResult += `<div class="error-math-pdf">${escapeHTML(formula)}</div>`;
      }
    } else {
      // Process lines for regular text, headings, lists, and inline math
      const lines = part.split(/\n+/);
      lines.forEach((line) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        // Check if line is a bullet/list item
        const isBullet = trimmedLine.startsWith("-") || trimmedLine.startsWith("*") || trimmedLine.startsWith("•");
        // Check if line is a definition list item (contains ":" or labels like "🌟")
        const isDefinition = trimmedLine.includes(":") && (trimmedLine.startsWith("🌟") || trimmedLine.startsWith("💡") || trimmedLine.startsWith("📌"));
        // Check if heading
        const isHeading = trimmedLine.startsWith("📌") || trimmedLine.startsWith("#") || trimmedLine.startsWith("###");

        // Parse inline math $...$
        let parsedLine = trimmedLine;
        
        // Find $...$ inline math segments
        const inlineMathRegex = /\$([\s\S]*?)\$/g;
        parsedLine = parsedLine.replace(inlineMathRegex, (match, formula) => {
          try {
            return katex.renderToString(formula, { displayMode: false, throwOnError: false });
          } catch {
            return match;
          }
        });

        // Parse Markdown formatting like bold **...**
        parsedLine = parsedLine.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        // Parse code blocks `...`
        parsedLine = parsedLine.replace(/`(.*?)`/g, "<code>$1</code>");

        if (isHeading) {
          const headingText = parsedLine.replace(/^📌|^#+\s*/g, "").trim();
          htmlResult += `<h3 class="heading-pdf">${headingText}</h3>`;
        } else if (isDefinition) {
          const colonIdx = parsedLine.indexOf(":");
          const label = parsedLine.substring(0, colonIdx).trim();
          const detail = parsedLine.substring(colonIdx + 1).trim();
          htmlResult += `
            <div class="def-pdf-card">
              <span class="def-pdf-label">${label}</span>
              <span class="def-pdf-detail">${detail}</span>
            </div>
          `;
        } else if (isBullet) {
          const bulletText = parsedLine.replace(/^[-*•]\s*/, "").trim();
          htmlResult += `<li class="bullet-pdf">${bulletText}</li>`;
        } else {
          htmlResult += `<p class="paragraph-pdf">${parsedLine}</p>`;
        }
      });
    }
  });

  return htmlResult;
};

export const StudentAccountHub: React.FC<StudentAccountHubProps> = ({
  onClose,
  studentName,
  grade,
  subject,
  board = "CBSE",
  mediumOfLearning = "Hinglish",
  totalSessionsCount = 0,
  onRefreshProfile,
  customBoardContent = "",
  pastSessions = [],
  sessionSnapshots = [],
  topics = [],
  activeTopicIndex = 0,
  topicBoardsContent = {},
  sessionId = null
}) => {
  const [snapshots, setSnapshots] = useState<BoardSnapshot[]>([]);
  
  // Overhauled Archived PDF system core states
  const [archiveSearchQuery, setArchiveSearchQuery] = useState("");
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});

  // Group and format sessions under subject-wise nested architecture
  const sortedAndGroupedSessions = useMemo(() => {
    const groups: Record<string, any[]> = {};

    pastSessions.forEach((sess, index) => {
      // Descriptive user-friendly title
      const originalTitle = sess.activeDocumentName || `Class Lecture Hand-Handbook #${pastSessions.length - index}`;
      
      const creationDate = sess.createdAt || sess.updatedAt;
      let dateString = "Recently Synced";
      if (creationDate) {
        try {
          const date = creationDate.toDate ? creationDate.toDate() : new Date(creationDate.seconds ? creationDate.seconds * 1000 : creationDate);
          
          // Formatter options to generate precisely: "06 June 2026, 03:50 PM"
          const months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
          ];
          const dayVal = String(date.getDate()).padStart(2, "0");
          const monthVal = months[date.getMonth()];
          const yearVal = date.getFullYear();
          let hours = date.getHours();
          const minutes = String(date.getMinutes()).padStart(2, "0");
          const ampm = hours >= 12 ? "PM" : "AM";
          hours = hours % 12;
          hours = hours ? hours : 12; // the hour '0' should be '12'
          const timeVal = `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
          
          dateString = `${dayVal} ${monthVal} ${yearVal}, ${timeVal}`;
        } catch (e) {
          dateString = "Recently Synced";
        }
      }

      const processedSess = {
        ...sess,
        processedTitle: originalTitle,
        formattedDateTime: dateString,
        index: pastSessions.length - index,
      };

      // Filter based on search query
      const searchTarget = `${processedSess.processedTitle} ${processedSess.subject || "General Syllabus"} ${processedSess.formattedDateTime}`.toLowerCase();
      const queryLower = archiveSearchQuery.toLowerCase();

      if (!archiveSearchQuery || searchTarget.includes(queryLower)) {
        const subName = processedSess.subject ? processedSess.subject.trim() : "General Syllabus";
        if (!groups[subName]) {
          groups[subName] = [];
        }
        groups[subName].push(processedSess);
      }
    });

    return groups;
  }, [pastSessions, archiveSearchQuery]);

  // Hook to expand all matching folders upon entering search criteria
  useEffect(() => {
    if (archiveSearchQuery) {
      const activeSubjects = Object.keys(sortedAndGroupedSessions);
      const expandedState: Record<string, boolean> = {};
      activeSubjects.forEach(sub => {
        expandedState[sub] = true;
      });
      setExpandedSubjects(expandedState);
    }
  }, [archiveSearchQuery, sortedAndGroupedSessions]);
  
  // Combine Firestore snapshots and memory session snapshots for guest compatibility
  const allSnapshots = useMemo(() => {
    const combined = [...snapshots];
    if (sessionSnapshots && sessionSnapshots.length > 0) {
      sessionSnapshots.forEach((local) => {
        const exists = combined.some((fb) => fb.snapshotId === local.snapshotId || fb.topicTitle === local.topicTitle);
        if (!exists) {
          combined.push({
            id: local.id,
            snapshotId: local.snapshotId,
            userId: local.userId,
            topicTitle: local.topicTitle,
            description: local.description,
            imgData: local.imgData,
            timestamp: local.timestamp
          });
        }
      });
    }
    return combined;
  }, [snapshots, sessionSnapshots]);

  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [activeTab, setActiveTab] = useState<"activity" | "gallery">("activity");
  const [editingProfile, setEditingProfile] = useState(false);
  
  // States for student editable metrics
  const [editName, setEditName] = useState(studentName);
  const [editGrade, setEditGrade] = useState(grade);
  const [editSubject, setEditSubject] = useState(subject);
  const [editBoard, setEditBoard] = useState(board);
  const [editMediumOfLearning, setEditMediumOfLearning] = useState(mediumOfLearning);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    setEditName(studentName);
    setEditGrade(grade);
    setEditSubject(subject);
    setEditBoard(board);
    setEditMediumOfLearning(mediumOfLearning);
  }, [studentName, grade, subject, board, mediumOfLearning]);

  const currentUser = auth.currentUser;

  // Retrieve blackboard snapshots from Firebases
  const fetchSnapshots = async () => {
    if (!currentUser) return;
    setLoadingSnapshots(true);
    try {
      const snapRef = collection(db, "studentProfiles", currentUser.uid, "boardSnapshots");
      const q = query(snapRef, orderBy("timestamp", "desc"));
      const snapshotDocs = await getDocs(q);
      const parsed = snapshotDocs.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          snapshotId: d.snapshotId || docSnap.id,
          userId: d.userId,
          topicTitle: d.topicTitle || "Mathematics Concept Formulation",
          description: d.description || "Interactive calculation whiteboard screenshot.",
          imgData: d.imgData,
          timestamp: d.timestamp
        } as BoardSnapshot;
      });
      setSnapshots(parsed);
    } catch (e) {
      console.error("Error reading student whiteboard snapshots:", e);
    } finally {
      setLoadingSnapshots(false);
    }
  };

  useEffect(() => {
    fetchSnapshots();
  }, [currentUser]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setSavingProfile(true);
    try {
      const profileRef = doc(db, "studentProfiles", currentUser.uid);
      await updateDoc(profileRef, {
        name: editName,
        grade: editGrade,
        subject: editSubject,
        board: editBoard,
        mediumOfLearning: editMediumOfLearning,
        updatedAt: serverTimestamp()
      });
      setEditingProfile(false);
      if (onRefreshProfile) onRefreshProfile();
    } catch (err) {
      console.error("Failed saving student updates:", err);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDeleteSnapshot = async (id: string) => {
    if (!currentUser) return;
    if (!confirm("Are you sure you want to delete this board snapshot from your cloud profile?")) return;
    try {
      await deleteDoc(doc(db, "studentProfiles", currentUser.uid, "boardSnapshots", id));
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error("Failed deleting snapshot document:", e);
    }
  };

  const handleDownloadImage = (snapshot: BoardSnapshot) => {
    try {
      const link = document.createElement("a");
      link.href = snapshot.imgData;
      link.download = `${snapshot.topicTitle.replace(/[^a-zA-Z0-9]/g, "_")}_board.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed downloading snapshot image file:", err);
    }
  };

  const formatDate = (ts: any) => {
    if (!ts) return "Just now";
    try {
      const date = ts.toDate ? ts.toDate() : new Date(ts);
      return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "Saved Topic";
    }
  };

  const handleExportSessionToPDF = (sess: any) => {
    try {
      const isCurrentSessionObj = !sess || sess.sessionId === sessionId;
      const cleanSessionTitle = sess && sess.activeDocumentName 
        ? sess.activeDocumentName 
        : (isCurrentSessionObj ? (subject + " - Active Classroom Session") : "Classroom Lecture Notes");
      
      const sessionDateStr = sess && sess.updatedAt?.seconds 
        ? new Date(sess.updatedAt.seconds * 1000).toLocaleString()
        : new Date().toLocaleString();

      const sessTopics = sess && sess.topics ? sess.topics : (isCurrentSessionObj ? topics : []);
      const sessTopicBoards = sess && sess.topicBoardsContent ? sess.topicBoardsContent : (isCurrentSessionObj ? topicBoardsContent : {});
      const sessCustomBoard = sess && sess.customBoardContent ? sess.customBoardContent : (isCurrentSessionObj ? customBoardContent : "");

      let compiledHtml = "";

      if (sessTopics && sessTopics.length > 0) {
        // Compile all topic sequential parts with their chalk content!
        sessTopics.forEach((topicText: string, index: number) => {
          const headerLine = topicText.split("\n")[0] || "";
          const cleanHeader = headerLine.replace(/[\#\*\_]/g, "").trim() || `Topic Part ${index + 1}`;
          
          const boardContentForTopic = sessTopicBoards[index] || "";
          
          // Fallback to custom board content for first page if empty
          let displayNotes = boardContentForTopic;
          if (index === 0 && !displayNotes && sessCustomBoard) {
            displayNotes = sessCustomBoard;
          }
          
          const cleanNotes = displayNotes ? displayNotes.trim() : "";
          const notesHTML = compileWhiteboardToHTML(cleanNotes || "_No lecture notes written on this topic yet._");

          compiledHtml += `
            <div class="pdf-page-wrapper" style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1.5px dashed rgba(255, 255, 255, 0.15); page-break-inside: avoid;">
              <div class="slide-header" style="display: flex; justify-content: space-between; font-size: 10px; font-family: 'JetBrains Mono', monospace; color: #c4f500; font-weight: bold; padding-bottom: 8px; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                <span>📝 TOPIC SECTION ${index + 1}</span>
                <span>CHERRY LECTURE HANDOUT</span>
              </div>
              <h2 class="slide-title" style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; color: #ffffff; margin-top: 0; margin-bottom: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">
                📌 ${cleanHeader}
              </h2>
              <div class="parsed-latex-topic-content font-chalk text-left" style="background-color: #0b241e; border: 1.5px solid rgba(196, 245, 0, 0.15); color: #f3f4f6; padding: 20px; border-radius: 12px; font-family: 'Inter', sans-serif; font-size: 12.5px; line-height: 1.7; box-shadow: inset 0 2px 6px rgba(0,0,0,0.3);">
                ${notesHTML}
              </div>
            </div>
          `;
        });
      } else {
        // Fallback for single general topic
        const cleanContent = sessCustomBoard ? sessCustomBoard.trim() : "";
        const notesHTML = compileWhiteboardToHTML(cleanContent || "_No whiteboard chalk notes written yet._");
        compiledHtml += `
          <div class="pdf-page-wrapper" style="margin-bottom: 24px;">
            <div class="slide-header" style="display: flex; justify-content: space-between; font-size: 10px; font-family: 'JetBrains Mono', monospace; color: #c4f500; font-weight: bold; padding-bottom: 8px; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08);">
              <span>📝 BLACKBOARD SHEET</span>
              <span>CHERRY LECTURE HANDOUT</span>
            </div>
            <h2 class="slide-title" style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; color: #ffffff; margin-top: 0; margin-bottom: 12px; font-weight: 800; text-transform: uppercase;">
              📌 Main Chalkboard Calculations
            </h2>
            <div class="parsed-latex-topic-content font-chalk text-left" style="background-color: #0b241e; border: 1.5px solid rgba(196, 245, 0, 0.15); color: #f3f4f6; padding: 20px; border-radius: 12px; font-family: 'Inter', sans-serif; font-size: 12.5px; line-height: 1.7; box-shadow: inset 0 2px 6px rgba(0,0,0,0.3);">
              ${notesHTML}
            </div>
          </div>
        `;
      }

      // 2. Open pop-up window formatted perfectly as a digital Blackboard hand-book
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        alert("Pop-up blocker is preventing PDF generation. Please allow pop-ups for this site to export study materials!");
        return;
      }

      const bookTitle = `${cleanSessionTitle} - Blackboard Book`;

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${bookTitle.replace(/[^a-zA-Z0-9]/g, "_")}</title>
          <meta charset="utf-8">
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;505;600;700;850&family=Space+Grotesk:wght@600;750;850&family=JetBrains+Mono&display=swap">
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
          <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
          <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js"></script>
          <style>
            body {
              font-family: 'Inter', system-ui, sans-serif;
              color: #f1f5f9;
              line-height: 1.6;
              margin: 0;
              padding: 30px;
              background-color: #041411; /* Dark aesthetic blackboard classroom canvas background */
            }
            .book-container {
              max-width: 860px;
              margin: 0 auto;
              background: #061c18; /* Rich slate dark green board sheet */
              border: 1.5px solid rgba(196, 245, 0, 0.2);
              border-radius: 20px;
              padding: 40px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.4);
            }
            .print-header {
              border-bottom: 2px solid #c4f500;
              padding-bottom: 16px;
              margin-bottom: 24px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .print-title {
              font-family: 'Space Grotesk', sans-serif;
              color: #ffffff;
              font-size: 20px;
              font-weight: 850;
              letter-spacing: -0.5px;
              margin: 0;
              text-transform: uppercase;
            }
            .print-subtitle {
              color: #c4f500;
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 1.5px;
              margin: 4px 0 0 0;
            }
            .print-brand {
              font-family: 'Space Grotesk', sans-serif;
              font-weight: 800;
              font-size: 11px;
              color: #061c18;
              background-color: #c4f500;
              padding: 6px 14px;
              border-radius: 8px;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
              background-color: rgba(196, 245, 0, 0.05);
              padding: 18px;
              border-radius: 12px;
              margin-bottom: 30px;
              border: 1px solid rgba(196, 245, 0, 0.1);
            }
            .meta-item {
              display: flex;
              flex-direction: column;
            }
            .meta-label {
              font-size: 9px;
              font-family: 'JetBrains Mono', monospace;
              text-transform: uppercase;
              color: #8fa09d;
              font-weight: 700;
              letter-spacing: 0.5px;
            }
            .meta-value {
              font-size: 12px;
              font-weight: 700;
              color: #ffffff;
              margin-top: 2px;
            }
            .block-math-pdf-container {
              background: rgba(255,255,255,0.04);
              border-radius: 8px;
              padding: 16px;
              margin: 16px 0;
              overflow-x: auto;
              border-left: 3.5px solid #c4f500;
              text-align: center;
              box-shadow: inset 0 1px 4px rgba(0,0,0,0.2);
            }
            .block-math-pdf-container .katex-display {
              margin: 0;
            }
            .def-pdf-card {
              border-left: 4px solid #c4f500;
              background-color: rgba(255,255,255,0.03);
              padding: 12px;
              border-radius: 0 8px 8px 0;
              margin: 12px 0;
            }
            .def-pdf-label {
              display: block;
              font-weight: 800;
              font-family: 'Space Grotesk', sans-serif;
              font-size: 11px;
              color: #c4f500;
              text-transform: uppercase;
              letter-spacing: 1px;
              margin-bottom: 2px;
            }
            .def-pdf-detail {
              font-size: 12px;
              color: #e2e8f0;
            }
            .heading-pdf {
              font-family: 'Space Grotesk', sans-serif;
              font-size: 13px;
              color: #c4f500;
              border-bottom: 1px solid rgba(255,255,255,0.1);
              padding-bottom: 4px;
              margin-top: 20px;
              margin-bottom: 10px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .print-footer {
              margin-top: 40px;
              border-top: 1px solid rgba(196,245,0,0.15);
              padding-top: 16px;
              font-size: 10.5px;
              color: #cbd5e1;
              font-weight: 600;
              text-transform: uppercase;
              text-align: center;
              letter-spacing: 1px;
            }
            .action-panel {
              background: #082621;
              border: 1.5px dashed rgba(196, 245, 0, 0.3);
              border-radius: 12px;
              padding: 16px;
              margin-bottom: 24px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              color: white;
            }
            .action-btn {
              background-color: #c4f500;
              color: #061c18;
              border: none;
              padding: 10px 20px;
              font-size: 12px;
              font-family: 'Space Grotesk', sans-serif;
              font-weight: 800;
              border-radius: 8px;
              cursor: pointer;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              transition: all 0.2s;
            }
            .action-btn:hover {
              background-color: #b0dc00;
              transform: translateY(-1px);
            }
            @media print {
              .no-print {
                display: none !important;
              }
              body {
                padding: 0;
                background-color: transparent;
                color: #000000 !important;
              }
              .book-container {
                border: none;
                padding: 0;
                box-shadow: none;
                background: transparent !important;
              }
              .print-title {
                color: #1e293b !important;
              }
              .print-brand {
                border: 1.5px solid #0f766e !important;
                background-color: transparent !important;
                color: #0f766e !important;
              }
              .meta-grid {
                background-color: #f1f5f9 !important;
                border: 1px solid #cbd5e1 !important;
              }
              .meta-value {
                color: #1e293b !important;
              }
              .meta-label {
                color: #64748b !important;
              }
              .parsed-latex-topic-content {
                background-color: #f8fafc !important;
                border: 1.5px solid #e2e8f0 !important;
                color: #1e293b !important;
                box-shadow: none !important;
              }
              .block-math-pdf-container {
                background: #f1f5f9 !important;
                border-left-color: #0f766e !important;
              }
              .heading-pdf {
                color: #0f766e !important;
                border-bottom-color: #cbd5e1 !important;
              }
              .def-pdf-card {
                border-left-color: #0f766e !important;
              }
              .def-pdf-label {
                color: #0f766e !important;
              }
              .def-pdf-detail {
                color: #334155 !important;
              }
              body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="action-panel no-print">
            <div style="text-align: left;">
              <span style="font-size: 13px; font-weight: 850; color: #ffffff;">Board-Book Generation Center</span>
              <p style="font-size: 11px; color: #cbd5e1; margin: 4px 0 0 0;">Review your formatted math calculations & chalkboard slides, then tap below to download as a secure PDF.</p>
            </div>
            <button class="action-btn" onclick="window.print()">🖨️ Save as PDF / Print Book</button>
          </div>

          <div class="book-container">
            <div class="print-header">
              <div style="text-align: left;">
                <h1 class="print-title">${cleanSessionTitle}</h1>
                <p class="print-subtitle">Maestry Whiteboard Session Study Handout</p>
              </div>
              <div class="print-brand">
                Cherry Ma'am
              </div>
            </div>

            <div class="meta-grid">
              <div class="meta-item">
                <span class="meta-label">Prepared For</span>
                <span class="meta-value">${studentName || "Cherry's Student"}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Class Year & Subject</span>
                <span class="meta-value">${grade} • ${subject}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Class Topic</span>
                <span class="meta-value">${cleanSessionTitle}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Saved Time</span>
                <span class="meta-value">${sessionDateStr}</span>
              </div>
            </div>

            <div class="notes-section">
              ${compiledHtml}
            </div>

            <div class="print-footer">
              Study material synchronized via Maestry Cloud Sync • Optimized for PDF Printout 🌸
            </div>
          </div>

          <script>
            window.addEventListener('DOMContentLoaded', () => {
              if (window.renderMathInElement) {
                renderMathInElement(document.body, {
                  delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                  ]
                });
              }
              setTimeout(() => {
                window.print();
              }, 800);
            });
          </script>
        </body>
        </html>
      `);
      printWindow.document.close();
    } catch (err) {
      console.error("Single Session PDF download compilation failed:", err);
    }
  };

  const handleExportToPDF = (sessionTitle: string, latexContent: string, timestampStr: string) => {
    try {
      // 1. Compile LaTeX blackboard to highly formatted print-ready HTML
      const parsedHTML = compileWhiteboardToHTML(latexContent);

      // 2. Open pop-up window for clean native system printing
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        alert("Pop-up blocker is preventing PDF generation. Please allow pop-ups for this site to export study materials!");
        return;
      }

      // 3. Populate HTML template styled perfectly for print-to-PDF output
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Session Study Notes - ${sessionTitle.replace(/[^a-zA-Z0-9]/g, "_")}</title>
          <meta charset="utf-8">
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.css">
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700&family=JetBrains+Mono&display=swap');
            
            body {
              font-family: 'Inter', system-ui, sans-serif;
              color: #1e293b;
              line-height: 1.6;
              margin: 0;
              padding: 45px;
              background-color: #ffffff;
            }
            .print-header {
              border-bottom: 2px dashed #0f766e;
              padding-bottom: 16px;
              margin-bottom: 28px;
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
            }
            .header-main {
              flex: 1;
            }
            .print-title {
              font-family: 'Space Grotesk', sans-serif;
              color: #0f3c42;
              font-size: 24px;
              font-weight: 800;
              letter-spacing: -0.5px;
              margin: 0;
              text-transform: uppercase;
            }
            .print-subtitle {
              color: #0f766e;
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 2px;
              margin: 6px 0 0 0;
            }
            .print-brand {
              text-align: right;
              font-family: 'Space Grotesk', sans-serif;
              font-weight: 700;
              font-size: 11px;
              color: #0f766e;
              border: 1.5px solid #0f766e;
              padding: 4px 10px;
              border-radius: 8px;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 16px;
              background: #f0fdfa;
              border: 1px solid #ccfbf1;
              border-radius: 12px;
              padding: 16px;
              margin-bottom: 32px;
              font-size: 12.5px;
            }
            .meta-item {
              display: flex;
              flex-direction: column;
            }
            .meta-label {
              color: #0d9488;
              font-weight: 700;
              text-transform: uppercase;
              font-size: 9.5px;
              letter-spacing: 0.8px;
            }
            .meta-value {
              color: #1e293b;
              font-weight: 650;
              margin-top: 3px;
            }
            .notes-section {
              margin-top: 20px;
              min-height: 300px;
            }
            .heading-pdf {
              font-family: 'Space Grotesk', sans-serif;
              color: #0c4f52;
              font-size: 17px;
              font-weight: 750;
              margin-top: 28px;
              margin-bottom: 12px;
              border-left: 4.5px solid #14b8a6;
              padding-left: 12px;
              page-break-after: avoid;
            }
            .paragraph-pdf {
              font-size: 13px;
              margin-bottom: 12px;
              color: #334155;
              text-align: justify;
            }
            .bullet-pdf {
              font-size: 13px;
              margin-bottom: 8px;
              color: #334155;
              margin-left: 24px;
              list-style-type: square;
            }
            .block-math-pdf-container {
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              padding: 20px;
              margin: 20px 0;
              text-align: center;
              overflow-x: auto;
              page-break-inside: avoid;
              box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.02);
            }
            .katex-display {
              margin: 0.5em 0 !important;
              overflow-x: auto;
              overflow-y: hidden;
            }
            .def-pdf-card {
              background: #fffbeb;
              border-left: 4.5px solid #f59e0b;
              border-radius: 4px 10px 10px 4px;
              padding: 14px 18px;
              margin: 18px 0;
              page-break-inside: avoid;
            }
            .def-pdf-label {
              display: block;
              font-size: 10px;
              text-transform: uppercase;
              font-weight: 800;
              color: #b45309;
              letter-spacing: 0.8px;
            }
            .def-pdf-detail {
              display: block;
              font-size: 12.5px;
              color: #78350f;
              margin-top: 5px;
              font-weight: 500;
            }
            code {
              font-family: 'JetBrains Mono', monospace;
              background-color: #f1f5f9;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 12px;
              color: #0f172a;
              border: 1px solid #e2e8f0;
            }
            strong {
              color: #0f172a;
              font-weight: 700;
            }
            .error-math-pdf {
              color: #ef4444;
              font-family: 'JetBrains Mono', monospace;
              background: #fef2f2;
              border: 1px solid #fee2e2;
              padding: 12px;
              border-radius: 10px;
              margin: 12px 0;
              font-size: 11px;
            }
            .print-footer {
              margin-top: 60px;
              border-top: 1.5px solid #e2e8f0;
              padding-top: 20px;
              text-align: center;
              font-size: 10.5px;
              color: #64748b;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 1px;
              page-break-inside: avoid;
            }
            @media print {
              body {
                padding: 0;
              }
              .no-print {
                display: none;
              }
              @page {
                size: A4;
                margin: 2cm;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-header">
            <div class="header-main">
              <h1 class="print-title">Whiteboard Study Notes</h1>
              <p class="print-subtitle">Maestry Interactive Classroom Handout</p>
            </div>
            <div class="print-brand">
              Cherry Ma'am
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-label">Prepared For</span>
              <span class="meta-value">\${studentName || "Cherry's Student"}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Class Year & Subject</span>
              <span class="meta-value">\${grade} • \${subject}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Class Topic</span>
              <span class="meta-value">\${sessionTitle}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Saved Time</span>
              <span class="meta-value">\${timestampStr}</span>
            </div>
          </div>

          <div class="notes-section">
            \${parsedHTML}
          </div>

          <div class="print-footer">
            Study material synchronized via Maestry Cloud Sync • Optimized for PDF Printout 🌸
          </div>

          <script>
            window.addEventListener('DOMContentLoaded', () => {
              setTimeout(() => {
                window.print();
              }, 600);
            });
          </script>
        </body>
        </html>
      `);
      printWindow.document.close();
    } catch (err) {
      console.error("PDF generator crash details:", err);
    }
  };

  const handleExportCombinedPDF = () => {
    try {
      const isSnapshotsEmpty = !allSnapshots || allSnapshots.length === 0;
      
      const bookTitle = `${subject} Combined Blackboard Lecture-Book`;
      const subTitle = isSnapshotsEmpty 
        ? "Syllabus Taught Sequence Handouts" 
        : "Whiteboard Snapped Lecture Pages";

      let combinedHtml = "";
      
      const sortedSnapshots = [...allSnapshots].sort((a, b) => {
        const timeA = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp).getTime();
        const timeB = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : new Date(b.timestamp).getTime();
        return timeA - timeB;
      });

      if (!isSnapshotsEmpty) {
        sortedSnapshots.forEach((item, index) => {
          const dateStr = formatDate(item.timestamp);
          combinedHtml += `
            <div class="pdf-page-wrapper">
              <div class="slide-header">
                <span class="slide-number">BOARD SLIDE #${String(index + 1).padStart(2, '0')}</span>
                <span class="slide-time">📅 ${dateStr}</span>
              </div>
              
              <h2 class="slide-title">📌 ${item.topicTitle}</h2>
              
              <div class="chalkboard-frame-container">
                ${item.imgData ? `
                  <img src="${item.imgData}" alt="${item.topicTitle}" class="chalkboard-image" referrerpolicy="no-referrer" />
                ` : `
                  <div class="no-image-placeholder">Visual Board Frame Preview Pending</div>
                `}
              </div>

              <div class="slide-notes-card">
                <div class="notes-badge">🎓 TOPIC EXPLANATION & STUDY NOTE</div>
                <p class="notes-text">${item.description || "Interactive whiteboard derivations, drawings, and chalkboard notes."}</p>
              </div>
            </div>
          `;
        });
      } else if (topics && topics.length > 0) {
        // Compile ALL topics/slides from active syllabus in chronological sequence! This is an amazing feature!
        topics.forEach((topicContent, index) => {
          const headingText = topicContent.split("\n")[0].replace(/[#*]/g, "").trim() || `Topic ${index + 1}`;
          const contentHTML = compileWhiteboardToHTML(topicContent);
          
          combinedHtml += `
            <div class="pdf-page-wrapper">
              <div class="slide-header">
                <span class="slide-number">SYLLABUS TOPIC #${String(index + 1).padStart(2, '0')}</span>
                <span class="slide-time">📚 Sequence Taught Material</span>
              </div>
              
              <h2 class="slide-title">📌 ${headingText}</h2>
              
              <div class="parsed-latex-topic-content">
                ${contentHTML}
              </div>
            </div>
          `;
        });
      } else {
        const fallbackHTML = compileWhiteboardToHTML(customBoardContent || "No active whiteboard chalkboard notes compiled in active lecture workspace yet.");
        combinedHtml += `
          <div class="pdf-page-wrapper">
            <div class="slide-header">
              <span class="slide-number">ACTIVE SLATE BOARD</span>
              <span class="slide-time">📸 Instant Handout</span>
            </div>
            <h2 class="slide-title">📌 Active Whiteboard Formulas</h2>
            <div class="parsed-latex-topic-content">
              ${fallbackHTML}
            </div>
          </div>
        `;
      }

      const finalHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>${bookTitle} - ${studentName || "Cherry's Student"}</title>
          <meta charset="utf-8">
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700&family=JetBrains+Mono&display=swap">
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
          <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
          <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js"></script>
          <style>
            body {
              font-family: 'Inter', system-ui, sans-serif;
              color: #1e293b;
              line-height: 1.6;
              margin: 0;
              padding: 30px;
              background-color: #f8fafc;
            }
            .book-container {
              max-width: 840px;
              margin: 0 auto;
              background: #ffffff;
              border: 1px solid #e2e8f0;
              border-radius: 20px;
              padding: 40px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.03);
            }
            .print-header {
              border-bottom: 2px solid #0f766e;
              padding-bottom: 16px;
              margin-bottom: 24px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .print-title {
              font-family: 'Space Grotesk', sans-serif;
              color: #0f3c42;
              font-size: 21px;
              font-weight: 850;
              letter-spacing: -0.5px;
              margin: 0;
              text-transform: uppercase;
            }
            .print-subtitle {
              color: #0d9488;
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 1.5px;
              margin: 4px 0 0 0;
            }
            .print-brand {
              font-family: 'Space Grotesk', sans-serif;
              font-weight: 800;
              font-size: 11px;
              color: #0f766e;
              border: 2px solid #0f766e;
              padding: 6px 12px;
              border-radius: 10px;
              text-transform: uppercase;
              letter-spacing: 1px;
              background: #f0fdfa;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 12px;
              background: #f1f5f9;
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              padding: 12px 18px;
              margin-bottom: 30px;
              font-size: 11px;
            }
            .meta-item {
              display: flex;
              flex-direction: column;
              text-align: left;
            }
            .meta-label {
              color: #64748b;
              font-weight: 700;
              text-transform: uppercase;
              font-size: 9px;
              letter-spacing: 0.8px;
            }
            .meta-value {
              color: #0f172a;
              font-weight: 700;
              margin-top: 2px;
            }
            .instructions-box {
              background-color: #fffbeb;
              border: 1px solid #fef3c7;
              border-left: 4px solid #f59e0b;
              border-radius: 8px;
              padding: 12px 16px;
              margin-bottom: 24px;
              text-align: left;
              font-size: 11.5px;
              color: #78350f;
            }
            .pdf-page-wrapper {
              page-break-after: always;
              border: 1px solid #e2e8f0;
              border-radius: 16px;
              padding: 24px;
              margin-bottom: 30px;
              background: #ffffff;
            }
            .pdf-page-wrapper:last-child {
              page-break-after: avoid;
              margin-bottom: 0;
            }
            .slide-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 1px solid #f1f5f9;
              padding-bottom: 10px;
              margin-bottom: 16px;
              font-family: 'JetBrains Mono', monospace;
              font-size: 10.5px;
              color: #0d9488;
              font-weight: bold;
            }
            .slide-number {
              background: rgba(13, 148, 136, 0.1);
              color: #0f766e;
              padding: 2px 8px;
              border-radius: 4px;
            }
            .slide-time {
              color: #64748b;
            }
            .slide-title {
              font-family: 'Space Grotesk', sans-serif;
              color: #0f3c42;
              font-size: 16.5px;
              font-weight: 800;
              margin: 0 0 16px 0;
              text-align: left;
            }
            .chalkboard-frame-container {
              background: #0c201a;
              border-radius: 12px;
              padding: 8px;
              aspect-ratio: 16 / 9;
              display: flex;
              align-items: center;
              justify-content: center;
              border: 3px solid #0a2d24;
              box-shadow: 0 4px 12px rgba(0,0,0,0.08);
              margin-bottom: 16px;
              overflow: hidden;
            }
            .chalkboard-image {
              width: 100%;
              height: 105%;
              object-fit: contain;
              border-radius: 8px;
            }
            .no-image-placeholder {
              color: #10b981;
              font-family: 'JetBrains Mono', monospace;
              font-size: 11px;
            }
            .slide-notes-card {
              background: #f0fdfa;
              border-left: 4px solid #0d9488;
              border-radius: 4px 12px 12px 4px;
              padding: 12px 16px;
              text-align: left;
            }
            .notes-badge {
              font-family: 'JetBrains Mono', monospace;
              color: #0d9488;
              font-size: 9px;
              font-weight: bold;
              letter-spacing: 0.5px;
              margin-bottom: 4px;
            }
            .notes-text {
              font-size: 11.5px;
              color: #334155;
              margin: 0;
              font-weight: 500;
              line-height: 1.5;
            }
            .parsed-latex-topic-content {
              text-align: left;
              font-size: 12px;
              color: #0f172a;
              background: #faf8f5;
              border: 1px solid #edd1d1;
              padding: 18px;
              border-radius: 12px;
              font-family: 'Inter', system-ui, sans-serif;
              line-height: 1.6;
            }
            .parsed-latex-topic-content h1, .parsed-latex-topic-content h2, .parsed-latex-topic-content h3 {
              font-family: 'Space Grotesk', sans-serif;
              color: #0f3c42;
              margin-top: 0;
            }
            .parsed-latex-topic-content code {
              font-family: 'JetBrains Mono', monospace;
              background: #eaebf0;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 11px;
            }
            .print-footer {
              margin-top: 40px;
              border-top: 1px solid #e2e8f0;
              padding-top: 16px;
              text-align: center;
              font-size: 10px;
              color: #94a3b8;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .action-blocks {
              display: flex;
              gap: 12px;
              margin-bottom: 24px;
              justify-content: center;
            }
            .action-btn {
              background: #0f766e;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 8px;
              font-weight: bold;
              font-family: 'Space Grotesk', sans-serif;
              cursor: pointer;
              box-shadow: 0 4px 6px rgba(0,0,0,0.05);
              font-size: 13px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              transition: background 0.2s;
            }
            .action-btn:hover {
              background: #0d9488;
            }
            .action-btn-alt {
              background: #e2e8f0;
              color: #334155;
            }
            .action-btn-alt:hover {
              background: #cbd5e1;
            }

            @media print {
              body {
                padding: 0;
                background-color: #ffffff;
              }
              .book-container {
                border: none;
                padding: 0;
                box-shadow: none;
                max-width: 100%;
              }
              .instructions-box, .action-blocks {
                display: none !important;
              }
              .pdf-page-wrapper {
                border: none;
                padding: 20px 0;
                margin-bottom: 0;
                page-break-after: always;
              }
              .pdf-page-wrapper:last-child {
                page-break-after: avoid;
              }
              @page {
                size: A4 portrait;
                margin: 1.5cm;
              }
            }
          </style>
        </head>
        <body>
          <div class="book-container">
            <div class="action-blocks">
              <button class="action-btn" onclick="window.print()">🖨️ Save as PDF / Print Book</button>
              <button class="action-btn action-btn-alt" onclick="window.close()">❌ Close Book</button>
            </div>

            <div class="instructions-box">
              <strong>📘 Direct PDF Save Option:</strong> Click the <strong>"Save as PDF / Print Book"</strong> button above, or press <strong>Ctrl + P</strong> (Cmd + P on Mac). Choose <strong>"Save as PDF"</strong> as your destination, and hit save!
            </div>

            <div class="print-header">
              <div class="header-main">
                <h1 class="print-title">${bookTitle}</h1>
                <p class="print-subtitle">${subTitle}</p>
              </div>
              <div class="print-brand">
                Maestry Learning Sync
              </div>
            </div>

            <div class="meta-grid">
              <div class="meta-item">
                <span class="meta-label">Student Name</span>
                <span class="meta-value">${escapeHTML(studentName || "Cherry's Student")}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Class Year</span>
                <span class="meta-value">${escapeHTML(grade)}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Subject Standard</span>
                <span class="meta-value">${escapeHTML(subject)}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Taught Chronology</span>
                <span class="meta-value">${new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>

            <div class="board-pages-container">
              ${combinedHtml}
            </div>

            <div class="print-footer">
              Digital Lecture Copy Synchronized via Maestry Cloud • Secure Verification PDF
            </div>
          </div>

          <script>
            document.addEventListener("DOMContentLoaded", function() {
              renderMathInElement(document.body, {
                delimiters: [
                  {left: '$$', right: '$$', display: true},
                  {left: '$', right: '$', display: false},
                  {left: '\\\\(', right: '\\\\)', display: false},
                  {left: '\\\\[', right: '\\\\]', display: true}
                ],
                throwOnError: false
              });
              setTimeout(() => {
                window.print();
              }, 600);
            });
          </script>
        </body>
        </html>
      `;

      const blob = new Blob([finalHtml], { type: "text/html;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Maestry_Lecture_Book_${subject.replace(/[^a-zA-Z0-9]/g, "_")}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Combined PDF export error:", err);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-chalk-fade overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-5xl shadow-2xl border border-teal-100 overflow-hidden flex flex-col my-auto max-h-[90vh]">
        
        {/* Banner with cute gradient */}
        <div className="bg-gradient-to-r from-teal-900 via-[#0a3641] to-emerald-950 p-6 text-white relative">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-teal-100 hover:text-white hover:bg-white/10 p-2 rounded-full transition-all cursor-pointer"
            title="Close Profile Admin panel"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            {currentUser?.photoURL ? (
              <img 
                src={currentUser.photoURL} 
                alt="Avatar" 
                className="w-20 h-20 rounded-2xl border-2 border-[#c4f500] shadow-md object-cover" 
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-[#c4f500] text-[#0a3641] font-extrabold text-2xl flex items-center justify-center border-2 border-white shadow-md">
                {studentName.charAt(0).toUpperCase() || <User className="w-8 h-8" />}
              </div>
            )}

            <div className="text-left space-y-1">
              <span className="px-2.5 py-0.5 rounded-full text-[9px] font-mono tracking-widest font-extrabold uppercase bg-[#c4f500] text-[#0a3641]">
                🎓 STUDENT ACCOUNT
              </span>
              <h2 className="text-2xl font-black">{studentName || "Cherry's Student"}</h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-teal-100/95 font-medium font-mono pt-1">
                <span>🎒 Class: <strong className="text-[#c4f500]">{grade}</strong></span>
                <span className="hidden sm:inline-block">•</span>
                <span>📐 Active Subject: <strong className="text-[#c4f500]">{subject}</strong></span>
                <span className="hidden sm:inline-block">•</span>
                <span className="text-[10px] bg-white/10 py-0.5 px-2 rounded-md">ID: {currentUser?.uid.substring(0, 8)}...</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden bg-white">
          
          {/* Left Sidebar: Student Profile Parameter Controls & Milestones */}
          <div className="w-full md:w-80 bg-slate-50 border-r border-zinc-150 p-5 flex flex-col justify-between overflow-y-auto shrink-0 select-none">
            <div className="space-y-6">
              
              {/* Profile Details section */}
              <div>
                <h3 className="text-[11px] uppercase font-mono font-black tracking-widest text-[#0a3641] flex items-center gap-1.5 pb-2 border-b border-zinc-200">
                  <User className="w-3.5 h-3.5 text-teal-800" /> Student Profile
                </h3>

                {editingProfile ? (
                  <form onSubmit={handleUpdateProfile} className="space-y-3.5 pt-3 text-left">
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-[#486a73] uppercase font-bold">Full Name</label>
                      <input 
                        type="text" 
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full bg-white border border-[#dae1dd] focus:border-[#0a3641] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-teal-700"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-mono text-[#486a73] uppercase font-bold">Class Grade</label>
                        <select 
                          value={editGrade}
                          onChange={(e) => setEditGrade(e.target.value)}
                          className="w-full bg-white border border-[#dae1dd] text-[#0a3641] rounded-lg px-2 py-1.5 text-xs focus:outline-none cursor-pointer"
                        >
                          <option value="Class 10">Class 10</option>
                          <option value="Class 11">Class 11</option>
                          <option value="Class 12">Class 12</option>
                          <option value="JEE/NEET Prep">JEE/NEET Prep</option>
                          <option value="College Level">College Level</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-mono text-[#486a73] uppercase font-bold">Target Subject</label>
                        <select 
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className="w-full bg-white border border-[#dae1dd] text-[#0a3641] rounded-lg px-2 py-1.5 text-xs focus:outline-none cursor-pointer"
                        >
                          <option value="Mathematics">Mathematics</option>
                          <option value="Physics">Physics</option>
                          <option value="Chemistry">Chemistry</option>
                          <option value="All Science">All Science</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-[#486a73] uppercase font-bold">Educational Board</label>
                      <select 
                        value={editBoard}
                        onChange={(e) => setEditBoard(e.target.value)}
                        className="w-full bg-white border border-[#dae1dd] text-[#0a3641] rounded-lg px-2 py-1.5 text-xs focus:outline-none cursor-pointer"
                      >
                        <option value="CBSE">CBSE</option>
                        <option value="ICSE">ICSE</option>
                        <option value="State Board">State Board</option>
                        <option value="Jharkhand Board">Jharkhand Board</option>
                        <option value="Bihar Board">Bihar Board</option>
                        <option value="Odisha Board">Odisha Board</option>
                        <option value="West Bengal Board">West Bengal Board</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-mono text-[#486a73] uppercase font-bold">Medium of Learning</label>
                      <select 
                        value={editMediumOfLearning}
                        onChange={(e) => setEditMediumOfLearning(e.target.value)}
                        className="w-full bg-white border border-[#dae1dd] text-[#0a3641] rounded-lg px-2 py-1.5 text-xs focus:outline-none cursor-pointer"
                      >
                        <option value="Hinglish">Hinglish</option>
                        <option value="English">English</option>
                        <option value="Hindi">Hindi</option>
                        <option value="Bangla">Bangla</option>
                        <option value="Oriya">Oriya</option>
                      </select>
                    </div>

                    <div className="flex gap-2 pt-1.5">
                      <button
                        type="submit"
                        disabled={savingProfile}
                        className="flex-1 bg-teal-800 hover:bg-[#0a3641] text-white text-[10px] font-black tracking-wider uppercase py-2 rounded-lg transition-all cursor-pointer shadow-xs"
                      >
                        {savingProfile ? "Saving..." : "Save updates"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingProfile(false)}
                        className="px-3 border border-zinc-200 text-zinc-500 hover:bg-zinc-100 text-[10px] uppercase font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-3 pt-3 text-left">
                    <div>
                      <span className="text-[9px] font-mono text-[#486a73] uppercase block font-semibold leading-none">Full Name</span>
                      <p className="font-extrabold text-[#0a3641] text-xs py-1 border-b border-transparent leading-relaxed">{studentName || "Cherry's Student"}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[9px] font-mono text-[#486a73] uppercase block font-semibold leading-none">Grade Level</span>
                        <p className="font-bold text-[#0a3641] text-xs mt-0.5">{grade}</p>
                      </div>
                      <div>
                        <span className="text-[9px] font-mono text-[#486a73] uppercase block font-semibold leading-none">Active Subject</span>
                        <p className="font-bold text-[#0a3641] text-xs mt-0.5">{subject}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[9px] font-mono text-[#486a73] uppercase block font-semibold leading-none">Edu Board</span>
                        <p className="font-bold text-[#0a3641] text-xs mt-0.5">{board}</p>
                      </div>
                      <div>
                        <span className="text-[9px] font-mono text-[#486a73] uppercase block font-semibold leading-none">Language</span>
                        <p className="font-bold text-[#0a3641] text-xs mt-0.5">{mediumOfLearning}</p>
                      </div>
                    </div>

                    <div className="pt-1">
                      <span className="text-[9px] font-mono text-[#486a73] uppercase block font-semibold leading-none">Database Status</span>
                      <p className="text-[10px] font-bold text-emerald-700 mt-1 capitalize flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                        {currentUser?.isAnonymous ? "Guest Profile (Local)" : "Verified Cloud Account"}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setEditingProfile(true)}
                      className="w-full border border-dashed border-teal-800/40 hover:border-teal-700 hover:bg-teal-50/50 text-[10px] text-[#0a3641] py-2 rounded-xl transition-all cursor-pointer font-black tracking-widest uppercase text-center mt-2.5"
                    >
                      ✏️ Edit particulars
                    </button>
                  </div>
                )}
              </div>

              {/* Milestones & Progress scorecard */}
              <div className="space-y-3.5 pt-2">
                <h3 className="text-[11px] uppercase font-mono font-black tracking-widest text-[#0a3641] flex items-center gap-1.5 pb-2 border-b border-zinc-200">
                  <Award className="w-3.5 h-3.5 text-teal-800" /> Academic Progress
                </h3>

                <div className="space-y-2">
                  <div className="bg-white border border-zinc-200 rounded-xl p-3 flex items-center justify-between text-left shadow-xs">
                    <div>
                      <span className="text-[9px] font-mono text-zinc-500 block uppercase font-semibold">Total Classes Attended</span>
                      <span className="text-xl font-black text-[#0a3641] block mt-0.5">{totalSessionsCount}</span>
                    </div>
                    <span className="text-2xl bg-teal-50 p-1.5 rounded-lg">📈</span>
                  </div>

                  <div className="bg-white border border-zinc-200 rounded-xl p-3 flex items-center justify-between text-left shadow-xs">
                    <div>
                      <span className="text-[9px] font-mono text-zinc-500 block uppercase font-semibold">Total Slides Saved</span>
                      <span className="text-xl font-black text-[#0a3641] block mt-0.5">{allSnapshots.length}</span>
                    </div>
                    <span className="text-2xl bg-teal-50 p-1.5 rounded-lg">📸</span>
                  </div>
                </div>

                <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3 text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">🏆</span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-[#0a3641]">Active Scholar Badge</span>
                  </div>
                  <p className="text-[10px] text-[#486a73] font-medium mt-1 leading-relaxed">
                    Automatically unlocked for participating in live lectures and compiling direct board-books!
                  </p>
                </div>
              </div>

            </div>

            <div className="text-[9.5px] text-zinc-400 font-mono text-left pt-6 border-t border-zinc-200 mt-6 leading-relaxed">
              * Classroom Handbooks are automatically formatted into optimized multi-page books using integrated LaTeX formulas.
            </div>
          </div>

          {/* Right Column: Unified Board-Book Hub (Main Arena) */}
          <div className="flex-1 p-6 flex flex-col space-y-6 overflow-y-auto text-left min-h-0 bg-white">
            
            {/* Hub Header */}
            <div className="border-b border-zinc-150 pb-4">
              <h3 className="text-lg font-black text-[#0a3641] flex items-center gap-2">
                <span className="p-1 px-1.5 bg-teal-900 text-white rounded-lg text-sm">&#128214;</span>
                Unified Board-Book Hub
              </h3>
              <p className="text-xs text-[#486a73] font-medium mt-1 leading-relaxed">
                Your direct digital learning locker. Here you can generate consolidated chronological study handouts (Board-Books) of your current active classes, access prior classrooms, and view live screenshot blackboard frames in pristine layouts.
              </p>
            </div>

            {/* Panel 1: Current / Active Session Board-Book Container */}
            <div className="bg-gradient-to-br from-teal-950 via-[#06201a] to-emerald-950 border border-teal-800 rounded-2xl p-5 text-white shadow-lg relative overflow-hidden select-none">
              
              {/* Backlit highlight effect */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#c4f500]/10 rounded-full filter blur-2xl -z-1" />
              
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-teal-900/40 pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md text-[8px] font-mono tracking-widest font-extrabold uppercase bg-[#c4f500] text-[#0a3641]">
                        🔴 Live Lecture Board-Book
                      </span>
                      <span className="text-[10px] text-teal-300 font-mono font-bold leading-none">
                        {(topics && topics.length > 0) ? `${topics.length} Sequential Parts` : "General Board Workspace"}
                      </span>
                    </div>
                    <h4 className="text-sm font-extrabold text-white">
                      {subject} — {topics.length > 0 ? (topics[0].split("\n")[0] || "").replace(/[\#\*\_]/g, "").trim() : "Main Classroom Workspace"}
                    </h4>
                  </div>

                  <button
                    onClick={() => handleExportSessionToPDF(null)}
                    className="py-2 px-3 mx-0 sm:mx-1 bg-[#c4f500] hover:bg-[#b0dc00] hover:scale-[1.01] active:translate-y-0.1 text-[#061c18] rounded-xl text-xs font-black tracking-wider uppercase flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer select-none"
                  >
                    <HardDriveDownload className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Generate Active Board-Book (PDF)</span>
                  </button>
                </div>

                {/* Sub-Feature: Captured Blackboard Image Frames Strip */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-teal-300 font-bold flex items-center gap-1">
                      <span>📸</span> Live Hand-Captured Frame Slides ({allSnapshots.length})
                    </span>
                    <span className="text-[9px] text-[#cbd5e1] italic font-medium">Click on thumbnail to download frame</span>
                  </div>

                  {allSnapshots.length === 0 ? (
                    <div className="border border-dashed border-teal-800/40 rounded-xl p-5 text-center bg-teal-950/20">
                      <p className="text-[11px] text-teal-200/80 font-medium">No direct single-frame snapshots are captured in this session yet.</p>
                      <p className="text-[9.5px] text-teal-400 font-mono mt-0.5">They will show up here immediately once captured from the blackboard console.</p>
                    </div>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto pb-2 pr-1 scrollbar-thin scrollbar-thumb-teal-700">
                      {allSnapshots.map((item, idx) => (
                        <div 
                          key={item.id || idx} 
                          className="w-40 bg-[#041411] border border-teal-900/50 rounded-xl p-1.5 shrink-0 flex flex-col justify-between group relative hover:border-teal-400/30 transition-all shadow-xs"
                        >
                          <div 
                            className="h-20 bg-emerald-950/40 rounded-lg overflow-hidden flex items-center justify-center cursor-zoom-in relative"
                            onClick={() => handleDownloadImage(item)}
                          >
                            {item.imgData ? (
                              <img 
                                src={item.imgData} 
                                alt={item.topicTitle} 
                                className="w-full h-full object-contain filter group-hover:scale-103 transition-transform" 
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <span className="text-[8px] text-teal-500 font-mono">Render Pending</span>
                            )}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-[8px] font-mono uppercase text-white font-black tracking-widest">
                              🔍 Save
                            </div>
                          </div>

                          <div className="mt-1 flex items-center justify-between gap-1.5 px-0.5">
                            <span className="text-[9px] font-mono text-teal-300 font-black truncate max-w-[70%]">
                              #{idx + 1} {item.topicTitle.replace(/^📌\s*/, "")}
                            </span>
                            <button
                              onClick={() => handleDeleteSnapshot(item.id)}
                              className="p-1 text-teal-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-md transition-colors cursor-pointer"
                              title="Delete snapshot"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Panel 2: Past Sessions Board-Book Arc Archives Block (Overhauled Subject-Wise Architecture) */}
            <div className="space-y-4 pt-1">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-150 pb-2">
                <div className="text-left">
                  <h4 className="text-xs uppercase font-mono tracking-widest text-[#0a3641] font-extrabold flex items-center gap-1.5">
                    <span>📁</span> Archived Classroom Lecture Books ({pastSessions.length})
                  </h4>
                </div>
              </div>

              {pastSessions && pastSessions.length > 0 ? (
                <div className="space-y-3.5">
                  {/* Subject and Title Search Bar */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 stroke-[2.5]" />
                    <input 
                      type="text" 
                      value={archiveSearchQuery} 
                      onChange={(e) => setArchiveSearchQuery(e.target.value)} 
                      placeholder="Search by subject, lecture title, or date..." 
                      className="w-full pl-10 pr-10 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-semibold placeholder:text-zinc-400 text-zinc-800 focus:outline-hidden focus:ring-1 focus:ring-teal-600 focus:border-teal-600 transition-all font-mono"
                    />
                    {archiveSearchQuery && (
                      <button 
                        onClick={() => setArchiveSearchQuery("")}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-xs font-mono font-bold"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {Object.keys(sortedAndGroupedSessions).length === 0 ? (
                    <div className="border border-dashed border-zinc-200 rounded-2xl p-6 bg-zinc-50/50 text-center select-none">
                      <p className="text-xs font-black text-zinc-400">No matching lecture books found</p>
                      <p className="text-[10px] text-zinc-400 mt-1">Try adjusting your keyword or subject search filter query.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {Object.keys(sortedAndGroupedSessions).sort().map((subName) => {
                        const sessionsInGrp = sortedAndGroupedSessions[subName];
                        const isExpanded = !!expandedSubjects[subName];

                        return (
                          <div 
                            key={subName}
                            className="border border-zinc-150 rounded-2xl bg-white overflow-hidden shadow-xs transition-all duration-200 hover:border-zinc-300"
                          >
                            {/* Subject Accordion Folder Header */}
                            <button
                              onClick={() => setExpandedSubjects(prev => ({ ...prev, [subName]: !prev[subName] }))}
                              className="w-full px-4 py-3 bg-[#fbfcfb] border-b border-zinc-100 flex items-center justify-between gap-3 text-left transition-colors hover:bg-slate-50 cursor-pointer"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="p-1 px-1.5 bg-teal-50 text-teal-700 rounded-lg shrink-0">
                                  {isExpanded ? (
                                    <FolderOpen className="w-4 h-4 stroke-[2]" />
                                  ) : (
                                    <Folder className="w-4 h-4 stroke-[2]" />
                                  )}
                                </span>
                                <div className="min-w-0">
                                  <h5 className="text-xs font-black text-[#0a3641] uppercase tracking-wide truncate font-sans">
                                    {subName}
                                  </h5>
                                  <p className="text-[9.5px] text-[#486a73] font-mono leading-none mt-1 font-bold">
                                    {sessionsInGrp.length} Lesson PDF{sessionsInGrp.length === 1 ? "" : "s"} Archived
                                  </p>
                                </div>
                              </div>
                              <span className="text-zinc-400">
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 stroke-[2.5]" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 stroke-[2.5]" />
                                )}
                              </span>
                            </button>

                            {/* Nested Sub-List: PDF Assets mapped to other subject */}
                            {isExpanded && (
                              <div className="divide-y divide-zinc-100 bg-white">
                                {sessionsInGrp.map((sess, idx) => {
                                  const hasContent = !!(sess.customBoardContent || (sess.topicBoardsContent && Object.keys(sess.topicBoardsContent).length > 0));

                                  const isYoutubeSess = sess.processedTitle?.includes("YouTube") || sess.processedTitle?.includes("(ID: ");

                                  return (
                                    <div 
                                      key={sess.sessionId || idx}
                                      className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 transition-all pl-6 sm:pl-8 border-l-2 ${
                                        isYoutubeSess ? "border-red-500/30 bg-red-50/5 hover:bg-red-50/15" : "border-teal-600/20"
                                      }`}
                                    >
                                      <div className="space-y-1 text-left min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-md ${
                                            isYoutubeSess ? "bg-red-50 text-red-700 border border-red-100" : "bg-teal-50 text-teal-800"
                                          }`}>
                                            Lesson #{sess.index}
                                          </span>
                                          {isYoutubeSess && (
                                            <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-red-600 text-white flex items-center gap-1 font-mono">
                                              <Youtube className="w-2.5 h-2.5" /> Direct Video Sync
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs font-extrabold text-[#0a3641] tracking-tight truncate leading-tight">
                                          {sess.processedTitle}
                                        </p>
                                        <div className="flex items-center gap-x-3 text-[9.5px] font-mono text-zinc-500 font-semibold mt-1">
                                          <span className="flex items-center gap-1">
                                            <Calendar className="w-3 h-3 text-[#4c8491]" /> {sess.formattedDateTime}
                                          </span>
                                          <span>•</span>
                                          <span className={isYoutubeSess ? "text-red-700 font-bold" : "text-teal-700"}>
                                            {(sess.topics && sess.topics.length > 0) ? `${sess.topics.length} Sections` : "Consolidated Study Notes"}
                                          </span>
                                        </div>
                                      </div>

                                      <button
                                        onClick={() => handleExportSessionToPDF(sess)}
                                        disabled={!hasContent}
                                        className={`py-1.5 px-3.5 rounded-xl text-[10px] font-black tracking-wider uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0 ${
                                          hasContent
                                            ? "bg-teal-50 hover:bg-teal-100/80 active:scale-[0.98] text-[#0f766e] shadow-xs active:ring-1 active:ring-teal-200"
                                            : "bg-slate-100 text-slate-300 cursor-not-allowed"
                                        }`}
                                        title={hasContent ? "Download complete Study Handout as a beautiful multi-page PDF" : "This session's board notes are empty"}
                                      >
                                        <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                                        <span>Download PDF</span>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="border border-dashed border-zinc-200 rounded-2xl p-8 bg-zinc-50/50 text-center select-none">
                  <p className="text-xs font-black text-zinc-400">Archive Locker Empty</p>
                  <p className="text-[10px] text-zinc-400 mt-1 max-w-xs mx-auto leading-relaxed">
                    Once you conduct or complete live classrooms with Cherry Ma'am, your completed board-books will compile and archive here automatically under secure token sync.
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#f7f9f6] border-t border-zinc-150 p-4 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <p className="text-[10px] font-mono text-[#486a73] font-bold">🎯 Synchronized with AI Studio Cloud Database Service</p>
          <button 
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2.5 bg-[#0a3641] hover:bg-[#124e5d] text-white text-[11px] font-black tracking-wider uppercase rounded-xl transition-all cursor-pointer shadow-sm text-center"
          >
            Go Back to Classroom 👋
          </button>
        </div>

      </div>
    </div>
  );
};
