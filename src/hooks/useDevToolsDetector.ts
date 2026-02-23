import { useEffect } from "react";

const DEV_API_HOST = "o2o-gwapi-devqa.campusbook.co.kr";

function isDevEnvironment(): boolean {
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;

  const params = new URLSearchParams(window.location.search);
  const apiBase =
    params.get("rmsApiBase") ||
    (window as any).__RMS_CONFIG__?.apiBase ||
    "";
  if (apiBase.includes(DEV_API_HOST)) return true;

  return false;
}

export function useDevToolsDetector() {
  useEffect(() => {
    if (isDevEnvironment()) return;

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
