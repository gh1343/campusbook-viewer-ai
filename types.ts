export interface Chapter {
  id: string;
  title: string;
  content: string;
  depth?: number; // v2 base.json toc depth (1=장, 2=절, 3=소절, 4=항)
}

export interface RagChunk {
  id: string;
  text: string;
  pageNumber?: number;
}

export interface SearchResult {
  id: string;
  type: "chapter" | "highlight" | "note" | "book";
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
  created_at: number;
  updated_at?: number;
  deleted?: boolean;
  syncStatus?: "pending" | "synced";
}

export interface PdfHighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
}

export interface Highlight {
  id: string;
  chapterId: string;
  text: string;
  color: "yellow" | "green" | "blue";
  pageNumber?: number;
  note?: string;
  rects?: PdfHighlightRect[];
  created_at: number;
  updated_at?: number;
  deleted?: boolean;
  syncStatus?: "pending" | "synced"; // Track sync status
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
  created_at?: number;
  updated_at?: number;
  deleted?: boolean;
  isEraser?: boolean;
  anchorIndex?: number;
  pageNumber?: number;
  pageWidth?: number;
  pageHeight?: number;
  syncStatus?: "pending" | "synced";
}

export interface GeneralNote {
  id: string;
  title: string;
  content: string;
  chapterId?: string;
  chapterTitle?: string;
  created_at: number;
  updated_at: number;
  deleted?: boolean;
}

export type Theme = "light" | "dark";
export type FontSize = "small" | "medium" | "large" | "xlarge";
export type DrawingMode = "idle" | "pen" | "highlighter" | "eraser";
export type ViewMode = "single" | "double";

export type TTSVoice = "Kore" | "Puck" | "Charon" | "Fenrir" | "Zephyr";

export interface TTSConfig {
  voice: TTSVoice;
  speed: number;
  continuous: boolean;
}

export type SyncStatus = "UNSAVED" | "SYNCING" | "SAVED" | "LOCAL_ONLY" | "BLOCKED" | "SERVER_ONLY";

export interface BookContextType {
  chapters: Chapter[];
  ragChunks: RagChunk[];
  referenceDocument: Chapter | null;
  bookTitle: string;

  currentChapterIndex: number;
  currentChapter: Chapter;
  goToNextChapter: () => void;
  goToPrevChapter: () => void;
  goToChapter: (index: number) => void;
  getChapterTitleByPage: (page: number) => string;
  uploadBook: (file: File) => Promise<void>;
  isProcessing: boolean;

  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;

  theme: Theme;
  toggleTheme: () => void;

  isCaptureMode: boolean;
  setCaptureMode: (isCapture: boolean) => void;
  capturedImage: string | null;
  setCapturedImage: (image: string | null) => void;

  aiChatHistory: ChatMessage[];
  addChatMessage: (role: "user" | "model", text: string) => void;
  triggerSmartExplain: (text: string) => void;

  isToolsOpen: boolean;
  setToolsOpen: (isOpen: boolean) => void;
  activeToolTab: "ai" | "highlight" | "mynote" | "reference" | "search";
  setActiveToolTab: (
    tab: "ai" | "highlight" | "mynote" | "reference" | "search"
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
}
