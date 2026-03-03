import React, { useRef, useEffect } from "react";
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
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - startY;

      // 미세한 움직임(탭/펜 터치)에는 반응하지 않음 - click 이벤트 보호
      if (Math.abs(dy) < 5) return;

      // 터치 타겟에서 스크롤 가능한 부모 탐색
      let node: HTMLElement | null = e.target as HTMLElement;
      while (node && node !== el) {
        const oy = window.getComputedStyle(node).overflowY;
        if (oy === "scroll" || oy === "auto") {
          const atTop = node.scrollTop <= 0;
          const atBottom =
            node.scrollTop >= node.scrollHeight - node.clientHeight - 1;
          // 스크롤 경계에서만 뷰포트 전파 차단
          if ((dy > 0 && atTop) || (dy < 0 && atBottom)) {
            e.preventDefault();
          }
          return;
        }
        node = node.parentElement;
      }
      // 스크롤 불가 영역: 뷰포트 rubber-band 차단
      e.preventDefault();
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  return (
    <>
      <div
        className={`panel_overlay ${isOpen ? "open" : "closed"}`}
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className={`panel_aside ${side} ${isOpen ? "open" : "closed"}`}
      >
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
