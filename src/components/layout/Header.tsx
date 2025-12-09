import React, {useState, useRef} from 'react';
import {useBook} from '../../contexts/BookContext';
import {
  Type,
  Book,
  Sidebar,
  PanelRight,
  Pen,
  Eraser,
  LogOut,
  Save,
  Eye,
  EyeOff,
  Settings2,
  X,
  Bookmark,
  FileUp,
  Loader2,
  Search,
  MoreVertical,
  Columns,
  Minus,
  Plus,
} from 'lucide-react';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {DrawingColor} from '../../../types';

interface HeaderProps {
  toggleSidebar: () => void;
  isSidebarOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  toggleSidebar,
  isSidebarOpen,
}) => {
  const {
    fontSize,
    setFontSize,
    viewMode,
    setViewMode,
    drawingMode,
    setDrawingMode,
    penColor,
    setPenColor,
    penWidth,
    setPenWidth,
    penOpacity,
    setPenOpacity,
    saveProgress,
    showAnnotations,
    toggleAnnotations,
    isToolsOpen,
    setToolsOpen,
    bookmarks,
    toggleBookmark,
    currentChapter,
    uploadBook,
    isProcessing,
    setActiveToolTab,
  } = useBook();

  const location = useLocation();
  const navigate = useNavigate();
  const isReader = location.pathname === '/';
  const [showPenSettings, setShowPenSettings] = useState(false);
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [showSysMenu, setShowSysMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isBookmarked = bookmarks.includes(currentChapter.id);

  const handleExit = () => {
    if (confirm('Are you sure you want to close the viewer?')) {
      navigate('/report');
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      uploadBook(e.target.files[0]);
    }
  };

  const handleSearchClick = () => {
    setToolsOpen(true);
    setActiveToolTab('search');
  };

  const cycleFontSize = (dir: 'up' | 'down') => {
    const sizes = ['small', 'medium', 'large', 'xlarge'] as const;
    const currentIndex = sizes.indexOf(fontSize);
    let nextIndex = dir === 'up' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= sizes.length) nextIndex = sizes.length - 1;
    setFontSize(sizes[nextIndex]);
  };

  const colors: DrawingColor[] = [
    '#000000',
    '#ef4444',
    '#3b82f6',
    '#22c55e',
    '#eab308',
  ];

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 z-[60] transition-colors duration-200 flex items-center shadow-sm">
      <div className="w-full px-4 flex items-center justify-between">
        {/* Left: Branding & TOC */}
        <div className="flex items-center gap-3">
          {isReader && (
            <button
              onClick={toggleSidebar}
              className={`p-2 rounded-lg transition-colors ${
                isSidebarOpen
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="Table of Contents"
            >
              <Sidebar size={20} />
            </button>
          )}
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
            <div className="bg-blue-600 rounded-md p-1">
              <Book className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg hidden sm:block tracking-tight">
              CampusBook
            </span>
          </div>
        </div>

        {/* Center: View Switcher & Upload */}
        <div className="hidden md:flex items-center gap-2">
          <div className="bg-slate-100 dark:bg-slate-900 rounded-lg p-1 border border-slate-200 dark:border-slate-800 flex">
            <Link
              to="/"
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                isReader
                  ? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              Reader
            </Link>
            <Link
              to="/report"
              className={`flex items-center gap-1 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                !isReader
                  ? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              Report
            </Link>
          </div>
          <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 mx-1"></div>
          <button
            onClick={handleUploadClick}
            disabled={isProcessing}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg text-sm font-medium transition-colors border border-blue-100 dark:border-blue-900/30"
            title="Add Reference Material (PDF)"
          >
            {isProcessing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileUp size={16} />
            )}
            <span>Add Reference</span>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="application/pdf"
              onChange={handleFileChange}
            />
          </button>
        </div>

        {/* Right: Tools */}
        <div className="flex items-center gap-1">
          {isReader && (
            <>
              {/* Search Button */}
              <button
                onClick={handleSearchClick}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Search"
              >
                <Search size={20} />
              </button>

              {/* Pen Tools */}
              <div className="flex items-center gap-1 px-2 relative">
                <div className="flex bg-slate-100 dark:bg-slate-900 rounded-lg p-0.5 border border-slate-200 dark:border-slate-800 items-center">
                  <button
                    onClick={() =>
                      setDrawingMode(drawingMode === 'pen' ? 'idle' : 'pen')
                    }
                    className={`p-2 rounded-md transition-all flex items-center gap-1 ${
                      drawingMode === 'pen'
                        ? 'bg-white dark:bg-slate-800 shadow text-blue-600'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                    title="Pen Tool"
                  >
                    <Pen size={18} />
                  </button>
                  {drawingMode === 'pen' && (
                    <button
                      onClick={() => setShowPenSettings(!showPenSettings)}
                      className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-500 mr-1"
                      title="Pen Settings"
                    >
                      <Settings2 size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setDrawingMode(
                        drawingMode === 'eraser' ? 'idle' : 'eraser'
                      );
                      setShowPenSettings(false);
                    }}
                    className={`p-2 rounded-md transition-all ${
                      drawingMode === 'eraser'
                        ? 'bg-white dark:bg-slate-800 shadow text-red-500'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                    title="Eraser"
                  >
                    <Eraser size={18} />
                  </button>
                </div>
                {showPenSettings && drawingMode === 'pen' && (
                  <div className="absolute top-full right-0 mt-2 w-64 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 p-4 animate-fade-in z-[70]">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs font-bold text-slate-500 uppercase">
                        Pen Settings
                      </span>
                      <button
                        onClick={() => setShowPenSettings(false)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex justify-between mb-4">
                      {colors.map(c => (
                        <button
                          key={c}
                          onClick={() => setPenColor(c)}
                          className={`w-6 h-6 rounded-full transition-transform hover:scale-110 border border-slate-200 dark:border-slate-700 ${
                            penColor === c
                              ? 'ring-2 ring-offset-2 ring-blue-500 scale-110'
                              : ''
                          }`}
                          style={{backgroundColor: c}}
                        />
                      ))}
                    </div>
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Thickness</span>
                        <span>{penWidth}px</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="15"
                        step="1"
                        value={penWidth}
                        onChange={e => setPenWidth(parseInt(e.target.value))}
                        className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Opacity</span>
                        <span>{Math.round(penOpacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.1"
                        value={penOpacity}
                        onChange={e =>
                          setPenOpacity(parseFloat(e.target.value))
                        }
                        className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Appearance Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowViewSettings(!showViewSettings)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  title="Appearance"
                >
                  <Type size={20} />
                </button>
                {showViewSettings && (
                  <div className="absolute top-full right-0 mt-2 w-60 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 p-4 animate-fade-in z-[70]">
                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">
                      View Settings
                    </h4>

                    {/* Font Size */}
                    <div className="flex items-center justify-between mb-4 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                      <button
                        onClick={() => cycleFontSize('down')}
                        className="p-2 hover:bg-white dark:hover:bg-slate-700 rounded shadow-sm"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="text-sm font-medium">
                        {fontSize === 'medium'
                          ? '100%'
                          : fontSize === 'small'
                          ? '85%'
                          : fontSize === 'large'
                          ? '115%'
                          : '130%'}
                      </span>
                      <button
                        onClick={() => cycleFontSize('up')}
                        className="p-2 hover:bg-white dark:hover:bg-slate-700 rounded shadow-sm"
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* Toggle Options */}
                    <div className="space-y-2">
                      <button
                        onClick={() =>
                          setViewMode(
                            viewMode === 'single' ? 'double' : 'single'
                          )
                        }
                        className="w-full flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm text-slate-700 dark:text-slate-300"
                      >
                        <span className="flex items-center gap-2">
                          <Columns size={16} /> Two-Page View
                        </span>
                        <div
                          className={`w-8 h-4 rounded-full relative transition-colors ${
                            viewMode === 'double'
                              ? 'bg-blue-500'
                              : 'bg-slate-300'
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                              viewMode === 'double' ? 'translate-x-4' : ''
                            }`}
                          ></div>
                        </div>
                      </button>
                      <button
                        onClick={toggleAnnotations}
                        className="w-full flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm text-slate-700 dark:text-slate-300"
                      >
                        <span className="flex items-center gap-2">
                          <Eye size={16} /> Annotations
                        </span>
                        <div
                          className={`w-8 h-4 rounded-full relative transition-colors ${
                            showAnnotations ? 'bg-blue-500' : 'bg-slate-300'
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                              showAnnotations ? 'translate-x-4' : ''
                            }`}
                          ></div>
                        </div>
                      </button>
                      <button
                        onClick={toggleBookmark}
                        className="w-full flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm text-slate-700 dark:text-slate-300"
                      >
                        <span className="flex items-center gap-2">
                          <Bookmark size={16} /> Bookmark Page
                        </span>
                        <div
                          className={`w-8 h-4 rounded-full relative transition-colors ${
                            isBookmarked ? 'bg-blue-500' : 'bg-slate-300'
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                              isBookmarked ? 'translate-x-4' : ''
                            }`}
                          ></div>
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Side Panel */}
              <button
                onClick={() => setToolsOpen(!isToolsOpen)}
                className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${
                  isToolsOpen
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Toggle AI & Notes"
              >
                <PanelRight size={20} />
              </button>
            </>
          )}

          {/* System Menu */}
          <div className="relative ml-1">
            <button
              onClick={() => setShowSysMenu(!showSysMenu)}
              className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              <MoreVertical size={20} />
            </button>
            {showSysMenu && (
              <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 p-1 animate-fade-in z-[70]">
                <button
                  onClick={handleUploadClick}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  {isProcessing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <FileUp size={14} />
                  )}{' '}
                  Add Reference PDF
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="application/pdf"
                  onChange={handleFileChange}
                />

                <button
                  onClick={saveProgress}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  <Save size={14} /> Save Progress
                </button>
                <div className="h-px bg-slate-100 dark:bg-slate-800 my-1"></div>
                <button
                  onClick={handleExit}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                >
                  <LogOut size={14} /> Exit Viewer
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
