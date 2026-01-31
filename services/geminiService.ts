import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Decodes base64 string to audio bytes
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Decodes raw PCM/Audio data into an AudioBuffer
export async function decodeAudioData(
  base64Data: string,
  ctx: AudioContext,
  sampleRate: number = 24000
): Promise<AudioBuffer> {
  const bytes = decode(base64Data);
  
  const dataInt16 = new Int16Array(bytes.buffer);
  const numChannels = 1;
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const translateDocument = async (
  base64Data: string,
  mimeType: string,
  targetLanguage: string,
  mode: 'speed' | 'detailed'
): Promise<string> => {
  try {
    // Configure thinking budget based on mode
    // Speed: 0 (disable thinking for max speed)
    // Detailed: 2048 (allow some thinking for better extraction of complex docs)
    const thinkingBudget = mode === 'speed' ? 0 : 2048;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data,
            },
          },
          {
            text: `You are a helpful assistant for people who cannot read well. 
            1. Analyze the provided document (image or PDF).
            2. Extract all the visible text.
            3. Translate the extracted text into ${targetLanguage}.
            4. Return ONLY the translated text. Do not add markdown formatting like **bold** or headers unless they are in the original document structure. Keep it simple and readable.`,
          },
        ],
      },
      config: {
        thinkingConfig: { thinkingBudget: thinkingBudget }
      }
    });

    return response.text || "Could not extract text.";
  } catch (error) {
    console.error("Translation error:", error);
    throw new Error("Failed to translate document.");
  }
};

export const generateSpeech = async (text: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) {
      throw new Error("No audio data received.");
    }
    return audioData;
  } catch (error) {
    console.error("TTS error:", error);
    throw new Error("Failed to generate speech.");
  }
};
