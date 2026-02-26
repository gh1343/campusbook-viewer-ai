import React, { useState, useEffect, useRef, useCallback } from "react";
import { getPreviewConfig } from "../../utils/previewConfig";
import { useBook } from "../../contexts/BookContext";
import { useDrawing } from "../../contexts/DrawingContext";
import { usePdfViewer } from "../../contexts/PdfViewerContext";
import { useAnnotation } from "../../contexts/AnnotationContext";
import { getRmsConfig, checkViewerAlive, MultiAccessError } from "../../services/rmsService";
import {
  Book,
  Sidebar,
  PanelRight,
  Pen,
  Eraser,
  LogOut,
  CheckCircle2,
  Bookmark,
  CloudUpload,
  ZoomIn,
  ZoomOut,
  Save,
  X,
  Columns2,
  Square,
  AlertCircle,
  RefreshCw,
  Minus,
  Plus,
  Highlighter,
  HelpCircle,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { DrawingColor } from "../../../types";
import "../../css/header.css";
import { HelpModal } from "./HelpModal";
import { TIMERS } from "../../constants/config";

export const Header: React.FC<{
  toggleSidebar: () => void;
  isSidebarOpen?: boolean;
}> = ({ toggleSidebar, isSidebarOpen }) => {
  const { isPreview, isPreviewMode, isNewPaperLink } = getPreviewConfig();

  const {
    isToolsOpen,
    setToolsOpen,
    saveProgress,
  } = useBook();
  const {
    bookmarks,
    syncStatus: annotationSyncStatus,
    lastSavedAt,
    lastSaveSource,
    saveAnnotations,
    addPdfBookmark,
    removePdfBookmark,
    getDataFingerprint,
    getLastSavedFingerprint,
  } = useAnnotation();
  const {
    viewMode,
    setViewMode,
    currentPdfPage,
    zoomPdfIn,
    zoomPdfOut,
    pdfZoom,
    resetPdfZoom,
    pdfLoadProgress,
    pdfLoadTime,
    pdfIsLoading,
  } = usePdfViewer();
  const {
    drawingMode,
    setDrawingMode,
    penColor,
    setPenColor,
    penWidth,
    setPenWidth,
    penOpacity,
    setPenOpacity,
    syncStatus: drawingSyncStatus,
    saveDrawings,
  } = useDrawing();

  // 통합 syncStatus: 둘 중 하나라도 UNSAVED이면 UNSAVED, 둘 다 SYNCING이면 SYNCING
  const syncStatus =
    annotationSyncStatus === "SYNCING" || drawingSyncStatus === "SYNCING"
      ? "SYNCING"
      : annotationSyncStatus === "UNSAVED" || drawingSyncStatus === "UNSAVED"
      ? "UNSAVED"
      : annotationSyncStatus === "SERVER_ONLY" || drawingSyncStatus === "SERVER_ONLY"
      ? "SERVER_ONLY"
      : annotationSyncStatus === "LOCAL_ONLY" || drawingSyncStatus === "LOCAL_ONLY"
      ? "LOCAL_ONLY"
      : annotationSyncStatus === "BLOCKED" || drawingSyncStatus === "BLOCKED"
      ? "BLOCKED"
      : "SAVED";

  // 통합 저장 함수
  const handleSaveAll = async () => {
    if (isPreview) return;

    try {
      // 저장 전 뷰어 세션 유효성 확인 (온라인일 때만)
      if (navigator.onLine) {
        const config = getRmsConfig();
        if (config) {
          await checkViewerAlive({ apiBase: config.apiBase });
        }
      }

      // 1. 먼저 progress 저장 (BookContext)
      await saveProgress();
      // 2. 그 다음 annotations와 drawings 저장
      await Promise.all([
        saveAnnotations("manual"),
        saveDrawings(),
      ]);
    } catch (err) {
      if (err instanceof MultiAccessError) {
        alert("다른 기기에서 로그인되었거나, 일정 시간이 지나 로그아웃되었어요.\n다시 로그인해 주세요.");
        try { window.close(); } catch {}
        location.href = "/error/multiaccess";
        return;
      }
      console.error("Save failed:", err);
    }
  };

  // 자동저장 (3분 간격) - 변경 감지 후 저장
  const autosaveInProgressRef = useRef(false);
  const saveProgressRef = useRef(saveProgress);
  const saveAnnotationsRef = useRef(saveAnnotations);
  const saveDrawingsRef = useRef(saveDrawings);
  const getDataFingerprintRef = useRef(getDataFingerprint);
  const getLastSavedFingerprintRef = useRef(getLastSavedFingerprint);
  const syncStatusRef = useRef(syncStatus);

  useEffect(() => { saveProgressRef.current = saveProgress; }, [saveProgress]);
  useEffect(() => { saveAnnotationsRef.current = saveAnnotations; }, [saveAnnotations]);
  useEffect(() => { saveDrawingsRef.current = saveDrawings; }, [saveDrawings]);
  useEffect(() => { getDataFingerprintRef.current = getDataFingerprint; }, [getDataFingerprint]);
  useEffect(() => { getLastSavedFingerprintRef.current = getLastSavedFingerprint; }, [getLastSavedFingerprint]);
  useEffect(() => { syncStatusRef.current = syncStatus; }, [syncStatus]);

  // 중복 기기 체크 (30초 간격, 저장과 무관하게 독립 수행)
  useEffect(() => {
    if (isPreview) return;

    const ALIVE_CHECK_INTERVAL = TIMERS.ALIVE_CHECK_INTERVAL;

    const aliveIntervalId = setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const config = getRmsConfig();
        if (config) {
          await checkViewerAlive({ apiBase: config.apiBase });
        }
      } catch (err) {
        if (err instanceof MultiAccessError) {
          clearInterval(aliveIntervalId);
          alert("다른 기기에서 로그인되었거나, 일정 시간이 지나 로그아웃되었어요.\n다시 로그인해 주세요.");
          try { window.close(); } catch {}
          location.href = "/error/multiaccess";
          return;
        }
      }
    }, ALIVE_CHECK_INTERVAL);

    return () => clearInterval(aliveIntervalId);
  }, []);

  // 자동저장 (3분 간격)
  useEffect(() => {
    if (isPreview) return;

    const AUTOSAVE_INTERVAL = TIMERS.AUTOSAVE_INTERVAL;

    const intervalId = setInterval(async () => {
      if (autosaveInProgressRef.current) return;

      // SYNCING 중이면 스킵
      if (syncStatusRef.current === "SYNCING") return;

      // 현재 데이터와 마지막 저장 데이터 비교
      const currentFingerprint = getDataFingerprintRef.current();
      const lastFingerprint = getLastSavedFingerprintRef.current();
      if (lastFingerprint === currentFingerprint) {
        // 변경 없음 → 스킵
        return;
      }

      autosaveInProgressRef.current = true;
      try {
        await saveProgressRef.current();
        await Promise.all([
          saveAnnotationsRef.current("auto"),
          saveDrawingsRef.current(),
        ]);
      } catch (err) {
        console.error("Autosave failed:", err);
      } finally {
        autosaveInProgressRef.current = false;
      }
    }, AUTOSAVE_INTERVAL);

    return () => clearInterval(intervalId);
  }, []); // 의존성 없음 → interval이 한 번만 생성되고 3분마다 안정적으로 실행

  const navigate = useNavigate();
  const location = useLocation();
  const isReader = location.pathname === "/";

  const [showPenSettings, setShowPenSettings] = useState(false);
  const [isHelpOpen, setHelpOpen] = useState(false);

  const currentPageBookmark = bookmarks.find(
    (b) => b.page === currentPdfPage && !b.deleted
  );
  const isBookmarked = Boolean(currentPageBookmark);
  const colors: DrawingColor[] = [
    "#000000",
    "#ef4444",
    "#3b82f6",
    "#22c55e",
    "#eab308",
  ];

  const handleBookmarkClick = () => {
    if (!currentPdfPage) return;
    if (currentPageBookmark) {
      removePdfBookmark(currentPageBookmark.id);
    } else {
      addPdfBookmark(currentPdfPage, `p.${currentPdfPage}`);
    }
  };

  // 더블탭 줌 방지: 버튼 클릭 시 preventDefault
  const handleButtonClick =
    (callback: () => void) => (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      callback();
      // 터치 후 포커스 제거하여 :active 상태 제거
      (e.currentTarget as HTMLElement).blur();
    };

  return (
    <header className="header">
      {syncStatus === "SYNCING" && <div className="sync_progress_bar"></div>}
      {pdfIsLoading && (
        <div className="pdf_load_progress_bar">
          <div
            className="pdf_load_progress_fill"
            style={{ width: `${pdfLoadProgress}%` }}
          ></div>
        </div>
      )}

      <div className="header_inner">
        {/* 좌측: 로고 및 내비게이션 */}
        <div className="header_main">
          {isReader && (
            <button
              onClick={toggleSidebar}
              className={`left_toggle ${isSidebarOpen ? "open" : "off"}`}
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
              {/* <button
                onClick={handleButtonClick(zoomPdfOut)}
                onTouchEnd={handleButtonClick(zoomPdfOut)}
                className="hub_btn"
                title="축소"
              >
                <ZoomOut size={17} />
              </button> */}
              <button
                onClick={handleButtonClick(resetPdfZoom)}
                onTouchEnd={handleButtonClick(resetPdfZoom)}
                className="zoom_percent"
                title="기본 크기"
              >
                {Math.round(pdfZoom * 100)}%
              </button>
              {/* <button
                onClick={handleButtonClick(zoomPdfIn)}
                onTouchEnd={handleButtonClick(zoomPdfIn)}
                className="hub_btn"
                title="확대"
              >
                <ZoomIn size={17} />
              </button> */}
            </div>

            {/* 보기 모드 그룹 */}
            <div className="hub_group view_group">
              <button
                onClick={handleButtonClick(() => setViewMode("single"))}
                onTouchEnd={handleButtonClick(() => setViewMode("single"))}
                className={`hub_btn ${viewMode === "single" ? "active" : ""}`}
                title="1쪽 보기"
              >
                <Square size={17} />
              </button>
              <button
                onClick={handleButtonClick(() => setViewMode("double"))}
                onTouchEnd={handleButtonClick(() => setViewMode("double"))}
                className={`hub_btn ${viewMode === "double" ? "active" : ""}`}
                title="2쪽 보기"
              >
                <Columns2 size={17} />
              </button>
            </div>

            {/* 필기 도구 그룹 */}
            <div className="hub_group pen_group">
              <button
                onClick={handleButtonClick(() =>
                  setDrawingMode(drawingMode === "pen" ? "idle" : "pen")
                )}
                onTouchEnd={handleButtonClick(() =>
                  setDrawingMode(drawingMode === "pen" ? "idle" : "pen")
                )}
                className={`hub_btn ${
                  drawingMode === "pen" ? "active pen_active" : ""
                }`}
                title="펜"
              >
                <Pen size={17} />
              </button>
              <button
                onClick={handleButtonClick(() =>
                  setDrawingMode(drawingMode === "highlighter" ? "idle" : "highlighter")
                )}
                onTouchEnd={handleButtonClick(() =>
                  setDrawingMode(drawingMode === "highlighter" ? "idle" : "highlighter")
                )}
                className={`hub_btn ${
                  drawingMode === "highlighter" ? "active highlighter_active" : ""
                }`}
                title="형광펜"
              >
                <Highlighter size={17} />
              </button>
              <button
                onClick={handleButtonClick(() =>
                  setDrawingMode(drawingMode === "eraser" ? "idle" : "eraser")
                )}
                onTouchEnd={handleButtonClick(() =>
                  setDrawingMode(drawingMode === "eraser" ? "idle" : "eraser")
                )}
                className={`hub_btn ${
                  drawingMode === "eraser" ? "active eraser_active" : ""
                }`}
                title="지우개"
              >
                <Eraser size={17} />
              </button>
              <button
                onClick={handleButtonClick(() =>
                  setShowPenSettings(!showPenSettings)
                )}
                onTouchEnd={handleButtonClick(() =>
                  setShowPenSettings(!showPenSettings)
                )}
                className={`hub_btn pen_color_btn ${
                  showPenSettings ? "settings_open" : ""
                }`}
                title="펜 설정"
              >
                <div
                  className="color_circle"
                  style={{ backgroundColor: penColor }}
                ></div>
              </button>
            </div>

            {/* 북마크 */}
            <div className="hub_group bookmark_group">
              <button
                onClick={handleButtonClick(handleBookmarkClick)}
                onTouchEnd={handleButtonClick(handleBookmarkClick)}
                className={`hub_btn ${
                  isBookmarked ? "active bookmark_active" : ""
                }`}
                title="북마크"
              >
                <Bookmark
                  size={18}
                  fill={isBookmarked ? "currentColor" : "none"}
                />
              </button>
            </div>

            {showPenSettings && (
              <div className="pen_settings_panel">
                <div className="pen_settings_header">
                  <span className="pen_settings_title">
                    {drawingMode === "highlighter" ? "Highlighter Palette" : "Pen Palette"}
                  </span>
                  <button
                    onClick={() => setShowPenSettings(false)}
                    className="close_btn"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="color_palette">
                  {colors.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        setPenColor(c);
                      }}
                      className={`color_btn ${
                        penColor === c ? "selected" : ""
                      }`}
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
                    max={drawingMode === "highlighter" ? "60" : "15"}
                    value={penWidth}
                    onChange={(e) => setPenWidth(parseInt(e.target.value))}
                    className="width_slider"
                  />
                </div>
                <div className="pen_width_control">
                  <div className="control_label">
                    <span>투명도 설정</span>
                    <span>{Math.round(penOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={penOpacity}
                    onChange={(e) => setPenOpacity(parseFloat(e.target.value))}
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
              {!isPreview && <div className="save_status_wrap">
                {syncStatus === "UNSAVED" && (
                  <button
                    onClick={handleSaveAll}
                    className="save_btn unsaved"
                  >
                    <Save size={14} />
                    <span>저장 필요</span>
                  </button>
                )}
                {syncStatus === "SYNCING" && (
                  <div className="save_btn syncing">
                    <CloudUpload size={14} />
                    <span>동기화 중...</span>
                  </div>
                )}
                {syncStatus === "SAVED" && (
                  <button
                    onClick={handleSaveAll}
                    className="save_btn_group saved"
                  >
                    <div className="save_btn saved_btn">
                      <CheckCircle2 size={12} />
                      <span>{lastSaveSource === "auto" ? "자동 저장 완료" : "저장 완료"}</span>
                    </div>
                    {lastSavedAt && (
                      <span className="saved_time">
                        최근 저장: {lastSavedAt}
                      </span>
                    )}
                  </button>
                )}
                {syncStatus === "LOCAL_ONLY" && (
                  <button
                    onClick={handleSaveAll}
                    className="save_btn_group local_only"
                  >
                    <div className="save_btn local_btn">
                      <AlertCircle size={12} />
                      <span>로컬 저장됨</span>
                    </div>
                    <span className="retry_hint">
                      <RefreshCw size={8} />
                      클릭하여 재시도
                    </span>
                  </button>
                )}
                {syncStatus === "SERVER_ONLY" && (
                  <button
                    onClick={handleSaveAll}
                    className="save_btn_group server_only"
                  >
                    <div className="save_btn server_only_btn">
                      <AlertCircle size={12} />
                      <span>서버 저장됨 (기기 공간 부족)</span>
                    </div>
                    {lastSavedAt && (
                      <span className="saved_time">
                        최근 저장: {lastSavedAt}
                      </span>
                    )}
                  </button>
                )}
                {syncStatus === "BLOCKED" && (
                  <button onClick={handleSaveAll} className="save_btn blocked">
                    <X size={14} />
                    <span>동기화 차단됨</span>
                  </button>
                )}
              </div>}

              <button
                onClick={() => setHelpOpen(true)}
                className="guide_btn"
                title="이용 가이드"
              >
                <HelpCircle size={15} className="guide_btn_icon" />
                <span className="guide_btn_text">가이드</span>
              </button>

              <div className="separate_bar"></div>

              <button
                onClick={() => setToolsOpen(!isToolsOpen)}
                className={`toggle_ai_notes ${isToolsOpen ? "on" : "off"}`}
                title="학습 도구함"
              >
                <PanelRight size={22} />
              </button>
            </>
          )}
          {!isReader && (
            <button
              onClick={() => navigate("/")}
              className="exit_btn"
              title="나가기"
            >
              <LogOut size={22} />
            </button>
          )}
        </div>
      </div>
      <HelpModal isOpen={isHelpOpen} onClose={() => setHelpOpen(false)} />
    </header>
  );
};
