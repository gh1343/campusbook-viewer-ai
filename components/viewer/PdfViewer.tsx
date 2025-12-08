// src/components/viewer/PdfViewer.tsx
import React, { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

// pdf.js worker 설정 (이미 쓰고 있는 버전과 맞춰줌)
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  file: string | File | ArrayBuffer; // 지금은 string 경로("/pdfs/...")만 써도 됨
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ file }) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);

  const handleLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const goPrev = () => {
    setPageNumber((prev) => (prev > 1 ? prev - 1 : prev));
  };

  const goNext = () => {
    setPageNumber((prev) => (numPages && prev < numPages ? prev + 1 : prev));
  };

  return (
    <div className="pdf_viewer_container flex flex-col items-center gap-3">
      <div className="border border-slate-200 shadow-sm bg-white">
        <Document file={file} onLoadSuccess={handleLoadSuccess}>
          <Page
            pageNumber={pageNumber}
            // 텍스트/주석 레이어를 켜야 텍스트 드래그/복사가 됨
            renderTextLayer
            renderAnnotationLayer
            // 기본 확대배율 (나중에 확대/축소 기능 붙일 때 건드리면 됨)
            scale={1.2}
          />
        </Document>
      </div>

      {numPages && (
        <div className="flex items-center gap-4 text-sm">
          <button
            onClick={goPrev}
            className="px-8 py-4 border border-slate-300 rounded-md text-xs hover:bg-slate-100"
          >
            이전
          </button>
          <span>
            Page {pageNumber} / {numPages}
          </span>
          <button
            onClick={goNext}
            className="px-8 py-4 border border-slate-300 rounded-md text-xs hover:bg-slate-100"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
};
