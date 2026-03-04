interface PdfTextExtractOptions {
  isMobileSafari: boolean;
  setPdfTextPages: (pages: { page: number; text: string }[]) => void;
  isCancelled: () => boolean;
  onComplete?: () => void;
  onProgress?: (current: number, total: number) => void;
}

export const extractPdfText = async (
  pdfDoc: any,
  { isMobileSafari, setPdfTextPages, isCancelled, onComplete, onProgress }: PdfTextExtractOptions
) => {
  if (isMobileSafari) {
    onComplete?.();
    return;
  }
  const pages: { page: number; text: string }[] = [];
  try {
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      if (isCancelled()) break;
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const strings = textContent.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join(" ");
      pages.push({ page: i, text: strings });

      // Report progress
      onProgress?.(i, pdfDoc.numPages);

      // 브라우저 페인트 사이클에 yield하여 UI(프로그레스바)가 갱신되도록 함
      // Promise 마이크로태스크만으로는 브라우저가 페인트하지 않으므로 매크로태스크로 전환
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!isCancelled()) {
      setPdfTextPages(pages);
      onComplete?.();
    }
  } catch (err) {
    console.error("PDF text extraction failed", err);
    onComplete?.();
  }
};
