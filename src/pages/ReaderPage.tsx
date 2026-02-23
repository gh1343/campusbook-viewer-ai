import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Header } from "../components/layout/Header";
import { ContentRenderer, ControlBar, PdfViewer } from "../features/viewer";
import { TocPanel, ToolsPanel } from "../components/interaction/SideDrawers";
import { useBook } from "../contexts/BookContext";
import { usePdfViewer } from "../contexts/PdfViewerContext";
import { getRmsConfig, fetchPdfUrl } from "../services/rmsService";
import "../css/split_container.css";

export const ReaderPage: React.FC = () => {
  // Desktop default: Open (Split view)
  // Mobile default: Closed (Overlay)
  const [isTocOpen, setTocOpen] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);
  const { registerPdfNavigator, setCurrentPdfPage, setPdfTotalPages } =
    usePdfViewer();
  const { isToolsOpen, setToolsOpen } = useBook();
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const pdfGoToPageRef = useRef<(page: number) => void>();
  const hasOpenSidebar = isTocOpen || isToolsOpen;
  const { viewMode } = usePdfViewer();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isPdfMobileLike = useMemo(() => {
    if (typeof window === "undefined") return false;
    const touchUA = /Mobi|Android|iP(hone|od|ad)/i.test(ua);
    return touchUA || window.innerWidth <= 1300;
  }, [ua]);

  // viewMode에 따라 1쪽 보기/2쪽 보기 결정 (패널 상태와 무관)
  const forceSinglePage = viewMode === "single";
  const pdfPageStep = 1; // v3 한쪽보기 고정

  // Stable handlers to avoid rerunning PdfViewer effect
  const handlePdfPageChange = useCallback(
    (page: number) => {
      setPdfCurrentPage(page);
      setCurrentPdfPage(page);
    },
    [setCurrentPdfPage]
  );

  const handlePdfPagesCount = useCallback((count: number) => {
    setPdfPageCount(count);
    setPdfTotalPages(count);
  }, []);

  const handleRegisterGoToPage = useCallback(
    (fn: (page: number) => void) => {
      pdfGoToPageRef.current = fn;
      registerPdfNavigator(fn);
    },
    [registerPdfNavigator]
  );

  // Resizable Panel State
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(350);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const didApplyInitialLayoutRef = useRef(false);

  // Handle responsive defaults and exclusive sidebars
  useEffect(() => {
    const applyLayout = () => {
      const narrow = window.innerWidth <= 1300;
      setIsNarrow(narrow);
      if (didApplyInitialLayoutRef.current) return;
      didApplyInitialLayoutRef.current = true;
      if (narrow) {
        // Small/medium screens: only right panel open by default
        setTocOpen(false);
        setToolsOpen(true);
      } else {
        // Large screens: original behavior (both open)
        setTocOpen(true);
        setToolsOpen(true);
      }
    };

    applyLayout();
    window.addEventListener("resize", applyLayout);
    return () => window.removeEventListener("resize", applyLayout);
  }, [setToolsOpen]);

  // Enforce only one sidebar open at a time on narrow screens (tools has priority when opened elsewhere)
  useEffect(() => {
    if (!isNarrow) return;
    if (isToolsOpen) {
      setTocOpen(false);
    }
  }, [isToolsOpen, isNarrow]);

  // Prevent pinch-to-zoom and pull-to-refresh on side panels (tablet/mobile)
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panels = [leftPanelRef.current, rightPanelRef.current].filter(
      Boolean
    ) as HTMLDivElement[];
    if (panels.length === 0) return;

    const preventZoom = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const preventTouchZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    // Prevent pull-to-refresh in side panels
    let touchStartY = 0;
    const preventPullToRefresh = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };

    const preventPullMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      const touchY = e.touches[0].clientY;
      const deltaY = touchY - touchStartY;

      // Find the nearest scrollable ancestor
      let scrollable: HTMLElement | null = target;
      while (scrollable && scrollable !== document.body) {
        const overflowY = window.getComputedStyle(scrollable).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
          break;
        }
        scrollable = scrollable.parentElement;
      }

      // If trying to pull down (deltaY > 0)
      if (deltaY > 0) {
        // If there's no scrollable element, or if scrollable is at top, prevent pull-to-refresh
        if (
          !scrollable ||
          scrollable === document.body ||
          scrollable.scrollTop === 0
        ) {
          e.preventDefault();
        }
      }
    };

    panels.forEach((panel) => {
      panel.addEventListener("wheel", preventZoom, { passive: false });
      panel.addEventListener("touchstart", preventTouchZoom, {
        passive: false,
      });
      panel.addEventListener("touchmove", preventTouchZoom, { passive: false });
      panel.addEventListener("touchstart", preventPullToRefresh, {
        passive: true,
      });
      panel.addEventListener("touchmove", preventPullMove, { passive: false });
    });

    return () => {
      panels.forEach((panel) => {
        panel.removeEventListener("wheel", preventZoom);
        panel.removeEventListener("touchstart", preventTouchZoom);
        panel.removeEventListener("touchmove", preventTouchZoom);
        panel.removeEventListener("touchstart", preventPullToRefresh);
        panel.removeEventListener("touchmove", preventPullMove);
      });
    };
  }, []);

  // Drag Logic for Resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      // Prevent text selection while dragging
      if (isDraggingLeft || isDraggingRight) {
        e.preventDefault();
      }

      const containerRect = containerRef.current.getBoundingClientRect();

      if (isDraggingLeft) {
        const newWidth = e.clientX - containerRect.left;
        // Min 200px, Max 500px
        if (newWidth > 200 && newWidth < 500) {
          setLeftWidth(newWidth);
        }
      }

      if (isDraggingRight) {
        const newWidth = containerRect.right - e.clientX;
        // Min 280px, Max 600px
        if (newWidth > 280 && newWidth < 600) {
          setRightWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };

    if (isDraggingLeft || isDraggingRight) {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };
  }, [isDraggingLeft, isDraggingRight]);

  const toggleToc = () => {
    if (isNarrow) {
      const next = !isTocOpen;
      setTocOpen(next);
      if (next) {
        setToolsOpen(false);
      }
      return;
    }
    setTocOpen(!isTocOpen);
  };
  // PDF URL을 API 호출로 가져오기
  const [pdfUrl, setPdfUrlState] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const loadPdfUrl = async () => {
      const config = getRmsConfig();
      if (!config) {
        return;
      }

      try {
        const url = await fetchPdfUrl({
          apiBase: config.apiBase,
          bookCd: config.bookCd,
        });
        if (!cancelled) {
          setPdfUrlState(url);
        }
      } catch (err) {
        console.error("[ReaderPage] Failed to fetch PDF URL:", err);
      }
    };

    loadPdfUrl();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="layout_container">
      <Header toggleSidebar={toggleToc} isSidebarOpen={isTocOpen} />

      {/* Main Split Layout Container */}
      <div ref={containerRef} className="split_container">
        {/* 왼쪽 사이드바 */}
        <aside
          ref={leftPanelRef}
          className={`left_side_wrap ${!isTocOpen ? "off" : "on"}`}
          style={{
            width: isTocOpen
              ? window.innerWidth < 480
                ? "0px"
                : `${leftWidth}px`
              : "0px",
          }}
        >
          {/* Render Panel Content */}
          <TocPanel isOpen={isTocOpen} onClose={() => setTocOpen(false)} />
        </aside>

        {/* Center Panel: Reader & Controls */}
        <main className="content_container">
          <div className="cc_top">
            {pdfUrl ? (
              <PdfViewer
                file={pdfUrl}
                onPageChange={handlePdfPageChange}
                onPagesCount={handlePdfPagesCount}
                registerGoToPage={handleRegisterGoToPage}
                forceSinglePage={forceSinglePage}
              />
            ) : (
              <div className="pdf_loading">PDF 로딩 중...</div>
            )}
          </div>

          <div className="cc_bottom">
            <ControlBar
              pdfPageCount={pdfPageCount}
              pdfCurrentPage={pdfCurrentPage}
              onPdfGoToPage={(page) => pdfGoToPageRef.current?.(page)}
              pdfPageStep={pdfPageStep}
            />
          </div>
        </main>

        {/* Right Panel Area */}
        <aside
          ref={rightPanelRef}
          className={`right_panel_wrap ${!isToolsOpen ? "off" : "on"}`}
          style={{
            width: isToolsOpen
              ? window.innerWidth < 480
                ? "0px"
                : `${rightWidth}px`
              : "0px",
          }}
        >
          {/* Render Panel Content */}
          <ToolsPanel
            isOpen={isToolsOpen}
            onClose={() => setToolsOpen(false)}
          />
        </aside>
      </div>
    </div>
  );
};
