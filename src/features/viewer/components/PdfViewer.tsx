// src/features/viewer/components/PdfViewer.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GlobalWorkerOptions, version as pdfjsVersion } from "pdfjs-dist";
import { PDFViewer, SpreadMode } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import "../../../css/pdf_viewer.css";

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
// ✅ worker 설정 (v4 ESM)
GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.mjs`;

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
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  file,
  onPageChange,
  onPagesCount,
  registerGoToPage,
  forceSinglePage = false,
}) => {
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
  } = usePdfViewer();
  const {
    drawingMode,
    penColor,
    penWidth,
    penOpacity,
    chapterStrokes,
    addStroke,
    removeStroke,
  } = useDrawing();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isMobileSafari =
    /iP(hone|od|ad)/.test(ua) &&
    /Safari/i.test(ua) &&
    !/Chrome/i.test(ua) &&
    !/CriOS/i.test(ua);
  const isTouchDevice = useMemo(
    () =>
      typeof window !== "undefined" &&
      ("ontouchstart" in window || navigator.maxTouchPoints > 0),
    []
  );
  const highlightScrollBehavior =
    isMobileSafari || isTouchDevice ? "auto" : "smooth";
  const isMobileLike = useMemo(() => {
    if (typeof window === "undefined") return false;
    const touchUA = /Mobi|Android|iP(hone|od|ad)/i.test(ua);
    return touchUA || window.innerWidth <= 1300;
  }, [ua]);
  const MAX_CANVAS_PIXELS = undefined;
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
  const pendingTransformRef = useRef<{
    scale: number;
    translateX: number;
    translateY: number;
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
        const hit = pageEl.querySelector<HTMLElement>(".pdf_search_hit");
        if (!hit || !viewerContainerRef.current) return;

        const container = viewerContainerRef.current;
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
          behavior: "smooth",
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
    translateX: number,
    translateY: number
  ) => {
    pendingTransformRef.current = { scale, translateX, translateY };
    if (pinchTransformRafRef.current !== null) return;

    // 즉시 transform 적용 (깜박임 방지)
    const layer = transformLayerRef.current;
    if (layer) {
      layer.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
    }
  };

  const resetPinchTransform = () => {
    schedulePinchTransform(1, 0, 0);
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
    const containerRect = container.getBoundingClientRect();
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
    const containerRect = container.getBoundingClientRect();
    const viewportX = centerClientX - containerRect.left;
    const viewportY = centerClientY - containerRect.top;

    let pageEl: HTMLElement | null = null;
    const hit = document.elementFromPoint(centerClientX, centerClientY);
    if (hit instanceof HTMLElement) {
      const closestPage = hit.closest(".page");
      if (
        closestPage instanceof HTMLElement &&
        viewerRoot.contains(closestPage)
      ) {
        pageEl = closestPage;
      }
    }
    if (!pageEl) {
      const pages = Array.from(
        viewerRoot.querySelectorAll(".page")
      ) as HTMLElement[];
      pageEl =
        pages.find((page) => {
          const rect = page.getBoundingClientRect();
          return (
            centerClientX >= rect.left &&
            centerClientX <= rect.right &&
            centerClientY >= rect.top &&
            centerClientY <= rect.bottom
          );
        }) || null;
    }
    if (!pageEl) return;

    const pageNumber = Number(pageEl.dataset.pageNumber);
    if (!pageNumber) return;
    const rect = pageEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

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
    if (!pageNumber) return null;
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
    ]
  );

  const scheduleRenderRefresh = useCallback(() => {
    if (rafRefreshId.current !== null) return;
    // 핀치줌 중에는 렌더링 스킵하지 않고 진행 (깜박임 방지)
    rafRefreshId.current = requestAnimationFrame(() => {
      rafRefreshId.current = null;
      penRuntime.syncPageCanvases();
      penRuntime.syncCanvasPointers();
      penRuntime.renderStaticCanvases();
      penRuntime.renderLiveCanvas();
    });
  }, [penRuntime]);

  const setPdfScale = useCallback(
    (nextScale: number) => {
      const viewer = pdfViewerRef.current;
      if (!viewer) return;

      const { minScale, maxScale } = getPdfZoomBounds();
      const clampedScale = Math.min(maxScale, Math.max(minScale, nextScale));
      if (Math.abs(clampedScale - viewer.currentScale) < 0.001) return;

      pdfZoomManualRef.current = true;
      lastManualZoomTimeRef.current = Date.now(); // 수동 줌 시점 기록
      userHasZoomedRef.current = true; // 사용자 줌 상태 기록
      viewer.currentScale = clampedScale;
      setPdfZoom(clampedScale); // 헤더와 연동
      scheduleRenderRefresh();
      setLayoutTick((prev) => prev + 1);
    },
    [scheduleRenderRefresh, setLayoutTick, setPdfZoom]
  );

  const applyPdfZoom = useCallback(
    (direction: "in" | "out", mouseX?: number, mouseY?: number) => {
      const viewer = pdfViewerRef.current;
      const container = viewerContainerRef.current;
      if (!viewer || !container) return;

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
      const viewportX =
        mouseX !== undefined
          ? mouseX - containerRect.left
          : container.clientWidth / 2;
      const viewportY =
        mouseY !== undefined
          ? mouseY - containerRect.top
          : container.clientHeight / 2;

      // 현재 스크롤 위치 + 뷰포트 내 앵커 위치 = 컨텐츠 상의 절대 위치
      const contentX = container.scrollLeft + viewportX;
      const contentY = container.scrollTop + viewportY;

      // 스케일 비율 미리 계산
      const scaleRatio = clampedScale / currentScale;
      const newContentX = contentX * scaleRatio;
      const newContentY = contentY * scaleRatio;

      // 스케일 변경 (이 과정에서 setLayoutTick이 호출됨)
      pdfZoomManualRef.current = true;
      lastManualZoomTimeRef.current = Date.now(); // 수동 줌 시점 기록
      userHasZoomedRef.current = true; // 사용자 줌 상태 기록
      viewer.currentScale = clampedScale;
      setPdfZoom(clampedScale); // 헤더와 연동

      // 스크롤 조정을 즉시 수행 (하이라이트 튀는 현상 방지)
      container.scrollLeft = newContentX - viewportX;
      container.scrollTop = newContentY - viewportY;

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
    if (!viewer) return;

    // 수동 줌 변경 중이 아니고, 현재 스케일과 다를 때만 적용
    if (pdfZoomManualRef.current) {
      pdfZoomManualRef.current = false;
      return;
    }

    const currentScale = viewer.currentScale || 1;
    if (Math.abs(currentScale - pdfZoom) > 0.001) {
      // 외부에서 줌이 리셋되면 사용자 줌 상태도 초기화
      userHasZoomedRef.current = false;
      viewer.currentScale = pdfZoom;
      scheduleRenderRefresh();
      setLayoutTick((prev) => prev + 1);
    }
  }, [pdfZoom, scheduleRenderRefresh, setLayoutTick]);

  const onPageChangeFiltered = useCallback(
    (page: number) => {
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
        viewer.currentScale = nextScale;
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

    // forceSinglePage에 따라 SpreadMode 결정 (화면 크기와 무관)
    const nextMode = forceSinglePage ? SpreadMode.NONE : SpreadMode.ODD;
    if (viewer.spreadMode !== nextMode) {
      viewer.spreadMode = nextMode;
      scheduleRenderRefresh();
      setLayoutTick((prev) => prev + 1);
    }

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
    const pageNumber = Number(pageEl.dataset.pageNumber) || null;
    if (!pageNumber) return null;

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
    const delays = [0, 40, 120];
    delays.forEach((d) => setTimeout(checkPdfSelection, d));
  };

  const finishPinchZoom = () => {
    const viewer = pdfViewerRef.current;
    const container = viewerContainerRef.current;
    const viewerRoot = viewerRef.current;
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
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const pageRectBefore = pageElBefore.getBoundingClientRect();

    // 스케일 적용 전 앵커의 절대 위치 계산
    const anchorAbsX =
      pageRectBefore.left -
      containerRect.left +
      anchor.relX * pageRectBefore.width;
    const anchorAbsY =
      pageRectBefore.top -
      containerRect.top +
      anchor.relY * pageRectBefore.height;

    // 스케일 적용 (핀치 줌이므로 수동 변경으로 표시)
    pdfZoomManualRef.current = true;
    setPdfScale(nextScale);

    // 메모리 정리: 불필요한 transform 제거
    resetPinchTransform();

    // 스크롤 보정을 단일 프레임에서 즉시 처리 (레이아웃 튀는 현상 방지)
    requestAnimationFrame(() => {
      const pageElAfter = viewerRoot.querySelector<HTMLElement>(
        `.page[data-page-number="${anchor.pageNumber}"]`
      );

      if (!pageElAfter) return;

      const containerRectAfter = container.getBoundingClientRect();
      const pageRectAfter = pageElAfter.getBoundingClientRect();

      // 페이지가 아직 렌더링되지 않았으면 스킵
      if (pageRectAfter.width <= 0 || pageRectAfter.height <= 0) {
        return;
      }

      // 스케일 적용 후 앵커의 새로운 절대 위치
      const anchorNewAbsX =
        pageRectAfter.left -
        containerRectAfter.left +
        anchor.relX * pageRectAfter.width;
      const anchorNewAbsY =
        pageRectAfter.top -
        containerRectAfter.top +
        anchor.relY * pageRectAfter.height;

      // 앵커를 원래 뷰포트 위치에 유지하도록 스크롤 조정
      const scrollDeltaX = anchorNewAbsX - anchorAbsX;
      const scrollDeltaY = anchorNewAbsY - anchorAbsY;

      container.scrollLeft += scrollDeltaX;
      container.scrollTop += scrollDeltaY;
    });

    setPinchInteractionState(false);

    // 펜 레이어의 터치 상태도 초기화
    penRuntime.resetTouchState();

    lastPinchAtRef.current = Date.now();
    pinchStartDistRef.current = null;
    pinchStartScaleRef.current = null;
    pinchPreviewScaleRef.current = 1;
    pinchAnchorRef.current = null;

    // 핀치 플래그를 즉시 해제하여 페이지 이동이 가능하도록 함
    isPinchingRef.current = false;

    // PDF.js의 실제 현재 페이지와 동기화
    const actualPage = viewer?.currentPageNumber;
    if (
      actualPage &&
      pinchTargetPageRef.current &&
      actualPage !== pinchTargetPageRef.current
    ) {
      // 페이지가 달라졌다면 올바른 페이지로 이벤트 발생
      onPageChange?.(pinchTargetPageRef.current);
    }
    pinchTargetPageRef.current = null;

    // 핀치줌 완료 후 메모리 정리 및 렌더링
    requestAnimationFrame(() => {
      // 화면 밖 캔버스 즉시 정리 (메모리 절약)
      penRuntime.forceCleanupOffscreenCanvases();
      scheduleRenderRefresh();
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
      pinchStartScaleRef.current = viewer?.currentScale || 1;
      pinchPreviewScaleRef.current = 1;
      isPinchingRef.current = true;
      // 현재 페이지 번호 저장 (핀치 줌 중 페이지 변경 이벤트 무시용)
      pinchTargetPageRef.current = currentPdfPage;
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
      setPinchInteractionState(true);
      resetPinchTransform();
      return;
    }

    const viewer = pdfViewerRef.current;
    if (!viewer) return;

    const baseScale = pinchStartScaleRef.current ?? viewer.currentScale | 1;
    const ratio = dist / pinchStartDistRef.current;
    const nextScale = baseScale * ratio;
    const { minScale, maxScale } = getPdfZoomBounds();
    const clampedScale = Math.min(maxScale, Math.max(minScale, nextScale));
    const previewScale = baseScale ? clampedScale / baseScale : 1;
    pinchPreviewScaleRef.current = previewScale;
    isPinchingRef.current = true;
    updatePinchAnchor();
    const center = getPinchCenter();
    if (center) {
      const translateX = center.contentX * (1 - previewScale);
      const translateY = center.contentY * (1 - previewScale);
      schedulePinchTransform(previewScale, translateX, translateY);
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
      resetPinchTransform();
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

    container.addEventListener("wheel", handleContainerWheel, {
      passive: false,
    });
    window.addEventListener("wheel", handleGlobalWheel, {
      passive: false,
    });

    return () => {
      container.removeEventListener("wheel", handleContainerWheel);
      window.removeEventListener("wheel", handleGlobalWheel);
    };
  }, [applyPdfZoom]);

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

  return (
    <div className="pdf_viewer">
      <PdfViewerOverlay
        loading={loading}
        errorMsg={errorMsg}
        progress={loadProgress}
      />

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
        {/* ⭐ pdf.js에서 요구하는 container는 그대로 absolute 유지 ⭐ */}
        <div
          ref={viewerContainerRef}
          className="pdf_viewer_container"
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
                  const pageEl = viewerRef.current?.querySelector<HTMLElement>(
                    `.page[data-page-number="${rect.pageNumber}"]`
                  );
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
    </div>
  );
};
