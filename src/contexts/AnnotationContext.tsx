import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GeneralNote,
  Highlight,
  PdfBookmark,
  SearchResult,
  Stroke,
  SyncStatus,
} from "../../types";
import { getPreviewConfig } from "../utils/previewConfig";
import { isBrowser, toFiniteNumber } from "../utils/common";
import { useBook } from "./BookContext";
import { usePdfViewer } from "./PdfViewerContext";
import {
  getRmsConfig,
  loadBookmarksFromServer,
  loadHighlightsFromServer,
  loadNotesFromServer,
  loadDrawingsFromServer,
  migrate_snapshot,
  saveBookmarksToServer,
  saveHighlightsToServer,
  saveNotesToServer,
  saveDrawingsToServer,
} from "../services/rmsService";
import type { IndexedDbSnapshot } from "../services/rmsService";
import { StorageQuotaExceededError } from "../utils/errors";
import { getSharedIndexedDbWorker } from "../workers/indexedDbWorkerSingleton";

interface AnnotationContextType {
  bookmarks: PdfBookmark[];
  highlights: Highlight[];
  generalNotes: GeneralNote[];
  strokes: Stroke[];
  activeHighlightId: string | null;
  pendingHighlightEditId: string | null;
  showAnnotations: boolean;
  syncStatus: SyncStatus;
  lastSavedAt: string | null;
  lastSaveSource: "manual" | "auto" | null;
  storageQuotaExceeded: boolean;
  toggleAnnotations: () => void;
  addPdfBookmark: (page: number, label?: string) => void;
  removePdfBookmark: (id: string) => void;
  addHighlight: (
    text: string,
    note?: string,
    chapterId?: string,
    pageNumber?: number
  ) => string;
  updateHighlight: (
    id: string,
    data: Partial<Highlight> & { note?: string }
  ) => void;
  removeHighlight: (id: string) => void;
  focusHighlight: (id: string) => void;
  goToHighlight: (hl: Highlight | string) => void;
  requestHighlightNoteEdit: (id: string) => void;
  clearHighlightNoteEditRequest: () => void;
  addGeneralNote: (title: string, content: string) => void;
  updateGeneralNote: (id: string, title: string, content: string) => void;
  removeGeneralNote: (id: string) => void;
  importNotes: (file: File) => Promise<void>;
  exportNoteAsMarkdown: (note: GeneralNote) => void;
  performAnnotationSearch: (query: string) => SearchResult[];
  addStroke: (stroke: Stroke) => void;
  removeStroke: (strokeId: string) => void;
  removeStrokes: (strokeIds: string[]) => void;
  unsavedChangeCount: number;
  saveAnnotations: (source?: "manual" | "auto") => Promise<void>;
  saveLocalOnly: () => Promise<void>;
  getDataFingerprint: () => string;
  getLastSavedFingerprint: () => string | null;
}

const AnnotationContext = createContext<AnnotationContextType | undefined>(
  undefined
);

const formatSavedAt = (date: Date) => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "오후" : "오전";
  const displayHours = hours % 12 || 12;
  return `${year}.${month}.${day} ${ampm} ${displayHours}:${minutes}`;
};

// toFiniteNumber is imported from ../utils/common

const getStrokeTimestamp = (stroke: Partial<Stroke>) => {
  const updatedAt = toFiniteNumber(stroke.updated_at);
  if (updatedAt !== null) return updatedAt;
  const createdAt = toFiniteNumber(stroke.created_at);
  if (createdAt !== null) return createdAt;
  const idTimestamp = toFiniteNumber(stroke.id);
  return idTimestamp !== null ? idTimestamp : 0;
};

const normalizeStrokeSyncFields = (
  stroke: Stroke,
  syncStatus: "pending" | "synced"
): Stroke => {
  const timestamp = getStrokeTimestamp(stroke);
  const createdAt = toFiniteNumber(stroke.created_at);
  const updatedAt = toFiniteNumber(stroke.updated_at);
  return {
    ...stroke,
    created_at: createdAt !== null ? createdAt : timestamp,
    updated_at: updatedAt !== null ? updatedAt : timestamp,
    syncStatus,
  };
};

const parseStrokeEntry = (raw: unknown): Stroke[] => {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => parseStrokeEntry(item));
  }
  if (!raw || typeof raw !== "object") return [];

  const stroke = raw as Stroke;
  if (!stroke.id || typeof stroke.id !== "string") return [];
  return [normalizeStrokeSyncFields(stroke, "synced")];
};

const parseServerStrokeDataList = (dataList: unknown[]) => {
  const parsed = dataList.flatMap((entry) => {
    if (typeof entry === "string") {
      try {
        const json = JSON.parse(entry);
        return parseStrokeEntry(json);
      } catch (err) {
        console.error("stroke parse failed", err);
        return [];
      }
    }
    return parseStrokeEntry(entry);
  });

  if (parsed.length === 0) return [];

  const mergedById = new Map<string, Stroke>();
  parsed.forEach((stroke) => {
    const previous = mergedById.get(stroke.id);
    if (!previous) {
      mergedById.set(stroke.id, stroke);
      return;
    }
    const previousTs = getStrokeTimestamp(previous);
    const currentTs = getStrokeTimestamp(stroke);
    if (currentTs >= previousTs) {
      mergedById.set(stroke.id, stroke);
    }
  });

  return Array.from(mergedById.values());
};

export const AnnotationProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { chapters, currentChapter, goToChapter, bookTitle, viewMode, pdfTotalPages } = useBook();
  const { goToPdfPage, currentPdfPage } = usePdfViewer();

  const [bookmarks, setBookmarks] = useState<PdfBookmark[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [generalNotes, setGeneralNotes] = useState<GeneralNote[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [pendingHighlightEditId, setPendingHighlightEditId] = useState<
    string | null
  >(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("SAVED");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [lastSaveSource, setLastSaveSource] = useState<"manual" | "auto" | null>(null);
  const [storageQuotaExceeded, setStorageQuotaExceeded] = useState(false);
  // markAsUnsaved 호출 횟수 — syncStatus가 이미 UNSAVED여도 호출마다 증가해
  // Header에서 이 값을 감시하면 연속 필기/하이라이트에서도 debounce 타이머가 정확히 리셋됨
  const [unsavedChangeCount, setUnsavedChangeCount] = useState(0);

  const indexedDbLoadKeyRef = useRef<string | null>(null);
  const indexedDbSnapshotRef = useRef<IndexedDbSnapshot | null>(null);

  // 자동저장을 위한 이전 데이터 스냅샷 ref
  const lastSavedDataRef = useRef<string | null>(null);

  const buildIndexedDbKey = useCallback(() => {
    const config = getRmsConfig();
    if (config?.bookCd) {
      return `${config.memberCd}_${config.bookCd}`;
    }
    if (bookTitle) {
      return `title_${bookTitle.replace(/\s+/g, "_")}`;
    }
    if (!isBrowser()) return "local_default";
    const rawPath = window.location.pathname || "";
    const normalized = rawPath.replace(/[^a-zA-Z0-9_-]+/g, "_");
    return normalized ? `path_${normalized}` : "local_default";
  }, [bookTitle]);

  const loadSnapshot = useCallback(
    async (storageKey: string) => {
      const worker = getSharedIndexedDbWorker();
      if (!worker) return null;
      return await new Promise<IndexedDbSnapshot | null>((resolve, reject) => {
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
    },
    []
  );

  const saveSnapshot = useCallback(
    async (snapshot: IndexedDbSnapshot) => {
      const worker = getSharedIndexedDbWorker();
      if (!worker) return;
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
            quotaExceeded?: boolean;
          };
          if (!response || response.requestId !== requestId) return;
          cleanup();
          if (response.type === "save_complete") {
            resolve();
          } else if (response.quotaExceeded) {
            reject(new StorageQuotaExceededError());
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
    },
    []
  );

  const mergeAndSaveInWorker = useCallback(
    async (
      storageKey: string,
      serverData: {
        highlights: Highlight[];
        bookmarks: PdfBookmark[];
        notes: GeneralNote[];
        strokes: Stroke[];
      }
    ) => {
      const worker = getSharedIndexedDbWorker();
      if (!worker) return null;

      return await new Promise<IndexedDbSnapshot | null>((resolve, reject) => {
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
          if (response.type === "merge_complete") {
            resolve((response.payload as IndexedDbSnapshot) || null);
          } else {
            reject(new Error(response.error || "Worker merge failed."));
          }
        };
        const handleError = () => {
          cleanup();
          reject(new Error("IndexedDB worker error."));
        };
        worker.addEventListener("message", handleMessage);
        worker.addEventListener("error", handleError);
        worker.postMessage({
          type: "merge_and_save",
          requestId,
          payload: {
            storageKey,
            serverData,
            currentPdfPage,
            viewMode,
            pdfTotalPages,
            bookTitle,
          },
        });
      });
    },
    [currentPdfPage, viewMode, pdfTotalPages, bookTitle]
  );

  const markAsUnsaved = useCallback(() => {
    setSyncStatus("UNSAVED");
    setUnsavedChangeCount((c) => c + 1);
  }, []);

  const addPdfBookmark = useCallback(
    (page: number, label?: string) => {
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
          syncStatus: "pending",
        };
        return [bookmark, ...prev];
      });
    },
    [markAsUnsaved]
  );

  const removePdfBookmark = useCallback(
    (id: string) => {
      const now = Date.now();
      markAsUnsaved();
      setBookmarks((prev) =>
        prev.map((b) =>
          b.id === id
            ? { ...b, deleted: true, updated_at: now, syncStatus: "pending" }
            : b
        )
      );
    },
    [markAsUnsaved]
  );

  const addHighlight = useCallback(
    (text: string, note?: string, targetChapterId?: string, pageNumber?: number) => {
      const chapterId = targetChapterId || currentChapter.id;
      const now = Date.now();
      markAsUnsaved();
      const newHighlight: Highlight = {
        id: now.toString(),
        chapterId,
        text,
        color: "yellow",
        pageNumber,
        note,
        created_at: now,
        updated_at: now,
        deleted: false,
        syncStatus: "pending",
      };
      setHighlights((prev) => [newHighlight, ...prev]);
      return newHighlight.id;
    },
    [currentChapter.id, markAsUnsaved]
  );

  const updateHighlight = useCallback(
    (id: string, data: Partial<Highlight> & { note?: string }) => {
      const now = Date.now();
      markAsUnsaved();
      setHighlights((prev) =>
        prev.map((hl) =>
          hl.id === id
            ? { ...hl, ...data, updated_at: now, syncStatus: "pending" }
            : hl
        )
      );
    },
    [markAsUnsaved]
  );

  const removeHighlight = useCallback(
    (id: string) => {
      const now = Date.now();
      markAsUnsaved();
      setHighlights((prev) =>
        prev.map((h) =>
          h.id === id
            ? { ...h, deleted: true, updated_at: now, syncStatus: "pending" }
            : h
        )
      );
    },
    [markAsUnsaved]
  );

  const focusHighlight = useCallback((id: string) => {
    setShowAnnotations(true);
    setActiveHighlightId(id);
    setTimeout(() => setActiveHighlightId(null), 2000);
  }, []);

  const requestHighlightNoteEdit = useCallback((id: string) => {
    setPendingHighlightEditId(id);
  }, []);

  const clearHighlightNoteEditRequest = useCallback(() => {
    setPendingHighlightEditId(null);
  }, []);

  const goToHighlight = useCallback(
    (hlOrId: Highlight | string) => {
      const hl =
        typeof hlOrId === "string"
          ? highlights.find((item) => item.id === hlOrId)
          : hlOrId;
      if (!hl) return;

      if (hl.chapterId === "reference-doc" && !hl.pageNumber && currentPdfPage) {
        updateHighlight(hl.id, { pageNumber: currentPdfPage });
      }

      if (hl.chapterId === "reference-doc" && hl.pageNumber) {
        goToPdfPage(hl.pageNumber);
      } else {
        const idx = chapters.findIndex((chapter) => chapter.id === hl.chapterId);
        if (idx >= 0) {
          goToChapter(idx);
        }
      }
      focusHighlight(hl.id);
    },
    [highlights, currentPdfPage, goToPdfPage, chapters, goToChapter, focusHighlight, updateHighlight]
  );

  const addGeneralNote = useCallback(
    (title: string, content: string) => {
      const now = Date.now();
      markAsUnsaved();
      const newNote: GeneralNote = {
        id: now.toString(),
        title: title || "Untitled Note",
        content,
        chapterId: currentChapter.id,
        chapterTitle: currentChapter.title,
        created_at: now,
        updated_at: now,
        deleted: false,
      };
      setGeneralNotes((prev) => [newNote, ...prev]);
    },
    [currentChapter.id, currentChapter.title, markAsUnsaved]
  );

  const updateGeneralNote = useCallback(
    (id: string, title: string, content: string) => {
      const now = Date.now();
      markAsUnsaved();
      setGeneralNotes((prev) =>
        prev.map((note) =>
          note.id === id ? { ...note, title, content, updated_at: now } : note
        )
      );
    },
    [markAsUnsaved]
  );

  const removeGeneralNote = useCallback(
    (id: string) => {
      markAsUnsaved();
      setGeneralNotes((prev) =>
        prev.map((note) => (note.id === id ? { ...note, deleted: true } : note))
      );
    },
    [markAsUnsaved]
  );

  const addStroke = useCallback(
    (stroke: Stroke) => {
      const now = Date.now();
      markAsUnsaved();
      setStrokes((prev) => [
        ...prev,
        {
          ...stroke,
          created_at: stroke.created_at ?? now,
          updated_at: now,
          deleted: stroke.deleted ?? false,
          syncStatus: "pending",
        },
      ]);
    },
    [markAsUnsaved]
  );

  const removeStroke = useCallback(
    (strokeId: string) => {
      const now = Date.now();
      markAsUnsaved();
      setStrokes((prev) =>
        prev.map((s) =>
          s.id === strokeId
            ? { ...s, deleted: true, updated_at: now, syncStatus: "pending" }
            : s
        )
      );
    },
    [markAsUnsaved]
  );

  // 여러 스트로크를 한 번의 setStrokes 호출로 삭제 (지우개 성능 최적화)
  const removeStrokes = useCallback(
    (strokeIds: string[]) => {
      if (strokeIds.length === 0) return;
      const now = Date.now();
      const idSet = new Set(strokeIds);
      markAsUnsaved();
      setStrokes((prev) =>
        prev.map((s) =>
          idSet.has(s.id)
            ? { ...s, deleted: true, updated_at: now, syncStatus: "pending" }
            : s
        )
      );
    },
    [markAsUnsaved]
  );

  const importNotes = useCallback(
    async (file: File) => {
      const text = await file.text();
      const title = file.name.replace(".md", "").replace(".json", "");
      const content = text.replace(/\n/g, "<br>");
      addGeneralNote(title, content);
    },
    [addGeneralNote]
  );

  const exportNoteAsMarkdown = useCallback((note: GeneralNote) => {
    const markdown = note.content.replace(/<[^>]+>/g, "");
    const blob = new Blob([`# ${note.title}\n\n${markdown}`], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${note.title.replace(/\s+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const performAnnotationSearch = useCallback(
    (query: string): SearchResult[] => {
      if (!query || query.length < 2) return [];

      // 미리보기(endOfPages > 0)일 때만 페이지 범위 제한 적용
      const { isPreviewMode: _isPreviewMode, previewStartPage: _previewStart, previewEndPage: _previewEnd } = getPreviewConfig();

      const lowerQuery = query.toLowerCase();
      const results: SearchResult[] = [];

      highlights.forEach((hl) => {
        if (_isPreviewMode && hl.pageNumber != null && (hl.pageNumber < _previewStart || hl.pageNumber > _previewEnd)) return;
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

      return results;
    },
    [highlights, generalNotes]
  );

  const persistCurrentAnnotationToIndexedDb = useCallback(async () => {
    const storageKey = buildIndexedDbKey();
    // 항상 최신 snapshot을 IndexedDB에서 로드 (BookContext의 progress 업데이트 반영)
    const base = await loadSnapshot(storageKey);

    const savedAt = Date.now();
    const nextSnapshot: IndexedDbSnapshot = {
      key: storageKey,
      savedAt,
      schema_version: base?.schema_version || 1,
      data: {
        bookmarks: bookmarks.filter((item) => !item.deleted || item.syncStatus === "pending"),
        highlights: highlights.filter((item) => !item.deleted || item.syncStatus === "pending"),
        notes: generalNotes.filter((item) => !item.deleted || item.syncStatus === "pending"),
        strokes: strokes.filter((item) => !item.deleted || item.syncStatus === "pending"),
        // Progress는 BookContext에서 관리
        progress: base?.data?.progress,
      },
      meta: {
        ...(base?.meta || {}),
        bookTitle,
      },
    };
    const migrated = migrate_snapshot(nextSnapshot);
    const finalSnapshot = migrated.snapshot || nextSnapshot;
    try {
      await saveSnapshot(finalSnapshot);
    } catch (err) {
      if (err instanceof StorageQuotaExceededError) {
        // 저장은 실패했지만 ref는 현재 상태로 업데이트 (stale 방지)
        indexedDbSnapshotRef.current = finalSnapshot;
        throw err;
      }
      throw err;
    }
    indexedDbSnapshotRef.current = finalSnapshot;
    return finalSnapshot;
  }, [buildIndexedDbKey, bookmarks, highlights, generalNotes, strokes, bookTitle, loadSnapshot, saveSnapshot]);

  const saveAnnotations = useCallback(async (source: "manual" | "auto" = "manual") => {
    let indexedDbQuotaExceeded = false;
    let currentSnapshot: IndexedDbSnapshot | undefined;

    try {
      setSyncStatus("SYNCING");
      setLastSaveSource(source);

      // IndexedDB 1차 저장 시도 (용량 초과 시 스킵하고 계속 진행)
      try {
        currentSnapshot = await persistCurrentAnnotationToIndexedDb();
      } catch (err) {
        if (err instanceof StorageQuotaExceededError) {
          indexedDbQuotaExceeded = true;
          console.warn("[Storage] Quota exceeded. Skipping IndexedDB save.");
        } else {
          throw err;
        }
      }

      if (!navigator.onLine) {
        if (indexedDbQuotaExceeded) {
          // 오프라인 + 용량 초과: 어디에도 저장 안 된 상태 → UI 힌트로 표시
          setStorageQuotaExceeded(true);
          setSyncStatus("UNSAVED");
        } else {
          setSyncStatus("LOCAL_ONLY");
        }
        setLastSavedAt(formatSavedAt(new Date()));
        return;
      }

      const config = getRmsConfig();
      let updatedHighlights = highlights;
      let updatedBookmarks = bookmarks;
      let updatedNotes = generalNotes;
      let updatedStrokes = strokes;

      if (config) {
        const changedHighlights = highlights.filter(
          (item) => item.syncStatus === "pending"
        );
        const changedBookmarks = bookmarks.filter(
          (item) => item.syncStatus === "pending"
        );
        const changedStrokes = strokes.filter(
          (item) => item.syncStatus !== "synced"
        );

        if (changedHighlights.length > 0) {
          await saveHighlightsToServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
            highlights: changedHighlights,
          });
          updatedHighlights = highlights
            .map((item) =>
              item.syncStatus === "pending"
                ? { ...item, syncStatus: "synced" as const }
                : item
            )
            .filter((item) => !item.deleted);
          setHighlights(updatedHighlights);
        }

        if (changedBookmarks.length > 0) {
          await saveBookmarksToServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
            bookmarks: changedBookmarks,
          });
          updatedBookmarks = bookmarks
            .map((item) =>
              item.syncStatus === "pending"
                ? { ...item, syncStatus: "synced" as const }
                : item
            )
            .filter((item) => !item.deleted);
          setBookmarks(updatedBookmarks);
        }

        if (generalNotes.length > 0) {
          await saveNotesToServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
            notes: generalNotes,
          });
          updatedNotes = generalNotes.filter((item) => !item.deleted);
          setGeneralNotes(updatedNotes);
        }

        if (changedStrokes.length > 0) {
          await saveDrawingsToServer({
            apiBase: config.apiBase,
            bookCd: config.bookCd,
            drawings: changedStrokes,
          });
          updatedStrokes = strokes
            .map((item) =>
              item.syncStatus !== "synced"
                ? { ...item, syncStatus: "synced" as const }
                : item
            )
            .filter((item) => !item.deleted);
          setStrokes(updatedStrokes);
        }
      }

      // IndexedDB 2차 저장 (용량 초과 시 스킵)
      if (!indexedDbQuotaExceeded && currentSnapshot) {
        const postSyncSnapshot: IndexedDbSnapshot = {
          ...currentSnapshot,
          savedAt: Date.now(),
          data: {
            ...currentSnapshot.data,
            bookmarks: updatedBookmarks,
            highlights: updatedHighlights,
            notes: updatedNotes,
            strokes: updatedStrokes,
            // Progress는 BookContext에서 관리
            progress: currentSnapshot.data.progress,
          },
        };
        await saveSnapshot(postSyncSnapshot);
        indexedDbSnapshotRef.current = postSyncSnapshot;
      }

      // 로컬 저장 성공 여부에 따라 상태 분기
      setSyncStatus(indexedDbQuotaExceeded ? "SERVER_ONLY" : "SAVED");
      setStorageQuotaExceeded(false); // 서버 저장 성공 → 공간 부족 경고 해제
      setLastSavedAt(formatSavedAt(new Date()));
    } catch (err) {
      console.error("saveAnnotations failed", err);
      setSyncStatus("LOCAL_ONLY");
      setLastSavedAt(formatSavedAt(new Date()));
    }
  }, [persistCurrentAnnotationToIndexedDb, highlights, bookmarks, generalNotes, strokes, saveSnapshot]);

  // 기기(IndexedDB)에만 저장 — 서버 저장 없음, 5초 debounce 자동저장용
  // 성공해도 syncStatus는 UNSAVED 유지 (UI 변화 없음), 용량 초과 시에만 상태 표시
  const saveLocalOnly = useCallback(async () => {
    try {
      await persistCurrentAnnotationToIndexedDb();
      setStorageQuotaExceeded(false); // 이전에 공간 부족이었다면 해제
      // syncStatus는 변경하지 않음 → "저장 필요" 표시 유지
    } catch (err) {
      if (err instanceof StorageQuotaExceededError && !navigator.onLine) {
        // 오프라인 + 공간 부족 → 어디에도 저장 안 됨, 사용자에게 알림
        setStorageQuotaExceeded(true);
      } else {
        console.error("saveLocalOnly failed", err);
      }
    }
  }, [persistCurrentAnnotationToIndexedDb]);

  const loadAnnotationFromIndexedDb = useCallback(
    async (storageKey: string) => {
      try {
        const config = getRmsConfig();
        let serverHighlights: Highlight[] = [];
        let serverBookmarks: PdfBookmark[] = [];
        let serverNotes: GeneralNote[] = [];
        let serverStrokes: Stroke[] = [];

        // 1. 서버에서 데이터 로드 (있으면)
        if (config) {
          try {
            const [highlightRes, bookmarkRes, noteRes, drawingRes] = await Promise.all([
              loadHighlightsFromServer({
                apiBase: config.apiBase,
                bookCd: config.bookCd,
              }),
              loadBookmarksFromServer({
                apiBase: config.apiBase,
                bookCd: config.bookCd,
              }),
              loadNotesFromServer({
                apiBase: config.apiBase,
                bookCd: config.bookCd,
              }),
              loadDrawingsFromServer({
                apiBase: config.apiBase,
                bookCd: config.bookCd,
              }),
            ]);

            serverHighlights =
              highlightRes &&
              highlightRes.ok &&
              highlightRes.result &&
              Array.isArray(highlightRes.result.dataList)
                ? highlightRes.result.dataList
                    .map((json: string) => {
                      const parsed = JSON.parse(json);
                      return { ...parsed, syncStatus: "synced" as const };
                    })
                : [];

            serverBookmarks =
              bookmarkRes &&
              bookmarkRes.ok &&
              bookmarkRes.result &&
              Array.isArray(bookmarkRes.result.dataList)
                ? bookmarkRes.result.dataList
                    .map((json: string) => {
                      const parsed = JSON.parse(json);
                      return { ...parsed, syncStatus: "synced" as const };
                    })
                : [];

            serverNotes =
              noteRes &&
              noteRes.ok &&
              noteRes.result &&
              Array.isArray(noteRes.result.dataList)
                ? noteRes.result.dataList
                    .map((json: string) => {
                      const parsed = JSON.parse(json);
                      return parsed as GeneralNote;
                    })
                : [];

            serverStrokes =
              drawingRes &&
              drawingRes.ok &&
              drawingRes.result &&
              Array.isArray(drawingRes.result.dataList)
                ? parseServerStrokeDataList(drawingRes.result.dataList)
                : [];
          } catch (err) {
            console.error("annotation server load failed", err);
          }
        }

        // 2. Worker에서 병합 및 저장 (병합 로직이 worker에서 실행됨)
        const mergedSnapshot = await mergeAndSaveInWorker(storageKey, {
          highlights: serverHighlights,
          bookmarks: serverBookmarks,
          notes: serverNotes,
          strokes: serverStrokes,
        });

        if (!mergedSnapshot) {
          console.error("Worker merge failed, using empty state");
          setHighlights([]);
          setBookmarks([]);
          setGeneralNotes([]);
          setStrokes([]);
          setSyncStatus("SAVED");
          return;
        }

        const data = mergedSnapshot.data || {};
        let finalHighlights = Array.isArray(data.highlights) ? (data.highlights as Highlight[]) : [];
        let finalBookmarks = Array.isArray(data.bookmarks) ? (data.bookmarks as PdfBookmark[]) : [];
        let finalNotes = Array.isArray(data.notes) ? (data.notes as GeneralNote[]) : [];
        let finalStrokes = Array.isArray(data.strokes) ? (data.strokes as Stroke[]) : [];
        finalStrokes = finalStrokes.map((item) =>
          item.syncStatus === "synced"
            ? normalizeStrokeSyncFields(item, "synced")
            : normalizeStrokeSyncFields(item, "pending")
        );

        // 3. pending 항목이 있으면 서버 동기화
        const hasPendingStrokes = finalStrokes.some(
          (item) => item.syncStatus !== "synced"
        );
        const hasPending =
          finalHighlights.some((item) => item.syncStatus === "pending") ||
          finalBookmarks.some((item) => item.syncStatus === "pending") ||
          hasPendingStrokes;

        let finalSyncStatus: SyncStatus = !hasPending
          ? "SAVED"
          : !navigator.onLine
          ? "LOCAL_ONLY"  // 오프라인 + pending → 온라인 복귀 시 handleOnline이 트리거 가능
          : "UNSAVED";    // 온라인 + pending → 직후 아래 블록에서 즉시 동기화 시도

        if (hasPending && navigator.onLine && config) {
          try {
            const changedHighlights = finalHighlights.filter(
              (item) => item.syncStatus === "pending"
            );
            const changedBookmarks = finalBookmarks.filter(
              (item) => item.syncStatus === "pending"
            );
            const changedStrokes = finalStrokes.filter(
              (item) => item.syncStatus !== "synced"
            );

            if (changedHighlights.length > 0) {
              await saveHighlightsToServer({
                apiBase: config.apiBase,
                bookCd: config.bookCd,
                highlights: changedHighlights,
              });
              finalHighlights = finalHighlights
                .map((item) =>
                  item.syncStatus === "pending"
                    ? { ...item, syncStatus: "synced" as const }
                    : item
                )
                .filter((item) => !item.deleted);
            }

            if (changedBookmarks.length > 0) {
              await saveBookmarksToServer({
                apiBase: config.apiBase,
                bookCd: config.bookCd,
                bookmarks: changedBookmarks,
              });
              finalBookmarks = finalBookmarks
                .map((item) =>
                  item.syncStatus === "pending"
                    ? { ...item, syncStatus: "synced" as const }
                    : item
                )
                .filter((item) => !item.deleted);
            }

            if (changedStrokes.length > 0) {
              await saveDrawingsToServer({
                apiBase: config.apiBase,
                bookCd: config.bookCd,
                drawings: changedStrokes,
              });
              finalStrokes = finalStrokes
                .map((item) =>
                  item.syncStatus !== "synced"
                    ? { ...item, syncStatus: "synced" as const }
                    : item
                )
                .filter((item) => !item.deleted);
            }

            finalSyncStatus = "SAVED";
          } catch (err) {
            console.error("Auto-sync on initial load failed", err);
            finalSyncStatus = "UNSAVED";
          }
        }

        // 4. State 업데이트 (deleted 항목 최종 제거 - 병합 후 기기간 삭제 동기화 반영)
        finalHighlights = finalHighlights.filter((item) => !item.deleted);
        finalBookmarks = finalBookmarks.filter((item) => !item.deleted);
        finalNotes = finalNotes.filter((item) => !item.deleted);
        finalStrokes = finalStrokes.filter((item) => !item.deleted);
        setHighlights(finalHighlights);
        setBookmarks(finalBookmarks);
        setGeneralNotes(finalNotes);
        setStrokes(finalStrokes);
        setSyncStatus(finalSyncStatus);

        // deleted 항목이 제거된 clean snapshot을 IndexedDB에 재저장
        const cleanSnapshot: IndexedDbSnapshot = {
          ...mergedSnapshot,
          savedAt: Date.now(),
          data: {
            ...mergedSnapshot.data,
            highlights: finalHighlights,
            bookmarks: finalBookmarks,
            notes: finalNotes,
            strokes: finalStrokes,
          },
        };
        try {
          await saveSnapshot(cleanSnapshot);
        } catch {
          // clean snapshot 저장 실패해도 state는 이미 정상 반영됨
        }
        indexedDbSnapshotRef.current = cleanSnapshot;
      } catch (err) {
        console.error("annotation indexeddb load failed", err);
      }
    },
    [mergeAndSaveInWorker]
  );

  useEffect(() => {
    const { isPreview } = getPreviewConfig();
    if (isPreview) return;
    const storageKey = buildIndexedDbKey();
    if (!storageKey) return;
    if (indexedDbLoadKeyRef.current === storageKey) return;
    indexedDbLoadKeyRef.current = storageKey;
    loadAnnotationFromIndexedDb(storageKey);
  }, [buildIndexedDbKey, loadAnnotationFromIndexedDb]);

  // 현재 데이터의 fingerprint 생성 (변경 감지용)
  // text/content 같은 큰 필드는 제외하고 updated_at + length만 비교 (메모리 최적화)
  const buildDataFingerprint = useCallback(() => {
    const bm = bookmarks.map(b => b.updated_at).join(",");
    const hl = highlights.map(h => h.updated_at).join(",");
    const nt = generalNotes.map(n => n.updated_at).join(",");
    const st = strokes.map(s => s.updated_at).join(",");
    return `${bookmarks.length}:${bm}|${highlights.length}:${hl}|${generalNotes.length}:${nt}|${strokes.length}:${st}`;
  }, [bookmarks, highlights, generalNotes, strokes]);

  // 수동/자동 저장 시에도 fingerprint 갱신
  useEffect(() => {
    if (syncStatus === "SAVED" || syncStatus === "LOCAL_ONLY") {
      lastSavedDataRef.current = buildDataFingerprint();
    }
  }, [syncStatus, buildDataFingerprint]);

  useEffect(() => {
    const handleOnline = () => {
      if (syncStatus === "LOCAL_ONLY") {
        saveAnnotations();
      }
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [syncStatus, saveAnnotations]);

  const value = useMemo(
    () => ({
      bookmarks: bookmarks.filter((item: PdfBookmark) => !item.deleted),
      highlights: highlights.filter((item: Highlight) => !item.deleted),
      generalNotes: generalNotes.filter((item: GeneralNote) => !item.deleted),
      strokes: strokes.filter((item: Stroke) => !item.deleted),
      activeHighlightId,
      pendingHighlightEditId,
      showAnnotations,
      syncStatus,
      lastSavedAt,
      lastSaveSource,
      storageQuotaExceeded,
      toggleAnnotations: () => setShowAnnotations((prev) => !prev),
      addPdfBookmark,
      removePdfBookmark,
      addHighlight,
      updateHighlight,
      removeHighlight,
      focusHighlight,
      goToHighlight,
      requestHighlightNoteEdit,
      clearHighlightNoteEditRequest,
      addGeneralNote,
      updateGeneralNote,
      removeGeneralNote,
      importNotes,
      exportNoteAsMarkdown,
      performAnnotationSearch,
      addStroke,
      removeStroke,
      removeStrokes,
      unsavedChangeCount,
      saveAnnotations,
      saveLocalOnly,
      getDataFingerprint: buildDataFingerprint,
      getLastSavedFingerprint: () => lastSavedDataRef.current,
    }),
    [
      bookmarks,
      highlights,
      generalNotes,
      strokes,
      activeHighlightId,
      pendingHighlightEditId,
      showAnnotations,
      syncStatus,
      lastSavedAt,
      lastSaveSource,
      storageQuotaExceeded,
      addPdfBookmark,
      removePdfBookmark,
      addHighlight,
      updateHighlight,
      removeHighlight,
      focusHighlight,
      goToHighlight,
      requestHighlightNoteEdit,
      clearHighlightNoteEditRequest,
      addGeneralNote,
      updateGeneralNote,
      removeGeneralNote,
      importNotes,
      exportNoteAsMarkdown,
      performAnnotationSearch,
      addStroke,
      removeStroke,
      removeStrokes,
      unsavedChangeCount,
      saveAnnotations,
      saveLocalOnly,
      buildDataFingerprint,
    ]
  );

  return (
    <AnnotationContext.Provider value={value}>{children}</AnnotationContext.Provider>
  );
};

export const useAnnotation = (): AnnotationContextType => {
  const context = useContext(AnnotationContext);
  if (!context) {
    throw new Error("useAnnotation must be used within AnnotationProvider");
  }
  return context;
};
