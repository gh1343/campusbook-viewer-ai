import React, { useState, useEffect } from "react";
import { useBook } from "../../../contexts/BookContext";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "../../../css/page_navigation.css";
interface ControlBarProps {
  pdfPageCount?: number;
  pdfCurrentPage?: number;
  onPdfGoToPage?: (page: number) => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  pdfPageCount,
  pdfCurrentPage,
  onPdfGoToPage,
}) => {
  const {
    chapters,
    currentChapterIndex,
    goToNextChapter,
    goToPrevChapter,
    goToChapter,
  } = useBook();

  const isPdfMode = !!onPdfGoToPage && (pdfPageCount || 0) > 0;
  const totalPages = isPdfMode ? pdfPageCount || 1 : chapters.length;
  const currentPageNumber = isPdfMode
    ? pdfCurrentPage || 1
    : currentChapterIndex + 1;
  const currentIndexZeroBased = currentPageNumber - 1; // range 입력값
  const chapterLabel =
    chapters[currentChapterIndex]?.title || (isPdfMode ? "PDF" : "Chapter");

  const [inputPage, setInputPage] = useState(currentPageNumber.toString());

  useEffect(() => {
    setInputPage(currentPageNumber.toString());
  }, [currentPageNumber]);

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(inputPage);
    if (isNaN(page) || page < 1 || page > totalPages) {
      setInputPage(currentPageNumber.toString());
      return;
    }
    if (isPdfMode) onPdfGoToPage?.(page);
    else goToChapter(page - 1);
  };

  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    if (isPdfMode) {
      onPdfGoToPage?.(val + 1);
    } else {
      goToChapter(val);
    }
  };

  return (
    <div className="navigation_inner">
      {/* Draggable Progress Bar */}
      <div className="prograss_bar_wrap">
        <input
          type="range"
          min="0"
          max={Math.max(totalPages - 1, 0)}
          value={currentIndexZeroBased}
          onChange={handleScrubberChange}
          className="prograss_max"
        />
        <div
          className="prograss_range"
          style={{
            width: `${(currentPageNumber / totalPages) * 100}%`,
          }}
        >
          <div className="prograss_pointer"></div>
        </div>
      </div>

      <div className="navigation_bottom_box">
        {/* Prev Button */}
        <button
          onClick={() =>
            isPdfMode
              ? onPdfGoToPage?.(Math.max(1, currentPageNumber - 1))
              : goToPrevChapter()
          }
          disabled={
            isPdfMode ? currentPageNumber <= 1 : currentChapterIndex === 0
          }
          className={`
            ${
              isPdfMode
                ? currentPageNumber <= 1
                  ? "off"
                  : "on"
                : currentChapterIndex === 0
                ? "off"
                : "on"
            }
          `}
        >
          <ChevronLeft size={18} />
          <span className="hidden sm:inline">Prev</span>
        </button>

        {/* Chapter/Page Info */}
        {/* test */}
        <div className="chapter_page">
          <form onSubmit={handlePageSubmit} className="">
            <span className="text_xs">Page</span>
            <input
              type="text"
              value={inputPage}
              onChange={(e) => setInputPage(e.target.value)}
              className=""
            />
            <span className="slash">/ {totalPages}</span>
          </form>
          <span className="chapter_name">{chapterLabel}</span>
        </div>

        {/* Next Button */}
        <button
          onClick={() =>
            isPdfMode
              ? onPdfGoToPage?.(Math.min(totalPages, currentPageNumber + 1))
              : goToNextChapter()
          }
          disabled={
            isPdfMode
              ? currentPageNumber >= totalPages
              : currentChapterIndex === chapters.length - 1
          }
          className={`
            ${
              isPdfMode
                ? currentPageNumber >= totalPages
                  ? "off"
                  : "on"
                : currentChapterIndex === chapters.length - 1
                ? "off"
                : "on"
            }
          `}
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
};
