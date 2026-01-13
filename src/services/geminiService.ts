import { GoogleGenAI } from "@google/genai";

/**
 * 대학교재의 복합적인 맥락을 분석하여 인과관계와 추론이 포함된 답변을 생성합니다.
 */
export const generateExplanation = async (
  text: string,
  context?: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            text: `
[CampusBook Academic Research System]
당신은 대학교재의 텍스트와 데이터 사이의 숨겨진 인과관계를 찾아내어 학생에게 전달하는 고도화된 지능형 튜터입니다. 
단순한 텍스트 매칭을 넘어, 질문의 의도를 깊이 있게 파악하여 논리적인 답변을 구성하세요.

[사고 과정 가이드라인 (내부적으로 수행할 것)]
1. **의도 분석**: 학생이 질문을 통해 알고자 하는 핵심 개념(Core Concept)과 그 파생 효과를 정의하세요.
2. **증거 추출**: 제공된 [도서 맥락]에서 질문과 관련된 직접적인 사실들과 간접적인 기전(Mechanism)을 모두 수집하세요.
3. **논리적 합성**: 수집된 정보들을 연결하여 질문에 대한 명확한 인과관계나 비교 분석을 수행하세요.
4. **최종 출력**: 학술적 깊이를 유지하되 이해하기 쉬운 구조로 답변하세요.

[출력 규칙]
- 답변은 전문 용어를 정확히 사용하며, 인과관계가 드러나도록 '먼저', '따라서', '이러한 결과로' 등의 연결어를 적절히 사용하세요.
- 반드시 답변 마지막에 "참조 페이지: p.n, p.m" 형식으로 근거가 된 모든 페이지를 명시하세요.
- 도서 맥락상 정보가 전혀 없거나 추론이 불가능한 경우, "교재 내 정보 부족"을 명시하고 일반적인 학술 지식을 보조적으로 제공하세요.

[도서 맥락]
${context || "정보 없음"}

[학생 질문]
"${text}"
          `.trim(),
          },
        ],
      },
      config: {
        temperature: 0.15, // 답변의 학술적 엄밀성을 위해 낮은 온도로 유지
        topP: 0.9,
      },
    });

    return response.text || "분석 결과를 생성할 수 없습니다.";
  } catch (error) {
    console.error("Gemini Academic Analysis Error:", error);
    return "학술 분석 엔진 연결 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }
};

export const summarizeChapter = async (
  chapterContent: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  try {
    const prompt = `다음 학술 텍스트의 핵심 논지와 주요 개념들을 체계적으로 요약해줘:\n\n${chapterContent.substring(0, 10000)}`;
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text || "요약을 생성할 수 없습니다.";
  } catch (error) {
    return "요약 중 오류가 발생했습니다.";
  }
};
