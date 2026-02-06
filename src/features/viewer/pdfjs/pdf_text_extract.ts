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
