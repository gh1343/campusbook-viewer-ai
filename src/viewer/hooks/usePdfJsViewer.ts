import { useEffect } from "react";
import { initPdfJsRuntime } from "../pdfjs/pdfjs_runtime";
import { PageCanvasEntry } from "../../components/viewer/pdfUtils";

type MutableRef<T> = { current: T };

interface UsePdfJsViewerParams {
  file: string;
  viewerContainerRef: MutableRef<HTMLDivElement | null>;
  viewerRef: MutableRef<HTMLDivElement | null>;
  pdfViewerRef: MutableRef<any>;
  pageCanvasMapRef: MutableRef<Map<number, PageCanvasEntry>>;
  currentPageRef: MutableRef<number | null>;
  rafRefreshId: MutableRef<number | null>;
  MAX_CANVAS_PIXELS: number | undefined;
  isMobileLike: boolean;
  isMobileSafari: boolean;
  onPageChange?: (page: number) => void;
  onPagesCount?: (count: number) => void;
  registerGoToPage?: (fn: (page: number) => void) => void;
  setPdfTextPages: (pages: { page: number; text: string }[]) => void;
  setLoading: (v: boolean) => void;
  setLoadProgress: (v: number) => void;
  setErrorMsg: (msg: string | null) => void;
  scheduleRenderRefresh: () => void;
  disposePageEntry: (pageNumber: number) => void;
}

export const usePdfJsViewer = ({
  file,
  viewerContainerRef,
  viewerRef,
  pdfViewerRef,
  pageCanvasMapRef,
  currentPageRef,
  rafRefreshId,
  MAX_CANVAS_PIXELS,
  isMobileLike,
  isMobileSafari,
  onPageChange,
  onPagesCount,
  registerGoToPage,
  setPdfTextPages,
  setLoading,
  setLoadProgress,
  setErrorMsg,
  scheduleRenderRefresh,
  disposePageEntry,
}: UsePdfJsViewerParams) => {
  useEffect(() => {
    if (!viewerContainerRef.current || !viewerRef.current) return;

    setPdfTextPages([]);
    onPagesCount?.(0);
    onPageChange?.(1);
    setLoading(true);
    setLoadProgress(1);
    setErrorMsg(null);

    const cleanup = initPdfJsRuntime({
      file,
      viewerContainer: viewerContainerRef.current,
      viewer: viewerRef.current,
      pdfViewerRef,
      pageCanvasMapRef,
      currentPageRef,
      rafRefreshId,
      MAX_CANVAS_PIXELS,
      isMobileLike,
      isMobileSafari,
      onPageChange,
      onPagesCount,
      registerGoToPage,
      setPdfTextPages,
      setLoading,
      setLoadProgress,
      setErrorMsg,
      scheduleRenderRefresh,
      disposePageEntry,
    });

    return cleanup;
  }, [
    file,
    onPageChange,
    onPagesCount,
    registerGoToPage,
    setPdfTextPages,
    isMobileSafari,
    isMobileLike,
  ]);
};
