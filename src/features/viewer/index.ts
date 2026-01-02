export { askAiAction } from "./actions/pdf_viewer_ui_actions";

export { ContentRenderer } from "./components/ContentRenderer";
export { ControlBar } from "./components/ControlBar";
export { PdfSelectionMenu } from "./components/PdfSelectionMenu";
export { PdfViewerOverlay } from "./components/PdfViewerOverlay";
export { PdfViewer } from "./components/PdfViewer";

export { usePdfJsViewer } from "./hooks/usePdfJsViewer";
export { usePdfPenLayer } from "./hooks/usePdfPenLayer";
export { usePdfViewerUiState } from "./hooks/usePdfViewerUiState";

export { buildHighlightRectsFromSelection, mergeHighlightRects } from "./highlight/highlight_geometry";

export { applySearchHighlightWithRetry } from "./pdfjs/pdf_search_highlight_dom";
export { extractPdfText } from "./pdfjs/pdf_text_extract";
export { initPdfJsRuntime } from "./pdfjs/pdfjs_runtime";

export { createPenLayerRuntime } from "./pen/pen_layer_runtime";
