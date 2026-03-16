import { useRef, useCallback, useState } from "react";
import { VOICE_AUDIO_PREFIX } from "@/types/terminal";

export type VoiceCaptureState = "idle" | "requesting" | "recording" | "error";

interface UseVoiceCaptureOptions {
  getWebSocket: () => WebSocket | null;
  onStart?: () => void;
  onStop?: () => void;
  onError?: (error: string) => void;
}

interface UseVoiceCaptureReturn {
  state: VoiceCaptureState;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useVoiceCapture({
  getWebSocket,
  onStart,
  onStop,
  onError,
}: UseVoiceCaptureOptions): UseVoiceCaptureReturn {
  const [state, setState] = useState<VoiceCaptureState>("idle");
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const voiceListenerRef = useRef<((event: MessageEvent) => void) | null>(null);

  /** Release browser audio resources (mic, worklet, audio context). */
  const cleanupAudio = useCallback(() => {
    if (workletRef.current) {
      workletRef.current.port.onmessage = null;
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    // Remove any pending voice response listener
    if (voiceListenerRef.current) {
      const ws = getWebSocket();
      ws?.removeEventListener("message", voiceListenerRef.current);
      voiceListenerRef.current = null;
    }
  }, [getWebSocket]);

  const start = useCallback(async () => {
    const ws = getWebSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("WebSocket not connected");
      setState("error");
      onError?.("WebSocket not connected");
      return;
    }

    setState("requesting");
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          channelCount: { exact: 1 },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule("/voice-processor.js");

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const worklet = new AudioWorkletNode(audioContext, "voice-processor");
      workletRef.current = worklet;

      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const currentWs = getWebSocket();
        if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return;

        // Single allocation: prefix byte + PCM data in one frame
        const pcmData = event.data;
        const frame = new Uint8Array(1 + pcmData.byteLength);
        frame[0] = VOICE_AUDIO_PREFIX;
        frame.set(new Uint8Array(pcmData), 1);
        currentWs.send(frame);
      };

      source.connect(worklet);
      // Don't connect worklet to destination — no playback

      // Listen for voice_error from server to revert recording state
      const voiceResponseHandler = (event: MessageEvent) => {
        try {
          const data = typeof event.data === "string" ? JSON.parse(event.data) : null;
          if (!data) return;
          if (data.type === "voice_error") {
            ws.removeEventListener("message", voiceResponseHandler);
            voiceListenerRef.current = null;
            const msg = data.message || "Voice mode failed on server";
            setError(msg);
            setState("error");
            onError?.(msg);
            cleanupAudio();
          } else if (data.type === "voice_ready") {
            ws.removeEventListener("message", voiceResponseHandler);
            voiceListenerRef.current = null;
          }
        } catch {
          // Non-JSON message, ignore
        }
      };
      voiceListenerRef.current = voiceResponseHandler;
      ws.addEventListener("message", voiceResponseHandler);

      ws.send(JSON.stringify({ type: "voice_start" }));

      setState("recording");
      onStart?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Microphone access denied";
      setError(message);
      setState("error");
      onError?.(message);
    }
  }, [getWebSocket, onStart, onError, cleanupAudio]);

  const stop = useCallback(() => {
    cleanupAudio();

    const ws = getWebSocket();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "voice_stop" }));
    }

    setState("idle");
    setError(null);
    onStop?.();
  }, [getWebSocket, onStop, cleanupAudio]);

  return { state, error, start, stop };
}
