import { useEffect, useRef } from "react";
import { usePdfViewer } from "../contexts/PdfViewerContext";
import { sendRapidDetectionLog } from "./useStayTracker";

// ──────────────────────────────────────────────────────────────────────────────
// 설정값
// ──────────────────────────────────────────────────────────────────────────────

/** 연속으로 통과해야 할 페이지 수 */
const PAGE_COUNT_THRESHOLD = 30;

/** 이 간격(ms) 이상이면 연속 시퀀스가 끊긴 것으로 보고 리셋 */
const SEQUENCE_BREAK_MS = 3000;

/**
 * 직전 간격 대비 허용 변동 비율
 * - 0.2 = ±20% 이내면 "일정"으로 판정
 * - 예: 직전 500ms → 400~600ms 이내면 통과
 */
const RATIO_THRESHOLD = 0.1;

// ──────────────────────────────────────────────────────────────────────────────
// 훅
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 직전 간격 대비 ±20% 이내로 30회 연속 페이지를 넘기면 경고를 표시합니다.
 *
 * - 한 번이라도 ±20% 벗어나면 카운트 리셋
 * - 방향 전환 / 3초 이상 정지 시 전체 리셋
 * - 경고 후 리셋 (다시 30회 연속해야 재경고)
 */
export function useRapidPageDetector(): void {
  const { currentPdfPage, navTimeQueue, viewMode } = usePdfViewer();

  /** 연속 통과 횟수 */
  const consecutiveRef = useRef<number>(0);
  /** 직전 페이지 전환 간격 (ms) */
  const prevIntervalRef = useRef<number | null>(null);
  /** 마지막 페이지 전환 시각 */
  const lastPageTimeRef = useRef<number | null>(null);
  /** 프로그레스바 드래그 중 여부 */
  const isDraggingProgressBarRef = useRef<boolean>(false);
  /** 직전 페이지 번호 */
  const prevPageRef = useRef<number | null>(null);
  /** 직전 이동 방향 (1: 앞으로, -1: 뒤로, 0: 초기) */
  const lastDirectionRef = useRef<0 | 1 | -1>(0);

  const resetAll = () => {
    consecutiveRef.current = 0;
    prevIntervalRef.current = null;
  };

  // ── 프로그레스바 드래그 감지 ──────────────────────────────────────────────
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest(".prograss_bar_wrap")) {
        isDraggingProgressBarRef.current = true;
      }
    };
    const onPointerUp = () => {
      if (isDraggingProgressBarRef.current) {
        isDraggingProgressBarRef.current = false;
        lastPageTimeRef.current = Date.now();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // ── 페이지 변경 시 판정 ───────────────────────────────────────────────────
  useEffect(() => {
    if (currentPdfPage <= 0) return;
    if (isDraggingProgressBarRef.current) return;

    const now = navTimeQueue.current.get(currentPdfPage) ?? Date.now();
    navTimeQueue.current.delete(currentPdfPage);
    const prevTime = lastPageTimeRef.current;
    const prevPage = prevPageRef.current;

    // ── 방향 변화 감지: 바뀌면 전체 리셋 ────────────────────────────────────
    if (prevPage !== null) {
      const currentDirection: 1 | -1 = currentPdfPage > prevPage ? 1 : -1;
      if (
        lastDirectionRef.current !== 0 &&
        currentDirection !== lastDirectionRef.current
      ) {
        resetAll();
        lastPageTimeRef.current = now;
        prevPageRef.current = currentPdfPage;
        lastDirectionRef.current = currentDirection;
        return;
      }
      lastDirectionRef.current = currentDirection;
    }
    prevPageRef.current = currentPdfPage;

    if (prevTime !== null) {
      const interval = now - prevTime;

      // 절대값 초과: 리셋
      if (interval >= SEQUENCE_BREAK_MS) {
        resetAll();
        lastPageTimeRef.current = now;
        return;
      }

      const prev = prevIntervalRef.current;

      if (prev !== null) {
        const ratio = Math.abs(interval - prev) / prev;
        const isConsistent = ratio <= RATIO_THRESHOLD;

        if (isConsistent) {
          consecutiveRef.current += 1;
        } else {
          consecutiveRef.current = 0;
        }

        // console.log(
        //   `[PageDetector] 간격: ${(interval / 1000).toFixed(2)}s | ` +
        //   `직전: ${(prev / 1000).toFixed(2)}s | ` +
        //   `변동: ${(ratio * 100).toFixed(1)}% | ` +
        //   `연속: ${consecutiveRef.current}/${PAGE_COUNT_THRESHOLD} | ` +
        //   `${isConsistent ? "✓" : "✗ 리셋"}`
        // );

        if (consecutiveRef.current >= PAGE_COUNT_THRESHOLD) {
          consecutiveRef.current = 0;
          prevIntervalRef.current = null;
          sendRapidDetectionLog(currentPdfPage, viewMode);
          setTimeout(() => {
            alert(
              "비정상적으로 빠른 페이지 이동이 감지되었습니다.\n\n" +
                "반복적이거나 과도하게 빠른 페이지 이동은 비정상 이용 패턴으로 인식될 수 있어,\n" +
                "보호 정책이 자동으로 적용될 수 있습니다."
            );
          }, 0);
          lastPageTimeRef.current = now;
          return;
        }
      } else {
        // console.log(`[PageDetector] 간격: ${(interval / 1000).toFixed(2)}s | 첫 번째 간격`);
      }

      prevIntervalRef.current = interval;
    }

    lastPageTimeRef.current = now;
  }, [currentPdfPage]);
}
