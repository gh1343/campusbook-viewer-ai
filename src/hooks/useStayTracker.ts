import { useEffect, useRef } from "react";
import { usePdfViewer } from "../contexts/PdfViewerContext";
import { getRmsConfig } from "../services/rmsService";
import { getPreviewConfig } from "../utils/previewConfig";
import type { ViewMode } from "../../types";

function toModeNum(mode: ViewMode): 31 | 32 {
  return mode === "single" ? 31 : 32;
}

/**
 * 구간 체류 시간을 서버로 전송
 *  - segmentMs <= 1000ms면 전송 안 함 (너무 짧은 체류는 노이즈)
 *  - stayTimeMs: 이 페이지 × 이 뷰모드에서의 누적 시간
 */
function sendStayLog(
  pageNo: number,
  modeNum: 31 | 32,
  startMs: number,
  endMs: number,
  stayTimeMs: number
): void {
  const segmentMs = endMs - startMs;

  // 1초 이하 필터 전에 찍힘 (스킵되는 케이스 포함)
  // console.log("[StayTracker] segment", {
  //   pageNo,
  //   viewMode: modeNum,
  //   segmentMs: `${(segmentMs / 1000).toFixed(2)}s`,
  //   stayTimeMs: `${(stayTimeMs / 1000).toFixed(2)}s`,
  //   willSend: segmentMs > 1000,
  // });

  if (segmentMs <= 1000) return;

  const config = getRmsConfig();
  if (!config?.apiBase) return;

  const payload = {
    viewMode: modeNum,
    memberCode: config.memberCd ?? null,
    bookCode: config.bookCd ?? null,
    pageNo,
    stayTimeMs,
  };

  // 실제 전송되는 payload
  // console.log("[StayTracker] → send", payload);

  fetch(`${config.apiBase}/v3/log/viewer-stay`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  }).catch((e) => console.error("[StayTracker] send error", e));
}

/**
 * 페이지/뷰모드별 체류 시간을 측정해 서버로 전송하는 훅.
 *
 * 로그 전송 조건:
 *   1. isPreview=false (미리보기 모드에서는 추적 안 함)
 *   2. 구간 시간 > 1초
 *   3. 페이지가 바뀔 때 → 이전 페이지 구간 마무리
 *   4. 뷰모드(single/double)가 바뀔 때 → 이전 모드 구간 마무리 single -> 31 / double -> 32
 *   5. 탭 숨김(visibilitychange hidden) 시간은 체류 시간에서 제외
 */
export function useStayTracker(): void {
  const { currentPdfPage, viewMode } = usePdfViewer();

  // 매 렌더마다 최신 viewMode를 ref에 유지
  // → currentPdfPage effect 안에서 viewMode를 deps 없이 읽기 위함
  const viewModeRef = useRef<ViewMode>(viewMode);
  viewModeRef.current = viewMode;

  // 체류 측정용 ref (React state 불필요 - 렌더 트리거 없음)
  const segmentStartMsRef = useRef<number | null>(null);
  const lastPageNumRef = useRef<number | null>(null);
  const currentModeNumRef = useRef<31 | 32 | null>(null);
  const modeDurationsRef = useRef<{ 31: number; 32: number }>({ 31: 0, 32: 0 });
  const isPausedRef = useRef(false);
  const pauseStartMsRef = useRef<number | null>(null);

  const isPreview = getPreviewConfig().isPreview;

  // ── 탭 전환 pause / resume ──────────────────────────────────────────
  useEffect(() => {
    if (isPreview) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (isPausedRef.current) return;
        if (lastPageNumRef.current == null || segmentStartMsRef.current == null)
          return;
        isPausedRef.current = true;
        pauseStartMsRef.current = Date.now();
      } else {
        if (!isPausedRef.current) return;
        const pausedMs = Date.now() - (pauseStartMsRef.current ?? Date.now());
        if (segmentStartMsRef.current != null) {
          // 숨겨진 시간만큼 시작점을 앞으로 밀어 누적에서 제외
          segmentStartMsRef.current += pausedMs;
        }
        isPausedRef.current = false;
        pauseStartMsRef.current = null;
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isPreview]);

  // ── 페이지 변경 ────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isPreview || currentPdfPage <= 0) return;

    const now = Date.now();
    const modeNum = toModeNum(viewModeRef.current);

    // 이전 페이지 구간 마무리 → 전송
    if (
      lastPageNumRef.current != null &&
      segmentStartMsRef.current != null &&
      currentModeNumRef.current != null
    ) {
      const diff = now - segmentStartMsRef.current;
      if (diff > 0) {
        const prevMode = currentModeNumRef.current;
        modeDurationsRef.current[prevMode] += diff;
        sendStayLog(
          lastPageNumRef.current,
          prevMode,
          segmentStartMsRef.current,
          now,
          modeDurationsRef.current[prevMode]
        );
      }
    }

    // 새 페이지 구간 시작, 누적 시간 리셋
    lastPageNumRef.current = currentPdfPage;
    segmentStartMsRef.current = now;
    currentModeNumRef.current = modeNum;
    modeDurationsRef.current = { 31: 0, 32: 0 };
  }, [currentPdfPage]); // viewMode는 viewModeRef로 읽으므로 deps 제외

  // ── 뷰모드 변경 ────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isPreview) return;

    const nextMode = toModeNum(viewMode);
    const now = Date.now();

    // 아직 페이지 진입 전이면 상태만 세팅
    if (
      lastPageNumRef.current == null ||
      segmentStartMsRef.current == null ||
      currentModeNumRef.current == null
    ) {
      currentModeNumRef.current = nextMode;
      segmentStartMsRef.current = now;
      return;
    }

    // 모드가 실제로 바뀌지 않았으면 무시
    if (nextMode === currentModeNumRef.current) return;

    // 이전 모드 구간 마무리 → 전송
    const diff = now - segmentStartMsRef.current;
    if (diff > 0) {
      const prevMode = currentModeNumRef.current;
      modeDurationsRef.current[prevMode] += diff;
      sendStayLog(
        lastPageNumRef.current,
        prevMode,
        segmentStartMsRef.current,
        now,
        modeDurationsRef.current[prevMode]
      );
    }

    // 새 모드 구간 시작 (페이지는 유지, 누적은 이어서)
    currentModeNumRef.current = nextMode;
    segmentStartMsRef.current = now;
  }, [viewMode]); // isPreview는 세션 중 변하지 않으므로 deps 제외
}
