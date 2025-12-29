import { HighlightRect } from "../../components/viewer/pdfUtils";

export const VISUAL_SCALE = 1;

export const pageWithinBuffer = (
  pageEl: HTMLElement,
  viewRect: DOMRect,
  buffer: number
) => {
  const r = pageEl.getBoundingClientRect();
  return r.bottom >= viewRect.top - buffer && r.top <= viewRect.bottom + buffer;
};

export const drawStrokePath = (
  ctx: CanvasRenderingContext2D,
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

export const mergeHighlightRects = (rects: HighlightRect[]) => {
  // 페이지별로만 합쳐서 사이드바 토글/리사이즈에도 상대 위치가 유지되도록 함
  const byPage = new Map<number, HighlightRect[]>();
  rects.forEach((r) => {
    const list = byPage.get(r.pageNumber) ?? [];
    list.push({ ...r });
    byPage.set(r.pageNumber, list);
  });

  const TOL = 1.5; // allow tiny overlap/adjacency without stacking opacity
  const mergedAll: HighlightRect[] = [];

  byPage.forEach((pageRects) => {
    const merged = pageRects;
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
              ...a,
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
    mergedAll.push(...merged);
  });

  return mergedAll;
};
