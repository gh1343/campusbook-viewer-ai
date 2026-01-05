export interface Chapter {
  id: string;
  title: string;
  content: string;
}

export interface RagChunk {
  id: string;
  text: string;
  pageNumber?: number;
}

export interface SearchResult {
  id: string;
  type: "chapter" | "highlight" | "note" | "pdf";
  title: string;
  contentSnippet: string;
  chapterId?: string;
  matchIndex?: number;
  pageNumber?: number;
}

export interface PdfBookmark {
  id: string;
  page: number;
  label: string;
  createdAt: number;
}

export interface Highlight {
  id: string;
  chapterId: string;
  text: string;
  color: "yellow" | "green" | "blue";
  pageNumber?: number;
  note?: string;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: number;
}

export interface ReadingStats {
  totalReadingTime: number;
  sessions: number;
  chapterVisits: Record<string, number>;
  aiInteractionCount: number;
  highlightCount: number;
}

export interface Point {
  x: number;
  y: number;
}

export type DrawingColor =
  | "#000000"
  | "#ef4444"
  | "#3b82f6"
  | "#22c55e"
  | "#eab308";

export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  width: number;
  opacity: number;
  isEraser?: boolean;
  anchorIndex?: number;
  pageNumber?: number;
}

export interface GeneralNote {
  id: string;
  title: string;
  content: string;
  chapterId?: string;
  chapterTitle?: string;
  createdAt: number;
  updatedAt: number;
}

export type Theme = "light" | "dark";
export type FontSize = "small" | "medium" | "large" | "xlarge";
export type DrawingMode = "idle" | "pen" | "eraser";
export type ViewMode = "single" | "double";

export type TTSVoice = "Kore" | "Puck" | "Charon" | "Fenrir" | "Zephyr";

export interface TTSConfig {
  voice: TTSVoice;
  speed: number;
  continuous: boolean;
}

export interface BookContextType {
  chapters: Chapter[];
  referenceDocument: Chapter | null;

  currentChapterIndex: number;
  currentChapter: Chapter;
  goToNextChapter: () => void;
  goToPrevChapter: () => void;
  goToChapter: (index: number) => void;
  uploadBook: (file: File) => Promise<void>;
  isProcessing: boolean;

  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;

  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  theme: Theme;
  toggleTheme: () => void;

  showAnnotations: boolean;
  toggleAnnotations: () => void;

  bookmarks: PdfBookmark[];
  addPdfBookmark: (page: number, label?: string) => void;
  removePdfBookmark: (id: string) => void;

  highlights: Highlight[];
  addHighlight: (
    text: string,
    note?: string,
    targetChapterId?: string,
    pageNumber?: number
  ) => string;
  updateHighlight: (id: string, data: Partial<Highlight> & { note?: string }) => void;
  removeHighlight: (id: string) => void;
  activeHighlightId: string | null;
  focusHighlight: (id: string) => void;
  goToHighlight: (hl: Highlight | string) => void;

  drawingMode: DrawingMode;
  setDrawingMode: (mode: DrawingMode) => void;

  penColor: DrawingColor;
  setPenColor: (color: DrawingColor) => void;
  penWidth: number;
  setPenWidth: (width: number) => void;
  penOpacity: number;
  setPenOpacity: (opacity: number) => void;

  chapterStrokes: Record<string, Stroke[]>;
  addStroke: (chapterId: string, stroke: Stroke) => void;
  removeStroke: (chapterId: string, strokeId: string) => void;
  hasStrokes: (chapterId: string) => boolean;

  generalNotes: GeneralNote[];
  addGeneralNote: (title: string, content: string) => void;
  updateGeneralNote: (id: string, title: string, content: string) => void;
  removeGeneralNote: (id: string) => void;
  importNotes: (file: File) => Promise<void>;
  exportNoteAsMarkdown: (note: GeneralNote) => void;

  isCaptureMode: boolean;
  setCaptureMode: (isCapture: boolean) => void;
  capturedImage: string | null;
  setCapturedImage: (image: string | null) => void;

  aiChatHistory: ChatMessage[];
  addChatMessage: (role: "user" | "model", text: string) => void;
  triggerSmartExplain: (text: string) => void;

  isToolsOpen: boolean;
  setToolsOpen: (isOpen: boolean) => void;
  activeToolTab: "ai" | "notes" | "notebook" | "reference" | "search";
  setActiveToolTab: (
    tab: "ai" | "notes" | "notebook" | "reference" | "search"
  ) => void;

  searchQuery: string;
  setSearchQuery: (query: string) => void;
  performSearch: (query: string) => SearchResult[];

  isTtsPlaying: boolean;
  currentTtsSegmentIndex: number | null;
  ttsConfig: TTSConfig;
  setTtsConfig: (config: Partial<TTSConfig>) => void;
  startTts: (startIndex?: number) => void;
  stopTts: () => void;
  pauseTts: () => void;

  stats: ReadingStats;
  incrementAiCount: () => void;
  updateReadingTime: () => void;

  saveProgress: () => Promise<void>;

  pdfTextPages: { page: number; text: string }[];
  setPdfTextPages: (pages: { page: number; text: string }[]) => void;
  goToPdfPage: (page: number) => void;
  registerPdfNavigator: (fn: (page: number) => void) => void;
  pdfSearchHighlight: { page: number; term: string } | null;
  setPdfSearchHighlight: (value: { page: number; term: string } | null) => void;
  currentPdfPage: number;
  setCurrentPdfPage: (page: number) => void;
}
