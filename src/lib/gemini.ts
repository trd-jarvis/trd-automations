import { env } from "../config.js";

interface GeminiRequest {
  model?: string;
  prompt: string;
  responseMimeType?: string;
}

interface GeminiResponseEnvelope {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

export async function generateGeminiText(input: GeminiRequest): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = input.model ?? env.GEMINI_PROSPECTOR_MODEL ?? env.GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: input.prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.35,
        responseMimeType: input.responseMimeType ?? "text/plain"
      }
    })
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}): ${raw.slice(0, 400)}`);
  }

  const parsed = JSON.parse(raw) as GeminiResponseEnvelope;
  const text = parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) {
    throw new Error("Gemini response did not include text output.");
  }
  return text;
}
