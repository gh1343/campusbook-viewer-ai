import React from "react";

interface PdfViewerOverlayProps {
  loading: boolean;
  errorMsg: string | null;
  progress: number;
}

export const PdfViewerOverlay: React.FC<PdfViewerOverlayProps> = ({
  loading,
  errorMsg,
  progress,
}) => {
  if (!loading && !errorMsg) return null;

  const displayProgress = Math.min(
    100,
    Math.max(1, Math.round(progress || 0))
  );

  return (
    <>
      {loading && (
        <div className="pdf_viewer_overlay pdf_viewer_overlay_loading">
          <div className="pdf_viewer_progress">
            <div className="pdf_viewer_progress_title">PDF 로딩 중...</div>
            <div className="pdf_viewer_progress_bar">
              <div
                className="pdf_viewer_progress_bar_fill"
                style={{ width: `${displayProgress}%` }}
              />
            </div>
            <div className="pdf_viewer_progress_percent">
              {displayProgress}%
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="pdf_viewer_overlay pdf_viewer_overlay_error">
          <div className="pdf_viewer_error">
            <div className="pdf_viewer_error_title">PDF 로드 오류</div>
            <div>{errorMsg}</div>
          </div>
        </div>
      )}
    </>
  );
};
