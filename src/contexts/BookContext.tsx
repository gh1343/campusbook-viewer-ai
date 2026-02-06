import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useRef,
} from "react";
import {
  Chapter,
  Highlight,
  FontSize,
  Theme,
  ReadingStats,
  DrawingMode,
  Stroke,
  GeneralNote,
  DrawingColor,
  ChatMessage,
  BookContextType,
  RagChunk,
  SearchResult,
  ViewMode,
  PdfBookmark,
  TTSConfig,
  SyncStatus,
} from "../../types";
import { generateExplanation } from "../services/geminiService";
import { processPdf, findRelevantChunks } from "../services/pdfRagService";
import { synthesizeWithGemini } from "../services/ttsService";
import {
  getRmsConfig,
  migrate_snapshot,
  sync_snapshot,
  saveRmsProgress,
  saveHighlightsToServer,
  loadHighlightsFromServer,
  saveProgressToServer,
  loadProgressFromServer,
  saveBookmarksToServer,
  loadBookmarksFromServer,
  saveDrawingsToServer,
  loadDrawingsFromServer,
  saveNotesToServer,
  loadNotesFromServer,
} from "../services/rmsService";
import type { IndexedDbSnapshot } from "../services/rmsService";
const NAV_TOC_PATH =
  "/resources/contents/devqa/cms/book/20260130/CT-20260130090170748/source/R1/20260130100542/ebook/OEBPS/nav.xhtml";
const NAV_TOC_ORIGIN =
  import.meta.env.VITE_PDF_PROXY_ORIGIN ||
  "https://d19t5saodanwfx.cloudfront.net";

type RuntimeViewerConfig = {
  navTocUrl?: string;
  navTocPath?: string;
  epubPath?: string;
  webPath?: string;
  pdfProxyOrigin?: string;
  contentOrigin?: string;
};

const readRuntimeViewerConfig = (): RuntimeViewerConfig | null => {
  if (typeof window === "undefined") return null;
  const raw = (window as any).__RMS_CONFIG__;
  if (!raw || typeof raw !== "object") return null;
  return raw as RuntimeViewerConfig;
};

const buildNavTocFromRuntime = (runtime: RuntimeViewerConfig | null) => {
  if (!runtime) return "";

  const directUrl =
    typeof runtime.navTocUrl === "string" ? runtime.navTocUrl.trim() : "";
  if (directUrl) return directUrl;

  const navPath =
    typeof runtime.navTocPath === "string" ? runtime.navTocPath.trim() : "";
  if (navPath) {
    const origin =
      (typeof runtime.contentOrigin === "string" &&
        runtime.contentOrigin.trim()) ||
      (typeof runtime.pdfProxyOrigin === "string" &&
        runtime.pdfProxyOrigin.trim()) ||
      NAV_TOC_ORIGIN;
    const base = origin.replace(/\/+$/, "");
    const normalizedPath = navPath.startsWith("/") ? navPath : `/${navPath}`;
    return `${base}${normalizedPath}`;
  }

  const epubPath =
    typeof runtime.epubPath === "string" ? runtime.epubPath.trim() : "";
  if (epubPath) {
    return `${epubPath.replace(/\/+$/, "")}/nav.xhtml`;
  }

  const webPath =
    typeof runtime.webPath === "string" ? runtime.webPath.trim() : "";
  if (webPath) {
    return `${webPath.replace(/\/+$/, "")}/OEBPS/nav.xhtml`;
  }

  return "";
};

const applyDevProxy = (rawUrl: string, proxyOrigin: string) => {
  if (!import.meta.env.DEV) return rawUrl;
  if (!/^https?:\/\//i.test(rawUrl)) return rawUrl;
  try {
    const normalizedProxy = proxyOrigin.replace(/\/+$/, "");
    if (normalizedProxy && rawUrl.startsWith(normalizedProxy)) {
      const parsed = new URL(rawUrl);
      return `/pdf_proxy${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return rawUrl;
  } catch (err) {
    return rawUrl;
  }
};

const resolveNavTocUrl = () => {
  const runtime = readRuntimeViewerConfig();
  const runtimeUrl = buildNavTocFromRuntime(runtime);
  const base = NAV_TOC_ORIGIN.replace(/\/+$/, "");
  const rawUrl = runtimeUrl || `${base}${NAV_TOC_PATH}`;
  const proxyOrigin =
    (typeof runtime?.pdfProxyOrigin === "string" &&
      runtime.pdfProxyOrigin.trim()) ||
    NAV_TOC_ORIGIN;
  return applyDevProxy(rawUrl, proxyOrigin);
};

const MOCK_CHAPTERS: Chapter[] = [
  {
    id: "ch1",
    title: "Chapter 1: The Dawn of AI",
    content: `
      <h2>1.1 Introduction to Artificial Intelligence</h2>
      <p>Artificial Intelligence (AI) is intelligence demonstrated by machines, as opposed to the natural intelligence displayed by humans or animals. Leading AI textbooks define the field as the study of "intelligent agents": any system that perceives its environment and takes actions that maximize its chances of achieving its goals.</p>
      <p>The history of AI began in antiquity, with myths, stories, and rumors of artificial beings endowed with intelligence or consciousness by master craftsmen. The seeds of modern AI were planted by philosophers who attempted to describe the process of human thinking as the mechanical manipulation of symbols.</p>
      <h3>1.2 The Turing Test</h3>
      <p>The Turing test, developed by Alan Turing in 1950, is a test of a machine's ability to exhibit intelligent behavior equivalent to, or indistinguishable from, that of a human. Turing proposed that a human evaluator would judge natural language conversations between a human and a machine designed to generate human-like responses.</p>
    `,
  },
  {
    id: "ch2",
    title: "Chapter 2: Machine Learning Basics",
    content: `
      <h2>2.1 What is Machine Learning?</h2>
      <p>Machine Learning (ML) is a subset of artificial intelligence that focuses on building systems that learn, or improve performance, based on the data they consume. Artificial Intelligence is a broad term that refers to systems or machines that mimic human intelligence. Machine Learning is how they achieve that intelligence.</p>
      <p>There are three main types of machine learning: supervised learning, unsupervised learning, and reinforcement learning. In supervised learning, the algorithm is trained on labeled data.</p>
      <h3>2.2 Neural Networks</h3>
      <p>Neural networks, also known as artificial neural networks (ANNs) or simulated neural networks (SNNs), are a subset of machine learning and are at the heart of deep learning algorithms. Their name and structure are inspired by the human brain, mimicking the way that biological neurons signal to one another.</p>
    `,
  },
  {
    id: "ch3",
    title: "Chapter 3: Ethics in Technology",
    content: `
      <h2>3.1 The Importance of Ethics</h2>
      <p>As technology becomes more integrated into our daily lives, the ethical implications of its use become increasingly important. Issues such as privacy, bias in algorithms, and the displacement of jobs are central discussions in the tech world today.</p>
      <p>Algorithmic bias describes systematic and repeatable errors in a computer system that create unfair outcomes, such as privileging one arbitrary group of users over others.</p>
    `,
  },
];

const normalizeForMatch = (value: string) =>
  value
    .replace(/\s+/g, "")
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLowerCase();

const getJsonBytes = (value: unknown) => {
  const text = JSON.stringify(value);
  if (typeof TextEncoder === "undefined") return text.length;
  return new TextEncoder().encode(text).length;
};

const bytesToMb = (bytes: number) => Number((bytes / (1024 * 1024)).toFixed(4));

const stableStringify = (value: unknown) =>
  JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== "object" || Array.isArray(val)) return val;
    return Object.keys(val as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (val as Record<string, unknown>)[k];
        return acc;
      }, {});
  });

const normalizeSnapshotForCompare = (snapshot: IndexedDbSnapshot) => {
  const data = snapshot.data || {};
  const progress = data.progress;
  const normalizedProgress =
    progress && typeof progress === "object"
      ? {
          currentPdfPage: progress.currentPdfPage,
          viewMode: progress.viewMode,
          pdfTotalPages: progress.pdfTotalPages,
          furthestPage: progress.furthestPage,
          lastReadPage: progress.lastReadPage,
        }
      : progress;
  return {
    data: {
      bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks : [],
      highlights: Array.isArray(data.highlights) ? data.highlights : [],
      notes: Array.isArray(data.notes) ? data.notes : [],
      strokes:
        data.strokes && typeof data.strokes === "object" ? data.strokes : {},
      progress: normalizedProgress,
    },
    meta: snapshot.meta || {},
  };
};

const isSameSnapshot = (a: IndexedDbSnapshot, b: IndexedDbSnapshot) =>
  stableStringify(normalizeSnapshotForCompare(a)) ===
  stableStringify(normalizeSnapshotForCompare(b));

const enable_debug_log = false;

const parseNavChapters = (
  raw: string
): {
  chapters: Chapter[];
  pageMap: Record<string, number>;
  bookTitle: string;
} => {
  if (typeof window === "undefined")
    return { chapters: [], pageMap: {}, bookTitle: "" };
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, "application/xhtml+xml");
    const titleNode =
      doc.querySelector("head > title") || doc.querySelector("title");
    const h1Node = doc.querySelector("h1");
    const bookTitle = (titleNode?.textContent || h1Node?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    const nav =
      doc.querySelector("nav#toc") ||
      doc.querySelector('nav[epub\\:type="toc"]');
    if (!nav) return { chapters: [], pageMap: {}, bookTitle };

    const usedIds = new Set<string>();
    const anchors = Array.from(nav.querySelectorAll("a"));
    const pageMap: Record<string, number> = {};

    const chapters = anchors
      .map((anchor, index) => {
        const title = (anchor.textContent || "").replace(/\s+/g, " ").trim();
        if (!title) return null;

        const href = anchor.getAttribute("href") || `toc-${index + 1}`;
        const rawId = href;
        const baseId =
          rawId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") ||
          `toc-${index + 1}`;

        let id = baseId;
        let suffix = 1;
        while (usedIds.has(id)) {
          id = `${baseId}-${suffix++}`;
        }
        usedIds.add(id);

        const pageMatch =
          href.match(/p0*([0-9]+)_/i) || href.match(/p0*([0-9]+)/i);
        if (pageMatch && pageMatch[1]) {
          const pageNum = parseInt(pageMatch[1], 10);
          if (Number.isFinite(pageNum)) {
            pageMap[id] = pageNum;
          }
        }

        return {
          id,
          title,
          content: "",
        } as Chapter;
      })
      .filter(Boolean) as Chapter[];

    return { chapters, pageMap, bookTitle };
  } catch (err) {
    console.error("Failed to parse nav.xhtml", err);
    return { chapters: [], pageMap: {}, bookTitle: "" };
  }
};

const BookContext = createContext<BookContextType | undefined>(undefined);

export const BookProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [chapters, setChapters] = useState<Chapter[]>(MOCK_CHAPTERS);
  const [navTocRaw, setNavTocRaw] = useState("");
  const [referenceDocument, setReferenceDocument] = useState<Chapter | null>(
    null
  );
  const [bookTitle, setBookTitle] = useState("");
  const [ragChunks, setRagChunks] = useState<RagChunk[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [fontSize, setFontSize] = useState<FontSize>("medium");
  const [theme, setTheme] = useState<Theme>("light");
  const [viewMode, setViewMode] = useState<ViewMode>("single");

  const [showAnnotations, setShowAnnotations] = useState(true);
  const [bookmarks, setBookmarks] = useState<PdfBookmark[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("pdfBookmarks");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => {
            if (item && typeof item === "object" && "page" in item) {
              return item as PdfBookmark;
            }
            if (typeof item === "number") {
              return {
                id: `migrated-${item}`,
                page: item,
                label: `Page ${item}`,
                created_at: Date.now(),
              } as PdfBookmark;
            }
            return null;
          })
          .filter(Boolean) as PdfBookmark[];
      }
    } catch (e) {
      console.error("Failed to parse stored pdfBookmarks", e);
    }
    return [];
  });
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
    null
  );
  const [pendingHighlightEditId, setPendingHighlightEditId] = useState<
    string | null
  >(null);

  const [drawingMode, setDrawingMode] = useState<DrawingMode>("idle");
  const [penColor, setPenColor] = useState<DrawingColor>("#ef4444");
  const [penWidth, setPenWidth] = useState<number>(3);
  const [penOpacity, setPenOpacity] = useState<number>(1.0);
  const [chapterStrokes, setChapterStrokes] = useState<Stroke[]>([]);

  const [generalNotes, setGeneralNotes] = useState<GeneralNote[]>([]);
  const [isCaptureMode, setCaptureMode] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const [aiChatHistory, setAiChatHistory] = useState<ChatMessage[]>([]);
  const [isToolsOpen, setToolsOpen] = useState(true);
  const [activeToolTab, setActiveToolTab] = useState<
    "ai" | "highlight" | "mynote" | "reference" | "search"
  >("highlight");
  const [searchQuery, setSearchQuery] = useState("");

  // --- TTS (stub implementation for UI controls) ---
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [currentTtsSegmentIndex, setCurrentTtsSegmentIndex] = useState<
    number | null
  >(null);
  const [ttsConfig, setTtsConfigState] = useState<TTSConfig>({
    voice: "Kore",
    speed: 1.0,
    continuous: true,
  });
  const [chapterPageMap, setChapterPageMap] = useState<Record<string, number>>(
    {}
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("SAVED");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsObjectUrlRef = useRef<string | null>(null);
  const ttsGeneratingRef = useRef(false);
  const indexedDbWorkerRef = useRef<Worker | null>(null);
  const indexedDbLoadKeyRef = useRef<string | null>(null);
  const indexedDbSnapshotRef = useRef<IndexedDbSnapshot | null>(null);
  const pendingPdfPageRef = useRef<number | null>(null);
  const pdfTotalPagesRef = useRef<number>(0);

  const setTtsConfig = (config: Partial<TTSConfig>) => {
    setTtsConfigState((prev) => ({ ...prev, ...config }));
  };

  const getIndexedDbWorker = () => {
    if (indexedDbWorkerRef.current) return indexedDbWorkerRef.current;
    if (typeof window === "undefined") return null;
    const worker = new Worker(
      new URL("../workers/indexedDbWorker.ts", import.meta.url),
      { type: "module" }
    );
    indexedDbWorkerRef.current = worker;
    return worker;
  };

  const splitIntoSentences = (text: string): string[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const matches = trimmed.match(/[^.!?]+[.!?]?/g);
    if (matches && matches.length > 0) {
      return matches.map((s) => s.trim()).filter(Boolean);
    }
    // fallback: single chunk
    return [trimmed];
  };

  const extractPlainText = (raw: string) =>
    raw
      .replace(/<script[^>]*>.*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const buildSentences = () => {
    if (pdfTextPages.length > 0) {
      const sorted = [...pdfTextPages].sort((a, b) => a.page - b.page);
      const targetPage = currentPdfPage || sorted[0]?.page || 1;
      const sentences: string[] = [];
      let defaultStartIndex = 0;

      sorted.forEach((p) => {
        const plain = extractPlainText(p.text || "");
        const pageSentences = splitIntoSentences(plain);
        if (p.page < targetPage) {
          defaultStartIndex += pageSentences.length;
        }
        sentences.push(...pageSentences);
      });
      return { sentences, defaultStartIndex };
    }

    const plain = extractPlainText(currentChapter.content);
    const sentences = splitIntoSentences(plain);
    return { sentences, defaultStartIndex: 0 };
  };

  const cleanupTtsAudio = () => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = "";
      ttsAudioRef.current = null;
    }
    if (ttsObjectUrlRef.current) {
      URL.revokeObjectURL(ttsObjectUrlRef.current);
      ttsObjectUrlRef.current = null;
    }
  };

  const startTts = async (startIndex?: number) => {
    if (ttsGeneratingRef.current) return;

    // 재생 일시정지 상태라면 이어서 재생
    if (
      ttsAudioRef.current &&
      ttsAudioRef.current.paused &&
      !ttsAudioRef.current.ended
    ) {
      await ttsAudioRef.current.play().catch(() => {});
      setIsTtsPlaying(true);
      return;
    }

    cleanupTtsAudio();

    const { sentences, defaultStartIndex } = buildSentences();
    if (sentences.length === 0) {
      alert("읽을 텍스트가 없습니다.");
      return;
    }

    const beginIdx =
      typeof startIndex === "number" &&
      startIndex >= 0 &&
      startIndex < sentences.length
        ? startIndex
        : Math.min(defaultStartIndex, sentences.length - 1);

    const MAX_CHARS = 8000;
    const textToRead = sentences.slice(beginIdx).join(" ").slice(0, MAX_CHARS);
    if (!textToRead) {
      alert("읽을 텍스트가 없습니다.");
      return;
    }

    try {
      ttsGeneratingRef.current = true;
      setIsTtsPlaying(true);
      setCurrentTtsSegmentIndex(beginIdx);

      const { audioUrl } = await synthesizeWithGemini(textToRead, {
        voiceName: ttsConfig.voice,
      });

      const audio = new Audio(audioUrl);
      audio.playbackRate = ttsConfig.speed;
      ttsObjectUrlRef.current = audioUrl;
      ttsAudioRef.current = audio;

      audio.onended = () => {
        setIsTtsPlaying(false);
        setCurrentTtsSegmentIndex(null);
        cleanupTtsAudio();
      };
      audio.onerror = () => {
        setIsTtsPlaying(false);
        setCurrentTtsSegmentIndex(null);
        cleanupTtsAudio();
      };

      await audio.play().catch((err) => {
        console.error("Audio playback failed", err);
        setIsTtsPlaying(false);
      });
    } catch (err) {
      console.error("Gemini TTS failed", err);
      alert("TTS 생성 중 오류가 발생했습니다.");
      setIsTtsPlaying(false);
      setCurrentTtsSegmentIndex(null);
    } finally {
      ttsGeneratingRef.current = false;
    }
  };

  const pauseTts = () => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
    }
    setIsTtsPlaying(false);
  };

  const stopTts = () => {
    cleanupTtsAudio();
    setIsTtsPlaying(false);
    setCurrentTtsSegmentIndex(null);
  };

  const [stats, setStats] = useState<ReadingStats>({
    totalReadingTime: 0,
    sessions: 1,
    chapterVisits: {},
    aiInteractionCount: 0,
    highlightCount: 0,
  });
  const [pdfTextPages, setPdfTextPages] = useState<
    { page: number; text: string }[]
  >([]);
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfLoadProgress, setPdfLoadProgress] = useState(0);
  const [pdfLoadTime, setPdfLoadTime] = useState(0);
  const [pdfIsLoading, setPdfIsLoading] = useState(false);
  const [pdfNavigator, setPdfNavigator] = useState<
    ((page: number) => void) | null
  >(null);
  const [pdfZoomHandler, setPdfZoomHandler] = useState<
    ((direction: "in" | "out") => void) | null
  >(null);
  const [pdfZoom, setPdfZoom] = useState(1.0);
  const [pendingPdfPage, setPendingPdfPage] = useState<number | null>(null);
  const [initialPageToLoad, setInitialPageToLoad] = useState<number | null>(
    null
  );
  const [pdfSearchHighlight, setPdfSearchHighlight] = useState<{
    page: number;
    term: string;
  } | null>(null);

  const currentChapter = chapters[currentChapterIndex];

  useEffect(() => {
    if (window.innerWidth < 1024) {
      setToolsOpen(false);
    }
  }, []);

  // 네트워크 상태 감지
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      console.log("네트워크 연결됨");
      // 네트워크 재연결 시 로컬에 저장된 데이터가 있으면 동기화 시도
      if (syncStatus === "LOCAL_ONLY") {
        console.log("네트워크 재연결, 자동 동기화 시도");
        saveAll();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      console.log("네트워크 끊김");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncStatus]);

  useEffect(() => {
    return () => {
      if (indexedDbWorkerRef.current) {
        indexedDbWorkerRef.current.terminate();
        indexedDbWorkerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        updateReadingTime();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setStats((prev) => ({
      ...prev,
      chapterVisits: {
        ...prev.chapterVisits,
        [currentChapter.id]: (prev.chapterVisits[currentChapter.id] || 0) + 1,
      },
    }));
  }, [currentChapter.id]);

  useEffect(() => {
    try {
      localStorage.setItem("pdfBookmarks", JSON.stringify(bookmarks));
    } catch (e) {
      console.error("Failed to persist pdfBookmarks", e);
    }
  }, [bookmarks]);

  useEffect(() => {
    let cancelled = false;

    const loadNavToc = async () => {
      try {
        const response = await fetch(resolveNavTocUrl());
        if (!response.ok) {
          throw new Error(`nav.xhtml fetch failed (${response.status})`);
        }
        const raw = await response.text();
        if (!cancelled) {
          setNavTocRaw(raw);
        }
      } catch (err) {
        console.error("Failed to load nav.xhtml", err);
      }
    };

    loadNavToc();
    return () => {
      cancelled = true;
    };
  }, []);

  // nav.xhtml을 chapters로 반영
  useEffect(() => {
    if (!navTocRaw) return;
    const {
      chapters: parsedChapters,
      pageMap,
      bookTitle: parsedBookTitle,
    } = parseNavChapters(navTocRaw);
    if (parsedChapters.length > 0) {
      setChapters(parsedChapters);
      setChapterPageMap(pageMap);
      setCurrentChapterIndex(0);
    }
    if (parsedBookTitle) {
      setBookTitle(parsedBookTitle);
    }
  }, [navTocRaw]);

  const updateReadingTime = () => {
    setStats((prev) => ({
      ...prev,
      totalReadingTime: prev.totalReadingTime + 5,
    }));
  };

  const incrementAiCount = () => {
    setStats((prev) => ({
      ...prev,
      aiInteractionCount: prev.aiInteractionCount + 1,
    }));
  };

  // PDF 현재 페이지에 맞춰 챕터 포커스 동기화
  const findChapterIndexForPage = React.useCallback(
    (page: number) => {
      if (chapters.length === 0 || Object.keys(chapterPageMap).length === 0)
        return -1;

      let bestIdx = -1;
      let bestPage = Number.NEGATIVE_INFINITY;
      let fallbackIdx = -1;
      let fallbackPage = Number.POSITIVE_INFINITY;

      chapters.forEach((ch, idx) => {
        const mappedPage = chapterPageMap[ch.id];
        if (!mappedPage) return;

        if (mappedPage <= page && mappedPage > bestPage) {
          bestPage = mappedPage;
          bestIdx = idx;
        }
        if (mappedPage < fallbackPage) {
          fallbackPage = mappedPage;
          fallbackIdx = idx;
        }
      });

      return bestIdx !== -1 ? bestIdx : fallbackIdx;
    },
    [chapters, chapterPageMap]
  );

  const getChapterTitleByPage = React.useCallback(
    (page: number) => {
      if (!page) return "";
      const idx = findChapterIndexForPage(page);
      if (idx === -1) return "";
      const title = chapters[idx]?.title?.trim();
      return title || `Chapter ${idx + 1}`;
    },
    [chapters, findChapterIndexForPage]
  );

  useEffect(() => {
    const idx = findChapterIndexForPage(currentPdfPage);
    if (idx !== -1 && idx !== currentChapterIndex) {
      setCurrentChapterIndex(idx);
    }
  }, [currentPdfPage, findChapterIndexForPage, currentChapterIndex]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
    if (theme === "light") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const toggleAnnotations = () => setShowAnnotations((prev) => !prev);

  const addPdfBookmark = (page: number, label?: string) => {
    if (!page || page < 1) return;
    markAsUnsaved();
    setBookmarks((prev) => {
      if (prev.some((b) => b.page === page && !b.deleted)) return prev;
      const now = Date.now();
      const bookmark: PdfBookmark = {
        id: now.toString(),
        page,
        label: label || `Page ${page}`,
        created_at: now,
        updated_at: now,
        deleted: false,
        syncStatus: "pending", // Mark as pending sync
      };
      return [bookmark, ...prev];
    });
  };

  const removePdfBookmark = (id: string) => {
    const now = Date.now();
    markAsUnsaved();
    setBookmarks((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, deleted: true, updated_at: now, syncStatus: "pending" }
          : b
      )
    );
  };

  const clearHighlightFocus = () => {
    // Prevent stale highlight auto-scroll from overriding explicit navigation.
    setActiveHighlightId(null);
  };

  const goToNextChapter = () => {
    if (currentChapterIndex < chapters.length - 1) {
      goToChapter(currentChapterIndex + 1);
    }
  };

  const goToPrevChapter = () => {
    if (currentChapterIndex > 0) {
      goToChapter(currentChapterIndex - 1);
    }
  };

  const goToChapter = (index: number) => {
    if (index >= 0 && index < chapters.length) {
      clearHighlightFocus();
      setCurrentChapterIndex(index);
      const target = chapters[index];
      const targetPage = chapterPageMap[target.id];
      if (targetPage) {
        goToPdfPage(targetPage);
      }
    }
  };

  const uploadBook = async (file: File) => {
    setIsProcessing(true);
    try {
      const data = await processPdf(file);

      if (data.chapters.length > 0) {
        const nextBookTitle =
          data.chapters[0]?.title || file.name.replace(/\.pdf$/i, "");
        // 1) 메인 뷰어에 들어갈 챕터를 PDF에서 가져오기
        setChapters(data.chapters);
        setCurrentChapterIndex(0);
        setBookTitle(nextBookTitle);

        // 2) RAG(검색/AI)용 청크도 이 PDF 기준으로 세팅
        setRagChunks(data.chunks);

        // 3) 레퍼런스 패널은 안 쓰고 싶으면 null 처리
        setReferenceDocument(null);

        // 4) 툴 패널 열고 AI 탭 or 원하는 탭으로 이동
        setToolsOpen(true);
        setActiveToolTab("ai"); // 혹은 'highlight' / 'search' 등으로 변경 가능

        alert(`"${file.name}"을(를) 메인 책으로 로드했습니다.`);
      } else {
        alert("Processed PDF but found no readable content.");
      }
    } catch (error) {
      console.error("PDF Load Failed", error);
      alert("Failed to load PDF. Please ensure it is a valid PDF file.");
    } finally {
      setIsProcessing(false);
    }
  };

  const addHighlight = (
    text: string,
    note?: string,
    targetChapterId?: string,
    pageNumber?: number
  ): string => {
    const chapterId = targetChapterId || currentChapter.id;
    const now = Date.now();
    markAsUnsaved();
    const newHighlight: Highlight = {
      id: now.toString(),
      chapterId: chapterId,
      text,
      color: "yellow",
      pageNumber,
      note,
      created_at: now,
      updated_at: now,
      deleted: false,
      syncStatus: "pending", // Mark as pending sync
    };
    const itemBytes = getJsonBytes(newHighlight);
    const chapterLabel = (() => {
      if (newHighlight.chapterId === "reference-doc") {
        if (!newHighlight.pageNumber) return "Reference PDF";
        const title = getChapterTitleByPage(newHighlight.pageNumber);
        return title || "Reference PDF";
      }
      const chapterIndex = chapters.findIndex(
        (c) => c.id === newHighlight.chapterId
      );
      if (chapterIndex === -1) return "Chapter";
      const chapterTitle = chapters[chapterIndex]?.title?.trim();
      return chapterTitle || `Chapter ${chapterIndex + 1}`;
    })();
    const listInfo = {
      chapterLabel,
      pageNumber: newHighlight.pageNumber ?? null,
      text: newHighlight.text,
    };
    const listBytes = getJsonBytes(listInfo);
    const combinedBytes = itemBytes + listBytes;
    setHighlights((prev) => {
      const next = [newHighlight, ...prev];
      const totalBytes = getJsonBytes(next);
      if (enable_debug_log) {
        console.log("[highlight/size]", {
          chapterId: newHighlight.chapterId,
          pageNumber: newHighlight.pageNumber,
          itemBytes,
          itemMb: bytesToMb(itemBytes),
          listBytes,
          listMb: bytesToMb(listBytes),
          combinedBytes,
          combinedMb: bytesToMb(combinedBytes),
          totalBytes,
          totalMb: bytesToMb(totalBytes),
        });
      }
      return next;
    });
    setStats((prev) => ({ ...prev, highlightCount: prev.highlightCount + 1 }));
    return newHighlight.id;
  };

  const updateHighlight = (
    id: string,
    data: Partial<Highlight> & { note?: string }
  ) => {
    const now = Date.now();
    markAsUnsaved();
    setHighlights((prev) =>
      prev.map((hl) =>
        hl.id === id
          ? { ...hl, ...data, updated_at: now, syncStatus: "pending" }
          : hl
      )
    );
  };

  const removeHighlight = (id: string) => {
    const now = Date.now();
    markAsUnsaved();
    setHighlights((prev) =>
      prev.map((h) =>
        h.id === id
          ? { ...h, deleted: true, updated_at: now, syncStatus: "pending" }
          : h
      )
    );
  };

  const focusHighlight = (id: string) => {
    setShowAnnotations(true);
    setActiveHighlightId(id);
    setTimeout(() => setActiveHighlightId(null), 2000);
  };

  const requestHighlightNoteEdit = (id: string) => {
    setPendingHighlightEditId(id);
  };

  const clearHighlightNoteEditRequest = () => {
    setPendingHighlightEditId(null);
  };

  const goToHighlight = (hlOrId: Highlight | string) => {
    const hl =
      typeof hlOrId === "string"
        ? highlights.find((h) => h.id === hlOrId)
        : hlOrId;
    if (!hl) return;

    // Try to fill missing pageNumber for reference-doc
    if (hl.chapterId === "reference-doc" && !hl.pageNumber) {
      if (currentPdfPage) {
        updateHighlight(hl.id, { pageNumber: currentPdfPage });
      }
    }

    if (hl.chapterId === "reference-doc" && hl.pageNumber) {
      goToPdfPage(hl.pageNumber);
    } else {
      const idx = chapters.findIndex((c) => c.id === hl.chapterId);
      if (idx >= 0) {
        goToChapter(idx);
      }
    }
    focusHighlight(hl.id);
  };

  const addStroke = (stroke: Stroke) => {
    const itemBytes = getJsonBytes(stroke);
    markAsUnsaved();
    setChapterStrokes((prev) => {
      const next = [...prev, stroke];
      const totalBytes = getJsonBytes(next);
      if (enable_debug_log) {
        console.log("[stroke/size]", {
          pageNumber: stroke.pageNumber,
          itemBytes,
          itemMb: bytesToMb(itemBytes),
          totalBytes,
          totalMb: bytesToMb(totalBytes),
        });
      }
      return next;
    });
  };

  const removeStroke = (strokeId: string) => {
    markAsUnsaved();
    setChapterStrokes((prev) =>
      prev.map((s) => (s.id === strokeId ? { ...s, deleted: true } : s))
    );
  };

  const hasStrokes = () => {
    return chapterStrokes.filter((s) => !s.deleted).length > 0;
  };

  const addGeneralNote = (title: string, content: string) => {
    const now = Date.now();
    markAsUnsaved();
    const newNote: GeneralNote = {
      id: now.toString(),
      title: title || "Untitled Note",
      content: content,
      chapterId: currentChapter.id,
      chapterTitle: currentChapter.title,
      created_at: now,
      updated_at: now,
      deleted: false,
    };
    setGeneralNotes((prev) => [newNote, ...prev]);
  };

  const updateGeneralNote = (id: string, title: string, content: string) => {
    const now = Date.now();
    markAsUnsaved();
    setGeneralNotes((prev) =>
      prev.map((note) =>
        note.id === id ? { ...note, title, content, updated_at: now } : note
      )
    );
  };

  const removeGeneralNote = (id: string) => {
    markAsUnsaved();
    setGeneralNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, deleted: true } : n))
    );
  };

  const exportNoteAsMarkdown = (note: GeneralNote) => {
    let md = note.content.replace(/<[^>]+>/g, "");
    const blob = new Blob([`# ${note.title}\n\n${md}`], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${note.title.replace(/\s+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importNotes = async (file: File) => {
    const text = await file.text();
    let title = file.name.replace(".md", "").replace(".json", "");
    let content = text.replace(/\n/g, "<br>");
    addGeneralNote(title, content);
  };

  const addChatMessage = (role: "user" | "model", text: string) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role,
      text,
      timestamp: Date.now(),
    };
    setAiChatHistory((prev) => [...prev, newMessage]);
  };

  const triggerSmartExplain = async (text: string) => {
    setToolsOpen(true);
    setActiveToolTab("ai");
    const userPrompt = `Explain: "${text}"`;
    addChatMessage("user", userPrompt);
    incrementAiCount();
    const relevantChunks = findRelevantChunks(text, ragChunks);
    const contextString = relevantChunks
      .map((chunk) => `[Page ${chunk.pageNumber}]: ${chunk.text}`)
      .join("\n\n");
    const explanation = await generateExplanation(
      text,
      contextString || currentChapter.content.substring(0, 3000)
    );
    addChatMessage("model", explanation);
  };

  const performSearch = (query: string): SearchResult[] => {
    if (!query || query.length < 2) return [];

    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    chapters.forEach((chapter) => {
      const plainText = chapter.content.replace(/<[^>]+>/g, " ");
      const index = plainText.toLowerCase().indexOf(lowerQuery);
      if (index !== -1) {
        const start = Math.max(0, index - 40);
        const end = Math.min(plainText.length, index + 40 + query.length);
        const snippet =
          (start > 0 ? "..." : "") +
          plainText.substring(start, end) +
          (end < plainText.length ? "..." : "");

        results.push({
          id: `ch-${chapter.id}-${index}`,
          type: "chapter",
          title: chapter.title,
          contentSnippet: snippet,
          chapterId: chapter.id,
          matchIndex: index,
        });
      }
    });

    highlights.forEach((hl) => {
      if (
        !hl.deleted &&
        (hl.text.toLowerCase().includes(lowerQuery) ||
          (hl.note && hl.note.toLowerCase().includes(lowerQuery)))
      ) {
        results.push({
          id: `hl-${hl.id}`,
          type: "highlight",
          title: "Highlight",
          contentSnippet: hl.note ? `${hl.text} - ${hl.note}` : hl.text,
          chapterId: hl.chapterId,
          pageNumber: hl.pageNumber,
        });
      }
    });

    generalNotes.forEach((note) => {
      if (note.deleted) return;
      const plainContent = note.content.replace(/<[^>]+>/g, " ");
      if (
        note.title.toLowerCase().includes(lowerQuery) ||
        plainContent.toLowerCase().includes(lowerQuery)
      ) {
        results.push({
          id: `note-${note.id}`,
          type: "note",
          title: note.title,
          contentSnippet: plainContent.substring(0, 80) + "...",
          chapterId: note.chapterId,
        });
      }
    });

    pdfTextPages.forEach((p) => {
      const idx = p.text.toLowerCase().indexOf(lowerQuery);
      if (idx !== -1) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(p.text.length, idx + 40 + query.length);
        const snippet =
          (start > 0 ? "..." : "") +
          p.text.substring(start, end) +
          (end < p.text.length ? "..." : "");
        results.push({
          id: `book-${p.page}-${idx}`,
          type: "book",
          title: `p.${p.page}`,
          contentSnippet: snippet,
          pageNumber: p.page,
        });
      }
    });

    return results;
  };

  const goToPdfPage = (page: number) => {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.round(page)) : 1;
    clearHighlightFocus();
    setCurrentPdfPage(safePage);
    if (pdfNavigator) {
      console.log(`[goToPdfPage] Navigating immediately to page ${safePage}`);
      pdfNavigator(safePage);
    } else {
      console.log(`[goToPdfPage] Setting pending page to ${safePage}`);
      pendingPdfPageRef.current = safePage;
      setPendingPdfPage(safePage);
    }
  };

  const registerPdfNavigator = React.useCallback(
    (fn: (page: number) => void) => {
      const pending = pendingPdfPageRef.current;
      const totalPages = pdfTotalPagesRef.current;
      console.log(
        `[registerPdfNavigator] Called with pendingPdfPage: ${pending}, totalPages: ${totalPages}`
      );
      setPdfNavigator(() => fn);
      if (pending !== null && totalPages > 0) {
        console.log(
          `[registerPdfNavigator] Navigating to pending page: ${pending}`
        );
        fn(pending);
        pendingPdfPageRef.current = null;
        setPendingPdfPage(null);
      } else if (pending !== null) {
        console.log(
          `[registerPdfNavigator] PDF not ready yet, keeping pending page: ${pending}`
        );
      }
    },
    []
  );

  const registerPdfZoomHandler = React.useCallback(
    (fn: (direction: "in" | "out") => void) => {
      setPdfZoomHandler(() => fn);
    },
    []
  );

  const zoomPdfIn = () => {
    if (pdfZoomHandler) {
      pdfZoomHandler("in");
    }
    setPdfZoom((prev) => Math.min(3, prev + 0.1));
  };

  const zoomPdfOut = () => {
    if (pdfZoomHandler) {
      pdfZoomHandler("out");
    }
    setPdfZoom((prev) => Math.max(1.0, prev - 0.1));
  };

  const resetPdfZoom = () => {
    setPdfZoom(1.0);
  };

  // pdfTotalPages 변경 시 ref 업데이트
  useEffect(() => {
    pdfTotalPagesRef.current = pdfTotalPages;
  }, [pdfTotalPages]);

  // PDF가 로드 완료되면 initialPageToLoad로 이동
  useEffect(() => {
    if (pdfTotalPages > 0 && initialPageToLoad !== null && pdfNavigator) {
      console.log(
        `[useEffect/initialPageToLoad] PDF loaded (${pdfTotalPages} pages), navigating to initial page: ${initialPageToLoad}`
      );
      pdfNavigator(initialPageToLoad);
      setInitialPageToLoad(null);
      setCurrentPdfPage(initialPageToLoad);
    }
  }, [pdfTotalPages, initialPageToLoad, pdfNavigator]);

  // PDF가 로드 완료되면 pendingPdfPage로 이동
  useEffect(() => {
    if (
      pdfTotalPages > 0 &&
      pendingPdfPageRef.current !== null &&
      pdfNavigator
    ) {
      const targetPage = pendingPdfPageRef.current;
      console.log(
        `[useEffect/pendingPdfPage] PDF loaded (${pdfTotalPages} pages), navigating to pending page: ${targetPage}`
      );
      pdfNavigator(targetPage);
      pendingPdfPageRef.current = null;
      setPendingPdfPage(null);
    }
  }, [pdfTotalPages, pdfNavigator]);

  const updatePdfTextPages = React.useCallback(
    (pages: { page: number; text: string }[]) => {
      setPdfTextPages(pages);
    },
    []
  );

  const buildIndexedDbKey = () => {
    const config = getRmsConfig();
    if (config?.bookCd) {
      return `${config.memberCd}_${config.bookCd}`;
    }
    if (bookTitle) {
      return `title_${bookTitle.replace(/\s+/g, "_")}`;
    }
    if (typeof window === "undefined") return "local_default";
    const rawPath = window.location.pathname || "";
    const normalized = rawPath.replace(/[^a-zA-Z0-9_-]+/g, "_");
    return normalized ? `path_${normalized}` : "local_default";
  };

  const buildCurrentIndexedDbSnapshot = (
    storageKey: string,
    savedAt: number
  ): IndexedDbSnapshot => ({
    key: storageKey,
    savedAt,
    data: {
      bookmarks,
      highlights,
      notes: generalNotes,
      strokes: chapterStrokes,
      progress: {
        currentPdfPage,
        viewMode,
        pdfTotalPages,
        updatedAt: savedAt,
      },
    },
    meta: {
      bookTitle,
    },
  });

  const getStorageEstimate = async () => {
    if (typeof navigator === "undefined") return null;
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try {
      const estimate = await navigator.storage.estimate();
      const usage =
        typeof estimate.usage === "number" && Number.isFinite(estimate.usage)
          ? estimate.usage
          : null;
      const quota =
        typeof estimate.quota === "number" && Number.isFinite(estimate.quota)
          ? estimate.quota
          : null;
      const remaining =
        usage !== null && quota !== null ? Math.max(0, quota - usage) : null;
      return { usage, remaining, quota };
    } catch (err) {
      return null;
    }
  };

  const formatStorageMb = (value: number | null) =>
    value === null ? "알 수 없음" : `${bytesToMb(value).toFixed(2)} MB`;

  const loadLocalDataFromIndexedDb = async (storageKey: string) => {
    if (typeof window === "undefined") return;
    const worker = getIndexedDbWorker();
    if (!worker) return;

    try {
      const result = await new Promise<IndexedDbSnapshot | null>(
        (resolve, reject) => {
          const requestId = `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`;
          const cleanup = () => {
            worker.removeEventListener("message", handleMessage);
            worker.removeEventListener("error", handleError);
          };
          const handleMessage = (event: MessageEvent) => {
            const response = event.data as {
              type?: string;
              requestId?: string;
              error?: string;
              payload?: unknown;
            };
            if (!response || response.requestId !== requestId) return;
            cleanup();
            if (response.type === "load_complete") {
              resolve((response.payload as IndexedDbSnapshot) || null);
            } else {
              reject(new Error(response.error || "IndexedDB load failed."));
            }
          };
          const handleError = () => {
            cleanup();
            reject(new Error("IndexedDB worker error."));
          };
          worker.addEventListener("message", handleMessage);
          worker.addEventListener("error", handleError);
          worker.postMessage({
            type: "load_bundle",
            requestId,
            payload: { storageKey },
          });
        }
      );

      // Create empty snapshot if IndexedDB is empty
      let snapshot: IndexedDbSnapshot;
      let needsMigrationSave = false;

      if (result && result.data) {
        const migrated = migrate_snapshot(result);
        snapshot = migrated.snapshot || result;
        needsMigrationSave = migrated.changed;
        console.log("[IndexedDB] Loaded snapshot from IndexedDB");
      } else {
        snapshot = {
          key: storageKey,
          savedAt: Date.now(),
          schema_version: 1,
          data: {
            bookmarks: [],
            highlights: [],
            notes: [],
            strokes: [],
            progress: undefined,
          },
          meta: {},
        };
        console.log("[IndexedDB] Empty, will create from server data");
      }

      if (needsMigrationSave) {
        try {
          await new Promise<void>((resolve, reject) => {
            const requestId = `${Date.now()}_${Math.random()
              .toString(36)
              .slice(2)}`;
            const cleanup = () => {
              worker.removeEventListener("message", handleMessage);
              worker.removeEventListener("error", handleError);
            };
            const handleMessage = (event: MessageEvent) => {
              const response = event.data as {
                type?: string;
                requestId?: string;
                error?: string;
              };
              if (!response || response.requestId !== requestId) return;
              cleanup();
              if (response.type === "save_complete") {
                resolve();
              } else {
                reject(new Error(response.error || "IndexedDB save failed."));
              }
            };
            const handleError = () => {
              cleanup();
              reject(new Error("IndexedDB worker error."));
            };
            worker.addEventListener("message", handleMessage);
            worker.addEventListener("error", handleError);
            worker.postMessage({
              type: "save_bundle",
              requestId,
              payload: {
                storageKey: snapshot.key,
                data: snapshot.data,
                meta: snapshot.meta,
                schema_version: snapshot.schema_version,
                savedAt: snapshot.savedAt,
              },
            });
          });
        } catch (err) {
          console.error("IndexedDB migrate save failed", err);
        }
      }

      const data = snapshot.data;

      // Load highlights: Merge server and IndexedDB based on timestamps
      const config = getRmsConfig();
      console.log("[RMS Config Debug]", config);
      console.log("[IndexedDB Data Debug]", {
        hasHighlights: Array.isArray(data.highlights) && data.highlights.length > 0,
        hasBookmarks: Array.isArray(data.bookmarks) && data.bookmarks.length > 0,
        hasStrokes: data.strokes ? true : false,
        hasNotes: Array.isArray(data.notes) && data.notes.length > 0,
        hasProgress: data.progress ? true : false,
      });
      const localHighlights = Array.isArray(data.highlights)
        ? data.highlights
        : [];
      const localBookmarks = Array.isArray(data.bookmarks)
        ? data.bookmarks
        : [];
      // Migrate old format { "pdf-main": [...] } to new format [...]
      let localDrawings: Stroke[] = [];
      if (Array.isArray(data.strokes)) {
        localDrawings = data.strokes;
      } else if (data.strokes && typeof data.strokes === "object") {
        // Old format: { "pdf-main": [...] }
        const strokesObj = data.strokes as Record<string, unknown[]>;
        localDrawings = (strokesObj["pdf-main"] || []) as Stroke[];
      }
      const localNotes = Array.isArray(data.notes) ? data.notes : [];
      let serverHighlights: any[] | null = null;
      let serverBookmarks: any[] | null = null;
      let serverDrawings: Stroke[] | null = null;
      let serverNotes: any[] | null = null;

      // Try to load highlights from server first
      if (config) {
        console.log("[Highlights] Attempting to load from server...");
        try {
          const serverData = await loadHighlightsFromServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
          });
          // Server response structure: { ok: true, result: { dataList: ["JSON string", ...] } }
          if (
            serverData &&
            serverData.ok &&
            serverData.result &&
            Array.isArray(serverData.result.dataList)
          ) {
            // Parse each JSON string in dataList and mark as synced
            serverHighlights = serverData.result.dataList
              .map((jsonStr: string) => {
                const parsed = JSON.parse(jsonStr);
                // Mark server data as synced (already on server)
                return { ...parsed, syncStatus: "synced" };
              })
              .filter((hl: any) => !hl.deleted);
            console.log(
              "[Highlights] ✅ Loaded from server:",
              serverHighlights.length
            );
          } else {
            console.warn("[Highlights] Invalid server response:", serverData);
          }
        } catch (err) {
          console.error("[Highlights] ❌ Failed to load from server:", err);
        }
      } else {
        console.log("[Highlights] No RMS config, skipping server load");
      }

      // Try to load bookmarks from server
      if (config) {
        console.log("[Bookmarks] Attempting to load from server...");
        try {
          const bookmarkData = await loadBookmarksFromServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
          });
          // Server response structure: { ok: true, result: { dataList: ["JSON string", ...] } }
          if (
            bookmarkData &&
            bookmarkData.ok &&
            bookmarkData.result &&
            Array.isArray(bookmarkData.result.dataList)
          ) {
            // Parse each JSON string in dataList and mark as synced
            serverBookmarks = bookmarkData.result.dataList
              .map((jsonStr: string) => {
                const parsed = JSON.parse(jsonStr);
                // Mark server data as synced (already on server)
                return { ...parsed, syncStatus: "synced" };
              })
              .filter((bm: any) => !bm.deleted);
            console.log(
              "[Bookmarks] ✅ Loaded from server:",
              serverBookmarks.length
            );
          } else {
            console.warn("[Bookmarks] Invalid server response:", bookmarkData);
          }
        } catch (err) {
          console.error("[Bookmarks] ❌ Failed to load from server:", err);
        }
      } else {
        console.log("[Bookmarks] No RMS config, skipping server load");
      }

      // Try to load drawings from server
      if (config) {
        console.log("[Drawings] Attempting to load from server...");
        try {
          const drawingData = await loadDrawingsFromServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
          });
          // Server response structure: { ok: true, result: { dataList: ["JSON string", ...] } }
          if (
            drawingData &&
            drawingData.ok &&
            drawingData.result &&
            Array.isArray(drawingData.result.dataList) &&
            drawingData.result.dataList.length > 0
          ) {
            // Parse the most recent drawings data
            const parsedDrawings = JSON.parse(drawingData.result.dataList[0]);
            // Handle both old format { "pdf-main": [...] } and new format [...]
            if (Array.isArray(parsedDrawings)) {
              serverDrawings = parsedDrawings.filter((d: any) => !d.deleted);
            } else if (parsedDrawings && typeof parsedDrawings === "object") {
              serverDrawings = (parsedDrawings["pdf-main"] || []).filter(
                (d: any) => !d.deleted
              );
            }
            console.log(
              "[Drawings] ✅ Loaded from server:",
              serverDrawings?.length || 0,
              "strokes"
            );
          } else {
            console.warn("[Drawings] Invalid server response:", drawingData);
          }
        } catch (err) {
          console.error("[Drawings] ❌ Failed to load from server:", err);
        }
      } else {
        console.log("[Drawings] No RMS config, skipping server load");
      }

      // Try to load notes from server
      if (config) {
        console.log("[Notes] Attempting to load from server...");
        try {
          const notesData = await loadNotesFromServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
          });
          // Server response structure: { ok: true, result: { dataList: ["JSON string", ...] } }
          if (
            notesData &&
            notesData.ok &&
            notesData.result &&
            Array.isArray(notesData.result.dataList) &&
            notesData.result.dataList.length > 0
          ) {
            // Parse the most recent notes data
            const parsedNotes = JSON.parse(notesData.result.dataList[0]);
            serverNotes = Array.isArray(parsedNotes)
              ? parsedNotes.filter((n: any) => !n.deleted)
              : [];
            console.log(
              "[Notes] ✅ Loaded from server:",
              serverNotes?.length || 0,
              "notes"
            );
          } else {
            console.warn("[Notes] Invalid server response:", notesData);
          }
        } catch (err) {
          console.error("[Notes] ❌ Failed to load from server:", err);
        }
      } else {
        console.log("[Notes] No RMS config, skipping server load");
      }

      // Merge server and local highlights based on timestamps using Web Worker
      let mergedHighlights: any[] = [];
      if (serverHighlights && serverHighlights.length > 0) {
        console.log(
          "[Highlights] Merging server and local data using Web Worker..."
        );

        try {
          // Use Web Worker for merge operation to avoid blocking main thread
          const mergeResult = await new Promise<{
            merged: any[];
            stats: {
              total: number;
              serverOnly: number;
              localOnly: number;
              serverNewer: number;
              localNewer: number;
            };
          }>((resolve, reject) => {
            const mergeWorker = new Worker(
              new URL("../workers/mergeWorker.ts", import.meta.url),
              { type: "module" }
            );

            const timeout = setTimeout(() => {
              mergeWorker.terminate();
              reject(new Error("Merge operation timed out"));
            }, 10000); // 10 second timeout

            mergeWorker.onmessage = (e) => {
              clearTimeout(timeout);
              mergeWorker.terminate();
              if (e.data.type === "merge-complete") {
                resolve({
                  merged: e.data.merged,
                  stats: e.data.stats,
                });
              } else {
                reject(new Error("Invalid merge response"));
              }
            };

            mergeWorker.onerror = (err) => {
              clearTimeout(timeout);
              mergeWorker.terminate();
              reject(err);
            };

            mergeWorker.postMessage({
              type: "merge",
              serverData: serverHighlights,
              localData: localHighlights,
            });
          });

          mergedHighlights = mergeResult.merged;
          const { serverOnly, localOnly, serverNewer, localNewer } =
            mergeResult.stats;

          console.log(
            `[Highlights] Merge summary: ${localNewer} local newer, ${serverNewer} server newer, ${localOnly} local only, ${serverOnly} server only`
          );
        } catch (err) {
          console.error(
            "[Highlights] Web Worker merge failed, falling back to sync merge:",
            err
          );

          // Fallback to synchronous merge if worker fails
          const serverMap = new Map(
            serverHighlights.map((h: any) => [h.id, h])
          );
          const localMap = new Map(localHighlights.map((h: any) => [h.id, h]));
          const allIds = new Set([...serverMap.keys(), ...localMap.keys()]);

          allIds.forEach((id) => {
            const serverItem = serverMap.get(id);
            const localItem = localMap.get(id);

            if (serverItem && localItem) {
              const serverTime =
                serverItem.updated_at || serverItem.created_at || 0;
              const localTime =
                localItem.updated_at || localItem.created_at || 0;
              mergedHighlights.push(
                localTime > serverTime ? localItem : serverItem
              );
            } else {
              mergedHighlights.push(localItem || serverItem);
            }
          });
        }

        console.log(
          `[Highlights] Merged ${mergedHighlights.length} items (Server: ${serverHighlights.length}, Local: ${localHighlights.length})`
        );
        setHighlights(mergedHighlights);

        // Update IndexedDB with merged highlights data
        snapshot.data.highlights = mergedHighlights;

        // Save merged snapshot to IndexedDB
        new Promise<void>((resolve, reject) => {
          const requestId = `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`;
          const cleanup = () => {
            worker.removeEventListener("message", handleMessage);
            worker.removeEventListener("error", handleError);
          };
          const handleMessage = (event: MessageEvent) => {
            const response = event.data as {
              type?: string;
              requestId?: string;
              error?: string;
            };
            if (!response || response.requestId !== requestId) return;
            cleanup();
            if (response.type === "save_complete") {
              resolve();
            } else {
              reject(new Error(response.error || "IndexedDB save failed."));
            }
          };
          const handleError = () => {
            cleanup();
            reject(new Error("IndexedDB worker error."));
          };
          worker.addEventListener("message", handleMessage);
          worker.addEventListener("error", handleError);
          worker.postMessage({
            type: "save_bundle",
            requestId,
            payload: {
              storageKey: snapshot.key,
              data: snapshot.data,
              meta: snapshot.meta,
              schema_version: snapshot.schema_version,
              savedAt: Date.now(),
            },
          });
        })
          .then(() => {
            console.log("[Highlights] Merged data saved to IndexedDB");
          })
          .catch((saveErr) => {
            console.error(
              "[Highlights] Failed to save merged data to IndexedDB:",
              saveErr
            );
          });
      } else if (localHighlights.length > 0) {
        // No server data: use local
        setHighlights(localHighlights);
        console.log(
          "[Highlights] 📦 Using local IndexedDB data:",
          localHighlights.length
        );
      }

      // Merge bookmarks: Same logic as highlights
      let mergedBookmarks: any[] = [];
      if (serverBookmarks && serverBookmarks.length > 0) {
        console.log(
          "[Bookmarks] Merging server and local data using Web Worker..."
        );

        try {
          // Use Web Worker for merge operation to avoid blocking main thread
          const mergeResult = await new Promise<{
            merged: any[];
            stats: {
              total: number;
              serverOnly: number;
              localOnly: number;
              serverNewer: number;
              localNewer: number;
            };
          }>((resolve, reject) => {
            const mergeWorker = new Worker(
              new URL("../workers/mergeWorker.ts", import.meta.url),
              { type: "module" }
            );

            const timeout = setTimeout(() => {
              mergeWorker.terminate();
              reject(new Error("Merge operation timed out"));
            }, 10000); // 10 second timeout

            mergeWorker.onmessage = (e) => {
              clearTimeout(timeout);
              mergeWorker.terminate();
              if (e.data.type === "merge-complete") {
                resolve({
                  merged: e.data.merged,
                  stats: e.data.stats,
                });
              } else {
                reject(new Error("Invalid merge response"));
              }
            };

            mergeWorker.onerror = (err) => {
              clearTimeout(timeout);
              mergeWorker.terminate();
              reject(err);
            };

            mergeWorker.postMessage({
              type: "merge",
              serverData: serverBookmarks,
              localData: localBookmarks,
            });
          });

          mergedBookmarks = mergeResult.merged;
          const { serverOnly, localOnly, serverNewer, localNewer } =
            mergeResult.stats;

          console.log(
            `[Bookmarks] Merge summary: ${localNewer} local newer, ${serverNewer} server newer, ${localOnly} local only, ${serverOnly} server only`
          );
        } catch (err) {
          console.error(
            "[Bookmarks] Web Worker merge failed, falling back to sync merge:",
            err
          );

          // Fallback to synchronous merge if worker fails
          const serverMap = new Map(serverBookmarks.map((b: any) => [b.id, b]));
          const localMap = new Map(localBookmarks.map((b: any) => [b.id, b]));
          const allIds = new Set([...serverMap.keys(), ...localMap.keys()]);

          allIds.forEach((id) => {
            const serverItem = serverMap.get(id);
            const localItem = localMap.get(id);

            if (serverItem && localItem) {
              const serverTime =
                serverItem.updated_at || serverItem.created_at || 0;
              const localTime =
                localItem.updated_at || localItem.created_at || 0;
              mergedBookmarks.push(
                localTime > serverTime ? localItem : serverItem
              );
            } else {
              mergedBookmarks.push(localItem || serverItem);
            }
          });
        }

        console.log(
          `[Bookmarks] Merged ${mergedBookmarks.length} items (Server: ${serverBookmarks.length}, Local: ${localBookmarks.length})`
        );
        setBookmarks(mergedBookmarks);

        // Update IndexedDB with merged bookmarks data
        snapshot.data.bookmarks = mergedBookmarks;

        // Save merged snapshot to IndexedDB (bookmarks included)
        new Promise<void>((resolve, reject) => {
          const requestId = `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`;
          const cleanup = () => {
            worker.removeEventListener("message", handleMessage);
            worker.removeEventListener("error", handleError);
          };
          const handleMessage = (event: MessageEvent) => {
            const response = event.data as {
              type?: string;
              requestId?: string;
              error?: string;
            };
            if (!response || response.requestId !== requestId) return;
            cleanup();
            if (response.type === "save_complete") {
              resolve();
            } else {
              reject(new Error(response.error || "IndexedDB save failed."));
            }
          };
          const handleError = () => {
            cleanup();
            reject(new Error("IndexedDB worker error."));
          };
          worker.addEventListener("message", handleMessage);
          worker.addEventListener("error", handleError);
          worker.postMessage({
            type: "save_bundle",
            requestId,
            payload: {
              storageKey: snapshot.key,
              data: snapshot.data,
              meta: snapshot.meta,
              schema_version: snapshot.schema_version,
              savedAt: Date.now(),
            },
          });
        })
          .then(() => {
            console.log("[Bookmarks] Merged data saved to IndexedDB");
          })
          .catch((saveErr) => {
            console.error(
              "[Bookmarks] Failed to save merged data to IndexedDB:",
              saveErr
            );
          });
      } else if (localBookmarks.length > 0) {
        // No server data: use local
        setBookmarks(localBookmarks);
        console.log(
          "[Bookmarks] 📦 Using local IndexedDB data:",
          localBookmarks.length
        );
      }

      // Merge server and local drawings
      if (serverDrawings && serverDrawings.length > 0) {
        console.log("[Drawings] Merging server and local data...");

        // Simple merge: use all server data and add local strokes not in server
        const serverIds = new Set(serverDrawings.map((s) => s.id));
        const localOnly = localDrawings.filter((s) => !serverIds.has(s.id));
        const mergedDrawings = [...serverDrawings, ...localOnly];

        console.log(
          `[Drawings] Merged ${mergedDrawings.length} strokes (Server: ${serverDrawings.length}, Local: ${localDrawings.length}, Local-only: ${localOnly.length})`
        );
        setChapterStrokes(mergedDrawings);

        // Update IndexedDB with merged drawings
        snapshot.data.strokes = mergedDrawings;

        // Save merged snapshot to IndexedDB
        new Promise<void>((resolve, reject) => {
          const requestId = `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`;
          const cleanup = () => {
            worker.removeEventListener("message", handleMessage);
            worker.removeEventListener("error", handleError);
          };
          const handleMessage = (event: MessageEvent) => {
            const response = event.data as {
              type?: string;
              requestId?: string;
              error?: string;
            };
            if (!response || response.requestId !== requestId) return;
            cleanup();
            if (response.type === "save_complete") {
              resolve();
            } else {
              reject(new Error(response.error || "IndexedDB save failed."));
            }
          };
          const handleError = () => {
            cleanup();
            reject(new Error("IndexedDB worker error."));
          };
          worker.addEventListener("message", handleMessage);
          worker.addEventListener("error", handleError);
          worker.postMessage({
            type: "save_bundle",
            requestId,
            payload: {
              storageKey: snapshot.key,
              data: snapshot.data,
              meta: snapshot.meta,
              schema_version: snapshot.schema_version,
              savedAt: Date.now(),
            },
          });
        })
          .then(() => {
            console.log("[Drawings] Merged data saved to IndexedDB");
          })
          .catch((saveErr) => {
            console.error(
              "[Drawings] Failed to save merged data to IndexedDB:",
              saveErr
            );
          });
      } else if (localDrawings.length > 0) {
        // No server data: use local
        setChapterStrokes(localDrawings);
        console.log(
          "[Drawings] 📦 Using local IndexedDB data:",
          localDrawings.length,
          "strokes"
        );
      }

      // Merge server and local notes
      if (serverNotes && Array.isArray(serverNotes) && serverNotes.length > 0) {
        console.log("[Notes] Merging server and local data...");

        // Merge logic: Use server data and add local notes not in server
        const serverMap = new Map(serverNotes.map((n: any) => [n.id, n]));
        const localMap = new Map(localNotes.map((n: any) => [n.id, n]));
        const allIds = new Set([...serverMap.keys(), ...localMap.keys()]);

        const mergedNotes: any[] = [];
        allIds.forEach((id) => {
          const serverItem = serverMap.get(id);
          const localItem = localMap.get(id);

          if (serverItem && localItem) {
            // Both exist: use the one with the latest updated_at
            const serverTime = serverItem.updated_at || serverItem.created_at || 0;
            const localTime = localItem.updated_at || localItem.created_at || 0;
            mergedNotes.push(localTime > serverTime ? localItem : serverItem);
          } else {
            // Only one exists: use it
            mergedNotes.push(localItem || serverItem);
          }
        });

        console.log(
          `[Notes] Merged ${mergedNotes.length} notes (Server: ${serverNotes.length}, Local: ${localNotes.length})`
        );
        setGeneralNotes(mergedNotes);

        // Update IndexedDB with merged notes
        snapshot.data.notes = mergedNotes;

        // Save merged snapshot to IndexedDB
        new Promise<void>((resolve, reject) => {
          const requestId = `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`;
          const cleanup = () => {
            worker.removeEventListener("message", handleMessage);
            worker.removeEventListener("error", handleError);
          };
          const handleMessage = (event: MessageEvent) => {
            const response = event.data as {
              type?: string;
              requestId?: string;
              error?: string;
            };
            if (!response || response.requestId !== requestId) return;
            cleanup();
            if (response.type === "save_complete") {
              resolve();
            } else {
              reject(new Error(response.error || "IndexedDB save failed."));
            }
          };
          const handleError = () => {
            cleanup();
            reject(new Error("IndexedDB worker error."));
          };
          worker.addEventListener("message", handleMessage);
          worker.addEventListener("error", handleError);
          worker.postMessage({
            type: "save_bundle",
            requestId,
            payload: {
              storageKey: snapshot.key,
              data: snapshot.data,
              meta: snapshot.meta,
              schema_version: snapshot.schema_version,
              savedAt: Date.now(),
            },
          });
        })
          .then(() => {
            console.log("[Notes] Merged data saved to IndexedDB");
          })
          .catch((saveErr) => {
            console.error(
              "[Notes] Failed to save merged data to IndexedDB:",
              saveErr
            );
          });
      } else if (localNotes.length > 0) {
        // No server data: use local
        setGeneralNotes(localNotes);
        console.log(
          "[Notes] 📦 Using local IndexedDB data:",
          localNotes.length,
          "notes"
        );
      }

      // Load progress: Server data takes priority over IndexedDB
      let serverProgressPage: number | null = null;

      if (config) {
        console.log("[Progress] Attempting to load from server...");
        try {
          const progressData = await loadProgressFromServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
          });
          // Server response structure: { ok: true, result: { dataList: ["JSON string", ...] } }
          if (
            progressData &&
            progressData.ok &&
            progressData.result &&
            Array.isArray(progressData.result.dataList) &&
            progressData.result.dataList.length > 0
          ) {
            // Parse the most recent progress data
            const parsed = JSON.parse(progressData.result.dataList[0]);
            console.log("[Progress] ✅ Loaded from server:", parsed);

            // Store server progress page
            if (typeof parsed.currentPdfPage === "number") {
              serverProgressPage = parsed.currentPdfPage;
            }
          } else {
            console.log("[Progress] No progress data on server");
          }
        } catch (err) {
          console.error("[Progress] ❌ Failed to load from server:", err);
        }
      } else {
        console.log("[Progress] No RMS config, skipping server load");
      }

      // Apply progress data: prioritize server, fallback to IndexedDB
      if (data.progress && typeof data.progress === "object") {
        const { currentPdfPage: savedPage, viewMode: savedMode } =
          data.progress;
        const totalPages =
          typeof data.progress.pdfTotalPages === "number"
            ? data.progress.pdfTotalPages
            : null;
        if (savedMode === "single" || savedMode === "double") {
          setViewMode(savedMode);
        }
        if (totalPages !== null && Number.isFinite(totalPages)) {
          setPdfTotalPages(Math.max(0, Math.round(totalPages)));
        }

        // Use server progress if available, otherwise use IndexedDB
        const targetPage =
          serverProgressPage !== null ? serverProgressPage : savedPage;
        if (typeof targetPage === "number" && Number.isFinite(targetPage)) {
          console.log(
            `[Progress] Setting initial page to load: ${targetPage} (source: ${
              serverProgressPage !== null ? "server" : "IndexedDB"
            })`
          );
          setInitialPageToLoad(targetPage);
        }
      } else if (serverProgressPage !== null) {
        // No IndexedDB progress, but server has data
        console.log(
          `[Progress] Setting initial page to load: ${serverProgressPage} (source: server)`
        );
        setInitialPageToLoad(serverProgressPage);
      }
      indexedDbSnapshotRef.current = snapshot;
    } catch (err) {
      console.error("IndexedDB load failed", err);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = buildIndexedDbKey();
    if (!storageKey) return;
    if (indexedDbLoadKeyRef.current === storageKey) return;
    indexedDbLoadKeyRef.current = storageKey;
    loadLocalDataFromIndexedDb(storageKey);
  }, [bookTitle]);

  const saveProgress = async () => {
    const config = getRmsConfig();
    if (!config) {
      alert("RMS 설정이 필요합니다. (VITE_RMS_API_BASE, VITE_RMS_BOOK_CD)");
      return;
    }
    try {
      await saveRmsProgress({
        apiBase: config.apiBase,
        bookCd: config.bookCd,
        memberCd: config.memberCd,
        orderIgnore: config.orderIgnore,
        pageOffset: config.pageOffset,
        pageIndex: currentPdfPage,
        viewMode,
        lastPages: currentPdfPage,
        bookTotalPages: pdfTotalPages,
      });
      alert("Progress Saved!");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to save progress", err);
      alert(`Progress Save Failed: ${message}`);
    }
  };

  const saveLocalDataToIndexedDb = async () => {
    if (typeof window === "undefined") return;
    const worker = getIndexedDbWorker();
    if (!worker) {
      alert("IndexedDB 저장을 위한 Worker를 사용할 수 없습니다.");
      return;
    }

    const storageKey = buildIndexedDbKey();
    const savedAt = Date.now();
    const baseSnapshot = buildCurrentIndexedDbSnapshot(storageKey, savedAt);
    const migrated = migrate_snapshot(baseSnapshot);
    const snapshot = migrated.snapshot || baseSnapshot;

    const previousSnapshot = indexedDbSnapshotRef.current;
    if (previousSnapshot && previousSnapshot.key === storageKey) {
      if (isSameSnapshot(previousSnapshot, snapshot)) {
        alert("변경된 내용이 없어 IndexedDB 저장을 건너뜁니다.");
        return;
      }
    }

    const estimate = await getStorageEstimate();
    if (estimate) {
      alert(
        [
          "IndexedDB 저장 용량",
          `사용된 용량: ${formatStorageMb(estimate.usage)}`,
          `남은 용량: ${formatStorageMb(estimate.remaining)}`,
          `전체 용량: ${formatStorageMb(estimate.quota)}`,
        ].join("\n")
      );
    } else {
      alert(
        [
          "IndexedDB 저장 용량",
          "사용된 용량: 알 수 없음",
          "남은 용량: 알 수 없음",
          "전체 용량: 알 수 없음",
        ].join("\n")
      );
    }
    const payload = {
      storageKey: snapshot.key,
      schema_version: snapshot.schema_version,
      savedAt: snapshot.savedAt,
      data: snapshot.data,
      meta: snapshot.meta,
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const requestId = `${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}`;
        const cleanup = () => {
          worker.removeEventListener("message", handleMessage);
          worker.removeEventListener("error", handleError);
        };
        const handleMessage = (event: MessageEvent) => {
          const response = event.data as {
            type?: string;
            requestId?: string;
            error?: string;
          };
          if (!response || response.requestId !== requestId) return;
          cleanup();
          if (response.type === "save_complete") {
            resolve();
          } else {
            reject(new Error(response.error || "IndexedDB save failed."));
          }
        };
        const handleError = () => {
          cleanup();
          reject(new Error("IndexedDB worker error."));
        };
        worker.addEventListener("message", handleMessage);
        worker.addEventListener("error", handleError);
        worker.postMessage({ type: "save_bundle", requestId, payload });
      });
      indexedDbSnapshotRef.current = snapshot;
      alert("IndexedDB에 저장했습니다.");
      const config = getRmsConfig();
      if (config) {
        try {
          // Start with the current snapshot
          let currentSnapshot = snapshot;

          // Filter only changed highlights (syncStatus === "pending")
          const changedHighlights = (snapshot.data.highlights || []).filter(
            (h: any) => h.syncStatus === "pending"
          );

          if (changedHighlights.length > 0) {
            console.log(
              `[Highlights] Sending ${
                changedHighlights.length
              } changed items to server (Total: ${
                (snapshot.data.highlights || []).length
              })`
            );

            await saveHighlightsToServer({
              apiBase: config.apiBase,
              bookCd: config.bookCd,
              highlights: changedHighlights,
            });
            alert(
              `하이라이트가 서버에 저장되었습니다. (${changedHighlights.length}개 항목)`
            );

            // Mark saved highlights as synced and remove deleted ones
            const updatedHighlights = (snapshot.data.highlights || [])
              .map((h: any) => {
                // Mark as synced if it was pending
                if (h.syncStatus === "pending") {
                  return { ...h, syncStatus: "synced" };
                }
                return h;
              })
              .filter((h: any) => !h.deleted); // Remove deleted items

            currentSnapshot = {
              ...currentSnapshot,
              data: {
                ...currentSnapshot.data,
                highlights: updatedHighlights,
              },
            };
            // Save cleaned snapshot to IndexedDB
            await new Promise<void>((resolve, reject) => {
              const requestId = `${Date.now()}_${Math.random()
                .toString(36)
                .slice(2)}`;
              const cleanup = () => {
                worker.removeEventListener("message", handleMessage);
                worker.removeEventListener("error", handleError);
              };
              const handleMessage = (event: MessageEvent) => {
                const response = event.data as {
                  type?: string;
                  requestId?: string;
                  error?: string;
                };
                if (!response || response.requestId !== requestId) return;
                cleanup();
                if (response.type === "save_complete") {
                  resolve();
                } else {
                  reject(new Error(response.error || "IndexedDB save failed."));
                }
              };
              const handleError = () => {
                cleanup();
                reject(new Error("IndexedDB worker error."));
              };
              worker.addEventListener("message", handleMessage);
              worker.addEventListener("error", handleError);
              worker.postMessage({
                type: "save_bundle",
                requestId,
                payload: {
                  storageKey: currentSnapshot.key,
                  schema_version: currentSnapshot.schema_version,
                  savedAt: currentSnapshot.savedAt,
                  data: currentSnapshot.data,
                  meta: currentSnapshot.meta,
                },
              });
            });

            indexedDbSnapshotRef.current = currentSnapshot;
            // Also update the local state to remove deleted highlights and mark as synced
            setHighlights((prev) =>
              prev
                .filter((h) => !h.deleted)
                .map((h) =>
                  h.syncStatus === "pending"
                    ? { ...h, syncStatus: "synced" as const }
                    : h
                )
            );
            console.log(
              `[Highlights] ${changedHighlights.length} items synced, deleted items removed`
            );
          } else {
            console.log("[Highlights] No changes to sync");
          }

          // Filter only changed bookmarks (syncStatus === "pending")
          const changedBookmarks = (
            currentSnapshot.data.bookmarks || []
          ).filter((b: any) => b.syncStatus === "pending");

          if (changedBookmarks.length > 0) {
            console.log(
              `[Bookmarks] Sending ${
                changedBookmarks.length
              } changed items to server (Total: ${
                (currentSnapshot.data.bookmarks || []).length
              })`
            );

            await saveBookmarksToServer({
              apiBase: config.apiBase,
              bookCd: config.bookCd,
              bookmarks: changedBookmarks,
            });
            console.log(
              `[Bookmarks] ✅ Saved ${changedBookmarks.length} items to server`
            );

            // Mark saved bookmarks as synced and remove deleted ones
            const updatedBookmarks = (currentSnapshot.data.bookmarks || [])
              .map((b: any) => {
                // Mark as synced if it was pending
                if (b.syncStatus === "pending") {
                  return { ...b, syncStatus: "synced" };
                }
                return b;
              })
              .filter((b: any) => !b.deleted); // Remove deleted items

            currentSnapshot = {
              ...currentSnapshot,
              data: {
                ...currentSnapshot.data,
                bookmarks: updatedBookmarks,
              },
            };

            // Save cleaned snapshot to IndexedDB
            await new Promise<void>((resolve, reject) => {
              const requestId = `${Date.now()}_${Math.random()
                .toString(36)
                .slice(2)}`;
              const cleanup = () => {
                worker.removeEventListener("message", handleMessage);
                worker.removeEventListener("error", handleError);
              };
              const handleMessage = (event: MessageEvent) => {
                const response = event.data as {
                  type?: string;
                  requestId?: string;
                  error?: string;
                };
                if (!response || response.requestId !== requestId) return;
                cleanup();
                if (response.type === "save_complete") {
                  resolve();
                } else {
                  reject(new Error(response.error || "IndexedDB save failed."));
                }
              };
              const handleError = () => {
                cleanup();
                reject(new Error("IndexedDB worker error."));
              };
              worker.addEventListener("message", handleMessage);
              worker.addEventListener("error", handleError);
              worker.postMessage({
                type: "save_bundle",
                requestId,
                payload: {
                  storageKey: currentSnapshot.key,
                  schema_version: currentSnapshot.schema_version,
                  savedAt: currentSnapshot.savedAt,
                  data: currentSnapshot.data,
                  meta: currentSnapshot.meta,
                },
              });
            });

            indexedDbSnapshotRef.current = currentSnapshot;
            // Also update the local state to remove deleted bookmarks and mark as synced
            setBookmarks((prev) =>
              prev
                .filter((b) => !b.deleted)
                .map((b) =>
                  b.syncStatus === "pending"
                    ? { ...b, syncStatus: "synced" as const }
                    : b
                )
            );
            console.log(
              `[Bookmarks] ${changedBookmarks.length} items synced, deleted items removed`
            );
          } else {
            console.log("[Bookmarks] No changes to sync");
          }

          // Save drawings to server
          console.log("[Drawings] Sending drawings to server...");
          const strokes = currentSnapshot.data.strokes || [];
          if (Array.isArray(strokes) && strokes.length > 0) {
            await saveDrawingsToServer({
              apiBase: config.apiBase,
              bookCd: config.bookCd,
              drawings: strokes,
            });
            console.log(
              `[Drawings] ✅ Saved ${strokes.length} strokes to server`
            );

            // Remove deleted strokes after successful sync
            const updatedStrokes = strokes.filter((s: any) => !s.deleted);
            currentSnapshot = {
              ...currentSnapshot,
              data: {
                ...currentSnapshot.data,
                strokes: updatedStrokes,
              },
            };

            // Save cleaned snapshot to IndexedDB
            await new Promise<void>((resolve, reject) => {
              const requestId = `${Date.now()}_${Math.random()
                .toString(36)
                .slice(2)}`;
              const cleanup = () => {
                worker.removeEventListener("message", handleMessage);
                worker.removeEventListener("error", handleError);
              };
              const handleMessage = (event: MessageEvent) => {
                const response = event.data as {
                  type?: string;
                  requestId?: string;
                  error?: string;
                };
                if (!response || response.requestId !== requestId) return;
                cleanup();
                if (response.type === "save_complete") {
                  resolve();
                } else {
                  reject(new Error(response.error || "IndexedDB save failed."));
                }
              };
              const handleError = () => {
                cleanup();
                reject(new Error("IndexedDB worker error."));
              };
              worker.addEventListener("message", handleMessage);
              worker.addEventListener("error", handleError);
              worker.postMessage({
                type: "save_bundle",
                requestId,
                payload: {
                  storageKey: currentSnapshot.key,
                  schema_version: currentSnapshot.schema_version,
                  savedAt: currentSnapshot.savedAt,
                  data: currentSnapshot.data,
                  meta: currentSnapshot.meta,
                },
              });
            });

            indexedDbSnapshotRef.current = currentSnapshot;
            // Also update the local state to remove deleted strokes
            setChapterStrokes((prev) => prev.filter((s) => !s.deleted));
            console.log(
              `[Drawings] Deleted items removed from IndexedDB and state`
            );
          } else {
            console.log("[Drawings] No drawings to save");
          }

          // Save notes to server
          console.log("[Notes] Sending notes to server...");
          if (
            Array.isArray(currentSnapshot.data.notes) &&
            currentSnapshot.data.notes.length > 0
          ) {
            await saveNotesToServer({
              apiBase: config.apiBase,
              bookCd: config.bookCd,
              notes: currentSnapshot.data.notes,
            });
            console.log(
              `[Notes] ✅ Saved ${currentSnapshot.data.notes.length} notes to server`
            );

            // Remove deleted notes after successful sync
            const updatedNotes = currentSnapshot.data.notes.filter(
              (n: any) => !n.deleted
            );
            currentSnapshot = {
              ...currentSnapshot,
              data: {
                ...currentSnapshot.data,
                notes: updatedNotes,
              },
            };

            // Save cleaned snapshot to IndexedDB
            await new Promise<void>((resolve, reject) => {
              const requestId = `${Date.now()}_${Math.random()
                .toString(36)
                .slice(2)}`;
              const cleanup = () => {
                worker.removeEventListener("message", handleMessage);
                worker.removeEventListener("error", handleError);
              };
              const handleMessage = (event: MessageEvent) => {
                const response = event.data as {
                  type?: string;
                  requestId?: string;
                  error?: string;
                };
                if (!response || response.requestId !== requestId) return;
                cleanup();
                if (response.type === "save_complete") {
                  resolve();
                } else {
                  reject(new Error(response.error || "IndexedDB save failed."));
                }
              };
              const handleError = () => {
                cleanup();
                reject(new Error("IndexedDB worker error."));
              };
              worker.addEventListener("message", handleMessage);
              worker.addEventListener("error", handleError);
              worker.postMessage({
                type: "save_bundle",
                requestId,
                payload: {
                  storageKey: currentSnapshot.key,
                  schema_version: currentSnapshot.schema_version,
                  savedAt: currentSnapshot.savedAt,
                  data: currentSnapshot.data,
                  meta: currentSnapshot.meta,
                },
              });
            });

            indexedDbSnapshotRef.current = currentSnapshot;
            // Also update the local state to remove deleted notes
            setGeneralNotes((prev) => prev.filter((n) => !n.deleted));
            console.log(
              `[Notes] Deleted items removed from IndexedDB and state`
            );
          } else {
            console.log("[Notes] No notes to save");
          }

          // Save progress to server
          console.log("[Progress] Sending progress to server...");
          const progressData = {
            currentPdfPage,
            lastReadAt: new Date().toISOString(),
          };

          await saveProgressToServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
            progress: progressData,
          });
          console.log("[Progress] ✅ Saved to server");

          const savedItems = [];
          if (changedHighlights.length > 0) {
            savedItems.push(`하이라이트: ${changedHighlights.length}개`);
          }
          if (changedBookmarks.length > 0) {
            savedItems.push(`북마크: ${changedBookmarks.length}개`);
          }
          if (Object.keys(currentSnapshot.data.strokes || {}).length > 0) {
            savedItems.push(
              `필기: ${Object.keys(currentSnapshot.data.strokes || {}).length}페이지`
            );
          }
          if (
            Array.isArray(currentSnapshot.data.notes) &&
            currentSnapshot.data.notes.length > 0
          ) {
            savedItems.push(
              `마이노트: ${currentSnapshot.data.notes.length}개`
            );
          }
          savedItems.push("진행도: 저장됨");

          if (savedItems.length > 1) {
            alert(`저장이 완료되었습니다.\n- ${savedItems.join("\n- ")}`);
          } else {
            alert("진행도가 서버에 저장되었습니다.");
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("Server save failed", err);
          alert(`서버 저장 실패: ${message}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("IndexedDB save failed", err);
      alert(`IndexedDB 저장 실패: ${message}`);
    }
  };

  // 데이터 변경 시 UNSAVED로 표시 (자동 저장은 하지 않음)
  const markAsUnsaved = React.useCallback(() => {
    setSyncStatus("UNSAVED");
  }, []);

  const saveAll = async () => {
    try {
      setSyncStatus("SYNCING");

      // 네트워크 상태 확인
      if (!navigator.onLine) {
        console.log("네트워크 끊김 - 로컬 저장만 수행");
        // 로컬 저장 (IndexedDB + 서버 동기화 시뮬레이션)
        await saveLocalDataToIndexedDb();
        setSyncStatus("LOCAL_ONLY");

        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, "0");
        const day = now.getDate().toString().padStart(2, "0");
        const hours = now.getHours();
        const minutes = now.getMinutes().toString().padStart(2, "0");
        const ampm = hours >= 12 ? "오후" : "오전";
        const displayHours = hours % 12 || 12;
        setLastSavedAt(
          `${year}.${month}.${day} ${ampm} ${displayHours}:${minutes}`
        );
        return;
      }

      // 온라인 상태: 정상적으로 로컬 + 서버 저장
      await saveLocalDataToIndexedDb();

      setSyncStatus("SAVED");
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, "0");
      const day = now.getDate().toString().padStart(2, "0");
      const hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, "0");
      const ampm = hours >= 12 ? "오후" : "오전";
      const displayHours = hours % 12 || 12;

      setLastSavedAt(
        `${year}.${month}.${day} ${ampm} ${displayHours}:${minutes}`
      );
      console.log("저장 완료");
    } catch (err) {
      console.error("Save all failed", err);
      setSyncStatus("LOCAL_ONLY");
    }
  };

  return (
    <BookContext.Provider
      value={{
        chapters,
        ragChunks,
        referenceDocument,
        bookTitle,
        currentChapterIndex,
        currentChapter,
        goToNextChapter,
        goToPrevChapter,
        goToChapter,
        getChapterTitleByPage,
        uploadBook,
        isProcessing,
        fontSize,
        setFontSize,
        viewMode,
        setViewMode,
        theme,
        toggleTheme,
        showAnnotations,
        toggleAnnotations,
        bookmarks,
        addPdfBookmark,
        removePdfBookmark,
        highlights,
        addHighlight,
        updateHighlight,
        removeHighlight,
        activeHighlightId,
        focusHighlight,
        pendingHighlightEditId,
        requestHighlightNoteEdit,
        clearHighlightNoteEditRequest,
        drawingMode,
        setDrawingMode,
        penColor,
        setPenColor,
        penWidth,
        setPenWidth,
        penOpacity,
        setPenOpacity,
        chapterStrokes,
        addStroke,
        removeStroke,
        hasStrokes,
        generalNotes,
        addGeneralNote,
        updateGeneralNote,
        removeGeneralNote,
        importNotes,
        exportNoteAsMarkdown,
        isCaptureMode,
        setCaptureMode,
        capturedImage,
        setCapturedImage,
        aiChatHistory,
        addChatMessage,
        triggerSmartExplain,
        isToolsOpen,
        setToolsOpen,
        activeToolTab,
        setActiveToolTab,
        searchQuery,
        setSearchQuery,
        performSearch,
        isTtsPlaying,
        currentTtsSegmentIndex,
        ttsConfig,
        setTtsConfig,
        startTts,
        stopTts,
        pauseTts,
        stats,
        incrementAiCount,
        updateReadingTime,
        saveProgress,
        saveLocalDataToIndexedDb,
        saveAll,
        syncStatus,
        lastSavedAt,
        pdfTextPages,
        setPdfTextPages: updatePdfTextPages,
        goToPdfPage,
        goToHighlight,
        registerPdfNavigator,
        registerPdfZoomHandler,
        zoomPdfIn,
        zoomPdfOut,
        pdfZoom,
        setPdfZoom,
        resetPdfZoom,
        pdfSearchHighlight,
        setPdfSearchHighlight,
        currentPdfPage,
        setCurrentPdfPage,
        pdfTotalPages,
        setPdfTotalPages,
        pdfLoadProgress,
        setPdfLoadProgress,
        pdfLoadTime,
        setPdfLoadTime,
        pdfIsLoading,
        setPdfIsLoading,
      }}
    >
      {children}
    </BookContext.Provider>
  );
};

export const useBook = () => {
  const context = useContext(BookContext);
  if (context === undefined) {
    throw new Error("useBook must be used within a BookProvider");
  }
  return context;
};
