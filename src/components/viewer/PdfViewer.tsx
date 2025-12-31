// src/components/viewer/PdfViewer.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, version as pdfjsVersion } from "pdfjs-dist";
import { PDFViewer, SpreadMode } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import "../../css/pdf_viewer.css";

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
  usePdfViewerUiState,
} from "../../viewer";
import { useBook } from "../../contexts/BookContext";
import {
  getCanvasMetrics,
  getPageOffsetInfo,
  getPagePoint,
  HighlightRect,
  PdfHighlight,
} from "./pdfUtils";
import { drawStrokePath, VISUAL_SCALE } from "../../viewer/utils/pdf_viewer_utils";
const warn = (msg: string, extra?: unknown) =>
  extra !== undefined ? console.warn(msg, extra) : console.warn(msg);
// ✅ worker 설정 (v4 ESM)
GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.mjs`;

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
    addHighlight,
    highlights,
    activeHighlightId,
    triggerSmartExplain,
    setPdfTextPages,
    pdfSearchHighlight,
    drawingMode,
    penColor,
    penWidth,
    penOpacity,
    chapterStrokes,
    addStroke,
    removeStroke,
    showAnnotations,
  } = useBook();
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
  const isMobileLike = useMemo(() => {
    if (typeof window === "undefined") return false;
    const touchUA = /Mobi|Android|iP(hone|od|ad)/i.test(ua);
    return touchUA || window.innerWidth <= 1300;
  }, [ua]);
  const MAX_CANVAS_PIXELS = useMemo(() => undefined, []);
  const pdfViewerRef = useRef<PDFViewer | null>(null);

  const {
    loading,
    setLoading,
    loadProgress,
    setLoadProgress,
    errorMsg,
    setErrorMsg,
    copyStatus,
    setCopyStatus,
    selection,
    setSelection,
    layoutTick,
    setLayoutTick,
  } = usePdfViewerUiState();
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

  useEffect(() => {
    drawingModeRef.current = drawingMode;
  }, [drawingMode]);
  useEffect(() => {
    penColorRef.current = penColor;
  }, [penColor]);
  useEffect(() => {
    penWidthRef.current = penWidth;
  }, [penWidth]);
  useEffect(() => {
    penOpacityRef.current = penOpacity;
  }, [penOpacity]);
  useEffect(() => {
    chapterStrokesRef.current = chapterStrokes;
  }, [chapterStrokes]);
  useEffect(() => {
    showAnnotationsRef.current = showAnnotations;
  }, [showAnnotations]);

  useEffect(() => {
    // Keep local overlay in sync with global highlights (e.g., sidebar delete)
    setPdfHighlights((prev) =>
      prev.filter((h) => highlights.some((hl) => hl.id === h.id))
    );
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
    const pageEl = viewerRef.current?.querySelector<HTMLElement>(
      `.page[data-page-number="${first.pageNumber}"]`
    );
    if (!containerEl || !pageEl) return;

    const { pageOffsetLeft, pageOffsetTop, scaleX, scaleY } = getPageOffsetInfo(
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
      behavior: "smooth",
    });
  }, [activeHighlightId, pdfHighlights]);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
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

  const getPageElementFromEvent = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const pageEl = target.closest(".page") as HTMLElement | null;
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

  const getCanvasMetrics = (pageEl: HTMLElement) => {
    const rect = pageEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const visualScale = getVisualScale();
    const width = rect.width / visualScale;
    const height = rect.height / visualScale;
    return { rect, dpr, visualScale, width, height };
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
        getVisualScale,
        getPagePoint,
        getPageElementFromEvent,
        getPageElementByNumber,
        getCanvasMetrics,
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

  const scheduleRenderRefresh = () => {
    if (rafRefreshId.current !== null) return;
    rafRefreshId.current = requestAnimationFrame(() => {
      rafRefreshId.current = null;
      penRuntime.syncPageCanvases();
      penRuntime.syncCanvasPointers();
      penRuntime.renderStaticCanvases();
      penRuntime.renderLiveCanvas();
    });
  };
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
    onPageChange,
    onPagesCount,
    registerGoToPage,
    setPdfTextPages,
    setLoading,
    setLoadProgress,
    setErrorMsg,
    scheduleRenderRefresh,
    disposePageEntry: penRuntime.disposePageEntry,
    preferSpreadView: !isMobileLike && !forceSinglePage,
  });

  usePdfPenLayer({
    penRuntime,
    viewerRef,
    viewerContainerRef,
    pageCanvasMapRef,
    drawingMode,
    showAnnotations,
    chapterStrokes,
    penColor,
    penWidth,
    penOpacity,
    scheduleRenderRefresh,
    setLayoutTick,
  });

  // 사이드바가 열리면 단일 페이지, 닫히면 2페이지 스프레드(데스크톱)로 전환
  useEffect(() => {
    const viewer = pdfViewerRef.current;
    if (!viewer) return;
    const preferSpreadView = !isMobileLike;
    const nextMode = forceSinglePage
      ? SpreadMode.NONE
      : preferSpreadView
        ? SpreadMode.ODD
        : SpreadMode.NONE;
    if (viewer.spreadMode !== nextMode) {
      viewer.spreadMode = nextMode;
      scheduleRenderRefresh();
    }
  }, [forceSinglePage, isMobileLike]);

  // ✅ 현재 선택된 텍스트를 강제로 클립보드에 넣는 함수
  const handleCopySelection = async () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    const text = window.getSelection()?.toString() ?? "";

    if (!text.trim()) {
      setCopyStatus("fail");
      copyResetRef.current = window.setTimeout(() => setCopyStatus(""), 1000);
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // fallback
        document.execCommand("copy");
      }
      setCopyStatus("ok");
    } catch (e) {
      console.error("copy failed", e);
      setCopyStatus("fail");
    } finally {
      copyResetRef.current = window.setTimeout(() => setCopyStatus(""), 1000);
    }
  };

  const checkPdfSelection = () => {
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
    const primaryRect = range.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects());
    const rect =
      (primaryRect.width > 0 && primaryRect.height > 0 && primaryRect) ||
      clientRects.find((r) => r.width > 0 && r.height > 0);

    if (!rect || rect.width === 0) {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }

    const menuWidth = 210;
    const margin = 10;
    const top = isTouchDevice
      ? rect.bottom + margin // drop below native selection handles
      : rect.top - 56;
    const left = rect.left + rect.width / 2 - menuWidth / 2;

    const clampedTop = top < margin ? rect.bottom + margin : top;
    const clampedLeft = Math.min(
      Math.max(left, margin),
      window.innerWidth - menuWidth - margin
    );

    const anchorElement =
      (range.startContainer as HTMLElement | null)?.closest?.(".page") ||
      (range.endContainer as HTMLElement | null)?.closest?.(".page");
    const pageEl = anchorElement as HTMLElement | null;
    const pageNumber = pageEl ? Number(pageEl.dataset.pageNumber) || null : null;
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

  const handleContainerPointerUp = () => {
    if (drawingMode !== "idle") return;
    scheduleSelectionCheck();
  };

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

  const applyHighlight = () => {
    const sel = window.getSelection();
    const hasLiveSelection =
      sel &&
      !sel.isCollapsed &&
      sel.rangeCount > 0 &&
      !!sel.toString().trim() &&
      viewerContainerRef.current &&
      scaleWrapperRef.current;

    const activeRange = hasLiveSelection
      ? sel!.getRangeAt(0)
      : selectionCacheRef.current?.range;
    const activeText = hasLiveSelection
      ? sel!.toString().trim()
      : selectionCacheRef.current?.text;

    const anchorElement = hasLiveSelection
      ? (activeRange?.startContainer as HTMLElement | null)?.closest?.(".page") ||
        activeRange?.startContainer?.parentElement?.closest?.(".page")
      : selectionCacheRef.current?.pageEl;

    const pageElFromCache =
      selectionCacheRef.current?.pageNumber !== null &&
      selectionCacheRef.current?.pageNumber !== undefined
        ? getPageElementByNumber(selectionCacheRef.current?.pageNumber!)
        : null;

    const pageEl = (anchorElement as HTMLElement | null) || pageElFromCache;
    const pageNumber = hasLiveSelection
      ? pageEl
        ? Number(pageEl.dataset.pageNumber) || null
        : null
      : selectionCacheRef.current?.pageNumber ?? null;

    const visualScale =
      selectionCacheRef.current?.visualScale ?? getVisualScale();

    let rects: HighlightRect[] =
      hasLiveSelection && activeRange && pageEl && pageNumber
        ? buildHighlightRectsFromSelection(activeRange, pageEl, visualScale)
        : selectionCacheRef.current?.rects ?? [];

    // If rects are empty but we still have a cached range/page, try rebuilding once more
    if (
      rects.length === 0 &&
      selectionCacheRef.current?.range &&
      pageEl &&
      pageNumber
    ) {
      rects = buildHighlightRectsFromSelection(
        selectionCacheRef.current.range,
        pageEl,
        visualScale
      );
    }

    if (!activeText || !pageNumber || rects.length === 0) {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }
    // BookContext에도 기록하여 사이드바/검색과 연동하며 동일 ID를 공유
    const id = addHighlight(
      activeText,
      undefined,
      "reference-doc",
      pageNumber
    );
    const mergedRects = mergeHighlightRects(rects);
    setPdfHighlights((prev) => [...prev, { id, rects: mergedRects }]);
    setSelection((prev) => ({ ...prev, show: false }));
    selectionCacheRef.current = null;
    sel?.removeAllRanges();
  };

  const cancelSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection((prev) => ({ ...prev, show: false }));
  };

  const handleAskAi = () => {
    const success = askAiAction(
      selection.text,
      triggerSmartExplain,
      () => setSelection((prev) => ({ ...prev, show: false }))
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
          onPointerUp={handleContainerPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
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

      {/* 선택 플로팅 메뉴 */}
      <PdfSelectionMenu
        visible={selection.show}
        top={selection.top}
        left={selection.left}
        copyStatus={copyStatus}
        onHighlight={applyHighlight}
        onCopy={handleCopySelection}
        onAskAi={handleAskAi}
        onCancel={cancelSelection}
      />
    </div>
  );
};
