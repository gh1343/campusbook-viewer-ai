import * as pdfjsLib from 'pdfjs-dist';
import { Chapter, RagChunk } from '../../types';

// Set worker source to CDN for browser compatibility
// Pinned to 4.4.168 to match import map and using .mjs for correct module loading
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://aistudiocdn.com/pdfjs-dist@4.4.168/build/pdf.worker.mjs`;

interface ParsedBook {
  chapters: Chapter[];
  chunks: RagChunk[];
}

export const processPdf = async (file: File): Promise<ParsedBook> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    let chunks: RagChunk[] = [];
    let htmlContent = '';
    
    const totalPages = pdf.numPages;
    
    if (totalPages === 0) {
        throw new Error("PDF has zero pages.");
    }
    
    // Iterate through pages
    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Extract text items
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');

      fullText += pageText + ' ';

      // Create a RAG chunk for this page (Simple Chunking Strategy)
      if (pageText.trim().length > 0) {
        chunks.push({
          id: `chunk-page-${i}`,
          text: pageText,
          pageNumber: i
        });
      }

      // Format as simple HTML for the viewer
      // We wrap content in <p> tags. We could use basic heuristics to detect headers.
      const paragraphs = pageText.split('  '); // PDF often uses double spaces for separation
      
      htmlContent += `<div class="pdf-page" id="page-${i}" style="margin-bottom: 2rem; border-bottom: 1px dashed #e2e8f0; padding-bottom: 1rem;">`;
      htmlContent += `<span class="text-xs text-slate-400 block mb-2 font-mono">Page ${i}</span>`;
      
      if (pageText.trim().length === 0) {
          // Visual indicator for scanned/image-only pages
          htmlContent += `<div class="p-4 bg-slate-100 dark:bg-slate-800 rounded text-slate-500 text-sm italic text-center">[Page ${i}: No text content detected. This might be a scanned image.]</div>`;
      } else {
          paragraphs.forEach(para => {
            if (para.trim().length > 0) {
              // Simple heuristic: Short lines might be headers
              if (para.length < 50 && !para.endsWith('.')) {
                  htmlContent += `<h3 class="font-bold text-lg mt-4 mb-2 text-slate-800 dark:text-slate-200">${para}</h3>`;
              } else {
                  htmlContent += `<p class="mb-2 leading-relaxed text-slate-700 dark:text-slate-300">${para}</p>`;
              }
            }
          });
      }
      
      htmlContent += `</div>`;
    }

    if (!htmlContent.trim()) {
        htmlContent = "<div class='p-8 text-center text-slate-500'>Could not extract text from this PDF. It might contain only images or be protected.</div>";
    }

    // Create a single "Chapter" for the whole PDF for seamless scrolling
    const chapter: Chapter = {
      id: 'pdf-upload',
      title: file.name.replace('.pdf', ''),
      content: htmlContent
    };

    return {
      chapters: [chapter],
      chunks
    };
  } catch (error) {
    console.error("PDF Processing Error:", error);
    throw error;
  }
};

// Simple Client-side Retrieval Logic
export const findRelevantContext = (query: string, chunks: RagChunk[]): string => {
  const queryTerms = query.toLowerCase().split(' ').filter(w => w.length > 3);
  if (queryTerms.length === 0) return '';
  
  // Score chunks based on term frequency
  const scoredChunks = chunks.map(chunk => {
    let score = 0;
    const lowerText = chunk.text.toLowerCase();
    queryTerms.forEach(term => {
      if (lowerText.includes(term)) score++;
    });
    return { ...chunk, score };
  });

  // Get top 3 chunks
  const topChunks = scoredChunks
    .sort((a, b) => b.score - a.score)
    .filter(c => c.score > 0)
    .slice(0, 3);
    
  return topChunks.map(c => c.text).join('\n\n');
};
