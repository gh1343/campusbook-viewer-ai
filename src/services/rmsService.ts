type RmsStatus = {
  RMS_BM: boolean;
  RMS_DR: boolean;
  RMS_LK: boolean;
  RMS_PR: boolean;
  RMS_MM: boolean;
};

type RmsVerItem = {
  rmsTp: string;
  rmsTs: number;
};

type ProgressEntry = {
  idx: number;
  level: number;
  regdate: string;
  timestamp: number;
  mode: string;
};

export type IndexedDbBundlePayload = {
  storageKey: string;
  schema_version?: number;
  savedAt?: number;
  data: {
    bookmarks?: unknown[];
    highlights?: unknown[];
    notes?: unknown[];
    strokes?: unknown[];
    progress?: {
      currentPdfPage?: number;
      viewMode?: string;
      pdfTotalPages?: number;
      updatedAt?: number;
      furthestPage?: number;
      lastReadPage?: number;
    };
  };
  meta?: {
    bookTitle?: string;
  };
};

export type IndexedDbSnapshot = {
  key: string;
  savedAt: number;
  schema_version?: number;
  data: IndexedDbBundlePayload["data"];
  meta?: IndexedDbBundlePayload["meta"];
};

export type SyncSnapshotPayload = {
  user_id: string;
  book_id: string;
  device_id: string;
  schema_version: number;
  app_version: string;
  snapshot_updated_at: number;
  storageKey: string;
  data: IndexedDbBundlePayload["data"];
  meta?: IndexedDbBundlePayload["meta"];
};

export type RmsConfig = {
  apiBase: string;
  bookCd: string;
  memberCd: string;
  orderIgnore: boolean;
  pageOffset: number;
};

const DEFAULT_RMS_STATUS: RmsStatus = {
  RMS_BM: false,
  RMS_DR: false,
  RMS_LK: false,
  RMS_PR: false,
  RMS_MM: false,
};

const DEFAULT_RMS_VER_LIST: RmsVerItem[] = [
  { rmsTp: "RMS_BM", rmsTs: 0 },
  { rmsTp: "RMS_DR", rmsTs: 0 },
  { rmsTp: "RMS_LK", rmsTs: 0 },
  { rmsTp: "RMS_PR", rmsTs: 0 },
  { rmsTp: "RMS_MM", rmsTs: 0 },
  { rmsTp: "RMS_ST", rmsTs: 0 },
];

const DEVICE_ID_KEY = "device_id";
const SYNC_SCHEMA_VERSION = 1;
const DEFAULT_APP_VERSION = "0.0.0";
let cached_device_id: string | null = null;

const readJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    return fallback;
  }
};

const pad2 = (value: number) => value.toString().padStart(2, "0");

const formatRegDate = (value: Date) =>
  `${pad2(value.getMonth() + 1)}/${pad2(value.getDate())}`;

const normalizeApiBase = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withoutTrailing = trimmed.replace(/\/+$/, "");
  return withoutTrailing.replace(/\/v2$/i, "");
};

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeMs = (value: unknown) => {
  const numeric = toNumber(value);
  return numeric && numeric > 0 ? numeric : null;
};

const normalizePage = (value: unknown) => {
  const numeric = toNumber(value);
  return numeric !== null ? Math.max(1, Math.round(numeric)) : null;
};

const parseIdTimestamp = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const generate_uuid = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const get_device_id = () => {
  if (cached_device_id) return cached_device_id;
  if (typeof window === "undefined") {
    cached_device_id = generate_uuid();
    return cached_device_id;
  }
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cached_device_id = stored;
      return stored;
    }
    const next = generate_uuid();
    localStorage.setItem(DEVICE_ID_KEY, next);
    cached_device_id = next;
    return next;
  } catch (err) {
    cached_device_id = generate_uuid();
    return cached_device_id;
  }
};

const normalize_item = (item: Record<string, unknown>, now: number) => {
  let changed = false;
  const currentUpdated = normalizeMs(item.updated_at);
  const currentCreated = normalizeMs(item.created_at);
  const fallbackUpdated =
    currentUpdated ??
    normalizeMs((item as { updatedAt?: unknown }).updatedAt) ??
    normalizeMs((item as { createdAt?: unknown }).createdAt) ??
    parseIdTimestamp(item.id) ??
    now;
  const fallbackCreated =
    currentCreated ??
    normalizeMs((item as { createdAt?: unknown }).createdAt) ??
    parseIdTimestamp(item.id) ??
    fallbackUpdated;
  const next = { ...item } as Record<string, unknown>;
  if (currentUpdated === null) {
    next.updated_at = fallbackUpdated;
    changed = true;
  }
  if (currentCreated === null) {
    next.created_at = fallbackCreated;
    changed = true;
  }
  if (typeof item.deleted !== "boolean") {
    next.deleted = false;
    changed = true;
  }
  return { item: changed ? next : item, changed };
};

const normalize_item_list = (items: unknown[] | undefined, now: number) => {
  if (!Array.isArray(items)) {
    return { items, changed: false };
  }
  let changed = false;
  const next = items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const normalized = normalize_item(item as Record<string, unknown>, now);
    if (normalized.changed) changed = true;
    return normalized.item;
  });
  return { items: changed ? next : items, changed };
};

const normalize_progress = (
  progress: IndexedDbBundlePayload["data"]["progress"],
  now: number
) => {
  if (!progress || typeof progress !== "object") {
    return { progress, changed: false };
  }
  let changed = false;
  const currentPage = normalizePage(progress.currentPdfPage);
  const existingFurthest = normalizePage(
    (progress as { furthestPage?: unknown }).furthestPage
  );
  let nextFurthest = existingFurthest;
  if (currentPage !== null) {
    nextFurthest =
      existingFurthest !== null
        ? Math.max(existingFurthest, currentPage)
        : currentPage;
  }

  const existingLastRead = normalizePage(
    (progress as { lastReadPage?: unknown }).lastReadPage
  );
  const next = { ...progress } as Record<string, unknown>;
  if (nextFurthest !== null && nextFurthest !== existingFurthest) {
    next.furthestPage = nextFurthest;
    changed = true;
  }
  if (currentPage !== null && currentPage !== existingLastRead) {
    next.lastReadPage = currentPage;
    changed = true;
  }
  if (normalizeMs(progress.updatedAt) === null) {
    next.updatedAt = now;
    changed = true;
  }
  return { progress: changed ? (next as typeof progress) : progress, changed };
};

const readRuntimeRmsConfig = () => {
  if (typeof window === "undefined") return null;
  const raw = (window as any).__RMS_CONFIG__;
  if (!raw || typeof raw !== "object") return null;
  return raw as {
    apiBase?: string;
    bookCd?: string;
    memberCd?: string;
    orderIgnore?: boolean | string | number;
    pageOffset?: number | string;
    authToken?: string;
    rmsAuthToken?: string;
  };
};

const parseOrderIgnoreValue = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    return (
      normalized === "Y" ||
      normalized === "YES" ||
      normalized === "TRUE" ||
      normalized === "1"
    );
  }
  return false;
};

const parsePageOffsetValue = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const parseBookCdFromPath = () => {
  if (typeof window === "undefined") return "";
  const match = window.location.pathname.match(
    /(?:^|\/)((?:BO|CT)(?:-[A-Za-z0-9]+)+)(?:\/|$)/
  );
  return match?.[1] || "";
};

const getRmsAuthToken = () => {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const runtime = readRuntimeRmsConfig();
  const runtimeToken =
    (typeof runtime?.authToken === "string" && runtime.authToken.trim()) ||
    (typeof runtime?.rmsAuthToken === "string" &&
      runtime.rmsAuthToken.trim()) ||
    "";
  const raw =
    params.get("rmsToken") ||
    params.get("rmsAuthToken") ||
    runtimeToken ||
    import.meta.env.VITE_RMS_AUTH_TOKEN ||
    sessionStorage.getItem("jwt") ||
    "";
  return raw.trim();
};

const buildRmsHeaders = () => {
  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }
  return headers;
};

const parseProgressEntries = (raw: unknown) => {
  if (Array.isArray(raw)) {
    return raw.filter(
      (entry) => entry && typeof entry === "object"
    ) as ProgressEntry[];
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = readJson<ProgressEntry[] | null>(raw, null);
    if (Array.isArray(parsed)) return parsed;
    try {
      if (typeof atob === "function") {
        const decoded = atob(raw);
        const decodedParsed = readJson<ProgressEntry[] | null>(decoded, null);
        return Array.isArray(decodedParsed) ? decodedParsed : null;
      }
    } catch (err) {
      return null;
    }
    return null;
  }
  return null;
};

const readProgressFromRmsItem = async (item: any) => {
  if (!item || typeof item !== "object") return null;
  const parsed = parseProgressEntries(item.rmsData);
  if (parsed && parsed.length > 0) return parsed;
  if (typeof item.webPath !== "string" || !item.webPath.trim()) return null;
  try {
    const cacheBusted = item.webPath.includes("?")
      ? `${item.webPath}&t=${Date.now()}`
      : `${item.webPath}?t=${Date.now()}`;
    const response = await fetch(cacheBusted);
    const text = await response.text();
    const next = parseProgressEntries(text);
    return next && next.length > 0 ? next : null;
  } catch (err) {
    return null;
  }
};

const readProgressFromLocalStorage = (localStoragePath: string) => {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(getProgressKey(localStoragePath));
  const parsed = parseProgressEntries(raw);
  return parsed && parsed.length > 0 ? parsed : null;
};

const detectLocalStorageContext = () => {
  if (typeof window === "undefined") return null;
  const prefixes = [
    "progress_",
    "rmsStatus_",
    "rmsVerList_",
    "bookmark_",
    "drawing_",
    "weblink_",
    "memo_",
  ];
  const key = Object.keys(localStorage).find((entry) =>
    prefixes.some((prefix) => entry.startsWith(prefix))
  );
  if (!key) return null;
  const suffix = prefixes.reduce(
    (value, prefix) =>
      value.startsWith(prefix) ? value.slice(prefix.length) : value,
    key
  );
  const [memberCd, ...bookParts] = suffix.split("_");
  if (!memberCd || bookParts.length === 0) return null;
  return { memberCd, bookCd: bookParts.join("_") };
};

const getLocalStoragePath = (bookCd: string, memberCd: string) =>
  `${memberCd}_${bookCd}`;

const getRmsStatusKey = (localStoragePath: string) =>
  `rmsStatus_${localStoragePath}`;
const getRmsVerListKey = (localStoragePath: string) =>
  `rmsVerList_${localStoragePath}`;
const getProgressKey = (localStoragePath: string) =>
  `progress_${localStoragePath}`;

const rmsStatusInitFalse = (localStoragePath: string) => {
  localStorage.setItem(
    getRmsStatusKey(localStoragePath),
    JSON.stringify(DEFAULT_RMS_STATUS)
  );
  return { ...DEFAULT_RMS_STATUS };
};

const ensureRmsStatus = (localStoragePath: string) => {
  const stored = readJson<Partial<RmsStatus> | null>(
    localStorage.getItem(getRmsStatusKey(localStoragePath)),
    null
  );
  const status = {
    ...DEFAULT_RMS_STATUS,
    ...(stored && typeof stored === "object" ? stored : {}),
  };
  localStorage.setItem(
    getRmsStatusKey(localStoragePath),
    JSON.stringify(status)
  );
  return status;
};

const ensureRmsVerList = (localStoragePath: string) => {
  const stored = readJson<RmsVerItem[] | null>(
    localStorage.getItem(getRmsVerListKey(localStoragePath)),
    null
  );
  const base = Array.isArray(stored) ? stored : [];
  const normalized = DEFAULT_RMS_VER_LIST.map((entry) => {
    const existing = base.find((item) => item?.rmsTp === entry.rmsTp);
    const rmsTs =
      existing && Number.isFinite(Number(existing.rmsTs))
        ? Number(existing.rmsTs)
        : entry.rmsTs;
    return { rmsTp: entry.rmsTp, rmsTs };
  });
  base.forEach((item) => {
    if (!item || typeof item.rmsTp !== "string") return;
    if (normalized.some((entry) => entry.rmsTp === item.rmsTp)) return;
    const rmsTs = Number.isFinite(Number(item.rmsTs)) ? Number(item.rmsTs) : 0;
    normalized.push({ rmsTp: item.rmsTp, rmsTs });
  });
  localStorage.setItem(
    getRmsVerListKey(localStoragePath),
    JSON.stringify(normalized)
  );
  return normalized;
};

const updateRmsVerList = (
  localStoragePath: string,
  rmsTp: string,
  rmsTs: number
) => {
  const rmsVerList = ensureRmsVerList(localStoragePath);
  const target = rmsVerList.find((item) => item.rmsTp === rmsTp);
  if (target) {
    target.rmsTs = rmsTs;
  } else {
    rmsVerList.push({ rmsTp, rmsTs });
  }
  localStorage.setItem(
    getRmsVerListKey(localStoragePath),
    JSON.stringify(rmsVerList)
  );
};

const addProgressEntry = ({
  localStoragePath,
  pageIndex,
  viewMode,
  level,
}: {
  localStoragePath: string;
  pageIndex: number;
  viewMode: string;
  level?: number;
}) => {
  const progressKey = getProgressKey(localStoragePath);
  const progressData = readJson<ProgressEntry[]>(
    localStorage.getItem(progressKey),
    []
  );
  const now = new Date();
  const entry: ProgressEntry = {
    idx: pageIndex,
    level: typeof level === "number" ? level : pageIndex,
    regdate: formatRegDate(now),
    timestamp: now.getTime(),
    mode: viewMode,
  };
  const next = [...progressData, entry];
  localStorage.setItem(progressKey, JSON.stringify(next));
  const status = ensureRmsStatus(localStoragePath);
  status.RMS_PR = true;
  localStorage.setItem(
    getRmsStatusKey(localStoragePath),
    JSON.stringify(status)
  );
  return next;
};

export const getRmsConfig = (): RmsConfig | null => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const runtime = readRuntimeRmsConfig();
  const localStorageContext = detectLocalStorageContext();
  const bookCdFromPath = parseBookCdFromPath();
  const runtimeApiBase =
    typeof runtime?.apiBase === "string" ? runtime.apiBase.trim() : "";
  const rawApiBase =
    params.get("rmsApiBase") ||
    runtimeApiBase ||
    import.meta.env.VITE_RMS_API_BASE ||
    "";
  const apiBase = normalizeApiBase(rawApiBase);
  const runtimeBookCd =
    typeof runtime?.bookCd === "string" ? runtime.bookCd.trim() : "";
  const bookCd =
    params.get("bookCd") ||
    runtimeBookCd ||
    import.meta.env.VITE_RMS_BOOK_CD ||
    bookCdFromPath ||
    localStorageContext?.bookCd ||
    "";
  const runtimeMemberCd =
    typeof runtime?.memberCd === "string" ? runtime.memberCd.trim() : "";
  const memberCd =
    params.get("memberCd") ||
    runtimeMemberCd ||
    import.meta.env.VITE_RMS_MEMBER_CD ||
    localStorageContext?.memberCd ||
    "guest";
  const orderIgnoreParam = params.get("orderIgnore");
  const orderIgnore =
    orderIgnoreParam != null && orderIgnoreParam !== ""
      ? parseOrderIgnoreValue(orderIgnoreParam)
      : typeof runtime?.orderIgnore !== "undefined"
      ? parseOrderIgnoreValue(runtime.orderIgnore)
      : parseOrderIgnoreValue(import.meta.env.VITE_RMS_ORDER_IGNORE || "");
  const pageOffsetParam = params.get("rmsPageOffset");
  const pageOffset =
    pageOffsetParam != null && pageOffsetParam !== ""
      ? parsePageOffsetValue(pageOffsetParam)
      : typeof runtime?.pageOffset !== "undefined"
      ? parsePageOffsetValue(runtime.pageOffset)
      : parsePageOffsetValue(import.meta.env.VITE_RMS_PAGE_OFFSET || "0");

  if (!apiBase || !bookCd) return null;
  return { apiBase, bookCd, memberCd, orderIgnore, pageOffset };
};

export const migrate_snapshot = (snapshot: IndexedDbSnapshot | null) => {
  if (!snapshot) return { snapshot: null, changed: false };
  const now = Date.now();
  let changed = false;
  const data = snapshot.data;
  const bookmarksState = normalize_item_list(data.bookmarks, now);
  const highlightsState = normalize_item_list(data.highlights, now);
  const notesState = normalize_item_list(data.notes, now);
  const progressState = normalize_progress(data.progress, now);

  let nextData = data;
  if (
    bookmarksState.changed ||
    highlightsState.changed ||
    notesState.changed ||
    progressState.changed
  ) {
    nextData = {
      ...data,
      bookmarks: bookmarksState.items,
      highlights: highlightsState.items,
      notes: notesState.items,
      progress: progressState.progress,
    };
    changed = true;
  }

  const parsedSchema = toNumber(snapshot.schema_version);
  let schema_version = snapshot.schema_version;
  if (parsedSchema === null || parsedSchema <= 0) {
    schema_version = SYNC_SCHEMA_VERSION;
    changed = true;
  } else if (schema_version !== parsedSchema) {
    schema_version = parsedSchema;
    changed = true;
  }

  if (!changed) {
    return { snapshot, changed };
  }
  return {
    snapshot: {
      ...snapshot,
      schema_version,
      data: nextData,
    },
    changed,
  };
};

export const build_sync_payload = (
  snapshot: IndexedDbSnapshot
): SyncSnapshotPayload => {
  const migrated = migrate_snapshot(snapshot);
  const source = migrated.snapshot || snapshot;
  const config = getRmsConfig();
  const user_id = config?.memberCd || "guest";
  const book_id =
    config?.bookCd || source.meta?.bookTitle || source.key || "unknown";
  const device_id = get_device_id();
  const schema_version = toNumber(source.schema_version) ?? SYNC_SCHEMA_VERSION;
  const app_version = String(
    import.meta.env.VITE_APP_VERSION || DEFAULT_APP_VERSION
  );
  const progressUpdatedAt = normalizeMs(source.data?.progress?.updatedAt) ?? 0;
  const savedAt = normalizeMs(source.savedAt) ?? 0;
  const snapshot_updated_at = Math.max(savedAt, progressUpdatedAt);

  const prefix_id = (items: unknown[] | undefined) => {
    if (!Array.isArray(items)) return items;
    return items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const rawId = (item as { id?: unknown }).id;
      const baseId = rawId !== null && rawId !== undefined ? String(rawId) : "";
      if (!baseId) return item;
      const nextId = device_id ? `${device_id}_${baseId}` : baseId;
      return { ...item, id: nextId };
    });
  };

  return {
    user_id,
    book_id,
    device_id,
    schema_version,
    app_version,
    snapshot_updated_at,
    storageKey: source.key,
    data: {
      ...source.data,
      bookmarks: prefix_id(source.data?.bookmarks),
      highlights: prefix_id(source.data?.highlights),
      notes: prefix_id(source.data?.notes),
    },
    meta: source.meta || {},
  };
};

export const sync_snapshot = async ({
  apiBase,
  snapshot,
  timeoutMs,
}: {
  apiBase: string;
  snapshot: IndexedDbSnapshot;
  timeoutMs?: number;
}) => {
  if (typeof window === "undefined") {
    throw new Error("Sync is only available in the browser.");
  }
  if (!apiBase) {
    throw new Error("Missing RMS configuration (apiBase).");
  }

  const payload = build_sync_payload(snapshot);
  const controller = new AbortController();
  const timeout = typeof timeoutMs === "number" ? timeoutMs : 2500;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${apiBase}/sync/snapshot`, {
      method: "POST",
      headers: buildRmsHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let result: any = null;
    try {
      result = await response.json();
    } catch (err) {
      result = null;
    }

    if (!response.ok) {
      const message =
        result?.message ||
        result?.error ||
        `Snapshot sync failed (${response.status})`;
      throw new Error(message);
    }

    return result;
  } finally {
    clearTimeout(timer);
  }
};

export const fetchRmsProgressPage = async ({
  apiBase,
  bookCd,
  memberCd,
  orderIgnore,
  pageOffset,
}: RmsConfig) => {
  if (typeof window === "undefined") return null;
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const localStoragePath = getLocalStoragePath(bookCd, memberCd);
  const rmsVerList = ensureRmsVerList(localStoragePath);
  const rmsListForRequest = rmsVerList;
  const reqData = {
    bookCd,
    orderIgnore,
    rmsList: rmsListForRequest,
  };
  const params = orderIgnore ? "?orderIgnore=Y" : "";
  const response = await fetch(`${apiBase}/v3/rms/rmsData${params}`, {
    method: "POST",
    headers: buildRmsHeaders(),
    body: JSON.stringify(reqData),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error ||
      `RMS fetch failed (${response.status})`;
    throw new Error(message);
  }

  const rmsList =
    payload?.result?.rmsList ||
    payload?.result?.rmsDataList ||
    (Array.isArray(payload?.result) ? payload.result : null);
  if (!Array.isArray(rmsList)) return null;

  const progressItem = rmsList.find((item: any) => item?.rmsTp === "RMS_PR");
  let progressData = await readProgressFromRmsItem(progressItem);
  if (!progressData || progressData.length === 0) {
    const statusItem = rmsList.find((item: any) => item?.rmsTp === "RMS_ST");
    const rawLastPages =
      typeof statusItem?.lastPages === "string"
        ? Number(statusItem.lastPages)
        : statusItem?.lastPages;
    if (Number.isFinite(rawLastPages)) {
      return Math.max(1, Math.round(rawLastPages - pageOffset));
    }
    progressData = readProgressFromLocalStorage(localStoragePath);
  }
  if (!progressData || progressData.length === 0) return null;

  localStorage.setItem(
    getProgressKey(localStoragePath),
    JSON.stringify(progressData)
  );

  const latest = progressData.reduce((best, entry) => {
    const bestTime = Number.isFinite(best.timestamp) ? best.timestamp : -1;
    const entryTime = Number.isFinite(entry.timestamp) ? entry.timestamp : -1;
    return entryTime > bestTime ? entry : best;
  }, progressData[0]);

  const rawIndex = Number.isFinite(latest.idx) ? latest.idx : latest.level;
  if (!Number.isFinite(rawIndex)) return null;
  return Math.max(1, Math.round(rawIndex - pageOffset));
};

export const loadLastProgressPageFromLocalStorage = ({
  bookCd,
  memberCd,
  pageOffset,
}: Pick<RmsConfig, "bookCd" | "memberCd" | "pageOffset">) => {
  if (typeof window === "undefined") return null;
  if (!bookCd || !memberCd) return null;

  const localStoragePath = getLocalStoragePath(bookCd, memberCd);
  const raw = localStorage.getItem(getProgressKey(localStoragePath));
  const parsed = parseProgressEntries(raw);
  if (!parsed || parsed.length === 0) return null;

  const last = parsed[parsed.length - 1];
  const rawIndex = Number.isFinite(last.idx) ? last.idx : last.level;
  if (!Number.isFinite(rawIndex)) return null;

  return Math.max(1, Math.round(rawIndex - pageOffset));
};

export const saveRmsProgress = async ({
  apiBase,
  bookCd,
  memberCd,
  orderIgnore,
  pageOffset,
  pageIndex,
  viewMode,
  lastPages,
  bookTotalPages,
}: {
  apiBase: string;
  bookCd: string;
  memberCd: string;
  orderIgnore: boolean;
  pageOffset: number;
  pageIndex: number;
  viewMode: string;
  lastPages?: number;
  bookTotalPages?: number;
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const localStoragePath = getLocalStoragePath(bookCd, memberCd);
  ensureRmsStatus(localStoragePath);
  ensureRmsVerList(localStoragePath);

  const safePageIndex = Number.isFinite(pageIndex) ? pageIndex : 0;
  const normalizedPageIndex = Math.max(
    0,
    Math.round(safePageIndex + pageOffset)
  );
  const progressData = addProgressEntry({
    localStoragePath,
    pageIndex: normalizedPageIndex,
    viewMode,
  });

  const rmsList = [
    {
      rmsTp: "RMS_PR",
      rmsData: JSON.stringify(progressData),
    },
  ];

  const totalPagesValue = Number.isFinite(bookTotalPages)
    ? Math.max(0, Math.round(bookTotalPages as number))
    : 0;
  if (totalPagesValue > 0) {
    const lastPageValue = Number.isFinite(lastPages)
      ? Math.round(lastPages as number)
      : safePageIndex;
    const normalizedLastPage = Math.max(
      0,
      Math.round(lastPageValue + pageOffset)
    );
    rmsList.push({
      rmsTp: "RMS_ST",
      lastPages: normalizedLastPage,
      bookTotalPages: totalPagesValue,
    });
  }

  const reqData = {
    bookCd,
    rmsList,
  };

  const params = orderIgnore ? "?orderIgnore=Y" : "";
  const response = await fetch(`${apiBase}/v2/rms/rmsData${params}`, {
    method: "PUT",
    headers: buildRmsHeaders(),
    body: JSON.stringify(reqData),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error ||
      `RMS save failed (${response.status})`;
    throw new Error(message);
  }

  if (payload?.result?.rmsTs) {
    updateRmsVerList(localStoragePath, "RMS_PR", payload.result.rmsTs);
    if (totalPagesValue > 0) {
      updateRmsVerList(localStoragePath, "RMS_ST", payload.result.rmsTs);
    }
  }

  rmsStatusInitFalse(localStoragePath);
  return payload;
};

export const saveRmsIndexedDbData = async ({
  apiBase,
  bookCd,
  memberCd,
  payload,
}: {
  apiBase: string;
  bookCd: string;
  memberCd: string;
  payload: IndexedDbBundlePayload;
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const reqData = {
    bookCd,
    memberCd,
    storageKey: payload.storageKey,
    data: payload.data,
    meta: payload.meta || {},
  };

  const response = await fetch(`${apiBase}/v3/rms/saveData`, {
    method: "POST",
    headers: buildRmsHeaders(),
    body: JSON.stringify(reqData),
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `RMS saveData failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};

export const saveHighlightsToServer = async ({
  apiBase,
  bookCd,
  highlights,
}: {
  apiBase: string;
  bookCd: string;
  highlights: unknown[];
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }

  const url = `${apiBase}/v3/t-pack/test-v-save/save`;
  const payload = {
    bookCode: bookCd,
    type: "hl",
    data: JSON.stringify(highlights),
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Highlights save failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};

export const loadHighlightsFromServer = async ({
  apiBase,
  bookCd,
}: {
  apiBase: string;
  bookCd: string;
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }

  const url = `${apiBase}/v3/t-pack/test-v-save/list?bookCode=${bookCd}&type=hl`;

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Highlights load failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};

export const saveProgressToServer = async ({
  apiBase,
  bookCd,
  progress,
}: {
  apiBase: string;
  bookCd: string;
  progress: unknown;
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }

  const url = `${apiBase}/v3/t-pack/test-v-save/save`;
  const payload = {
    bookCode: bookCd,
    type: "pr",
    data: JSON.stringify(progress),
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Progress save failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};

export const loadProgressFromServer = async ({
  apiBase,
  bookCd,
}: {
  apiBase: string;
  bookCd: string;
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }

  const url = `${apiBase}/v3/t-pack/test-v-save/list?bookCode=${bookCd}&type=pr`;

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Progress load failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};

export const saveBookmarksToServer = async ({
  apiBase,
  bookCd,
  bookmarks,
}: {
  apiBase: string;
  bookCd: string;
  bookmarks: unknown[];
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }

  const url = `${apiBase}/v3/t-pack/test-v-save/save`;
  const payload = {
    bookCode: bookCd,
    type: "bm",
    data: JSON.stringify(bookmarks),
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Bookmarks save failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};

export const loadBookmarksFromServer = async ({
  apiBase,
  bookCd,
}: {
  apiBase: string;
  bookCd: string;
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }

  const url = `${apiBase}/v3/t-pack/test-v-save/list?bookCode=${bookCd}&type=bm`;

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Bookmarks load failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};

export const saveDrawingsToServer = async ({
  apiBase,
  bookCd,
  drawings,
}: {
  apiBase: string;
  bookCd: string;
  drawings: unknown[];
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }

  const url = `${apiBase}/v3/t-pack/test-v-save/save`;

  const payload = {
    bookCode: bookCd,
    type: "dr",
    data: JSON.stringify(drawings),
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Drawings save failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};

export const loadDrawingsFromServer = async ({
  apiBase,
  bookCd,
}: {
  apiBase: string;
  bookCd: string;
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }

  const url = `${apiBase}/v3/t-pack/test-v-save/list?bookCode=${bookCd}&type=dr`;

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Drawings load failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};

export const saveNotesToServer = async ({
  apiBase,
  bookCd,
  notes,
}: {
  apiBase: string;
  bookCd: string;
  notes: any[];
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }

  const url = `${apiBase}/v3/t-pack/test-v-save/save`;

  // Save all notes as a single array
  const payload = {
    bookCode: bookCd,
    type: "en",
    data: JSON.stringify(notes),
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Notes save failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};

export const loadNotesFromServer = async ({
  apiBase,
  bookCd,
}: {
  apiBase: string;
  bookCd: string;
}) => {
  if (typeof window === "undefined") {
    throw new Error("RMS is only available in the browser.");
  }
  if (!apiBase || !bookCd) {
    throw new Error("Missing RMS configuration (apiBase/bookCd).");
  }

  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }

  const url = `${apiBase}/v3/t-pack/test-v-save/list?bookCode=${bookCd}&type=en`;

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Notes load failed (${response.status})`;
    throw new Error(message);
  }

  return result;
};
