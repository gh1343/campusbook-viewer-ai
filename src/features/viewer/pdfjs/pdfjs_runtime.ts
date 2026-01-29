import { getDocument, version as pdfjsVersion } from "pdfjs-dist";
import { Dispatch, SetStateAction } from "react";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
  SpreadMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { PageCanvasEntry } from "../utils/pdfUtils";
import { extractPdfText } from "./pdf_text_extract";
import { adjustTextLayerSpacingAsync } from "../utils/textLayerAdjust";

type MutableRef<T> = { current: T };
type Setter<T> = Dispatch<SetStateAction<T>>;

const PDFJS_ASSET_BASE = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}`;
const CMAP_URL = `${PDFJS_ASSET_BASE}/cmaps/`;
const STANDARD_FONT_DATA_URL = `${PDFJS_ASSET_BASE}/standard_fonts/`;

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
  let firstPageRendered = false;
  const handlePageRendered = (evt?: { pageNumber?: number }) => {
    scheduleRenderRefresh();
    if (!firstPageRendered && evt?.pageNumber) {
      firstPageRendered = true;
      setLoading(false);
    }

    // 텍스트 레이어 줄 간격 자동 조정 (태블릿 드래그 선택 개선)
    if (evt?.pageNumber) {
      const pageEl = viewer.querySelector<HTMLElement>(
        `.page[data-page-number="${evt.pageNumber}"]`
      );
      if (pageEl) {
        adjustTextLayerSpacingAsync(pageEl).catch((err) => {
          console.warn("[textLayerAdjust] failed for page", evt.pageNumber, err);
        });
      }
    }
  };

  eventBus.on("pagesinit", () => {
    pdfViewer.currentScale = INTERNAL_SCALE;
    pdfViewer.spreadMode = spreadViewPreferred
      ? SpreadMode.ODD
      : SpreadMode.NONE; // 데스크톱에서는 좌우 2페이지씩 배치
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

    // PDF가 완전히 로드되면 pending 페이지 네비게이션 실행
    if (pendingPageNavigation !== null) {
      console.log(`[pdfjs_runtime/pagesloaded] Executing pending navigation to page ${pendingPageNavigation}`);
      const pageToNavigate = pendingPageNavigation;
      pendingPageNavigation = null;
      // 약간의 지연을 두고 실행하여 페이지 렌더링 완료 보장
      setTimeout(() => {
        attemptPageNavigation(pageToNavigate);
      }, 100);
    }
  });

  eventBus.on("pagerendered", handlePageRendered);
  eventBus.on("pagedestroy", (evt: any) => {
    if (evt?.pageNumber) {
      disposePageEntry(evt.pageNumber);
    }
  });

  let pendingPageNavigation: number | null = null;

  const attemptPageNavigation = (page: number) => {
    console.log(`[pdfjs_runtime/attemptPageNavigation] Attempting to navigate to page: ${page}`);
    if (
      !pdfViewerRef.current ||
      !pdfViewerRef.current.pdfDocument ||
      !pdfViewerRef.current.pagesCount
    ) {
      console.log(`[pdfjs_runtime/attemptPageNavigation] PDF not ready - viewer: ${!!pdfViewerRef.current}, document: ${!!pdfViewerRef.current?.pdfDocument}, pagesCount: ${pdfViewerRef.current?.pagesCount}`);
      console.log(`[pdfjs_runtime/attemptPageNavigation] Storing pending navigation to page ${page}`);
      pendingPageNavigation = page;
      return false;
    }
    const maxPage = pdfViewerRef.current.pdfDocument.numPages;
    const target = Math.min(Math.max(page, 1), maxPage);
    console.log(`[pdfjs_runtime/attemptPageNavigation] Target page: ${target} (max: ${maxPage})`);
    pdfViewerRef.current.currentPageNumber = target;
    console.log(`[pdfjs_runtime/attemptPageNavigation] Set currentPageNumber to ${target}`);

    // scrollPageIntoView는 확대된 상태에서 제대로 작동하지 않을 수 있으므로
    // 직접 스크롤 위치를 계산하여 이동
    requestAnimationFrame(() => {
      const pageEl = viewer.querySelector<HTMLElement>(
        `.page[data-page-number="${target}"]`
      );
      console.log(`[pdfjs_runtime/attemptPageNavigation/raf] pageEl found: ${!!pageEl}`);
      if (pageEl && viewerContainer) {
        const containerRect = viewerContainer.getBoundingClientRect();
        const pageRect = pageEl.getBoundingClientRect();

        // 페이지 상단을 컨테이너 상단에 맞추도록 스크롤
        const scrollTop = pageRect.top - containerRect.top + viewerContainer.scrollTop;
        const scrollLeft = pageRect.left - containerRect.left + viewerContainer.scrollLeft;

        console.log(`[pdfjs_runtime/attemptPageNavigation/raf] Scrolling to top: ${scrollTop}, left: ${scrollLeft}`);
        viewerContainer.scrollTo({
          top: Math.max(0, scrollTop),
          left: Math.max(0, scrollLeft),
          behavior: 'smooth'
        });
      } else {
        // 페이지 요소가 아직 렌더링되지 않았으면 기본 방식 사용
        console.log(`[pdfjs_runtime/attemptPageNavigation/raf] Using fallback scrollPageIntoView`);
        pdfViewerRef.current?.scrollPageIntoView({ pageNumber: target });
      }
    });
    return true;
  };

  registerGoToPage?.((page: number) => {
    console.log(`[pdfjs_runtime/goToPage] Requested page: ${page}`);
    attemptPageNavigation(page);
  });

  linkService.setViewer(pdfViewer);

  let cancelled = false;
  let loadingTask = getDocument({
    url: file,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,

    // Network optimization options
    httpHeaders: {},
    withCredentials: false,

    // Range Request optimization
    rangeChunkSize: 65536,  // 64KB (default), increase for slower networks
    disableAutoFetch: false, // Keep auto-fetching enabled
    disableStream: false,    // Keep streaming enabled for faster initial rendering
  });
  loadingTask.onProgress = ({ loaded = 0, total = 0 }) => {
    if (cancelled) return;
    if (!total) {
      setLoadProgress((prev) => Math.min(95, Math.max(1, prev + 1)));
      return;
    }
    const percent = Math.min(
      99,
      Math.max(1, Math.round((loaded / total) * 100))
    );
    setLoadProgress(percent);
  };
  // const loadingTimeout = window.setTimeout(
  //   () => {
  //     if (cancelled) return;
  //     console.warn("[PdfViewer] load timeout, cancelling task");
  //     setErrorMsg("PDF 로드가 지연되고 있습니다. 다시 시도해주세요.");
  //     setLoadProgress(0);
  //     setLoading(false);
  //     loadingTask?.destroy();
  //   },
  //   isMobileLike ? 20000 : 30000
  // );

  loadingTask.promise
    .then((pdfDoc) => {
      if (cancelled) return;
      // clearTimeout(loadingTimeout);
      setLoadProgress(100);
      setErrorMsg(null);
      pdfViewer.setDocument(pdfDoc);
      linkService.setDocument(pdfDoc, null);
      onPagesCount?.(pdfDoc.numPages);

      extractPdfText(pdfDoc, {
        isMobileSafari,
        setPdfTextPages,
        isCancelled: () => cancelled,
      });
    })
    .catch((err: any) => {
      if (cancelled) return;
      // clearTimeout(loadingTimeout);
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
    // clearTimeout(loadingTimeout);
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
