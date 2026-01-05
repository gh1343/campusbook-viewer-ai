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
    const fallbackPdfUrl =
      "https://e-alice-campusbook.s3.ap-northeast-2.amazonaws.com/resources/contents/prod/cms/book/20240923/CT-20240923150969799/source/CT-20240923150969799_source_1727071793874.pdf?response-content-disposition=inline&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEHQaDmFwLW5vcnRoZWFzdC0yIkYwRAIgFxkH93uXt8x8KO%2BQr%2B4oRVCCnJxc5U%2FS7icgsJjji4oCIF8KT4bTt1G9l95NU42zB%2FjnT240s1P1IXYR3JbCkkiEKtoDCD0QARoMMjc5ODAyNzM5MjYxIgzNatBDYp6dNFLCuRkqtwOyBGi5HaQ6HQGr4LSOQ%2FrseM3Ht9nudFx%2F3XYDLjJ8n84Ol3sMJPWWpVbLFxdlPlO4jRo03%2Bu3%2BrFpIwf3nOBh9qdEfsSTm8rLFh2O7vpBtlEN9hI4btncMKrCgrZYyfuhWAiiUyszUYs%2FCob47Zmr9FukWYXeePhAf5WMXefCNLfT%2BwNxlrjWdXrHkwRqu52LdDO4qHKzBaR13uYnaB2M6JolYX2j5aRg1wS%2B2AzoIDU6axC2XfS3RtVYigcSn7NtjoyRVDZGKQ6PKEuc6L2QWPzOAS3wczV0PreyOOdoyeoORd6qe1v0bxe61TA36jQC4kZgiC57uJcN4P%2FI0g7%2BiAfAF6ieVBzJvIYR33jgHo8P7KJce4OaU3%2FnxtJhK1Zj080sqqL4yNjiN2VWuBK1p%2B%2B68W1EBISH6vm0Fa3qo5eCTJsXGeHszcw7iycmdXenzEe6uSUpeiX62lf%2FGnVHAFg4nnlHU3JUd55m%2F8DRxJ9F6NT26TyCg5Xgvc4M4Ts8xptC8F%2BkBsr%2FQuQSBURdONTNQ%2B5wGS1WtrXP5ghQ4TPRDHcNU%2BtbrJ8FYlxO4Rnx14EMsqs%2FMKaF7MoGOt8C4rWttpCprOHXWWydA7gPQ6JIeolN0KPBEoTRjRfW4Vqi%2BPzmtEz0wXwkXZgTG7%2FhOkihrqg8tzKbRE9OmPuVanJGWZjn4LOzrLJUNn5ZvW1H9bizH8IoYr420f46fpl0JWB9Mec7SLnvfrSPgeob1DmoP4mYjexSJY0MzRSuOJDs5SPAVKdZuspclpJkZrztcbZ7KeEM1R6t4vbbnaErDZeQ76AXkg0UyNqrOyuLr3Ujz9z%2BrSYhYvUDKpEEqQ3MFHQAUS9d0gGBFXFxozWExUyW5wilkiHfkAxCfOSMZ4XzAe7kEblrhvF7vYOdkjN7TcMXaUKkqELjxagKWAtDcF%2FhikYzIiLd9%2BMWLafIXnfGEz6GuJ0wh4v8qbDMuRc1PzfS7W0Z6snGN9j62NLmE7s3Sekm9PonLIVbLIEHTfRAdB3XJ%2F248YesZOAqBWESBA1g98PvdmKZ67v7rhLb&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIAUCJMK7I63UBPEJW2%2F20260105%2Fap-northeast-2%2Fs3%2Faws4_request&X-Amz-Date=20260105T040839Z&X-Amz-Expires=21600&X-Amz-SignedHeaders=host&X-Amz-Signature=f8c5b8ea2a5f7813e730cf3106cffafbd55c16cc327feaab3fed0940ecf9bfae";
    const raw = fallbackPdfUrl;
    const base = import.meta.env.BASE_URL || "/";

    // 절대 URL이면 그대로 사용
    if (fallbackPdfUrl && /^https?:\/\//i.test(fallbackPdfUrl)) {
      return fallbackPdfUrl;
    }

    // 상대/루트 경로면 base에 붙여서 GitHub Pages에서도 동작하도록 정규화
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    const normalizedPath = raw && raw.replace(/^\/+/, "");

    const pagesUrl = `${normalizedBase}${normalizedPath}`;

    if (typeof window !== "undefined") {
      const host = window.location.hostname || "";
      const isGithubPages = host.toLowerCase().endsWith("github.io");
      const owner = isGithubPages ? host.split(".")[0] : "";
      const repo = normalizedBase.replace(/^\/+|\/+$/g, "");
      if (isGithubPages && owner && repo) {
        const branch = import.meta.env.VITE_GITHUB_BRANCH || "main";
        const repoPath = normalizedPath.startsWith("public/")
          ? normalizedPath
          : `public/${normalizedPath}`;
        return `https://media.githubusercontent.com/media/${owner}/${repo}/${branch}/${repoPath}`;
      }
    }

    return pagesUrl;
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
