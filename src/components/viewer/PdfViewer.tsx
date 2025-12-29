// src/components/viewer/PdfViewer.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, version as pdfjsVersion } from "pdfjs-dist";
import { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import "../../css/pdf_viewer.css";
import { useBook } from "../../contexts/BookContext";
import { PdfSelectionMenu } from "../../viewer/components/PdfSelectionMenu";
import { usePdfViewerUiState } from "../../viewer/hooks/usePdfViewerUiState";
import { askAiAction } from "../../viewer/actions/pdf_viewer_ui_actions";
import { initPdfJsRuntime } from "../../viewer/pdfjs/pdfjs_runtime";
import {
  getCanvasMetrics,
  getPageOffsetInfo,
  getPagePoint,
  HighlightRect,
  PdfHighlight,
  PageCanvasEntry,
} from "./pdfUtils";
import { PdfViewerOverlay } from "../../viewer/components/PdfViewerOverlay";
import {
  drawStrokePath,
  mergeHighlightRects,
  pageWithinBuffer,
  VISUAL_SCALE,
} from "../../viewer/utils/pdf_viewer_utils";
const warn = (msg: string, extra?: unknown) =>
  extra !== undefined ? console.warn(msg, extra) : console.warn(msg);
// ✅ worker 설정 (v4 ESM)
GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.mjs`;

interface PdfViewerProps {
  file: string; // 일단 string URL 기준으로만 사용
  onPageChange?: (page: number) => void;
  onPagesCount?: (count: number) => void;
  registerGoToPage?: (fn: (page: number) => void) => void;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  file,
  onPageChange,
  onPagesCount,
  registerGoToPage,
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

  const [pdfHighlights, setPdfHighlights] = useState<PdfHighlight[]>([]);
  const rafRefreshId = useRef<number | null>(null);
  const isDrawingRef = useRef(false);
  const livePointsRef = useRef<{ x: number; y: number }[]>([]);
  const drawingModeRef = useRef(drawingMode);
  const penColorRef = useRef(penColor);
  const penWidthRef = useRef(penWidth);
  const penOpacityRef = useRef(penOpacity);
  const chapterStrokesRef = useRef(chapterStrokes);
  const showAnnotationsRef = useRef(showAnnotations);

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

  const scheduleRenderRefresh = () => {
    if (rafRefreshId.current !== null) return;
    rafRefreshId.current = requestAnimationFrame(() => {
      rafRefreshId.current = null;
      syncPageCanvases();
      syncCanvasPointers();
      renderStaticCanvases();
      renderLiveCanvas();
    });
  };

  useEffect(() => {
    // Keep local overlay in sync with global highlights (e.g., sidebar delete)
    setPdfHighlights((prev) =>
      prev.filter((h) => highlights.some((hl) => hl.id === h.id))
    );
  }, [highlights]);

  useEffect(() => {
    if (!viewerRef.current || !viewerContainerRef.current) return;

    const clearPrev = () => {
      viewerRef.current
        ?.querySelectorAll('.textLayer span[role="presentation"]')
        .forEach((span) => {
          const el = span as HTMLElement & { dataset: { origText?: string } };
          if (el.dataset.origText !== undefined) {
            el.textContent = el.dataset.origText;
            delete el.dataset.origText;
          }
        });
    };

    if (!pdfSearchHighlight) {
      clearPrev();
      return;
    }

    clearPrev();

    let cancelled = false;
    let retryTimer: number | null = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 10;

    const isTextLayerReady = (layer: Element) => {
      const spans = Array.from(layer.querySelectorAll("span"));
      if (spans.length === 0) return false;
      return spans.some((s) => {
        const el = s as HTMLElement;
        return (
          el.style.left !== "" ||
          el.style.top !== "" ||
          el.style.transform !== ""
        );
      });
    };

    const scrollToFirstHit = (pageEl: HTMLElement) => {
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
    };

    const applyHighlight = () => {
      const pageEl = viewerRef.current?.querySelector<HTMLElement>(
        `.page[data-page-number="${pdfSearchHighlight.page}"]`
      );
      const textLayer = pageEl?.querySelector(".textLayer");
      if (!textLayer || !isTextLayerReady(textLayer)) return false;

      const term = pdfSearchHighlight.term.trim();
      if (!term) return false;
      const re = new RegExp(term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"), "gi");
      textLayer
        .querySelectorAll('span[role="presentation"]')
        .forEach((span) => {
          const el = span as HTMLElement & { dataset: { origText?: string } };
          const content = el.textContent || "";
          const replaced = content.replace(
            re,
            (m) => `<span class="pdf_search_hit">${m}</span>`
          );
          if (replaced !== content) {
            if (el.dataset.origText === undefined) {
              el.dataset.origText = content;
            }
            el.innerHTML = replaced;
          }
        });

      if (pageEl) {
        requestAnimationFrame(() => scrollToFirstHit(pageEl));
      }

      return true;
    };

    const tryApply = () => {
      if (cancelled) return;
      if (applyHighlight()) return;
      if (attempts < MAX_ATTEMPTS) {
        attempts += 1;
        retryTimer = window.setTimeout(tryApply, 150);
      }
    };

    tryApply();

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
    };
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

  useEffect(() => {
    if (!viewerContainerRef.current || !viewerRef.current) return;

    // 새 파일 로드 시 기존 하이라이트 및 선택 상태 초기화
    setPdfHighlights([]);
    setSelection((prev) => ({ ...prev, show: false }));
    setPdfTextPages([]);
    onPagesCount?.(0);
    onPageChange?.(1);

    setLoading(true); // 새 파일 로드 시작
    setLoadProgress(1); // 진행률 표시 시작
    setErrorMsg(null); // 이전 에러 메시지 초기화

    const cleanup = initPdfJsRuntime({
      file,
      viewerContainer: viewerContainerRef.current,
      viewer: viewerRef.current,
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
      disposePageEntry,
    });

    return cleanup;
  }, [
    file,
    onPageChange,
    onPagesCount,
    registerGoToPage,
    setPdfTextPages,
    isMobileSafari,
    isMobileLike,
  ]);

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

  const sizePageCanvas = (
    pageEl: HTMLElement,
    staticCanvas: HTMLCanvasElement,
    liveCanvas: HTMLCanvasElement
  ) => {
    const { width, height, dpr } = getCanvasMetrics(pageEl, getVisualScale);
    if (!width || !height) return;
    [staticCanvas, liveCanvas].forEach((canvas) => {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }
    });
  };

  const createCanvas = (className: string, ariaHidden?: string) => {
    const canvas = document.createElement("canvas");
    canvas.className = className;
    if (ariaHidden) {
      canvas.setAttribute("aria-hidden", ariaHidden);
    }
    return canvas;
  };

  const bindPenHandlers = (canvas: HTMLCanvasElement) => {
    if (canvas.dataset.penBound) return;
    canvas.addEventListener("pointerdown", handlePenStart);
    canvas.addEventListener("pointermove", handlePenMove);
    canvas.addEventListener("pointerup", handlePenEnd);
    canvas.addEventListener("pointerleave", handlePenEnd);
    canvas.dataset.penBound = "1";
  };

  const unbindPenHandlers = (canvas: HTMLCanvasElement) => {
    if (!canvas.dataset.penBound) return;
    canvas.removeEventListener("pointerdown", handlePenStart);
    canvas.removeEventListener("pointermove", handlePenMove);
    canvas.removeEventListener("pointerup", handlePenEnd);
    canvas.removeEventListener("pointerleave", handlePenEnd);
    delete canvas.dataset.penBound;
  };

  const ensurePenLayer = (pageEl: HTMLElement): PageCanvasEntry | null => {
    let layer = pageEl.querySelector<HTMLDivElement>(".pdf_pen_page_layer");
    let staticCanvas: HTMLCanvasElement | null = null;
    let liveCanvas: HTMLCanvasElement | null = null;

    if (!layer) {
      layer = document.createElement("div");
      layer.className = "pdf_pen_page_layer";

      staticCanvas = createCanvas("pdf_pen_page_canvas", "true");
      liveCanvas = createCanvas(
        "pdf_pen_page_canvas pdf_pen_page_canvas_live"
      );
      bindPenHandlers(liveCanvas);

      layer.appendChild(staticCanvas);
      layer.appendChild(liveCanvas);
      pageEl.appendChild(layer);
    } else {
      staticCanvas = layer.querySelector<HTMLCanvasElement>(
        ".pdf_pen_page_canvas:not(.pdf_pen_page_canvas_live)"
      );
      liveCanvas = layer.querySelector<HTMLCanvasElement>(
        ".pdf_pen_page_canvas_live"
      );
      if (liveCanvas) {
        bindPenHandlers(liveCanvas);
      }
    }

    if (!layer || !staticCanvas || !liveCanvas) return null;
    return { layer, staticCanvas, liveCanvas };
  };

  const disposePageEntry = (pageNumber: number) => {
    const entry = pageCanvasMapRef.current.get(pageNumber);
    if (!entry) return;
    unbindPenHandlers(entry.liveCanvas);
    entry.layer?.remove();
    pageCanvasMapRef.current.delete(pageNumber);
  };

  const syncPageCanvases = () => {
    if (!viewerRef.current || !viewerContainerRef.current) return;
    const viewRect = viewerContainerRef.current.getBoundingClientRect();
    const BUFFER = 800; // 처리 범위 여유
    const pages: HTMLElement[] = Array.from(
      viewerRef.current.querySelectorAll<HTMLElement>(".page")
    ).filter((pageEl) => pageWithinBuffer(pageEl, viewRect, BUFFER));
    const seen = new Set<number>();
    pages.forEach((pageEl) => {
      const pageNumber = Number(pageEl.dataset.pageNumber);
      if (!pageNumber) return;
      seen.add(pageNumber);

      const entry = ensurePenLayer(pageEl);
      if (!entry) return;

      pageCanvasMapRef.current.set(pageNumber, entry);
      sizePageCanvas(pageEl, entry.staticCanvas, entry.liveCanvas);
    });

    for (const [pageNumber, entry] of pageCanvasMapRef.current.entries()) {
      if (!seen.has(pageNumber)) {
        disposePageEntry(pageNumber);
      }
    }
  };

  const syncCanvasPointers = () => {
    const mode = drawingModeRef.current || "idle";
    const active = mode === "pen" || mode === "eraser";
    pageCanvasMapRef.current.forEach(({ liveCanvas }) => {
      liveCanvas.style.pointerEvents = active ? "auto" : "none";
      liveCanvas.style.touchAction = active ? "none" : "auto";
      liveCanvas.style.cursor = active ? "crosshair" : "default";
    });
  };

  const strokeMatchesPage = (
    stroke: { pageNumber?: number },
    pageNumber: number
  ) => {
    if (stroke.pageNumber === undefined) {
      return pageNumber === 1;
    }
    return stroke.pageNumber === pageNumber;
  };

  const getPageStrokes = (pageNumber: number) =>
    (chapterStrokesRef.current["pdf-main"] || []).filter((s) =>
      strokeMatchesPage(s, pageNumber)
    );

  const handlePenStart = (e: React.PointerEvent) => {
    if (drawingModeRef.current === "idle") return;
    const info = getPageElementFromEvent(e);
    if (!info) return;
    const { pageEl, pageNumber } = info;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const pt = getPagePoint(e, pageEl, getVisualScale);
    if (!pt) return;
    currentPageRef.current = pageNumber;
    isDrawingRef.current = true;
    livePointsRef.current = [pt];
    renderLiveCanvas();
  };

  const handlePenMove = (e: React.PointerEvent) => {
    if (drawingModeRef.current === "idle") return;
    if (e.buttons === 0 && !isDrawingRef.current) return;

    const pageNumber =
      currentPageRef.current || getPageElementFromEvent(e)?.pageNumber || null;
    if (!pageNumber) return;
    const pageEl = getPageElementByNumber(pageNumber);
    if (!pageEl) return;

    e.preventDefault();
    const pt = getPagePoint(e, pageEl, getVisualScale);
    if (!pt) return;

    if (drawingModeRef.current === "pen") {
      isDrawingRef.current = true;
      currentPageRef.current = pageNumber;
      if (livePointsRef.current.length === 0) {
        livePointsRef.current = [pt];
      } else {
        livePointsRef.current.push(pt);
      }
      renderLiveCanvas();
    } else if (drawingModeRef.current === "eraser") {
      const strokes = getPageStrokes(pageNumber);
      strokes.forEach((stroke) => {
        const hit = stroke.points.some(
          (p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 16
        );
        if (hit) removeStroke("pdf-main", stroke.id);
      });
    }
  };

  const handlePenEnd = (e: React.PointerEvent) => {
    if (!isDrawingRef.current && drawingModeRef.current !== "eraser") return;
    const el = e.target as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    const pageNumber = currentPageRef.current;
    if (
      drawingModeRef.current === "pen" &&
      pageNumber &&
      livePointsRef.current.length > 1
    ) {
      const newStroke = {
        id: Date.now().toString(),
        points: livePointsRef.current,
        color: penColorRef.current,
        width: penWidthRef.current,
        opacity: penOpacityRef.current,
        pageNumber,
      };
      addStroke("pdf-main", newStroke);
    }
    isDrawingRef.current = false;
    livePointsRef.current = [];
    currentPageRef.current = null;
    renderLiveCanvas();
  };

  const renderStaticCanvases = () => {
    pageCanvasMapRef.current.forEach(({ staticCanvas }, pageNumber) => {
      const ctx = staticCanvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
      ctx.restore();
      if (!showAnnotationsRef.current) return;

      const strokes = getPageStrokes(pageNumber);
      strokes.forEach((s) =>
        drawStrokePath(ctx, s.points, s.color, s.width || 3, s.opacity ?? 1)
      );
    });
  };

  const renderLiveCanvas = () => {
    pageCanvasMapRef.current.forEach(({ liveCanvas }) => {
      const ctx = liveCanvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
      ctx.restore();
    });

    if (drawingModeRef.current !== "pen" || livePointsRef.current.length === 0)
      return;

    const pageNumber = currentPageRef.current;
    if (!pageNumber) return;
    const entry = pageCanvasMapRef.current.get(pageNumber);
    if (!entry) return;
    const ctx = entry.liveCanvas.getContext("2d");
    if (!ctx) return;

    if (livePointsRef.current.length === 1) {
      const p = livePointsRef.current[0];
      ctx.beginPath();
      ctx.fillStyle = penColorRef.current;
      ctx.globalAlpha = penOpacityRef.current;
      ctx.arc(p.x, p.y, penWidthRef.current / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    drawStrokePath(
      ctx,
      livePointsRef.current,
      penColorRef.current,
      penWidthRef.current,
      penOpacityRef.current
    );
  };

  const refreshCanvases = () => {
    syncPageCanvases();
    syncCanvasPointers();
    renderStaticCanvases();
    renderLiveCanvas();
  };

  useEffect(() => {
    refreshCanvases();
  }, [drawingMode, showAnnotations]);

  useEffect(() => {
    renderStaticCanvases();
  }, [chapterStrokes]);

  useEffect(() => {
    renderLiveCanvas();
  }, [drawingMode, penColor, penWidth, penOpacity]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      scheduleRenderRefresh();
      setLayoutTick((t) => t + 1);
    });
    if (viewerRef.current) ro.observe(viewerRef.current);
    if (viewerContainerRef.current) ro.observe(viewerContainerRef.current);
    const handleWinResize = () => setLayoutTick((t) => t + 1);
    window.addEventListener("resize", handleWinResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", handleWinResize);
    };
  }, []);

  // Scroll 시 보이는 페이지 집합을 재계산해 캔버스 레이어가 사라지지 않도록 함
  useEffect(() => {
    const el = viewerContainerRef.current;
    if (!el) return;
    const onScroll = () => scheduleRenderRefresh();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Cleanup pen handlers and layers on unmount
  useEffect(() => {
    return () => {
      pageCanvasMapRef.current.forEach((entry) => {
        unbindPenHandlers(entry.liveCanvas);
        entry.layer?.remove();
      });
      pageCanvasMapRef.current.clear();
    };
  }, []);

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
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim() || !viewerContainerRef.current) {
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
    const rect = range.getBoundingClientRect();
    let top = rect.top - 50;
    let left = rect.left + rect.width / 2 - 80;
    if (top < 8) top = rect.bottom + 8;
    if (left < 8) left = 8;
    if (left + 180 > window.innerWidth) left = window.innerWidth - 200;

    setSelection({
      text: sel.toString(),
      top,
      left,
      show: true,
    });
  };

  const handleContainerPointerUp = () => {
    if (drawingMode !== "idle") return;
    // native selection이 완성된 뒤에 계산
    setTimeout(checkPdfSelection, 10);
  };

  const applyHighlight = () => {
    const sel = window.getSelection();
    if (
      !sel ||
      !sel.toString().trim() ||
      !viewerContainerRef.current ||
      !scaleWrapperRef.current
    ) {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }
    const range = sel.getRangeAt(0);
    // 선택 지점이 속한 PDF 페이지 찾기
    const anchorElement =
      (range.startContainer as HTMLElement | null)?.closest?.(".page") ||
      range.startContainer?.parentElement?.closest?.(".page");
    const pageEl = anchorElement as HTMLElement | null;
    const pageNumber = pageEl ? Number(pageEl.dataset.pageNumber) : null;
    if (!pageEl || !pageNumber) {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }

    const containerRect = viewerContainerRef.current.getBoundingClientRect();
    const scrollLeft = viewerContainerRef.current.scrollLeft;
    const scrollTop = viewerContainerRef.current.scrollTop;
    const pageRect = pageEl.getBoundingClientRect();

    const scaleRaw = getComputedStyle(scaleWrapperRef.current).getPropertyValue(
      "--visual-scale"
    );
    const visualScale = parseFloat(scaleRaw) || 1;

    // 미세 보정 값 (살짝 위로, 높이 축소)
    const TOP_OFFSET = 0.5;
    const HEIGHT_PAD = 1;

    // Unscale first, then add scroll offsets so highlights don't drift after scrolling
    const rects: HighlightRect[] = Array.from(range.getClientRects()).map(
      (r) => ({
        // 페이지 좌표계 기준으로 저장해 리사이즈/사이드바 토글에도 스케일 재적용 가능하도록 함
        left: (r.left - pageRect.left) / visualScale,
        top:
          (r.top - pageRect.top) / visualScale -
          TOP_OFFSET / Math.max(visualScale, 0.0001),
        width: r.width / visualScale,
        height: Math.max(r.height / visualScale - HEIGHT_PAD, 1),
        pageNumber,
        pageWidth: pageRect.width / visualScale,
        pageHeight: pageRect.height / visualScale,
      })
    );
    // BookContext에도 기록하여 사이드바/검색과 연동하며 동일 ID를 공유
    const id = addHighlight(
      sel.toString(),
      undefined,
      "reference-doc",
      pageNumber
    );
    const mergedRects = mergeHighlightRects(rects);
    setPdfHighlights((prev) => [...prev, { id, rects: mergedRects }]);
    setSelection((prev) => ({ ...prev, show: false }));
    sel.removeAllRanges();
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
