// src/components/viewer/PdfViewer.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  GlobalWorkerOptions,
  getDocument,
  version as pdfjsVersion,
  type PDFDocumentLoadingTask,
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

  useEffect(() => {
    if (!viewerContainerRef.current || !viewerRef.current) return;

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

    let loadingTask = getDocument(file);

    loadingTask.promise
      .then((pdfDoc) => {
        setLoading(false);
        setErrorMsg(null);
        pdfViewer.setDocument(pdfDoc);
        linkService.setDocument(pdfDoc, null);
      })
      .catch((err: any) => {
        if (err?.message === "Worker was destroyed") {
          console.debug("[PdfViewer] worker destroyed (cleanup)");
          return;
        }
        console.error("[PdfViewer] load error:", err);
        setErrorMsg(err?.message || "PDF 로드 실패");
        setLoading(false);
      });

    return () => {
      loadingTask.destroy();
    };
  }, [file]);

  // ✅ 현재 선택된 텍스트를 강제로 클립보드에 넣는 함수
  const handleCopySelection = async () => {
    const text = window.getSelection()?.toString() ?? "";

    if (!text.trim()) {
      setCopyStatus("fail");
      setTimeout(() => setCopyStatus(""), 1000);
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
      setTimeout(() => setCopyStatus(""), 1000);
    }
  };

  const VISUAL_SCALE = 0.5; // 화면에 실제로 보여줄 축소 비율 (INTERNAL_SCALE의 역수)

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "calc(100vh - 160px)",
        overflow: "hidden",
        background: "#ddd",
      }}
    >
      {/* 오른쪽 위에 복사 버튼 */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 30,
          display: "flex",
          gap: 8,
        }}
      >
        <button
          onClick={handleCopySelection}
          style={{
            padding: "4px 8px",
            fontSize: 12,
            borderRadius: 4,
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          선택 텍스트 복사
        </button>
        {copyStatus === "ok" && (
          <span style={{ fontSize: 11, color: "#16a34a" }}>복사됨</span>
        )}
        {copyStatus === "fail" && (
          <span style={{ fontSize: 11, color: "#dc2626" }}>선택 없음</span>
        )}
      </div>
      {/* 로딩/에러 overlay는 그대로 두세요 */}
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              background: "#0008",
              color: "#fff",
              padding: "8px 12px",
              borderRadius: 4,
            }}
          >
            PDF 로딩 중...
          </span>
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 20,
          }}
        >
          <div
            style={{
              background: "#ffeded",
              color: "#b00",
              padding: "12px 16px",
              borderRadius: 4,
              maxWidth: "80%",
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: 4 }}>
              PDF 로드 오류
            </div>
            <div>{errorMsg}</div>
          </div>
        </div>
      )}

      {/* ⭐⭐⭐ 화면용 스케일 래퍼 추가 (중요) ⭐⭐⭐ */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "auto",
          background: "#eee",

          /* 화면에 보이는 실제 크기 축소 */
          transform: `scale(${VISUAL_SCALE})`,
          transformOrigin: "top left",

          /* 축소한 만큼 실제 크기를 반대로 늘려서 스크롤 정상화 */
          width: `${100 / VISUAL_SCALE}%`,
          height: `${100 / VISUAL_SCALE}%`,
        }}
      >
        {/* ⭐ pdf.js에서 요구하는 container는 그대로 absolute 유지 ⭐ */}
        <div
          ref={viewerContainerRef}
          style={{
            position: "absolute",
            inset: 0,
            overflow: "auto",
            background: "transparent",
          }}
        >
          <div
            ref={viewerRef}
            className="pdfViewer"
            style={{ padding: "20px" }}
          />
        </div>
      </div>
    </div>
  );
};
