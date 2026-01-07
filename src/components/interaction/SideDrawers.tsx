import React, { useState, useRef, useEffect } from "react";
import { useBook } from "../../contexts/BookContext";
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
} from "lucide-react";
import { generateExplanation } from "../../services/geminiService";
import { GeneralNote, Highlight as HighlightType } from "../../../types";
import { ContentRenderer } from "../../features/viewer";
import "../../css/side_drawers.css";
interface PanelProps {
  isOpen: boolean;
  onClose: () => void;
  side: "left" | "right";
  title?: string;
  children: React.ReactNode;
}

// Helper component to highlight matching text
const HighlightMatch = ({ text, query }: { text: string; query: string }) => {
  if (!query || !query.trim()) return <>{text}</>;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-yellow-300 text-slate-900 rounded-[2px] px-0.5 font-medium"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
};

const PanelWrapper: React.FC<PanelProps> = ({
  isOpen,
  onClose,
  side,
  title,
  children,
}) => {
  return <>{children}</>;
};

export const TocPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const {
    chapters,
    currentChapterIndex,
    goToChapter,
    hasStrokes,
    bookmarks,
    goToPdfPage,
    removePdfBookmark,
    currentPdfPage,
    goToHighlight,
  } = useBook();
  const [activeTab, setActiveTab] = useState<"contents" | "bookmarks">(
    "contents"
  );
  const chapterListRef = useRef<HTMLDivElement | null>(null);
  const chapterItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 활성 챕터가 보이도록 사이드바 스크롤 자동 조정
  useEffect(() => {
    if (activeTab !== "contents") return;
    const target = chapterItemRefs.current[currentChapterIndex];
    if (!target) return;
    const container = chapterListRef.current;
    if (!container) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const cRect = container.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const isVisible = tRect.top >= cRect.top && tRect.bottom <= cRect.bottom;
    if (!isVisible) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [currentChapterIndex, activeTab]);

  return (
    <PanelWrapper
      isOpen={isOpen}
      onClose={onClose}
      side="left"
      title="Contents"
    >
      <div className="chapter_favor_wrap">
        <button
          onClick={() => setActiveTab("contents")}
          className={`chapter ${activeTab === "contents" ? "on" : "off"}`}
        >
          <ListIcon size={14} /> Chapters
        </button>
        <button
          onClick={() => setActiveTab("bookmarks")}
          className={`favor ${activeTab === "bookmarks" ? "on" : "off"}`}
        >
          <Bookmark size={14} /> Favorites
        </button>
      </div>
      <div className="chapter_list" ref={chapterListRef}>
        {activeTab === "contents" &&
          chapters.map((chapter, idx) => (
            <button
              key={chapter.id}
              ref={(el) => {
                chapterItemRefs.current[idx] = el;
              }}
              onClick={() => {
                goToChapter(idx);
                if (window.innerWidth < 768) onClose();
              }}
              className={` ${idx === currentChapterIndex ? "on" : "off"}`}
            >
              <div className="chapter_list_inner">
                <div className="">
                  <span
                    className={`text_xs ${
                      idx === currentChapterIndex ? "on" : "off"
                    }`}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="line_clamp_1">{chapter.title}</span>
                </div>
                {hasStrokes(chapter.id) && (
                  <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 p-1 rounded-full">
                    <PenTool size={10} />
                  </div>
                )}
              </div>
            </button>
          ))}
        {activeTab === "bookmarks" &&
          bookmarks.map((bm) => (
            <div
              key={bm.id}
              className={`bookmark_item_row ${
                bm.page === currentPdfPage ? "active" : ""
              }`}
            >
              <button
                onClick={() => {
                  goToPdfPage(bm.page);
                  if (window.innerWidth < 768) onClose();
                }}
                className="bookmark_item_button"
              >
                <div className="bookmark_page_badge">
                  {/* <Bookmark size={14} />
                    <span>Page {bm.page}</span> */}
                  <span className="bookmark_label line_clamp_1">
                    {`P. ${bm.page}`}
                  </span>
                </div>
                <div className="bookmark_item_text">
                  {/* <span className="bookmark_label line_clamp_1">
                      {bm.label || `Page ${bm.page}`}
                    </span> */}
                  <span className="bookmark_meta">
                    Saved {new Date(bm.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removePdfBookmark(bm.id);
                }}
                className="bookmark_remove_btn"
                title="Delete bookmark"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        {activeTab === "bookmarks" && bookmarks.length === 0 && (
          <div className="non_book_mark">
            <Bookmark size={24} className="mx-auto mb-2 text-slate-400" />
            <p className="text_sm">No bookmarks yet</p>
            <p className="text_sm">
              Use the bookmark icon near Search to save a page.
            </p>
          </div>
        )}
      </div>
    </PanelWrapper>
  );
};

export const ToolsPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const {
    highlights,
    removeHighlight,
    updateHighlight,
    currentChapter,
    incrementAiCount,
    generalNotes,
    addGeneralNote,
    updateGeneralNote,
    removeGeneralNote,
    importNotes,
    exportNoteAsMarkdown,
    focusHighlight,
    goToChapter,
    chapters,
    aiChatHistory,
    addChatMessage,
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
    goToPdfPage,
    pdfSearchHighlight,
    setPdfSearchHighlight,
    goToHighlight,
  } = useBook();

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
  const savedSelectionRef = useRef<Range | null>(null);

  const aiTalkEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      editingNote &&
      contentEditableRef.current &&
      contentEditableRef.current.innerHTML !== (editingNote.content || "")
    ) {
      contentEditableRef.current.innerHTML = editingNote.content || "";
    }
  }, [editingNote?.id]);

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

  const handleTabChange = (
    tab: "ai" | "notes" | "notebook" | "reference" | "search"
  ) => {
    if (activeToolTab === "notebook" && editingNote) {
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

  // Filtered Lists for Memos and Notebook
  const filteredHighlights = highlights.filter(
    (hl) =>
      hl.text.toLowerCase().includes(localFilter.toLowerCase()) ||
      (hl.note && hl.note.toLowerCase().includes(localFilter.toLowerCase()))
  );

  const filteredNotes = generalNotes.filter(
    (note) =>
      note.title.toLowerCase().includes(localFilter.toLowerCase()) ||
      note.content.toLowerCase().includes(localFilter.toLowerCase())
  );

  useEffect(() => {
    if (capturedImage && editingNote) {
      const imgHtml = `<div class="capture-img-container"><img src="${capturedImage}" style="max-width:100%; border:1px solid #ccc; border-radius:4px; margin: 10px 0; display: block;" /></div><p><br/></p>`;
      const newContent = (editingNote.content || "") + imgHtml;
      setEditingNote((prev) =>
        prev ? { ...prev, content: newContent } : null
      );
      if (contentEditableRef.current)
        contentEditableRef.current.innerHTML = newContent;
      setCapturedImage(null);
    }
  }, [capturedImage, setCapturedImage]);
  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim()) return;
    const userMsg = aiInput;
    addChatMessage("user", userMsg);
    setAiInput("");
    setIsAiThinking(true);
    incrementAiCount();
    const explanation = await generateExplanation(
      userMsg,
      currentChapter.content.substring(0, 1000)
    );
    addChatMessage("model", explanation);
    setIsAiThinking(false);
  };
  const handleSaveNote = () => {
    if (editingNote) {
      const finalContent = getCurrentContent();
      if (editingNote.title) {
        if (editingNote.id)
          updateGeneralNote(editingNote.id, editingNote.title, finalContent);
        else addGeneralNote(editingNote.title, finalContent);
        setEditingNote(null);
      }
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
    setTimeout(() => setCaptureMode(true), 50);
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
  const searchResults =
    activeToolTab === "search" ? performSearch(searchQuery) : [];

  return (
    <PanelWrapper isOpen={isOpen} onClose={onClose} side="right">
      <div className="right_panel_menu">
        <button
          onClick={() => handleTabChange("ai")}
          className={`ai ${activeToolTab === "ai" ? "on" : "off"}`}
          title="AI"
        >
          <MessageSquare size={14} />
        </button>
        <button
          onClick={() => handleTabChange("notes")}
          className={`notes ${activeToolTab === "notes" ? "on" : "off"}`}
          title="Highlights"
        >
          <Highlighter size={14} />
        </button>
        <button
          onClick={() => handleTabChange("notebook")}
          className={`notebook ${activeToolTab === "notebook" ? "on" : "off"}`}
          title="Notebook"
        >
          <Book size={14} />
        </button>
        <button
          onClick={() => handleTabChange("reference")}
          className={`reference ${
            activeToolTab === "reference" ? "on" : "off"
          }`}
          title="Reference PDF"
        >
          <FileText size={14} />
        </button>
        <button
          onClick={() => handleTabChange("search")}
          className={`search ${activeToolTab === "search" ? "on" : "off"}`}
          title="Search"
        >
          <Search size={14} />
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
        {activeToolTab === "notes" && (
          <div className="absolute inset-0 flex flex-col">
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter highlights..."
                  value={localFilter}
                  onChange={(e) => setLocalFilter(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 rounded-md text-xs border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
                <Filter
                  size={12}
                  className="absolute left-2.5 top-2 text-slate-400"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredHighlights.length === 0 && (
                <div className="text-center py-10 opacity-50">
                  <Highlighter size={24} className="mx-auto mb-2" />
                  <p className="text-sm">No highlights</p>
                </div>
              )}
              {filteredHighlights.map((hl) => (
                <div
                  key={hl.id}
                  onClick={() => goToHighlight(hl)}
                  className="p-4 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-blue-300 transition-all"
                >
                  <div className="flex justify-between mb-2 text-xs text-slate-400">
                    <span>
                      {hl.chapterId === "reference-doc"
                        ? "Reference PDF"
                        : `Chapter ${
                            chapters.findIndex((c) => c.id === hl.chapterId) + 1
                          }`}
                    </span>
                    <div className="flex gap-2">
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
                  <p className="highlight_txt text-sm italic border-l-2 border-amber-400 pl-2 text-slate-600">
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
                          Cancel
                        </button>
                        <button
                          onClick={() => saveHighlightNote(hl.id)}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          Save
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
                      <Plus size={10} /> Add Note
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notebook Tab with Local Search */}
        {activeToolTab === "notebook" && (
          <div className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-950">
            {editingNote ? (
              <div className="flex-1 flex flex-col h-full bg-white dark:bg-slate-900 animate-fade-in">
                <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900">
                  <button
                    onClick={() => setEditingNote(null)}
                    className="text-xs font-medium text-slate-500"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveNote}
                    className="text-xs font-bold text-green-600 flex items-center gap-1"
                  >
                    <Save size={14} /> Save
                  </button>
                </div>
                <div className="px-4 pt-4 pb-2">
                  <input
                    type="text"
                    className="w-full text-lg font-bold bg-transparent outline-none"
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
                </div>
                <div className="px-2 py-1.5 flex flex-wrap gap-1 border-y bg-slate-50 dark:bg-slate-900/50">
                  <button
                    onMouseDown={(e) => handleToolbarAction(e, "bold")}
                    className="p-1.5 rounded hover:bg-slate-200"
                  >
                    <Bold size={14} />
                  </button>
                  <button
                    onMouseDown={(e) => handleToolbarAction(e, "italic")}
                    className="p-1.5 rounded hover:bg-slate-200"
                  >
                    <span className="italic">I</span>
                  </button>
                  <button
                    onMouseDown={(e) =>
                      handleToolbarAction(e, "hiliteColor", "yellow")
                    }
                    className="p-1.5 rounded hover:bg-slate-200"
                  >
                    <Highlighter size={14} />
                  </button>
                  <button
                    onMouseDown={insertTable}
                    className="p-1.5 rounded hover:bg-slate-200"
                  >
                    <TableIcon size={14} />
                  </button>
                  <button
                    onMouseDown={handleCaptureClick}
                    className="p-1.5 rounded hover:bg-slate-200 text-blue-600"
                  >
                    <Camera size={14} />
                  </button>
                  <button
                    onClick={printNote}
                    className="p-1.5 rounded hover:bg-slate-200"
                  >
                    <Printer size={14} />
                  </button>
                </div>
                <div
                  key={editingNote.id}
                  ref={contentEditableRef}
                  className="flex-1 p-4 overflow-y-auto outline-none text-sm note-editor"
                  contentEditable
                  suppressContentEditableWarning={true}
                  onBlur={handleEditorBlur}
                />
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col">
                <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-3 bg-slate-50 dark:bg-slate-900">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                      My Notes ({generalNotes.length})
                    </h3>
                    <div className="flex gap-2">
                      <label
                        className="cursor-pointer p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                        title="Import Note"
                      >
                        <Upload size={14} />
                        <input
                          type="file"
                          className="hidden"
                          accept=".md,.json,.txt"
                          onChange={handleUploadRef}
                        />
                      </label>
                      <button
                        onClick={() =>
                          setEditingNote({
                            title: "",
                            content: "",
                            chapterId: currentChapter.id,
                            chapterTitle: currentChapter.title,
                          })
                        }
                        className="flex items-center gap-1 px-2 py-1 bg-green-600 text-white rounded-md text-xs font-medium hover:bg-green-700 shadow-sm transition-all"
                      >
                        <Plus size={14} /> New
                      </button>
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search notes..."
                      value={localFilter}
                      onChange={(e) => setLocalFilter(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 rounded-md text-xs border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                    <Filter
                      size={12}
                      className="absolute left-2.5 top-2 text-slate-400"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  {filteredNotes.length === 0 && (
                    <div className="text-center py-10 opacity-50">
                      <Book size={32} className="mx-auto text-slate-300 mb-2" />
                      <p className="text-sm text-slate-400">No notes found</p>
                    </div>
                  )}
                  {filteredNotes.map((note) => (
                    <div
                      key={note.id}
                      onClick={() => setEditingNote(note)}
                      className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border cursor-pointer hover:border-green-300 transition-all"
                    >
                      <div className="flex justify-between mb-1">
                        <h4 className="font-semibold text-sm">
                          {/* Highlight Match on Title */}
                          <HighlightMatch
                            text={note.title}
                            query={localFilter}
                          />
                        </h4>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeGeneralNote(note.id);
                          }}
                        >
                          <Trash2 size={12} text-slate-300 />
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2">
                        {/* Highlight Match on Snippet */}
                        <HighlightMatch
                          text={note.content.replace(/<[^>]+>/g, " ")}
                          query={localFilter}
                        />
                      </p>
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
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search entire book & notes..."
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
                activeToolTab === "search" &&
                performSearch(searchQuery).length > 0 ? (
                  performSearch(searchQuery).map((result) => (
                    <div
                      key={result.id}
                      onClick={() => {
                        if (result.type === "note") {
                          const note = generalNotes.find(
                            (n) => `note-${n.id}` === result.id
                          );
                          if (note) {
                            setEditingNote(note);
                            setActiveToolTab("notebook");
                          }
                        } else if (result.type === "pdf") {
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
                              : result.type === "pdf"
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
                    Type at least 2 characters to search
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PanelWrapper>
  );
};
