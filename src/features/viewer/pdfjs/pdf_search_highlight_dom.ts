const isTextLayerReady = (layer: Element) => {
  const spans = Array.from(layer.querySelectorAll("span"));
  if (spans.length === 0) return false;
  return spans.some((s) => {
    const el = s as HTMLElement;
    return (
      el.style.left !== "" || el.style.top !== "" || el.style.transform !== ""
    );
  });
};

const clearPrevHighlights = (root: HTMLElement | null) => {
  root
    ?.querySelectorAll('.textLayer span[role="presentation"]')
    .forEach((span) => {
      const el = span as HTMLElement & { dataset: { origText?: string } };
      if (el.dataset.origText !== undefined) {
        el.textContent = el.dataset.origText;
        delete el.dataset.origText;
      }
    });
};

interface ApplySearchHighlightParams {
  viewerRoot: HTMLElement | null;
  pdfSearchHighlight: { page: number; term: string } | null;
  getVisualScale: () => number;
  onScrollToFirstHit: (pageEl: HTMLElement) => void;
}

export const applySearchHighlightWithRetry = ({
  viewerRoot,
  pdfSearchHighlight,
  getVisualScale,
  onScrollToFirstHit,
}: ApplySearchHighlightParams) => {
  if (!viewerRoot) return () => {};

  clearPrevHighlights(viewerRoot);
  if (!pdfSearchHighlight) return () => {};

  let cancelled = false;
  let retryTimer: number | null = null;
  let attempts = 0;
  const MAX_ATTEMPTS = 10;

  const applyHighlight = () => {
    const pageEl = viewerRoot.querySelector<HTMLElement>(
      `.page[data-page-number="${pdfSearchHighlight.page}"]`
    );
    const textLayer = pageEl?.querySelector(".textLayer");
    if (!textLayer || !isTextLayerReady(textLayer)) return false;

    const term = pdfSearchHighlight.term.trim();
    if (!term) return false;
    const re = new RegExp(term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"), "gi");
    textLayer
      .querySelectorAll('span[role="presentation"]')
      .forEach((span) => {
        const el = span as HTMLElement & { dataset: { origText?: string } };
        const content = el.textContent || "";
        const replaced = content.replace(
          re,
          (m) => `<span class="pdf_search_hit">${m}</span>`
        );
        if (replaced !== content) {
          if (el.dataset.origText === undefined) {
            el.dataset.origText = content;
          }
          el.innerHTML = replaced;
        }
      });

    if (pageEl) {
      requestAnimationFrame(() => onScrollToFirstHit(pageEl));
    }

    return true;
  };

  const tryApply = () => {
    if (cancelled) return;
    if (applyHighlight()) return;
    if (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      retryTimer = window.setTimeout(tryApply, 150);
    }
  };

  tryApply();

  return () => {
    cancelled = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
    }
    clearPrevHighlights(viewerRoot);
  };
};
