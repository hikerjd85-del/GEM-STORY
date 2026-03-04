import { GoogleGenAI, Type, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface StoryPage {
  text: string;
  imagePrompt: string;
  imageUrl?: string;
  imageError?: boolean;
  audioBase64?: string;
  audioMimeType?: string;
  audioError?: boolean;
}

export async function generateStoryOutline(prompt: string, demographic: string, language: string): Promise<StoryPage[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Create a storybook based on this prompt: "${prompt}". Target demographic: ${demographic}. Language: ${language}.
    Return a JSON array of pages. Each page should have 'text' (the narrative for that page written in ${language}) and 'imagePrompt' (a very simple, safe, and descriptive visual prompt in English for the illustrator). 
    IMPORTANT INSTRUCTIONS:
    1. The story MUST be exactly 10 pages long.
    2. The story text MUST be appropriately long and detailed for the target demographic. For older children, write 3-5 descriptive sentences per page. For younger children, write 2-3 engaging sentences per page. Do not make the text too short.
    3. The imagePrompt MUST be extremely simple, benign, and literal. Describe only basic objects, animals, or landscapes. DO NOT include any violence, conflict, weapons, sensitive topics, or abstract concepts. Keep it under 15 words.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: `The narrative text for the page in ${language}. Ensure appropriate length for the demographic.` },
            imagePrompt: { type: Type.STRING, description: "A simple, safe visual description in English for the illustrator. Avoid complex or sensitive subjects." }
          },
          required: ["text", "imagePrompt"]
        }
      }
    }
  });
  
  const text = response.text;
  if (!text) throw new Error("Failed to generate story outline.");
  return JSON.parse(text);
}

export async function generateImage(prompt: string, retries = 2): Promise<string | undefined> {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `A children's book illustration: ${prompt}` }],
        },
      });
      
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          return `data:${mimeType};base64,${part.inlineData.data}`;
        }
      }
      return undefined;
    } catch (e) {
      console.error(`Image generation attempt ${i + 1} failed:`, e);
      lastError = e;
      if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

export async function generateAudio(text: string, voiceName: string, retries = 2): Promise<{ base64: string, mimeType: string } | undefined> {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });
      
      const part = response.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData) {
        return {
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'audio/pcm'
        };
      }
      return undefined;
    } catch (e) {
      console.error(`Audio generation attempt ${i + 1} failed:`, e);
      lastError = e;
      if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}
