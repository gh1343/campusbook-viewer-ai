interface PdfTextExtractOptions {
  isMobileSafari: boolean;
  setPdfTextPages: (pages: { page: number; text: string }[]) => void;
  isCancelled: () => boolean;
  onComplete?: () => void;
  onProgress?: (current: number, total: number) => void;
}

// 몇 페이지마다 중간 setState를 보낼지 결정하는 배치 크기
// 한 번에 대량 setState 대신 분산 처리 → 초기 로드 메모리 스파이크 완화
const STREAM_BATCH_SIZE = 20;

export const extractPdfText = async (
  pdfDoc: any,
  { isMobileSafari, setPdfTextPages, isCancelled, onComplete, onProgress }: PdfTextExtractOptions
) => {
  // if (isMobileSafari) {
  //   onComplete?.();
  //   return;
  // }
  const pages: { page: number; text: string }[] = [];
  try {
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      if (isCancelled()) break;
      try {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const strings = textContent.items
          .map((item: any) => ("str" in item ? item.str : ""))
          .join(" ");
        pages.push({ page: i, text: strings });
      } catch (pageErr) {
        console.warn(`[extractPdfText] page ${i} failed, skipping`, pageErr);
        pages.push({ page: i, text: "" });
      }

      // Report progress
      onProgress?.(i, pdfDoc.numPages);

      // 브라우저 페인트 사이클에 yield하여 UI(프로그레스바)가 갱신되도록 함
      // Promise 마이크로태스크만으로는 브라우저가 페인트하지 않으므로 매크로태스크로 전환
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      // 스트리밍 업데이트: STREAM_BATCH_SIZE 페이지마다 중간 setState
      // → 텍스트 검색이 전체 완료 전에도 동작하고, 마지막 한 번의 대용량 setState 스파이크를 분산
      if (i % STREAM_BATCH_SIZE === 0 && !isCancelled()) {
        setPdfTextPages([...pages]);
      }
    }
    if (!isCancelled()) {
      setPdfTextPages(pages);
      onComplete?.();
    }
  } catch (err) {
    console.error("[extractPdfText] FAILED", err);
    if (!isCancelled()) {
      setPdfTextPages(pages);
    }
    onComplete?.();
  }
};
