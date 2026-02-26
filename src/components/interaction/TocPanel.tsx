import React, { useState, useRef, useEffect } from "react";
import { useBook } from "../../contexts/BookContext";
import { usePdfViewer } from "../../contexts/PdfViewerContext";
import { useAnnotation } from "../../contexts/AnnotationContext";
import { Trash2, Bookmark, List as ListIcon, Lock } from "lucide-react";
import { getPreviewConfig } from "../../utils/previewConfig";
import { PanelWrapper } from "./PanelWrapper";

export const TocPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { chapters, currentChapterIndex, goToChapter } = useBook();
  const { bookmarks, removePdfBookmark } = useAnnotation();
  const { goToPdfPage, currentPdfPage } = usePdfViewer();
  const [activeTab, setActiveTab] = useState<"contents" | "bookmarks">(
    "contents"
  );
  const chapterListRef = useRef<HTMLDivElement | null>(null);
  const chapterItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { isPreviewMode } = getPreviewConfig();

  // 활성 챕터가 보이도록 사이드바 스크롤 자동 조정
  useEffect(() => {
    if (activeTab !== "contents") return;
    const target = chapterItemRefs.current[currentChapterIndex];
    if (!target) return;
    const container = chapterListRef.current;
    if (!container) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const cRect = container.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const isVisible = tRect.top >= cRect.top && tRect.bottom <= cRect.bottom;
    if (!isVisible) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [currentChapterIndex, activeTab]);

  return (
    <PanelWrapper isOpen={isOpen} onClose={onClose} side="left" title="콘텐츠">
      <div className="toc_panel_inner">
        <div className="chapter_favor_wrap">
          <button
            onClick={() => setActiveTab("contents")}
            className={`chapter ${activeTab === "contents" ? "on" : "off"}`}
          >
            <ListIcon size={14} /> 목차
          </button>
          <button
            onClick={() => setActiveTab("bookmarks")}
            className={`favor ${activeTab === "bookmarks" ? "on" : "off"}`}
          >
            <Bookmark size={14} /> 북마크
          </button>
        </div>
        <div className="toc_content_area">
        <div
          className={`chapter_list${isPreviewMode && activeTab === "contents" ? " toc_blur" : ""}`}
          ref={chapterListRef}
        >
          {activeTab === "contents" &&
            chapters.map((chapter, idx) => {
              const depth = chapter.depth ?? 1;
              const depthPaddingMap: Record<number, string> = {
                1: "pl-0",
                2: "pl-4",
                3: "pl-7",
                4: "pl-10",
              };
              const depthPadding = depthPaddingMap[depth] ?? "pl-0";
              const isDepth1 = depth === 1;
              return (
                <button
                  key={chapter.id}
                  ref={(el) => {
                    chapterItemRefs.current[idx] = el;
                  }}
                  onClick={() => {
                    goToChapter(idx);
                    if (window.innerWidth < 480) onClose();
                  }}
                  className={`${depthPadding} ${idx === currentChapterIndex ? "on" : "off"}`}
                >
                  <div className="chapter_list_inner">
                    <div className="">
                      {isDepth1 && (
                        <span
                          className={`text_xs ${
                            idx === currentChapterIndex ? "on" : "off"
                          }`}
                        >
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                      )}
                      <span
                        className={`line_clamp_1 ${
                          isDepth1
                            ? "font-semibold"
                            : "text-slate-500 dark:text-slate-400 text-[0.8em]"
                        }`}
                      >
                        {chapter.title}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          {activeTab === "bookmarks" &&
            bookmarks
              .filter((bm) => !bm.deleted)
              .map((bm) => (
                <div
                  key={bm.id}
                  className={`bookmark_item_row ${
                    bm.page === currentPdfPage ? "active" : ""
                  }`}
                >
                  <button
                    onClick={() => {
                      goToPdfPage(bm.page);
                      if (window.innerWidth < 480) onClose();
                    }}
                    className="bookmark_item_button"
                  >
                    <div className="bookmark_page_badge">
                      {/* <Bookmark size={14} />
                    <span>Page {bm.page}</span> */}
                      <span className="bookmark_label line_clamp_1">
                        {`P. ${bm.page}`}
                      </span>
                    </div>
                    <div className="bookmark_item_text">
                      {/* <span className="bookmark_label line_clamp_1">
                      {bm.label || `Page ${bm.page}`}
                    </span> */}
                      <span className="bookmark_meta">
                        Saved {new Date(bm.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removePdfBookmark(bm.id);
                    }}
                    className="bookmark_remove_btn"
                    title="Delete bookmark"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
          {activeTab === "bookmarks" &&
            bookmarks.filter((bm) => !bm.deleted).length === 0 && (
              <div className="non_book_mark">
                <Bookmark size={24} className="mx-auto mb-2 text-slate-400" />
                <p className="text_sm">북마크한 페이지가 없습니다.</p>
              </div>
            )}
        </div>

        {/* 미리보기 모드: 목차 탭일 때 잠금 오버레이 */}
        {isPreviewMode && activeTab === "contents" && (
          <div className="toc_preview_overlay">
            <div className="toc_preview_card">
              <div className="toc_preview_icon">
                <Lock size={20} />
              </div>
              <p className="toc_preview_text">
                미리보기 모드에서는<br />목차를 사용하실 수 없습니다.
              </p>
            </div>
          </div>
        )}
        </div>
      </div>
    </PanelWrapper>
  );
};
