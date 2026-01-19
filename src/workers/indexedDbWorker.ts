const DB_NAME = "campusbook_viewer";
const DB_VERSION = 2;
const STORE_NAME = "viewer_bundle";

type SaveBundlePayload = {
  storageKey: string;
  data: {
    bookmarks: unknown[];
    highlights: unknown[];
    notes: unknown[];
    strokes: Record<string, unknown[]>;
    progress: {
      currentPdfPage: number;
      viewMode: string;
      pdfTotalPages: number;
      updatedAt: number;
    };
  };
  meta?: {
    bookTitle?: string;
  };
};

type LoadBundlePayload = {
  storageKey: string;
};

type StoredBundle = {
  key: string;
  savedAt: number;
  data: SaveBundlePayload["data"];
  meta?: SaveBundlePayload["meta"];
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
      store.put({
        key: payload.storageKey,
        savedAt: Date.now(),
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

self.addEventListener("message", async (event) => {
  const message = event.data as {
    type?: string;
    requestId?: string;
    payload?: SaveBundlePayload | LoadBundlePayload;
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
});

export {};
