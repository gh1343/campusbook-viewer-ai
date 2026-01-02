import React from "react";

type CopyStatus = "" | "ok" | "fail";

interface PdfSelectionMenuProps {
  visible: boolean;
  top: number;
  left: number;
  copyStatus: CopyStatus;
  onHighlight: () => void;
  onCopy: () => void;
  onAskAi: () => void;
  onCancel: () => void;
}

export const PdfSelectionMenu: React.FC<PdfSelectionMenuProps> = ({
  visible,
  top,
  left,
  copyStatus,
  onHighlight,
  onCopy,
  onAskAi,
  onCancel,
}) => {
  if (!visible) return null;

  return (
    <div className="pdf_selection_menu" style={{ top, left }}>
      {(copyStatus === "ok" || copyStatus === "fail") && (
        <span
          className={`pdf_selection_menu_copy_status ${
            copyStatus === "ok"
              ? "pdf_viewer_copy_status_ok"
              : "pdf_viewer_copy_status_fail"
          }`}
        >
          {copyStatus === "ok" ? "복사됨" : "선택 없음"}
        </span>
      )}
      <button onClick={onHighlight}>Highlight</button>
      <div className="pdf_selection_menu_copy_block">
        <button onClick={onCopy}>Copy</button>
      </div>
      <button onClick={onAskAi}>AI</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
};
