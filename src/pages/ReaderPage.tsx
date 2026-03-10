import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import html2canvas from "html2canvas";
import { Header } from "../components/layout/Header";
import { ContentRenderer, ControlBar, PdfViewer } from "../features/viewer";
import { TocPanel, ToolsPanel } from "../components/interaction/SideDrawers";
import { LegacyViewerButton } from "../components/ui/LegacyViewerButton";
import { useBook } from "../contexts/BookContext";
import { usePdfViewer } from "../contexts/PdfViewerContext";
import { getRmsConfig, fetchPdfUrl } from "../services/rmsService";
import { getPreviewConfig } from "../utils/previewConfig";
import { BREAKPOINTS, PANEL } from "../constants/config";
import { isBrowser } from "../utils/common";
import { useStayTracker } from "../hooks/useStayTracker";
import { useRapidPageDetector } from "../hooks/useRapidPageDetector";
import "../css/split_container.css";

export const ReaderPage: React.FC = () => {
  const { isPreviewMode } = getPreviewConfig();
  const capture_min_size = 8;

  useStayTracker();
  useRapidPageDetector();

  // Desktop default: Open (Split view)
  // Mobile default: Closed (Overlay)
  const [isTocOpen, setTocOpen] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);
  const { registerPdfNavigator, setCurrentPdfPage, setPdfTotalPages } =
    usePdfViewer();
  const {
    isToolsOpen,
    setToolsOpen,
    isCaptureMode,
    setCaptureMode,
    setCapturedImage,
  } = useBook();
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [captureStart, setCaptureStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [captureCurrent, setCaptureCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const pdfGoToPageRef = useRef<(page: number) => void>();
  const pdfAreaRef = useRef<HTMLDivElement>(null);
  const [pdfBounds, setPdfBounds] = useState<DOMRect | null>(null);
  const hasOpenSidebar = isTocOpen || isToolsOpen;
  const { viewMode } = usePdfViewer();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isPdfMobileLike = useMemo(() => {
    if (!isBrowser()) return false;
    const touchUA = /Mobi|Android|iP(hone|od|ad)/i.test(ua);
    return touchUA || window.innerWidth <= BREAKPOINTS.TABLET;
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
  const [leftWidth, setLeftWidth] = useState(PANEL.LEFT_DEFAULT_WIDTH);
  const [rightWidth, setRightWidth] = useState(PANEL.RIGHT_DEFAULT_WIDTH);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const didApplyInitialLayoutRef = useRef(false);

  // Handle responsive defaults and exclusive sidebars
  useEffect(() => {
    const applyLayout = () => {
      const narrow = window.innerWidth <= BREAKPOINTS.TABLET;
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

      // 미세한 움직임(탭/펜 터치)에는 반응하지 않음 - click 이벤트 보호
      if (Math.abs(deltaY) < 5) return;

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isCaptureMode) return;
      setCaptureMode(false);
      setCaptureStart(null);
      setCaptureCurrent(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCaptureMode, setCaptureMode]);

  useEffect(() => {
    if (isCaptureMode && pdfAreaRef.current) {
      setPdfBounds(pdfAreaRef.current.getBoundingClientRect());
    } else {
      setPdfBounds(null);
    }
  }, [isCaptureMode]);

  const applyCaptureWatermark = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (!context) return;

    // html2canvas가 ctx.scale(dpr, dpr) + ctx.translate(-x,-y)를 남겨두므로
    // 물리 픽셀 좌표로 직접 그리려면 transform을 초기화해야 함
    context.setTransform(1, 0, 0, 1, 0, 0);

    const text = "campusbook";
    const w = canvas.width;
    const h = canvas.height;

    const fontSize = Math.max(12, Math.min(h * 0.025, 20));

    context.save();
    context.font = `700 ${fontSize}px Arial`;
    context.textAlign = "center";
    context.textBaseline = "middle";

    const metrics = context.measureText(text);
    const textWidth = metrics.width;
    const paddingX = fontSize * 0.8;
    const paddingY = fontSize * 0.45;
    const radius = fontSize * 0.55;
    const bottomGap = fontSize * 0.8;
    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = fontSize + paddingY * 2;
    const boxX = (w - boxWidth) / 2;
    const boxY = Math.max(0, h - boxHeight - bottomGap);

    context.fillStyle = "rgba(15, 23, 42, 0.42)";
    context.beginPath();
    context.moveTo(boxX + radius, boxY);
    context.lineTo(boxX + boxWidth - radius, boxY);
    context.quadraticCurveTo(
      boxX + boxWidth,
      boxY,
      boxX + boxWidth,
      boxY + radius
    );
    context.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
    context.quadraticCurveTo(
      boxX + boxWidth,
      boxY + boxHeight,
      boxX + boxWidth - radius,
      boxY + boxHeight
    );
    context.lineTo(boxX + radius, boxY + boxHeight);
    context.quadraticCurveTo(
      boxX,
      boxY + boxHeight,
      boxX,
      boxY + boxHeight - radius
    );
    context.lineTo(boxX, boxY + radius);
    context.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
    context.closePath();
    context.fill();

    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.fillText(text, w / 2, boxY + boxHeight / 2);
    context.restore();
  };

  const handleCaptureStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCaptureMode) return;
    const bounds = pdfAreaRef.current?.getBoundingClientRect();
    if (bounds) {
      if (
        e.clientX < bounds.left ||
        e.clientX > bounds.right ||
        e.clientY < bounds.top ||
        e.clientY > bounds.bottom
      ) {
        return;
      }
    }
    const point = { x: e.clientX, y: e.clientY };
    setCaptureStart(point);
    setCaptureCurrent(point);
  };

  const handleCaptureMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCaptureMode || !captureStart) return;
    const bounds = pdfAreaRef.current?.getBoundingClientRect();
    let x = e.clientX;
    let y = e.clientY;
    if (bounds) {
      x = Math.max(bounds.left, Math.min(bounds.right, x));
      y = Math.max(bounds.top, Math.min(bounds.bottom, y));
    }
    setCaptureCurrent({ x, y });
  };

  const handleCaptureEnd = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCaptureMode || !captureStart || !captureCurrent) {
      setCaptureStart(null);
      setCaptureCurrent(null);
      return;
    }

    const bounds = pdfAreaRef.current?.getBoundingClientRect();
    let endX = e.clientX;
    let endY = e.clientY;
    if (bounds) {
      endX = Math.max(bounds.left, Math.min(bounds.right, endX));
      endY = Math.max(bounds.top, Math.min(bounds.bottom, endY));
    }

    const rect = {
      x: Math.min(captureStart.x, endX),
      y: Math.min(captureStart.y, endY),
      width: Math.abs(endX - captureStart.x),
      height: Math.abs(endY - captureStart.y),
    };

    setCaptureStart(null);
    setCaptureCurrent(null);

    if (rect.width < capture_min_size || rect.height < capture_min_size) {
      setCaptureMode(false);
      return;
    }

    try {
      const canvas = await html2canvas(document.body, {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
        useCORS: true,
        scale: window.devicePixelRatio,
        ignoreElements: (el) => el.classList.contains("capture-overlay-ui"),
      });

      applyCaptureWatermark(canvas);
      setCapturedImage(canvas.toDataURL());
    } catch (error) {
      console.error("[ReaderPage] capture failed", error);
    } finally {
      setCaptureMode(false);
    }
  };

  const capture_box_style: React.CSSProperties =
    isCaptureMode && captureStart && captureCurrent
      ? {
          left: Math.min(captureStart.x, captureCurrent.x),
          top: Math.min(captureStart.y, captureCurrent.y),
          width: Math.abs(captureCurrent.x - captureStart.x),
          height: Math.abs(captureCurrent.y - captureStart.y),
        }
      : {};

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
        if (
          newWidth > PANEL.LEFT_MIN_WIDTH &&
          newWidth < PANEL.LEFT_MAX_WIDTH
        ) {
          setLeftWidth(newWidth);
        }
      }

      if (isDraggingRight) {
        const newWidth = containerRect.right - e.clientX;
        if (
          newWidth > PANEL.RIGHT_MIN_WIDTH &&
          newWidth < PANEL.RIGHT_MAX_WIDTH
        ) {
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
  const [pdfFailed, setPdfFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadPdfUrl = async () => {
      // 로컬 테스트용 PDF URL 오버라이드
      const DEV_PDF_URL = import.meta.env.DEV
        ? import.meta.env.VITE_DEV_PDF_URL
        : undefined;
      if (DEV_PDF_URL) {
        if (!cancelled) setPdfUrlState(DEV_PDF_URL);
        return;
      }

      const config = getRmsConfig();
      if (!config) {
        if (!cancelled) setPdfFailed(true);
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
        if (!cancelled) setPdfFailed(true);
      }
    };

    loadPdfUrl();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePdfLoadError = useCallback(() => {
    setPdfFailed(true);
  }, []);

  return (
    <div className="layout_container">
      {isCaptureMode && pdfBounds && (
        <div
          className="capture-dim capture-overlay-ui"
          style={{
            left: pdfBounds.left,
            top: pdfBounds.top,
            width: pdfBounds.width,
            height: pdfBounds.height,
          }}
        />
      )}
      {isCaptureMode && (
        <div
          className="capture-interaction capture-overlay-ui"
          onPointerDown={handleCaptureStart}
          onPointerMove={handleCaptureMove}
          onPointerUp={handleCaptureEnd}
        >
          {captureStart && captureCurrent && (
            <div
              className="capture-overlay capture-selection-box capture-overlay-ui"
              style={capture_box_style}
            />
          )}
        </div>
      )}
      {isCaptureMode && !captureStart && (
        <div className="capture-toast capture-overlay-ui">
          <span>캡처 영역을 드래그해서 선택해주세요</span>
          <button
            className="capture-toast-close"
            onClick={(e) => {
              e.stopPropagation();
              setCaptureMode(false);
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      <Header toggleSidebar={toggleToc} isSidebarOpen={isTocOpen} />
      {(isPreviewMode || pdfFailed) && <LegacyViewerButton />}

      {/* Main Split Layout Container */}
      <div ref={containerRef} className="split_container">
        {/* 왼쪽 사이드바 - 모든 모드에서 표시 */}
        <aside
          ref={leftPanelRef}
          className={`left_side_wrap ${!isTocOpen ? "off" : "on"}`}
          style={{
            width: isTocOpen
              ? window.innerWidth < BREAKPOINTS.MOBILE
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
          <div className="cc_top" ref={pdfAreaRef}>
            {pdfUrl ? (
              <PdfViewer
                file={pdfUrl}
                onPageChange={handlePdfPageChange}
                onPagesCount={handlePdfPagesCount}
                registerGoToPage={handleRegisterGoToPage}
                forceSinglePage={forceSinglePage}
                onLoadError={handlePdfLoadError}
              />
            ) : (
              <div className="pdf_loading">로딩 중...</div>
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
              ? window.innerWidth < BREAKPOINTS.MOBILE
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
