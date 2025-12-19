// Gemini TTS helper (REST) for client-side usage
// Requests audio output from a Gemini model that supports AUDIO and returns an audio blob URL (mp3)

const getEnv = (key: string) => {
  const viteVal =
    typeof import.meta !== "undefined" && (import.meta as any)?.env?.[key];
  const nodeVal =
    typeof process !== "undefined" && (process as any)?.env?.[key];
  return (viteVal || nodeVal || "").toString().trim();
};

const getApiKey = () => {
  // Prefer Vite env, fallback to process.env (for dev tools)
  const viteKey = getEnv("GEMINI_API_KEY") || getEnv("VITE_API_KEY");
  const nodeKey = getEnv("API_KEY");
  return viteKey || nodeKey;
};

// Allow overriding the model via env; default to an audio-capable variant.
const MODEL_ID =
  getEnv("GEMINI_TTS_MODEL") ||
  getEnv("VITE_GEMINI_TTS_MODEL") ||
  "models/gemini-2.0-flash-001";
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
    throw new Error(
      "API key is missing. Set GEMINI_API_KEY (or VITE_API_KEY/API_KEY)."
    );
  }

  const body: any = {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      // Ask for audio output
      responseModalities: ["AUDIO"],
      ...(options?.voiceName
        ? {
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: options.voiceName },
              },
            },
          }
        : {}),
    },
  };

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
  const mimeType = part?.inlineData?.mimeType || "audio/mp3";

  if (!base64) {
    throw new Error("Gemini TTS response missing audio data.");
  }

  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([binary], { type: mimeType });
  const audioUrl = URL.createObjectURL(blob);

  return { audioUrl, mimeType };
};
