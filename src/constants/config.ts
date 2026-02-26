// ============================================================
// Application-wide constants
// Centralised "magic numbers" so every module shares one source of truth.
// ============================================================

// --- Layout / Responsive Breakpoints ---
export const BREAKPOINTS = {
  /** 태블릿/데스크톱 전환 기준 너비 (px) */
  TABLET: 1300,
  /** 모바일 전환 기준 너비 (px) */
  MOBILE: 480,
} as const;

// --- Side Panel Dimensions ---
export const PANEL = {
  LEFT_DEFAULT_WIDTH: 300,
  RIGHT_DEFAULT_WIDTH: 350,
  LEFT_MIN_WIDTH: 200,
  LEFT_MAX_WIDTH: 500,
  RIGHT_MIN_WIDTH: 280,
  RIGHT_MAX_WIDTH: 600,
} as const;

// --- Timer Intervals ---
export const TIMERS = {
  /** 자동 저장 간격 (ms) - 3분 */
  AUTOSAVE_INTERVAL: 3 * 60 * 1000,
  /** 중복 기기(세션) 확인 간격 (ms) - 30초 */
  ALIVE_CHECK_INTERVAL: 30 * 1000,
  /** 하이라이트 링 이펙트 유지 시간 (ms) */
  HIGHLIGHT_RING_DURATION: 2000,
  /** 셀렉션 체크 딜레이 배열 (ms) - 터치/롱프레스 대기용 */
  SELECTION_CHECK_DELAYS: [0, 40, 120] as readonly number[],
} as const;

// --- Selection Menu ---
export const SELECTION_MENU = {
  WIDTH: 240,
  MARGIN: 12,
  /** 데스크톱에서 선택 텍스트 위로 올리는 오프셋 (px) */
  VERTICAL_OFFSET: 56,
} as const;

// --- Content Renderer ---
export const CONTENT = {
  /** 지우개 히트 판정 반경 (px) - EPUB 뷰어용 */
  ERASER_HIT_RADIUS: 20,
  /** 캡처 영역 최소 크기 (px) */
  MIN_CAPTURE_SIZE: 10,
} as const;

// --- Pen Layer (PDF Viewer) ---
export const PEN_LAYER = {
  /** 캔버스 최대 크기 (iPad Safari 메모리 한계 고려) */
  MAX_CANVAS_DIMENSION: 4096,
  /** 뷰포트 버퍼 최솟값 (px) */
  VIEWPORT_BUFFER_MIN: 100,
  /** 뷰포트 버퍼 기준값 (px) - visualScale로 나눠 사용 */
  VIEWPORT_BUFFER_BASE: 400,
  /** PDF 지우개 히트 판정 반경 (px) */
  ERASER_HIT_RADIUS: 16,
  /** 직선 판정 직진도 임계값 (펜 종료 시) */
  STRAIGHTNESS_THRESHOLD: 0.88,
  /** 직선 판정 최소 포인트 수 (펜 종료 시) */
  STRAIGHTNESS_MIN_POINTS: 5,
  /** 실시간 직선 의도 감지 직진도 임계값 */
  STRAIGHT_INTENT_THRESHOLD: 0.92,
  /** 실시간 직선 의도 최소 포인트 수 */
  STRAIGHT_INTENT_MIN_POINTS: 10,
} as const;
