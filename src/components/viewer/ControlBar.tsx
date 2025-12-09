import React, {useState, useEffect} from 'react';
import {useBook} from '../../contexts/BookContext';
import {ChevronLeft, ChevronRight} from 'lucide-react';

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
    <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] transition-colors duration-200">
      {/* Draggable Progress Bar */}
      <div className="relative w-full h-4 bg-slate-100 dark:bg-slate-800 group cursor-pointer">
        <input
          type="range"
          min="0"
          max={chapters.length - 1}
          value={currentChapterIndex}
          onChange={handleScrubberChange}
          className="absolute inset-0 w-full h-full opacity-0 z-20 cursor-pointer"
        />
        <div
          className="h-full bg-blue-600 transition-all duration-300 ease-out relative z-10"
          style={{
            width: `${((currentChapterIndex + 1) / chapters.length) * 100}%`,
          }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 bg-white border-2 border-blue-600 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"></div>
        </div>
      </div>

      <div className="px-4 py-3 flex items-center justify-between max-w-3xl mx-auto">
        {/* Prev Button */}
        <button
          onClick={goToPrevChapter}
          disabled={currentChapterIndex === 0}
          className={`
            flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition-colors text-sm
            ${
              currentChapterIndex === 0
                ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }
          `}
        >
          <ChevronLeft size={18} />
          <span className="hidden sm:inline">Prev</span>
        </button>

        {/* Chapter/Page Info */}
        <div className="flex flex-col items-center gap-1">
          <form onSubmit={handlePageSubmit} className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Page
            </span>
            <input
              type="text"
              value={inputPage}
              onChange={e => setInputPage(e.target.value)}
              className="w-10 text-center text-sm font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-white"
            />
            <span className="text-sm text-slate-400">/ {chapters.length}</span>
          </form>
          <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[120px] sm:max-w-xs text-center">
            {chapters[currentChapterIndex].title.split(':')[1] ||
              chapters[currentChapterIndex].title}
          </span>
        </div>

        {/* Next Button */}
        <button
          onClick={goToNextChapter}
          disabled={currentChapterIndex === chapters.length - 1}
          className={`
            flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition-colors text-sm
            ${
              currentChapterIndex === chapters.length - 1
                ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
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
