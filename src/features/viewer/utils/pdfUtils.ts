import type React from "react";
// Shared types and helpers for PdfViewer

export type HighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
};

export type PdfHighlight = { id: string; rects: HighlightRect[] };

export type PageCanvasEntry = {
  layer: HTMLDivElement;
  staticCanvas: HTMLCanvasElement;
  liveCanvas: HTMLCanvasElement;
};

export const getCanvasMetrics = (
  pageEl: HTMLElement,
  getVisualScale: () => number
) => {
  const rect = pageEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
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
