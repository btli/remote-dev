# Voice Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable browser microphone audio to passthrough to Claude Code's built-in voice mode running in remote tmux sessions, using a FIFO-based sox shim.

**Architecture:** Browser captures mic audio via AudioWorklet, streams raw PCM over WebSocket binary frames to the terminal server, which writes to a per-session named FIFO. A sox shim script intercepts Claude Code's sox calls and reads from the FIFO instead of CoreAudio. A synchronized mic button handles both audio streaming and spacebar injection.

**Tech Stack:** Web Audio API (AudioWorklet), WebSocket binary frames, Unix FIFO (mkfifo), Bash shim script, React component

**Design doc:** `docs/plans/2026-03-05-voice-mode-design.md`

---

### Task 1: AudioWorklet Processor for PCM Capture

Creates the AudioWorklet processor that runs in the audio thread, converting Float32 samples to 16-bit signed integer PCM at 16kHz.

**Files:**
- Create: `public/voice-processor.js`
- Test: `src/__tests__/voice-processor.test.ts`

**Step 1: Write the AudioWorklet processor**

`public/voice-processor.js` — must be a plain JS file (AudioWorklet loads via URL, not bundled):

```javascript
/**
 * AudioWorklet processor that captures mic audio and downsamples to 16kHz 16-bit PCM.
 * Runs in the audio rendering thread for low-latency capture.
 */
class VoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 0;
    // Target: 4096 samples at 16kHz = ~256ms per chunk
    this._targetSamples = 4096;
  }

  /**
   * Downsample from source sample rate to 16kHz using linear interpolation.
   * @param {Float32Array} input - Source audio samples
   * @param {number} sourceSampleRate - Source sample rate (e.g. 44100, 48000)
   * @returns {Float32Array} - Downsampled samples at 16kHz
   */
  downsample(input, sourceSampleRate) {
    if (sourceSampleRate === 16000) return input;

    const ratio = sourceSampleRate / 16000;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const low = Math.floor(srcIndex);
      const high = Math.min(low + 1, input.length - 1);
      const frac = srcIndex - low;
      output[i] = input[low] * (1 - frac) + input[high] * frac;
    }

    return output;
  }

  /**
   * Convert Float32 samples (-1.0 to 1.0) to Int16 PCM.
   * @param {Float32Array} float32 - Input samples
   * @returns {Int16Array} - 16-bit signed integer samples
   */
  floatToInt16(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    return int16;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // Mono channel 0
    const downsampled = this.downsample(channelData, sampleRate);

    this._buffer.push(downsampled);
    this._bufferSize += downsampled.length;

    if (this._bufferSize >= this._targetSamples) {
      // Merge buffer chunks
      const merged = new Float32Array(this._bufferSize);
      let offset = 0;
      for (const chunk of this._buffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      const int16 = this.floatToInt16(merged);
      this.port.postMessage(int16.buffer, [int16.buffer]);

      this._buffer = [];
      this._bufferSize = 0;
    }

    return true;
  }
}

registerProcessor("voice-processor", VoiceProcessor);
```

**Step 2: Write unit test for downsample and floatToInt16 logic**

```typescript
// src/__tests__/voice-processor.test.ts
import { describe, it, expect } from "vitest";

// Extract pure functions for testing (AudioWorklet can't run in Node)
function downsample(input: Float32Array, sourceSampleRate: number): Float32Array {
  if (sourceSampleRate === 16000) return input;
  const ratio = sourceSampleRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, input.length - 1);
    const frac = srcIndex - low;
    output[i] = input[low] * (1 - frac) + input[high] * frac;
  }
  return output;
}

function floatToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return int16;
}

describe("voice-processor", () => {
  describe("downsample", () => {
    it("returns input unchanged at 16kHz", () => {
      const input = new Float32Array([0.1, 0.2, 0.3]);
      const result = downsample(input, 16000);
      expect(result).toBe(input);
    });

    it("downsamples 48kHz to 16kHz (3:1 ratio)", () => {
      const input = new Float32Array(48);
      for (let i = 0; i < 48; i++) input[i] = i / 48;
      const result = downsample(input, 48000);
      expect(result.length).toBe(16);
    });

    it("downsamples 44100 to 16kHz", () => {
      const input = new Float32Array(441);
      const result = downsample(input, 44100);
      // 441 / (44100/16000) = 441 / 2.75625 = ~160
      expect(result.length).toBe(160);
    });
  });

  describe("floatToInt16", () => {
    it("converts silence to zeros", () => {
      const result = floatToInt16(new Float32Array([0, 0, 0]));
      expect(Array.from(result)).toEqual([0, 0, 0]);
    });

    it("converts max positive to 32767", () => {
      const result = floatToInt16(new Float32Array([1.0]));
      expect(result[0]).toBe(32767);
    });

    it("converts max negative to -32768", () => {
      const result = floatToInt16(new Float32Array([-1.0]));
      expect(result[0]).toBe(-32768);
    });

    it("clamps values beyond -1/+1", () => {
      const result = floatToInt16(new Float32Array([1.5, -1.5]));
      expect(result[0]).toBe(32767);
      expect(result[1]).toBe(-32768);
    });
  });
});
```

**Step 3: Run tests**

Run: `bun run test:run -- src/__tests__/voice-processor.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add public/voice-processor.js src/__tests__/voice-processor.test.ts
git commit -m "feat(voice): add AudioWorklet processor for PCM capture"
```

---

### Task 2: useVoiceCapture Hook

React hook that manages mic permission, AudioWorklet lifecycle, and binary WebSocket streaming.

**Files:**
- Create: `src/hooks/useVoiceCapture.ts`

**Step 1: Write the hook**

```typescript
// src/hooks/useVoiceCapture.ts
import { useRef, useCallback, useState } from "react";

export type VoiceCaptureState = "idle" | "requesting" | "recording" | "error";

interface UseVoiceCaptureOptions {
  /** WebSocket to send binary audio frames on */
  getWebSocket: () => WebSocket | null;
  /** Called when voice capture starts successfully */
  onStart?: () => void;
  /** Called when voice capture stops */
  onStop?: () => void;
  /** Called on error */
  onError?: (error: string) => void;
}

interface UseVoiceCaptureReturn {
  state: VoiceCaptureState;
  error: string | null;
  /** Start capturing — requests mic permission on first call */
  start: () => Promise<void>;
  /** Stop capturing */
  stop: () => void;
}

/** Binary frame prefix for voice audio (1 byte) */
const VOICE_AUDIO_PREFIX = 0x01;

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
      // Request mic permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          channelCount: { exact: 1 },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Create AudioContext
      const audioContext = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioContext;

      // Load AudioWorklet
      await audioContext.audioWorklet.addModule("/voice-processor.js");

      // Create source and worklet nodes
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const worklet = new AudioWorkletNode(audioContext, "voice-processor");
      workletRef.current = worklet;

      // Handle PCM data from worklet
      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const ws = getWebSocket();
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const pcmData = new Uint8Array(event.data);
        // Prefix with voice marker byte
        const frame = new Uint8Array(1 + pcmData.length);
        frame[0] = VOICE_AUDIO_PREFIX;
        frame.set(pcmData, 1);
        ws.send(frame.buffer);
      };

      // Connect: mic -> worklet (worklet posts PCM via port)
      source.connect(worklet);
      // Don't connect worklet to destination (we don't want to play back mic audio)

      // Send voice_start to server
      ws.send(JSON.stringify({ type: "voice_start" }));

      setState("recording");
      onStart?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone access denied";
      setError(message);
      setState("error");
      onError?.(message);
    }
  }, [getWebSocket, onStart, onError]);

  const stop = useCallback(() => {
    // Disconnect audio nodes
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
    // Stop mic stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Send voice_stop to server
    const ws = getWebSocket();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "voice_stop" }));
    }

    setState("idle");
    setError(null);
    onStop?.();
  }, [getWebSocket, onStop]);

  return { state, error, start, stop };
}
```

**Step 2: Commit**

```bash
git add src/hooks/useVoiceCapture.ts
git commit -m "feat(voice): add useVoiceCapture hook for mic capture and WS streaming"
```

---

### Task 3: VoiceMicButton Component

Mic button UI for the terminal overlay area.

**Files:**
- Create: `src/components/terminal/VoiceMicButton.tsx`

**Step 1: Write the component**

```tsx
// src/components/terminal/VoiceMicButton.tsx
"use client";

import { useCallback, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { useVoiceCapture, type VoiceCaptureState } from "@/hooks/useVoiceCapture";
import { cn } from "@/lib/utils";

interface VoiceMicButtonProps {
  getWebSocket: () => WebSocket | null;
  className?: string;
}

export function VoiceMicButton({ getWebSocket, className }: VoiceMicButtonProps) {
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { state, error, start, stop } = useVoiceCapture({
    getWebSocket,
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      // Debounce: require 200ms hold
      holdTimeoutRef.current = setTimeout(() => {
        start();
      }, 200);
    },
    [start]
  );

  const handlePointerUp = useCallback(() => {
    if (holdTimeoutRef.current) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (state === "recording") {
      stop();
    }
  }, [state, stop]);

  const isRecording = state === "recording";
  const isError = state === "error";

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      className={cn(
        "p-1 rounded transition-colors",
        isRecording
          ? "text-red-400 bg-red-500/20 animate-pulse"
          : isError
            ? "text-red-400 opacity-60 cursor-not-allowed"
            : "text-muted-foreground hover:text-foreground hover:bg-accent",
        className
      )}
      title={
        isError
          ? `Voice error: ${error}`
          : isRecording
            ? "Release to stop recording"
            : "Hold to speak (requires /voice enabled in Claude Code)"
      }
    >
      {isError ? (
        <MicOff className="w-3.5 h-3.5" />
      ) : (
        <Mic className="w-3.5 h-3.5" />
      )}
    </button>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/terminal/VoiceMicButton.tsx
git commit -m "feat(voice): add VoiceMicButton component"
```

---

### Task 4: Integrate VoiceMicButton into Terminal Component

Add the mic button to the terminal overlay, next to the recording indicator. Only visible for agent sessions.

**Files:**
- Modify: `src/components/terminal/Terminal.tsx:22-28` (TerminalRef interface)
- Modify: `src/components/terminal/Terminal.tsx:30-63` (TerminalProps interface)
- Modify: `src/components/terminal/Terminal.tsx:1362-1368` (recording indicator area)

**Step 1: Add getWebSocket to TerminalRef (already exists at line 27)**

Verify `getWebSocket` is already exposed in the `TerminalRef` interface at line 27. No changes needed to the ref.

**Step 2: Add the VoiceMicButton next to the recording indicator**

In `Terminal.tsx`, after the recording indicator block (line 1368), add the voice mic button for agent sessions:

```tsx
// After line 1368 (after recording indicator closing div)
// Add before the search overlay:

{/* Voice mic button for agent sessions */}
{terminalType === "agent" && (
  <div className="absolute top-2 left-2 z-20" style={{ left: isRecording ? "5.5rem" : "0.5rem" }}>
    <VoiceMicButton getWebSocket={() => wsRef.current} />
  </div>
)}
```

Add import at top of file:
```tsx
import { VoiceMicButton } from "./VoiceMicButton";
```

**Step 3: Commit**

```bash
git add src/components/terminal/Terminal.tsx
git commit -m "feat(voice): integrate VoiceMicButton into terminal for agent sessions"
```

---

### Task 5: Terminal Server — Voice FIFO Handler

Extend the WebSocket message handler to support `voice_start`, `voice_stop`, and binary audio frames.

**Files:**
- Modify: `src/server/terminal.ts:64-78` (TerminalSession interface)
- Modify: `src/server/terminal.ts:114-132` (cleanupSession)
- Modify: `src/server/terminal.ts:570-706` (WS message handler)

**Step 1: Add voice fields to TerminalSession interface**

At `src/server/terminal.ts:64`, add to the interface:

```typescript
interface TerminalSession {
  pty: IPty;
  ws: WebSocket;
  sessionId: string;
  tmuxSessionName: string;
  isAttached: boolean;
  lastCols: number;
  lastRows: number;
  pendingResize: { cols: number; rows: number } | null;
  resizeTimeout: ReturnType<typeof setTimeout> | null;
  terminalType: "shell" | "agent" | "file" | string;
  userId: string;
  // Voice mode state
  voiceFifoPath: string | null;
  voiceFifoFd: number | null;
  voiceAudioBuffer: Buffer[];
  voiceFifoReady: boolean;
}
```

**Step 2: Initialize voice fields when creating session**

At `src/server/terminal.ts:510-530` (where session is added to the map), add the voice fields:

```typescript
voiceFifoPath: null,
voiceFifoFd: null,
voiceAudioBuffer: [],
voiceFifoReady: false,
```

**Step 3: Add FIFO cleanup to cleanupSession**

At `src/server/terminal.ts:114`, extend `cleanupSession`:

```typescript
function cleanupSession(sessionId: string): void {
  connectingSessionIds.delete(sessionId);

  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);

  if (session.resizeTimeout) {
    clearTimeout(session.resizeTimeout);
  }

  // Clean up voice FIFO
  cleanupVoiceFifo(session);

  try {
    destroyPty(session.pty);
  } catch {
    // PTY may already be dead
  }
}
```

**Step 4: Add voice helper functions**

Add these functions after `cleanupSession` (around line 133):

```typescript
import { mkfifoSync } from "mkfifo"; // or use execFileSync("mkfifo", [...])
import * as fs from "fs";
import { tmpdir } from "os";

const VOICE_AUDIO_PREFIX = 0x01;

/**
 * Create a per-session FIFO for voice audio passthrough.
 * The sox shim reads from this FIFO instead of CoreAudio.
 */
function createVoiceFifo(session: TerminalSession): string {
  const fifoPath = `${tmpdir()}/rdv-voice-${session.sessionId}.fifo`;

  // Create FIFO (named pipe) with restrictive permissions
  try {
    fs.unlinkSync(fifoPath);
  } catch {
    // File may not exist
  }
  execFileSync("mkfifo", ["-m", "0600", fifoPath]);

  session.voiceFifoPath = fifoPath;
  session.voiceAudioBuffer = [];
  session.voiceFifoReady = false;

  // Open FIFO for writing in non-blocking mode
  // This won't block because we use O_NONBLOCK initially
  // Once the sox shim opens the read end, we can start writing
  const fd = fs.openSync(fifoPath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
  session.voiceFifoFd = fd;
  session.voiceFifoReady = true;

  // Flush any buffered audio
  for (const chunk of session.voiceAudioBuffer) {
    try {
      fs.writeSync(fd, chunk);
    } catch {
      break; // Reader not ready yet
    }
  }
  session.voiceAudioBuffer = [];

  return fifoPath;
}

function cleanupVoiceFifo(session: TerminalSession): void {
  if (session.voiceFifoFd !== null) {
    try {
      fs.closeSync(session.voiceFifoFd);
    } catch {
      // FD may already be closed
    }
    session.voiceFifoFd = null;
  }

  if (session.voiceFifoPath) {
    try {
      fs.unlinkSync(session.voiceFifoPath);
    } catch {
      // File may already be deleted
    }
    session.voiceFifoPath = null;
  }

  session.voiceFifoReady = false;
  session.voiceAudioBuffer = [];
}
```

**Step 5: Handle voice messages in WS switch block**

In the `ws.on("message", ...)` handler at line 570, the message is currently always parsed as JSON. We need to handle binary frames first:

```typescript
ws.on("message", (message, isBinary) => {
  try {
    // Handle binary voice audio frames
    if (isBinary || (Buffer.isBuffer(message) && message[0] === VOICE_AUDIO_PREFIX)) {
      const buf = Buffer.isBuffer(message) ? message : Buffer.from(message as ArrayBuffer);
      if (buf.length > 1 && buf[0] === VOICE_AUDIO_PREFIX) {
        const pcmData = buf.subarray(1);

        if (session.voiceFifoReady && session.voiceFifoFd !== null) {
          try {
            fs.writeSync(session.voiceFifoFd, pcmData);
          } catch {
            // FIFO reader may have closed — buffer for retry
            session.voiceAudioBuffer.push(pcmData);
          }
        } else {
          // Buffer audio while FIFO is being set up
          session.voiceAudioBuffer.push(pcmData);
        }
        return;
      }
    }

    const msg = JSON.parse(message.toString());

    switch (msg.type) {
      // ... existing cases ...

      case "voice_start": {
        if (session.terminalType !== "agent") {
          ws.send(JSON.stringify({
            type: "voice_error",
            message: "Voice mode is only available for agent sessions",
          }));
          break;
        }

        try {
          const fifoPath = createVoiceFifo(session);
          console.log(`[Voice] Created FIFO for session ${sessionId}: ${fifoPath}`);

          // Send spacebar to PTY (triggers Claude Code voice recording)
          ptyProcess.write(" ");

          ws.send(JSON.stringify({
            type: "voice_ready",
            sessionId,
          }));
        } catch (error) {
          console.error(`[Voice] Failed to create FIFO for ${sessionId}:`, error);
          ws.send(JSON.stringify({
            type: "voice_error",
            message: `Voice setup failed: ${(error as Error).message}`,
          }));
        }
        break;
      }

      case "voice_stop": {
        console.log(`[Voice] Stopping voice for session ${sessionId}`);

        // Write silence padding to flush sox buffer
        if (session.voiceFifoFd !== null) {
          try {
            const silencePadding = Buffer.alloc(3200); // 100ms of silence at 16kHz/16bit
            fs.writeSync(session.voiceFifoFd, silencePadding);
          } catch {
            // Ignore write errors during cleanup
          }
        }

        cleanupVoiceFifo(session);

        // Release spacebar (send Enter to submit, or just stop holding)
        // Claude Code's voice mode submits on spacebar release
        // We just need to stop the audio — Claude detects end-of-stream
        break;
      }
    }
  } catch {
    // JSON parse error on non-binary message — ignore
  }
});
```

**Step 6: Commit**

```bash
git add src/server/terminal.ts
git commit -m "feat(voice): add FIFO voice handler to terminal server"
```

---

### Task 6: Sox Shim Script

The sox wrapper that reads from the FIFO when voice mode is active.

**Files:**
- Create: `src/server/voice-sox-shim.sh`
- Create: `src/__tests__/voice-sox-shim.test.ts`

**Step 1: Write the shim script**

```bash
#!/bin/bash
# Remote Dev sox shim — redirects audio input from FIFO when voice mode is active.
# When Claude Code spawns sox with --default-device to record mic audio,
# this shim reads from the voice FIFO instead of CoreAudio.
# For all other sox operations (playback, format conversion, etc.), passes through.

# Find the real sox binary (skip this shim in PATH)
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SOX=""
IFS=':' read -ra PATH_DIRS <<< "$PATH"
for dir in "${PATH_DIRS[@]}"; do
  if [[ "$dir" != "$SELF_DIR" ]] && [[ -x "$dir/sox" ]]; then
    REAL_SOX="$dir/sox"
    break
  fi
done

if [[ -z "$REAL_SOX" ]]; then
  echo "Error: real sox not found in PATH" >&2
  exit 1
fi

# Check if this is a recording operation (--default-device flag)
IS_RECORDING=false
for arg in "$@"; do
  if [[ "$arg" == "--default-device" ]]; then
    IS_RECORDING=true
    break
  fi
done

# Voice FIFO path uses session ID from environment
VOICE_FIFO="/tmp/rdv-voice-${RDV_SESSION_ID}.fifo"

# If recording AND our voice FIFO exists, read from it
if $IS_RECORDING && [[ -n "$RDV_SESSION_ID" ]] && [[ -p "$VOICE_FIFO" ]]; then
  # Output raw PCM from the FIFO to stdout
  # The FIFO contains: 16kHz, 16-bit signed integer, mono, little-endian
  cat "$VOICE_FIFO"
else
  # Pass through to real sox for all other operations
  exec "$REAL_SOX" "$@"
fi
```

**Step 2: Write test for shim behavior**

```typescript
// src/__tests__/voice-sox-shim.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, execFile as execFileCb } from "child_process";
import { mkdtempSync, writeFileSync, chmodSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFile = promisify(execFileCb);

describe("voice-sox-shim", () => {
  let shimDir: string;
  let shimPath: string;
  const shimSrc = join(__dirname, "../../src/server/voice-sox-shim.sh");

  beforeAll(() => {
    shimDir = mkdtempSync(join(tmpdir(), "rdv-shim-test-"));
    shimPath = join(shimDir, "sox");
    // Copy shim to temp dir
    const content = require("fs").readFileSync(shimSrc, "utf-8");
    writeFileSync(shimPath, content);
    chmodSync(shimPath, "755");
  });

  it("passes through to real sox for non-recording commands", async () => {
    // sox --version should pass through to real sox
    const { stdout } = await execFile(shimPath, ["--version"], {
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
    });
    expect(stdout).toContain("sox");
  });

  it("passes through when no RDV_SESSION_ID is set", async () => {
    const { stdout } = await execFile(shimPath, ["--version"], {
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env.PATH}`,
        RDV_SESSION_ID: "",
      },
    });
    expect(stdout).toContain("sox");
  });
});
```

**Step 3: Run test**

Run: `bun run test:run -- src/__tests__/voice-sox-shim.test.ts`
Expected: PASS (requires sox installed on the system)

**Step 4: Commit**

```bash
git add src/server/voice-sox-shim.sh src/__tests__/voice-sox-shim.test.ts
git commit -m "feat(voice): add sox shim script for FIFO-based audio redirect"
```

---

### Task 7: Sox Shim Installation and PATH Setup

Install the sox shim in the agent session environment so it intercepts sox calls.

**Files:**
- Modify: `src/lib/terminal-plugins/plugins/agent-plugin.tsx:107-121` (createSession return)
- Modify: `src/server/terminal.ts:491-500` (session creation block)
- Create: `src/services/voice-shim-service.ts`

**Step 1: Create voice shim service**

```typescript
// src/services/voice-shim-service.ts
import { existsSync, mkdirSync, copyFileSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SHIM_DIR = join(homedir(), ".remote-dev", "bin");
const SHIM_SRC = join(__dirname, "voice-sox-shim.sh");

/**
 * Ensure the sox shim is installed at ~/.remote-dev/bin/sox.
 * Returns the shim directory path to prepend to PATH.
 */
export function ensureSoxShim(): string {
  if (!existsSync(SHIM_DIR)) {
    mkdirSync(SHIM_DIR, { recursive: true });
  }

  const shimDest = join(SHIM_DIR, "sox");

  // Always overwrite to keep shim up to date
  copyFileSync(SHIM_SRC, shimDest);
  chmodSync(shimDest, "755");

  return SHIM_DIR;
}

/**
 * Get the PATH with shim directory prepended.
 */
export function getVoicePath(existingPath?: string): string {
  const shimDir = ensureSoxShim();
  const currentPath = existingPath || process.env.PATH || "";
  return `${shimDir}:${currentPath}`;
}
```

**Step 2: Set RDV_SESSION_ID and PATH in agent session environment**

In `src/server/terminal.ts`, after creating a new tmux session (around line 494), add environment setup:

```typescript
// After: createTmuxSession(tmuxSessionName, cols, rows, cwd, tmuxHistoryLimit);
// Before: ptyProcess = attachToTmuxSession(tmuxSessionName, cols, rows);

// Set up voice mode environment for agent sessions
if (terminalType === "agent") {
  try {
    const { ensureSoxShim } = await import("@/services/voice-shim-service");
    const shimDir = ensureSoxShim();

    // Set session-level env vars via tmux set-environment
    execFileSync("tmux", ["set-environment", "-t", tmuxSessionName, "RDV_SESSION_ID", sessionId]);
    execFileSync("tmux", ["set-environment", "-t", tmuxSessionName, "PATH", `${shimDir}:${process.env.PATH || ""}`]);
  } catch (error) {
    console.warn(`[Voice] Failed to install sox shim for ${sessionId}:`, error);
    // Non-fatal — voice just won't work for this session
  }
}
```

**Step 3: Commit**

```bash
git add src/services/voice-shim-service.ts src/server/terminal.ts src/lib/terminal-plugins/plugins/agent-plugin.tsx
git commit -m "feat(voice): install sox shim and set PATH for agent sessions"
```

---

### Task 8: WebSocket Protocol — Handle voice_ready/voice_error on Client

Update the Terminal component to handle the new server messages.

**Files:**
- Modify: `src/components/terminal/Terminal.tsx:514-594` (ws.onmessage handler)

**Step 1: Add voice message cases to the client WS handler**

In `Terminal.tsx` inside the `ws.onmessage` switch block (around line 517), add:

```typescript
case "voice_ready":
  console.log(`[Voice] Ready for session ${msg.sessionId}`);
  break;

case "voice_error":
  console.error(`[Voice] Error: ${msg.message}`);
  break;
```

**Step 2: Commit**

```bash
git add src/components/terminal/Terminal.tsx
git commit -m "feat(voice): handle voice_ready/voice_error messages in terminal client"
```

---

### Task 9: FIFO Open Timing Fix

The O_NONBLOCK open on the FIFO write end will fail with ENXIO if no reader has opened it yet. We need to handle the timing where the FIFO is created before sox (the reader) opens it.

**Files:**
- Modify: `src/server/terminal.ts` (createVoiceFifo function from Task 5)

**Step 1: Use a polling open instead of immediate O_NONBLOCK**

Replace the FIFO open logic in `createVoiceFifo`:

```typescript
function createVoiceFifo(session: TerminalSession): string {
  const fifoPath = `${tmpdir()}/rdv-voice-${session.sessionId}.fifo`;

  try {
    fs.unlinkSync(fifoPath);
  } catch {
    // File may not exist
  }
  execFileSync("mkfifo", ["-m", "0600", fifoPath]);

  session.voiceFifoPath = fifoPath;
  session.voiceAudioBuffer = [];
  session.voiceFifoReady = false;

  // Open FIFO for writing in a background thread
  // fs.open with O_WRONLY will block until a reader opens the other end
  // This is expected — sox shim opens the read end when Claude Code spawns it
  fs.open(fifoPath, fs.constants.O_WRONLY, (err, fd) => {
    if (err) {
      console.error(`[Voice] Failed to open FIFO for writing: ${err.message}`);
      return;
    }

    session.voiceFifoFd = fd;
    session.voiceFifoReady = true;

    // Flush buffered audio
    for (const chunk of session.voiceAudioBuffer) {
      try {
        fs.writeSync(fd, chunk);
      } catch {
        break;
      }
    }
    session.voiceAudioBuffer = [];
    console.log(`[Voice] FIFO writer connected for session ${session.sessionId}`);
  });

  return fifoPath;
}
```

**Step 2: Commit**

```bash
git add src/server/terminal.ts
git commit -m "fix(voice): use async FIFO open to handle reader timing"
```

---

### Task 10: Integration Test — End-to-End Voice Flow

Test the full flow from voice_start to FIFO creation to cleanup.

**Files:**
- Create: `src/__tests__/voice-fifo.test.ts`

**Step 1: Write integration test**

```typescript
// src/__tests__/voice-fifo.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, execFile as execFileCb } from "child_process";
import { existsSync, unlinkSync, openSync, readSync, writeSync, closeSync, constants } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFile = promisify(execFileCb);

describe("voice FIFO", () => {
  const testFifo = join(tmpdir(), "rdv-voice-test-fifo.fifo");

  afterEach(() => {
    try {
      unlinkSync(testFifo);
    } catch {
      // May not exist
    }
  });

  it("creates a FIFO that can pass PCM data", async () => {
    // Create FIFO
    try { unlinkSync(testFifo); } catch { /* ok */ }
    execFileSync("mkfifo", ["-m", "0600", testFifo]);
    expect(existsSync(testFifo)).toBe(true);

    // Write and read in parallel (FIFO blocks until both ends open)
    const testData = Buffer.alloc(320); // 10ms of 16kHz/16bit audio
    for (let i = 0; i < 160; i++) {
      testData.writeInt16LE(Math.floor(Math.sin(i / 10) * 16000), i * 2);
    }

    const result = await new Promise<Buffer>((resolve, reject) => {
      // Reader (simulating sox shim)
      const readPromise = new Promise<Buffer>((res) => {
        setTimeout(() => {
          const fd = openSync(testFifo, constants.O_RDONLY);
          const buf = Buffer.alloc(320);
          const bytesRead = readSync(fd, buf, 0, 320, null);
          closeSync(fd);
          res(buf.subarray(0, bytesRead));
        }, 50);
      });

      // Writer (simulating terminal server)
      setTimeout(() => {
        const fd = openSync(testFifo, constants.O_WRONLY);
        writeSync(fd, testData);
        closeSync(fd);
      }, 100);

      readPromise.then(resolve).catch(reject);
    });

    expect(result.length).toBe(320);
    expect(result.equals(testData)).toBe(true);
  });
});
```

**Step 2: Run test**

Run: `bun run test:run -- src/__tests__/voice-fifo.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/voice-fifo.test.ts
git commit -m "test(voice): add FIFO integration test for PCM passthrough"
```

---

### Task 11: CHANGELOG Update

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add voice mode entry**

Under `## [Unreleased]`, add:

```markdown
### Added
- Voice mode for agent sessions: hold mic button to stream browser audio to Claude Code's voice pipeline via FIFO-based sox shim
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add voice mode to changelog"
```

---

## Task Dependency Graph

```
Task 1 (AudioWorklet) ─────────┐
Task 2 (useVoiceCapture hook) ──┼──▶ Task 4 (Terminal integration)
Task 3 (VoiceMicButton) ────────┘
                                         │
Task 5 (Server FIFO handler) ──────────▶ Task 9 (Timing fix)
Task 6 (Sox shim script) ─────┐
Task 7 (Shim install + PATH) ──┘
Task 8 (Client WS messages) ──────────▶ Task 10 (Integration test)
                                         │
                                         ▼
                                    Task 11 (CHANGELOG)
```

**Parallelizable groups:**
- Group A (browser): Tasks 1, 2, 3 → Task 4
- Group B (server): Tasks 5, 6, 7 → Task 9
- Task 8 depends on Task 5's message types
- Task 10 and 11 are final
