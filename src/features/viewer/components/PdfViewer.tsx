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
  usePdfViewerUiState,
} from "..";
import { useBook } from "../../../contexts/BookContext";
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
  const highlightScrollBehavior =
    isMobileSafari || isTouchDevice ? "auto" : "smooth";
  const isMobileLike = useMemo(() => {
    if (typeof window === "undefined") return false;
    const touchUA = /Mobi|Android|iP(hone|od|ad)/i.test(ua);
    return touchUA || window.innerWidth <= 1300;
  }, [ua]);
  const MAX_CANVAS_PIXELS = undefined;
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
  const isPenSelectingRef = useRef(false);
  const penSelectionStartRef = useRef<Range | null>(null);
  const penSelectionPageRef = useRef<HTMLElement | null>(null);
  const penSelectionBoundariesRef = useRef<{
    first: Text;
    last: Text;
  } | null>(null);
  const penSelectionPointerIdRef = useRef<number | null>(null);
  const penSelectionMoveRafRef = useRef<number | null>(null);
  const penSelectionLastPointRef = useRef<{ x: number; y: number } | null>(
    null
  );
  const lastSelectionSourceRef = useRef<"pen" | "native" | null>(null);
  const selectionFixInProgressRef = useRef(false);

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
      behavior: highlightScrollBehavior,
    });
  }, [activeHighlightId, pdfHighlights, highlightScrollBehavior]);

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

  const getPageCanvasMetrics = (pageEl: HTMLElement) =>
    getCanvasMetrics(pageEl, getVisualScale);

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
        getCanvasMetrics: getPageCanvasMetrics,
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
    rafRefreshId.current = requestAnimationFrame(() => {
      rafRefreshId.current = null;
      penRuntime.syncPageCanvases();
      penRuntime.syncCanvasPointers();
      penRuntime.renderStaticCanvases();
      penRuntime.renderLiveCanvas();
    });
  }, [penRuntime]);

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

  useEffect(() => {
    if (loading) return;
    const viewer = pdfViewerRef.current;
    const containerEl = viewerContainerRef.current;
    const contentEl = viewerRef.current;
    if (!viewer || !containerEl || !contentEl) return;

    const frameId = requestAnimationFrame(() => {
      if (!isMobileLike) {
        if (viewer.currentScale < 1) viewer.currentScale = 1;
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

  const getClosestPageEl = (node: Node | null) => {
    if (!node) return null;
    const element = node instanceof Element ? node : node.parentElement;
    const pageEl = element?.closest?.(".page");
    return pageEl instanceof HTMLElement ? pageEl : null;
  };

  const isSelectionForward = (sel: Selection) => {
    if (!sel.anchorNode || !sel.focusNode) return true;
    if (sel.anchorNode === sel.focusNode) {
      return sel.anchorOffset <= sel.focusOffset;
    }
    const pos = sel.anchorNode.compareDocumentPosition(sel.focusNode);
    return Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING);
  };

  const getTextBoundaryNodes = (pageEl: HTMLElement) => {
    const textLayer = pageEl.querySelector(".textLayer");
    if (!textLayer) return null;

    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      const textNode = current as Text;
      if (textNode.nodeValue && textNode.nodeValue.length > 0) {
        nodes.push(textNode);
      }
      current = walker.nextNode();
    }

    if (nodes.length === 0) return null;
    return { first: nodes[0], last: nodes[nodes.length - 1] };
  };

  const clampSelectionToPage = (sel: Selection, pageEl: HTMLElement) => {
    if (sel.rangeCount === 0) return false;
    const boundaries = getTextBoundaryNodes(pageEl);
    if (!boundaries) return false;

    const range = sel.getRangeAt(0);
    const forward = isSelectionForward(sel);
    const newRange = document.createRange();

    if (forward) {
      if (pageEl.contains(range.startContainer)) {
        newRange.setStart(range.startContainer, range.startOffset);
      } else {
        newRange.setStart(boundaries.first, 0);
      }
      const endLen = boundaries.last.nodeValue?.length ?? 0;
      newRange.setEnd(boundaries.last, endLen);
    } else {
      newRange.setStart(boundaries.first, 0);
      if (pageEl.contains(range.endContainer)) {
        newRange.setEnd(range.endContainer, range.endOffset);
      } else {
        const endLen = boundaries.last.nodeValue?.length ?? 0;
        newRange.setEnd(boundaries.last, endLen);
      }
    }

    sel.removeAllRanges();
    sel.addRange(newRange);
    return true;
  };

  const getCaretRangeFromPoint = (x: number, y: number) => {
    const docAny = document as any;
    if (typeof docAny.caretRangeFromPoint === "function") {
      return docAny.caretRangeFromPoint(x, y) as Range | null;
    }
    if (typeof docAny.caretPositionFromPoint === "function") {
      const pos = docAny.caretPositionFromPoint(x, y) as
        | { offsetNode: Node; offset: number }
        | null;
      if (!pos) return null;
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
    return null;
  };

  const normalizeNodeOffset = (node: Node, offset: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.nodeValue?.length ?? 0;
      return Math.max(0, Math.min(offset, len));
    }
    return offset;
  };

  const buildRangeWithinPage = (
    startRange: Range,
    endRange: Range | null,
    pageEl: HTMLElement,
    boundariesOverride?: { first: Text; last: Text } | null
  ) => {
    const boundaries = boundariesOverride || getTextBoundaryNodes(pageEl);
    if (!boundaries) return null;

    let startNode: Node = startRange.startContainer;
    let startOffset = startRange.startOffset;
    if (!pageEl.contains(startNode)) {
      startNode = boundaries.first;
      startOffset = 0;
    }
    startOffset = normalizeNodeOffset(startNode, startOffset);

    let endNode: Node = endRange ? endRange.startContainer : startNode;
    let endOffset = endRange ? endRange.startOffset : startOffset;
    if (!pageEl.contains(endNode)) {
      const pos = pageEl.compareDocumentPosition(endNode);
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
        endNode = boundaries.first;
        endOffset = 0;
      } else {
        endNode = boundaries.last;
        endOffset = boundaries.last.nodeValue?.length ?? 0;
      }
    }
    endOffset = normalizeNodeOffset(endNode, endOffset);

    const range = document.createRange();
    if (startNode === endNode) {
      const start = Math.min(startOffset, endOffset);
      const end = Math.max(startOffset, endOffset);
      range.setStart(startNode, start);
      range.setEnd(endNode, end);
      return range;
    }

    const order = startNode.compareDocumentPosition(endNode);
    if (order & Node.DOCUMENT_POSITION_FOLLOWING) {
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
    } else {
      range.setStart(endNode, endOffset);
      range.setEnd(startNode, startOffset);
    }
    return range;
  };

  const updatePenSelectionAt = (x: number, y: number) => {
    const startRange = penSelectionStartRef.current;
    const pageEl = penSelectionPageRef.current;
    const boundaries = penSelectionBoundariesRef.current;
    if (!startRange || !pageEl) return;

    const endRange = getCaretRangeFromPoint(x, y);
    const nextRange = buildRangeWithinPage(
      startRange,
      endRange,
      pageEl,
      boundaries
    );
    if (!nextRange) return;

    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(nextRange);
  };

  const getMedian = (values: number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };

  const buildRectClusters = (rects: DOMRect[]) => {
    if (rects.length === 0) return [];
    const heights = rects.map((r) => r.height).filter((h) => h > 0);
    const medianHeight = getMedian(heights);
    const vGap = Math.max(8, medianHeight * 0.75);
    const hGap = Math.max(12, medianHeight * 1.5);

    const clusters: {
      rects: DOMRect[];
      minTop: number;
      maxBottom: number;
      minLeft: number;
      maxRight: number;
    }[] = [];
    const visited = new Array(rects.length).fill(false);

    const isAdjacent = (a: DOMRect, b: DOMRect) => {
      const verticalClose = a.top <= b.bottom + vGap && a.bottom + vGap >= b.top;
      const horizontalClose =
        a.left <= b.right + hGap && a.right + hGap >= b.left;
      return verticalClose && horizontalClose;
    };

    for (let i = 0; i < rects.length; i++) {
      if (visited[i]) continue;
      const stack = [i];
      const group: DOMRect[] = [];
      visited[i] = true;

      while (stack.length > 0) {
        const idx = stack.pop() as number;
        const base = rects[idx];
        group.push(base);
        for (let j = 0; j < rects.length; j++) {
          if (visited[j]) continue;
          if (isAdjacent(base, rects[j])) {
            visited[j] = true;
            stack.push(j);
          }
        }
      }

      const bounds = group.reduce(
        (acc, r) => ({
          minTop: Math.min(acc.minTop, r.top),
          maxBottom: Math.max(acc.maxBottom, r.bottom),
          minLeft: Math.min(acc.minLeft, r.left),
          maxRight: Math.max(acc.maxRight, r.right),
        }),
        {
          minTop: group[0].top,
          maxBottom: group[0].bottom,
          minLeft: group[0].left,
          maxRight: group[0].right,
        }
      );
      clusters.push({ rects: group, ...bounds });
    }
    return clusters;
  };

  const getSelectionAnchorPoint = (sel: Selection, rects: DOMRect[]) => {
    if (sel.anchorNode) {
      const anchorRange = document.createRange();
      anchorRange.setStart(sel.anchorNode, sel.anchorOffset);
      anchorRange.collapse(true);
      const rect =
        anchorRange.getClientRects()[0] || anchorRange.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    const fallback = rects[0];
    return { x: fallback.left + fallback.width / 2, y: fallback.top + fallback.height / 2 };
  };

  const getPointDistanceToCluster = (
    point: { x: number; y: number },
    cluster: { minTop: number; maxBottom: number; minLeft: number; maxRight: number }
  ) => {
    const dx =
      point.x < cluster.minLeft
        ? cluster.minLeft - point.x
        : point.x > cluster.maxRight
          ? point.x - cluster.maxRight
          : 0;
    const dy =
      point.y < cluster.minTop
        ? cluster.minTop - point.y
        : point.y > cluster.maxBottom
          ? point.y - cluster.maxBottom
          : 0;
    return Math.hypot(dx, dy);
  };

  const getRectPoint = (rect: DOMRect, isEnd: boolean) => {
    const xPad = Math.min(4, Math.max(1, rect.width * 0.1));
    const x = isEnd ? rect.right - xPad : rect.left + xPad;
    const y = rect.top + rect.height / 2;
    return { x, y };
  };

  const clampSelectionWithinPage = (sel: Selection, pageEl: HTMLElement) => {
    if (sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const rects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 0 && r.height > 0
    );
    if (rects.length < 2) return false;

    const clusters = buildRectClusters(rects);
    if (clusters.length <= 1) return false;

    const anchorPoint = getSelectionAnchorPoint(sel, rects);
    let anchorCluster = clusters[0];
    let minDistance = getPointDistanceToCluster(anchorPoint, anchorCluster);
    for (let i = 1; i < clusters.length; i++) {
      const dist = getPointDistanceToCluster(anchorPoint, clusters[i]);
      if (dist < minDistance) {
        minDistance = dist;
        anchorCluster = clusters[i];
      }
    }

    if (!anchorCluster || anchorCluster.rects.length === rects.length) {
      return false;
    }

    const ordered = [...anchorCluster.rects].sort((a, b) =>
      a.top === b.top ? a.left - b.left : a.top - b.top
    );
    const startRect = ordered[0];
    const endRect = ordered[ordered.length - 1];
    const startPoint = getRectPoint(startRect, false);
    const endPoint = getRectPoint(endRect, true);

    const startRange = getCaretRangeFromPoint(startPoint.x, startPoint.y);
    const endRange = getCaretRangeFromPoint(endPoint.x, endPoint.y);
    if (!startRange || !endRange) return false;
    if (
      !pageEl.contains(startRange.startContainer) ||
      !pageEl.contains(endRange.startContainer)
    ) {
      return false;
    }

    const newRange = document.createRange();
    const startNode = startRange.startContainer;
    const endNode = endRange.startContainer;
    const startOffset = startRange.startOffset;
    const endOffset = endRange.startOffset;

    if (startNode === endNode) {
      const start = Math.min(startOffset, endOffset);
      const end = Math.max(startOffset, endOffset);
      newRange.setStart(startNode, start);
      newRange.setEnd(endNode, end);
    } else {
      const order = startNode.compareDocumentPosition(endNode);
      if (order & Node.DOCUMENT_POSITION_FOLLOWING) {
        newRange.setStart(startNode, startOffset);
        newRange.setEnd(endNode, endOffset);
      } else {
        newRange.setStart(endNode, endOffset);
        newRange.setEnd(startNode, startOffset);
      }
    }

    sel.removeAllRanges();
    sel.addRange(newRange);
    return true;
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
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // fallback that still works after mobile Safari clears the live selection
        const textarea = document.createElement("textarea");
        textarea.value = text;
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
      selectionFixInProgressRef.current = false;
      lastSelectionSourceRef.current = null;
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }

    const isInsideAnchor =
      viewerContainerRef.current.contains(sel.anchorNode as Node) &&
      viewerContainerRef.current.contains(sel.focusNode as Node);
    if (!isInsideAnchor) {
      selectionFixInProgressRef.current = false;
      lastSelectionSourceRef.current = null;
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }

    const anchorPageEl = getClosestPageEl(sel.anchorNode);
    const focusPageEl = getClosestPageEl(sel.focusNode);
    if (!anchorPageEl || !focusPageEl) {
      selectionFixInProgressRef.current = false;
      lastSelectionSourceRef.current = null;
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }

    if (anchorPageEl !== focusPageEl) {
      const clamped = clampSelectionToPage(sel, anchorPageEl);
      if (!clamped) {
        setSelection((prev) => ({ ...prev, show: false }));
        return;
      }
    }

    if (isTouchDevice && lastSelectionSourceRef.current !== "pen") {
      if (selectionFixInProgressRef.current) {
        selectionFixInProgressRef.current = false;
      } else {
        const adjusted = clampSelectionWithinPage(sel, anchorPageEl);
        if (adjusted) {
          selectionFixInProgressRef.current = true;
          return;
        }
      }
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

    const pageEl = getPageElFromRange(range);
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

  const endPenSelection = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPenSelectingRef.current) return false;
    if (
      penSelectionPointerIdRef.current !== null &&
      penSelectionPointerIdRef.current !== e.pointerId
    ) {
      return false;
    }

    if (penSelectionMoveRafRef.current !== null) {
      cancelAnimationFrame(penSelectionMoveRafRef.current);
      penSelectionMoveRafRef.current = null;
    }

    penSelectionLastPointRef.current = null;
    penSelectionStartRef.current = null;
    penSelectionPageRef.current = null;
    penSelectionBoundariesRef.current = null;
    penSelectionPointerIdRef.current = null;
    isPenSelectingRef.current = false;

    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    return true;
  };

  const handleContainerPointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (drawingMode !== "idle") return;

    const target = e.target as HTMLElement;
    const textLayer = target.closest(".textLayer");
    if (!textLayer) return;

    if (e.pointerType !== "pen") {
      lastSelectionSourceRef.current = "native";
      return;
    }

    const startRange = getCaretRangeFromPoint(e.clientX, e.clientY);
    if (!startRange) return;
    const pageEl = getClosestPageEl(startRange.startContainer);
    if (!pageEl) return;
    const boundaries = getTextBoundaryNodes(pageEl);
    if (!boundaries) return;

    e.preventDefault();
    selectionFixInProgressRef.current = false;
    lastSelectionSourceRef.current = "pen";
    isPenSelectingRef.current = true;
    penSelectionStartRef.current = startRange.cloneRange();
    penSelectionPageRef.current = pageEl;
    penSelectionBoundariesRef.current = boundaries;
    penSelectionPointerIdRef.current = e.pointerId;
    penSelectionLastPointRef.current = { x: e.clientX, y: e.clientY };

    window.getSelection()?.removeAllRanges();
    e.currentTarget.setPointerCapture(e.pointerId);
    updatePenSelectionAt(e.clientX, e.clientY);
  };

  const handleContainerPointerMove = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!isPenSelectingRef.current) return;
    if (penSelectionPointerIdRef.current !== e.pointerId) return;

    e.preventDefault();
    penSelectionLastPointRef.current = { x: e.clientX, y: e.clientY };

    if (penSelectionMoveRafRef.current !== null) return;
    penSelectionMoveRafRef.current = requestAnimationFrame(() => {
      penSelectionMoveRafRef.current = null;
      const point = penSelectionLastPointRef.current;
      if (!point) return;
      updatePenSelectionAt(point.x, point.y);
    });
  };

  const handleContainerPointerUp = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (isPenSelectingRef.current) {
      e.preventDefault();
      if (endPenSelection(e)) {
        scheduleSelectionCheck();
        return;
      }
    }
    if (drawingMode !== "idle") return;
    scheduleSelectionCheck();
  };

  const handleContainerPointerCancel = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!isPenSelectingRef.current) return;
    e.preventDefault();
    endPenSelection(e);
    window.getSelection()?.removeAllRanges();
    lastSelectionSourceRef.current = null;
  };

  useEffect(() => {
    const onSelectionChange = () => {
      if (isPenSelectingRef.current) return;
      scheduleSelectionCheck();
    };
    const onTouchEnd = () => scheduleSelectionCheck();
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("touchend", onTouchEnd);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const applyHighlight = () => {
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
    window.getSelection()?.removeAllRanges();
    lastSelectionSourceRef.current = null;
  };

  const cancelSelection = () => {
    window.getSelection()?.removeAllRanges();
    lastSelectionSourceRef.current = null;
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
      lastSelectionSourceRef.current = null;
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
          onPointerDown={handleContainerPointerDown}
          onPointerMove={handleContainerPointerMove}
          onPointerUp={handleContainerPointerUp}
          onPointerCancel={handleContainerPointerCancel}
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
