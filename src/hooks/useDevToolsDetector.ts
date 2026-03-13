import { useEffect } from "react";

const DEV_API_HOST = "o2o-gwapi-devqa.campusbook.co.kr";

function isDevEnvironment(): boolean {
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;

  const params = new URLSearchParams(window.location.search);
  const apiBase =
    params.get("rmsApiBase") || (window as any).__RMS_CONFIG__?.apiBase || "";
  if (apiBase.includes(DEV_API_HOST)) return true;

  return false;
}

export function useDevToolsDetector() {
  // Screenshot warning overlay (runs in ALL environments)
  useEffect(() => {
    let screenshotOverlay: HTMLDivElement | null = null;
    let screenshotTimer: ReturnType<typeof setTimeout> | null = null;

    const showCopyWarning = () => {
      if (screenshotOverlay) {
        screenshotOverlay.remove();
        screenshotOverlay = null;
      }
      if (screenshotTimer) {
        clearTimeout(screenshotTimer);
        screenshotTimer = null;
      }

      const overlay = document.createElement("div");
      overlay.className = "copy-warning-overlay";
      overlay.innerHTML =
        '<span class="copy-warning-text">뷰어 내 캡처 기능을 이용해 주세요.<br>마이노트 &gt; 캡처 이미지 첨부에서 사용할 수 있습니다.</span>';
      document.body.appendChild(overlay);
      screenshotOverlay = overlay;

      requestAnimationFrame(() => {
        overlay.classList.add("visible");
      });

      screenshotTimer = setTimeout(() => {
        overlay.classList.remove("visible");
        overlay.classList.add("hiding");
        setTimeout(() => {
          overlay.remove();
          if (screenshotOverlay === overlay) {
            screenshotOverlay = null;
          }
        }, 500);
      }, 3000);
    };

    // PrintScreen 감지 (keydown + keyup 둘 다 — OS에 따라 하나만 발생할 수 있음)
    const detectPrintScreen = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        showCopyWarning();
      }
    };
    document.addEventListener("keydown", detectPrintScreen, true);
    document.addEventListener("keyup", detectPrintScreen, true);

    // Win+Shift+S 감지: OS가 키 이벤트를 가로채므로,
    // Win+Shift가 동시에 눌린 직후 blur(=캡처 도구 열림)가 발생하면 감지
    // 키 순서에 관계없이 동작 (Win→Shift 또는 Shift→Win 모두)
    let metaHeld = false;
    let shiftHeld = false;
    let metaShiftTime = 0;

    const trackKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "OS") metaHeld = true;
      if (e.key === "Shift") shiftHeld = true;
      // Win+Shift 동시 누름 감지 → 즉시 경고 표시
      if (metaHeld && shiftHeld) {
        showCopyWarning();
      }
    };
    const trackKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "OS") metaHeld = false;
      if (e.key === "Shift") shiftHeld = false;
    };
    const handleWindowBlur = () => {
      metaHeld = false;
      shiftHeld = false;
    };

    document.addEventListener("keydown", trackKeyDown, true);
    document.addEventListener("keyup", trackKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("keydown", detectPrintScreen, true);
      document.removeEventListener("keyup", detectPrintScreen, true);
      document.removeEventListener("keydown", trackKeyDown, true);
      document.removeEventListener("keyup", trackKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
      if (screenshotOverlay) screenshotOverlay.remove();
      if (screenshotTimer) clearTimeout(screenshotTimer);
    };
  }, []);

  // DevTools detection (production only)
  useEffect(() => {
    if (isDevEnvironment()) return;

    const THRESHOLD_MS = 100;
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

    intervalId = setInterval(checkDebuggerTiming, 1000);

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
