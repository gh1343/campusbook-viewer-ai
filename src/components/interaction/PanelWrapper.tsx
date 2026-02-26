import React from "react";
import { X } from "lucide-react";

export interface PanelProps {
  isOpen: boolean;
  onClose: () => void;
  side: "left" | "right";
  title?: string;
  children: React.ReactNode;
}

// Helper component to highlight matching text
export const HighlightMatch = ({ text, query }: { text: string; query: string }) => {
  if (!query || !query.trim()) return <>{text}</>;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-yellow-300 text-slate-900 rounded-[2px] px-0.5 font-medium"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
};

export const PanelWrapper: React.FC<PanelProps> = ({
  isOpen,
  onClose,
  side,
  title,
  children,
}) => {
  return (
    <>
      <div
        className={`panel_overlay ${isOpen ? "open" : "closed"}`}
        onClick={onClose}
      />
      <aside className={`panel_aside ${side} ${isOpen ? "open" : "closed"}`}>
        <div className="panel_wrapper">
          <div className="panel_header">
            <h2 className="panel_title">{title}</h2>
            <button onClick={onClose} className="panel_close_btn">
              <X size={18} />
            </button>
          </div>
          <div className="panel_content no-scrollbar">{children}</div>
        </div>
      </aside>
    </>
  );
};
