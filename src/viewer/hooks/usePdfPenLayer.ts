import { useEffect } from "react";
import { PageCanvasEntry } from "../../components/viewer/pdfUtils";

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
