import React, { useState, useRef } from "react";
import { useBook } from "../../contexts/BookContext";
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
  Settings2,
  X,
  Bookmark,
  BookmarkCheck,
  BookmarkPlus,
  FileUp,
  Loader2,
  Search,
  MoreVertical,
  Columns,
  Minus,
  Plus,
  Volume2,
  Play,
  Pause,
  Square,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { DrawingColor, TTSVoice } from "../../../types";
import "../../css/header.css";
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
    addPdfBookmark,
    removePdfBookmark,
    currentPdfPage,
    uploadBook,
    isProcessing,
    isTtsPlaying,
    startTts,
    stopTts,
    pauseTts,
    ttsConfig,
    setTtsConfig,
    setActiveToolTab,
  } = useBook();

  const location = useLocation();
  const navigate = useNavigate();
  const isReader = location.pathname === "/";
  const [showPenSettings, setShowPenSettings] = useState(false);
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [showTtsSettings, setShowTtsSettings] = useState(false);
  const [showSysMenu, setShowSysMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentPageBookmark = bookmarks.find((b) => b.page === currentPdfPage);
  const isBookmarked = Boolean(currentPageBookmark);

  const handleExit = () => {
    if (confirm("Are you sure you want to close the viewer?")) {
      navigate("/report");
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
    setActiveToolTab("search");
  };

  const handleBookmarkClick = () => {
    if (!currentPdfPage) return;
    if (currentPageBookmark) {
      removePdfBookmark(currentPageBookmark.id);
    } else {
      addPdfBookmark(currentPdfPage, `PDF p.${currentPdfPage}`);
    }
  };

  const cycleFontSize = (dir: "up" | "down") => {
    const sizes = ["small", "medium", "large", "xlarge"] as const;
    const currentIndex = sizes.indexOf(fontSize);
    let nextIndex = dir === "up" ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= sizes.length) nextIndex = sizes.length - 1;
    setFontSize(sizes[nextIndex]);
  };

  const voices: TTSVoice[] = ["Kore", "Puck", "Charon", "Fenrir", "Zephyr"];
  const speeds = [0.75, 1.0, 1.2, 1.5, 2.0];

  const colors: DrawingColor[] = [
    "#000000",
    "#ef4444",
    "#3b82f6",
    "#22c55e",
    "#eab308",
  ];

  return (
    <header className="header">
      <div className="header_inner">
        {/* Left: Branding & TOC */}
        <div className="header_main">
          {isReader && (
            <button
              onClick={toggleSidebar}
              className={`left_toggle ${isSidebarOpen ? "open" : "off"}`}
              title="Table of Contents"
            >
              <Sidebar size={20} />
            </button>
          )}
          <div className="logo_wrap">
            <div className="icon">
              <Book />
            </div>
            <span className="logo_text">CampusBook</span>
          </div>
        </div>

        {/* Center: View Switcher & Upload */}
        <div className="header_nav">
          <div className="mode_select">
            <Link to="/" className={`reader ${isReader ? "on" : "off"}`}>
              Reader
            </Link>
            <Link to="/report" className={`report ${!isReader ? "on" : "off"}`}>
              Report
            </Link>
          </div>
          <div className="separate_bar"></div>
          <button
            onClick={handleUploadClick}
            disabled={isProcessing}
            className="add_file"
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
        <div className="header_tools">
          {isReader && (
            <>
              {/* TTS Control Area */}
              <div className="relative">
                <button
                  onClick={() => setShowTtsSettings(!showTtsSettings)}
                  className={`p-2 rounded-lg transition-all ${
                    isTtsPlaying
                      ? "text-blue-600 bg-blue-50"
                      : "text-slate-500 hover:bg-slate-100"
                  }`}
                  title="AI Voice"
                >
                  <Volume2 size={20} />
                </button>
                {showTtsSettings && (
                  <div className="absolute top-full right-0 mt-2 w-72 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border p-5 z-[70]">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        AI Reading Assistant
                      </span>
                      <button
                        onClick={() => setShowTtsSettings(false)}
                        className="text-slate-400"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex justify-center gap-4 mb-5 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                      <button
                        onClick={stopTts}
                        className="p-2.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500"
                      >
                        <Square size={16} fill="currentColor" />
                      </button>
                      <button
                        onClick={() => (isTtsPlaying ? pauseTts() : startTts())}
                        className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform"
                      >
                        {isTtsPlaying ? (
                          <Pause size={24} fill="white" />
                        ) : (
                          <Play size={24} className="ml-1" fill="white" />
                        )}
                      </button>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="text-[10px] font-bold block mb-2 text-slate-400 uppercase">
                          Voice Tone
                        </label>
                        <div className="grid grid-cols-3 gap-1">
                          {voices.map((v) => (
                            <button
                              key={v}
                              onClick={() => setTtsConfig({ voice: v })}
                              className={`px-2 py-1 rounded text-[10px] border transition-all ${
                                ttsConfig.voice === v
                                  ? "bg-blue-600 border-blue-600 text-white"
                                  : "bg-slate-50 dark:bg-slate-800 text-slate-500 border-transparent hover:bg-slate-200"
                              }`}
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold block mb-2 text-slate-400 uppercase">
                          Speed
                        </label>
                        <div className="flex justify-between gap-1">
                          {speeds.map((s) => (
                            <button
                              key={s}
                              onClick={() => setTtsConfig({ speed: s })}
                              className={`flex-1 py-1 rounded text-[10px] border transition-all ${
                                ttsConfig.speed === s
                                  ? "bg-blue-600 border-blue-600 text-white font-bold"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 border-transparent hover:bg-slate-200"
                              }`}
                            >
                              {s}x
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={handleBookmarkClick}
                className={`bookmark_icon_btn ${isBookmarked ? "on" : "off"}`}
                title={
                  isBookmarked
                    ? "Remove bookmark for this page"
                    : "Bookmark this page"
                }
              >
                {isBookmarked ? (
                  <BookmarkCheck size={20} />
                ) : (
                  <BookmarkPlus size={20} />
                )}
              </button>
              {/* Pen Tools */}
              <div className="draw_icon_wrap">
                <div className="draw_icon_inner">
                  <button
                    onClick={() =>
                      setDrawingMode(drawingMode === "pen" ? "idle" : "pen")
                    }
                    className={`pen_tool ${
                      drawingMode === "pen" ? "on" : "off"
                    }`}
                    title="Pen Tool"
                  >
                    <Pen size={18} />
                  </button>
                  {drawingMode === "pen" && (
                    <button
                      onClick={() => setShowPenSettings(!showPenSettings)}
                      className="detail_select"
                      title="Pen Settings"
                    >
                      <Settings2 size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setDrawingMode(
                        drawingMode === "eraser" ? "idle" : "eraser"
                      );
                      setShowPenSettings(false);
                    }}
                    className={`eraser_tool ${
                      drawingMode === "eraser" ? "on" : "off"
                    }`}
                    title="Eraser"
                  >
                    <Eraser size={18} />
                  </button>
                </div>
                {showPenSettings && drawingMode === "pen" && (
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
                      {colors.map((c) => (
                        <button
                          key={c}
                          onClick={() => setPenColor(c)}
                          className={`w-6 h-6 rounded-full transition-transform hover:scale-110 border border-slate-200 dark:border-slate-700 ${
                            penColor === c
                              ? "ring-2 ring-offset-2 ring-blue-500 scale-110"
                              : ""
                          }`}
                          style={{ backgroundColor: c }}
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
                        onChange={(e) => setPenWidth(parseInt(e.target.value))}
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
                        onChange={(e) =>
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
                  className="appearance"
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
                        onClick={() => cycleFontSize("down")}
                        className="p-2 hover:bg-white dark:hover:bg-slate-700 rounded shadow-sm"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="text-sm font-medium">
                        {fontSize === "medium"
                          ? "100%"
                          : fontSize === "small"
                          ? "85%"
                          : fontSize === "large"
                          ? "115%"
                          : "130%"}
                      </span>
                      <button
                        onClick={() => cycleFontSize("up")}
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
                            viewMode === "single" ? "double" : "single"
                          )
                        }
                        className="w-full flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm text-slate-700 dark:text-slate-300"
                      >
                        <span className="flex items-center gap-2">
                          <Columns size={16} /> Two-Page View
                        </span>
                        <div
                          className={`w-8 h-4 rounded-full relative transition-colors ${
                            viewMode === "double"
                              ? "bg-blue-500"
                              : "bg-slate-300"
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                              viewMode === "double" ? "translate-x-4" : ""
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
                            showAnnotations ? "bg-blue-500" : "bg-slate-300"
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                              showAnnotations ? "translate-x-4" : ""
                            }`}
                          ></div>
                        </div>
                      </button>
                      <button
                        onClick={handleBookmarkClick}
                        className="w-full flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm text-slate-700 dark:text-slate-300"
                      >
                        <span className="flex items-center gap-2">
                          <Bookmark size={16} /> Bookmark Page
                        </span>
                        <div
                          className={`w-8 h-4 rounded-full relative transition-colors ${
                            isBookmarked ? "bg-blue-500" : "bg-slate-300"
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                              isBookmarked ? "translate-x-4" : ""
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
                className={`toggle_ai_notes ${isToolsOpen ? "on" : "off"}`}
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
              className="more"
            >
              <MoreVertical size={20} />
            </button>
            {showSysMenu && (
              <div className="more_list">
                <button onClick={handleUploadClick} className="">
                  {isProcessing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <FileUp size={14} />
                  )}{" "}
                  Add Reference PDF
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="application/pdf"
                  onChange={handleFileChange}
                />

                <button onClick={saveProgress} className="">
                  <Save size={14} /> Save Progress
                </button>
                <div className="h-px bg-slate-100 dark:bg-slate-800 my-1"></div>
                <button onClick={handleExit} className="exit_viewer">
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
