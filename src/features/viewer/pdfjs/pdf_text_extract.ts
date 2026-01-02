interface PdfTextExtractOptions {
  isMobileSafari: boolean;
  setPdfTextPages: (pages: { page: number; text: string }[]) => void;
  isCancelled: () => boolean;
}

export const extractPdfText = async (
  pdfDoc: any,
  { isMobileSafari, setPdfTextPages, isCancelled }: PdfTextExtractOptions
) => {
  if (isMobileSafari) return;
  const pages: { page: number; text: string }[] = [];
  try {
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const strings = textContent.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join(" ");
      pages.push({ page: i, text: strings });
    }
    if (!isCancelled()) setPdfTextPages(pages);
  } catch (err) {
    console.error("PDF text extraction failed", err);
  }
};
