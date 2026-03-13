import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
} from "react";
import { DrawingColor, DrawingMode, Stroke, SyncStatus } from "../../types";
import { useAnnotation } from "./AnnotationContext";

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
  removeStrokes: (strokeIds: string[]) => void;
  hasStrokes: () => boolean;
  saveDrawings: () => Promise<void>;
}

const DrawingContext = createContext<DrawingContextType | undefined>(undefined);

// DrawingProvider는 이제 AnnotationContext를 래핑하는 중간 컴포넌트입니다
// AnnotationContext가 strokes 데이터를 관리합니다
const DrawingProviderInner: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const annotation = useAnnotation();
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("idle");
  const [penColor, setPenColor] = useState<DrawingColor>("#ef4444");
  const [penWidth, setPenWidth] = useState<number>(1);
  const [penOpacity, setPenOpacity] = useState<number>(1.0);

  // 형광펜 모드일 때 자동으로 투명도 적용
  useEffect(() => {
    if (drawingMode === "highlighter") {
      setPenOpacity(0.2);
      setPenWidth(10);
    } else if (drawingMode === "pen") {
      setPenOpacity(1.0);
      setPenWidth(1);
    }
  }, [drawingMode]);

  const hasStrokes = useCallback(
    () => annotation.strokes.some((s) => !s.deleted),
    [annotation.strokes]
  );

  const saveDrawings = useCallback(async () => {
    // AnnotationContext의 saveAnnotations를 호출하여 모든 데이터 저장
    await annotation.saveAnnotations();
  }, [annotation]);

  return (
    <DrawingContext.Provider
      value={{
        chapterStrokes: annotation.strokes,
        drawingMode,
        penColor,
        penWidth,
        penOpacity,
        syncStatus: annotation.syncStatus,
        setDrawingMode,
        setPenColor,
        setPenWidth,
        setPenOpacity,
        addStroke: annotation.addStroke,
        removeStroke: annotation.removeStroke,
        removeStrokes: annotation.removeStrokes,
        hasStrokes,
        saveDrawings,
      }}
    >
      {children}
    </DrawingContext.Provider>
  );
};

// 실제로 export하는 Provider는 AnnotationContext가 필요하므로 래핑
export const DrawingProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  return <DrawingProviderInner>{children}</DrawingProviderInner>;
};

export const useDrawing = (): DrawingContextType => {
  const context = useContext(DrawingContext);
  if (!context) {
    throw new Error("useDrawing must be used within DrawingProvider");
  }
  return context;
};
