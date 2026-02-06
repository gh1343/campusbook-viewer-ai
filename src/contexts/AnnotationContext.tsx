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
  SyncStatus,
} from "../../types";
import { useBook } from "./BookContext";
import { usePdfViewer } from "./PdfViewerContext";
import {
  getRmsConfig,
  loadBookmarksFromServer,
  loadHighlightsFromServer,
  loadNotesFromServer,
  migrate_snapshot,
  saveBookmarksToServer,
  saveHighlightsToServer,
  saveNotesToServer,
} from "../services/rmsService";
import type { IndexedDbSnapshot } from "../services/rmsService";

interface AnnotationContextType {
  bookmarks: PdfBookmark[];
  highlights: Highlight[];
  generalNotes: GeneralNote[];
  activeHighlightId: string | null;
  pendingHighlightEditId: string | null;
  showAnnotations: boolean;
  syncStatus: SyncStatus;
  lastSavedAt: string | null;
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
  saveAnnotations: () => Promise<void>;
}

const AnnotationContext = createContext<AnnotationContextType | undefined>(
  undefined
);

const getTimestamp = (item: Record<string, unknown>) => {
  const updated =
    typeof item.updated_at === "number" ? item.updated_at : Number(item.updated_at);
  const created =
    typeof item.created_at === "number" ? item.created_at : Number(item.created_at);
  if (Number.isFinite(updated)) return updated;
  if (Number.isFinite(created)) return created;
  return 0;
};

const mergeItemsByUpdatedAt = <T extends { id: string }>(
  serverItems: T[],
  localItems: T[]
) => {
  const serverMap = new Map(serverItems.map((item) => [item.id, item]));
  const localMap = new Map(localItems.map((item) => [item.id, item]));
  const merged: T[] = [];
  const allIds = new Set([...serverMap.keys(), ...localMap.keys()]);

  allIds.forEach((id) => {
    const serverItem = serverMap.get(id);
    const localItem = localMap.get(id);
    if (serverItem && localItem) {
      const serverTime = getTimestamp(serverItem as Record<string, unknown>);
      const localTime = getTimestamp(localItem as Record<string, unknown>);
      merged.push(localTime > serverTime ? localItem : serverItem);
      return;
    }
    if (localItem) {
      merged.push(localItem);
      return;
    }
    if (serverItem) {
      merged.push(serverItem);
    }
  });

  return merged;
};

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

export const AnnotationProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { chapters, currentChapter, goToChapter, bookTitle } = useBook();
  const { goToPdfPage, currentPdfPage } = usePdfViewer();

  const [bookmarks, setBookmarks] = useState<PdfBookmark[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [generalNotes, setGeneralNotes] = useState<GeneralNote[]>([]);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [pendingHighlightEditId, setPendingHighlightEditId] = useState<
    string | null
  >(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("SAVED");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const indexedDbWorkerRef = useRef<Worker | null>(null);
  const indexedDbLoadKeyRef = useRef<string | null>(null);
  const indexedDbSnapshotRef = useRef<IndexedDbSnapshot | null>(null);

  const getIndexedDbWorker = useCallback(() => {
    if (indexedDbWorkerRef.current) return indexedDbWorkerRef.current;
    if (typeof window === "undefined") return null;
    const worker = new Worker(
      new URL("../workers/indexedDbWorker.ts", import.meta.url),
      { type: "module" }
    );
    indexedDbWorkerRef.current = worker;
    return worker;
  }, []);

  const buildIndexedDbKey = useCallback(() => {
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
  }, [bookTitle]);

  const loadSnapshot = useCallback(
    async (storageKey: string) => {
      const worker = getIndexedDbWorker();
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
    [getIndexedDbWorker]
  );

  const saveSnapshot = useCallback(
    async (snapshot: IndexedDbSnapshot) => {
      const worker = getIndexedDbWorker();
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
    },
    [getIndexedDbWorker]
  );

  const markAsUnsaved = useCallback(() => {
    setSyncStatus("UNSAVED");
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
      const lowerQuery = query.toLowerCase();
      const results: SearchResult[] = [];

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

      return results;
    },
    [highlights, generalNotes]
  );

  const persistCurrentAnnotationToIndexedDb = useCallback(async () => {
    const storageKey = buildIndexedDbKey();
    const base =
      indexedDbSnapshotRef.current && indexedDbSnapshotRef.current.key === storageKey
        ? indexedDbSnapshotRef.current
        : await loadSnapshot(storageKey);

    const savedAt = Date.now();
    const nextSnapshot: IndexedDbSnapshot = {
      key: storageKey,
      savedAt,
      schema_version: base?.schema_version || 1,
      data: {
        bookmarks,
        highlights,
        notes: generalNotes,
        strokes: base?.data?.strokes || [],
        progress: base?.data?.progress,
      },
      meta: {
        ...(base?.meta || {}),
        bookTitle,
      },
    };
    const migrated = migrate_snapshot(nextSnapshot);
    const finalSnapshot = migrated.snapshot || nextSnapshot;
    await saveSnapshot(finalSnapshot);
    indexedDbSnapshotRef.current = finalSnapshot;
    return finalSnapshot;
  }, [buildIndexedDbKey, bookmarks, highlights, generalNotes, bookTitle, loadSnapshot, saveSnapshot]);

  const saveAnnotations = useCallback(async () => {
    try {
      setSyncStatus("SYNCING");
      const currentSnapshot = await persistCurrentAnnotationToIndexedDb();

      if (!navigator.onLine) {
        setSyncStatus("LOCAL_ONLY");
        setLastSavedAt(formatSavedAt(new Date()));
        return;
      }

      const config = getRmsConfig();
      let updatedHighlights = highlights;
      let updatedBookmarks = bookmarks;
      let updatedNotes = generalNotes;

      if (config) {
        const changedHighlights = highlights.filter(
          (item) => item.syncStatus === "pending"
        );
        const changedBookmarks = bookmarks.filter(
          (item) => item.syncStatus === "pending"
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
      }

      const postSyncSnapshot: IndexedDbSnapshot = {
        ...currentSnapshot,
        savedAt: Date.now(),
        data: {
          ...currentSnapshot.data,
          bookmarks: updatedBookmarks,
          highlights: updatedHighlights,
          notes: updatedNotes,
        },
      };
      await saveSnapshot(postSyncSnapshot);
      indexedDbSnapshotRef.current = postSyncSnapshot;
      setSyncStatus("SAVED");
      setLastSavedAt(formatSavedAt(new Date()));
    } catch (err) {
      console.error("saveAnnotations failed", err);
      setSyncStatus("LOCAL_ONLY");
      setLastSavedAt(formatSavedAt(new Date()));
    }
  }, [persistCurrentAnnotationToIndexedDb, highlights, bookmarks, generalNotes, saveSnapshot]);

  const loadAnnotationFromIndexedDb = useCallback(
    async (storageKey: string) => {
      try {
        let snapshot = await loadSnapshot(storageKey);
        if (snapshot) {
          const migrated = migrate_snapshot(snapshot);
          snapshot = migrated.snapshot || snapshot;
          if (migrated.changed) {
            await saveSnapshot(snapshot);
          }
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
        }

        const data = snapshot.data || {};
        const localHighlights = Array.isArray(data.highlights)
          ? (data.highlights as Highlight[])
          : [];
        const localBookmarks = Array.isArray(data.bookmarks)
          ? (data.bookmarks as PdfBookmark[])
          : [];
        const localNotes = Array.isArray(data.notes)
          ? (data.notes as GeneralNote[])
          : [];

        const config = getRmsConfig();
        let mergedHighlights = localHighlights;
        let mergedBookmarks = localBookmarks;
        let mergedNotes = localNotes;

        if (config) {
          try {
            const [highlightRes, bookmarkRes, noteRes] = await Promise.all([
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
            ]);

            const serverHighlights =
              highlightRes &&
              highlightRes.ok &&
              highlightRes.result &&
              Array.isArray(highlightRes.result.dataList)
                ? highlightRes.result.dataList
                    .map((json: string) => {
                      const parsed = JSON.parse(json);
                      return { ...parsed, syncStatus: "synced" as const };
                    })
                    .filter((item: Highlight) => !item.deleted)
                : [];

            const serverBookmarks =
              bookmarkRes &&
              bookmarkRes.ok &&
              bookmarkRes.result &&
              Array.isArray(bookmarkRes.result.dataList)
                ? bookmarkRes.result.dataList
                    .map((json: string) => {
                      const parsed = JSON.parse(json);
                      return { ...parsed, syncStatus: "synced" as const };
                    })
                    .filter((item: PdfBookmark) => !item.deleted)
                : [];

            const serverNotes =
              noteRes &&
              noteRes.ok &&
              noteRes.result &&
              Array.isArray(noteRes.result.dataList) &&
              noteRes.result.dataList.length > 0
                ? (JSON.parse(noteRes.result.dataList[0]) as GeneralNote[]).filter(
                    (item) => !item.deleted
                  )
                : [];

            if (serverHighlights.length > 0) {
              mergedHighlights = mergeItemsByUpdatedAt(
                serverHighlights,
                localHighlights
              );
            }
            if (serverBookmarks.length > 0) {
              mergedBookmarks = mergeItemsByUpdatedAt(
                serverBookmarks,
                localBookmarks
              );
            }
            if (serverNotes.length > 0) {
              mergedNotes = mergeItemsByUpdatedAt(serverNotes, localNotes);
            }
          } catch (err) {
            console.error("annotation server load failed", err);
          }
        }

        const hasPending =
          mergedHighlights.some((item) => item.syncStatus === "pending") ||
          mergedBookmarks.some((item) => item.syncStatus === "pending");

        // 초기 로드 시 pending 항목이 있고 온라인이면 자동 동기화 시도
        let finalHighlights = mergedHighlights;
        let finalBookmarks = mergedBookmarks;
        let finalNotes = mergedNotes;
        let finalSyncStatus: SyncStatus = hasPending ? "UNSAVED" : "SAVED";

        if (hasPending && navigator.onLine && config) {
          try {
            const changedHighlights = mergedHighlights.filter(
              (item) => item.syncStatus === "pending"
            );
            const changedBookmarks = mergedBookmarks.filter(
              (item) => item.syncStatus === "pending"
            );

            if (changedHighlights.length > 0) {
              await saveHighlightsToServer({
                apiBase: config.apiBase,
                bookCd: config.bookCd,
                highlights: changedHighlights,
              });
              finalHighlights = mergedHighlights
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
              finalBookmarks = mergedBookmarks
                .map((item) =>
                  item.syncStatus === "pending"
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

        setHighlights(finalHighlights);
        setBookmarks(finalBookmarks);
        setGeneralNotes(finalNotes);
        setSyncStatus(finalSyncStatus);

        const mergedSnapshot: IndexedDbSnapshot = {
          ...snapshot,
          savedAt: Date.now(),
          data: {
            ...snapshot.data,
            highlights: finalHighlights,
            bookmarks: finalBookmarks,
            notes: finalNotes,
          },
        };
        await saveSnapshot(mergedSnapshot);
        indexedDbSnapshotRef.current = mergedSnapshot;
      } catch (err) {
        console.error("annotation indexeddb load failed", err);
      }
    },
    [loadSnapshot, saveSnapshot]
  );

  useEffect(() => {
    const storageKey = buildIndexedDbKey();
    if (!storageKey) return;
    if (indexedDbLoadKeyRef.current === storageKey) return;
    indexedDbLoadKeyRef.current = storageKey;
    loadAnnotationFromIndexedDb(storageKey);
  }, [buildIndexedDbKey, loadAnnotationFromIndexedDb]);

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

  useEffect(() => {
    return () => {
      if (indexedDbWorkerRef.current) {
        indexedDbWorkerRef.current.terminate();
        indexedDbWorkerRef.current = null;
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      bookmarks,
      highlights,
      generalNotes,
      activeHighlightId,
      pendingHighlightEditId,
      showAnnotations,
      syncStatus,
      lastSavedAt,
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
      saveAnnotations,
    }),
    [
      bookmarks,
      highlights,
      generalNotes,
      activeHighlightId,
      pendingHighlightEditId,
      showAnnotations,
      syncStatus,
      lastSavedAt,
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
      saveAnnotations,
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
