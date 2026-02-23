import { useEffect } from "react";

export function useDevToolsDetector() {
  useEffect(() => {
    const THRESHOLD_MS = 100;
    const SIZE_THRESHOLD = 300;
    let intervalId: ReturnType<typeof setInterval>;

    const handleDetected = () => {
      window.location.replace("https://www.google.com");
    };

    const checkDebuggerTiming = () => {
      const start = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      const end = performance.now();
      if (end - start > THRESHOLD_MS) {
        handleDetected();
      }
    };

    const checkWindowSize = () => {
      const widthDiff = window.outerWidth - window.innerWidth;
      const heightDiff = window.outerHeight - window.innerHeight;
      if (widthDiff > SIZE_THRESHOLD || heightDiff > SIZE_THRESHOLD) {
        handleDetected();
      }
    };

    const check = () => {
      // checkWindowSize();
      checkDebuggerTiming();
    };

    intervalId = setInterval(check, 1000);

    const preventContext = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", preventContext);

    const preventShortcuts = (e: KeyboardEvent) => {
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i")) ||
        (e.ctrlKey && e.shiftKey && (e.key === "J" || e.key === "j")) ||
        (e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c")) ||
        (e.ctrlKey && (e.key === "U" || e.key === "u"))
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", preventShortcuts, true);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("contextmenu", preventContext);
      document.removeEventListener("keydown", preventShortcuts, true);
    };
  }, []);
}
