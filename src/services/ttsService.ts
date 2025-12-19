// Gemini TTS helper (REST) for client-side usage
// Uses gemini-2.5-flash-preview-tts to return an audio blob URL (mp3)

const getApiKey = () => {
  // Prefer Vite env, fallback to process.env (for dev tools)
  const viteKey =
    typeof import.meta !== 'undefined' &&
    (import.meta as any)?.env?.VITE_API_KEY;
  const nodeKey =
    typeof process !== 'undefined' && (process as any)?.env?.API_KEY;
  return (viteKey || nodeKey || '').trim();
};

const MODEL_ID = 'models/gemini-2.5-flash-preview-tts';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/${MODEL_ID}:generateContent`;

export interface TtsOptions {
  voiceName?: string;
}

export const synthesizeWithGemini = async (
  text: string,
  options?: TtsOptions
): Promise<{ audioUrl: string; mimeType: string }> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API key is missing. Set VITE_API_KEY or API_KEY.');
  }

  const body: any = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      // Gemini TTS supports audio/mp3 or audio/pcm; mp3 keeps payload small
      responseMimeType: 'audio/mp3',
    },
  };

  // Voice selection is optional; if unsupported, Gemini falls back to default
  if (options?.voiceName) {
    body.generationConfig.voiceConfig = {
      prebuiltVoiceConfig: { voiceName: options.voiceName },
    };
  }

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini TTS request failed: ${res.status} ${errText}`);
  }

  const json = await res.json();
  const part =
    json?.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.inlineData?.data
    ) || null;

  const base64 = part?.inlineData?.data;
  const mimeType = part?.inlineData?.mimeType || 'audio/mp3';

  if (!base64) {
    throw new Error('Gemini TTS response missing audio data.');
  }

  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([binary], { type: mimeType });
  const audioUrl = URL.createObjectURL(blob);

  return { audioUrl, mimeType };
};

