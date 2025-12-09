import React, {useState, useRef, useEffect, useCallback} from 'react';
import {useBook} from '../../contexts/BookContext';
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
} from 'lucide-react';
import {generateExplanation} from '../../services/geminiService';
import {GeneralNote, Highlight as HighlightType} from '../../../types';
import {ContentRenderer} from '../viewer/ContentRenderer';

interface PanelProps {
  isOpen: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  title?: string;
  children: React.ReactNode;
}

// Helper component to highlight matching text
const HighlightMatch = ({text, query}: {text: string; query: string}) => {
  if (!query || !query.trim()) return <>{text}</>;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-yellow-300 dark:bg-yellow-600/50 text-slate-900 dark:text-white rounded-[2px] px-0.5 font-medium"
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
  return (
    <>
      <div
        className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed md:relative z-50 h-full bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xl md:shadow-none transition-transform duration-300 ease-in-out overflow-hidden flex flex-col ${
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l'
        } ${
          isOpen
            ? 'translate-x-0'
            : side === 'left'
            ? '-translate-x-full md:translate-x-0'
            : 'translate-x-full md:translate-x-0'
        } w-80 md:w-full`}
      >
        <div className="w-80 md:w-96 flex flex-col h-full">
          <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 md:hidden">
            {title && (
              <h2 className="font-semibold text-slate-800 dark:text-slate-200">
                {title}
              </h2>
            )}
            <button
              onClick={onClose}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
      </aside>
    </>
  );
};

export const TocPanel: React.FC<{isOpen: boolean; onClose: () => void}> = ({
  isOpen,
  onClose,
}) => {
  const {chapters, currentChapterIndex, goToChapter, hasStrokes, bookmarks} =
    useBook();
  const [activeTab, setActiveTab] = useState<'contents' | 'bookmarks'>(
    'contents'
  );

  return (
    <PanelWrapper
      isOpen={isOpen}
      onClose={onClose}
      side="left"
      title="Contents"
    >
      <div className="flex flex-col h-full w-full">
        <div className="flex p-2 gap-1 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={() => setActiveTab('contents')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${
              activeTab === 'contents'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ListIcon size={14} /> Chapters
          </button>
          <button
            onClick={() => setActiveTab('bookmarks')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${
              activeTab === 'bookmarks'
                ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Bookmark size={14} /> Favorites
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {activeTab === 'contents' &&
            chapters.map((chapter, idx) => (
              <button
                key={chapter.id}
                onClick={() => {
                  goToChapter(idx);
                  if (window.innerWidth < 768) onClose();
                }}
                className={`w-full text-left px-5 py-3 text-sm transition-all border-l-2 ${
                  idx === currentChapterIndex
                    ? 'bg-blue-50 dark:bg-slate-800/50 border-blue-500 text-blue-700 dark:text-blue-400 font-medium'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs ${
                        idx === currentChapterIndex
                          ? 'text-blue-400'
                          : 'text-slate-300'
                      }`}
                    >
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className="line-clamp-1">{chapter.title}</span>
                  </div>
                  {hasStrokes(chapter.id) && (
                    <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 p-1 rounded-full">
                      <PenTool size={10} />
                    </div>
                  )}
                </div>
              </button>
            ))}
          {activeTab === 'bookmarks' &&
            bookmarks.map(bid => {
              const chapter = chapters.find(c => c.id === bid);
              if (!chapter) return null;
              return (
                <button
                  key={bid}
                  onClick={() => {
                    goToChapter(chapters.findIndex(c => c.id === bid));
                    if (window.innerWidth < 768) onClose();
                  }}
                  className="w-full text-left px-5 py-3 text-sm transition-all border-l-2 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                >
                  <div className="flex items-center gap-3">
                    <Bookmark
                      size={14}
                      className="text-amber-500 fill-amber-500"
                    />
                    <span className="line-clamp-1">{chapter.title}</span>
                  </div>
                </button>
              );
            })}
          {activeTab === 'bookmarks' && bookmarks.length === 0 && (
            <div className="text-center py-10 opacity-50">
              <Bookmark size={24} className="mx-auto mb-2 text-slate-400" />
              <p className="text-sm">No bookmarks</p>
            </div>
          )}
        </div>
      </div>
    </PanelWrapper>
  );
};

export const ToolsPanel: React.FC<{isOpen: boolean; onClose: () => void}> = ({
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
  } = useBook();

  const [aiInput, setAiInput] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [editingNote, setEditingNote] = useState<Partial<GeneralNote> | null>(
    null
  );
  const [editingHighlightId, setEditingHighlightId] = useState<string | null>(
    null
  );
  const [highlightText, setHighlightText] = useState('');
  const [localFilter, setLocalFilter] = useState('');

  const contentEditableRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);

  useEffect(() => {
    if (
      editingNote &&
      contentEditableRef.current &&
      contentEditableRef.current.innerHTML !== (editingNote.content || '')
    ) {
      contentEditableRef.current.innerHTML = editingNote.content || '';
    }
  }, [editingNote?.id]);

  const getCurrentContent = () =>
    contentEditableRef.current ? contentEditableRef.current.innerHTML : '';

  const handleTabChange = (
    tab: 'ai' | 'notes' | 'notebook' | 'reference' | 'search'
  ) => {
    if (activeToolTab === 'notebook' && editingNote) {
      const content = getCurrentContent();
      setEditingNote(prev => (prev ? {...prev, content} : null));
    }
    setActiveToolTab(tab);
    setLocalFilter('');
  };

  const startEditHighlight = (hl: HighlightType) => {
    setEditingHighlightId(hl.id);
    setHighlightText(hl.note || '');
  };

  const saveHighlightNote = (id: string) => {
    updateHighlight(id, highlightText);
    setEditingHighlightId(null);
    setHighlightText('');
  };

  // Filtered Lists for Memos and Notebook
  const filteredHighlights = highlights.filter(
    hl =>
      hl.text.toLowerCase().includes(localFilter.toLowerCase()) ||
      (hl.note && hl.note.toLowerCase().includes(localFilter.toLowerCase()))
  );

  const filteredNotes = generalNotes.filter(
    note =>
      note.title.toLowerCase().includes(localFilter.toLowerCase()) ||
      note.content.toLowerCase().includes(localFilter.toLowerCase())
  );

  useEffect(() => {
    if (capturedImage && editingNote) {
      const imgHtml = `<div class="capture-img-container"><img src="${capturedImage}" style="max-width:100%; border:1px solid #ccc; border-radius:4px; margin: 10px 0; display: block;" /></div><p><br/></p>`;
      const newContent = (editingNote.content || '') + imgHtml;
      setEditingNote(prev => (prev ? {...prev, content: newContent} : null));
      if (contentEditableRef.current)
        contentEditableRef.current.innerHTML = newContent;
      setCapturedImage(null);
    }
  }, [capturedImage, setCapturedImage]);
  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim()) return;
    const userMsg = aiInput;
    addChatMessage('user', userMsg);
    setAiInput('');
    setIsAiThinking(true);
    incrementAiCount();
    const explanation = await generateExplanation(
      userMsg,
      currentChapter.content.substring(0, 1000)
    );
    addChatMessage('model', explanation);
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
    setEditingNote(prev => (prev ? {...prev, content: currentContent} : null));
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
    const r = parseInt(prompt('Rows:', '2') || '0');
    const c = parseInt(prompt('Columns:', '2') || '0');
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
        document.execCommand('insertHTML', false, html);
      }
    }
  };
  const handleUploadRef = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) uploadBook(e.target.files[0]);
  };
  const handleEditorBlur = () => {
    const currentContent = getCurrentContent();
    setEditingNote(prev => (prev ? {...prev, content: currentContent} : null));
  };
  const printNote = () => {
    if (!editingNote) return;
    const content = getCurrentContent();
    const printWindow = window.open('', '', 'height=600,width=800');
    if (printWindow) {
      printWindow.document.write(
        `<html><head><title>${editingNote.title}</title><style>body{font-family:sans-serif;padding:20px;}table{border-collapse:collapse;width:100%;}td,th{border:1px solid #ccc;padding:8px;}img{max-width:100%;}</style></head><body><h1>${editingNote.title}</h1>${content}</body></html>`
      );
      printWindow.document.close();
      printWindow.print();
    }
  };
  const searchResults =
    activeToolTab === 'search' ? performSearch(searchQuery) : [];

  return (
    <PanelWrapper isOpen={isOpen} onClose={onClose} side="right">
      <div className="flex flex-col h-full w-full">
        <div className="flex p-2 gap-1 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800 overflow-x-auto no-scrollbar">
          <button
            onClick={() => handleTabChange('ai')}
            className={`flex-1 min-w-[50px] flex items-center justify-center gap-1.5 py-2 rounded-md text-[10px] md:text-xs font-medium transition-all ${
              activeToolTab === 'ai'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="AI"
          >
            <MessageSquare size={14} />
          </button>
          <button
            onClick={() => handleTabChange('notes')}
            className={`flex-1 min-w-[50px] flex items-center justify-center gap-1.5 py-2 rounded-md text-[10px] md:text-xs font-medium transition-all ${
              activeToolTab === 'notes'
                ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Highlights"
          >
            <Highlighter size={14} />
          </button>
          <button
            onClick={() => handleTabChange('notebook')}
            className={`flex-1 min-w-[50px] flex items-center justify-center gap-1.5 py-2 rounded-md text-[10px] md:text-xs font-medium transition-all ${
              activeToolTab === 'notebook'
                ? 'bg-white dark:bg-slate-800 text-green-600 dark:text-green-400 shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Notebook"
          >
            <Book size={14} />
          </button>
          <button
            onClick={() => handleTabChange('reference')}
            className={`flex-1 min-w-[50px] flex items-center justify-center gap-1.5 py-2 rounded-md text-[10px] md:text-xs font-medium transition-all ${
              activeToolTab === 'reference'
                ? 'bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-400 shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Reference PDF"
          >
            <FileText size={14} />
          </button>
          <button
            onClick={() => handleTabChange('search')}
            className={`flex-1 min-w-[50px] flex items-center justify-center gap-1.5 py-2 rounded-md text-[10px] md:text-xs font-medium transition-all ${
              activeToolTab === 'search'
                ? 'bg-white dark:bg-slate-800 text-red-600 dark:text-red-400 shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Search"
          >
            <Search size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden relative">
          {activeToolTab === 'ai' && (
            <div className="absolute inset-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {aiChatHistory.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-60">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-3">
                      <MessageSquare className="text-blue-500" size={24} />
                    </div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      AI Study Companion
                    </p>
                  </div>
                )}
                {aiChatHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm shadow-sm whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-none'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-bl-none'
                      }`}
                    >
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
              </div>
              <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
                <form onSubmit={handleAiSubmit} className="relative">
                  <input
                    type="text"
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    placeholder="Ask AI..."
                    className="w-full pl-4 pr-10 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:border-blue-500 dark:focus:border-blue-500 dark:text-white transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={!aiInput.trim() || isAiThinking}
                    className="absolute right-2 top-2 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <MessageSquare size={16} />
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Highlights Tab with Local Search */}
          {activeToolTab === 'notes' && (
            <div className="absolute inset-0 flex flex-col">
              <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Filter highlights..."
                    value={localFilter}
                    onChange={e => setLocalFilter(e.target.value)}
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
                {filteredHighlights.map(hl => (
                  <div
                    key={hl.id}
                    onClick={() => {
                      goToChapter(
                        chapters.findIndex(c => c.id === hl.chapterId)
                      );
                      focusHighlight(hl.id);
                    }}
                    className="p-4 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-blue-300 transition-all"
                  >
                    <div className="flex justify-between mb-2 text-xs text-slate-400">
                      <span>
                        {hl.chapterId === 'reference-doc'
                          ? 'Reference PDF'
                          : `Chapter ${
                              chapters.findIndex(c => c.id === hl.chapterId) + 1
                            }`}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            startEditHighlight(hl);
                          }}
                          title="Edit Note"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          onClick={e => {
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
                    <p className="text-sm italic border-l-2 border-amber-400 pl-2 text-slate-600 dark:text-slate-300">
                      "<HighlightMatch text={hl.text} query={localFilter} />"
                    </p>

                    {editingHighlightId === hl.id ? (
                      <div
                        onClick={e => e.stopPropagation()}
                        className="mt-2 animate-fade-in"
                      >
                        <textarea
                          className="w-full p-2 text-xs border rounded bg-slate-50 dark:bg-slate-900 dark:text-white outline-none focus:border-blue-500"
                          value={highlightText}
                          onChange={e => setHighlightText(e.target.value)}
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
                      <div className="mt-2 text-xs bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded text-slate-700 dark:text-slate-300 border border-yellow-100 dark:border-yellow-800">
                        {/* Use HighlightMatch component for note body */}
                        <HighlightMatch text={hl.note} query={localFilter} />
                      </div>
                    ) : (
                      <button
                        onClick={e => {
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
          {activeToolTab === 'notebook' && (
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
                      value={editingNote.title || ''}
                      onChange={e => {
                        const c = getCurrentContent();
                        setEditingNote(prev =>
                          prev
                            ? {...prev, title: e.target.value, content: c}
                            : null
                        );
                      }}
                    />
                  </div>
                  <div className="px-2 py-1.5 flex flex-wrap gap-1 border-y bg-slate-50 dark:bg-slate-900/50">
                    <button
                      onMouseDown={e => handleToolbarAction(e, 'bold')}
                      className="p-1.5 rounded hover:bg-slate-200"
                    >
                      <Bold size={14} />
                    </button>
                    <button
                      onMouseDown={e => handleToolbarAction(e, 'italic')}
                      className="p-1.5 rounded hover:bg-slate-200"
                    >
                      <span className="italic">I</span>
                    </button>
                    <button
                      onMouseDown={e =>
                        handleToolbarAction(e, 'hiliteColor', 'yellow')
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
                              title: '',
                              content: '',
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
                        onChange={e => setLocalFilter(e.target.value)}
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
                        <Book
                          size={32}
                          className="mx-auto text-slate-300 mb-2"
                        />
                        <p className="text-sm text-slate-400">No notes found</p>
                      </div>
                    )}
                    {filteredNotes.map(note => (
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
                            onClick={e => {
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
                            text={note.content.replace(/<[^>]+>/g, ' ')}
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
          {activeToolTab === 'reference' && (
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
          {activeToolTab === 'search' && (
            <div className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-950">
              <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search entire book & notes..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
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
                  activeToolTab === 'search' &&
                  performSearch(searchQuery).length > 0 ? (
                    performSearch(searchQuery).map(result => (
                      <div
                        key={result.id}
                        onClick={() => {
                          if (result.type === 'note') {
                            const note = generalNotes.find(
                              n => `note-${n.id}` === result.id
                            );
                            if (note) {
                              setEditingNote(note);
                              setActiveToolTab('notebook');
                            }
                          } else {
                            const idx = chapters.findIndex(
                              c => c.id === result.chapterId
                            );
                            if (idx !== -1) {
                              goToChapter(idx);
                              if (result.type === 'highlight') {
                                focusHighlight(result.id.replace('hl-', ''));
                              }
                            }
                          }
                        }}
                        className="bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm border border-slate-200 dark:border-slate-800 cursor-pointer hover:border-blue-300 transition-all"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${
                              result.type === 'chapter'
                                ? 'bg-blue-100 text-blue-600'
                                : result.type === 'highlight'
                                ? 'bg-yellow-100 text-yellow-600'
                                : 'bg-green-100 text-green-600'
                            }`}
                          >
                            {result.type}
                          </span>
                          <span className="text-xs text-slate-500 font-medium truncate flex-1">
                            {result.title}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
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
      </div>
    </PanelWrapper>
  );
};
