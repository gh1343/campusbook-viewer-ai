import { useEffect, useRef } from "react";
import { usePdfViewer } from "../contexts/PdfViewerContext";

// ──────────────────────────────────────────────────────────────────────────────
// 설정값
// ──────────────────────────────────────────────────────────────────────────────

/** 점수 계산에 사용할 최근 페이지 전환 간격 개수 */
const WINDOW_SIZE = 10;

/** 이 점수 이상이면 경고 표시 */
const ALERT_THRESHOLD = 10;

/** 경고 후 재경고까지 최소 대기 시간 (ms) — 5분 */
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

// 속도 티어 (ms 단위 - 이 값 미만이면 해당 티어로 분류)
const SPEED_ULTRA  = 800;   // 0.8초 미만
const SPEED_FAST   = 1000;  // 1.0초 미만
const SPEED_MEDIUM = 1500;  // 1.5초 미만

// 규칙성 임계값 (표준편차, ms)
const REGULARITY_HIGH   = 80;   // 매우 규칙적 (자동화 도구 수준)
const REGULARITY_MEDIUM = 150;  // 다소 규칙적

/** 상호작용 부재로 판단할 시간 (ms) — 8초간 아무 행동 없음 */
const NO_INTERACTION_MS = 8_000;

// ──────────────────────────────────────────────────────────────────────────────
// 내부 유틸
// ──────────────────────────────────────────────────────────────────────────────

function calcStdDev(values: number[]): number {
  if (values.length < 2) return Infinity;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * 4개의 신호를 조합해 의심 점수를 계산합니다.
 *
 * [Signal 1] 빠른 전환 비율
 *   - 분석 창(WINDOW_SIZE) 안에서 빠른 전환이 얼마나 많은지 비율로 평가
 *   - 0.8s 미만이 60%↑ → +4점 / 1.0s 미만이 70%↑ → +3점 / 1.5s 미만이 80%↑ → +2점
 *
 * [Signal 2] 간격의 규칙성 (표준편차)
 *   - 사람: 간격이 들쭉날쭉 (stdDev 크다)
 *   - 캡처 봇: 간격이 기계적으로 일정 (stdDev 매우 작다)
 *   - stdDev < 80ms → +5점 / stdDev < 150ms → +3점 (빠른 전환이 절반 이상일 때만 적용)
 *
 * [Signal 3] 상호작용 부재
 *   - 빠른 전환 중에 마우스 이동·스크롤·터치가 전혀 없으면 사람이 아닐 가능성 높음
 *   - 8초 이상 상호작용 없음 + 빠른 전환 5개↑ → +3점
 *
 * [Signal 4] 세션 누적 빠른 전환 수
 *   - 세션 전체에서 1.5s 미만 전환이 많을수록 의심
 *   - 40개↑ → +3점 / 20개↑ → +2점
 */
function calcScore(
  intervals: number[],
  lastInteractionAgoMs: number,
  cumulativeFastCount: number
): number {
  if (intervals.length < 3) return 0;

  let score = 0;

  const total         = intervals.length;
  const ultraCount    = intervals.filter((i) => i < SPEED_ULTRA).length;
  const fastCount     = intervals.filter((i) => i < SPEED_FAST).length;
  const mediumCount   = intervals.filter((i) => i < SPEED_MEDIUM).length;

  // ── Signal 1: 빠른 전환 비율 ─────────────────────────────────────────────
  if (ultraCount  >= total * 0.6) score += 4;
  else if (fastCount  >= total * 0.7) score += 3;
  else if (mediumCount >= total * 0.8) score += 2;
  else if (mediumCount >= total * 0.6) score += 1;

  // ── Signal 2: 규칙성 (빠른 전환이 창의 절반 이상일 때만 평가) ───────────
  if (mediumCount >= total * 0.5) {
    const stdDev = calcStdDev(intervals);
    if (stdDev < REGULARITY_HIGH)   score += 5;
    else if (stdDev < REGULARITY_MEDIUM) score += 3;
  }

  // ── Signal 3: 상호작용 부재 ──────────────────────────────────────────────
  if (lastInteractionAgoMs > NO_INTERACTION_MS && mediumCount >= 5) {
    score += 3;
  }

  // ── Signal 4: 세션 누적 빠른 전환 수 ────────────────────────────────────
  if (cumulativeFastCount > 40)      score += 3;
  else if (cumulativeFastCount > 20) score += 2;

  return score;
}

// ──────────────────────────────────────────────────────────────────────────────
// 훅
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 빠른 연속 페이지 전환(캡처 프로그램 의심 행동)을 감지하면 경고 alert를 표시합니다.
 *
 * 단순 속도 하나가 아니라 4가지 신호의 점수 합산으로 판단하므로
 * 목차 탐색, 키보드 이동 등 정상 사용자가 오탐되는 경우를 줄입니다.
 */
export function useRapidPageDetector(): void {
  const { currentPdfPage } = usePdfViewer();

  /** 최근 WINDOW_SIZE 개의 페이지 전환 간격 (ms) */
  const intervalsRef              = useRef<number[]>([]);
  /** 마지막 페이지 전환 시각 */
  const lastPageTimeRef           = useRef<number | null>(null);
  /** 마지막 사용자 상호작용 시각 */
  const lastInteractionRef        = useRef<number>(Date.now());
  /** 세션 내 1.5s 미만 전환 누적 수 */
  const cumulativeFastRef         = useRef<number>(0);
  /** 마지막 경고 표시 시각 */
  const lastAlertRef              = useRef<number>(0);
  /** 프로그레스바 드래그 중 여부 — 드래그 중 페이지 전환은 검사 제외 */
  const isDraggingProgressBarRef  = useRef<boolean>(false);
  /** 직전 페이지 번호 — 이동 방향 변화 감지용 */
  const prevPageRef               = useRef<number | null>(null);
  /** 직전 이동 방향 (1: 앞으로, -1: 뒤로, 0: 초기) */
  const lastDirectionRef          = useRef<0 | 1 | -1>(0);

  // ── 프로그레스바 드래그 감지 ──────────────────────────────────────────────
  // pointerdown 대상이 .prograss_bar_wrap 내부이면 드래그 플래그를 세우고,
  // pointerup 시 해제합니다. 드래그가 끝난 직후의 페이지 위치가 기준점이
  // 되도록 lastPageTimeRef도 리셋합니다.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest(".prograss_bar_wrap")) {
        isDraggingProgressBarRef.current = true;
      }
    };
    const onPointerUp = () => {
      if (isDraggingProgressBarRef.current) {
        isDraggingProgressBarRef.current = false;
        // 드래그 종료 시점을 새 기준으로 삼아 직후 전환이 빠르게 오해되지 않도록 리셋
        lastPageTimeRef.current = Date.now();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup",   onPointerUp,   { passive: true });

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup",   onPointerUp);
    };
  }, []);

  // ── Signal 3용: 상호작용 이벤트 감지 ─────────────────────────────────────
  // 페이지 전환용 키(ArrowKey, PageUp/Down 등)는 제외하고,
  // 콘텐츠를 실제로 보고 있음을 나타내는 행동만 감지합니다.
  useEffect(() => {
    const onInteraction = () => {
      lastInteractionRef.current = Date.now();
    };

    // 마우스 이동 — 콘텐츠 위에서 마우스를 움직이면 갱신
    window.addEventListener("mousemove",      onInteraction, { passive: true });
    // 마우스 휠 스크롤 — PDF를 스크롤해 읽고 있을 때
    window.addEventListener("wheel",          onInteraction, { passive: true });
    // 터치 이동 — 모바일에서 스와이프 읽기
    window.addEventListener("touchmove",      onInteraction, { passive: true });
    // 텍스트 선택 — 실제 콘텐츠를 읽는 행동 (버튼 클릭과 구분됨)
    // pointerdown은 제외: 페이지 전환 버튼 클릭 시에도 발생해 Signal 3를 무력화하므로
    document.addEventListener("selectionchange", onInteraction, { passive: true });

    return () => {
      window.removeEventListener("mousemove",      onInteraction);
      window.removeEventListener("wheel",          onInteraction);
      window.removeEventListener("touchmove",      onInteraction);
      document.removeEventListener("selectionchange", onInteraction);
    };
  }, []);

  // ── 페이지 변경 시 점수 계산 ──────────────────────────────────────────────
  useEffect(() => {
    if (currentPdfPage <= 0) return;
    // 프로그레스바 드래그 중 전환은 검사하지 않음
    if (isDraggingProgressBarRef.current) return;

    const now      = Date.now();
    const prevTime = lastPageTimeRef.current;
    const prevPage = prevPageRef.current;

    // ── 방향 변화 감지: 앞→뒤 또는 뒤→앞으로 바뀌면 창 리셋 ──────────────
    if (prevPage !== null) {
      const currentDirection: 1 | -1 = currentPdfPage > prevPage ? 1 : -1;
      if (lastDirectionRef.current !== 0 && currentDirection !== lastDirectionRef.current) {
        // 방향이 바뀌었으므로 간격 창·누적 카운트·기준 시각을 모두 리셋하고
        // 이번 전환은 건너뜀 — 방향 전환 시점의 간격이 새 창에 섞이지 않도록
        intervalsRef.current      = [];
        cumulativeFastRef.current = 0;
        lastPageTimeRef.current   = now;
        prevPageRef.current       = currentPdfPage;
        lastDirectionRef.current  = currentDirection;
        return;
      }
      lastDirectionRef.current = currentDirection;
    }
    prevPageRef.current = currentPdfPage;

    if (prevTime !== null) {
      const interval = now - prevTime;

      // 간격 기록 (창 크기 초과 시 오래된 것부터 제거)
      intervalsRef.current.push(interval);
      if (intervalsRef.current.length > WINDOW_SIZE) {
        intervalsRef.current.shift();
      }

      // 빠른 전환이면 누적 카운트 증가
      if (interval < SPEED_MEDIUM) {
        cumulativeFastRef.current += 1;
      }

      // 점수 계산
      const lastInteractionAgoMs = now - lastInteractionRef.current;
      const score = calcScore(
        intervalsRef.current,
        lastInteractionAgoMs,
        cumulativeFastRef.current
      );

      // 임계값 초과 + 쿨다운 지났으면 경고
      if (score >= ALERT_THRESHOLD && now - lastAlertRef.current > ALERT_COOLDOWN_MS) {
        lastAlertRef.current = now;

        // 경고 후 상태 리셋 (같은 세션에서 재감지 허용하되 직후 중복 경고 방지)
        intervalsRef.current    = [];
        cumulativeFastRef.current = 0;

        setTimeout(() => {
          alert(
            "빠른 연속 페이지 전환이 감지되었습니다.\n\n" +
            "본 뷰어는 저작권 보호를 위해 무단 캡처를 제한하고 있습니다.\n" +
            "서비스 이용 약관을 준수하여 정상적으로 이용해 주세요."
          );
        }, 0);
      }
    }

    lastPageTimeRef.current = now;
  }, [currentPdfPage]);
}
