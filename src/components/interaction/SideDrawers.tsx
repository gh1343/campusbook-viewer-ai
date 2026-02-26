// Re-export for backward compatibility
// Original components have been split into separate files:
// - PanelWrapper.tsx: PanelProps, HighlightMatch, PanelWrapper (shared)
// - TocPanel.tsx: TocPanel component
// - ToolsPanel.tsx: ToolsPanel component
import "../../css/side_drawers.css";

export { TocPanel } from "./TocPanel";
export { ToolsPanel } from "./ToolsPanel";
