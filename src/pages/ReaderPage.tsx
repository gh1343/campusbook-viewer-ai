import React, { useState, useEffect, useRef, useCallback } from "react";
import { Header } from "../components/layout/Header";
import { ContentRenderer, ControlBar, PdfViewer } from "../features/viewer";
import { TocPanel, ToolsPanel } from "../components/interaction/SideDrawers";
import { useBook } from "../contexts/BookContext";
import "../css/split_container.css";

export const ReaderPage: React.FC = () => {
  // Desktop default: Open (Split view)
  // Mobile default: Closed (Overlay)
  const [isTocOpen, setTocOpen] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);
  const { isToolsOpen, setToolsOpen, registerPdfNavigator, setCurrentPdfPage } =
    useBook();
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const pdfGoToPageRef = useRef<(page: number) => void>();
  const hasOpenSidebar = isTocOpen || isToolsOpen;

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

  // Handle responsive defaults and exclusive sidebars
  useEffect(() => {
    const applyLayout = () => {
      const narrow = window.innerWidth <= 1300;
      setIsNarrow(narrow);
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
  const pdfUrl = (() => {
    if (import.meta.env.DEV) {
      return "/api/pdf/test4.pdf"; // local dev: proxy를 통해 GitHub에서 가져옴
    }
    const raw = import.meta.env.VITE_PDF_URL;
    const base = import.meta.env.BASE_URL || "/";

    // 절대 URL이면 그대로 사용
    if (raw && /^https?:\/\//i.test(raw)) {
      return raw;
    }

    // 상대/루트 경로면 base에 붙여서 GitHub Pages에서도 동작하도록 정규화
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    const normalizedPath = (raw && raw.replace(/^\/+/, "")) || "pdf/test4.pdf";

    return `${normalizedBase}${normalizedPath}`;
  })();

  return (
    <div className="layout_container">
      <Header toggleSidebar={toggleToc} isSidebarOpen={isTocOpen} />

      {/* Main Split Layout Container */}
      <div ref={containerRef} className="split_container">
        {/* 왼쪽 사이드바 */}
        <aside
          className={`left_side_wrap ${!isTocOpen ? "off" : "on"}`}
          style={{
            width: isTocOpen
              ? window.innerWidth < 768
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
            {/* TODO: 나중에 조건부 렌더링으로 바꿀 수 있음 */}
            <PdfViewer
              file={pdfUrl}
              onPageChange={handlePdfPageChange}
              onPagesCount={handlePdfPagesCount}
              registerGoToPage={handleRegisterGoToPage}
              forceSinglePage={hasOpenSidebar}
            />
          </div>

          <div className="cc_bottom">
            <ControlBar
              pdfPageCount={pdfPageCount}
              pdfCurrentPage={pdfCurrentPage}
              onPdfGoToPage={(page) => pdfGoToPageRef.current?.(page)}
            />
          </div>
        </main>

        {/* Right Panel Area */}
        <aside
          className={`right_panel_wrap ${!isToolsOpen ? "off" : "on"}`}
          style={{
            width: isToolsOpen
              ? window.innerWidth < 768
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
