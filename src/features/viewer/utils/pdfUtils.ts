import type React from "react";
import type { PdfHighlightRect } from "../../../../types";
// Shared types and helpers for PdfViewer

export type HighlightRect = PdfHighlightRect;

export type PdfHighlight = { id: string; rects: HighlightRect[] };

export type PageCanvasEntry = {
  layer: HTMLDivElement;
  staticCanvas: HTMLCanvasElement;
  liveCanvas: HTMLCanvasElement;
};

const isTouchTablet =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|Android/i.test(navigator.userAgent) ||
    navigator.maxTouchPoints >= 2);

export const getCanvasMetrics = (
  pageEl: HTMLElement,
  getVisualScale: () => number
) => {
  const rect = pageEl.getBoundingClientRect();
  const rawDpr = window.devicePixelRatio || 1;
  // 터치 태블릿/폰은 dpr이 2~3x → 캔버스 메모리 최대 4~9배 증가
  // 펜 레이어 기준 2x로 캡핑하여 렌더 비용 절감 (PDF.js 캔버스는 별도 MAX_CANVAS_PIXELS로 제한)
  const dpr = isTouchTablet ? Math.min(rawDpr, 2) : rawDpr;
  const visualScale = getVisualScale();
  const width = rect.width / visualScale;
  const height = rect.height / visualScale;
  return { rect, dpr, visualScale, width, height };
};

export const getPageOffsetInfo = (
  containerEl: HTMLElement,
  pageEl: HTMLElement,
  pageWidth: number,
  pageHeight: number
) => {
  const containerRect = containerEl.getBoundingClientRect();
  const pageRect = pageEl.getBoundingClientRect();
  const pageOffsetLeft =
    pageRect.left - containerRect.left + containerEl.scrollLeft;
  const pageOffsetTop =
    pageRect.top - containerRect.top + containerEl.scrollTop;
  const scaleX = pageWidth > 0 ? pageRect.width / pageWidth : 1;
  const scaleY = pageHeight > 0 ? pageRect.height / pageHeight : 1;
  return { pageOffsetLeft, pageOffsetTop, scaleX, scaleY };
};

export const getPagePoint = (
  e: React.PointerEvent,
  pageEl: HTMLElement,
  getVisualScale: () => number
): { x: number; y: number } | null => {
  const rect = pageEl.getBoundingClientRect();
  const visualScale = getVisualScale();
  const x = (e.clientX - rect.left) / visualScale;
  const y = (e.clientY - rect.top) / visualScale;
  return { x, y };
};
