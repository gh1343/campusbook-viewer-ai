import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

const MODEL_NAME = "gemini-2.5-flash";

export const generateExplanation = async (text: string, context?: string): Promise<string> => {
  if (!apiKey) return "API Key is missing.";
  
  try {
    const prompt = `
      Context: The user is reading an educational text.
      Target Text: "${text}"
      ${context ? `Surrounding Context: ${context}` : ''}
      
      Task: Provide a concise, easy-to-understand explanation of the target text or concept. 
      Limit the response to 3 sentences. Tone: Academic but accessible.
      Language: Respond in Korean.
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });
    return response.text || "Could not generate explanation.";
  } catch (error) {
    console.error("AI Error:", error);
    return "Error connecting to AI service.";
  }
};

export const answerPdfQuestion = async (
  question: string,
  context: string
): Promise<string> => {
  if (!apiKey) return "API Key is missing.";

  try {
    const prompt = `
[System Instruction]
당신은 'CampusBook'의 전문 학습 튜터입니다. 
반드시 제공된 [도서 맥락]의 정보만을 바탕으로 사용자의 질문에 답변하세요.

[답변 규칙]
1. 답변 내용의 근거가 된 페이지 번호를 반드시 답변 끝에 "(출처: n페이지)" 형태로 명시하세요.
2. 여러 페이지를 참고했다면 "(출처: n페이지, m페이지)"와 같이 나열하세요.
3. [도서 맥락]에 답이 없다면, 외부 지식을 쓰지 말고 "해당 내용은 현재 도서에서 찾을 수 없습니다"라고 정직하게 답하세요.
4. 학생에게 설명하듯 친절하고 명확한 한국어로 답변하세요.
5. 답변은 핵심 위주로 3~5문장 내외로 구성하세요.

[도서 맥락]
${context || "정보 없음"}

[사용자 질문]
"${question}"
    `.trim();

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        temperature: 0.1,
        topP: 0.95,
        systemInstruction:
          "당신은 도서의 내용을 정확하게 분석하여 답변하고 출처를 밝히는 정직한 AI 튜터입니다.",
      },
    });
    return response.text || "Could not generate response.";
  } catch (error) {
    console.error("AI Error:", error);
    return "Error connecting to AI service.";
  }
};

export const summarizeChapter = async (chapterContent: string): Promise<string> => {
  if (!apiKey) return "API Key is missing.";

  try {
    const prompt = `
      Task: Summarize the following chapter content into 3 key bullet points.
      Content: ${chapterContent.substring(0, 5000)}... (truncated)
      
      Output format:
      - Point 1
      - Point 2
      - Point 3
      Language: Respond in Korean.
    `;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });
    return response.text || "Could not generate summary.";
  } catch (error) {
    console.error("AI Error:", error);
    return "Error generating summary.";
  }
};

export const chatWithContext = async (
  history: { role: 'user' | 'model'; text: string }[],
  newMessage: string,
  currentChapterContent: string
): Promise<string> => {
  if (!apiKey) return "API Key is missing.";

  try {
    const chat = ai.chats.create({
      model: MODEL_NAME,
      config: {
        systemInstruction: `You are a helpful teaching assistant for a student reading a digital textbook. 
        Current Chapter Content Context: ${currentChapterContent.substring(0, 2000)}...
        Answer questions based on the context provided. Be encouraging and concise.
        Language: Respond in Korean.`
      }
    });

    // Replay history (simplified for MVP, ideally we map properly to chat structure)
    // Note: In a real app, we would add history to the chat session. 
    // For this MVP stateless call, we'll just send the message with context instructions.
    
    const response = await chat.sendMessage({
      message: newMessage
    });

    return response.text || "No response.";
  } catch (error) {
    console.error("Chat Error:", error);
    return "Sorry, I encountered an error.";
  }
};
