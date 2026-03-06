import React, { useState, useRef, useEffect, useMemo } from "react";
import { GoogleGenAI } from "@google/genai";
import { useBook } from "../../contexts/BookContext";
import { usePdfViewer } from "../../contexts/PdfViewerContext";
import { useAnnotation } from "../../contexts/AnnotationContext";
import {
  X,
  Trash2,
  MessageSquare,
  Highlighter,
  Plus,
  Save,
  ChevronRight,
  StickyNote,
  Book,
  PenTool,
  ExternalLink,
  Bold,
  List,
  Image as ImageIcon,
  Download,
  Upload,
  Printer,
  Table as TableIcon,
  Camera,
  Bookmark,
  List as ListIcon,
  FileText,
  FileUp,
  Edit3,
  Search,
  Filter,
  Lock,
} from "lucide-react";
import { getPreviewConfig } from "../../utils/previewConfig";
import { findRelevantChunks } from "../../services/pdfRagService";
import { GeneralNote, Highlight as HighlightType } from "../../../types";
import { ContentRenderer } from "../../features/viewer";
import { PanelWrapper, HighlightMatch } from "./PanelWrapper";

export const ToolsPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const {
    currentChapter,
    ragChunks,
    incrementAiCount,
    goToChapter,
    chapters,
    aiChatHistory,
    addChatMessage,
    stats,
    activeToolTab,
    setActiveToolTab,
    setCaptureMode,
    capturedImage,
    setCapturedImage,
    referenceDocument,
    uploadBook,
    searchQuery,
    setSearchQuery,
    performSearch,
    getChapterTitleByPage,
    setToolsOpen,
  } = useBook();
  const {
    highlights,
    activeHighlightId,
    removeHighlight,
    updateHighlight,
    generalNotes,
    addGeneralNote,
    updateGeneralNote,
    removeGeneralNote,
    importNotes,
    exportNoteAsMarkdown,
    focusHighlight,
    goToHighlight,
    pendingHighlightEditId,
    clearHighlightNoteEditRequest,
    performAnnotationSearch,
  } = useAnnotation();
  const { pdfTextPages, goToPdfPage, setPdfSearchHighlight } = usePdfViewer();

  const [aiInput, setAiInput] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [editingNote, setEditingNote] = useState<Partial<GeneralNote> | null>(
    null
  );
  const [editingHighlightId, setEditingHighlightId] = useState<string | null>(
    null
  );
  const [highlightText, setHighlightText] = useState("");
  const [localFilter, setLocalFilter] = useState("");

  const contentEditableRef = useRef<HTMLDivElement>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const autoInsertNextCaptureRef = useRef(false);
  const highlightItemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const aiTalkEndRef = useRef<HTMLDivElement>(null);

  // Lazy loading state for highlights
  const [visibleHighlightCount, setVisibleHighlightCount] = useState(20);
  const highlightScrollRef = useRef<HTMLDivElement>(null);
  const capture_image_selector = ".capture_img_container, .capture-img-container";

  useEffect(() => {
    if (
      editingNote &&
      contentEditableRef.current &&
      contentEditableRef.current.innerHTML !== (editingNote.content || "")
    ) {
      contentEditableRef.current.innerHTML = editingNote.content || "";
    }
  }, [editingNote?.id]);

  // 갤럭시 탭 등 Android 기기에서 가상 키보드가 올라올 때
  // editorWrap 하단에 키보드 높이만큼 paddingBottom을 줘서 footer가 가려지지 않도록 처리
  useEffect(() => {
    if (!editingNote) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const adjust = () => {
      const keyboardHeight =
        window.innerHeight - vv.height - vv.offsetTop;
      if (editorWrapRef.current) {
        editorWrapRef.current.style.paddingBottom =
          keyboardHeight > 0 ? `${keyboardHeight}px` : "";
      }
    };

    vv.addEventListener("resize", adjust);
    vv.addEventListener("scroll", adjust);
    return () => {
      vv.removeEventListener("resize", adjust);
      vv.removeEventListener("scroll", adjust);
      if (editorWrapRef.current) {
        editorWrapRef.current.style.paddingBottom = "";
      }
    };
  }, [editingNote]);

  useEffect(() => {
    if (activeToolTab !== "ai") return;
    requestAnimationFrame(() => {
      aiTalkEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });
  }, [activeToolTab, aiChatHistory.length, isAiThinking]);

  const getCurrentContent = () =>
    contentEditableRef.current ? contentEditableRef.current.innerHTML : "";

  const buildCaptureImageHtml = (imageSrc: string) =>
    `<div class="capture_img_container"><img src="${imageSrc.replace(/"/g, "&quot;")}" class="capture_img" alt="캡처 이미지" /></div><p><br/></p>`;

  const splitCapturedImageContent = (content: string) => {
    if (!content || typeof document === "undefined") {
      return { noteContent: content, noteImage: null as string | null };
    }

    const temp = document.createElement("div");
    temp.innerHTML = content;

    const captureNodes = Array.from(
      temp.querySelectorAll(capture_image_selector)
    );

    if (captureNodes.length === 0) {
      return { noteContent: content, noteImage: null as string | null };
    }

    let noteImage: string | null = null;

    captureNodes.forEach((captureNode) => {
      const imageNode = captureNode.querySelector("img");
      const imageSrc = imageNode?.getAttribute("src");
      if (imageSrc) {
        noteImage = imageSrc;
      }

      const nextNode = captureNode.nextElementSibling;
      captureNode.remove();

      if (
        nextNode &&
        nextNode.tagName === "P" &&
        !nextNode.textContent?.trim()
      ) {
        nextNode.remove();
      }
    });

    return { noteContent: temp.innerHTML, noteImage };
  };

  const openNoteEditor = (note: Partial<GeneralNote>) => {
    const { noteContent, noteImage } = splitCapturedImageContent(
      note.content || ""
    );

    setCapturedImage(noteImage);
    setEditingNote({ ...note, content: noteContent });
  };

  const closeNoteEditor = () => {
    setEditingNote(null);
    setCapturedImage(null);
  };

  const handleTabChange = (
    tab: "ai" | "highlight" | "mynote" | "reference" | "search"
  ) => {
    if (activeToolTab === "mynote" && editingNote) {
      const content = getCurrentContent();
      setEditingNote((prev) => (prev ? { ...prev, content } : null));
    }
    setActiveToolTab(tab);
    setLocalFilter("");
  };

  const startEditHighlight = (hl: HighlightType) => {
    setEditingHighlightId(hl.id);
    setHighlightText(hl.note || "");
  };

  const saveHighlightNote = (id: string) => {
    updateHighlight(id, { note: highlightText });
    setEditingHighlightId(null);
    setHighlightText("");
  };

  const getHighlightChapterLabel = (hl: HighlightType) => {
    if (hl.chapterId === "reference-doc") {
      if (!hl.pageNumber) return "도서명";
      const title = getChapterTitleByPage(hl.pageNumber);
      return title || "도서명";
    }
    const chapterIndex = chapters.findIndex((c) => c.id === hl.chapterId);
    if (chapterIndex === -1) return "Chapter";
    const chapterTitle = chapters[chapterIndex]?.title?.trim();
    return chapterTitle || `Chapter ${chapterIndex + 1}`;
  };

  // Filtered Lists for Memos and MyNote
  const filteredHighlights = useMemo(
    () =>
      highlights
        .filter((hl) => !hl.deleted)
        .filter(
          (hl) =>
            hl.text.toLowerCase().includes(localFilter.toLowerCase()) ||
            (hl.note &&
              hl.note.toLowerCase().includes(localFilter.toLowerCase()))
        ),
    [highlights, localFilter]
  );

  const visibleHighlights = useMemo(
    () => filteredHighlights.slice(0, visibleHighlightCount),
    [filteredHighlights, visibleHighlightCount]
  );

  const filteredNotes = generalNotes
    .filter((note) => !note.deleted)
    .filter(
      (note) =>
        note.title.toLowerCase().includes(localFilter.toLowerCase()) ||
        note.content.toLowerCase().includes(localFilter.toLowerCase())
    );

  // Handle scroll for lazy loading highlights
  useEffect(() => {
    const container = highlightScrollRef.current;
    if (!container || activeToolTab !== "highlight") return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (
        scrollHeight - scrollTop - clientHeight < 300 &&
        visibleHighlightCount < filteredHighlights.length
      ) {
        setVisibleHighlightCount((prev) =>
          Math.min(prev + 20, filteredHighlights.length)
        );
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [activeToolTab, visibleHighlightCount, filteredHighlights.length]);

  // Reset visible count when filter changes
  useEffect(() => {
    setVisibleHighlightCount(20);
  }, [localFilter, activeToolTab]);

  useEffect(() => {
    if (activeToolTab !== "highlight" || !activeHighlightId) return;
    const target = highlightItemRefs.current[activeHighlightId];
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.focus();
    });
  }, [activeToolTab, activeHighlightId, filteredHighlights.length]);

  useEffect(() => {
    if (!pendingHighlightEditId) return;
    const target = highlights.find((hl) => hl.id === pendingHighlightEditId);
    if (!target) return;
    if (activeToolTab !== "highlight") {
      setActiveToolTab("highlight");
    }
    setEditingHighlightId(target.id);
    setHighlightText(target.note || "");
    clearHighlightNoteEditRequest();
  }, [
    pendingHighlightEditId,
    highlights,
    activeToolTab,
    setActiveToolTab,
    clearHighlightNoteEditRequest,
  ]);

  useEffect(() => {
    if (!capturedImage) return;
    setToolsOpen(true);
    setActiveToolTab("mynote");

    if (!autoInsertNextCaptureRef.current) return;
    autoInsertNextCaptureRef.current = false;

    const timer = setTimeout(() => {
      const editor = contentEditableRef.current;
      if (!editor) return;
      editor.focus();
      const sel = window.getSelection();
      sel?.removeAllRanges();
      if (savedSelectionRef.current) {
        try {
          sel?.addRange(savedSelectionRef.current);
        } catch {
          const r = document.createRange();
          r.selectNodeContents(editor);
          r.collapse(false);
          sel?.addRange(r);
        }
      } else {
        const r = document.createRange();
        r.selectNodeContents(editor);
        r.collapse(false);
        sel?.addRange(r);
      }
      document.execCommand(
        "insertHTML",
        false,
        `<img src="${capturedImage.replace(/"/g, "&quot;")}" style="max-width:100%;height:auto;" />`
      );
      setCapturedImage(null);
    }, 100);

    return () => clearTimeout(timer);
  }, [capturedImage, setActiveToolTab, setToolsOpen, setCapturedImage]);

  const parseCitedPages = (text: string) => {
    const pages: number[] = [];
    const patterns = [
      /p\.?\s?(\d+)/gi,
      /(\d+)\s?페이지/g,
      /참조\s?페이지:?\s?([\d,\s]+)/gi,
    ];

    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match[1].includes(",") || match[1].includes(" ")) {
          const nums = match[1]
            .split(/[,\s]+/)
            .map((value) => parseInt(value.trim(), 10))
            .filter((value) => !Number.isNaN(value));
          pages.push(...nums);
        } else {
          const value = parseInt(match[1], 10);
          if (!Number.isNaN(value)) pages.push(value);
        }
      }
    });

    return Array.from(new Set(pages)).filter((value) => value > 0);
  };

  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stats.aiInteractionCount >= 20) {
      addChatMessage("model", "오늘의 AI 사용량(20턴)을 모두 소진하셨습니다.");
      return;
    }
    if (!aiInput.trim() || isAiThinking) return;

    const userQuery = aiInput;
    setAiInput("");
    addChatMessage("user", userQuery);
    setIsAiThinking(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

      const relevantChunks = findRelevantChunks(userQuery, ragChunks);
      const fallbackContext = currentChapter.content
        .replace(/<[^>]*>?/gm, " ")
        .substring(0, 3000);
      const contextString =
        relevantChunks.length > 0
          ? relevantChunks
              .map(
                (chunk) => `[학습 자료 Page ${chunk.pageNumber}]: ${chunk.text}`
              )
              .join("\n\n")
          : fallbackContext;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            {
              text: `
[CampusBook Academic Tutor]
당신은 질문의 의도를 분석하고 교재 기반의 학술적 인과관계를 설명하는 전문 AI 튜터입니다.

[분석 명령]
- 사용자의 질문: "${userQuery}"
- 질문에 담긴 핵심 개념과 파생될 수 있는 기전을 교재 맥락에서 찾아 답변하세요.
- 만약 질문이 복합적이라면(A가 B에 미치는 영향 등), 교재 내의 사실들을 논리적으로 연결하여 설명하세요.

[필수 규칙]
1. 답변 끝에 반드시 "참조 페이지: p.n" 형식으로 실제 근거 페이지를 명시하세요.
2. 교재 텍스트에 기반한 추론임을 명확히 하세요.

[도서 맥락 데이터]
${contextString}
            `.trim(),
            },
          ],
        },
        config: {
          temperature: 0.15,
          systemInstruction:
            "당신은 도서 데이터를 기반으로 고도화된 학술 분석을 수행하는 AI 튜터입니다.",
        },
      });

      const aiResult = response.text || "답변을 생성할 수 없습니다.";
      const citedPagesFromAi = parseCitedPages(aiResult);
      const actualBookPages = new Set(
        ragChunks
          .map((chunk) => chunk.pageNumber)
          .filter((page): page is number => typeof page === "number")
      );
      const verifiedCitedPages = citedPagesFromAi.filter((page) =>
        actualBookPages.has(page)
      );
      const fallbackPages = relevantChunks
        .map((chunk) => chunk.pageNumber)
        .filter((page): page is number => typeof page === "number");
      const finalPages = Array.from(
        new Set([...verifiedCitedPages, ...fallbackPages])
      ).sort((a, b) => a - b);

      let finalMessage = aiResult;
      if (!/참조\s?페이지/i.test(aiResult) && finalPages.length > 0) {
        const pageLabel = finalPages.map((page) => `p.${page}`).join(", ");
        finalMessage = `${aiResult}\n\n참조 페이지: ${pageLabel}`;
      }

      addChatMessage("model", finalMessage);
      incrementAiCount();
    } catch (error) {
      console.error("Academic QA Error:", error);
      addChatMessage(
        "model",
        "학술 분석 엔진 연결 중 일시적인 오류가 발생했습니다."
      );
    } finally {
      setIsAiThinking(false);
    }
  };
  const handleSaveNote = () => {
    if (!editingNote) return;

    const { noteContent } = splitCapturedImageContent(getCurrentContent());
    const finalContent = capturedImage
      ? `${noteContent}${buildCaptureImageHtml(capturedImage)}`
      : noteContent;

    if (editingNote.title) {
      if (editingNote.id)
        updateGeneralNote(editingNote.id, editingNote.title, finalContent);
      else addGeneralNote(editingNote.title, finalContent);
      closeNoteEditor();
    }
  };
  const execCmd = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    if (contentEditableRef.current) contentEditableRef.current.focus();
  };
  const handleToolbarAction = (
    e: React.MouseEvent,
    command: string,
    value?: string
  ) => {
    e.preventDefault();
    execCmd(command, value);
  };
  const handleCaptureClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const currentContent = getCurrentContent();
    setEditingNote((prev) =>
      prev ? { ...prev, content: currentContent } : null
    );
    autoInsertNextCaptureRef.current = true;
    // 모바일(≤480px)에서는 패널을 닫아 캡처 영역 확보 → 캡처 완료 시 자동 재오픈
    if (window.innerWidth <= 480) {
      setToolsOpen(false);
    }
    setCaptureMode(true);
  };
  const insertTable = (e: React.MouseEvent) => {
    e.preventDefault();
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (
        contentEditableRef.current &&
        contentEditableRef.current.contains(range.commonAncestorContainer)
      ) {
        savedSelectionRef.current = range.cloneRange();
      } else {
        savedSelectionRef.current = null;
      }
    }
    const r = parseInt(prompt("Rows:", "2") || "0");
    const c = parseInt(prompt("Columns:", "2") || "0");
    if (contentEditableRef.current) {
      contentEditableRef.current.focus();
      if (savedSelectionRef.current) {
        selection?.removeAllRanges();
        selection?.addRange(savedSelectionRef.current);
      }
      if (r > 0 && c > 0) {
        let html = `<table style="width:100%; border-collapse: collapse; margin: 10px 0; border: 1px solid #ccc;"><tbody>`;
        for (let i = 0; i < r; i++) {
          html += `<tr>`;
          for (let j = 0; j < c; j++)
            html += `<td style="border:1px solid #ccc; padding:8px; min-width: 50px;">Cell</td>`;
          html += `</tr>`;
        }
        html += `</tbody></table><p><br></p>`;
        document.execCommand("insertHTML", false, html);
      }
    }
  };
  const handleUploadRef = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) uploadBook(e.target.files[0]);
  };
  const handleEditorBlur = () => {
    const currentContent = getCurrentContent();
    setEditingNote((prev) =>
      prev ? { ...prev, content: currentContent } : null
    );
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (contentEditableRef.current?.contains(range.commonAncestorContainer)) {
        savedSelectionRef.current = range.cloneRange();
      }
    }
  };
  const printNote = () => {
    if (!editingNote) return;
    const content = getCurrentContent();
    const printWindow = window.open("", "", "height=600,width=800");
    if (printWindow) {
      printWindow.document.write(
        `<html><head><title>${editingNote.title}</title><style>body{font-family:sans-serif;padding:20px;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #ccc;padding:8px;}img{max-width:100%;}</style></head><body><h1>${editingNote.title}</h1>${content}</body></html>`
      );
      printWindow.document.close();
      printWindow.print();
    }
  };
  const searchResults = useMemo(() => {
    if (activeToolTab !== "search") return [];
    return [
      ...performSearch(searchQuery),
      ...performAnnotationSearch(searchQuery),
    ];
  }, [activeToolTab, performSearch, searchQuery, performAnnotationSearch]);

  return (
    <PanelWrapper
      isOpen={isOpen}
      onClose={onClose}
      side="right"
      title="학습 도구"
    >
      <div className="tools_panel_inner">
        <div className="right_panel_menu">
          {/* <button
          onClick={() => handleTabChange("ai")}
          className={`ai ${activeToolTab === "ai" ? "on" : "off"}`}
          title="AI"
        >
          <MessageSquare size={14} />
        </button> */}
          <button
            onClick={() => handleTabChange("highlight")}
            className={`highlight ${
              activeToolTab === "highlight" ? "on" : "off"
            }`}
            title="Highlights"
          >
            <Highlighter size={14} />
            <span className="right_panel_menu_label">하이라이트</span>
          </button>
          <button
            onClick={() => handleTabChange("mynote")}
            className={`mynote ${activeToolTab === "mynote" ? "on" : "off"}`}
            title="mynote"
          >
            <Book size={14} />
            <span className="right_panel_menu_label">마이노트</span>
          </button>
          {/* <button
          onClick={() => handleTabChange("reference")}
          className={`reference ${
            activeToolTab === "reference" ? "on" : "off"
          }`}
          title="Reference PDF"
        >
          <FileText size={14} />
        </button> */}
          <button
            onClick={() => handleTabChange("search")}
            className={`search ${activeToolTab === "search" ? "on" : "off"}`}
            title="Search"
          >
            <Search size={14} />
            <span className="right_panel_menu_label">검색</span>
          </button>
        </div>
        <div className="text_area">
          {activeToolTab === "ai" && (
            <div className="ai">
              <div className="ai_talk">
                {aiChatHistory.length === 0 && (
                  <div className="ai_talk_inner">
                    <div className="icon">
                      <MessageSquare className="text-blue-500" size={24} />
                    </div>
                    <p className="text_sm">AI Study Companion</p>
                  </div>
                )}
                {aiChatHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`txt ${
                      msg.role === "user" ? "ai_user_txt" : "ai_txt"
                    }`}
                  >
                    <div className={` ${msg.role === "user" ? "on" : "off"}`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {isAiThinking && (
                  <div className="flex flex-col items-start">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-bl-none px-4 py-3 border border-slate-100 dark:border-slate-700">
                      <div className="flex space-x-1">
                        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
                        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75"></div>
                        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={aiTalkEndRef} />
              </div>
              <div className="ai_user">
                <form onSubmit={handleAiSubmit} className="user_form">
                  <input
                    type="text"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    placeholder="Ask AI..."
                    className=""
                  />
                  <button
                    type="submit"
                    disabled={!aiInput.trim() || isAiThinking}
                    className="enter"
                  >
                    <MessageSquare size={16} />
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Highlights Tab with Local Search */}
          {activeToolTab === "highlight" && (
            <div className="absolute inset-0 flex flex-col">
              <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="tool_section_header">
                  <span className="tool_section_label">
                    하이라이트 ({filteredHighlights.length})
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="하이라이트에서 검색..."
                    value={localFilter}
                    onChange={(e) => setLocalFilter(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 rounded-md text-xs border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                  <Filter
                    size={12}
                    className="absolute left-2.5 top-2 text-slate-400"
                  />
                </div>
                {filteredHighlights.length > visibleHighlightCount && (
                  <div className="mt-2 text-xs text-slate-500 text-center">
                    Showing {visibleHighlightCount} of{" "}
                    {filteredHighlights.length}
                  </div>
                )}
              </div>
              <div
                ref={highlightScrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-3"
              >
                {filteredHighlights.length === 0 && (
                  <div className="text-center py-10 opacity-50">
                    <Highlighter size={24} className="mx-auto mb-2" />
                    <p className="text-sm">저장된 하이라이트가 없습니다.</p>
                  </div>
                )}
                {visibleHighlights.map((hl) => (
                  <div
                    key={hl.id}
                    onClick={() => goToHighlight(hl)}
                    ref={(el) => {
                      highlightItemRefs.current[hl.id] = el;
                    }}
                    tabIndex={-1}
                    className={`p-4 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-blue-300 transition-all ${
                      activeHighlightId === hl.id
                        ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-white dark:ring-offset-slate-800"
                        : ""
                    }`}
                  >
                    <div className="highlight_meta_row mb-2 text-xs text-slate-400">
                      <div className="highlight_meta_group">
                        <span className="highlight_chapter_label">
                          {getHighlightChapterLabel(hl)}
                        </span>
                        <span className="highlight_page_label">
                          {hl.pageNumber ? `P. ${hl.pageNumber}` : ""}
                        </span>
                      </div>
                      <div className="highlight_actions">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditHighlight(hl);
                          }}
                          title="Edit Note"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeHighlight(hl.id);
                          }}
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Use HighlightMatch component for text body */}
                    <p className="highlight_txt highlight_body_clamp text-sm italic border-l-2 border-amber-400 pl-2 text-slate-600">
                      "<HighlightMatch text={hl.text} query={localFilter} />"
                    </p>

                    {editingHighlightId === hl.id ? (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2 animate-fade-in"
                      >
                        <textarea
                          className="w-full p-2 text-xs border rounded bg-slate-50 outline-none focus:border-blue-500"
                          value={highlightText}
                          onChange={(e) => setHighlightText(e.target.value)}
                          autoFocus
                          rows={3}
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            onClick={() => setEditingHighlightId(null)}
                            className="text-xs text-slate-500 hover:text-slate-700"
                          >
                            취소
                          </button>
                          <button
                            onClick={() => saveHighlightNote(hl.id)}
                            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            저장
                          </button>
                        </div>
                      </div>
                    ) : hl.note ? (
                      <div className="mt-2 text-xs bg-yellow-50 p-2 rounded text-slate-700 border border-yellow-100">
                        {/* Use HighlightMatch component for note body */}
                        <HighlightMatch text={hl.note} query={localFilter} />
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditHighlight(hl);
                        }}
                        className="mt-2 text-xs text-blue-500 flex items-center gap-1 hover:underline opacity-50 hover:opacity-100"
                      >
                        <Plus size={10} /> 메모 추가
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MyNote Tab with Local Search */}
          {activeToolTab === "mynote" && (
            <div className="mynote_tab_wrap">
              {editingNote ? (
                <div className="mynote_editor_wrap" ref={editorWrapRef}>
                  {/* 헤더: 목록으로 + 수정/작성 상태 표시 */}
                  <div className="mynote_editor_header">
                    <button
                      onClick={closeNoteEditor}
                      className="mynote_back_btn"
                    >
                      <ChevronRight
                        size={16}
                        style={{ transform: "rotate(180deg)" }}
                      />
                      <span>목록으로</span>
                    </button>
                    <span className="mynote_editor_mode_label">
                      {editingNote.id ? "노트 수정" : "새 노트 작성"}
                    </span>
                  </div>

                  {/* 스크롤 가능한 본문 영역 */}
                  <div className="mynote_editor_body">
                    <input
                      type="text"
                      className="mynote_title_input"
                      placeholder="노트 제목을 입력하세요"
                      value={editingNote.title || ""}
                      onChange={(e) => {
                        const c = getCurrentContent();
                        setEditingNote((prev) =>
                          prev
                            ? { ...prev, title: e.target.value, content: c }
                            : null
                        );
                      }}
                    />

                    {/* 툴바: 둥근 박스 형태 */}
                    <div className="mynote_toolbar_box">
                      <button
                        onMouseDown={(e) => handleToolbarAction(e, "bold")}
                        className="mynote_toolbar_btn"
                        title="진하게"
                      >
                        <Bold size={14} />
                      </button>
                      <button
                        onMouseDown={(e) => handleToolbarAction(e, "italic")}
                        className="mynote_toolbar_btn"
                        title="기울임"
                      >
                        <span className="mynote_toolbar_italic">I</span>
                      </button>
                      <button
                        onMouseDown={(e) =>
                          handleToolbarAction(e, "insertUnorderedList")
                        }
                        className="mynote_toolbar_btn"
                        title="글머리 기호"
                      >
                        <List size={14} />
                      </button>
                      {/* <button
                        onMouseDown={insertTable}
                        className="mynote_toolbar_btn"
                        title="테이블 삽입"
                      >
                        <TableIcon size={14} />
                      </button> */}
                      <div className="mynote_toolbar_divider" />
                      <button
                        onMouseDown={(e) =>
                          handleToolbarAction(e, "hiliteColor", "yellow")
                        }
                        className="mynote_toolbar_btn"
                        title="하이라이트"
                      >
                        <Highlighter size={14} />
                      </button>
                      <button
                        onClick={handleCaptureClick}
                        className="mynote_toolbar_btn mynote_toolbar_btn_blue"
                        title="캡처 이미지 첨부"
                      >
                        <Camera size={14} />
                      </button>
                      {/* <button
                        onClick={printNote}
                        className="mynote_toolbar_btn"
                        title="인쇄"
                      >
                        <Printer size={14} />
                      </button> */}
                    </div>

                    {/* 에디터 */}
                    <div
                      key={editingNote.id}
                      ref={contentEditableRef}
                      className="mynote_content_editable note-editor"
                      contentEditable
                      suppressContentEditableWarning={true}
                      onBlur={handleEditorBlur}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const imgSrc = e.dataTransfer.getData("text/plain");
                        if (!imgSrc || !imgSrc.startsWith("data:image")) return;
                        let range: Range | null = null;
                        if (document.caretRangeFromPoint) {
                          range = document.caretRangeFromPoint(e.clientX, e.clientY);
                        } else {
                          const pos = (document as any).caretPositionFromPoint?.(e.clientX, e.clientY);
                          if (pos) {
                            range = document.createRange();
                            range.setStart(pos.offsetNode, pos.offset);
                          }
                        }
                        if (range && contentEditableRef.current) {
                          contentEditableRef.current.focus();
                          const sel = window.getSelection();
                          sel?.removeAllRanges();
                          sel?.addRange(range);
                          document.execCommand("insertHTML", false, `<img src="${imgSrc}" style="max-width:100%;height:auto;" />`);
                        }
                      }}
                    />

                    {/* 캡처 이미지 미리보기 */}
                    {capturedImage && (
                      <div
                        className="mynote_capture_preview"
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          e.dataTransfer.effectAllowed = "copy";
                          e.dataTransfer.setData("text/plain", capturedImage);
                        }}
                      >
                        <img
                          src={capturedImage}
                          className="mynote_capture_img"
                          alt="캡처 이미지"
                          draggable={false}
                        />
                        <button
                          onClick={() => setCapturedImage(null)}
                          className="mynote_capture_remove"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 하단 footer: 캡처 첨부 + 저장 버튼 */}
                  <div className="mynote_editor_footer">
                    <button
                      onClick={handleCaptureClick}
                      className={`mynote_capture_btn${
                        capturedImage ? " active" : ""
                      }`}
                    >
                      <Camera size={16} />
                      {capturedImage ? "이미지 교체" : "캡처 이미지 첨부"}
                    </button>
                    <button
                      onClick={handleSaveNote}
                      className="mynote_save_btn"
                    >
                      <Save size={16} />
                      {editingNote.id ? "수정 사항 저장" : "노트 저장하기"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mynote_list_wrap">
                  <div className="mynote_list_header">
                    <button
                      onClick={() =>
                        openNoteEditor({
                          title: "",
                          content: "",
                          chapterId: currentChapter.id,
                          chapterTitle: currentChapter.title,
                        })
                      }
                      className="mynote_new_btn"
                    >
                      <Plus size={18} /> 새 노트 작성하기
                    </button>
                  </div>
                  <div className="mynote_list_filter">
                    <div className="mynote_filter_row">
                      <span className="mynote_count_label tool_section_label">
                        마이노트 ({filteredNotes.length})
                      </span>
                      {/* <label
                        className="mynote_import_btn"
                        title="Import Note"
                      >
                        <Upload size={13} />
                        <input
                          type="file"
                          className="hidden"
                          accept=".md,.json,.txt"
                          onChange={handleUploadRef}
                        />
                      </label> */}
                    </div>
                    <div className="mynote_search_wrap">
                      <Filter size={12} className="mynote_search_icon" />
                      <input
                        type="text"
                        placeholder="노트에서 검색..."
                        value={localFilter}
                        onChange={(e) => setLocalFilter(e.target.value)}
                        className="mynote_search_input"
                      />
                    </div>
                  </div>
                  <div className="mynote_list_body">
                    {filteredNotes.length === 0 && (
                      <div className="mynote_empty">
                        <StickyNote size={48} className="mynote_empty_icon" />
                        <p className="mynote_empty_text">
                          작성된 노트가 없습니다
                          <br />
                          학습 중에 떠오른 생각을 기록해 보세요
                        </p>
                      </div>
                    )}
                    {filteredNotes.map((note) => (
                      <div
                        key={note.id}
                        onClick={() => openNoteEditor(note)}
                        className="mynote_card"
                      >
                        <div className="mynote_card_header">
                          <div className="mynote_card_meta">
                            <h4 className="mynote_card_title">
                              <HighlightMatch
                                text={note.title || "제목 없음"}
                                query={localFilter}
                              />
                            </h4>
                            <span className="mynote_card_date">
                              {new Date(note.updated_at).toLocaleDateString()} ·{" "}
                              {note.chapterTitle}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeGeneralNote(note.id);
                            }}
                            className="mynote_card_delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div
                          className="mynote_card_body"
                          dangerouslySetInnerHTML={{
                            __html: note.content,
                          }}
                        />
                        <div className="mynote_card_arrow">
                          <ChevronRight size={16} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reference Tab */}
          {activeToolTab === "reference" && (
            <div className="absolute inset-0 flex flex-col bg-white dark:bg-slate-900">
              {referenceDocument ? (
                <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
                  <ContentRenderer
                    customChapter={referenceDocument}
                    variant="side"
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center opacity-60">
                  <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                    <FileText size={32} className="text-slate-400" />
                  </div>
                  <h3 className="font-medium text-slate-800 dark:text-white mb-2">
                    No Reference Document
                  </h3>
                  <p className="text-sm text-slate-500 mb-6 max-w-[240px]">
                    Upload a <strong>text-based PDF</strong> (e.g., papers,
                    e-books). <br />
                    Scanned image PDFs may not display correctly.
                  </p>
                  <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    <FileUp size={16} />
                    <span>Upload PDF</span>
                    <input
                      type="file"
                      className="hidden"
                      accept="application/pdf"
                      onChange={handleUploadRef}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Global Search Tab */}
          {activeToolTab === "search" && (
            <div className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-950">
              <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                <div className="tool_section_header">
                  {searchQuery.trim().length > 1 && (
                    <span className="tool_section_label">
                      검색 결과 ({searchResults.length})
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="검색어 입력(2자 이상)"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPdfSearchHighlight(null);
                    }}
                    className="w-full pl-9 pr-4 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <Search
                    size={16}
                    className="absolute left-3 top-2.5 text-slate-400"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {searchQuery.length > 1 ? (
                  activeToolTab === "search" && searchResults.length > 0 ? (
                    searchResults.map((result) => (
                      <div
                        key={result.id}
                        onClick={() => {
                          if (result.type === "note") {
                            const note = generalNotes.find(
                              (n) => `note-${n.id}` === result.id
                            );
                            if (note) {
                              openNoteEditor(note);
                              setActiveToolTab("mynote");
                            }
                          } else if (result.type === "book") {
                            if (result.pageNumber) {
                              goToPdfPage(result.pageNumber);
                              setPdfSearchHighlight({
                                page: result.pageNumber,
                                term: searchQuery,
                              });
                            }
                          } else {
                            if (result.type === "highlight") {
                              if (result.chapterId === "reference-doc") {
                                const target = Number(result.pageNumber);
                                if (Number.isFinite(target) && target > 0) {
                                  goToPdfPage(target);
                                } else {
                                  console.warn(
                                    "[highlight] pageNumber missing for search result",
                                    result.id
                                  );
                                }
                              } else {
                                const idx = chapters.findIndex(
                                  (c) => c.id === result.chapterId
                                );
                                if (idx !== -1) goToChapter(idx);
                              }
                              focusHighlight(result.id.replace("hl-", ""));
                            } else {
                              const idx = chapters.findIndex(
                                (c) => c.id === result.chapterId
                              );
                              if (idx !== -1) goToChapter(idx);
                            }
                          }
                        }}
                        className="bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm border border-slate-200 dark:border-slate-800 cursor-pointer hover:border-blue-300 transition-all"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${
                              result.type === "chapter"
                                ? "bg-blue-100 text-blue-600"
                                : result.type === "highlight"
                                ? "bg-yellow-100 text-yellow-600"
                                : result.type === "book"
                                ? "bg-indigo-100 text-indigo-600"
                                : "bg-green-100 text-green-600"
                            }`}
                          >
                            {result.type}
                          </span>
                          <span className="text-xs text-slate-500 font-medium truncate flex-1">
                            {result.title}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 line-clamp-2">
                          <HighlightMatch
                            text={result.contentSnippet}
                            query={searchQuery}
                          />
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-10 opacity-50">
                      <p className="text-sm text-slate-500">
                        No results found for "{searchQuery}"
                      </p>
                    </div>
                  )
                ) : (
                  <div className="text-center py-10 opacity-50">
                    <Search size={24} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-sm text-slate-400">
                      검색어를 입력해주세요.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </PanelWrapper>
  );
};
