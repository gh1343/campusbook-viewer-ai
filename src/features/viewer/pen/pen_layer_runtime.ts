import { PageCanvasEntry } from "../utils/pdfUtils";

interface MutableRef<T> {
  current: T;
}

interface PenLayerRuntimeDeps {
  viewerRef: MutableRef<HTMLElement | null>;
  viewerContainerRef: MutableRef<HTMLElement | null>;
  pageCanvasMapRef: MutableRef<Map<number, PageCanvasEntry>>;
  currentPageRef: MutableRef<number | null>;
  rafRefreshId: MutableRef<number | null>;
  drawingModeRef: MutableRef<string>;
  penColorRef: MutableRef<string>;
  penWidthRef: MutableRef<number>;
  penOpacityRef: MutableRef<number>;
  chapterStrokesRef: MutableRef<Record<string, any[]>>;
  showAnnotationsRef: MutableRef<boolean>;
  livePointsRef: MutableRef<{ x: number; y: number }[]>;
  isDrawingRef: MutableRef<boolean>;
  getVisualScale: () => number;
  getPagePoint: (e: React.PointerEvent, pageEl: HTMLElement, getVisualScale: () => number) => { x: number; y: number } | null;
  getPageElementFromEvent: (e: React.PointerEvent) => { pageEl: HTMLElement; pageNumber: number } | null;
  getPageElementByNumber: (pageNumber: number) => HTMLElement | null;
  getCanvasMetrics: (pageEl: HTMLElement) => { rect: DOMRect; dpr: number; visualScale: number; width: number; height: number };
  drawStrokePath: (
    ctx: CanvasRenderingContext2D,
    points: { x: number; y: number }[],
    color: string,
    width: number,
    opacity: number
  ) => void;
  addStroke: (chapterId: string, stroke: any) => void;
  removeStroke: (chapterId: string, strokeId: string) => void;
}

export const createPenLayerRuntime = (deps: PenLayerRuntimeDeps) => {
  const {
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
  } = deps;

  let activePointerId: number | null = null;

  const isTouchInputBlocked = (e: React.PointerEvent) =>
    drawingModeRef.current === "pen" && e.pointerType === "touch";

  const createCanvas = (className: string, ariaHidden?: string) => {
    const canvas = document.createElement("canvas");
    canvas.className = className;
    if (ariaHidden) {
      canvas.setAttribute("aria-hidden", ariaHidden);
    }
    return canvas;
  };

  const sizePageCanvas = (
    pageEl: HTMLElement,
    staticCanvas: HTMLCanvasElement,
    liveCanvas: HTMLCanvasElement
  ) => {
    const { width, height, dpr } = getCanvasMetrics(pageEl);
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

  const handlePenStart = (e: React.PointerEvent) => {
    if (isTouchInputBlocked(e)) {
      e.preventDefault();
      return; // Block finger/palm when pen tool is active
    }
    if (drawingModeRef.current === "idle") return;
    activePointerId = e.pointerId;
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
    if (isTouchInputBlocked(e)) {
      e.preventDefault();
      return;
    }
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
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
          (p: any) => Math.hypot(p.x - pt.x, p.y - pt.y) < 16
        );
        if (hit) removeStroke("pdf-main", stroke.id);
      });
    }
  };

  const handlePenEnd = (e: React.PointerEvent) => {
    if (isTouchInputBlocked(e)) {
      e.preventDefault();
      return;
    }
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
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
    activePointerId = null;
    renderLiveCanvas();
  };

  const bindPenHandlers = (canvas: HTMLCanvasElement) => {
    if (canvas.dataset.penBound) return;
    canvas.addEventListener("pointerdown", handlePenStart);
    canvas.addEventListener("pointermove", handlePenMove);
    canvas.addEventListener("pointerup", handlePenEnd);
    canvas.addEventListener("pointerleave", handlePenEnd);
    canvas.addEventListener("pointercancel", handlePenEnd);
    canvas.dataset.penBound = "1";
  };

  const unbindPenHandlers = (canvas: HTMLCanvasElement) => {
    if (!canvas.dataset.penBound) return;
    canvas.removeEventListener("pointerdown", handlePenStart);
    canvas.removeEventListener("pointermove", handlePenMove);
    canvas.removeEventListener("pointerup", handlePenEnd);
    canvas.removeEventListener("pointerleave", handlePenEnd);
    canvas.removeEventListener("pointercancel", handlePenEnd);
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

  const pageWithinBuffer = (
    pageEl: HTMLElement,
    viewRect: DOMRect,
    buffer: number
  ) => {
    const r = pageEl.getBoundingClientRect();
    return r.bottom >= viewRect.top - buffer && r.top <= viewRect.bottom + buffer;
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
      strokes.forEach((s: any) =>
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

  return {
    handlePenStart,
    handlePenMove,
    handlePenEnd,
    syncPageCanvases,
    syncCanvasPointers,
    renderStaticCanvases,
    renderLiveCanvas,
    refreshCanvases,
    disposePageEntry,
    getPageStrokes,
  };
};
