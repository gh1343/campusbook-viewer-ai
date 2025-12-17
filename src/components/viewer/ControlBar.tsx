import React, { useState, useEffect } from "react";
import { useBook } from "../../contexts/BookContext";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "../../css/page_navigation.css";
export const ControlBar: React.FC = () => {
  const {
    chapters,
    currentChapterIndex,
    goToNextChapter,
    goToPrevChapter,
    goToChapter,
  } = useBook();

  const [inputPage, setInputPage] = useState(
    (currentChapterIndex + 1).toString()
  );

  useEffect(() => {
    setInputPage((currentChapterIndex + 1).toString());
  }, [currentChapterIndex]);

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(inputPage);
    if (!isNaN(page) && page >= 1 && page <= chapters.length) {
      goToChapter(page - 1);
    } else {
      setInputPage((currentChapterIndex + 1).toString());
    }
  };

  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    goToChapter(val);
  };

  return (
    <div className="navigation_inner">
      {/* Draggable Progress Bar */}
      <div className="prograss_bar_wrap">
        <input
          type="range"
          min="0"
          max={chapters.length - 1}
          value={currentChapterIndex}
          onChange={handleScrubberChange}
          className="prograss_max"
        />
        <div
          className="prograss_range"
          style={{
            width: `${((currentChapterIndex + 1) / chapters.length) * 100}%`,
          }}
        >
          <div className="prograss_pointer"></div>
        </div>
      </div>

      <div className="navigation_bottom_box">
        {/* Prev Button */}
        <button
          onClick={goToPrevChapter}
          disabled={currentChapterIndex === 0}
          className={`
            ${currentChapterIndex === 0 ? "off" : "on"}
          `}
        >
          <ChevronLeft size={18} />
          <span className="hidden sm:inline">Prev</span>
        </button>

        {/* Chapter/Page Info */}
        <div className="chapter_page">
          <form onSubmit={handlePageSubmit} className="">
            <span className="text_xs">Page</span>
            <input
              type="text"
              value={inputPage}
              onChange={(e) => setInputPage(e.target.value)}
              className=""
            />
            <span className="slash">/ {chapters.length}</span>
          </form>
          <span className="chapter_name">
            {chapters[currentChapterIndex].title.split(":")[1] ||
              chapters[currentChapterIndex].title}
          </span>
        </div>

        {/* Next Button */}
        <button
          onClick={goToNextChapter}
          disabled={currentChapterIndex === chapters.length - 1}
          className={`
            ${currentChapterIndex === chapters.length - 1 ? "off" : "on"}
          `}
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
};
