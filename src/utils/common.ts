// ============================================================
// Shared utility functions
// 여러 모듈에서 반복 사용되는 헬퍼를 한 곳에 모아둔 파일입니다.
// ============================================================

/**
 * 브라우저 환경인지 확인합니다. (SSR guard)
 * `typeof window !== "undefined"` 체크를 대체합니다.
 */
export const isBrowser = (): boolean => typeof window !== "undefined";

/**
 * unknown 값을 유한한 숫자(number)로 변환합니다.
 * - number 타입이면서 유한하면 그대로 반환
 * - 빈 문자열이 아닌 string이면 Number()로 파싱 시도
 * - 그 외에는 null 반환
 */
export const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
