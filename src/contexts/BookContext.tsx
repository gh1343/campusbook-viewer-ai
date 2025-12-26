import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useRef,
} from 'react';
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
} from '../../types';
import {generateExplanation} from '../services/geminiService';
import {processPdf, findRelevantContext} from '../services/pdfRagService';
import {synthesizeWithGemini} from '../services/ttsService';
import navTocRaw from '../../nav.xhtml?raw';

const MOCK_CHAPTERS: Chapter[] = [
  {
    id: 'ch1',
    title: 'Chapter 1: The Dawn of AI',
    content: `
      <h2>1.1 Introduction to Artificial Intelligence</h2>
      <p>Artificial Intelligence (AI) is intelligence demonstrated by machines, as opposed to the natural intelligence displayed by humans or animals. Leading AI textbooks define the field as the study of "intelligent agents": any system that perceives its environment and takes actions that maximize its chances of achieving its goals.</p>
      <p>The history of AI began in antiquity, with myths, stories, and rumors of artificial beings endowed with intelligence or consciousness by master craftsmen. The seeds of modern AI were planted by philosophers who attempted to describe the process of human thinking as the mechanical manipulation of symbols.</p>
      <h3>1.2 The Turing Test</h3>
      <p>The Turing test, developed by Alan Turing in 1950, is a test of a machine's ability to exhibit intelligent behavior equivalent to, or indistinguishable from, that of a human. Turing proposed that a human evaluator would judge natural language conversations between a human and a machine designed to generate human-like responses.</p>
    `,
  },
  {
    id: 'ch2',
    title: 'Chapter 2: Machine Learning Basics',
    content: `
      <h2>2.1 What is Machine Learning?</h2>
      <p>Machine Learning (ML) is a subset of artificial intelligence that focuses on building systems that learn, or improve performance, based on the data they consume. Artificial Intelligence is a broad term that refers to systems or machines that mimic human intelligence. Machine Learning is how they achieve that intelligence.</p>
      <p>There are three main types of machine learning: supervised learning, unsupervised learning, and reinforcement learning. In supervised learning, the algorithm is trained on labeled data.</p>
      <h3>2.2 Neural Networks</h3>
      <p>Neural networks, also known as artificial neural networks (ANNs) or simulated neural networks (SNNs), are a subset of machine learning and are at the heart of deep learning algorithms. Their name and structure are inspired by the human brain, mimicking the way that biological neurons signal to one another.</p>
    `,
  },
  {
    id: 'ch3',
    title: 'Chapter 3: Ethics in Technology',
    content: `
      <h2>3.1 The Importance of Ethics</h2>
      <p>As technology becomes more integrated into our daily lives, the ethical implications of its use become increasingly important. Issues such as privacy, bias in algorithms, and the displacement of jobs are central discussions in the tech world today.</p>
      <p>Algorithmic bias describes systematic and repeatable errors in a computer system that create unfair outcomes, such as privileging one arbitrary group of users over others.</p>
    `,
  },
];

const normalizeForMatch = (value: string) =>
  value
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Za-z가-힣]/g, '')
    .toLowerCase();

const parseNavChapters = (
  raw: string
): {chapters: Chapter[]; pageMap: Record<string, number>} => {
  if (typeof window === 'undefined') return {chapters: [], pageMap: {}};
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, 'application/xhtml+xml');
    const nav =
      doc.querySelector('nav#toc') || doc.querySelector('nav[epub\\:type="toc"]');
    if (!nav) return {chapters: [], pageMap: {}};

    const usedIds = new Set<string>();
    const anchors = Array.from(nav.querySelectorAll('a'));
    const pageMap: Record<string, number> = {};

    const chapters = anchors
      .map((anchor, index) => {
        const title = (anchor.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!title) return null;

        const href = anchor.getAttribute('href') || `toc-${index + 1}`;
        const rawId = href;
        const baseId =
          rawId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') ||
          `toc-${index + 1}`;

        let id = baseId;
        let suffix = 1;
        while (usedIds.has(id)) {
          id = `${baseId}-${suffix++}`;
        }
        usedIds.add(id);

        const pageMatch = href.match(/p0*([0-9]+)_/i) || href.match(/p0*([0-9]+)/i);
        if (pageMatch && pageMatch[1]) {
          const pageNum = parseInt(pageMatch[1], 10);
          if (Number.isFinite(pageNum)) {
            pageMap[id] = pageNum;
          }
        }

        return {
          id,
          title,
          content: '',
        } as Chapter;
      })
      .filter(Boolean) as Chapter[];

    return {chapters, pageMap};
  } catch (err) {
    console.error('Failed to parse nav.xhtml', err);
    return {chapters: [], pageMap: {}};
  }
};

const BookContext = createContext<BookContextType | undefined>(undefined);

export const BookProvider: React.FC<{children: ReactNode}> = ({children}) => {
  const [chapters, setChapters] = useState<Chapter[]>(MOCK_CHAPTERS);
  const [referenceDocument, setReferenceDocument] = useState<Chapter | null>(
    null
  );
  const [ragChunks, setRagChunks] = useState<RagChunk[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [theme, setTheme] = useState<Theme>('light');
  const [viewMode, setViewMode] = useState<ViewMode>('single');

  const [showAnnotations, setShowAnnotations] = useState(true);
  const [bookmarks, setBookmarks] = useState<PdfBookmark[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem('pdfBookmarks');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map(item => {
            if (item && typeof item === 'object' && 'page' in item) {
              return item as PdfBookmark;
            }
            if (typeof item === 'number') {
              return {
                id: `migrated-${item}`,
                page: item,
                label: `Page ${item}`,
                createdAt: Date.now(),
              } as PdfBookmark;
            }
            return null;
          })
          .filter(Boolean) as PdfBookmark[];
      }
    } catch (e) {
      console.error('Failed to parse stored pdfBookmarks', e);
    }
    return [];
  });
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
    null
  );

  const [drawingMode, setDrawingMode] = useState<DrawingMode>('idle');
  const [penColor, setPenColor] = useState<DrawingColor>('#ef4444');
  const [penWidth, setPenWidth] = useState<number>(3);
  const [penOpacity, setPenOpacity] = useState<number>(1.0);
  const [chapterStrokes, setChapterStrokes] = useState<
    Record<string, Stroke[]>
  >({});

  const [generalNotes, setGeneralNotes] = useState<GeneralNote[]>([]);
  const [isCaptureMode, setCaptureMode] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const [aiChatHistory, setAiChatHistory] = useState<ChatMessage[]>([]);
  const [isToolsOpen, setToolsOpen] = useState(true);
  const [activeToolTab, setActiveToolTab] = useState<
    'ai' | 'notes' | 'notebook' | 'reference' | 'search'
  >('ai');
  const [searchQuery, setSearchQuery] = useState('');

  // --- TTS (stub implementation for UI controls) ---
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);
  const [currentTtsSegmentIndex, setCurrentTtsSegmentIndex] = useState<
    number | null
  >(null);
  const [ttsConfig, setTtsConfigState] = useState<TTSConfig>({
    voice: 'Kore',
    speed: 1.0,
    continuous: true,
  });
  const [chapterPageMap, setChapterPageMap] = useState<Record<string, number>>(
    {}
  );
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsObjectUrlRef = useRef<string | null>(null);
  const ttsGeneratingRef = useRef(false);

  const setTtsConfig = (config: Partial<TTSConfig>) => {
    setTtsConfigState(prev => ({...prev, ...config}));
  };

  const splitIntoSentences = (text: string): string[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const matches = trimmed.match(/[^.!?]+[.!?]?/g);
    if (matches && matches.length > 0) {
      return matches.map(s => s.trim()).filter(Boolean);
    }
    // fallback: single chunk
    return [trimmed];
  };

  const extractPlainText = (raw: string) =>
    raw.replace(/<script[^>]*>.*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const buildSentences = () => {
    if (pdfTextPages.length > 0) {
      const sorted = [...pdfTextPages].sort((a, b) => a.page - b.page);
      const targetPage = currentPdfPage || sorted[0]?.page || 1;
      const sentences: string[] = [];
      let defaultStartIndex = 0;

      sorted.forEach(p => {
        const plain = extractPlainText(p.text || '');
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
      ttsAudioRef.current.src = '';
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
    if (ttsAudioRef.current && ttsAudioRef.current.paused && !ttsAudioRef.current.ended) {
      await ttsAudioRef.current.play().catch(() => {});
      setIsTtsPlaying(true);
      return;
    }

    cleanupTtsAudio();

    const { sentences, defaultStartIndex } = buildSentences();
    if (sentences.length === 0) {
      alert('읽을 텍스트가 없습니다.');
      return;
    }

    const beginIdx =
      typeof startIndex === 'number' && startIndex >= 0 && startIndex < sentences.length
        ? startIndex
        : Math.min(defaultStartIndex, sentences.length - 1);

    const MAX_CHARS = 8000;
    const textToRead = sentences.slice(beginIdx).join(' ').slice(0, MAX_CHARS);
    if (!textToRead) {
      alert('읽을 텍스트가 없습니다.');
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

      await audio.play().catch(err => {
        console.error('Audio playback failed', err);
        setIsTtsPlaying(false);
      });
    } catch (err) {
      console.error('Gemini TTS failed', err);
      alert('TTS 생성 중 오류가 발생했습니다.');
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
    {page: number; text: string}[]
  >([]);
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [pdfNavigator, setPdfNavigator] = useState<
    ((page: number) => void) | null
  >(null);
  const [pendingPdfPage, setPendingPdfPage] = useState<number | null>(null);
  const [pdfSearchHighlight, setPdfSearchHighlight] = useState<
    {page: number; term: string} | null
  >(null);

  const currentChapter = chapters[currentChapterIndex];

  useEffect(() => {
    if (window.innerWidth < 1024) {
      setToolsOpen(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        updateReadingTime();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setStats(prev => ({
      ...prev,
      chapterVisits: {
        ...prev.chapterVisits,
        [currentChapter.id]: (prev.chapterVisits[currentChapter.id] || 0) + 1,
      },
    }));
  }, [currentChapter.id]);

  useEffect(() => {
    try {
      localStorage.setItem('pdfBookmarks', JSON.stringify(bookmarks));
    } catch (e) {
      console.error('Failed to persist pdfBookmarks', e);
    }
  }, [bookmarks]);

  // nav.xhtml을 chapters로 반영
  useEffect(() => {
    if (!navTocRaw) return;
    const {chapters: parsedChapters, pageMap} = parseNavChapters(navTocRaw);
    if (parsedChapters.length > 0) {
      setChapters(parsedChapters);
      setChapterPageMap(pageMap);
      setCurrentChapterIndex(0);
    }
  }, []);

  const updateReadingTime = () => {
    setStats(prev => ({
      ...prev,
      totalReadingTime: prev.totalReadingTime + 5,
    }));
  };

  const incrementAiCount = () => {
    setStats(prev => ({
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

  useEffect(() => {
    const idx = findChapterIndexForPage(currentPdfPage);
    if (idx !== -1 && idx !== currentChapterIndex) {
      setCurrentChapterIndex(idx);
    }
  }, [currentPdfPage, findChapterIndexForPage, currentChapterIndex]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
    if (theme === 'light') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const toggleAnnotations = () => setShowAnnotations(prev => !prev);

  const addPdfBookmark = (page: number, label?: string) => {
    if (!page || page < 1) return;
    setBookmarks(prev => {
      if (prev.some(b => b.page === page)) return prev;
      const bookmark: PdfBookmark = {
        id: Date.now().toString(),
        page,
        label: label || `Page ${page}`,
        createdAt: Date.now(),
      };
      return [bookmark, ...prev];
    });
  };

  const removePdfBookmark = (id: string) => {
    setBookmarks(prev => prev.filter(b => b.id !== id));
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
        // 1) 메인 뷰어에 들어갈 챕터를 PDF에서 가져오기
        setChapters(data.chapters);
        setCurrentChapterIndex(0);

        // 2) RAG(검색/AI)용 청크도 이 PDF 기준으로 세팅
        setRagChunks(data.chunks);

        // 3) 레퍼런스 패널은 안 쓰고 싶으면 null 처리
        setReferenceDocument(null);

        // 4) 툴 패널 열고 AI 탭 or 원하는 탭으로 이동
        setToolsOpen(true);
        setActiveToolTab('ai'); // 혹은 'notes' / 'search' 등으로 변경 가능

        alert(`"${file.name}"을(를) 메인 책으로 로드했습니다.`);
      } else {
        alert('Processed PDF but found no readable content.');
      }
    } catch (error) {
      console.error('PDF Load Failed', error);
      alert('Failed to load PDF. Please ensure it is a valid PDF file.');
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
    const newHighlight: Highlight = {
      id: Date.now().toString(),
      chapterId: chapterId,
      text,
      color: 'yellow',
      pageNumber,
      note,
      createdAt: Date.now(),
    };
    setHighlights(prev => [newHighlight, ...prev]);
    setStats(prev => ({...prev, highlightCount: prev.highlightCount + 1}));
    return newHighlight.id;
  };

  const updateHighlight = (id: string, note: string) => {
    setHighlights(prev => prev.map(hl => (hl.id === id ? {...hl, note} : hl)));
  };

  const removeHighlight = (id: string) => {
    setHighlights(prev => prev.filter(h => h.id !== id));
  };

  const focusHighlight = (id: string) => {
    setShowAnnotations(true);
    setActiveHighlightId(id);
    setTimeout(() => setActiveHighlightId(null), 2000);
  };

  const addStroke = (chapterId: string, stroke: Stroke) => {
    setChapterStrokes(prev => ({
      ...prev,
      [chapterId]: [...(prev[chapterId] || []), stroke],
    }));
  };

  const removeStroke = (chapterId: string, strokeId: string) => {
    setChapterStrokes(prev => ({
      ...prev,
      [chapterId]: (prev[chapterId] || []).filter(s => s.id !== strokeId),
    }));
  };

  const hasStrokes = (chapterId: string) => {
    return (chapterStrokes[chapterId] || []).length > 0;
  };

  const addGeneralNote = (title: string, content: string) => {
    const newNote: GeneralNote = {
      id: Date.now().toString(),
      title: title || 'Untitled Note',
      content: content,
      chapterId: currentChapter.id,
      chapterTitle: currentChapter.title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setGeneralNotes(prev => [newNote, ...prev]);
  };

  const updateGeneralNote = (id: string, title: string, content: string) => {
    setGeneralNotes(prev =>
      prev.map(note =>
        note.id === id ? {...note, title, content, updatedAt: Date.now()} : note
      )
    );
  };

  const removeGeneralNote = (id: string) => {
    setGeneralNotes(prev => prev.filter(n => n.id !== id));
  };

  const exportNoteAsMarkdown = (note: GeneralNote) => {
    let md = note.content.replace(/<[^>]+>/g, '');
    const blob = new Blob([`# ${note.title}\n\n${md}`], {
      type: 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importNotes = async (file: File) => {
    const text = await file.text();
    let title = file.name.replace('.md', '').replace('.json', '');
    let content = text.replace(/\n/g, '<br>');
    addGeneralNote(title, content);
  };

  const addChatMessage = (role: 'user' | 'model', text: string) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role,
      text,
      timestamp: Date.now(),
    };
    setAiChatHistory(prev => [...prev, newMessage]);
  };

  const triggerSmartExplain = async (text: string) => {
    setToolsOpen(true);
    setActiveToolTab('ai');
    const userPrompt = `Explain: "${text}"`;
    addChatMessage('user', userPrompt);
    incrementAiCount();
    let context = currentChapter.content.substring(0, 2000);
    if (ragChunks.length > 0) {
      const relevantText = findRelevantContext(text, ragChunks);
      if (relevantText) context = relevantText;
    }
    const explanation = await generateExplanation(text, context);
    addChatMessage('model', explanation);
  };

  const performSearch = (query: string): SearchResult[] => {
    if (!query || query.length < 2) return [];

    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    chapters.forEach(chapter => {
      const plainText = chapter.content.replace(/<[^>]+>/g, ' ');
      const index = plainText.toLowerCase().indexOf(lowerQuery);
      if (index !== -1) {
        const start = Math.max(0, index - 40);
        const end = Math.min(plainText.length, index + 40 + query.length);
        const snippet =
          (start > 0 ? '...' : '') +
          plainText.substring(start, end) +
          (end < plainText.length ? '...' : '');

        results.push({
          id: `ch-${chapter.id}-${index}`,
          type: 'chapter',
          title: chapter.title,
          contentSnippet: snippet,
          chapterId: chapter.id,
          matchIndex: index,
        });
      }
    });

    highlights.forEach(hl => {
      if (
        hl.text.toLowerCase().includes(lowerQuery) ||
        (hl.note && hl.note.toLowerCase().includes(lowerQuery))
      ) {
        results.push({
          id: `hl-${hl.id}`,
          type: 'highlight',
          title: 'Highlight',
          contentSnippet: hl.note ? `${hl.text} - ${hl.note}` : hl.text,
          chapterId: hl.chapterId,
          pageNumber: hl.pageNumber,
        });
      }
    });

    generalNotes.forEach(note => {
      const plainContent = note.content.replace(/<[^>]+>/g, ' ');
      if (
        note.title.toLowerCase().includes(lowerQuery) ||
        plainContent.toLowerCase().includes(lowerQuery)
      ) {
        results.push({
          id: `note-${note.id}`,
          type: 'note',
          title: note.title,
          contentSnippet: plainContent.substring(0, 80) + '...',
          chapterId: note.chapterId,
        });
      }
    });

    pdfTextPages.forEach(p => {
      const idx = p.text.toLowerCase().indexOf(lowerQuery);
      if (idx !== -1) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(p.text.length, idx + 40 + query.length);
        const snippet =
          (start > 0 ? '...' : '') +
          p.text.substring(start, end) +
          (end < p.text.length ? '...' : '');
        results.push({
          id: `pdf-${p.page}-${idx}`,
          type: 'pdf',
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
    setCurrentPdfPage(safePage);
    if (pdfNavigator) {
      pdfNavigator(safePage);
    } else {
      setPendingPdfPage(safePage);
    }
  };

  const registerPdfNavigator = React.useCallback(
    (fn: (page: number) => void) => {
      setPdfNavigator(() => fn);
      if (pendingPdfPage !== null) {
        fn(pendingPdfPage);
        setPendingPdfPage(null);
      }
    },
    [pendingPdfPage]
  );

  const updatePdfTextPages = React.useCallback(
    (pages: {page: number; text: string}[]) => {
      setPdfTextPages(pages);
    },
    []
  );

  const saveProgress = () => {
    console.log('Saving progress...');
    alert('Progress Saved! (Simulated)');
  };

  return (
    <BookContext.Provider
      value={{
        chapters,
        referenceDocument,
        currentChapterIndex,
        currentChapter,
        goToNextChapter,
        goToPrevChapter,
        goToChapter,
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
        pdfTextPages,
        setPdfTextPages: updatePdfTextPages,
        goToPdfPage,
        registerPdfNavigator,
        pdfSearchHighlight,
        setPdfSearchHighlight,
        currentPdfPage,
        setCurrentPdfPage,
      }}
    >
      {children}
    </BookContext.Provider>
  );
};

export const useBook = () => {
  const context = useContext(BookContext);
  if (context === undefined) {
    throw new Error('useBook must be used within a BookProvider');
  }
  return context;
};
