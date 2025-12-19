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
