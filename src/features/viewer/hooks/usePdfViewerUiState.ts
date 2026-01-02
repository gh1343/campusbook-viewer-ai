import { useState } from "react";

export type CopyStatus = "" | "ok" | "fail";

export type SelectionState = {
  text: string;
  top: number;
  left: number;
  show: boolean;
};

export const usePdfViewerUiState = () => {
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("");
  const [selection, setSelection] = useState<SelectionState>({
    text: "",
    top: 0,
    left: 0,
    show: false,
  });
  const [layoutTick, setLayoutTick] = useState(0);

  return {
    loading,
    setLoading,
    loadProgress,
    setLoadProgress,
    errorMsg,
    setErrorMsg,
    copyStatus,
    setCopyStatus,
    selection,
    setSelection,
    layoutTick,
    setLayoutTick,
  };
};
