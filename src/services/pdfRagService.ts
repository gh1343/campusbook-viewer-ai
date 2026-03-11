import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import {Chapter, RagChunk} from '../../types';

// PDF.js worker 설정 (PdfViewer.tsx와 동일하게 로컬 v5 worker 사용)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface ParsedBook {
  chapters: Chapter[];
  chunks: RagChunk[];
}

/**
 * PDF 프로세싱: 최적화된 중첩 청킹 전략 적용
 * 정보의 연속성을 보장하기 위해 페이지 경계에서 문맥을 깊게 공유합니다.
 */
export const processPdf = async (file: File): Promise<ParsedBook> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;

    const chunks: RagChunk[] = [];
    let htmlContent = '';
    const totalPages = pdf.numPages;

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');

      if (pageText.trim().length > 0) {
        chunks.push({
          id: `chunk-page-${i}`,
          text: pageText,
          pageNumber: i,
        });

        if (i > 1 && chunks.length >= 2) {
          const prevChunk = chunks.find(
            c => c.pageNumber === i - 1 && !c.id.includes('overlap')
          );
          if (prevChunk) {
            const overlapText =
              prevChunk.text.slice(-500) +
              ' [PAGE_BOUNDARY] ' +
              pageText.slice(0, 500);
            chunks.push({
              id: `chunk-overlap-${i - 1}-${i}`,
              text: overlapText,
              pageNumber: i,
            });
          }
        }
      }

      const paragraphs = pageText.split(/\s{2,}/);
      htmlContent += `<div class="pdf-page" id="page-${i}" style="margin-bottom: 2rem; border-bottom: 1px dashed #e2e8f0; padding-bottom: 1.5rem;">`;
      htmlContent += `<span class="text-[10px] text-slate-400 block mb-4 font-mono font-bold uppercase tracking-widest">Page ${i}</span>`;

      if (pageText.trim().length === 0) {
        htmlContent += `<div class="p-4 bg-slate-50 rounded-xl text-slate-400 text-xs italic text-center">No text detected</div>`;
      } else {
        paragraphs.forEach(para => {
          if (para.trim().length > 0) {
            htmlContent += `<p class="mb-4 leading-relaxed text-slate-700 dark:text-slate-300">${para}</p>`;
          }
        });
      }
      htmlContent += `</div>`;
    }

    return {
      chapters: [
        {id: 'pdf-upload', title: file.name.replace('.pdf', ''), content: htmlContent},
      ],
      chunks,
    };
  } catch (error) {
    console.error('PDF Error:', error);
    throw error;
  }
};

/**
 * 하이브리드 검색 및 근접도 기반 Re-ranking
 * 복합 질문(여러 키워드의 관계) 해결을 위해 키워드 간 거리를 계산하여 점수화합니다.
 */
export const findRelevantChunks = (
  query: string,
  chunks: RagChunk[]
): RagChunk[] => {
  if (!query || !chunks || chunks.length === 0) return [];

  const stopWords = [
    '설명',
    '분석',
    '관계',
    '영향',
    '기전',
    '메커니즘',
    '알려줘',
    '어떻게',
    '왜',
  ];
  let processedQuery = query;
  stopWords.forEach(sw => {
    processedQuery = processedQuery.replace(new RegExp(sw, 'g'), ' ');
  });

  const keywords = processedQuery
    .toLowerCase()
    .replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ')
    .split(/\s+/)
    .filter(k => k.length >= 2);

  if (keywords.length === 0) return chunks.slice(0, 3);

  const scored = chunks.map(chunk => {
    let score = 0;
    const content = chunk.text.toLowerCase();
    const keywordPositions: {kw: string; pos: number}[] = [];

    keywords.forEach(keyword => {
      let pos = content.indexOf(keyword);
      if (pos !== -1) {
        score += 1000;
        while (pos !== -1) {
          keywordPositions.push({kw: keyword, pos});
          score += 100;
          pos = content.indexOf(keyword, pos + 1);
        }
      }
    });

    if (keywordPositions.length > 1) {
      keywordPositions.sort((a, b) => a.pos - b.pos);
      for (let i = 0; i < keywordPositions.length - 1; i++) {
        const dist = keywordPositions[i + 1].pos - keywordPositions[i].pos;
        if (dist < 300) {
          score += 3000 * (1 - dist / 300);
        }
      }
      const uniqueKws = new Set(keywordPositions.map(k => k.kw));
      score += Math.pow(uniqueKws.size, 3) * 500;
    }

    return {...chunk, score};
  });

  const topHits = scored
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 2);

  const finalContext: RagChunk[] = [];
  const seenPages = new Set<number>();

  topHits.forEach(hit => {
    const pNum = hit.pageNumber!;
    for (let p = pNum; p <= pNum + 1; p++) {
      if (!seenPages.has(p)) {
        const pageData = chunks.find(
          c => c.pageNumber === p && !c.id.includes('overlap')
        );
        if (pageData) {
          finalContext.push(pageData);
          seenPages.add(p);
        }
      }
    }
  });

  return finalContext.sort((a, b) => a.pageNumber! - b.pageNumber!);
};
