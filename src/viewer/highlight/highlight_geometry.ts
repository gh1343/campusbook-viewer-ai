import { HighlightRect } from "../../components/viewer/pdfUtils";

export const mergeHighlightRects = (rects: HighlightRect[]) => {
  // 페이지별로만 합쳐서 사이드바 토글/리사이즈에도 상대 위치가 유지되도록 함
  const byPage = new Map<number, HighlightRect[]>();
  rects.forEach((r) => {
    const list = byPage.get(r.pageNumber) ?? [];
    list.push({ ...r });
    byPage.set(r.pageNumber, list);
  });

  const TOL = 1.5; // allow tiny overlap/adjacency without stacking opacity
  const mergedAll: HighlightRect[] = [];

  byPage.forEach((pageRects) => {
    const merged = pageRects;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < merged.length; i++) {
        for (let j = i + 1; j < merged.length; j++) {
          const a = merged[i];
          const b = merged[j];
          const horizontalOverlap =
            a.left <= b.left + b.width + TOL &&
            a.left + a.width >= b.left - TOL;
          const verticalOverlap =
            a.top <= b.top + b.height + TOL &&
            a.top + a.height >= b.top - TOL;
          if (horizontalOverlap && verticalOverlap) {
            const newLeft = Math.min(a.left, b.left);
            const newTop = Math.min(a.top, b.top);
            const right = Math.max(a.left + a.width, b.left + b.width);
            const bottom = Math.max(a.top + a.height, b.top + b.height);
            merged[i] = {
              ...a,
              left: newLeft,
              top: newTop,
              width: right - newLeft,
              height: bottom - newTop,
            };
            merged.splice(j, 1);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }
    mergedAll.push(...merged);
  });

  return mergedAll;
};

export const buildHighlightRectsFromSelection = (
  range: Range,
  pageEl: HTMLElement,
  visualScale: number
) => {
  // 미세 보정 값 (살짝 위로, 높이 축소)
  const TOP_OFFSET = 0.5;
  const HEIGHT_PAD = 1;

  const pageRect = pageEl.getBoundingClientRect();
  return Array.from(range.getClientRects()).map((r) => ({
    left: (r.left - pageRect.left) / visualScale,
    top:
      (r.top - pageRect.top) / visualScale -
      TOP_OFFSET / Math.max(visualScale, 0.0001),
    width: r.width / visualScale,
    height: Math.max(r.height / visualScale - HEIGHT_PAD, 1),
    pageNumber: Number(pageEl.dataset.pageNumber),
    pageWidth: pageRect.width / visualScale,
    pageHeight: pageRect.height / visualScale,
  }));
};
