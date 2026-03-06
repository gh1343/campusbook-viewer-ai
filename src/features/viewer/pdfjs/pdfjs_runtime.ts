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

type MutableRef<T> = { current: T };
type Setter<T> = Dispatch<SetStateAction<T>>;

// CMap/폰트/WASM 모두 CDN 사용 (서버 정적 파일 미제공 환경 대응)
const CDN_BASE = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/`;
const CMAP_URL = `${CDN_BASE}cmaps/`;
const STANDARD_FONT_DATA_URL = `${CDN_BASE}standard_fonts/`;
const WASM_URL = `${CDN_BASE}wasm/`;

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
  setPdfLoadTime?: (time: number) => void;
  setPdfIsLoading?: (isLoading: boolean) => void;
  setPdfLoadProgress?: (progress: number) => void;
  previewMaxPage?: number;
  onPreviewLimitReached?: () => void;
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
    setPdfLoadTime,
    setPdfIsLoading,
    setPdfLoadProgress,
    previewMaxPage,
    onPreviewLimitReached,
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

  const INTERNAL_SCALE = 1; // 화면 표시 배율과 동일하게 맞춰 선명도 확보
  let firstPageRendered = false;
  const loadStartTime = Date.now();
  let updateTimeInterval: number | null = null;
  const renderedPages = new Set<number>();
  let totalPages = 0;
  let allPagesRendered = false;

  const updateLoadingTime = () => {
    const elapsed = (Date.now() - loadStartTime) / 1000;
    setPdfLoadTime?.(elapsed);
  };

  // Start updating time every 500ms (메모리 최적화: 100ms → 500ms, setState 빈도 감소)
  updateTimeInterval = window.setInterval(updateLoadingTime, 500);

  const handlePageRendered = (evt?: { pageNumber?: number }) => {
    scheduleRenderRefresh();
    if (!firstPageRendered && evt?.pageNumber) {
      firstPageRendered = true;
      setLoading(false);
    }

    // Track all rendered pages
    if (evt?.pageNumber && !allPagesRendered) {
      renderedPages.add(evt.pageNumber);

      // Update progress based on rendered pages
      if (totalPages > 0) {
        const renderProgress = Math.round(
          (renderedPages.size / totalPages) * 100
        );
        setPdfLoadProgress?.(renderProgress);
        setLoadProgress(renderProgress);
      }

      // Check if all pages are rendered
      if (totalPages > 0 && renderedPages.size >= totalPages) {
        allPagesRendered = true;
        if (updateTimeInterval !== null) {
          clearInterval(updateTimeInterval);
          updateTimeInterval = null;
        }
        setPdfLoadProgress?.(100);
        setLoadProgress(100);
        updateLoadingTime(); // Final update
        setPdfIsLoading?.(false);
      }
    }

  };

  eventBus.on("pagesinit", () => {
    pdfViewer.currentScale = INTERNAL_SCALE;
    scheduleRenderRefresh();
  });

  eventBus.on("pagechanging", (evt: any) => {
    if (evt?.pageNumber) {
      if (previewMaxPage && evt.pageNumber > previewMaxPage) {
        attemptPageNavigation(previewMaxPage);
        return;
      }
      onPageChange?.(evt.pageNumber);
    }
  });

  eventBus.on("pagesloaded", (evt: any) => {
    if (evt?.pagesCount) {
      totalPages = evt.pagesCount;
      onPagesCount?.(evt.pagesCount);
    }
    handlePageRendered();

    // PDF가 완전히 로드되면 pending 페이지 네비게이션 실행
    if (pendingPageNavigation !== null) {
      const pageToNavigate = pendingPageNavigation;
      pendingPageNavigation = null;
      // 약간의 지연을 두고 실행하여 페이지 렌더링 완료 보장
      setTimeout(() => {
        attemptPageNavigation(pageToNavigate);
      }, 100);
    }

    // Note: Loading will complete when text extraction finishes
  });

  eventBus.on("pagerendered", handlePageRendered);
  eventBus.on("pagedestroy", (evt: any) => {
    if (evt?.pageNumber) {
      disposePageEntry(evt.pageNumber);
    }
  });

  let pendingPageNavigation: number | null = null;

  const attemptPageNavigation = (page: number) => {
    if (
      !pdfViewerRef.current ||
      !pdfViewerRef.current.pdfDocument ||
      !pdfViewerRef.current.pagesCount
    ) {
      pendingPageNavigation = page;
      return false;
    }
    const maxPage = pdfViewerRef.current.pdfDocument.numPages;
    const effectiveMax = previewMaxPage
      ? Math.min(previewMaxPage, maxPage)
      : maxPage;
    const target = Math.min(Math.max(page, 1), effectiveMax);
    pdfViewerRef.current.currentPageNumber = target;

    // 페이지가 렌더링될 때까지 재시도하는 함수
    // iPad Safari는 캐시 없는 초기 로드 시 레이아웃 확정이 느려 재시도 횟수를 넉넉히 확보
    const scrollToPageWithRetry = (retryCount = 0, maxRetries = 30) => {
      const pageEl = viewer.querySelector<HTMLElement>(
        `.page[data-page-number="${target}"]`
      );

      if (!pageEl && retryCount < maxRetries) {
        // 페이지가 아직 렌더링되지 않았으면 다시 시도
        setTimeout(() => scrollToPageWithRetry(retryCount + 1, maxRetries), 50);
        return;
      }

      const doScroll = () => {
        if (pageEl && viewerContainer) {
          const containerRect = viewerContainer.getBoundingClientRect();
          const pageRect = pageEl.getBoundingClientRect();

          // 페이지 상단을 컨테이너 상단에 맞추도록 스크롤 (애니메이션 없이 즉시 이동)
          const scrollTop =
            pageRect.top - containerRect.top + viewerContainer.scrollTop;
          const scrollLeft =
            pageRect.left - containerRect.left + viewerContainer.scrollLeft;

          viewerContainer.scrollTo({
            top: Math.max(0, scrollTop),
            left: Math.max(0, scrollLeft),
            behavior: "auto",
          });
        } else {
          // 최대 재시도 후에도 페이지를 찾지 못하면 기본 방식 사용
          pdfViewerRef.current?.scrollPageIntoView({ pageNumber: target });
        }
      };

      // Safari에서 레이아웃 확정 후 스크롤되도록 double rAF 사용
      requestAnimationFrame(() => {
        requestAnimationFrame(doScroll);
      });
    };

    requestAnimationFrame(() => scrollToPageWithRetry());
    return true;
  };

  registerGoToPage?.((page: number) => {
    // 미리보기 최대 페이지 초과 시도 → 오버레이 트리거
    if (previewMaxPage && page > previewMaxPage) {
      onPreviewLimitReached?.();
    }
    attemptPageNavigation(page);
  });

  // 프리뷰 모드: previewMaxPage 이후로 스크롤 불가
  let scrollLimitHandler: (() => void) | null = null;
  if (previewMaxPage) {
    let previewScrollLimitTriggered = false;
    scrollLimitHandler = () => {
      const lastPageEl = viewer.querySelector<HTMLElement>(
        `.page[data-page-number="${previewMaxPage}"]`
      );
      if (!lastPageEl) return;
      const maxScrollTop = Math.max(
        0,
        lastPageEl.offsetTop +
          lastPageEl.offsetHeight -
          viewerContainer.clientHeight
      );
      if (viewerContainer.scrollTop > maxScrollTop) {
        viewerContainer.scrollTop = maxScrollTop;
        // 연속 스크롤 이벤트 중 한 번만 트리거 (debounce)
        if (!previewScrollLimitTriggered) {
          previewScrollLimitTriggered = true;
          onPreviewLimitReached?.();
          setTimeout(() => {
            previewScrollLimitTriggered = false;
          }, 1500);
        }
      }
    };
    viewerContainer.addEventListener("scroll", scrollLimitHandler);
  }

  linkService.setViewer(pdfViewer);

  setPdfIsLoading?.(true);
  let cancelled = false;
  let loadingTask = getDocument({
    url: file,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,

    // Network optimization options
    httpHeaders: {},
    withCredentials: false,

    // JPEG2000 (JPX) 디코더 WASM 경로 - 없으면 이미지가 빈 칸으로 렌더링됨
    wasmUrl: WASM_URL,

    // Range Request optimization
    rangeChunkSize: 65536, // 64KB (default), increase for slower networks
    disableAutoFetch: false, // Keep auto-fetching enabled
    disableStream: false, // Keep streaming enabled for faster initial rendering
  });
  loadingTask.onProgress = ({ loaded = 0, total = 0 }) => {
    if (cancelled) return;
    if (!total) {
      const newProgress = Math.min(
        85,
        Math.max(1, (loaded / 1024 / 1024) * 10)
      ); // estimate based on MB, max 85%
      setLoadProgress((prev) => Math.min(85, Math.max(1, prev + 1)));
      setPdfLoadProgress?.(Math.round(newProgress));
      return;
    }
    // Map download progress to 0-90%
    const downloadPercent = Math.round((loaded / total) * 100);
    const mappedPercent = Math.min(
      90,
      Math.max(1, Math.round(downloadPercent * 0.9))
    );
    setLoadProgress(mappedPercent);
    setPdfLoadProgress?.(mappedPercent);
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
      setErrorMsg(null);
      pdfViewer.setDocument(pdfDoc);
      linkService.setDocument(pdfDoc, null);
      onPagesCount?.(pdfDoc.numPages);

      extractPdfText(pdfDoc, {
        isMobileSafari,
        setPdfTextPages,
        isCancelled: () => cancelled,
        onProgress: (current, total) => {
          // Map text extraction progress to 90-100%
          const extractPercent = (current / total) * 100;
          const mappedPercent = 90 + Math.round(extractPercent * 0.1);
          setPdfLoadProgress?.(mappedPercent);
          setLoadProgress(mappedPercent);
        },
        onComplete: () => {
          // Text extraction completed - finalize loading
          if (!allPagesRendered) {
            allPagesRendered = true;
            if (updateTimeInterval !== null) {
              clearInterval(updateTimeInterval);
              updateTimeInterval = null;
            }
            setPdfLoadProgress?.(100);
            setLoadProgress(100);
            updateLoadingTime();
            setPdfIsLoading?.(false);
          }
        },
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
    if (updateTimeInterval !== null) {
      clearInterval(updateTimeInterval);
      updateTimeInterval = null;
    }
    if (scrollLimitHandler) {
      viewerContainer.removeEventListener("scroll", scrollLimitHandler);
      scrollLimitHandler = null;
    }
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
