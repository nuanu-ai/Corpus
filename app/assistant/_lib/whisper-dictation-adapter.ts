"use client";

import type { DictationAdapter } from "@assistant-ui/react";

type SpeechStartListener = () => void;
type SpeechResultListener = (result: DictationAdapter.Result) => void;

/**
 * Whisper-backed DictationAdapter: records audio via MediaRecorder in the
 * browser, uploads the blob to `/api/speech/transcribe` (Whisper) on stop,
 * then emits a single final transcript via `onSpeechEnd`. Interim
 * (`onSpeech`) updates are not emitted because Whisper is batch-only.
 *
 * Used by assistant-ui's `ComposerPrimitive.Dictate` / `StopDictation` and
 * `useComposerDictate()`.
 */
export function createWhisperDictationAdapter(): DictationAdapter {
  return {
    listen: () => {
      let status: DictationAdapter.Session["status"] = { type: "starting" };
      const statusListeners = new Set<() => void>();
      const speechStartListeners = new Set<SpeechStartListener>();
      const speechEndListeners = new Set<SpeechResultListener>();
      const speechListeners = new Set<SpeechResultListener>();

      let mediaStream: MediaStream | null = null;
      let recorder: MediaRecorder | null = null;
      const chunks: Blob[] = [];
      let cancelled = false;

      const notifyStatus = () => {
        for (const cb of statusListeners) cb();
      };

      const setStatus = (next: DictationAdapter.Session["status"]) => {
        status = next;
        notifyStatus();
      };

      const cleanup = () => {
        if (mediaStream) {
          for (const track of mediaStream.getTracks()) track.stop();
          mediaStream = null;
        }
        recorder = null;
      };

      const end = (
        reason: "stopped" | "cancelled" | "error",
        result?: DictationAdapter.Result,
      ) => {
        cleanup();
        setStatus({ type: "ended", reason });
        if (result) {
          for (const cb of speechListeners) cb(result);
          for (const cb of speechEndListeners) cb(result);
        }
      };

      const resolveMimeType = (): string | undefined => {
        if (typeof MediaRecorder === "undefined") return undefined;
        const candidates = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/mp4",
          "audio/ogg;codecs=opus",
        ];
        for (const mime of candidates) {
          if (MediaRecorder.isTypeSupported(mime)) return mime;
        }
        return undefined;
      };

      const session: DictationAdapter.Session = {
        get status() {
          return status;
        },
        stop: async () => {
          if (!recorder || recorder.state !== "recording") {
            cleanup();
            if (status.type !== "ended") {
              setStatus({ type: "ended", reason: "stopped" });
            }
            return;
          }

          // Capture final blob, upload, emit transcript.
          const stopped = new Promise<Blob>((resolve) => {
            recorder!.addEventListener(
              "stop",
              () => {
                const type = recorder?.mimeType || "audio/webm";
                resolve(new Blob(chunks, { type }));
              },
              { once: true },
            );
          });
          recorder.stop();
          const blob = await stopped;

          if (cancelled) {
            end("cancelled");
            return;
          }

          if (blob.size === 0) {
            end("stopped", { transcript: "", isFinal: true });
            return;
          }

          try {
            const form = new FormData();
            const ext = blob.type.includes("mp4")
              ? "mp4"
              : blob.type.includes("ogg")
                ? "ogg"
                : "webm";
            form.append("file", blob, `voice-input.${ext}`);
            const res = await fetch("/api/speech/transcribe", {
              method: "POST",
              body: form,
            });
            if (!res.ok) {
              const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
              console.error(
                `[whisper-dictation] transcribe failed (${res.status}):`,
                body.error ?? res.statusText,
              );
              // Alpha-tier (BYOK) users hit 412 byok_required when they
              // haven't set their OpenAI key. Surface a clear pointer to
              // /settings/byok so they can self-serve.
              if (res.status === 412 && body.reason === "byok_required" && typeof window !== "undefined") {
                const goSetup = window.confirm(
                  "Voice input needs your own OpenAI API key. Open /settings/byok to add it now?",
                );
                if (goSetup) {
                  window.location.assign("/settings/byok");
                }
              }
              end("error");
              return;
            }
            const payload = (await res.json()) as { text?: string };
            const transcript = (payload.text ?? "").trim();
            end("stopped", { transcript, isFinal: true });
          } catch (error) {
            console.error("[whisper-dictation] network error", error);
            end("error");
          }
        },
        cancel: () => {
          cancelled = true;
          if (recorder && recorder.state === "recording") {
            try {
              recorder.stop();
            } catch {
              // already stopped
            }
          }
          end("cancelled");
        },
        onSpeechStart: (cb) => {
          speechStartListeners.add(cb);
          return () => speechStartListeners.delete(cb);
        },
        onSpeechEnd: (cb) => {
          speechEndListeners.add(cb);
          return () => speechEndListeners.delete(cb);
        },
        onSpeech: (cb) => {
          speechListeners.add(cb);
          return () => speechListeners.delete(cb);
        },
      };

      // Kick off the recording asynchronously so `listen()` can return a
      // Session immediately (as the adapter contract expects).
      (async () => {
        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices?.getUserMedia ||
          typeof MediaRecorder === "undefined"
        ) {
          end("error");
          return;
        }

        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const mime = resolveMimeType();
          recorder = mime
            ? new MediaRecorder(mediaStream, { mimeType: mime })
            : new MediaRecorder(mediaStream);

          recorder.addEventListener("dataavailable", (event) => {
            if (event.data && event.data.size > 0) chunks.push(event.data);
          });
          recorder.addEventListener("error", (event) => {
            console.error("[whisper-dictation] recorder error", event);
            end("error");
          });
          recorder.addEventListener("start", () => {
            setStatus({ type: "running" });
            for (const cb of speechStartListeners) cb();
          });

          recorder.start();
        } catch (error) {
          console.warn("[whisper-dictation] getUserMedia/MediaRecorder failed", error);
          end("error");
        }
      })();

      return session;
    },
  };
}
