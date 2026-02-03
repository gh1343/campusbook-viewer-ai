import React, { useState } from 'react';
import { useBook } from '../../contexts/BookContext';
import {
  Book, Sidebar, PanelRight, Pen, Eraser, LogOut, CheckCircle2,
  Bookmark, CloudUpload, ZoomIn, ZoomOut, Save, X,
  Columns2, Square, AlertCircle, RefreshCw, Minus, Plus
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DrawingColor } from '../../../types';
import '../../css/header.css';

export const Header: React.FC<{ toggleSidebar: () => void; isSidebarOpen?: boolean; }> = ({ toggleSidebar, isSidebarOpen }) => {
  const {
    drawingMode, setDrawingMode,
    penColor, setPenColor, penWidth, setPenWidth,
    viewMode, setViewMode,
    isToolsOpen, setToolsOpen, bookmarks, currentPdfPage,
    syncStatus, lastSavedAt, saveAll,
    addPdfBookmark, removePdfBookmark,
    zoomPdfIn, zoomPdfOut, pdfZoom, resetPdfZoom,
    pdfLoadProgress, pdfLoadTime, pdfIsLoading
  } = useBook();

  const navigate = useNavigate();
  const location = useLocation();
  const isReader = location.pathname === '/';

  const [showPenSettings, setShowPenSettings] = useState(false);

  const currentPageBookmark = bookmarks.find(b => b.page === currentPdfPage);
  const isBookmarked = Boolean(currentPageBookmark);
  const colors: DrawingColor[] = ['#000000', '#ef4444', '#3b82f6', '#22c55e', '#eab308'];

  const handleBookmarkClick = () => {
    if (!currentPdfPage) return;
    if (currentPageBookmark) {
      removePdfBookmark(currentPageBookmark.id);
    } else {
      addPdfBookmark(currentPdfPage, `p.${currentPdfPage}`);
    }
  };

  // 더블탭 줌 방지: 버튼 클릭 시 preventDefault
  const handleButtonClick = (callback: () => void) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    callback();
  };

  return (
    <header className="header">
      {syncStatus === 'SYNCING' && <div className="sync_progress_bar"></div>}
      {pdfIsLoading && (
        <div className="pdf_load_progress_bar">
          <div className="pdf_load_progress_fill" style={{ width: `${pdfLoadProgress}%` }}></div>
        </div>
      )}

      <div className="header_inner">
        {/* 좌측: 로고 및 내비게이션 */}
        <div className="header_main">
          {isReader && (
            <button
              onClick={toggleSidebar}
              className={`left_toggle ${isSidebarOpen ? 'open' : 'off'}`}
              title="콘텐츠 목록"
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
          {pdfIsLoading && (
            <div className="pdf_load_status">
              <span className="load_percent">{pdfLoadProgress}%</span>
              <span className="load_time">{pdfLoadTime.toFixed(1)}초</span>
            </div>
          )}
        </div>

        {/* 중앙: 통합 인터랙션 허브 */}
        {isReader && (
          <div className="center_hub">
            {/* 확대/축소 그룹 */}
            <div className="hub_group zoom_group">
              <button
                onClick={handleButtonClick(zoomPdfOut)}
                onTouchEnd={handleButtonClick(zoomPdfOut)}
                className="hub_btn"
                title="축소"
              >
                <ZoomOut size={17} />
              </button>
              <button
                onClick={handleButtonClick(resetPdfZoom)}
                onTouchEnd={handleButtonClick(resetPdfZoom)}
                className="zoom_percent"
                title="기본 크기"
              >
                {Math.round(pdfZoom * 100)}%
              </button>
              <button
                onClick={handleButtonClick(zoomPdfIn)}
                onTouchEnd={handleButtonClick(zoomPdfIn)}
                className="hub_btn"
                title="확대"
              >
                <ZoomIn size={17} />
              </button>
            </div>

            {/* 보기 모드 그룹 */}
            <div className="hub_group view_group">
              <button
                onClick={handleButtonClick(() => setViewMode('single'))}
                onTouchEnd={handleButtonClick(() => setViewMode('single'))}
                className={`hub_btn ${viewMode === 'single' ? 'active' : ''}`}
                title="1쪽 보기"
              >
                <Square size={17} />
              </button>
              <button
                onClick={handleButtonClick(() => setViewMode('double'))}
                onTouchEnd={handleButtonClick(() => setViewMode('double'))}
                className={`hub_btn ${viewMode === 'double' ? 'active' : ''}`}
                title="2쪽 보기"
              >
                <Columns2 size={17} />
              </button>
            </div>

            {/* 필기 도구 그룹 */}
            <div className="hub_group pen_group">
              <button
                onClick={handleButtonClick(() => setDrawingMode(drawingMode === 'pen' ? 'idle' : 'pen'))}
                onTouchEnd={handleButtonClick(() => setDrawingMode(drawingMode === 'pen' ? 'idle' : 'pen'))}
                className={`hub_btn ${drawingMode === 'pen' ? 'active pen_active' : ''}`}
                title="펜"
              >
                <Pen size={17} />
              </button>
              <button
                onClick={handleButtonClick(() => setDrawingMode(drawingMode === 'eraser' ? 'idle' : 'eraser'))}
                onTouchEnd={handleButtonClick(() => setDrawingMode(drawingMode === 'eraser' ? 'idle' : 'eraser'))}
                className={`hub_btn ${drawingMode === 'eraser' ? 'active eraser_active' : ''}`}
                title="지우개"
              >
                <Eraser size={17} />
              </button>
              <button
                onClick={handleButtonClick(() => setShowPenSettings(!showPenSettings))}
                onTouchEnd={handleButtonClick(() => setShowPenSettings(!showPenSettings))}
                className={`hub_btn pen_color_btn ${showPenSettings ? 'settings_open' : ''}`}
                title="펜 설정"
              >
                <div className="color_circle" style={{ backgroundColor: penColor }}></div>
              </button>
            </div>

            {/* 북마크 */}
            <div className="hub_group bookmark_group">
              <button
                onClick={handleButtonClick(handleBookmarkClick)}
                onTouchEnd={handleButtonClick(handleBookmarkClick)}
                className={`hub_btn ${isBookmarked ? 'active bookmark_active' : ''}`}
                title="북마크"
              >
                <Bookmark size={18} fill={isBookmarked ? "currentColor" : "none"} />
              </button>
            </div>

            {showPenSettings && (
              <div className="pen_settings_panel">
                <div className="pen_settings_header">
                  <span className="pen_settings_title">Pen Palette</span>
                  <button onClick={() => setShowPenSettings(false)} className="close_btn">
                    <X size={16} />
                  </button>
                </div>
                <div className="color_palette">
                  {colors.map(c => (
                    <button
                      key={c}
                      onClick={() => { setPenColor(c); setDrawingMode('pen'); }}
                      className={`color_btn ${penColor === c ? 'selected' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="pen_width_control">
                  <div className="control_label">
                    <span>두께 설정</span>
                    <span>{penWidth}px</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="15"
                    value={penWidth}
                    onChange={e => setPenWidth(parseInt(e.target.value))}
                    className="width_slider"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 우측: 상태 및 도구함 */}
        <div className="header_tools">
          {isReader && (
            <>
              {/* 저장 상태 인터페이스 */}
              <div className="save_status_wrap">
                {syncStatus === 'UNSAVED' && (
                  <button onClick={saveAll} className="save_btn unsaved">
                    <Save size={14} />
                    <span>저장 필요</span>
                  </button>
                )}
                {syncStatus === 'SYNCING' && (
                  <div className="save_btn syncing">
                    <CloudUpload size={14} />
                    <span>동기화 중...</span>
                  </div>
                )}
                {syncStatus === 'SAVED' && (
                  <button onClick={saveAll} className="save_btn_group saved">
                    <div className="save_btn saved_btn">
                      <CheckCircle2 size={12} />
                      <span>저장 완료</span>
                    </div>
                    {lastSavedAt && <span className="saved_time">최근 저장: {lastSavedAt}</span>}
                  </button>
                )}
                {syncStatus === 'LOCAL_ONLY' && (
                  <button onClick={saveAll} className="save_btn_group local_only">
                    <div className="save_btn local_btn">
                      <AlertCircle size={12} />
                      <span>로컬 저장됨</span>
                    </div>
                    <span className="retry_hint">
                      <RefreshCw size={8}/>
                      클릭하여 재시도
                    </span>
                  </button>
                )}
                {syncStatus === 'BLOCKED' && (
                  <button onClick={saveAll} className="save_btn blocked">
                    <X size={14} />
                    <span>동기화 차단됨</span>
                  </button>
                )}
              </div>

              <div className="separate_bar"></div>

              <button
                onClick={() => setToolsOpen(!isToolsOpen)}
                className={`toggle_ai_notes ${isToolsOpen ? 'on' : 'off'}`}
                title="학습 도구함"
              >
                <PanelRight size={22} />
              </button>
            </>
          )}
          {!isReader && (
            <button onClick={() => navigate('/')} className="exit_btn" title="나가기">
              <LogOut size={22} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
