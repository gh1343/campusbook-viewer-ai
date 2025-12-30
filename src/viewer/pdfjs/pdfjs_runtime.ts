import { getDocument } from "pdfjs-dist";
import { Dispatch, SetStateAction } from "react";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
  SpreadMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { PageCanvasEntry } from "../../components/viewer/pdfUtils";
import { extractPdfText } from "./pdf_text_extract";

type MutableRef<T> = { current: T };
type Setter<T> = Dispatch<SetStateAction<T>>;

interface PdfJsRuntimeOptions {
  file: string;
  viewerContainer: HTMLDivElement;
  viewer: HTMLDivElement;
  pdfViewerRef: MutableRef<PDFViewer | null>;
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
  setLoading: Setter<boolean>;
  setLoadProgress: Setter<number>;
  setErrorMsg: Setter<string | null>;
  scheduleRenderRefresh: () => void;
  disposePageEntry: (pageNumber: number) => void;
  preferSpreadView?: boolean;
}

export const initPdfJsRuntime = (opts: PdfJsRuntimeOptions) => {
  const {
    file,
    viewerContainer,
    viewer,
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
    preferSpreadView,
  } = opts;

  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });

  const pdfViewerOptions: any = {
    container: viewerContainer,
    viewer,
    eventBus,
    linkService,
    textLayerMode: 2,
    annotationMode: 2,
    removePageBorders: true,
    enableScripting: false, // skip JS in PDFs
    disableAutoFetch: false,
    useOnlyCssZoom: false,
  };
  if (MAX_CANVAS_PIXELS !== undefined) {
    pdfViewerOptions.maxCanvasPixels = MAX_CANVAS_PIXELS;
  }
  const pdfViewer = new PDFViewer(pdfViewerOptions);
  pdfViewerRef.current = pdfViewer;
  const spreadViewPreferred = preferSpreadView ?? !isMobileLike;

  const INTERNAL_SCALE = 1; // 화면 표시 배율과 동일하게 맞춰 선명도 확보
  const handlePageRendered = () => {
    scheduleRenderRefresh();
  };

  eventBus.on("pagesinit", () => {
    pdfViewer.currentScale = INTERNAL_SCALE;
    pdfViewer.spreadMode = spreadViewPreferred ? SpreadMode.ODD : SpreadMode.NONE; // 데스크톱에서는 좌우 2페이지씩 배치
    scheduleRenderRefresh();
  });

  eventBus.on("pagechanging", (evt: any) => {
    if (evt?.pageNumber) {
      onPageChange?.(evt.pageNumber);
    }
  });

  eventBus.on("pagesloaded", (evt: any) => {
    if (evt?.pagesCount) {
      onPagesCount?.(evt.pagesCount);
    }
    handlePageRendered();
  });

  eventBus.on("pagerendered", handlePageRendered);
  eventBus.on("pagedestroy", (evt: any) => {
    if (evt?.pageNumber) {
      disposePageEntry(evt.pageNumber);
    }
  });

  registerGoToPage?.((page: number) => {
    if (
      !pdfViewerRef.current ||
      !pdfViewerRef.current.pdfDocument ||
      !pdfViewerRef.current.pagesCount
    )
      return;
    const maxPage = pdfViewerRef.current.pdfDocument.numPages;
    const target = Math.min(Math.max(page, 1), maxPage);
    pdfViewerRef.current.currentPageNumber = target;
    pdfViewerRef.current.scrollPageIntoView({ pageNumber: target });
  });

  linkService.setViewer(pdfViewer);

  let cancelled = false;
  let loadingTask = getDocument(file);
  loadingTask.onProgress = ({ loaded = 0, total = 0 }) => {
    if (cancelled) return;
    if (!total) {
      setLoadProgress((prev) => Math.min(95, Math.max(1, prev + 1)));
      return;
    }
    const percent = Math.min(99, Math.max(1, Math.round((loaded / total) * 100)));
    setLoadProgress(percent);
  };
  const loadingTimeout = window.setTimeout(
    () => {
      if (cancelled) return;
      console.warn("[PdfViewer] load timeout, cancelling task");
      setErrorMsg("PDF 로드가 지연되고 있습니다. 다시 시도해주세요.");
      setLoadProgress(0);
      setLoading(false);
      loadingTask?.destroy();
    },
    isMobileLike ? 20000 : 30000
  );

  loadingTask.promise
    .then((pdfDoc) => {
      if (cancelled) return;
      clearTimeout(loadingTimeout);
      setLoadProgress(100);
      setErrorMsg(null);
      pdfViewer.setDocument(pdfDoc);
      linkService.setDocument(pdfDoc, null);
      onPagesCount?.(pdfDoc.numPages);
      setLoading(false);

      extractPdfText(pdfDoc, {
        isMobileSafari,
        setPdfTextPages,
        isCancelled: () => cancelled,
      });
    })
    .catch((err: any) => {
      if (cancelled) return;
      clearTimeout(loadingTimeout);
      if (err?.message === "Worker was destroyed") {
        console.debug("[PdfViewer] worker destroyed (cleanup)");
        return;
      }
      console.error("[PdfViewer] load error:", err);
      setErrorMsg(err?.message || "PDF 로드 실패");
      setLoadProgress(0);
      setLoading(false);
    });

  return () => {
    cancelled = true;
    clearTimeout(loadingTimeout);
    loadingTask.destroy();
    pdfViewerRef.current = null;
    eventBus.off?.("pagerendered", handlePageRendered);
    pageCanvasMapRef.current.forEach(({ layer }) => layer.remove());
    pageCanvasMapRef.current.clear();
    currentPageRef.current = null;
    if (rafRefreshId.current !== null) {
      cancelAnimationFrame(rafRefreshId.current);
      rafRefreshId.current = null;
    }
  };
};
