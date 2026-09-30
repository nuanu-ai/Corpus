import { getTelegramBotTranscriptionModel } from "@/lib/telegram-bot/config";

type OpenAiTranscriptionResponse = {
  text?: string;
};

const MAX_EMPTY_TRANSCRIPT_ATTEMPTS = 2;

function extensionFromMimeType(mimeType: string | null | undefined): string {
  const normalized = mimeType?.toLowerCase() ?? "";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "mp4";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("webm")) return "webm";
  return "ogg";
}

function ensureAudioFileName(input: {
  fileName: string;
  mimeType?: string | null;
}): string {
  const trimmed = input.fileName.trim();
  if (/\.(ogg|oga|mp3|mpeg|mp4|m4a|wav|webm)$/i.test(trimmed)) {
    return trimmed;
  }
  const base = trimmed.length > 0 ? trimmed : "telegram-voice";
  return `${base}.${extensionFromMimeType(input.mimeType)}`;
}

export async function transcribeTelegramAudio(input: {
  content: Buffer;
  fileName: string;
  mimeType?: string | null;
  prompt?: string;
}): Promise<string> {
  const apiKey =
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.CODEX_OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY or CODEX_OPENAI_API_KEY is required for Telegram voice transcription",
    );
  }

  const buildFormData = () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File([new Uint8Array(input.content)], ensureAudioFileName(input), {
        type: input.mimeType ?? "application/octet-stream",
      }),
    );
    formData.set("model", getTelegramBotTranscriptionModel());
    if (input.prompt?.trim()) {
      formData.set("prompt", input.prompt.trim());
    }
    return formData;
  };

  let emptyTranscript = false;
  for (let attempt = 1; attempt <= MAX_EMPTY_TRANSCRIPT_ATTEMPTS; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: buildFormData(),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as
      | (OpenAiTranscriptionResponse & { error?: { message?: string } })
      | null;

    if (!response.ok) {
      const detail = payload?.error?.message?.trim() || `OpenAI transcription failed with status ${response.status}`;
      throw new Error(detail);
    }

    const transcript = payload?.text?.trim();
    if (transcript) {
      return transcript;
    }
    emptyTranscript = true;
  }

  if (emptyTranscript) {
    throw new Error("OpenAI transcription returned no transcript text after retry");
  }

  throw new Error("OpenAI transcription returned no transcript text");
}
