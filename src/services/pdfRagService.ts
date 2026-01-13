import * as pdfjsLib from 'pdfjs-dist';
import {Chapter, RagChunk} from '../../types';

// PDF.js worker 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://aistudiocdn.com/pdfjs-dist@4.4.168/build/pdf.worker.mjs`;

interface ParsedBook {
  chapters: Chapter[];
  chunks: RagChunk[];
}

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
 * 대학교재 특화 하이브리드 검색 로직
 * 1. 질문 의도 파악을 위한 키워드 정규화
 * 2. 슬라이딩 윈도우를 통한 문맥 보존
 * 3. 학술 용어 가중치 적용
 */
export const findRelevantChunks = (
  query: string,
  chunks: RagChunk[]
): RagChunk[] => {
  if (!query || !chunks || chunks.length === 0) return [];

  // 1. 키워드 추출 (불필요한 조사 제거 및 전문 용어 보존)
  const academicStopWords = [
    '설명해줘',
    '분석해줘',
    '알려줘',
    '무엇인가',
    '비교해봐',
    '영향은',
    '관계는',
    '대해서',
    '관련하여',
  ];
  let processedQuery = query;
  academicStopWords.forEach(sw => {
    processedQuery = processedQuery.replace(new RegExp(sw, 'g'), ' ');
  });

  const keywords = processedQuery
    .toLowerCase()
    .replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ')
    .split(/\s+/)
    .filter(k => k.length >= 2);

  if (keywords.length === 0) return [chunks[0]];

  // 2. 가중치 스코어링
  const scored = chunks.map(chunk => {
    let score = 0;
    const content = chunk.text.toLowerCase();

    keywords.forEach(keyword => {
      // 완전 일치 (강력한 가중치)
      if (content.includes(keyword)) {
        score += 1000;
        const freq = content.split(keyword).length - 1;
        score += freq * 100;
      }

      // 영문 전문 용어 포함 시 추가 가중치
      if (/[a-zA-Z]{3,}/.test(keyword) && content.includes(keyword)) {
        score += 500;
      }

      // 키워드 근접성 점수 (복합 질의의 경우 키워드들이 뭉쳐있는 곳이 정답일 확률이 높음)
      const keywordPositions = keywords
        .map(k => content.indexOf(k))
        .filter(p => p !== -1);
      if (keywordPositions.length > 1) {
        const spread =
          Math.max(...keywordPositions) - Math.min(...keywordPositions);
        if (spread < 500) score += 300; // 500자 이내에 키워드들이 모여있으면 가산점
      }
    });

    return {...chunk, score};
  });

  // 3. 상위 결과 추출 및 슬라이딩 윈도우 적용
  const topHits = scored
    .filter(c => c.score > 0)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 3); // 가장 관련성 높은 3개 지점 선정

  if (topHits.length === 0) return [chunks[0]];

  // 4. 문맥 보존을 위해 선택된 각 지점의 앞뒤 페이지를 포함한 윈도우 구성
  const contextWindows: RagChunk[] = [];
  const seenPages = new Set<number>();

  topHits.forEach(hit => {
    const pageNum = hit.pageNumber!;
    // 앞/현재/뒤 페이지 묶음 (총 3페이지 분량의 컨텍스트 제공)
    for (let p = pageNum - 1; p <= pageNum + 1; p++) {
      if (p > 0 && !seenPages.has(p)) {
        const neighboringChunk = chunks.find(c => c.pageNumber === p);
        if (neighboringChunk) {
          contextWindows.push(neighboringChunk);
          seenPages.add(p);
        }
      }
    }
  });

  return contextWindows.sort((a, b) => a.pageNumber! - b.pageNumber!);
};
