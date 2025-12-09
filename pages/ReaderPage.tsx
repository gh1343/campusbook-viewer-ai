import React, { useState, useEffect, useRef } from "react";
import { Header } from "../components/layout/Header";
import { ContentRenderer } from "../components/viewer/ContentRenderer";
import { PdfViewer } from "../components/viewer/PdfViewer";
import { ControlBar } from "../components/viewer/ControlBar";
import { TocPanel, ToolsPanel } from "../components/interaction/SideDrawers";
import { useBook } from "../contexts/BookContext";

export const ReaderPage: React.FC = () => {
  // Desktop default: Open (Split view)
  // Mobile default: Closed (Overlay)
  const [isTocOpen, setTocOpen] = useState(true);
  const { isToolsOpen, setToolsOpen } = useBook();

  // Resizable Panel State
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(350);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle responsive defaults
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setTocOpen(false);
        setToolsOpen(false);
      } else {
        setTocOpen(true);
        setToolsOpen(true);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setToolsOpen]);

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

  const toggleToc = () => setTocOpen(!isTocOpen);

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-950 transition-colors duration-200 font-sans overflow-hidden">
      <Header toggleSidebar={toggleToc} isSidebarOpen={isTocOpen} />

      {/* Main Split Layout Container */}
      <div
        ref={containerRef}
        className="flex flex-1 pt-16 overflow-auto relative"
      >
        {/* Left Panel Area */}
        <div
          className={`relative flex-shrink-0 transition-[width] duration-100 ease-linear ${
            !isTocOpen
              ? "w-0 border-none"
              : "border-r border-slate-200 dark:border-slate-800"
          }`}
          style={{
            width: isTocOpen
              ? window.innerWidth < 768
                ? "0px"
                : `${leftWidth}px`
              : "0px",
          }}
        >
          {/* Render Panel Content */}
          <div className="h-full w-full overflow-hidden">
            <TocPanel isOpen={isTocOpen} onClose={() => setTocOpen(false)} />
          </div>

          {/* Resizer Handle (Desktop Only) */}
          {isTocOpen && window.innerWidth >= 768 && (
            <div
              className="absolute top-0 right-[-4px] w-2 h-full cursor-col-resize z-50 flex items-center justify-center group hover:bg-blue-500/10 transition-colors"
              onMouseDown={() => setIsDraggingLeft(true)}
            >
              <div className="w-[1px] h-8 bg-slate-300 dark:bg-slate-700 group-hover:bg-blue-400"></div>
            </div>
          )}
        </div>

        {/* Center Panel: Reader & Controls */}
        <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-950 relative z-0">
          <div className="max-w-3xl mx-auto min_h_[calc(100vh-12rem)]">
            {/* TODO: 나중에 조건부 렌더링으로 바꿀 수 있음 */}
            <PdfViewer file="/pdf/test2.pdf" />
          </div>

          <div className="sticky bottom-0 z-30 w-full">
            <ControlBar />
          </div>
        </main>

        {/* Right Panel Area */}
        <div
          className={`relative flex-shrink-0 transition-[width] duration-100 ease-linear ${
            !isToolsOpen
              ? "w-0 border-none"
              : "border-l border-slate-200 dark:border-slate-800"
          }`}
          style={{
            width: isToolsOpen
              ? window.innerWidth < 768
                ? "0px"
                : `${rightWidth}px`
              : "0px",
          }}
        >
          {/* Resizer Handle */}
          {isToolsOpen && window.innerWidth >= 768 && (
            <div
              className="absolute top-0 left-[-4px] w-2 h-full cursor-col-resize z-50 flex items-center justify-center group hover:bg-blue-500/10 transition-colors"
              onMouseDown={() => setIsDraggingRight(true)}
            >
              <div className="w-[1px] h-8 bg-slate-300 dark:bg-slate-700 group-hover:bg-blue-400"></div>
            </div>
          )}

          {/* Render Panel Content */}
          <div className="h-full w-full overflow-hidden">
            <ToolsPanel
              isOpen={isToolsOpen}
              onClose={() => setToolsOpen(false)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
