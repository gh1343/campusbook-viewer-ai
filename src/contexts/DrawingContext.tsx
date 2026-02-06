import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { DrawingColor, DrawingMode, Stroke, SyncStatus } from "../../types";

interface DrawingContextType {
  chapterStrokes: Stroke[];
  drawingMode: DrawingMode;
  penColor: DrawingColor;
  penWidth: number;
  penOpacity: number;
  syncStatus: SyncStatus;
  setDrawingMode: (mode: DrawingMode) => void;
  setPenColor: (color: DrawingColor) => void;
  setPenWidth: (width: number) => void;
  setPenOpacity: (opacity: number) => void;
  addStroke: (stroke: Stroke) => void;
  removeStroke: (strokeId: string) => void;
  hasStrokes: () => boolean;
  saveDrawings: () => Promise<void>;
}

const DrawingContext = createContext<DrawingContextType | undefined>(undefined);
const DRAWING_STORAGE_KEY = "campusbook_drawing_strokes";

export const DrawingProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [chapterStrokes, setChapterStrokes] = useState<Stroke[]>([]);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("idle");
  const [penColor, setPenColor] = useState<DrawingColor>("#ef4444");
  const [penWidth, setPenWidth] = useState<number>(3);
  const [penOpacity, setPenOpacity] = useState<number>(1.0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("SAVED");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(DRAWING_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setChapterStrokes(parsed as Stroke[]);
      }
    } catch (err) {
      console.error("Failed to load local drawings", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      DRAWING_STORAGE_KEY,
      JSON.stringify(chapterStrokes)
    );
  }, [chapterStrokes]);

  const addStroke = useCallback((stroke: Stroke) => {
    setChapterStrokes((prev) => [...prev, stroke]);
    setSyncStatus("UNSAVED");
  }, []);

  const removeStroke = useCallback((strokeId: string) => {
    setChapterStrokes((prev) =>
      prev.map((s) => (s.id === strokeId ? { ...s, deleted: true } : s))
    );
    setSyncStatus("UNSAVED");
  }, []);

  const hasStrokes = useCallback(
    () => chapterStrokes.some((s) => !s.deleted),
    [chapterStrokes]
  );

  const saveDrawings = useCallback(async () => {
    setSyncStatus("SYNCING");
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          DRAWING_STORAGE_KEY,
          JSON.stringify(chapterStrokes)
        );
      }
      setSyncStatus("SAVED");
    } catch (err) {
      setSyncStatus("LOCAL_ONLY");
    }
  }, [chapterStrokes]);

  return (
    <DrawingContext.Provider
      value={{
        chapterStrokes,
        drawingMode,
        penColor,
        penWidth,
        penOpacity,
        syncStatus,
        setDrawingMode,
        setPenColor,
        setPenWidth,
        setPenOpacity,
        addStroke,
        removeStroke,
        hasStrokes,
        saveDrawings,
      }}
    >
      {children}
    </DrawingContext.Provider>
  );
};

export const useDrawing = (): DrawingContextType => {
  const context = useContext(DrawingContext);
  if (!context) {
    throw new Error("useDrawing must be used within DrawingProvider");
  }
  return context;
};
