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
];

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
  const raw =
    params.get("rmsToken") ||
    params.get("rmsAuthToken") ||
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
  if (Array.isArray(stored) && stored.length > 0) {
    return stored;
  }
  localStorage.setItem(
    getRmsVerListKey(localStoragePath),
    JSON.stringify(DEFAULT_RMS_VER_LIST)
  );
  return [...DEFAULT_RMS_VER_LIST];
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
  const localStorageContext = detectLocalStorageContext();
  const bookCdFromPath = parseBookCdFromPath();
  const rawApiBase =
    params.get("rmsApiBase") || import.meta.env.VITE_RMS_API_BASE || "";
  const apiBase = normalizeApiBase(rawApiBase);
  const bookCd =
    params.get("bookCd") ||
    import.meta.env.VITE_RMS_BOOK_CD ||
    bookCdFromPath ||
    localStorageContext?.bookCd ||
    "";
  const memberCd =
    params.get("memberCd") ||
    import.meta.env.VITE_RMS_MEMBER_CD ||
    localStorageContext?.memberCd ||
    "guest";
  const orderIgnoreRaw =
    params.get("orderIgnore") ||
    import.meta.env.VITE_RMS_ORDER_IGNORE ||
    "";
  const orderIgnore = orderIgnoreRaw.toUpperCase() === "Y";
  const pageOffsetRaw =
    params.get("rmsPageOffset") ||
    import.meta.env.VITE_RMS_PAGE_OFFSET ||
    "0";
  const pageOffset = Number(pageOffsetRaw) || 0;

  if (!apiBase || !bookCd) return null;
  return { apiBase, bookCd, memberCd, orderIgnore, pageOffset };
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
  const reqData = {
    bookCd,
    orderIgnore,
    rmsList: rmsVerList,
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

  const rmsList = payload?.result?.rmsList;
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
  }

  rmsStatusInitFalse(localStoragePath);
  return payload;
};
