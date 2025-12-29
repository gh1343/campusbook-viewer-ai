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
