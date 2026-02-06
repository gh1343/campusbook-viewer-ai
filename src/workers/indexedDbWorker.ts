const DB_NAME = "campusbook_viewer";
const DB_VERSION = 2;
const STORE_NAME = "viewer_bundle";

type SaveBundlePayload = {
  storageKey: string;
  schema_version?: number;
  savedAt?: number;
  data: {
    bookmarks: unknown[];
    highlights: unknown[];
    notes: unknown[];
    strokes: unknown[];
    progress?: {
      currentPdfPage: number;
      viewMode: string;
      pdfTotalPages: number;
      updatedAt: number;
      furthestPage?: number;
      lastReadPage?: number;
    };
  };
  meta?: {
    bookTitle?: string;
  };
};

type LoadBundlePayload = {
  storageKey: string;
};

type MergeAndSavePayload = {
  storageKey: string;
  serverData: {
    highlights: unknown[];
    bookmarks: unknown[];
    notes: unknown[];
    strokes: unknown[];
  };
  currentPdfPage?: number;
  viewMode?: string;
  pdfTotalPages?: number;
  bookTitle?: string;
};

type StoredBundle = {
  key: string;
  savedAt: number;
  schema_version?: number;
  data: SaveBundlePayload["data"];
  meta?: SaveBundlePayload["meta"];
};

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

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const saveBundle = async (payload: SaveBundlePayload) => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const savedAt =
        typeof payload.savedAt === "number" && Number.isFinite(payload.savedAt)
          ? payload.savedAt
          : Date.now();
      const schema_version =
        typeof payload.schema_version === "number" &&
        Number.isFinite(payload.schema_version)
          ? payload.schema_version
          : 1;
      store.put({
        key: payload.storageKey,
        savedAt,
        schema_version,
        data: payload.data,
        meta: payload.meta || {},
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

const loadBundle = async (payload: LoadBundlePayload) => {
  const db = await openDb();
  try {
    return await new Promise<StoredBundle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(payload.storageKey);
      request.onsuccess = () => {
        resolve((request.result as StoredBundle | undefined) || null);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

const mergeAndSave = async (payload: MergeAndSavePayload) => {
  // 1. Load local data
  const localSnapshot = await loadBundle({ storageKey: payload.storageKey });

  const localData = localSnapshot?.data || {
    bookmarks: [],
    highlights: [],
    notes: [],
    strokes: [],
  };

  const localHighlights = Array.isArray(localData.highlights) ? localData.highlights : [];
  const localBookmarks = Array.isArray(localData.bookmarks) ? localData.bookmarks : [];
  const localNotes = Array.isArray(localData.notes) ? localData.notes : [];
  const localStrokes = Array.isArray(localData.strokes) ? localData.strokes : [];

  // 2. Merge with server data
  const mergedHighlights = payload.serverData.highlights.length > 0
    ? mergeItemsByUpdatedAt(
        payload.serverData.highlights as Array<{ id: string }>,
        localHighlights as Array<{ id: string }>
      )
    : localHighlights;

  const mergedBookmarks = payload.serverData.bookmarks.length > 0
    ? mergeItemsByUpdatedAt(
        payload.serverData.bookmarks as Array<{ id: string }>,
        localBookmarks as Array<{ id: string }>
      )
    : localBookmarks;

  const mergedNotes = payload.serverData.notes.length > 0
    ? mergeItemsByUpdatedAt(
        payload.serverData.notes as Array<{ id: string }>,
        localNotes as Array<{ id: string }>
      )
    : localNotes;

  const mergedStrokes = payload.serverData.strokes && payload.serverData.strokes.length > 0
    ? mergeItemsByUpdatedAt(
        payload.serverData.strokes as Array<{ id: string }>,
        localStrokes as Array<{ id: string }>
      )
    : localStrokes;

  // 3. Prepare merged snapshot
  const savedAt = Date.now();
  const mergedSnapshot: StoredBundle = {
    key: payload.storageKey,
    savedAt,
    schema_version: localSnapshot?.schema_version || 1,
    data: {
      highlights: mergedHighlights,
      bookmarks: mergedBookmarks,
      notes: mergedNotes,
      strokes: mergedStrokes,
      progress:
        typeof payload.currentPdfPage === 'number' &&
        typeof payload.pdfTotalPages === 'number'
          ? {
              currentPdfPage: payload.currentPdfPage,
              viewMode: payload.viewMode || 'single',
              pdfTotalPages: payload.pdfTotalPages,
              updatedAt: savedAt,
            }
          : localData.progress,
    },
    meta: {
      ...(localSnapshot?.meta || {}),
      bookTitle: payload.bookTitle,
    },
  };

  // 4. Save merged data
  await saveBundle({
    storageKey: mergedSnapshot.key,
    savedAt: mergedSnapshot.savedAt,
    schema_version: mergedSnapshot.schema_version,
    data: mergedSnapshot.data,
    meta: mergedSnapshot.meta,
  });

  return mergedSnapshot;
};

self.addEventListener("message", async (event) => {
  const message = event.data as {
    type?: string;
    requestId?: string;
    payload?: SaveBundlePayload | LoadBundlePayload | MergeAndSavePayload;
  };
  if (!message) return;
  if (message.type === "save_bundle") {
    try {
      if (!message.payload) {
        throw new Error("Missing payload.");
      }
      await saveBundle(message.payload as SaveBundlePayload);
      self.postMessage({ type: "save_complete", requestId: message.requestId });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      self.postMessage({
        type: "save_error",
        requestId: message.requestId,
        error: messageText,
      });
    }
  }
  if (message.type === "load_bundle") {
    try {
      if (!message.payload) {
        throw new Error("Missing payload.");
      }
      const result = await loadBundle(message.payload as LoadBundlePayload);
      self.postMessage({
        type: "load_complete",
        requestId: message.requestId,
        payload: result,
      });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      self.postMessage({
        type: "load_error",
        requestId: message.requestId,
        error: messageText,
      });
    }
  }
  if (message.type === "merge_and_save") {
    try {
      if (!message.payload) {
        throw new Error("Missing payload.");
      }
      const result = await mergeAndSave(message.payload as MergeAndSavePayload);
      self.postMessage({
        type: "merge_complete",
        requestId: message.requestId,
        payload: result,
      });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      self.postMessage({
        type: "merge_error",
        requestId: message.requestId,
        error: messageText,
      });
    }
  }
});

export {};
