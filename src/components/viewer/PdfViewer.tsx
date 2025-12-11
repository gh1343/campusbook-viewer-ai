// src/components/viewer/PdfViewer.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  GlobalWorkerOptions,
  getDocument,
  version as pdfjsVersion,
} from "pdfjs-dist";
import {
  PDFViewer,
  EventBus,
  PDFLinkService,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import "../../css/pdf_viewer.css";
// ✅ worker 설정 (v4 ESM)
GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.mjs`;

interface PdfViewerProps {
  file: string; // 일단 string URL 기준으로만 사용
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ file }) => {
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"" | "ok" | "fail">("");
  const copyResetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!viewerContainerRef.current || !viewerRef.current) return;

    setLoading(true); // 새 파일 로드 시작
    setErrorMsg(null); // 이전 에러 메시지 초기화

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });

    const pdfViewer = new PDFViewer({
      container: viewerContainerRef.current,
      viewer: viewerRef.current,
      eventBus,
      linkService,
      textLayerMode: 2,
      annotationMode: 2,
      removePageBorders: true,
    });

    const INTERNAL_SCALE = 2.1; // 내부 렌더링 확대 비율(원하는 숫자)

    eventBus.on("pagesinit", () => {
      pdfViewer.currentScale = INTERNAL_SCALE;
    });

    linkService.setViewer(pdfViewer);

    let cancelled = false;
    let loadingTask = getDocument(file);

    loadingTask.promise
      .then((pdfDoc) => {
        if (cancelled) return;
        setLoading(false);
        setErrorMsg(null);
        pdfViewer.setDocument(pdfDoc);
        linkService.setDocument(pdfDoc, null);
      })
      .catch((err: any) => {
        if (cancelled) return;
        if (err?.message === "Worker was destroyed") {
          console.debug("[PdfViewer] worker destroyed (cleanup)");
          return;
        }
        console.error("[PdfViewer] load error:", err);
        setErrorMsg(err?.message || "PDF 로드 실패");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [file]);

  // ✅ 현재 선택된 텍스트를 강제로 클립보드에 넣는 함수
  const handleCopySelection = async () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    const text = window.getSelection()?.toString() ?? "";

    if (!text.trim()) {
      setCopyStatus("fail");
      copyResetRef.current = window.setTimeout(() => setCopyStatus(""), 1000);
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // fallback
        document.execCommand("copy");
      }
      setCopyStatus("ok");
    } catch (e) {
      console.error("copy failed", e);
      setCopyStatus("fail");
    } finally {
      copyResetRef.current = window.setTimeout(() => setCopyStatus(""), 1000);
    }
  };

  const VISUAL_SCALE = 0.5; // 화면에 실제로 보여줄 축소 비율 (INTERNAL_SCALE의 역수)

  return (
    <div className="pdf-viewer">
      {/* 오른쪽 위에 복사 버튼 */}
      <div className="pdf-viewer__controls">
        <button
          onClick={handleCopySelection}
          className="pdf-viewer__copy-button"
        >
          선택 텍스트 복사
        </button>
        {copyStatus === "ok" && (
          <span className="pdf-viewer__copy-status pdf-viewer__copy-status--ok">
            복사됨
          </span>
        )}
        {copyStatus === "fail" && (
          <span className="pdf-viewer__copy-status pdf-viewer__copy-status--fail">
            선택 없음
          </span>
        )}
      </div>
      {/* 로딩/에러 overlay는 그대로 두세요 */}
      {loading && (
        <div className="pdf-viewer__overlay pdf-viewer__overlay--loading">
          <span className="pdf-viewer__overlay-message">PDF 로딩 중...</span>
        </div>
      )}

      {errorMsg && (
        <div className="pdf-viewer__overlay pdf-viewer__overlay--error">
          <div className="pdf-viewer__error">
            <div className="pdf-viewer__error-title">PDF 로드 오류</div>
            <div>{errorMsg}</div>
          </div>
        </div>
      )}

      {/* ⭐⭐⭐ 화면용 스케일 래퍼 추가 (중요) ⭐⭐⭐ */}
      <div
        className="pdf-viewer__scale-wrapper"
        style={
          {
            "--visual-scale": VISUAL_SCALE,
          } as React.CSSProperties
        }
      >
        {/* ⭐ pdf.js에서 요구하는 container는 그대로 absolute 유지 ⭐ */}
        <div ref={viewerContainerRef} className="pdf-viewer__container">
          <div ref={viewerRef} className="pdfViewer pdf-viewer__content" />
        </div>
      </div>
    </div>
  );
};
