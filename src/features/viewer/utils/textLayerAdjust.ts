/**
 * PDF 텍스트 레이어의 줄 간 빈 공간을 자동으로 메우는 유틸리티
 * 태블릿에서 드래그 시 선택이 끊기는 것을 방지
 */

interface TextSpanInfo {
  element: HTMLElement;
  top: number;
  bottom: number;
  left: number;
  height: number;
}

/**
 * 텍스트 레이어 span들의 높이를 조정하여 줄 간 빈 공간을 제거
 */
export function adjustTextLayerSpacing(pageElement: HTMLElement) {
  const textLayer = pageElement.querySelector(".textLayer");
  if (!textLayer) return;

  const spans = Array.from(textLayer.querySelectorAll<HTMLElement>("span")).filter(
    (span) => !span.classList.contains("markedContent")
  );

  if (spans.length === 0) return;

  // 각 span의 위치 정보 수집
  const spanInfos: TextSpanInfo[] = spans.map((span) => {
    const rect = span.getBoundingClientRect();
    const parentRect = textLayer.getBoundingClientRect();

    return {
      element: span,
      top: rect.top - parentRect.top,
      bottom: rect.bottom - parentRect.top,
      left: rect.left - parentRect.left,
      height: rect.height,
    };
  });

  // Y 좌표로 줄 그룹화 (같은 줄에 있는 span들)
  const lines: TextSpanInfo[][] = [];
  const tolerance = 2; // 2px 이내는 같은 줄로 간주

  spanInfos.forEach((spanInfo) => {
    const existingLine = lines.find((line) => {
      const lineTop = line[0].top;
      return Math.abs(spanInfo.top - lineTop) <= tolerance;
    });

    if (existingLine) {
      existingLine.push(spanInfo);
    } else {
      lines.push([spanInfo]);
    }
  });

  // 줄을 Y 좌표 기준으로 정렬
  lines.sort((a, b) => a[0].top - b[0].top);

  // 각 줄에 대해 다음 줄까지의 간격을 계산하고 높이 조정
  for (let i = 0; i < lines.length - 1; i++) {
    const currentLine = lines[i];
    const nextLine = lines[i + 1];

    // 현재 줄에서 가장 아래쪽 좌표
    const currentBottom = Math.max(...currentLine.map((s) => s.bottom));
    // 다음 줄에서 가장 위쪽 좌표
    const nextTop = Math.min(...nextLine.map((s) => s.top));

    // 간격이 있으면 현재 줄의 모든 span 높이를 늘려서 간격 메우기
    const gap = nextTop - currentBottom;
    if (gap > 1) {
      // 1px 이상의 간격이 있을 때만 조정
      const extraHeight = gap + 2; // 약간의 오버랩 추가

      currentLine.forEach((spanInfo) => {
        // padding-bottom으로 높이를 늘림 (텍스트 위치는 유지)
        const currentPaddingBottom = parseFloat(
          getComputedStyle(spanInfo.element).paddingBottom || "0"
        );
        spanInfo.element.style.paddingBottom = `${
          currentPaddingBottom + extraHeight
        }px`;
      });
    }
  }
}

/**
 * 페이지의 텍스트 레이어가 렌더링될 때까지 기다린 후 조정
 */
export function adjustTextLayerSpacingAsync(
  pageElement: HTMLElement,
  maxRetries = 10,
  delay = 50
): Promise<void> {
  return new Promise((resolve) => {
    let attempts = 0;

    const tryAdjust = () => {
      const textLayer = pageElement.querySelector(".textLayer");
      const spans = textLayer?.querySelectorAll("span");

      if (spans && spans.length > 0) {
        // 텍스트 레이어가 준비됨
        setTimeout(() => {
          adjustTextLayerSpacing(pageElement);
          resolve();
        }, 10); // 레이아웃 안정화를 위한 짧은 딜레이
      } else if (attempts < maxRetries) {
        attempts++;
        setTimeout(tryAdjust, delay);
      } else {
        // 최대 재시도 횟수 초과
        resolve();
      }
    };

    tryAdjust();
  });
}
