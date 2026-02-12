import type React from "react";
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
  chapterStrokesRef: MutableRef<any[]>;
  showAnnotationsRef: MutableRef<boolean>;
  livePointsRef: MutableRef<{ x: number; y: number }[]>;
  isDrawingRef: MutableRef<boolean>;
  isPinchingRef?: MutableRef<boolean>;
  getVisualScale: () => number;
  getPagePoint: (e: React.PointerEvent, pageEl: HTMLElement, getVisualScale: () => number) => { x: number; y: number } | null;
  getPageElementFromEvent: (e: React.PointerEvent) => { pageEl: HTMLElement; pageNumber: number } | null;
  getPageElementByNumber: (pageNumber: number) => HTMLElement | null;
  getCanvasMetrics: (pageEl: HTMLElement) => { rect: DOMRect; dpr: number; visualScale: number; width: number; height: number };
  getZoomRatio: () => number;
  drawStrokePath: (
    ctx: CanvasRenderingContext2D,
    points: { x: number; y: number }[],
    color: string,
    width: number,
    opacity: number
  ) => void;
  addStroke: (stroke: any) => void;
  removeStroke: (strokeId: string) => void;
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
    isPinchingRef,
    getVisualScale,
    getPagePoint,
    getPageElementFromEvent,
    getPageElementByNumber,
    getCanvasMetrics,
    getZoomRatio,
    drawStrokePath,
    addStroke,
    removeStroke,
  } = deps;

  let activePointerId: number | null = null;

  const isPinching = () => isPinchingRef?.current ?? false;

  const getPageSize = (pageEl: HTMLElement) => {
    const { width, height } = getCanvasMetrics(pageEl);
    return { width, height };
  };

  const getStrokeScale = (
    stroke: { pageWidth?: number; pageHeight?: number },
    pageWidth: number,
    pageHeight: number
  ) => {
    if (!pageWidth || !pageHeight) {
      return { scaleX: 1, scaleY: 1 };
    }
    const baseWidth = stroke.pageWidth || pageWidth;
    const baseHeight = stroke.pageHeight || pageHeight;
    const scaleX = baseWidth ? pageWidth / baseWidth : 1;
    const scaleY = baseHeight ? pageHeight / baseHeight : 1;
    return { scaleX, scaleY };
  };

  const scaleStrokePoints = (
    points: { x: number; y: number }[],
    scaleX: number,
    scaleY: number
  ) => {
    if (Math.abs(scaleX - 1) < 0.0001 && Math.abs(scaleY - 1) < 0.0001) {
      return points;
    }
    return points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
  };

  const calculateStraightness = (points: { x: number; y: number }[]) => {
    if (points.length < 5) return 0;
    const start = points[0];
    const end = points[points.length - 1];
    const directDist = Math.hypot(end.x - start.x, end.y - start.y);
    let totalDist = 0;
    for (let i = 1; i < points.length; i++) {
      totalDist += Math.hypot(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y
      );
    }
    if (totalDist === 0) return 0;
    return directDist / totalDist;
  };

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

    // 메모리 최적화: 최대 캔버스 크기 제한 (iPad Safari 메모리 한계 고려)
    // 4096x4096 = 67MB per canvas, 안전한 상한선
    const MAX_CANVAS_DIMENSION = 4096;

    let targetWidth = width * dpr;
    let targetHeight = height * dpr;

    // 최대 크기를 초과하면 비율을 유지하며 축소
    if (targetWidth > MAX_CANVAS_DIMENSION || targetHeight > MAX_CANVAS_DIMENSION) {
      const scale = Math.min(
        MAX_CANVAS_DIMENSION / targetWidth,
        MAX_CANVAS_DIMENSION / targetHeight
      );
      targetWidth = Math.floor(targetWidth * scale);
      targetHeight = Math.floor(targetHeight * scale);
    }

    [staticCanvas, liveCanvas].forEach((canvas) => {
      // 크기가 이미 맞으면 스킵 (메모리 재할당 방지)
      if (canvas.width === targetWidth && canvas.height === targetHeight) {
        return;
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // 스케일 조정: 실제 dpr 대신 제한된 크기 기반
        const effectiveScale = targetWidth / width;
        ctx.scale(effectiveScale, effectiveScale);
      }
    });
  };

  // 터치 포인터 추적 (핀치 감지용)
  const activeTouchPointers = new Set<number>();

  const cancelDrawingForPinch = () => {
    isDrawingRef.current = false;
    livePointsRef.current = [];
    currentPageRef.current = null;
    activePointerId = null;
    renderLiveCanvas();
  };

  // 모든 터치 포인터 상태 초기화
  const resetTouchState = () => {
    activeTouchPointers.clear();
    cancelDrawingForPinch();
  };

  // 메모리 정리: 화면 밖 캔버스 즉시 제거
  const forceCleanupOffscreenCanvases = () => {
    if (!viewerRef.current || !viewerContainerRef.current) return;
    const viewRect = viewerContainerRef.current.getBoundingClientRect();
    const visualScale = getVisualScale();
    const BUFFER = Math.max(100, Math.floor(400 / visualScale));

    const visiblePages = new Set<number>();
    const pages = Array.from(
      viewerRef.current.querySelectorAll<HTMLElement>(".page")
    );

    pages.forEach((pageEl) => {
      if (pageWithinBuffer(pageEl, viewRect, BUFFER)) {
        const pageNumber = Number(pageEl.dataset.pageNumber);
        if (pageNumber) visiblePages.add(pageNumber);
      }
    });

    // 보이지 않는 페이지의 캔버스 즉시 정리
    for (const [pageNumber] of pageCanvasMapRef.current.entries()) {
      if (!visiblePages.has(pageNumber)) {
        disposePageEntry(pageNumber);
      }
    }
  };

  const handlePenStart = (e: React.PointerEvent) => {
    // 펜 입력 처리 (최우선)
    if (e.pointerType === "pen") {
      // 펜 모드가 아니면 무시
      if (drawingModeRef.current === "idle") return;

      e.preventDefault();
      e.stopPropagation();

      // 컨테이너의 touch-action을 일시적으로 none으로 설정 (펜 그리기 중 스크롤 방지)
      if (viewerContainerRef.current) {
        viewerContainerRef.current.style.touchAction = "none";
      }

      activePointerId = e.pointerId;
      const info = getPageElementFromEvent(e);
      if (!info) return;
      const { pageEl, pageNumber } = info;

      // 포인터 캡처는 컨테이너에서만 (캔버스가 아닐 때)
      const target = e.target as HTMLElement;
      if (target && !target.classList.contains('pdf_pen_page_canvas_live')) {
        try {
          target.setPointerCapture?.(e.pointerId);
        } catch (err) {
          // 캡처 실패는 무시
        }
      }

      const pt = getPagePoint(e, pageEl, getVisualScale);
      if (!pt) {
        return;
      }
      currentPageRef.current = pageNumber;
      isDrawingRef.current = true;
      livePointsRef.current = [pt];
      renderLiveCanvas();
      return;
    }

    // 터치 포인터 추적
    if (e.pointerType === "touch") {
      activeTouchPointers.add(e.pointerId);
      // 두 손가락 이상이면 핀치줌으로 간주하고 드로잉 취소
      if (activeTouchPointers.size >= 2) {
        cancelDrawingForPinch();
        return;
      }
    }

    // 핀치줌 중에는 펜 입력 무시
    if (isPinching()) return;

    // 펜/형광펜 모드일 때: 터치는 스크롤/핀치줌용으로 허용, 펜만 그리기
    if ((drawingModeRef.current === "pen" || drawingModeRef.current === "highlighter") && e.pointerType === "touch") {
      // 손가락은 스크롤용으로 이벤트 통과 (preventDefault 하지 않음)
      return;
    }

    if (drawingModeRef.current === "idle") return;

    // 이미 다른 포인터가 활성화되어 있으면 무시 (핀치줌 허용)
    if (activePointerId !== null && activePointerId !== e.pointerId) {
      return;
    }

    activePointerId = e.pointerId;
    const info = getPageElementFromEvent(e);
    if (!info) return;
    const { pageEl, pageNumber } = info;

    // 마우스 입력일 때도 포인터 캡처
    if (e.pointerType === "mouse") {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    const pt = getPagePoint(e, pageEl, getVisualScale);
    if (!pt) return;
    currentPageRef.current = pageNumber;
    isDrawingRef.current = true;
    livePointsRef.current = [pt];
    renderLiveCanvas();
  };

  const handlePenMove = (e: React.PointerEvent) => {
    // 펜 입력 처리 (최우선)
    if (e.pointerType === "pen") {
      // 펜이 활성 포인터가 아니면 무시
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      if (drawingModeRef.current === "idle") return;
      if (e.buttons === 0 && !isDrawingRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      const pageNumber =
        currentPageRef.current || getPageElementFromEvent(e)?.pageNumber || null;
      if (!pageNumber) return;
      const pageEl = getPageElementByNumber(pageNumber);
      if (!pageEl) return;

      const pt = getPagePoint(e, pageEl, getVisualScale);
      if (!pt) return;

      if (drawingModeRef.current === "pen" || drawingModeRef.current === "highlighter") {
        isDrawingRef.current = true;
        currentPageRef.current = pageNumber;
        if (livePointsRef.current.length === 0) {
          livePointsRef.current = [pt];
        } else {
          livePointsRef.current.push(pt);
        }
        renderLiveCanvas();
      } else if (drawingModeRef.current === "eraser") {
        const pageSize = getPageSize(pageEl);
        const strokes = getPageStrokes(pageNumber);
        strokes.forEach((stroke: any) => {
          let hit: boolean;
          if (stroke.normalized) {
            hit = stroke.points.some(
              (p: any) =>
                Math.hypot(p.x * pageSize.width - pt.x, p.y * pageSize.height - pt.y) < 16
            );
          } else {
            const { scaleX, scaleY } = getStrokeScale(
              stroke,
              pageSize.width,
              pageSize.height
            );
            hit = stroke.points.some(
              (p: any) =>
                Math.hypot(p.x * scaleX - pt.x, p.y * scaleY - pt.y) <
                16 * scaleX
            );
          }
          if (hit) removeStroke(stroke.id);
        });
      }
      return;
    }

    // 두 손가락 이상 터치 중이면 핀치줌으로 간주
    if (e.pointerType === "touch" && activeTouchPointers.size >= 2) {
      cancelDrawingForPinch();
      return;
    }

    // 핀치줌 중에는 펜 입력 무시
    if (isPinching()) {
      cancelDrawingForPinch();
      return;
    }

    // 펜/형광펜 모드일 때: 터치는 스크롤용으로 허용, 펜만 그리기
    if ((drawingModeRef.current === "pen" || drawingModeRef.current === "highlighter") && e.pointerType === "touch") {
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

    const pt = getPagePoint(e, pageEl, getVisualScale);
    if (!pt) return;

    if (drawingModeRef.current === "pen" || drawingModeRef.current === "highlighter") {
      isDrawingRef.current = true;
      currentPageRef.current = pageNumber;
      if (livePointsRef.current.length === 0) {
        livePointsRef.current = [pt];
      } else {
        livePointsRef.current.push(pt);
      }
      renderLiveCanvas();
    } else if (drawingModeRef.current === "eraser") {
      const pageSize = getPageSize(pageEl);
      const strokes = getPageStrokes(pageNumber);
      strokes.forEach((stroke: any) => {
        let hit: boolean;
        if (stroke.normalized) {
          hit = stroke.points.some(
            (p: any) =>
              Math.hypot(p.x * pageSize.width - pt.x, p.y * pageSize.height - pt.y) < 16
          );
        } else {
          const { scaleX, scaleY } = getStrokeScale(
            stroke,
            pageSize.width,
            pageSize.height
          );
          hit = stroke.points.some(
            (p: any) =>
              Math.hypot(p.x * scaleX - pt.x, p.y * scaleY - pt.y) <
              16 * scaleX
          );
        }
        if (hit) removeStroke(stroke.id);
      });
    }
  };

  const handlePenEnd = (e: React.PointerEvent) => {
    // 펜 입력 종료 처리
    if (e.pointerType === "pen" && activePointerId === e.pointerId) {
      // 컨테이너의 touch-action 복원 (손가락 스크롤 다시 허용)
      if (viewerContainerRef.current) {
        viewerContainerRef.current.style.touchAction = "pan-x pan-y";
      }
    }

    // 터치 포인터 추적에서 제거 (항상 실행)
    if (e.pointerType === "touch") {
      activeTouchPointers.delete(e.pointerId);
    }

    // activePointerId 정리 (해당 포인터가 끝났으면)
    if (activePointerId === e.pointerId) {
      activePointerId = null;
    }

    // 펜/형광펜 모드일 때: 터치는 스크롤용으로 허용
    if ((drawingModeRef.current === "pen" || drawingModeRef.current === "highlighter") && e.pointerType === "touch") {
      return;
    }

    if (!isDrawingRef.current && drawingModeRef.current !== "eraser") return;
    const el = e.target as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId)) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch (err) {
        // 캡처 해제 실패는 무시
      }
    }
    const pageNumber = currentPageRef.current;
    if (
      (drawingModeRef.current === "pen" || drawingModeRef.current === "highlighter") &&
      pageNumber &&
      livePointsRef.current.length > 1
    ) {
      const pageEl = getPageElementByNumber(pageNumber);
      const pageSize = pageEl ? getPageSize(pageEl) : null;
      const straightness = calculateStraightness(livePointsRef.current);
      let finalPoints = livePointsRef.current;
      if (straightness > 0.88 && livePointsRef.current.length > 5) {
        finalPoints = [
          livePointsRef.current[0],
          livePointsRef.current[livePointsRef.current.length - 1],
        ];
      }
      // 포인트와 두께를 페이지 크기 기준으로 정규화 (0~1 비율)
      // 확대/축소와 무관하게 일관된 필기 두께를 유지하기 위함
      const pw = pageSize?.width || 1;
      const ph = pageSize?.height || 1;
      const zoomRatio = getZoomRatio();
      const normalizedPoints = finalPoints.map((p) => ({
        x: p.x / pw,
        y: p.y / ph,
      }));
      // 두께를 줌 보정 후 정규화: penWidth * zoomRatio = 1x 기준 실제 두께
      const newStroke = {
        id: Date.now().toString(),
        points: normalizedPoints,
        color: penColorRef.current,
        width: (penWidthRef.current * zoomRatio) / pw,
        opacity: penOpacityRef.current,
        pageNumber,
        pageWidth: pageSize?.width,
        pageHeight: pageSize?.height,
        normalized: true,
      };
      addStroke(newStroke);
    }
    isDrawingRef.current = false;
    livePointsRef.current = [];
    currentPageRef.current = null;
    activePointerId = null;
    renderLiveCanvas();
  };

  const bindPenHandlers = (canvas: HTMLCanvasElement) => {
    if (canvas.dataset.penBound) return;
    canvas.addEventListener("pointerdown", handlePenStart, { passive: false });
    canvas.addEventListener("pointermove", handlePenMove, { passive: false });
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

    // 메모리 최적화: 확대 배율에 따라 버퍼 동적 조정
    const visualScale = getVisualScale();
    // 배율이 높을수록 버퍼를 줄여서 메모리 절약
    // 1.0배율: 400px, 2.0배율: 200px, 3.0배율: 133px
    const BUFFER = Math.max(100, Math.floor(400 / visualScale));

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
    const active = mode === "pen" || mode === "highlighter" || mode === "eraser";
    pageCanvasMapRef.current.forEach(({ liveCanvas }) => {
      // 펜/형광펜 모드일 때는 pointer-events를 none으로 설정하여 터치 이벤트 통과
      // 펜 입력은 컨테이너에서 직접 처리
      if (mode === "pen" || mode === "highlighter") {
        liveCanvas.style.pointerEvents = "none";
        liveCanvas.style.cursor = "crosshair";
      } else {
        liveCanvas.style.pointerEvents = active ? "auto" : "none";
        liveCanvas.style.cursor = active ? "crosshair" : "default";
      }
      liveCanvas.style.touchAction = "none";
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
    (chapterStrokesRef.current || []).filter(
      (s) => strokeMatchesPage(s, pageNumber) && !s.deleted
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

      const pageRect = staticCanvas.getBoundingClientRect();
      const pageWidth = pageRect.width;
      const pageHeight = pageRect.height;

      const strokes = getPageStrokes(pageNumber);
      strokes.forEach((s: any) => {
        let points: { x: number; y: number }[];
        let width: number;
        if (s.normalized) {
          // 정규화된 스트로크: 0~1 비율 → 현재 페이지 크기로 복원
          points = s.points.map((p: any) => ({
            x: p.x * pageWidth,
            y: p.y * pageHeight,
          }));
          width = (s.width || 3 / pageWidth) * pageWidth;
        } else {
          // 기존 비정규화 스트로크: 호환성 유지
          const { scaleX, scaleY } = getStrokeScale(s, pageWidth, pageHeight);
          points = scaleStrokePoints(s.points, scaleX, scaleY);
          width = (s.width || 3) * scaleX;
        }
        drawStrokePath(ctx, points, s.color, width, s.opacity ?? 1);
      });
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

    if ((drawingModeRef.current !== "pen" && drawingModeRef.current !== "highlighter") || livePointsRef.current.length === 0)
      return;

    const pageNumber = currentPageRef.current;
    if (!pageNumber) return;
    const entry = pageCanvasMapRef.current.get(pageNumber);
    if (!entry) return;
    const ctx = entry.liveCanvas.getContext("2d");
    if (!ctx) return;

    // 줌 보정: 확대 상태에서도 시각적으로 동일한 두께로 그리기
    const zoomRatio = getZoomRatio();
    const adjustedWidth = penWidthRef.current * zoomRatio;

    if (livePointsRef.current.length === 1) {
      const p = livePointsRef.current[0];
      ctx.beginPath();
      ctx.fillStyle = penColorRef.current;
      ctx.globalAlpha = penOpacityRef.current;
      ctx.arc(p.x, p.y, adjustedWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    const straightness = calculateStraightness(livePointsRef.current);
    const isStraightIntent =
      straightness > 0.92 && livePointsRef.current.length > 10;
    if (isStraightIntent) {
      const start = livePointsRef.current[0];
      const end = livePointsRef.current[livePointsRef.current.length - 1];
      ctx.beginPath();
      ctx.lineWidth = adjustedWidth;
      ctx.strokeStyle = penColorRef.current;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = penOpacityRef.current;
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.shadowBlur = 4;
      ctx.shadowColor = penColorRef.current;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      return;
    }

    drawStrokePath(
      ctx,
      livePointsRef.current,
      penColorRef.current,
      adjustedWidth,
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
    resetTouchState,
    forceCleanupOffscreenCanvases,
  };
};
