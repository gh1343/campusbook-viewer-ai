// src/features/viewer/components/PdfViewer.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GlobalWorkerOptions } from "pdfjs-dist";
import { PDFViewer, SpreadMode } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import "../../../css/pdf_viewer.css";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

import { getPreviewConfig } from "../../../utils/previewConfig";
import { isBrowser } from "../../../utils/common";
import { useWatermark } from "../../../hooks/useWatermark";
import {
  applySearchHighlightWithRetry,
  askAiAction,
  buildHighlightRectsFromSelection,
  createPenLayerRuntime,
  mergeHighlightRects,
  PdfSelectionMenu,
  PdfViewerOverlay,
  usePdfJsViewer,
  usePdfPenLayer,
} from "..";
import { useBook } from "../../../contexts/BookContext";
import { useDrawing } from "../../../contexts/DrawingContext";
import { usePdfViewer } from "../../../contexts/PdfViewerContext";
import { useAnnotation } from "../../../contexts/AnnotationContext";
import {
  getCanvasMetrics,
  getPageOffsetInfo,
  getPagePoint,
  HighlightRect,
  PdfHighlight,
} from "../utils/pdfUtils";
import { drawStrokePath, VISUAL_SCALE } from "../utils/pdf_viewer_utils";
// ✅ worker 설정 (v4 ESM) - 로컬 파일 사용으로 배포 후 첫 로드 메모리 스파이크 방지
GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const getJsonBytes = (value: unknown) => {
  const text = JSON.stringify(value);
  if (typeof TextEncoder === "undefined") return text.length;
  return new TextEncoder().encode(text).length;
};

const bytesToMb = (bytes: number) => Number((bytes / (1024 * 1024)).toFixed(4));

const enable_debug_log = false;
const COPY_REPLACE_CHAR = "*";

interface PdfViewerProps {
  file: string; // 일단 string URL 기준으로만 사용
  onPageChange?: (page: number) => void;
  onPagesCount?: (count: number) => void;
  registerGoToPage?: (fn: (page: number) => void) => void;
  forceSinglePage?: boolean;
  onLoadError?: () => void;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  file,
  onPageChange,
  onPagesCount,
  registerGoToPage,
  forceSinglePage = false,
  onLoadError,
}) => {
  const { previewMaxPage } = getPreviewConfig();
  const watermarkUrl = useWatermark();
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const scaleWrapperRef = useRef<HTMLDivElement>(null);
  const transformLayerRef = useRef<HTMLDivElement>(null);
  const pageCanvasMapRef = useRef<
    Map<
      number,
      {
        layer: HTMLDivElement;
        staticCanvas: HTMLCanvasElement;
        liveCanvas: HTMLCanvasElement;
      }
    >
  >(new Map());
  const currentPageRef = useRef<number | null>(null);
  const {
    triggerSmartExplain,
    setToolsOpen,
    setActiveToolTab,
    getChapterTitleByPage,
  } = useBook();
  const {
    addHighlight,
    updateHighlight,
    highlights,
    activeHighlightId,
    focusHighlight,
    showAnnotations,
    requestHighlightNoteEdit,
  } = useAnnotation();
  const {
    setPdfTextPages,
    pdfSearchHighlight,
    registerPdfZoomHandler,
    setPdfZoom,
    pdfZoom,
    setPdfLoadProgress,
    setPdfLoadTime,
    setPdfIsLoading,
    currentPdfPage,
    viewMode,
    pdfTextPages,
  } = usePdfViewer();
  const {
    drawingMode,
    penColor,
    penWidth,
    penOpacity,
    chapterStrokes,
    addStroke,
    removeStroke,
    removeStrokes,
  } = useDrawing();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isMobileSafari =
    /iP(hone|od|ad)/.test(ua) &&
    /Safari/i.test(ua) &&
    !/Chrome/i.test(ua) &&
    !/CriOS/i.test(ua) &&
    !/Edgios/i.test(ua);
  const isTouchDevice = useMemo(
    () =>
      typeof window !== "undefined" &&
      ("ontouchstart" in window || navigator.maxTouchPoints > 0),
    []
  );
  const highlightScrollBehavior =
    isMobileSafari || isTouchDevice ? "auto" : "smooth";
  const isMobileLike = useMemo(() => {
    if (!isBrowser()) return false;
    const touchUA = /Mobi|Android|iP(hone|od|ad)/i.test(ua);
    return touchUA || window.innerWidth <= 1300;
  }, [ua]);
  const canvasLimitDebug = useMemo(() => {
    const isTouchTablet =
      isMobileLike ||
      (typeof navigator !== "undefined" && navigator.maxTouchPoints >= 2);
    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const mem =
      typeof navigator !== "undefined"
        ? ((navigator as any).deviceMemory as number | undefined)
        : undefined;
    const maxTouchPoints =
      typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0;
    const innerWidth = typeof window !== "undefined" ? window.innerWidth : 0;

    let limit: number | undefined;
    if (!isTouchTablet) limit = undefined;
    else if (mem !== undefined) {
      if (mem <= 2) limit = 4_000_000;
      else if (mem <= 4) limit = 8_000_000;
      else limit = 12_000_000;
    } else {
      limit = dpr >= 2 ? 8_000_000 : 12_000_000;
    }

    return { isTouchTablet, dpr, mem, maxTouchPoints, innerWidth, limit };
  }, [isMobileLike]);

  const MAX_CANVAS_PIXELS = canvasLimitDebug.limit;
  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const pdfZoomInitialScaleRef = useRef<number | null>(null);
  const pdfZoomManualRef = useRef(false);
  const lastManualZoomTimeRef = useRef<number>(0); // 마지막 수동 줌 시점 기록
  const userHasZoomedRef = useRef(false); // 사용자가 핀치/버튼으로 줌을 변경한 상태
  const PDF_ZOOM_STEP = 0.1;
  const PDF_ZOOM_MIN_SCALE = 0.5;
  const PDF_ZOOM_MAX_SCALE = 3;
  const PINCH_SELECTION_COOLDOWN_MS = 200;
  const MANUAL_ZOOM_COOLDOWN_MS = 300; // 수동 줌 후 자동 조정 대기 시간

  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  useEffect(() => {
    if (errorMsg) onLoadError?.();
  }, [errorMsg, onLoadError]);
  const [showPreviewEndOverlay, setShowPreviewEndOverlay] = useState(false);
  const previewEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayTouchStartYRef = useRef<number | null>(null);
  const [copyStatus, setCopyStatus] = useState<"" | "ok" | "fail">("");
  const [selection, setSelection] = useState<{
    text: string;
    top: number;
    left: number;
    show: boolean;
  }>({
    text: "",
    top: 0,
    left: 0,
    show: false,
  });
  const [layoutTick, setLayoutTick] = useState(0);
  const copyResetRef = useRef<number | null>(null);
  const selectionCacheRef = useRef<{
    range: Range | null;
    pageEl: HTMLElement | null;
    pageNumber: number | null;
    rects: HighlightRect[];
    text: string;
    visualScale: number;
  } | null>(null);

  const [pdfHighlights, setPdfHighlights] = useState<PdfHighlight[]>([]);
  const rafRefreshId = useRef<number | null>(null);
  const drawingModeRef = useRef(drawingMode);
  const penColorRef = useRef(penColor);
  const penWidthRef = useRef(penWidth);
  const penOpacityRef = useRef(penOpacity);
  const chapterStrokesRef = useRef(chapterStrokes);
  const showAnnotationsRef = useRef(showAnnotations);
  const livePointsRef = useRef<{ x: number; y: number }[]>([]);
  const isDrawingRef = useRef(false);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(
    new Map<number, { x: number; y: number }>()
  );
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef<number | null>(null);
  const pinchPreviewScaleRef = useRef(1);
  const isPinchingRef = useRef(false);
  const lastPinchAtRef = useRef(0);
  const pinchTargetPageRef = useRef<number | null>(null);
  const pinchTransformRafRef = useRef<number | null>(null);
  const pinchAnchorFrameCountRef = useRef(0);
  const pinchContainerRectRef = useRef<DOMRect | null>(null);
  const pinchFrozenTranslateRef = useRef<{ x: number; y: number } | null>(null);
  const pendingTransformRef = useRef<{
    scale: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pinchAnchorRef = useRef<{
    pageNumber: number;
    relX: number;
    relY: number;
    viewportX: number;
    viewportY: number;
  } | null>(null);
  const containerTouchActionRef = useRef<string | null>(null);
  const containerUserSelectRef = useRef<string | null>(null);
  // 핀치줌 디바운스: 연속 핀치 시 마지막 스케일만 렌더링 (중간 재렌더링 스킵)
  const pinchDebounceTimerRef = useRef<number | null>(null);
  const pendingPdfScaleRef = useRef<number | null>(null);
  // 스케일 전환 중 잘못된 pagechanging 이벤트 억제 (44→75 플래시 방지)
  const isScaleTransitioningRef = useRef(false);
  // 줌 시작 시 pending 페이지 스크롤 취소 (검색결과 클릭 후 줌 시 race condition 방지)
  const cancelNavigationRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    drawingModeRef.current = drawingMode;
    penColorRef.current = penColor;
    penWidthRef.current = penWidth;
    penOpacityRef.current = penOpacity;
    chapterStrokesRef.current = chapterStrokes;
    showAnnotationsRef.current = showAnnotations;
  }, [
    drawingMode,
    penColor,
    penWidth,
    penOpacity,
    chapterStrokes,
    showAnnotations,
  ]);

  useEffect(() => {
    pdfZoomInitialScaleRef.current = null;
    pdfZoomManualRef.current = false;
    userHasZoomedRef.current = false;
  }, [file]);

  useEffect(() => {
    // Keep local overlay in sync with global highlights (e.g., sidebar delete)
    setPdfHighlights((prev) => {
      const next = prev.filter((h) =>
        highlights.some((hl) => hl.id === h.id && !hl.deleted)
      );
      const existingIds = new Set(next.map((h) => h.id));
      const incoming = highlights
        .filter(
          (hl) =>
            !hl.deleted &&
            Array.isArray(hl.rects) &&
            hl.rects.length > 0 &&
            !existingIds.has(hl.id)
        )
        .map((hl) => ({ id: hl.id, rects: hl.rects || [] }));
      return incoming.length > 0 ? [...next, ...incoming] : next;
    });
  }, [highlights]);

  useEffect(() => {
    if (!viewerRef.current || !viewerContainerRef.current) return;
    const cleanup = applySearchHighlightWithRetry({
      viewerRoot: viewerRef.current,
      pdfSearchHighlight,
      getVisualScale,
      onScrollToFirstHit: (pageEl) => {
        // 핀치 줌 중, 스케일 전환 중, 또는 최근 줌 직후에는 스크롤하지 않음 (race condition 방지)
        // lastManualZoomTimeRef: setPdfScale/applyPdfZoom 시 업데이트 → 줌 완료 후에도 차단
        if (
          isPinchingRef.current ||
          isScaleTransitioningRef.current ||
          Date.now() - lastManualZoomTimeRef.current < 600
        )
          return;
        const hit = pageEl.querySelector<HTMLElement>(".pdf_search_hit");
        if (!hit || !viewerContainerRef.current) return;

        const container = viewerContainerRef.current;
        // 검색 hit 스크롤 직전에 남아 있는 페이지 네비게이션을 취소해
        // 확대/축소와 비동기 스크롤이 서로 덮어쓰는 race를 방지한다.
        cancelNavigationRef.current?.();
        cancelNavigationRef.current = null;
        const containerRect = container.getBoundingClientRect();
        const hitRect = hit.getBoundingClientRect();
        const visualScale = getVisualScale();

        const nextTop =
          (hitRect.top - containerRect.top) / visualScale +
          container.scrollTop -
          40;
        const nextLeft =
          (hitRect.left - containerRect.left) / visualScale +
          container.scrollLeft -
          20;

        container.scrollTo({
          top: Math.max(0, nextTop),
          left: Math.max(0, nextLeft),
          behavior: "auto",
        });
      },
    });
    return cleanup;
  }, [pdfSearchHighlight]);

  useEffect(() => {
    if (!activeHighlightId || !viewerContainerRef.current) return;
    const target = pdfHighlights.find((h) => h.id === activeHighlightId);
    if (!target || target.rects.length === 0) return;

    const first = target.rects[0];
    const containerEl = viewerContainerRef.current;

    // 페이지가 완전히 렌더링된 후 스크롤 (확대 상태에서도 정확하게 동작)
    requestAnimationFrame(() => {
      const pageEl = viewerRef.current?.querySelector<HTMLElement>(
        `.page[data-page-number="${first.pageNumber}"]`
      );
      if (!containerEl || !pageEl) return;

      const { pageOffsetLeft, pageOffsetTop, scaleX, scaleY } =
        getPageOffsetInfo(
          containerEl,
          pageEl,
          first.pageWidth,
          first.pageHeight
        );

      const nextTop = Math.max(0, pageOffsetTop + first.top * scaleY - 40);
      const nextLeft = Math.max(0, pageOffsetLeft + first.left * scaleX - 20);

      containerEl.scrollTo({
        top: nextTop,
        left: nextLeft,
        behavior: highlightScrollBehavior,
      });
    });
  }, [activeHighlightId, pdfHighlights, highlightScrollBehavior]);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pinchTransformRafRef.current !== null) {
        cancelAnimationFrame(pinchTransformRafRef.current);
        pinchTransformRafRef.current = null;
      }
    };
  }, []);

  // ----- Pen Canvas Helpers -----
  const getVisualScale = () => {
    if (!scaleWrapperRef.current) return 1;
    const raw = getComputedStyle(scaleWrapperRef.current).getPropertyValue(
      "--visual-scale"
    );
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 1;
  };

  const schedulePinchTransform = (
    scale: number,
    originX: number,
    originY: number
  ) => {
    pendingTransformRef.current = { scale, originX, originY };
    if (pinchTransformRafRef.current !== null) return;

    pinchTransformRafRef.current = requestAnimationFrame(() => {
      pinchTransformRafRef.current = null;
      const pending = pendingTransformRef.current;
      if (!pending) return;
      const layer = transformLayerRef.current;
      if (layer) {
        layer.style.transformOrigin = `${pending.originX}px ${pending.originY}px`;
        layer.style.transform = `scale(${pending.scale})`;
      }
    });
  };

  const resetPinchTransform = () => {
    if (pinchTransformRafRef.current !== null) {
      cancelAnimationFrame(pinchTransformRafRef.current);
      pinchTransformRafRef.current = null;
    }
    const layer = transformLayerRef.current;
    if (layer) {
      layer.style.transformOrigin = "0 0";
      layer.style.transform = "none";
    }
    pendingTransformRef.current = null;
  };

  const setPinchInteractionState = (active: boolean) => {
    const container = viewerContainerRef.current;
    if (!container) return;

    if (active) {
      if (containerTouchActionRef.current === null) {
        containerTouchActionRef.current = container.style.touchAction || "";
      }
      if (containerUserSelectRef.current === null) {
        containerUserSelectRef.current = container.style.userSelect || "";
      }
      container.style.touchAction = "none";
      container.style.userSelect = "none";
      container.dataset.pinching = "1";
      window.getSelection()?.removeAllRanges();
      return;
    }

    container.style.touchAction = containerTouchActionRef.current || "";
    container.style.userSelect = containerUserSelectRef.current || "";
    containerTouchActionRef.current = null;
    containerUserSelectRef.current = null;
    delete container.dataset.pinching;
  };

  const getPinchCenter = () => {
    const container = viewerContainerRef.current;
    const layer = transformLayerRef.current;
    if (!container || !layer) return null;
    const pts = Array.from(activePointersRef.current.values()) as Array<{
      x: number;
      y: number;
    }>;
    if (pts.length < 2) return null;
    const centerClientX = (pts[0].x + pts[1].x) / 2;
    const centerClientY = (pts[0].y + pts[1].y) / 2;
    // 핀치 시작 시 캐시한 containerRect 재사용 (매 프레임 layout flush 방지)
    const containerRect =
      pinchContainerRectRef.current ?? container.getBoundingClientRect();
    const viewportX = centerClientX - containerRect.left;
    const viewportY = centerClientY - containerRect.top;
    const contentX = viewportX + container.scrollLeft - layer.offsetLeft;
    const contentY = viewportY + container.scrollTop - layer.offsetTop;
    return { contentX, contentY, viewportX, viewportY };
  };

  const updatePinchAnchor = () => {
    const container = viewerContainerRef.current;
    const viewerRoot = viewerRef.current;
    if (!container || !viewerRoot) return;
    const pts = Array.from(activePointersRef.current.values()) as Array<{
      x: number;
      y: number;
    }>;
    if (pts.length < 2) return;

    const centerClientX = (pts[0].x + pts[1].x) / 2;
    const centerClientY = (pts[0].y + pts[1].y) / 2;
    // 제스처 시작 시 캐시한 containerRect 재사용 (getBoundingClientRect 호출 제거)
    const containerRect =
      pinchContainerRectRef.current ?? container.getBoundingClientRect();
    const viewportX = centerClientX - containerRect.left;
    const viewportY = centerClientY - containerRect.top;

    // elementFromPoint 대신 이전 anchor 페이지를 먼저 체크하는 빠른 경로
    // (elementFromPoint는 렌더 트리 순회로 비용이 크고, transform 상태에서 부정확)
    const pages = viewerRoot.querySelectorAll<HTMLElement>(".page");
    let pageEl: HTMLElement | null = null;
    let pageRect: DOMRect | null = null;

    // 이전 anchor의 페이지를 먼저 체크 (대부분 같은 페이지 — 빠른 경로)
    const prevPageNum = pinchAnchorRef.current?.pageNumber;
    if (prevPageNum) {
      const prev = viewerRoot.querySelector<HTMLElement>(
        `.page[data-page-number="${prevPageNum}"]`
      );
      if (prev) {
        const r = prev.getBoundingClientRect();
        if (
          centerClientX >= r.left &&
          centerClientX <= r.right &&
          centerClientY >= r.top &&
          centerClientY <= r.bottom &&
          r.width > 0
        ) {
          pageEl = prev;
          pageRect = r;
        }
      }
    }

    // 빠른 경로 실패 시 전체 페이지 순회 (드문 경우)
    if (!pageEl) {
      for (let i = 0; i < pages.length; i++) {
        const r = pages[i].getBoundingClientRect();
        if (
          centerClientX >= r.left &&
          centerClientX <= r.right &&
          centerClientY >= r.top &&
          centerClientY <= r.bottom &&
          r.width > 0
        ) {
          pageEl = pages[i];
          pageRect = r;
          break;
        }
      }
    }
    if (!pageEl || !pageRect) return;

    const pageNumber = Number(pageEl.dataset.pageNumber);
    if (isNaN(pageNumber)) return;
    const rect = pageRect;

    const relX = Math.min(
      1,
      Math.max(0, (centerClientX - rect.left) / rect.width)
    );
    const relY = Math.min(
      1,
      Math.max(0, (centerClientY - rect.top) / rect.height)
    );

    pinchAnchorRef.current = { pageNumber, relX, relY, viewportX, viewportY };
  };

  const getPdfZoomBounds = () => {
    const viewer = pdfViewerRef.current;
    const currentScale = viewer?.currentScale || 1;

    if (pdfZoomInitialScaleRef.current === null && currentScale > 0) {
      pdfZoomInitialScaleRef.current = currentScale;
    }

    // 초기 화면 크기를 최소값으로 설정 (더 축소 불가)
    const minScale = pdfZoomInitialScaleRef.current || 1;
    const maxScale = Math.max(minScale, PDF_ZOOM_MAX_SCALE);

    return { minScale, maxScale };
  };

  const getPageElementFromEvent = (e: React.PointerEvent) => {
    // 먼저 target에서 찾기 시도
    const target = e.target as HTMLElement;
    let pageEl = target.closest(".page") as HTMLElement | null;

    // target에서 못 찾으면 clientX/Y 좌표로 찾기
    if (!pageEl) {
      const elementAtPoint = document.elementFromPoint(e.clientX, e.clientY);
      if (elementAtPoint instanceof HTMLElement) {
        pageEl = elementAtPoint.closest(".page") as HTMLElement | null;
      }
    }

    if (!pageEl) return null;
    const pageNumber = Number(pageEl.dataset.pageNumber);
    if (isNaN(pageNumber)) return null;
    return { pageEl, pageNumber };
  };

  const getPageElementByNumber = (pageNumber: number) => {
    if (!viewerRef.current) return null;
    return viewerRef.current.querySelector<HTMLElement>(
      `.page[data-page-number="${pageNumber}"]`
    );
  };

  const getPageCanvasMetrics = (pageEl: HTMLElement) =>
    getCanvasMetrics(pageEl, getVisualScale);

  const getZoomRatio = () => {
    const viewer = pdfViewerRef.current;
    if (!viewer) return 1;
    const current = viewer.currentScale || 1;
    const initial = pdfZoomInitialScaleRef.current || current;
    return initial > 0 ? current / initial : 1;
  };

  const penRuntime = useMemo(
    () =>
      createPenLayerRuntime({
        viewerRef,
        viewerContainerRef,
        pageCanvasMapRef,
        currentPageRef,
        rafRefreshId,
        drawingModeRef,
        penColorRef,
        penWidthRef,
        penOpacityRef,
        chapterStrokesRef,
        showAnnotationsRef,
        livePointsRef,
        isDrawingRef,
        isPinchingRef,
        getVisualScale,
        getPagePoint,
        getPageElementFromEvent,
        getPageElementByNumber,
        getCanvasMetrics: getPageCanvasMetrics,
        getZoomRatio,
        drawStrokePath,
        addStroke,
        removeStroke,
        removeStrokes,
      }),
    [
      viewerRef,
      viewerContainerRef,
      pageCanvasMapRef,
      currentPageRef,
      rafRefreshId,
      drawingModeRef,
      penColorRef,
      penWidthRef,
      penOpacityRef,
      chapterStrokesRef,
      showAnnotationsRef,
      livePointsRef,
      isDrawingRef,
      addStroke,
      removeStroke,
      removeStrokes,
    ]
  );

  // 미리보기 한계 도달 → 블러 오버레이 표시 후 4초 뒤 자동 dismiss
  const handlePreviewLimitReached = useCallback(() => {
    setShowPreviewEndOverlay(true);
    if (previewEndTimerRef.current) clearTimeout(previewEndTimerRef.current);
    previewEndTimerRef.current = setTimeout(() => {
      setShowPreviewEndOverlay(false);
    }, 4000);
  }, []);

  // 페이지가 previewMaxPage 미만으로 변경되면 오버레이 dismiss
  // (navigation_bottom_box 이전 버튼 클릭 시 포함)
  useEffect(() => {
    if (!showPreviewEndOverlay || !previewMaxPage) return;
    if (currentPdfPage < previewMaxPage) {
      setShowPreviewEndOverlay(false);
      if (previewEndTimerRef.current) clearTimeout(previewEndTimerRef.current);
    }
  }, [currentPdfPage, showPreviewEndOverlay, previewMaxPage]);

  const scheduleRenderRefresh = useCallback(() => {
    if (rafRefreshId.current !== null) return;
    rafRefreshId.current = requestAnimationFrame(() => {
      rafRefreshId.current = null;
      penRuntime.syncPageCanvases();
      penRuntime.syncCanvasPointers();
      penRuntime.renderStaticCanvases();
      penRuntime.renderLiveCanvas();
    });
  }, [penRuntime]);

  const setPdfScale = useCallback(
    (nextScale: number, skipPenRender = false) => {
      const viewer = pdfViewerRef.current;
      if (!viewer) return;

      // 스케일 변경 시작 시 pending 페이지 스크롤 취소 (검색 결과 이동과 충돌 방지)
      cancelNavigationRef.current?.();
      cancelNavigationRef.current = null;

      const { minScale, maxScale } = getPdfZoomBounds();
      const clampedScale = Math.min(maxScale, Math.max(minScale, nextScale));
      if (Math.abs(clampedScale - viewer.currentScale) < 0.001) return;

      pdfZoomManualRef.current = true;
      lastManualZoomTimeRef.current = Date.now(); // 수동 줌 시점 기록
      userHasZoomedRef.current = true; // 사용자 줌 상태 기록
      viewer.currentScale = clampedScale;
      setPdfZoom(clampedScale); // 헤더와 연동
      // 핀치 종료 시에는 pagerendered 이벤트 후 단일 렌더로 처리 (이중 렌더 방지)
      if (!skipPenRender) scheduleRenderRefresh();
      setLayoutTick((prev) => prev + 1);
    },
    [scheduleRenderRefresh, setLayoutTick, setPdfZoom]
  );

  const applyPdfZoom = useCallback(
    (direction: "in" | "out", mouseX?: number, mouseY?: number) => {
      const viewer = pdfViewerRef.current;
      const container = viewerContainerRef.current;
      const viewerRoot = viewerRef.current;
      if (!viewer || !container || !viewerRoot) return;

      const currentScale = viewer.currentScale || 1;
      const nextScale =
        direction === "in"
          ? currentScale + PDF_ZOOM_STEP
          : currentScale - PDF_ZOOM_STEP;

      const { minScale, maxScale } = getPdfZoomBounds();
      const clampedScale = Math.min(maxScale, Math.max(minScale, nextScale));

      if (Math.abs(clampedScale - currentScale) < 0.001) return;

      const containerRect = container.getBoundingClientRect();

      // 마우스 위치가 없으면 화면 중앙을 앵커로 사용
      const anchorClientX =
        mouseX ?? containerRect.left + container.clientWidth / 2;
      const anchorClientY =
        mouseY ?? containerRect.top + container.clientHeight / 2;
      const viewportX = anchorClientX - containerRect.left;
      const viewportY = anchorClientY - containerRect.top;

      // 마우스 커서가 위치한 페이지 요소를 찾아 상대 좌표(relX, relY) 계산
      // (scaleRatio 방식은 패딩/여백이 비례하지 않아 부정확)
      let anchorPageNum = 0;
      let relX = 0;
      let relY = 0;
      const pages = viewerRoot.querySelectorAll<HTMLElement>(".page");
      for (let i = 0; i < pages.length; i++) {
        const r = pages[i].getBoundingClientRect();
        if (
          anchorClientX >= r.left &&
          anchorClientX <= r.right &&
          anchorClientY >= r.top &&
          anchorClientY <= r.bottom &&
          r.width > 0
        ) {
          anchorPageNum = Number(pages[i].dataset.pageNumber) || 0;
          relX = (anchorClientX - r.left) / r.width;
          relY = (anchorClientY - r.top) / r.height;
          break;
        }
      }

      // 페이지 위에 커서가 없으면 scaleRatio 폴백
      const usePageAnchor = anchorPageNum > 0;
      let scaleRatio = clampedScale / currentScale;
      let fallbackContentX = 0;
      let fallbackContentY = 0;
      if (!usePageAnchor) {
        fallbackContentX = (container.scrollLeft + viewportX) * scaleRatio;
        fallbackContentY = (container.scrollTop + viewportY) * scaleRatio;
      }

      // 스케일 변경 — PDF.js의 scrollPageIntoView 일시 억제
      cancelNavigationRef.current?.();
      cancelNavigationRef.current = null;

      pdfZoomManualRef.current = true;
      lastManualZoomTimeRef.current = Date.now();
      userHasZoomedRef.current = true;

      const origScrollMethod = viewer.scrollPageIntoView;
      viewer.scrollPageIntoView = () => {};
      viewer.currentScale = clampedScale;
      viewer.scrollPageIntoView = origScrollMethod;

      setPdfZoom(clampedScale);

      // 스크롤 보정: 페이지 요소의 새 rect 기반으로 정확한 위치 계산
      if (usePageAnchor) {
        const pageEl = viewerRoot.querySelector<HTMLElement>(
          `.page[data-page-number="${anchorPageNum}"]`
        );
        if (pageEl) {
          const newContainerRect = container.getBoundingClientRect();
          const newPageRect = pageEl.getBoundingClientRect();
          if (newPageRect.width > 0 && newPageRect.height > 0) {
            container.scrollLeft +=
              newPageRect.left -
              newContainerRect.left +
              relX * newPageRect.width -
              viewportX;
            container.scrollTop +=
              newPageRect.top -
              newContainerRect.top +
              relY * newPageRect.height -
              viewportY;
          }
        }
      } else {
        container.scrollLeft = fallbackContentX - viewportX;
        container.scrollTop = fallbackContentY - viewportY;
      }

      // 스크롤 클램핑
      const maxSL = Math.max(0, container.scrollWidth - container.clientWidth);
      const maxST = Math.max(
        0,
        container.scrollHeight - container.clientHeight
      );
      container.scrollLeft = Math.max(0, Math.min(container.scrollLeft, maxSL));
      container.scrollTop = Math.max(0, Math.min(container.scrollTop, maxST));

      // 렌더링 및 레이아웃 업데이트
      scheduleRenderRefresh();
      setLayoutTick((prev) => prev + 1);
    },
    [scheduleRenderRefresh, setLayoutTick, setPdfZoom]
  );

  useEffect(() => {
    if (!registerPdfZoomHandler) return;
    registerPdfZoomHandler(applyPdfZoom);
  }, [registerPdfZoomHandler, applyPdfZoom]);

  // pdfZoom 상태가 외부에서 변경되었을 때 (예: resetPdfZoom 버튼 클릭) viewer에 반영
  useEffect(() => {
    const viewer = pdfViewerRef.current;
    const container = viewerContainerRef.current;
    if (!viewer || !container) return;

    // 수동 줌 변경 중이 아니고, 현재 스케일과 다를 때만 적용
    if (pdfZoomManualRef.current) {
      pdfZoomManualRef.current = false;
      return;
    }

    const currentScale = viewer.currentScale || 1;
    if (Math.abs(currentScale - pdfZoom) > 0.001) {
      // 앵커 기반 스크롤 보정: 뷰포트 중앙의 페이지 + 상대 위치를 기준으로 보정
      // (contentY * scaleRatio 공식은 0페이지 등 비균일 요소가 있으면 오차 발생)
      const viewerRoot = viewerRef.current;
      const viewportX = container.clientWidth / 2;
      const viewportY = container.clientHeight / 2;
      const containerRect = container.getBoundingClientRect();
      const centerClientX = containerRect.left + viewportX;
      const centerClientY = containerRect.top + viewportY;

      // 뷰포트 중앙에 있는 페이지 요소 찾기
      let anchorPage: HTMLElement | null = null;
      let anchorRect: DOMRect | null = null;
      if (viewerRoot) {
        const pages = viewerRoot.querySelectorAll<HTMLElement>(".page");
        for (let i = 0; i < pages.length; i++) {
          const r = pages[i].getBoundingClientRect();
          if (
            centerClientY >= r.top &&
            centerClientY <= r.bottom &&
            r.width > 0
          ) {
            anchorPage = pages[i];
            anchorRect = r;
            break;
          }
        }
        // 페이지 사이 갭에 있으면 가장 가까운 페이지 사용
        if (!anchorPage && pages.length > 0) {
          let minDist = Infinity;
          for (let i = 0; i < pages.length; i++) {
            const r = pages[i].getBoundingClientRect();
            const dist = Math.min(
              Math.abs(centerClientY - r.top),
              Math.abs(centerClientY - r.bottom)
            );
            if (dist < minDist && r.width > 0) {
              minDist = dist;
              anchorPage = pages[i];
              anchorRect = r;
            }
          }
        }
      }

      // 앵커의 페이지 내 상대 좌표 (0~1)
      const relX = anchorRect
        ? Math.min(1, Math.max(0, (centerClientX - anchorRect.left) / anchorRect.width))
        : 0.5;
      const relY = anchorRect
        ? Math.min(1, Math.max(0, (centerClientY - anchorRect.top) / anchorRect.height))
        : 0.5;
      const anchorPageNumber = anchorPage?.dataset.pageNumber;

      // 외부 줌 반영 전에 pending 페이지 스크롤 취소
      cancelNavigationRef.current?.();
      cancelNavigationRef.current = null;

      // 외부에서 줌이 리셋되면 사용자 줌 상태도 초기화
      userHasZoomedRef.current = false;
      viewer.currentScale = pdfZoom;

      // 앵커 페이지를 기준으로 정확한 스크롤 위치 계산
      if (anchorPageNumber != null && viewerRoot) {
        const pageEl = viewerRoot.querySelector<HTMLElement>(
          `.page[data-page-number="${anchorPageNumber}"]`
        );
        if (pageEl) {
          const cRect = container.getBoundingClientRect();
          const pRect = pageEl.getBoundingClientRect();
          if (pRect.width > 0 && pRect.height > 0) {
            container.scrollLeft +=
              pRect.left - cRect.left + relX * pRect.width - viewportX;
            container.scrollTop +=
              pRect.top - cRect.top + relY * pRect.height - viewportY;
          }
        }
      } else {
        // 앵커를 찾지 못한 경우 기존 비례 공식으로 fallback
        const contentX = container.scrollLeft + viewportX;
        const contentY = container.scrollTop + viewportY;
        const scaleRatio = pdfZoom / currentScale;
        container.scrollLeft = contentX * scaleRatio - viewportX;
        container.scrollTop = contentY * scaleRatio - viewportY;
      }

      // viewer.currentScale 설정 중 PDF.js가 pagechanging을 발생시키고,
      // 미리보기 모드에서 attemptPageNavigation(maxPage) RAF가 예약될 수 있음.
      // 스크롤 보정 완료 후 이 pending 네비게이션을 취소하여 마지막 페이지로 이동 방지.
      cancelNavigationRef.current?.();
      cancelNavigationRef.current = null;

      scheduleRenderRefresh();
      setLayoutTick((prev) => prev + 1);
    }
  }, [pdfZoom, scheduleRenderRefresh, setLayoutTick]);

  const onPageChangeFiltered = useCallback(
    (page: number) => {
      // 스케일 전환 중(setPdfScale 후 pagerendered 전)에는 잘못된 pagechanging 무시
      // PDF.js가 내부적으로 scrollTop을 임시 변경할 때 발생하는 오페이지 이벤트 차단
      if (isScaleTransitioningRef.current) return;
      onPageChange?.(page);
    },
    [onPageChange]
  );

  usePdfJsViewer({
    file,
    viewerContainerRef,
    viewerRef,
    pdfViewerRef,
    pageCanvasMapRef,
    currentPageRef,
    rafRefreshId,
    MAX_CANVAS_PIXELS,
    isMobileLike,
    isMobileSafari,
    onPageChange: onPageChangeFiltered,
    onPagesCount,
    registerGoToPage,
    setPdfTextPages,
    setLoading,
    setLoadProgress,
    setErrorMsg,
    scheduleRenderRefresh,
    disposePageEntry: penRuntime.disposePageEntry,
    preferSpreadView: !isMobileLike && !forceSinglePage,
    setPdfLoadTime,
    setPdfIsLoading,
    setPdfLoadProgress,
    previewMaxPage,
    onPreviewLimitReached: handlePreviewLimitReached,
    cancelNavigationRef,
  });

  usePdfPenLayer({
    penRuntime,
    viewerRef,
    viewerContainerRef,
    pageCanvasMapRef,
    showAnnotations,
    scheduleRenderRefresh,
    setLayoutTick,
  });

  useEffect(() => {
    const viewer = pdfViewerRef.current;
    const containerEl = viewerContainerRef.current;
    const contentEl = viewerRef.current;
    if (!viewer || !containerEl || !contentEl) return;

    const frameId = requestAnimationFrame(() => {
      if (!isMobileLike) {
        if (viewer.currentScale < 1) viewer.currentScale = 1;
        return;
      }

      // 사용자가 핀치/버튼으로 줌을 변경한 상태이면 자동 스케일 조정 건너뛰기
      if (userHasZoomedRef.current) {
        return;
      }

      // 수동 줌 변경 후 일정 시간 동안 자동 스케일 조정 건너뛰기
      const timeSinceManualZoom = Date.now() - lastManualZoomTimeRef.current;
      if (timeSinceManualZoom < MANUAL_ZOOM_COOLDOWN_MS) {
        return;
      }

      // pdfZoomManualRef 플래그도 확인 (추가 안전장치)
      if (pdfZoomManualRef.current) {
        pdfZoomManualRef.current = false;
        return;
      }

      const pageEl = contentEl.querySelector<HTMLElement>(".page");
      if (!pageEl) return;

      const { paddingLeft, paddingRight } = getComputedStyle(contentEl);
      const availableWidth = Math.max(
        0,
        containerEl.clientWidth -
          (parseFloat(paddingLeft) || 0) -
          (parseFloat(paddingRight) || 0)
      );
      if (!availableWidth) return;

      const currentScale = viewer.currentScale || 1;
      const pageWidth = pageEl.getBoundingClientRect().width;
      if (!pageWidth) return;

      const nextScale = Math.min(
        1,
        (currentScale * availableWidth) / pageWidth
      );
      if (Math.abs(nextScale - currentScale) >= 0.01) {
        // 스크롤 위치 보정: 현재 보고 있는 위치를 유지
        const viewportX = containerEl.clientWidth / 2;
        const viewportY = containerEl.clientHeight / 2;
        const contentX = containerEl.scrollLeft + viewportX;
        const contentY = containerEl.scrollTop + viewportY;
        const scaleRatio = nextScale / currentScale;

        viewer.currentScale = nextScale;

        containerEl.scrollLeft = contentX * scaleRatio - viewportX;
        containerEl.scrollTop = contentY * scaleRatio - viewportY;
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [loading, layoutTick, isMobileLike]);

  useEffect(() => {
    const viewer = pdfViewerRef.current;
    if (!viewer || loading) return;
    if (pdfZoomInitialScaleRef.current !== null) return;

    const frameId = requestAnimationFrame(() => {
      const nextScale = pdfViewerRef.current?.currentScale || 1;
      if (pdfZoomInitialScaleRef.current === null) {
        pdfZoomInitialScaleRef.current = nextScale;
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [loading, layoutTick]);

  // 1쪽 보기/2쪽 보기 전환
  // 패널 토글 시 현재 보고 있는 페이지의 스크롤 위치를 보존
  useEffect(() => {
    const viewer = pdfViewerRef.current;
    const container = viewerContainerRef.current;
    const viewerRoot = viewerRef.current;
    if (!viewer) return;

    // 현재 보고 있는 페이지 번호 저장
    const currentPage = viewer.currentPageNumber;

    // 패널 토글로 인한 레이아웃 변경 후 현재 페이지로 스크롤 복원
    if (container && viewerRoot && currentPage) {
      requestAnimationFrame(() => {
        const pageEl = viewerRoot.querySelector<HTMLElement>(
          `.page[data-page-number="${currentPage}"]`
        );
        if (!pageEl) return;

        const containerRect = container.getBoundingClientRect();
        const pageRect = pageEl.getBoundingClientRect();

        // 페이지의 상단이 컨테이너 뷰포트 밖으로 벗어났으면 복원
        const pageTopInView = pageRect.top - containerRect.top;
        const pageBottomInView = pageRect.bottom - containerRect.top;
        const isPageVisible =
          pageTopInView < containerRect.height && pageBottomInView > 0;

        if (!isPageVisible) {
          // 페이지가 보이지 않으면 페이지 상단으로 스크롤
          container.scrollTop += pageTopInView - 4; // 4px 여유
        }

        // 수평 스크롤이 컨텐츠 범위를 벗어났으면 보정
        if (
          container.scrollLeft >
          container.scrollWidth - container.clientWidth
        ) {
          container.scrollLeft = Math.max(
            0,
            container.scrollWidth - container.clientWidth
          );
        }
      });
    }
  }, [forceSinglePage, scheduleRenderRefresh]);

  // viewMode 변경 시 PDF spreadMode 적용
  useEffect(() => {
    const viewer = pdfViewerRef.current;
    if (!viewer) return;
    const viewerEl = viewer.viewer as HTMLDivElement | null;

    // pdfViewer 내부 page view 기준으로 정확한 0페이지 크기 계산
    const getZeroDims = () => {
      const pages = (viewer as any)._pages;
      if (!pages || pages.length === 0) return null;
      const pv = pages[0];
      return { w: `${Math.floor(pv.width)}px`, h: Math.floor(pv.height / 3) };
    };

    const insertZeroPage = (
      container: Element,
      beforeEl: Element,
      dims: { w: string; h: number }
    ) => {
      const zeroPage = document.createElement("div");
      zeroPage.className = "page";
      zeroPage.dataset.pageNumber = "0";
      zeroPage.setAttribute("role", "region");
      zeroPage.style.cssText = `width:${dims.w};height:${dims.h}px;background:#fff;`;
      container.insertBefore(zeroPage, beforeEl);
    };

    if (viewMode === "double") {
      // EVEN spread → [page1], [page2,page3], [page4,page5]...
      viewer.spreadMode = SpreadMode.EVEN;

      // spread 적용 후 0페이지를 첫 번째 .spread에 삽입 → [0,1], [2,3], [4,5]...
      if (viewerEl) {
        const firstSpread = viewerEl.querySelector(".spread");
        const firstPage = firstSpread?.querySelector(".page");
        const dims = getZeroDims();
        if (firstSpread && firstPage && dims) {
          insertZeroPage(firstSpread, firstPage, dims);
        }
      }
    } else {
      viewer.spreadMode = SpreadMode.NONE;

      // single 모드: 0페이지를 첫 번째 .page 앞에 삽입
      if (viewerEl) {
        viewerEl.querySelector('.page[data-page-number="0"]')?.remove();
        const pages = (viewer as any)._pages;
        const firstPageEl = pages?.[0]?.div as HTMLElement | undefined;
        const dims = getZeroDims();
        if (firstPageEl && dims) {
          insertZeroPage(viewerEl, firstPageEl, dims);
        }
      }
    }

    scheduleRenderRefresh();
    setLayoutTick((prev) => prev + 1);
  }, [viewMode, scheduleRenderRefresh]);

  const getClosestPageEl = (node: Node | null) => {
    if (!node) return null;
    const element = node instanceof Element ? node : node.parentElement;
    const pageEl = element?.closest?.(".page");
    return pageEl instanceof HTMLElement ? pageEl : null;
  };

  const getPageElFromRange = (range: Range) =>
    getClosestPageEl(range.startContainer) ||
    getClosestPageEl(range.endContainer);

  const getSelectionSnapshot = () => {
    if (selectionCacheRef.current) return selectionCacheRef.current;

    const sel = window.getSelection();
    if (
      !sel ||
      sel.isCollapsed ||
      sel.rangeCount === 0 ||
      !sel.toString().trim()
    ) {
      return null;
    }

    const range = sel.getRangeAt(0);
    const pageEl = getPageElFromRange(range);
    if (!pageEl) return null;
    const parsedPageNumber = Number(pageEl.dataset.pageNumber);
    if (isNaN(parsedPageNumber)) return null;
    const pageNumber = parsedPageNumber;

    const visualScale = getVisualScale();
    const rects = buildHighlightRectsFromSelection(range, pageEl, visualScale);
    const snapshot = {
      range: range.cloneRange(),
      pageEl,
      pageNumber,
      rects,
      text: sel.toString().trim(),
      visualScale,
    };
    selectionCacheRef.current = snapshot;
    return snapshot;
  };

  const getSelectionTextSafe = () =>
    (
      selectionCacheRef.current?.text ||
      selection.text ||
      window.getSelection()?.toString() ||
      ""
    ).trim();

  const replaceClipboardText = (text: string) =>
    text.replace(/[^\s]/g, COPY_REPLACE_CHAR);

  // ✅ 현재 선택된 텍스트를 강제로 클립보드에 넣는 함수
  const handleCopySelection = async () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    const text = getSelectionTextSafe();

    if (!text.trim()) {
      setCopyStatus("fail");
      copyResetRef.current = window.setTimeout(() => setCopyStatus(""), 1000);
      return;
    }

    try {
      const replacedText = replaceClipboardText(text);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(replacedText);
      } else {
        // fallback that still works after mobile Safari clears the live selection
        const textarea = document.createElement("textarea");
        textarea.value = replacedText;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!success) {
          throw new Error("execCommand copy returned false");
        }
      }
      setCopyStatus("ok");
    } catch (e) {
      console.error("copy failed", e);
      setCopyStatus("fail");
    } finally {
      copyResetRef.current = window.setTimeout(() => setCopyStatus(""), 1000);
    }
  };

  const handleContainerCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const container = viewerContainerRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.isCollapsed || !sel.toString().trim()) {
      return;
    }

    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    if (!anchor || !focus) return;

    const isInside = container.contains(anchor) && container.contains(focus);
    if (!isInside) return;

    const replacedText = replaceClipboardText(sel.toString());
    if (!replacedText.trim()) return;

    e.preventDefault();
    e.clipboardData.setData("text/plain", replacedText);
  };

  const shouldSkipSelection = () => {
    if (isPinchingRef.current) return true;
    const lastPinchAt = lastPinchAtRef.current;
    if (!lastPinchAt) return false;
    return Date.now() - lastPinchAt < PINCH_SELECTION_COOLDOWN_MS;
  };

  const checkPdfSelection = () => {
    if (shouldSkipSelection()) {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }
    if (drawingMode !== "idle") {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }

    const sel = window.getSelection();
    if (
      !sel ||
      sel.isCollapsed ||
      !sel.toString().trim() ||
      !viewerContainerRef.current ||
      sel.rangeCount === 0
    ) {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }

    const isInsideAnchor =
      viewerContainerRef.current.contains(sel.anchorNode as Node) &&
      viewerContainerRef.current.contains(sel.focusNode as Node);
    if (!isInsideAnchor) {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }

    const range = sel.getRangeAt(0);
    const clientRects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 0 && r.height > 0
    );

    if (clientRects.length === 0) {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }

    // 첫 번째 줄의 rect를 기준으로 메뉴 위치 결정 (드래그 중 줄이 바뀌어도 안정적)
    const firstRect = clientRects[0];

    const menuWidth = 140;
    const menuHeight = 40;
    const margin = 5;
    const sideGap = 1;
    const top = firstRect.top + firstRect.height / 2 - menuHeight / 2;
    const left = firstRect.left - menuWidth - sideGap;

    const clampedTop = Math.min(
      Math.max(top, margin),
      window.innerHeight - menuHeight - margin
    );
    const clampedLeft = Math.min(
      Math.max(left, margin),
      window.innerWidth - menuWidth - margin
    );

    const pageEl = getPageElFromRange(range);
    const pageNumber = pageEl
      ? Number(pageEl.dataset.pageNumber) || null
      : null;
    const visualScale = getVisualScale();
    const rects =
      pageEl && pageNumber
        ? buildHighlightRectsFromSelection(range, pageEl, visualScale)
        : [];
    selectionCacheRef.current = {
      range: range.cloneRange(),
      pageEl,
      pageNumber,
      text: sel.toString().trim(),
      visualScale,
      rects,
    };

    setSelection({
      text: sel.toString().trim(),
      top: clampedTop,
      left: clampedLeft,
      show: true,
    });
  };

  const scheduleSelectionCheck = () => {
    setTimeout(checkPdfSelection, 80);
  };

  const finishPinchZoom = () => {
    // 디바운스 RAF가 이미 예약된 경우 재진입 방지
    // (두 손가락을 순차적으로 뗄 때 clearPinchPointer가 finishPinchZoom을 두 번 호출할 수 있음)
    // 두 번째 호출에서 resetPinchTransform()이 CSS preview를 조기 제거하면
    // 한 프레임 동안 다른 페이지가 보이는 깜박임이 발생함
    if (pinchDebounceTimerRef.current !== null) {
      activePointersRef.current.clear();
      return;
    }

    const viewer = pdfViewerRef.current;
    const container = viewerContainerRef.current;
    const viewerRoot = viewerRef.current;

    // 핀치 종료 직전 앵커를 최신 위치로 강제 갱신
    // (updatePinchAnchor가 5프레임마다 실행되므로 마지막 앵커가 최대 4프레임 전 위치일 수 있음)
    updatePinchAnchor();
    const anchor = pinchAnchorRef.current;

    // 모든 포인터 강제 초기화 (아이패드 터치 이벤트 꼬임 방지)
    activePointersRef.current.clear();

    if (!viewer || !container || !viewerRoot || !anchor) {
      resetPinchTransform();
      setPinchInteractionState(false);
      lastPinchAtRef.current = Date.now();
      pinchStartDistRef.current = null;
      pinchStartScaleRef.current = null;
      pinchPreviewScaleRef.current = 1;
      isPinchingRef.current = false;
      pinchAnchorRef.current = null;
      pinchAnchorFrameCountRef.current = 0;
      pinchContainerRectRef.current = null;
      pinchFrozenTranslateRef.current = null;
      return;
    }

    // 메모리 최적화: 변경이 너무 작으면 스킵
    const previewScale = pinchPreviewScaleRef.current || 1;
    if (Math.abs(previewScale - 1) < 0.05) {
      // 5% 미만 변경은 무시
      resetPinchTransform();
      setPinchInteractionState(false);
      penRuntime.resetTouchState();
      lastPinchAtRef.current = Date.now();
      pinchStartDistRef.current = null;
      pinchStartScaleRef.current = null;
      pinchPreviewScaleRef.current = 1;
      isPinchingRef.current = false;
      pinchAnchorRef.current = null;
      pinchAnchorFrameCountRef.current = 0;
      pinchContainerRectRef.current = null;
      pinchFrozenTranslateRef.current = null;
      return;
    }

    const baseScale = pinchStartScaleRef.current ?? viewer.currentScale ?? 1;
    const nextScale = baseScale * previewScale;

    // 스케일 적용 전 현재 페이지 상태 저장
    const pageElBefore = viewerRoot.querySelector<HTMLElement>(
      `.page[data-page-number="${anchor.pageNumber}"]`
    );

    if (!pageElBefore) {
      pdfZoomManualRef.current = true; // 자동 스케일 조정 방지
      setPdfScale(nextScale);
      resetPinchTransform();
      setPinchInteractionState(false);
      lastPinchAtRef.current = Date.now();
      pinchStartDistRef.current = null;
      pinchStartScaleRef.current = null;
      pinchPreviewScaleRef.current = 1;
      isPinchingRef.current = false;
      pinchAnchorRef.current = null;
      pinchAnchorFrameCountRef.current = 0;
      pinchContainerRectRef.current = null;
      pinchFrozenTranslateRef.current = null;
      return;
    }

    // transform-origin 방식: translate가 없으므로 pageRectBefore 불필요
    // origin 기반 스크롤 보정: 핀치 중심(origin)이 scale 후에도 동일 viewport 위치에 오도록

    // 앵커 정보를 클로저로 캡처 (finishPinchZoom 종료 후 ref가 null로 정리되기 전에 저장)
    const capturedAnchor = { ...anchor };

    // ── 동기 실행: 스케일 변경 + 스크롤 보정을 같은 이벤트 루프에서 처리 ──────
    // RAF로 다음 프레임에 미루면 현재 프레임 페인트 → RAF 실행 사이에 갭이 생겨
    // 다른 페이지가 잠깐 보이는 깜박임이 발생함. 동기 실행으로 갭 제거.
    pendingPdfScaleRef.current = null;
    if (pinchDebounceTimerRef.current !== null) {
      cancelAnimationFrame(pinchDebounceTimerRef.current);
      pinchDebounceTimerRef.current = null;
    }

    // 줌 시작: 검색결과 클릭 후 pending 중인 페이지 스크롤 취소 (race condition 방지)
    cancelNavigationRef.current?.();
    cancelNavigationRef.current = null;

    // PDF.js 스케일 적용 (재렌더링 트리거)
    // 전환 중 잘못된 pagechanging 이벤트 억제 시작
    isScaleTransitioningRef.current = true;
    pdfZoomManualRef.current = true;

    // skipPenRender=true: 펜 레이어 렌더는 pagerendered 이벤트 후 1번만 실행 (이중 렌더 방지)
    setPdfScale(nextScale, true);

    // scale(1)로 이중 스케일 방지
    const dLayer = transformLayerRef.current;
    if (dLayer) dLayer.style.transform = "scale(1)";

    // 스크롤 보정: 앵커 포인트가 핀치 시작 시와 동일한 뷰포트 위치에 오도록
    // getBoundingClientRect는 현재 스크롤 위치에서의 델타를 계산하므로
    // PDF.js가 내부적으로 변경한 스크롤 위치가 무엇이든 올바른 최종 위치를 산출함
    // (중간 스크롤 복원 단계를 제거하여 모바일 컴포지터의 중간 프레임 깜박임 방지)
    const dPageEl = viewerRoot.querySelector<HTMLElement>(
      `.page[data-page-number="${capturedAnchor.pageNumber}"]`
    );
    if (dPageEl) {
      const cRect = container.getBoundingClientRect();
      const pRect = dPageEl.getBoundingClientRect();
      if (pRect.width > 0 && pRect.height > 0) {
        container.scrollLeft +=
          pRect.left -
          cRect.left +
          capturedAnchor.relX * pRect.width -
          capturedAnchor.viewportX;
        container.scrollTop +=
          pRect.top -
          cRect.top +
          capturedAnchor.relY * pRect.height -
          capturedAnchor.viewportY;
        // iOS/Android rubber-band 방지: 유효 범위로 클램프
        const maxSL = Math.max(
          0,
          container.scrollWidth - container.clientWidth
        );
        container.scrollLeft = Math.max(
          0,
          Math.min(container.scrollLeft, maxSL)
        );
        const maxST = Math.max(
          0,
          container.scrollHeight - container.clientHeight
        );
        container.scrollTop = Math.max(
          0,
          Math.min(container.scrollTop, maxST)
        );
      }
    }

    // setPdfScale() 중 PDF.js가 pagechanging 이벤트를 발생시키고,
    // 미리보기 모드에서 previewMaxPage 초과로 판단하면 attemptPageNavigation(maxPage)가
    // RAF로 예약됨. 스크롤 보정 후 이 pending 네비게이션을 취소하여 마지막 페이지로
    // 강제 이동되는 것을 방지.
    cancelNavigationRef.current?.();
    cancelNavigationRef.current = null;

    // 스크롤 보정 완료 후 touchAction 복원
    setPinchInteractionState(false);
    isPinchingRef.current = false;

    // pagerendered 이벤트 후 scale(1) 제거 + 드리프트 교정
    const DEBOUNCE_RENDER_TIMEOUT_MS = 600;
    let debounceRenderHandled = false;
    const onDebouncePageRendered = () => {
      if (debounceRenderHandled) return;
      debounceRenderHandled = true;

      // scale(1) → none: 시각적으로 동일 (덜컹거림 없음)
      if (dLayer) {
        dLayer.style.transformOrigin = "0 0";
        dLayer.style.transform = "none";
      }

      // 스케일 전환 완료: 억제 플래그 해제 후 올바른 페이지 번호 전파
      isScaleTransitioningRef.current = false;
      if (capturedAnchor.pageNumber)
        onPageChange?.(capturedAnchor.pageNumber);

      // 드리프트 교정: 3px 미만은 무시 (부동소수점 오차에 의한 미세 점프 방지)
      const dPageElAfter = viewerRoot.querySelector<HTMLElement>(
        `.page[data-page-number="${capturedAnchor.pageNumber}"]`
      );
      if (dPageElAfter) {
        const cRectAfter = container.getBoundingClientRect();
        const pRectAfter = dPageElAfter.getBoundingClientRect();
        if (pRectAfter.width > 0 && pRectAfter.height > 0) {
          const driftX =
            pRectAfter.left -
            cRectAfter.left +
            capturedAnchor.relX * pRectAfter.width -
            capturedAnchor.viewportX;
          const driftY =
            pRectAfter.top -
            cRectAfter.top +
            capturedAnchor.relY * pRectAfter.height -
            capturedAnchor.viewportY;
          if (Math.abs(driftX) > 3) container.scrollLeft += driftX;
          if (Math.abs(driftY) > 3) container.scrollTop += driftY;
          const maxSL2 = Math.max(
            0,
            container.scrollWidth - container.clientWidth
          );
          container.scrollLeft = Math.max(
            0,
            Math.min(container.scrollLeft, maxSL2)
          );
          const maxST2 = Math.max(
            0,
            container.scrollHeight - container.clientHeight
          );
          container.scrollTop = Math.max(
            0,
            Math.min(container.scrollTop, maxST2)
          );
        }
      }

      // 스케일 변경 후 캔버스 정리 및 렌더링 갱신
      requestAnimationFrame(() => {
        penRuntime.forceCleanupOffscreenCanvases();
        penRuntime.syncPageCanvases();
        penRuntime.syncCanvasPointers();
        penRuntime.renderStaticCanvases(true, true);
        penRuntime.renderLiveCanvas();

        const renderRestPages = () =>
          penRuntime.renderStaticCanvases(true, false);
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(renderRestPages, { timeout: 500 });
        } else {
          setTimeout(renderRestPages, 200);
        }
      });
    };

    viewer.eventBus?.on("pagerendered", onDebouncePageRendered, {
      once: true,
    });
    setTimeout(() => {
      if (!debounceRenderHandled) {
        viewer.eventBus?.off("pagerendered", onDebouncePageRendered);
        onDebouncePageRendered();
      }
    }, DEBOUNCE_RENDER_TIMEOUT_MS);
    // ── 동기 실행 끝 ─────────────────────────────────────────────────────────

    // 펜 레이어의 터치 상태도 초기화
    penRuntime.resetTouchState();

    lastPinchAtRef.current = Date.now();
    pinchStartDistRef.current = null;
    pinchStartScaleRef.current = null;
    pinchPreviewScaleRef.current = 1;
    pinchAnchorRef.current = null;
    pinchAnchorFrameCountRef.current = 0;
    pinchContainerRectRef.current = null;
    pinchFrozenTranslateRef.current = null;

    // PDF.js의 실제 현재 페이지와 동기화
    const actualPage = viewer?.currentPageNumber;
    if (
      actualPage &&
      pinchTargetPageRef.current &&
      actualPage !== pinchTargetPageRef.current
    ) {
      onPageChange?.(pinchTargetPageRef.current);
    }
    pinchTargetPageRef.current = null;

    // 즉시 오프스크린 캔버스 정리 (scheduleRenderRefresh는 debounce 커밋 후 실행)
    requestAnimationFrame(() => {
      penRuntime.forceCleanupOffscreenCanvases();
    });
  };

  const handleContainerPointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    // 펜 또는 마우스 입력 처리 (펜/형광펜 모드일 때만)
    if (
      (e.pointerType === "pen" || e.pointerType === "mouse") &&
      (drawingMode === "pen" || drawingMode === "highlighter")
    ) {
      e.preventDefault(); // 텍스트 선택 방지
      penRuntime.handlePenStart(e);
      return;
    }

    // 펜 입력은 기본적으로 스킵
    if (e.pointerType === "pen") return;

    if (e.pointerType !== "touch") return;

    // 재렌더링 중이거나 핀치가 진행 중이면 이전 상태 강제 초기화 (아이패드 이슈 방지)
    if (isPinchingRef.current) {
      activePointersRef.current.clear();
      pinchStartDistRef.current = null;
      pinchStartScaleRef.current = null;
      pinchPreviewScaleRef.current = 1;
      resetPinchTransform();
    }

    activePointersRef.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
    });

    if (activePointersRef.current.size === 2) {
      // 핀치줌 시작 시 펜 드로잉 중단
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        livePointsRef.current = [];
        currentPageRef.current = null;
        scheduleRenderRefresh();
      }

      const pts = Array.from(activePointersRef.current.values()) as Array<{
        x: number;
        y: number;
      }>;
      pinchStartDistRef.current = Math.hypot(
        pts[1].x - pts[0].x,
        pts[1].y - pts[0].y
      );
      const viewer = pdfViewerRef.current;

      // 디바운스 중 새 핀치: 대기 중인 스케일을 즉시 커밋하여 올바른 base scale 확보
      // → viewer.currentScale을 즉시 업데이트해야 새 핀치가 올바른 배율에서 시작
      // → 이전 렌더링은 PDF.js가 새 setPdfScale 호출 시 내부적으로 취소함
      if (pendingPdfScaleRef.current !== null) {
        if (pinchDebounceTimerRef.current !== null) {
          cancelAnimationFrame(pinchDebounceTimerRef.current);
          pinchDebounceTimerRef.current = null;
        }
        const scaleToCommit = pendingPdfScaleRef.current;
        pendingPdfScaleRef.current = null;
        pdfZoomManualRef.current = true;
        setPdfScale(scaleToCommit); // viewer.currentScale 즉시 업데이트
        // CSS transform은 아래 resetPinchTransform()에서 제거됨
      }

      // 핀치 시작 즉시 pending 페이지 스크롤 취소 (검색결과 후 빠른 핀치 시 race 방지)
      cancelNavigationRef.current?.();
      cancelNavigationRef.current = null;

      pinchStartScaleRef.current = viewer?.currentScale || 1;
      pinchPreviewScaleRef.current = 1;
      isPinchingRef.current = true;
      // 현재 페이지 번호 저장 (핀치 줌 중 페이지 변경 이벤트 무시용)
      pinchTargetPageRef.current = currentPdfPage;
      // containerRect 캐시 (제스처 중 getBoundingClientRect 재호출 방지)
      pinchContainerRectRef.current =
        viewerContainerRef.current?.getBoundingClientRect() ?? null;
      pinchAnchorFrameCountRef.current = 0;
      pinchFrozenTranslateRef.current = null;
      updatePinchAnchor();
      setPinchInteractionState(true);
      resetPinchTransform();
      e.preventDefault();
    }
  };

  const handleContainerPointerMove = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    // 펜 또는 마우스 입력 처리 (펜/형광펜 모드일 때만)
    if (
      (e.pointerType === "pen" || e.pointerType === "mouse") &&
      (drawingMode === "pen" || drawingMode === "highlighter")
    ) {
      e.preventDefault(); // 텍스트 선택 방지
      penRuntime.handlePenMove(e);
      return;
    }

    // 펜으로 그리기 중이면 스크롤 방지
    if (e.pointerType === "pen" && isDrawingRef.current) {
      e.preventDefault();
      return;
    }

    if (e.pointerType !== "touch") return;

    // 포인터가 등록되지 않았으면 스킵 (아이패드 터치 이벤트 꼬임 방지)
    if (!activePointersRef.current.has(e.pointerId)) {
      return;
    }

    activePointersRef.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
    });

    // 정확히 2개의 포인터가 있을 때만 핀치 진행
    if (activePointersRef.current.size !== 2) return;

    const pts = Array.from(activePointersRef.current.values()) as Array<{
      x: number;
      y: number;
    }>;
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    if (!pinchStartDistRef.current) {
      pinchStartDistRef.current = dist;
      const viewer = pdfViewerRef.current;
      pinchStartScaleRef.current = viewer?.currentScale || 1;
      pinchPreviewScaleRef.current = 1;
      isPinchingRef.current = true;
      pinchAnchorFrameCountRef.current = 0;
      pinchFrozenTranslateRef.current = null;
      setPinchInteractionState(true);
      resetPinchTransform();
      return;
    }

    const viewer = pdfViewerRef.current;
    if (!viewer) return;

    const baseScale = pinchStartScaleRef.current ?? viewer.currentScale ?? 1;
    const ratio = dist / pinchStartDistRef.current;
    const nextScale = baseScale * ratio;
    const { minScale, maxScale } = getPdfZoomBounds();
    const clampedScale = Math.min(maxScale, Math.max(minScale, nextScale));
    const previewScale = baseScale ? clampedScale / baseScale : 1;
    pinchPreviewScaleRef.current = previewScale;
    isPinchingRef.current = true;

    // updatePinchAnchor는 5프레임마다 1회만 실행 (layout flush 80% 감소)
    pinchAnchorFrameCountRef.current += 1;
    if (pinchAnchorFrameCountRef.current % 5 === 0) {
      updatePinchAnchor();
    }

    const isClamped = nextScale < minScale || nextScale > maxScale;
    const center = getPinchCenter();
    if (center) {
      let originX: number;
      let originY: number;
      if (isClamped) {
        // scale 한계 도달 시 origin을 고정 — 손가락 이동 중 content 위치 변동 방지
        if (!pinchFrozenTranslateRef.current) {
          pinchFrozenTranslateRef.current = {
            x: center.contentX,
            y: center.contentY,
          };
        }
        originX = pinchFrozenTranslateRef.current.x;
        originY = pinchFrozenTranslateRef.current.y;
      } else {
        // 정상 범위: 핀치 중심을 transform-origin으로 사용, frozen 초기화
        pinchFrozenTranslateRef.current = null;
        originX = center.contentX;
        originY = center.contentY;
      }
      // transform-origin = 핀치 중심, scale만 적용 → translate 없이 밀림 없음
      schedulePinchTransform(previewScale, originX, originY);
    }
    e.preventDefault();
  };

  const clearPinchPointer = (pointerId: number) => {
    activePointersRef.current.delete(pointerId);

    // 아이패드에서 터치 이벤트가 꼬일 수 있으므로 핀치 중이었다면 즉시 종료
    if (isPinchingRef.current && activePointersRef.current.size < 2) {
      finishPinchZoom();
      return;
    }

    // 모든 포인터가 해제되었을 때만 상태 정리
    if (activePointersRef.current.size === 0) {
      // 핀치 상태 정리
      if (isPinchingRef.current || pinchStartDistRef.current !== null) {
        finishPinchZoom();
        return;
      }

      // 펜 레이어의 터치 상태도 초기화
      penRuntime.resetTouchState();

      pinchStartDistRef.current = null;
      pinchStartScaleRef.current = null;
      pinchPreviewScaleRef.current = 1;
      isPinchingRef.current = false;
      pinchTargetPageRef.current = null;
      // 디바운스 대기 중이면 CSS transform 유지 (debounce 콜백에서 제거됨)
      if (pendingPdfScaleRef.current === null) {
        resetPinchTransform();
      }
      setPinchInteractionState(false);
      pinchAnchorRef.current = null;
    }
  };

  const handleContainerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // 펜 또는 마우스 입력 처리 (펜/형광펜 모드일 때만)
    if (
      (e.pointerType === "pen" || e.pointerType === "mouse") &&
      (drawingMode === "pen" || drawingMode === "highlighter")
    ) {
      penRuntime.handlePenEnd(e);
      return;
    }

    if (e.pointerType === "touch") {
      clearPinchPointer(e.pointerId);
    }
    if (drawingMode !== "idle") return;
    if (shouldSkipSelection()) return;
    scheduleSelectionCheck();
  };

  const handleContainerPointerCancel = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    // 펜 또는 마우스 입력 처리 (펜/형광펜 모드일 때만)
    if (
      (e.pointerType === "pen" || e.pointerType === "mouse") &&
      (drawingMode === "pen" || drawingMode === "highlighter")
    ) {
      penRuntime.handlePenEnd(e);
      return;
    }

    if (e.pointerType !== "touch") return;
    clearPinchPointer(e.pointerId);
  };

  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;

    const handleTouchMove = (e: TouchEvent) => {
      // 핀치줌 중이거나 펜으로 그리는 중일 때 터치 스크롤 차단
      if (isPinchingRef.current || isDrawingRef.current) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      // 아이패드에서 터치가 끝날 때 포인터 상태 정리
      for (const touch of Array.from(e.changedTouches)) {
        // touch.identifier를 pointerId로 사용하는 경우가 있으므로 정리
        activePointersRef.current.delete(touch.identifier);
      }

      // 모든 터치가 끝났는데 핀치 중이라면 강제 종료
      if (e.touches.length === 0 && isPinchingRef.current) {
        finishPinchZoom();
      }
    };

    const handleTouchCancel = (e: TouchEvent) => {
      // 터치 취소 시에도 동일하게 처리
      for (const touch of Array.from(e.changedTouches)) {
        activePointersRef.current.delete(touch.identifier);
      }

      if (e.touches.length === 0 && isPinchingRef.current) {
        finishPinchZoom();
      }
    };

    container.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", handleTouchEnd, {
      passive: false,
    });
    container.addEventListener("touchcancel", handleTouchCancel, {
      passive: false,
    });

    return () => {
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, []);

  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;

    // PDF 컨테이너 내부에서 Ctrl + 휠: PDF 확대/축소 적용
    const handleContainerWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation(); // 전역 핸들러로 전파 방지

        const direction = e.deltaY < 0 ? "in" : "out";
        applyPdfZoom(direction, e.clientX, e.clientY);
      }
    };

    // 전역적으로 Ctrl + 마우스 휠로 인한 브라우저 확대/축소 차단
    const handleGlobalWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };

    // Ctrl + A 전체 선택 차단
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey && (e.key === "a" || e.key === "A")) ||
        (e.ctrlKey && (e.key === "p" || e.key === "P"))
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    container.addEventListener("wheel", handleContainerWheel, {
      passive: false,
    });
    window.addEventListener("wheel", handleGlobalWheel, {
      passive: false,
    });
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      container.removeEventListener("wheel", handleContainerWheel);
      window.removeEventListener("wheel", handleGlobalWheel);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [applyPdfZoom]);

  // S펜(stylus)이 드로잉 모드일 때 pointerdown의 기본 동작(스크롤)을 차단.
  // touch-action: pan-x pan-y를 유지하면서 펜 입력만 preventDefault로 막아
  // 터치 스크롤은 컴포지터 스레드에서 부드럽게 처리하고
  // 펜 드로잉 시 화면이 움직이는 현상을 방지한다.
  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;
    const handlePenPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "pen" && drawingModeRef.current !== "idle") {
        e.preventDefault();
      }
    };
    container.addEventListener("pointerdown", handlePenPointerDown, {
      passive: false,
    });
    return () => {
      container.removeEventListener("pointerdown", handlePenPointerDown);
    };
  }, []);

  useEffect(() => {
    const onSelectionChange = () => scheduleSelectionCheck();
    const onTouchEnd = () => scheduleSelectionCheck();
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("touchend", onTouchEnd);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const applyHighlight = (options?: { requestNoteEdit?: boolean }) => {
    const snapshot = getSelectionSnapshot();
    const activeText = snapshot?.text || selection.text;
    const pageNumber = snapshot?.pageNumber ?? null;
    const visualScale = snapshot?.visualScale ?? getVisualScale();

    let rects: HighlightRect[] =
      snapshot?.rects && snapshot.rects.length > 0
        ? snapshot.rects
        : snapshot?.range &&
          snapshot.pageEl &&
          snapshot.pageNumber !== null &&
          snapshot.pageNumber !== undefined
        ? buildHighlightRectsFromSelection(
            snapshot.range,
            snapshot.pageEl,
            visualScale
          )
        : [];

    if (!activeText || !pageNumber || rects.length === 0) {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }
    // BookContext에도 기록하여 사이드바/검색과 연동하며 동일 ID를 공유
    const id = addHighlight(activeText, undefined, "reference-doc", pageNumber);
    const mergedRects = mergeHighlightRects(rects);
    updateHighlight(id, { rects: mergedRects });
    const rectBytes = getJsonBytes(mergedRects);
    const chapterLabel = pageNumber
      ? getChapterTitleByPage(pageNumber) || "도서명"
      : "도서명";
    const listInfo = {
      chapterLabel,
      pageNumber,
      text: activeText,
    };
    const listBytes = getJsonBytes(listInfo);
    const combinedBytes = rectBytes + listBytes;
    setPdfHighlights((prev) => {
      const next = [...prev, { id, rects: mergedRects }];
      const totalBytes = getJsonBytes(next);
      if (enable_debug_log) {
      }
      return next;
    });
    setSelection((prev) => ({ ...prev, show: false }));
    selectionCacheRef.current = null;
    window.getSelection()?.removeAllRanges();
    if (options?.requestNoteEdit) {
      setToolsOpen(true);
      setActiveToolTab("highlight");
      focusHighlight(id);
      requestHighlightNoteEdit(id);
    }
  };

  const handleMemo = () => {
    applyHighlight({ requestNoteEdit: true });
  };

  const cancelSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection((prev) => ({ ...prev, show: false }));
  };

  const handleAskAi = () => {
    const success = askAiAction(selection.text, triggerSmartExplain, () =>
      setSelection((prev) => ({ ...prev, show: false }))
    );
    if (success) {
      window.getSelection()?.removeAllRanges();
    }
  };

  // 하이라이트 렌더 시 페이지 엘리먼트를 한 번만 수집 (메모리 최적화)
  // layoutTick이 바뀔 때만 재계산 → 하이라이트 수만큼 querySelector 반복 제거
  const pageElMap = useMemo(() => {
    const map = new Map<number, HTMLElement>();
    if (!viewerRef.current) return map;
    viewerRef.current
      .querySelectorAll<HTMLElement>(".page[data-page-number]")
      .forEach((el) => {
        const num = Number(el.dataset.pageNumber);
        if (num) map.set(num, el);
      });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutTick]);

  return (
    <div className="pdf_viewer">
      <PdfViewerOverlay
        loading={loading}
        errorMsg={errorMsg}
        progress={loadProgress}
      />

      {enable_debug_log && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            left: 16,
            zIndex: 9999,
            background: "rgba(0,0,0,0.82)",
            color: "#fff",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 12,
            lineHeight: 1.7,
            fontFamily: "monospace",
            pointerEvents: "none",
            minWidth: 240,
          }}
        >
          <div
            style={{ fontWeight: "bold", marginBottom: 4, color: "#facc15" }}
          >
            📐 Canvas Limit Debug
          </div>
          <div>
            isMobileLike: <b>{String(isMobileLike)}</b>
          </div>
          <div>
            isTouchTablet:{" "}
            <b
              style={{
                color: canvasLimitDebug.isTouchTablet ? "#4ade80" : "#f87171",
              }}
            >
              {String(canvasLimitDebug.isTouchTablet)}
            </b>
          </div>
          <div>
            maxTouchPoints: <b>{canvasLimitDebug.maxTouchPoints}</b>
          </div>
          <div>
            DPR: <b>{canvasLimitDebug.dpr}</b>
          </div>
          <div>
            deviceMemory:{" "}
            <b>
              {canvasLimitDebug.mem !== undefined
                ? `${canvasLimitDebug.mem}GB`
                : "미지원(Safari)"}
            </b>
          </div>
          <div>
            innerWidth: <b>{canvasLimitDebug.innerWidth}px</b>
          </div>
          <div
            style={{
              marginTop: 4,
              borderTop: "1px solid rgba(255,255,255,0.2)",
              paddingTop: 4,
            }}
          >
            MAX_CANVAS_PIXELS:{" "}
            <b style={{ color: "#60a5fa" }}>
              {canvasLimitDebug.limit !== undefined
                ? `${(canvasLimitDebug.limit / 1_000_000).toFixed(0)}M`
                : "없음 (PDF.js 기본 16M)"}
            </b>
          </div>
        </div>
      )}

      {/* ⭐⭐⭐ 화면용 스케일 래퍼 추가 (중요) ⭐⭐⭐ */}
      <div
        className="pdf_viewer_scale_wrapper"
        ref={scaleWrapperRef}
        style={
          {
            "--visual-scale": VISUAL_SCALE,
          } as React.CSSProperties
        }
      >
        {/* 미리보기 마지막 페이지 오버레이 */}
        {showPreviewEndOverlay && (
          <div
            className="preview_end_overlay"
            onClick={() => {
              setShowPreviewEndOverlay(false);
              if (previewEndTimerRef.current)
                clearTimeout(previewEndTimerRef.current);
            }}
            onWheel={(e) => {
              if (e.deltaY < 0) {
                // 위로 스크롤 → 오버레이 dismiss + 컨테이너 동시 스크롤
                setShowPreviewEndOverlay(false);
                if (previewEndTimerRef.current)
                  clearTimeout(previewEndTimerRef.current);
                const container = viewerContainerRef.current;
                if (container) container.scrollTop += e.deltaY;
              }
            }}
            onTouchStart={(e) => {
              overlayTouchStartYRef.current = e.touches[0].clientY;
            }}
            onTouchMove={(e) => {
              if (overlayTouchStartYRef.current === null) return;
              const deltaY =
                e.touches[0].clientY - overlayTouchStartYRef.current;
              if (deltaY > 15) {
                // 손가락이 아래로 이동 = 위로 스크롤 → dismiss
                setShowPreviewEndOverlay(false);
                if (previewEndTimerRef.current)
                  clearTimeout(previewEndTimerRef.current);
                overlayTouchStartYRef.current = null;
              }
            }}
          >
            <div className="preview_end_card">
              <div className="preview_end_icon">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <p className="preview_end_text">미리보기 마지막 페이지입니다.</p>
            </div>
          </div>
        )}

        {/* ⭐ pdf.js에서 요구하는 container는 그대로 absolute 유지 ⭐ */}
        <div
          ref={viewerContainerRef}
          className={`pdf_viewer_container${
            showPreviewEndOverlay ? " preview_end_blur" : ""
          }`}
          data-drawing-mode={drawingMode}
          style={{
            cursor:
              drawingMode === "pen"
                ? "crosshair"
                : drawingMode === "highlighter"
                ? "crosshair"
                : drawingMode === "eraser"
                ? "crosshair"
                : "auto",
            userSelect: drawingMode !== "idle" ? "none" : "auto",
          }}
          onPointerDown={handleContainerPointerDown}
          onPointerMove={handleContainerPointerMove}
          onPointerUp={handleContainerPointerUp}
          onPointerCancel={handleContainerPointerCancel}
          onContextMenu={(e) => e.preventDefault()}
          onCopy={handleContainerCopy}
        >
          <div ref={transformLayerRef} className="pdf_viewer_transform_layer">
            <div ref={viewerRef} className="pdfViewer pdf_viewer_content" />
            {/* 커스텀 하이라이트 오버레이 */}
            <div
              className="pdf_highlight_layer"
              data-layout-tick={layoutTick} // layout 변경 시 리렌더 트리거
            >
              {pdfHighlights.flatMap((h) =>
                h.rects.map((rect, idx) => {
                  const containerEl = viewerContainerRef.current;
                  const pageEl = pageElMap.get(rect.pageNumber);
                  if (!containerEl || !pageEl) return null;

                  const { pageOffsetLeft, pageOffsetTop, scaleX, scaleY } =
                    getPageOffsetInfo(
                      containerEl,
                      pageEl,
                      rect.pageWidth,
                      rect.pageHeight
                    );

                  const left = pageOffsetLeft + rect.left * scaleX;
                  const top = pageOffsetTop + rect.top * scaleY;
                  const width = rect.width * scaleX;
                  const height = rect.height * scaleY;

                  return (
                    <div
                      key={`${h.id}-${idx}`}
                      className="pdf_highlight"
                      data-highlight-id={h.id}
                      style={{
                        left,
                        top,
                        width,
                        height,
                      }}
                    />
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 선택 플로팅 메뉴 */}
      <PdfSelectionMenu
        visible={selection.show}
        top={selection.top}
        left={selection.left}
        copyStatus={copyStatus}
        onHighlight={applyHighlight}
        onCopy={handleCopySelection}
        onAskAi={handleAskAi}
        onMemo={handleMemo}
        onCancel={cancelSelection}
      />

      {/* 워터마크 오버레이 (labguardW 생성 blob 이미지) */}
      {watermarkUrl && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundImage: `url('${watermarkUrl}')`,
            backgroundRepeat: "repeat",
            backgroundSize: "128px",
            opacity: 0.006,
            pointerEvents: "none",
            zIndex: 9999,
          }}
        />
      )}
    </div>
  );
};
