// src/components/viewer/PdfViewer.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  GlobalWorkerOptions,
  getDocument,
  version as pdfjsVersion,
} from "pdfjs-dist";
import {
  PDFViewer,
  EventBus,
  PDFLinkService,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import "../../css/pdf_viewer.css";
import { useBook } from "../../contexts/BookContext";
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
  const penCanvasRef = useRef<HTMLCanvasElement>(null);
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
  const pdfViewerRef = useRef<PDFViewer | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"" | "ok" | "fail">("");
  const copyResetRef = useRef<number | null>(null);

  type HighlightRect = {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  type PdfHighlight = { id: string; rects: HighlightRect[] };

  const [pdfHighlights, setPdfHighlights] = useState<PdfHighlight[]>([]);
  const [selection, setSelection] = useState<{
    text: string;
    top: number;
    left: number;
    show: boolean;
  }>({ text: "", top: 0, left: 0, show: false });
  const [isDrawing, setIsDrawing] = useState(false);
  const isDrawingRef = useRef(false);
  const livePointsRef = useRef<{ x: number; y: number }[]>([]);

  useEffect(() => {
    // Keep local overlay in sync with global highlights (e.g., sidebar delete)
    setPdfHighlights((prev) =>
      prev.filter((h) => highlights.some((hl) => hl.id === h.id))
    );
  }, [highlights]);

  useEffect(() => {
    if (!viewerRef.current) return;

    const clearPrev = () => {
      viewerRef.current?.querySelectorAll(".textLayer span").forEach((span) => {
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

    const applyHighlight = () => {
      const pageEl = viewerRef.current?.querySelector(
        `.page[data-page-number="${pdfSearchHighlight.page}"]`
      );
      const textLayer = pageEl?.querySelector(".textLayer");
      if (!textLayer) return false;

      clearPrev();
      const term = pdfSearchHighlight.term.trim();
      if (!term) return false;
      const re = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi"
      );
      textLayer.querySelectorAll("span").forEach((span) => {
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
      return true;
    };

    // Try immediately; if textLayer not ready, retry shortly
    if (!applyHighlight()) {
      const timer = setTimeout(applyHighlight, 250);
      return () => clearTimeout(timer);
    }
  }, [pdfSearchHighlight]);

  useEffect(() => {
    if (!activeHighlightId || !viewerContainerRef.current) return;
    const target = pdfHighlights.find((h) => h.id === activeHighlightId);
    if (!target || target.rects.length === 0) return;

    const first = target.rects[0];
    const nextTop = Math.max(0, first.top - 40);
    const nextLeft = Math.max(0, first.left - 20);
    viewerContainerRef.current.scrollTo({
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
    setErrorMsg(null); // 이전 에러 메시지 초기화

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });

    const pdfViewer = new PDFViewer({
      container: viewerContainerRef.current,
      viewer: viewerRef.current,
      eventBus,
      linkService,
      textLayerMode: 2,
      annotationMode: 2,
      removePageBorders: true,
    });
    pdfViewerRef.current = pdfViewer;

    const INTERNAL_SCALE = 2.1; // 내부 렌더링 확대 비율(원하는 숫자)

    eventBus.on("pagesinit", () => {
      pdfViewer.currentScale = INTERNAL_SCALE;
    });

    eventBus.on("pagechanging", (evt: any) => {
      if (evt?.pageNumber) {
        // ControlBar와 동기화
        onPageChange?.(evt.pageNumber);
      }
    });

    eventBus.on("pagesloaded", (evt: any) => {
      if (evt?.pagesCount) {
        onPagesCount?.(evt.pagesCount);
      }
    });

    // ControlBar에서 페이지 점프할 때 호출할 함수 등록
    registerGoToPage?.((page: number) => {
      if (
        !pdfViewerRef.current ||
        !pdfViewerRef.current.pdfDocument ||
        !pdfViewerRef.current.pagesCount
      )
        return;
      const maxPage = pdfViewerRef.current.pdfDocument.numPages;
      const target = Math.min(
        Math.max(page, 1),
        maxPage
      );
      pdfViewerRef.current.currentPageNumber = target;
      pdfViewerRef.current.scrollPageIntoView({ pageNumber: target });
    });

    linkService.setViewer(pdfViewer);

    let cancelled = false;
    let loadingTask = getDocument(file);

    loadingTask.promise
      .then((pdfDoc) => {
        if (cancelled) return;
        setLoading(false);
        setErrorMsg(null);
        pdfViewer.setDocument(pdfDoc);
        linkService.setDocument(pdfDoc, null);
        onPagesCount?.(pdfDoc.numPages);

        const extractText = async () => {
          const pages: { page: number; text: string }[] = [];
          try {
            for (let i = 1; i <= pdfDoc.numPages; i++) {
              const page = await pdfDoc.getPage(i);
              const textContent = await page.getTextContent();
              const strings = textContent.items
                .map((item: any) => ("str" in item ? item.str : ""))
                .join(" ");
              pages.push({ page: i, text: strings });
            }
            if (!cancelled) setPdfTextPages(pages);
          } catch (err) {
            console.error("PDF text extraction failed", err);
          }
        };
        extractText();
      })
      .catch((err: any) => {
        if (cancelled) return;
        if (err?.message === "Worker was destroyed") {
          console.debug("[PdfViewer] worker destroyed (cleanup)");
          return;
        }
        console.error("[PdfViewer] load error:", err);
        setErrorMsg(err?.message || "PDF 로드 실패");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
      pdfViewerRef.current = null;
    };
  }, [file, onPageChange, onPagesCount, registerGoToPage, setPdfTextPages]);

  // ----- Pen Canvas Helpers -----
  const getVisualScale = () => {
    if (!scaleWrapperRef.current) return 1;
    const raw = getComputedStyle(scaleWrapperRef.current).getPropertyValue(
      "--visual-scale"
    );
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 1;
  };

  const resizePenCanvas = () => {
    const canvas = penCanvasRef.current;
    const container = viewerContainerRef.current;
    const viewer = viewerRef.current;
    if (!canvas || !container || !viewer) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(viewer.scrollWidth, container.clientWidth);
    const height = Math.max(viewer.scrollHeight, container.scrollHeight);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    renderPenCanvas();
  };

  useEffect(() => {
    resizePenCanvas();
    const ro = new ResizeObserver(resizePenCanvas);
    if (viewerRef.current) ro.observe(viewerRef.current);
    if (viewerContainerRef.current) ro.observe(viewerContainerRef.current);
    return () => ro.disconnect();
  }, []);

  const getCanvasPoint = (e: React.PointerEvent): { x: number; y: number } | null => {
    const container = viewerContainerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const visualScale = getVisualScale();
    const x = (e.clientX - rect.left) / visualScale + container.scrollLeft;
    const y = (e.clientY - rect.top) / visualScale + container.scrollTop;
    return { x, y };
  };

  const handlePenStart = (e: React.PointerEvent) => {
    if (drawingMode === "idle") return;
    if (!penCanvasRef.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const pt = getCanvasPoint(e);
    if (!pt) return;
    isDrawingRef.current = true;
    setIsDrawing(true);
    livePointsRef.current = [pt];
    renderPenCanvas();
  };

  const handlePenMove = (e: React.PointerEvent) => {
    if (!isDrawingRef.current || drawingMode === "idle") return;
    e.preventDefault();
    const pt = getCanvasPoint(e);
    if (!pt) return;

    if (drawingMode === "pen") {
      livePointsRef.current = [...livePointsRef.current, pt];
      renderPenCanvas();
    } else if (drawingMode === "eraser") {
      const strokes = chapterStrokes["pdf-main"] || [];
      strokes.forEach((stroke) => {
        const hit = stroke.points.some(
          (p) => Math.hypot(p.x - pt.x, p.y - pt.y) < 16
        );
        if (hit) removeStroke("pdf-main", stroke.id);
      });
    }
  };

  const handlePenEnd = (e: React.PointerEvent) => {
    if (!isDrawingRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    isDrawingRef.current = false;
    setIsDrawing(false);
    if (drawingMode === "pen" && livePointsRef.current.length > 1) {
      const newStroke = {
        id: Date.now().toString(),
        points: livePointsRef.current,
        color: penColor,
        width: penWidth,
        opacity: penOpacity,
      };
      addStroke("pdf-main", newStroke);
    }
    livePointsRef.current = [];
    renderPenCanvas();
  };

  // Draw strokes + live stroke
  const renderPenCanvas = () => {
    const canvas = penCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (!showAnnotations && livePointsRef.current.length === 0) return;

    const drawStroke = (
      points: { x: number; y: number }[],
      color: string,
      width: number,
      opacity: number
    ) => {
      if (points.length < 2) return;
      ctx.beginPath();
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = opacity;
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const mid = {
          x: (points[i].x + points[i + 1].x) / 2,
          y: (points[i].y + points[i + 1].y) / 2,
        };
        ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const strokes = chapterStrokes["pdf-main"] || [];
    strokes.forEach((s) =>
      drawStroke(s.points, s.color, s.width || 3, s.opacity ?? 1)
    );
    if (livePointsRef.current.length > 1 && drawingMode === "pen") {
      drawStroke(livePointsRef.current, penColor, penWidth, penOpacity);
    }
  };

  useEffect(() => {
    renderPenCanvas();
  }, [
    chapterStrokes,
    isDrawing,
    drawingMode,
    penColor,
    penWidth,
    penOpacity,
    showAnnotations,
  ]);

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

  const VISUAL_SCALE = 0.5; // 화면에 실제로 보여줄 축소 비율 (INTERNAL_SCALE의 역수)

  const mergeHighlightRects = (rects: HighlightRect[]) => {
    const TOL = 1.5; // allow tiny overlap/adjacency without stacking opacity
    const merged = rects.map((r) => ({ ...r }));
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < merged.length; i++) {
        for (let j = i + 1; j < merged.length; j++) {
          const a = merged[i];
          const b = merged[j];
          const horizontalOverlap =
            a.left <= b.left + b.width + TOL &&
            a.left + a.width >= b.left - TOL;
          const verticalOverlap =
            a.top <= b.top + b.height + TOL &&
            a.top + a.height >= b.top - TOL;
          if (horizontalOverlap && verticalOverlap) {
            const newLeft = Math.min(a.left, b.left);
            const newTop = Math.min(a.top, b.top);
            const right = Math.max(a.left + a.width, b.left + b.width);
            const bottom = Math.max(a.top + a.height, b.top + b.height);
            merged[i] = {
              left: newLeft,
              top: newTop,
              width: right - newLeft,
              height: bottom - newTop,
            };
            merged.splice(j, 1);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }
    return merged;
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
    const containerRect = viewerContainerRef.current.getBoundingClientRect();
    const scrollLeft = viewerContainerRef.current.scrollLeft;
    const scrollTop = viewerContainerRef.current.scrollTop;

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
        left:
          (r.left - containerRect.left) / visualScale + scrollLeft,
        top:
          (r.top - containerRect.top) / visualScale +
          scrollTop -
          TOP_OFFSET,
        width: r.width / visualScale,
        height: Math.max(r.height / visualScale - HEIGHT_PAD, 1),
      })
    );
    // BookContext에도 기록하여 사이드바/검색과 연동하며 동일 ID를 공유
    const id = addHighlight(sel.toString(), undefined, "reference-doc");
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
    if (!selection.text.trim()) {
      setSelection((prev) => ({ ...prev, show: false }));
      return;
    }
    triggerSmartExplain(selection.text);
    setSelection((prev) => ({ ...prev, show: false }));
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="pdf_viewer">
      {/* 로딩/에러 overlay는 그대로 두세요 */}
      {loading && (
        <div className="pdf_viewer_overlay pdf_viewer_overlay_loading">
          <span className="pdf_viewer_overlay_message">PDF 로딩 중...</span>
        </div>
      )}

      {errorMsg && (
        <div className="pdf_viewer_overlay pdf_viewer_overlay_error">
          <div className="pdf_viewer_error">
            <div className="pdf_viewer_error_title">PDF 로드 오류</div>
            <div>{errorMsg}</div>
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
        {/* ⭐ pdf.js에서 요구하는 container는 그대로 absolute 유지 ⭐ */}
        <div
          ref={viewerContainerRef}
          className="pdf_viewer_container"
          onPointerUp={handleContainerPointerUp}
        >
          <div ref={viewerRef} className="pdfViewer pdf_viewer_content" />
          {/* Pen overlay */}
          <div
            className={`pdf_pen_layer ${
              drawingMode !== "idle" ? "active" : ""
            }`}
          >
            <canvas
              ref={penCanvasRef}
              className="pdf_pen_canvas"
              onPointerDown={handlePenStart}
              onPointerMove={handlePenMove}
              onPointerUp={handlePenEnd}
              onPointerLeave={handlePenEnd}
            />
          </div>
          {/* 커스텀 하이라이트 오버레이 */}
          <div className="pdf_highlight_layer">
            {pdfHighlights.flatMap((h) =>
              h.rects.map((rect, idx) => (
                <div
                  key={`${h.id}-${idx}`}
                  className="pdf_highlight"
                  data-highlight-id={h.id}
                  style={{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  }}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* 선택 플로팅 메뉴 */}
      {selection.show && (
        <div
          className="pdf_selection_menu"
          style={{ top: selection.top, left: selection.left }}
        >
          {(copyStatus === "ok" || copyStatus === "fail") && (
            <span
              className={`pdf_selection_menu_copy_status ${
                copyStatus === "ok"
                  ? "pdf_viewer_copy_status_ok"
                  : "pdf_viewer_copy_status_fail"
              }`}
            >
              {copyStatus === "ok" ? "복사됨" : "선택 없음"}
            </span>
          )}
          <button onClick={applyHighlight}>Highlight</button>
          <div className="pdf_selection_menu_copy_block">
            <button onClick={handleCopySelection}>Copy</button>
          </div>
          <button onClick={handleAskAi}>AI</button>
          <button onClick={cancelSelection}>Cancel</button>
        </div>
      )}
    </div>
  );
};
