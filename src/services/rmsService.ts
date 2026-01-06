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

export const saveRmsProgress = async ({
  apiBase,
  bookCd,
  memberCd,
  orderIgnore,
  pageOffset,
  pageIndex,
  viewMode,
}: {
  apiBase: string;
  bookCd: string;
  memberCd: string;
  orderIgnore: boolean;
  pageOffset: number;
  pageIndex: number;
  viewMode: string;
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

  const reqData = {
    bookCd,
    rmsList: [
      {
        rmsTp: "RMS_PR",
        rmsData: JSON.stringify(progressData),
      },
    ],
  };

  const params = orderIgnore ? "?orderIgnore=Y" : "";
  const authToken = getRmsAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (authToken) {
    headers.Authorization = /^Bearer\s+/i.test(authToken)
      ? authToken
      : `Bearer ${authToken}`;
  }
  const response = await fetch(`${apiBase}/v2/rms/rmsData${params}`, {
    method: "PUT",
    headers,
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
