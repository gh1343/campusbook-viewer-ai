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
  FontSize,
  Theme,
  ReadingStats,
  ChatMessage,
  BookContextType,
  RagChunk,
  SearchResult,
  TTSConfig,
} from "../../types";
import { usePdfViewer } from "./PdfViewerContext";
import { generateExplanation } from "../services/geminiService";
import { processPdf, findRelevantChunks } from "../services/pdfRagService";
import { synthesizeWithGemini } from "../services/ttsService";
import {
  getRmsConfig,
  migrate_snapshot,
  loadProgressFromServer,
  saveProgressToServer,
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
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsObjectUrlRef = useRef<string | null>(null);
  const ttsGeneratingRef = useRef(false);
  const indexedDbWorkerRef = useRef<Worker | null>(null);
  const indexedDbLoadKeyRef = useRef<string | null>(null);

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
  const {
    viewMode,
    setViewMode,
    pdfTextPages,
    currentPdfPage,
    pdfTotalPages,
    setPdfTotalPages,
    goToPdfPage,
    setInitialPageToLoad,
  } = usePdfViewer();

  const currentChapter = chapters[currentChapterIndex];

  useEffect(() => {
    if (window.innerWidth < 1024) {
      setToolsOpen(false);
    }
  }, []);

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
  const loadLocalDataFromIndexedDb = async (storageKey: string) => {
    if (typeof window === "undefined") return;
    const worker = getIndexedDbWorker();
    if (!worker) return;

    const loadSnapshot = async () =>
      await new Promise<IndexedDbSnapshot | null>((resolve, reject) => {
        const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
      });

    const saveSnapshot = async (snapshot: IndexedDbSnapshot) => {
      await new Promise<void>((resolve, reject) => {
        const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
    };

    try {
      let snapshot = await loadSnapshot();
      if (snapshot) {
        const migrated = migrate_snapshot(snapshot);
        snapshot = migrated.snapshot || snapshot;
        if (migrated.changed) {
          await saveSnapshot(snapshot);
        }
      }

      let serverProgressPage: number | null = null;
      const config = getRmsConfig();
      if (config) {
        try {
          const progressData = await loadProgressFromServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
          });
          if (
            progressData &&
            progressData.ok &&
            progressData.result &&
            Array.isArray(progressData.result.dataList) &&
            progressData.result.dataList.length > 0
          ) {
            const parsed = JSON.parse(progressData.result.dataList[0]);
            if (typeof parsed.currentPdfPage === "number") {
              serverProgressPage = parsed.currentPdfPage;
            }
          }
        } catch (err) {
          console.error("[Progress] Failed to load from server:", err);
        }
      }

      const progress =
        snapshot && snapshot.data && typeof snapshot.data.progress === "object"
          ? snapshot.data.progress
          : null;

      if (progress) {
        const savedPage = progress.currentPdfPage;
        const savedMode = progress.viewMode;
        const totalPages =
          typeof progress.pdfTotalPages === "number" ? progress.pdfTotalPages : null;
        if (savedMode === "single" || savedMode === "double") {
          setViewMode(savedMode);
        }
        if (totalPages !== null && Number.isFinite(totalPages)) {
          setPdfTotalPages(Math.max(0, Math.round(totalPages)));
        }
        const targetPage =
          serverProgressPage !== null ? serverProgressPage : savedPage;
        if (typeof targetPage === "number" && Number.isFinite(targetPage)) {
          setInitialPageToLoad(targetPage);
        }
      } else if (serverProgressPage !== null) {
        setInitialPageToLoad(serverProgressPage);
      }
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

    // 1. IndexedDB에 저장 (항상 수행)
    try {
      const worker = getIndexedDbWorker();
      if (worker) {
        const storageKey = buildIndexedDbKey();

        // 기존 데이터 로드
        const existingSnapshot = await new Promise<IndexedDbSnapshot | null>(
          (resolve, reject) => {
            const requestId = `${Date.now()}_${Math.random()
              .toString(36)
              .slice(2)}`;
            const cleanup = () => {
              worker.removeEventListener("message", handleMessage);
              worker.removeEventListener("error", handleError);
            };
            const handleMessage = (event: MessageEvent) => {
              const response = event.data;
              if (!response || response.requestId !== requestId) return;
              cleanup();
              if (response.type === "load_complete") {
                resolve((response.payload as IndexedDbSnapshot) || null);
              } else {
                reject(
                  new Error(response.error || "IndexedDB load failed.")
                );
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

        // Progress 업데이트 후 저장
        const savedAt = Date.now();
        const progressData = {
          currentPdfPage,
          viewMode,
          pdfTotalPages,
          updatedAt: savedAt,
        };

        const updatedPayload = {
          storageKey,
          savedAt,
          schema_version: existingSnapshot?.schema_version || 1,
          data: {
            bookmarks: existingSnapshot?.data?.bookmarks || [],
            highlights: existingSnapshot?.data?.highlights || [],
            notes: existingSnapshot?.data?.notes || [],
            strokes: existingSnapshot?.data?.strokes || [],
            progress: progressData,
          },
          meta: {
            ...(existingSnapshot?.meta || {}),
            bookTitle,
          },
        };

        await new Promise<void>((resolve, reject) => {
          const requestId = `${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`;
          const cleanup = () => {
            worker.removeEventListener("message", handleMessage);
            worker.removeEventListener("error", handleError);
          };
          const handleMessage = (event: MessageEvent) => {
            const response = event.data;
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
            payload: updatedPayload,
          });
        });
      }
    } catch (err) {
      console.error("Failed to save progress to IndexedDB", err);
      throw err; // IndexedDB 저장 실패는 에러로 처리
    }

    // 2. 서버에 저장 (RMS config 있고 온라인일 때만)
    if (!config || !navigator.onLine) {
      return;
    }

    try {
      // 새로운 v3 엔드포인트로 progress 저장
      await saveProgressToServer({
        apiBase: config.apiBase,
        bookCd: config.bookCd,
        progressData: {
          currentPdfPage,
          viewMode,
          pdfTotalPages,
          updatedAt: Date.now(),
        },
      });
    } catch (err) {
      console.error("Failed to save progress to server", err);
      // 서버 저장 실패는 에러를 throw하지 않음 (IndexedDB에 이미 저장됨)
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
        theme,
        toggleTheme,
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
