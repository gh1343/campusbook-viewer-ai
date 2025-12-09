import React, {useRef, useState, useEffect, useMemo} from 'react';
import {useBook} from '../../contexts/BookContext';
import {Highlighter, MessageCircleQuestion, StickyNote} from 'lucide-react';
import {Point, Stroke, Chapter} from '../../../types';
import html2canvas from 'html2canvas';

interface ContentRendererProps {
  customChapter?: Chapter;
  variant?: 'main' | 'side';
}

export const ContentRenderer: React.FC<ContentRendererProps> = ({
  customChapter,
  variant = 'main',
}) => {
  const {
    currentChapter: contextChapter,
    fontSize,
    viewMode, // From context
    addHighlight,
    drawingMode,
    penColor,
    penWidth,
    penOpacity,
    chapterStrokes,
    addStroke,
    removeStroke,
    highlights,
    activeHighlightId,
    showAnnotations,
    triggerSmartExplain,
    isCaptureMode,
    setCaptureMode,
    setCapturedImage,
  } = useBook();

  const targetChapter = customChapter || contextChapter;
  const canCapture = variant === 'main';

  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentAnchorIndex = useRef<number>(0);

  const [selection, setSelection] = useState<{
    text: string;
    top: number;
    left: number;
    show: boolean;
  }>({text: '', top: 0, left: 0, show: false});
  const [memoInput, setMemoInput] = useState<{show: boolean; text: string}>({
    show: false,
    text: '',
  });
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [captureStart, setCaptureStart] = useState<Point | null>(null);
  const [captureCurrent, setCaptureCurrent] = useState<Point | null>(null);

  useEffect(() => {
    if (!canCapture) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isCaptureMode) {
        setCaptureMode(false);
        setCaptureStart(null);
        setCaptureCurrent(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCaptureMode, setCaptureMode, canCapture]);

  // Render Content
  const renderedContent = useMemo(() => {
    let html = targetChapter.content;
    if (!showAnnotations) return html;

    const chapterHighlights = highlights.filter(
      h => h.chapterId === targetChapter.id
    );
    const sortedHighlights = [...chapterHighlights].sort(
      (a, b) => b.text.length - a.text.length
    );

    sortedHighlights.forEach(hl => {
      const escapedText = hl.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedText, 'g');
      const highlightHtml = `<mark id="hl-${
        hl.id
      }" style="background-color: #fef08a !important; color: #0f172a !important;" class="rounded-sm cursor-pointer hover:brightness-95 transition-colors border-b-2 border-yellow-400" title="${
        hl.note || 'Highlight'
      }">${hl.text}</mark>`;
      html = html.replace(regex, highlightHtml);
    });
    return html;
  }, [targetChapter.content, targetChapter.id, highlights, showAnnotations]);

  // Auto-scroll to highlight
  useEffect(() => {
    if (activeHighlightId && showAnnotations) {
      const el = document.getElementById(`hl-${activeHighlightId}`);
      if (el && document.body.contains(el)) {
        el.scrollIntoView({behavior: 'smooth', block: 'center'});
        el.classList.add('ring-4', 'ring-blue-500', 'ring-offset-2');
        setTimeout(() => {
          el.classList.remove('ring-4', 'ring-blue-500', 'ring-offset-2');
        }, 2000);
      }
    }
  }, [activeHighlightId, renderedContent, showAnnotations]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        !target.closest(`#selection-menu-${variant}`) &&
        !target.closest(`#memo-dialog-${variant}`)
      ) {
        setSelection(prev => ({...prev, show: false}));
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [variant]);

  // --- Unified Selection Logic (Pointer Events) ---
  const checkSelection = () => {
    const winSelection = window.getSelection();
    if (winSelection && winSelection.toString().trim().length > 0) {
      const isInside =
        contentRef.current?.contains(winSelection.anchorNode) ||
        contentRef.current?.contains(winSelection.focusNode);

      if (!isInside) return;

      const range = winSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      let top = rect.top - 60;
      let left = rect.left + rect.width / 2 - 100;

      if (top < 0) top = rect.bottom + 10;
      if (left < 10) left = 10;
      if (left + 200 > window.innerWidth) left = window.innerWidth - 220;

      setSelection({text: winSelection.toString(), top, left, show: true});
    } else {
      setSelection(prev => ({...prev, show: false}));
    }
  };

  const handleWrapperPointerUp = (e: React.PointerEvent) => {
    if (canCapture && isCaptureMode) return;
    if (drawingMode !== 'idle') return;

    // Allow native selection to settle before checking
    setTimeout(checkSelection, 10);
  };

  const handleHighlight = () => {
    addHighlight(selection.text, undefined, targetChapter.id);
    setSelection(prev => ({...prev, show: false}));
    window.getSelection()?.removeAllRanges();
  };

  const handleMemoClick = () => {
    setSelection(prev => ({...prev, show: false}));
    setMemoInput({show: true, text: ''});
  };

  const submitMemo = () => {
    if (memoInput.text.trim()) {
      addHighlight(selection.text, memoInput.text, targetChapter.id);
    }
    setMemoInput({show: false, text: ''});
    window.getSelection()?.removeAllRanges();
  };

  const handleAiExplain = () => {
    triggerSmartExplain(selection.text);
    setSelection(prev => ({...prev, show: false}));
    window.getSelection()?.removeAllRanges();
  };

  // --- Drawing Helpers (Pointer Events) ---
  const getCanvasCoordinates = (e: React.PointerEvent): Point | null => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) return null;

    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    // PointerEvents give us clientX/Y directly
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.PointerEvent) => {
    if (canCapture && isCaptureMode) return;
    if (drawingMode === 'idle') return;

    // Capture pointer to ensure we get move events even if cursor leaves canvas bounds slightly
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const point = getCanvasCoordinates(e);
    if (!point) return;

    setIsDrawing(true);
    setCurrentPoints([point]);

    // Anchoring Logic
    if (contentRef.current && drawingMode === 'pen') {
      const children = Array.from(contentRef.current.children) as HTMLElement[];
      let bestIndex = 0;

      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const clickYRelative = e.clientY - (canvasRect?.top || 0);

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (
          clickYRelative >= child.offsetTop &&
          clickYRelative <= child.offsetTop + child.offsetHeight
        ) {
          bestIndex = i;
          break;
        }
        if (clickYRelative < child.offsetTop) {
          bestIndex = Math.max(0, i - 1);
          break;
        }
        bestIndex = i;
      }
      currentAnchorIndex.current = bestIndex;
    }
  };

  const draw = (e: React.PointerEvent) => {
    if (canCapture && isCaptureMode) return;
    if (!isDrawing || drawingMode === 'idle') return;

    // Prevent default on move to stop native behaviors
    e.preventDefault();

    const point = getCanvasCoordinates(e);
    if (!point) return;

    if (drawingMode === 'pen') {
      setCurrentPoints(prev => [...prev, point]);
    } else if (drawingMode === 'eraser') {
      const strokes = chapterStrokes[targetChapter.id] || [];
      const children = contentRef.current
        ? (Array.from(contentRef.current.children) as HTMLElement[])
        : [];
      strokes.forEach(stroke => {
        let strokePoints = stroke.points;
        if (stroke.anchorIndex !== undefined && children[stroke.anchorIndex]) {
          const offset = children[stroke.anchorIndex].offsetTop;
          strokePoints = stroke.points.map(p => ({x: p.x, y: p.y + offset}));
        }
        const hit = strokePoints.some(
          p => Math.hypot(p.x - point.x, p.y - point.y) < 20
        );
        if (hit) removeStroke(targetChapter.id, stroke.id);
      });
    }
  };

  const stopDrawing = (e: React.PointerEvent) => {
    if (canCapture && isCaptureMode) return;
    if (!isDrawing) return;

    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDrawing(false);

    if (drawingMode === 'pen' && currentPoints.length > 1) {
      let finalPoints = currentPoints;
      let anchorIdx: number | undefined = undefined;
      if (contentRef.current) {
        anchorIdx = currentAnchorIndex.current;
        const children = contentRef.current.children;
        if (children[anchorIdx]) {
          const anchorTop = (children[anchorIdx] as HTMLElement).offsetTop;
          finalPoints = currentPoints.map(p => ({x: p.x, y: p.y - anchorTop}));
        }
      }
      const newStroke: Stroke = {
        id: Date.now().toString(),
        points: finalPoints,
        color: penColor,
        width: penWidth,
        opacity: penOpacity,
        anchorIndex: anchorIdx,
      };
      addStroke(targetChapter.id, newStroke);
    }
    setCurrentPoints([]);
  };

  // --- Capture Logic ---
  const handleCaptureStart = (e: React.MouseEvent) => {
    if (!canCapture || !isCaptureMode) return;
    const pt = {x: e.clientX, y: e.clientY};
    setCaptureStart(pt);
    setCaptureCurrent(pt);
  };
  const handleCaptureMove = (e: React.MouseEvent) => {
    if (!canCapture || !isCaptureMode || !captureStart) return;
    setCaptureCurrent({x: e.clientX, y: e.clientY});
  };
  const handleCaptureEnd = async (e: React.MouseEvent) => {
    if (!canCapture || !isCaptureMode || !captureStart || !captureCurrent) {
      setCaptureStart(null);
      setCaptureCurrent(null);
      return;
    }
    const start = captureStart;
    const end = {x: e.clientX, y: e.clientY};
    const rect = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
    setCaptureStart(null);
    setCaptureCurrent(null);
    if (rect.width < 10 || rect.height < 10) return;
    try {
      const canvas = await html2canvas(document.body, {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
        useCORS: true,
        scale: window.devicePixelRatio,
        ignoreElements: el => el.classList.contains('capture-overlay-ui'),
      });
      setCapturedImage(canvas.toDataURL());
    } catch (err) {
      console.error(err);
    } finally {
      setCaptureMode(false);
    }
  };

  // Canvas Resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !contentRef.current) return;
    const resizeCanvas = () => {
      if (!canvas || !contentRef.current) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = contentRef.current.offsetWidth * dpr;
      canvas.height = contentRef.current.offsetHeight * dpr;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    };
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [targetChapter.id, viewMode]); // Trigger resize on viewMode change

  // Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !contentRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (!showAnnotations && !isDrawing) return;

    const drawStroke = (
      points: Point[],
      color: string,
      width: number,
      opacity: number
    ) => {
      if (points.length < 2) return;
      ctx.beginPath();
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
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
      ctx.globalAlpha = 1.0;
    };

    const children = Array.from(contentRef.current.children) as HTMLElement[];
    const strokes = chapterStrokes[targetChapter.id] || [];
    strokes.forEach(s => {
      let pts = s.points;
      if (s.anchorIndex !== undefined && children[s.anchorIndex]) {
        const offset = children[s.anchorIndex].offsetTop;
        pts = s.points.map(p => ({x: p.x, y: p.y + offset}));
      }
      drawStroke(
        pts,
        s.color,
        s.width || 3,
        s.opacity !== undefined ? s.opacity : 1
      );
    });
    if (isDrawing && currentPoints.length > 1 && drawingMode === 'pen')
      drawStroke(currentPoints, penColor, penWidth, penOpacity);
  }, [
    chapterStrokes,
    targetChapter.id,
    isDrawing,
    currentPoints,
    penColor,
    penWidth,
    penOpacity,
    drawingMode,
    showAnnotations,
  ]);

  const getFontSizeClass = () => {
    switch (fontSize) {
      case 'small':
        return 'text-sm leading-6';
      case 'large':
        return 'text-xl leading-9';
      case 'xlarge':
        return 'text-2xl leading-10';
      default:
        return 'text-lg leading-8';
    }
  };

  const captureBoxStyle: React.CSSProperties =
    canCapture && isCaptureMode && captureStart && captureCurrent
      ? {
          position: 'fixed',
          left: Math.min(captureStart.x, captureCurrent.x),
          top: Math.min(captureStart.y, captureCurrent.y),
          width: Math.abs(captureCurrent.x - captureStart.x),
          height: Math.abs(captureCurrent.y - captureStart.y),
          border: '2px solid #3b82f6',
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          zIndex: 10000,
          pointerEvents: 'none',
        }
      : {};

  // CSS styles specifically to handle touch/pen interactions
  // touch-action: none when drawing: prevents browser scrolling/zooming while drawing.
  const canvasStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    touchAction: drawingMode !== 'idle' ? 'none' : 'auto',
  };

  const canvasClass = `absolute inset-0 z-20 ${
    drawingMode !== 'idle'
      ? 'cursor-crosshair pointer-events-auto'
      : 'pointer-events-none'
  }`;

  // View Mode Styles
  const isDouble = variant === 'main' && viewMode === 'double';
  const containerClass =
    variant === 'main'
      ? `relative w-full bg-white dark:bg-slate-950 shadow-lg min-h-[80vh] p-8 md:p-12 transition-all ${
          isDouble ? 'max-w-full' : 'max-w-3xl'
        }`
      : 'relative w-full bg-white dark:bg-slate-900 p-4 min-h-[500px]';

  // Prose class: add columns-2 if double mode
  const proseClass = `prose prose-slate dark:prose-invert max-w-none select-text cursor-text transition-all duration-200 relative z-10 selection:bg-yellow-200 selection:text-black dark:selection:bg-yellow-700 dark:selection:text-white ${getFontSizeClass()} ${
    isDouble ? 'columns-1 md:columns-2 gap-12 [column-fill:auto]' : ''
  }`;

  const wrapperClass =
    variant === 'main'
      ? 'relative min-h-[50vh] pb-32 flex justify-center bg-slate-100 dark:bg-slate-900 pt-8'
      : 'relative w-full bg-slate-50 dark:bg-slate-950';

  return (
    <div className={wrapperClass} onPointerUp={handleWrapperPointerUp}>
      {canCapture && isCaptureMode && (
        <div
          className="fixed inset-0 z-[9999] cursor-crosshair capture-overlay-ui"
          onMouseDown={handleCaptureStart}
          onMouseMove={handleCaptureMove}
          onMouseUp={handleCaptureEnd}
        >
          {!captureStart && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg pointer-events-none">
              Drag to capture (Esc to cancel)
            </div>
          )}
        </div>
      )}
      {canCapture && isCaptureMode && captureStart && captureCurrent && (
        <div style={captureBoxStyle} className="capture-overlay-ui"></div>
      )}

      <div className={containerClass}>
        <div
          ref={contentRef}
          className={proseClass}
          dangerouslySetInnerHTML={{__html: renderedContent}}
          onContextMenu={e => e.preventDefault()}
        />
        <canvas
          ref={canvasRef}
          className={canvasClass}
          style={canvasStyle}
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
        />
      </div>

      {selection.show && !isCaptureMode && (
        <div
          id={`selection-menu-${variant}`}
          className="fixed z-50 flex items-center gap-2 bg-slate-800 text-white rounded-lg shadow-xl p-2 animate-fade-in"
          style={{top: selection.top, left: selection.left}}
        >
          <button
            onClick={handleHighlight}
            className="flex items-center gap-1 px-2 py-1 hover:bg-slate-700 rounded text-xs font-medium"
          >
            <Highlighter size={14} className="text-yellow-400" /> High
          </button>
          <div className="w-px h-4 bg-slate-600"></div>
          <button
            onClick={handleMemoClick}
            className="flex items-center gap-1 px-2 py-1 hover:bg-slate-700 rounded text-xs font-medium"
          >
            <StickyNote size={14} className="text-green-400" /> Memo
          </button>
          <div className="w-px h-4 bg-slate-600"></div>
          <button
            onClick={handleAiExplain}
            className="flex items-center gap-1 px-2 py-1 hover:bg-slate-700 rounded text-xs font-medium"
          >
            <MessageCircleQuestion size={14} className="text-blue-400" /> AI
          </button>
        </div>
      )}

      {memoInput.show && (
        <div
          id={`memo-dialog-${variant}`}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm"
        >
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-4 w-80 animate-slide-up border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">
              Add Note
            </h3>
            <textarea
              autoFocus
              value={memoInput.text}
              onChange={e =>
                setMemoInput(prev => ({...prev, text: e.target.value}))
              }
              className="w-full h-24 p-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none dark:text-white"
              placeholder="Type your thoughts..."
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setMemoInput({show: false, text: ''})}
                className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitMemo}
                className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
