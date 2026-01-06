import { useEffect } from "react";
import { PageCanvasEntry } from "../utils/pdfUtils";

type MutableRef<T> = { current: T };

interface UsePdfPenLayerParams {
  penRuntime: {
    refreshCanvases: () => void;
    renderStaticCanvases: () => void;
    renderLiveCanvas: () => void;
  };
  viewerRef: MutableRef<HTMLElement | null>;
  viewerContainerRef: MutableRef<HTMLElement | null>;
  pageCanvasMapRef: MutableRef<Map<number, PageCanvasEntry>>;
  drawingMode: string;
  showAnnotations: boolean;
  chapterStrokes: any;
  penColor: string;
  penWidth: number;
  penOpacity: number;
  scheduleRenderRefresh: () => void;
  setLayoutTick: (updater: (t: number) => number) => void;
}

export const usePdfPenLayer = ({
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
}: UsePdfPenLayerParams) => {
  useEffect(() => {
    penRuntime.refreshCanvases();
  }, [penRuntime, drawingMode, showAnnotations]);

  useEffect(() => {
    penRuntime.renderStaticCanvases();
  }, [penRuntime, chapterStrokes]);

  useEffect(() => {
    penRuntime.renderLiveCanvas();
  }, [penRuntime, drawingMode, penColor, penWidth, penOpacity]);

  useEffect(() => {
    const SIZE_EPSILON = 2;
    let lastViewerWidth = 0;
    let lastViewerHeight = 0;
    let lastContainerWidth = 0;
    let lastContainerHeight = 0;

    const ro = new ResizeObserver((entries) => {
      let layoutChanged = false;
      let refreshOnly = false;

      entries.forEach((entry) => {
        const width = Math.round(entry.contentRect.width);
        const height = Math.round(entry.contentRect.height);
        if (entry.target === viewerRef.current) {
          const widthChanged =
            Math.abs(width - lastViewerWidth) >= SIZE_EPSILON;
          const heightChanged =
            Math.abs(height - lastViewerHeight) >= SIZE_EPSILON;

          if (widthChanged) layoutChanged = true;
          // Height shifts (new pages appended) shouldn't force layoutTick updates.
          if (heightChanged) refreshOnly = true;

          if (widthChanged || heightChanged) {
            lastViewerWidth = width;
            lastViewerHeight = height;
          }
          return;
        }

        if (entry.target === viewerContainerRef.current) {
          const widthChanged =
            Math.abs(width - lastContainerWidth) >= SIZE_EPSILON;
          const heightChanged =
            Math.abs(height - lastContainerHeight) >= SIZE_EPSILON;
          if (widthChanged) {
            layoutChanged = true;
          }
          if (heightChanged) {
            refreshOnly = true;
          }
          if (widthChanged || heightChanged) {
            lastContainerWidth = width;
            lastContainerHeight = height;
          }
        }
      });

      if (!layoutChanged && !refreshOnly) return;
      scheduleRenderRefresh();
      if (layoutChanged) {
        setLayoutTick((t) => t + 1);
      }
    });
    if (viewerRef.current) ro.observe(viewerRef.current);
    if (viewerContainerRef.current) ro.observe(viewerContainerRef.current);
    return () => {
      ro.disconnect();
    };
  }, [viewerRef, viewerContainerRef, scheduleRenderRefresh, setLayoutTick]);

  useEffect(() => {
    const el = viewerContainerRef.current;
    if (!el) return;
    const onScroll = () => scheduleRenderRefresh();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [viewerContainerRef, scheduleRenderRefresh]);

  useEffect(() => {
    return () => {
      pageCanvasMapRef.current.forEach((entry) => {
        entry.layer?.remove();
      });
      pageCanvasMapRef.current.clear();
    };
  }, [pageCanvasMapRef]);
};
