import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ViewMode } from "../../types";

interface PdfViewerContextType {
  currentPdfPage: number;
  pdfTotalPages: number;
  pdfLoadProgress: number;
  pdfLoadTime: number;
  pdfIsLoading: boolean;
  pdfZoom: number;
  pdfSearchHighlight: { page: number; term: string } | null;
  pdfTextPages: { page: number; text: string }[];
  viewMode: ViewMode;
  goToPdfPage: (page: number) => void;
  registerPdfNavigator: (fn: (page: number) => void) => void;
  registerPdfZoomHandler: (fn: (direction: "in" | "out") => void) => void;
  zoomPdfIn: () => void;
  zoomPdfOut: () => void;
  resetPdfZoom: () => void;
  setPdfZoom: (zoom: number) => void;
  setPdfSearchHighlight: (value: { page: number; term: string } | null) => void;
  setPdfTextPages: (pages: { page: number; text: string }[]) => void;
  setViewMode: (mode: ViewMode) => void;
  setCurrentPdfPage: (page: number) => void;
  setPdfTotalPages: (total: number) => void;
  setPdfLoadProgress: (progress: number) => void;
  setPdfLoadTime: (time: number) => void;
  setPdfIsLoading: (isLoading: boolean) => void;
  setInitialPageToLoad: (page: number | null) => void;
}

const PdfViewerContext = createContext<PdfViewerContextType | undefined>(
  undefined
);

export const PdfViewerProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [pdfTextPages, setPdfTextPages] = useState<
    { page: number; text: string }[]
  >([]);
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfLoadProgress, setPdfLoadProgress] = useState(0);
  const [pdfLoadTime, setPdfLoadTime] = useState(0);
  const [pdfIsLoading, setPdfIsLoading] = useState(false);
  const [pdfNavigator, setPdfNavigator] = useState<((page: number) => void) | null>(
    null
  );
  const [pdfZoomHandler, setPdfZoomHandler] = useState<
    ((direction: "in" | "out") => void) | null
  >(null);
  const [pdfZoom, setPdfZoom] = useState(1.0);
  const [pendingPdfPage, setPendingPdfPage] = useState<number | null>(null);
  const [initialPageToLoad, setInitialPageToLoad] = useState<number | null>(
    null
  );
  const [pdfSearchHighlight, setPdfSearchHighlight] = useState<{
    page: number;
    term: string;
  } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("single");

  const pendingPdfPageRef = useRef<number | null>(null);
  const pdfTotalPagesRef = useRef<number>(0);

  const goToPdfPage = useCallback(
    (page: number) => {
      const safePage = Number.isFinite(page) ? Math.max(1, Math.round(page)) : 1;
      setCurrentPdfPage(safePage);
      if (pdfNavigator) {
        pdfNavigator(safePage);
      } else {
        pendingPdfPageRef.current = safePage;
        setPendingPdfPage(safePage);
      }
    },
    [pdfNavigator]
  );

  const registerPdfNavigator = useCallback((fn: (page: number) => void) => {
    const pending = pendingPdfPageRef.current;
    const totalPages = pdfTotalPagesRef.current;
    setPdfNavigator(() => fn);
    if (pending !== null && totalPages > 0) {
      fn(pending);
      pendingPdfPageRef.current = null;
      setPendingPdfPage(null);
    }
  }, []);

  const registerPdfZoomHandler = useCallback(
    (fn: (direction: "in" | "out") => void) => {
      setPdfZoomHandler(() => fn);
    },
    []
  );

  const zoomPdfIn = useCallback(() => {
    if (pdfZoomHandler) {
      pdfZoomHandler("in");
    }
    setPdfZoom((prev) => Math.min(3, prev + 0.1));
  }, [pdfZoomHandler]);

  const zoomPdfOut = useCallback(() => {
    if (pdfZoomHandler) {
      pdfZoomHandler("out");
    }
    setPdfZoom((prev) => Math.max(1.0, prev - 0.1));
  }, [pdfZoomHandler]);

  const resetPdfZoom = useCallback(() => {
    setPdfZoom(1.0);
  }, []);

  useEffect(() => {
    pdfTotalPagesRef.current = pdfTotalPages;
  }, [pdfTotalPages]);

  useEffect(() => {
    if (pdfTotalPages > 0 && initialPageToLoad !== null && pdfNavigator) {
      const pageToLoad = Math.max(1, Math.min(initialPageToLoad, pdfTotalPages));
      pdfNavigator(pageToLoad);
      setCurrentPdfPage(pageToLoad);
      setInitialPageToLoad(null);
    }
  }, [pdfTotalPages, initialPageToLoad, pdfNavigator]);

  useEffect(() => {
    if (
      pdfTotalPages > 0 &&
      pendingPdfPageRef.current !== null &&
      pdfNavigator
    ) {
      const targetPage = pendingPdfPageRef.current;
      pdfNavigator(targetPage);
      pendingPdfPageRef.current = null;
      setPendingPdfPage(null);
    }
  }, [pdfTotalPages, pdfNavigator]);

  return (
    <PdfViewerContext.Provider
      value={{
        currentPdfPage,
        pdfTotalPages,
        pdfLoadProgress,
        pdfLoadTime,
        pdfIsLoading,
        pdfZoom,
        pdfSearchHighlight,
        pdfTextPages,
        viewMode,
        goToPdfPage,
        registerPdfNavigator,
        registerPdfZoomHandler,
        zoomPdfIn,
        zoomPdfOut,
        resetPdfZoom,
        setPdfZoom,
        setPdfSearchHighlight,
        setPdfTextPages,
        setViewMode,
        setCurrentPdfPage,
        setPdfTotalPages,
        setPdfLoadProgress,
        setPdfLoadTime,
        setPdfIsLoading,
        setInitialPageToLoad,
      }}
    >
      {children}
    </PdfViewerContext.Provider>
  );
};

export const usePdfViewer = (): PdfViewerContextType => {
  const context = useContext(PdfViewerContext);
  if (!context) {
    throw new Error("usePdfViewer must be used within PdfViewerProvider");
  }
  return context;
};
