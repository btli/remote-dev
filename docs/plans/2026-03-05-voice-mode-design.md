# Voice Mode: Browser-to-Agent Audio Passthrough

**Date:** 2026-03-05
**Branch:** feature/claude-voice
**Status:** Design approved

## Problem

Claude Code supports voice mode (`/voice` + hold spacebar) which uses `sox` to capture audio from the local microphone. When Claude Code runs inside a Remote Dev tmux session, the microphone is in the user's browser — not on the server. We need to bridge browser audio capture to the server so Claude Code's built-in voice pipeline receives it.

## Solution: FIFO-based Sox Shim

Intercept `sox` calls from Claude Code by placing a shim script earlier in `$PATH`. The shim reads audio from a named FIFO pipe instead of CoreAudio. Browser audio is streamed over WebSocket to the terminal server, which writes it to the FIFO.

A dedicated mic button in the UI handles both audio capture and spacebar injection simultaneously — one button, seamless UX.

## Architecture

```
Browser                           Terminal Server
+----------------+                +----------------------------------+
| Mic Button     |  WS binary     |                                  |
| (hold to talk) |  PCM frames    |  WS handler                      |
|                | -------------> |  +----> FIFO write                |
| Web Audio API  |                |  |      /tmp/rdv-voice-{id}.fifo  |
| 16kHz/16bit/1ch|                |  |                    |           |
+----------------+                |  |                    v           |
                                  |  |      Sox shim (reads FIFO)     |
  On press:                       |  |                    |           |
  - Start mic capture             |  |                    v           |
  - Send voice_start msg -------> |  +----> PTY: spacebar hold       |
                                  |         (triggers Claude voice)   |
  On release:                     |                       |           |
  - Stop mic capture              |         Claude Code   v           |
  - Send voice_stop msg --------> |         voice pipeline            |
                                  |         (Whisper STT)             |
                                  +----------------------------------+
```

## Components

### 1. Browser: VoiceMicButton Component

**File:** `src/components/terminal/VoiceMicButton.tsx`

React component rendered in the terminal header/toolbar for agent sessions.

**Behavior:**
- **Press & hold:** Request mic permission, start `AudioWorklet` capture, send `voice_start` WS message, stream PCM binary frames
- **Release:** Stop capture, send `voice_stop` WS message
- **Visual:** Pulsing red indicator while recording, mic icon when idle

**Audio capture:**
- Web Audio API with `AudioWorkletNode` for low-latency capture
- Sample rate: 16000 Hz (downsample from browser's native rate)
- Format: 16-bit signed integer, mono, little-endian (raw PCM)
- Frame size: ~4096 samples per message (~256ms at 16kHz)

**Why AudioWorklet over MediaRecorder:**
- MediaRecorder outputs compressed formats (webm/opus), sox expects raw PCM
- AudioWorklet gives raw Float32 samples we can convert to Int16 precisely
- Lower latency — no encoding delay

### 2. WebSocket Protocol Extension

**New message types (client -> server):**

```typescript
// Start voice capture — server creates FIFO, sends spacebar to PTY
{ type: "voice_start" }

// Binary audio frame — raw PCM data written to FIFO
// Sent as binary WebSocket frame (not JSON)
// Prefixed with 1-byte marker: 0x01 = voice audio
[0x01][PCM_DATA...]

// Stop voice capture — server closes FIFO write end, releases spacebar
{ type: "voice_stop" }
```

**New message types (server -> client):**

```typescript
// Voice session ready — FIFO created, shim will read from it
{ type: "voice_ready", sessionId: string }

// Voice error — mic permission denied, FIFO creation failed, etc.
{ type: "voice_error", message: string }
```

**Binary frame rationale:**
Audio data must be sent as binary WebSocket frames for efficiency. A 1-byte prefix distinguishes voice audio from potential future binary message types. The existing JSON protocol remains unchanged for all other messages.

### 3. Terminal Server: Voice Handler

**File:** `src/server/terminal.ts` (extend existing WS handler)

**On `voice_start`:**
1. Create FIFO: `mkfifo /tmp/rdv-voice-{sessionId}.fifo`
2. Open FIFO for writing (non-blocking initially, then blocking once sox shim opens read end)
3. Send spacebar key down to PTY: `ptyProcess.write(" ")` (hold)
4. Send `voice_ready` to client

**On binary frame (0x01 prefix):**
1. Strip prefix byte
2. Write PCM data to FIFO file descriptor

**On `voice_stop`:**
1. Write silence padding (small buffer of zeros) to flush sox's internal buffer
2. Close FIFO write end (sox shim gets EOF, finishes reading)
3. Send spacebar key up to PTY (release)
4. Unlink FIFO

**FIFO lifecycle:**
- Created on `voice_start`, destroyed on `voice_stop`
- If WebSocket disconnects during voice, cleanup FIFO in `cleanupSession()`
- FIFO path stored in `TerminalSession` interface

**FIFO timing solution:**
The shim opens the FIFO for reading (blocking). The server opens for writing. The order doesn't matter with FIFOs — `open()` on either end blocks until the other end opens. Since Claude Code spawns sox in response to the spacebar (which we send), and the FIFO already exists, the timing works:
1. Server creates FIFO
2. Server sends spacebar to PTY
3. Claude Code detects spacebar hold, spawns sox
4. Sox shim opens FIFO for reading (server's write-open unblocks)
5. Audio flows

### 4. Sox Shim Script

**File:** `~/.remote-dev/bin/sox` (installed per agent profile)

```bash
#!/bin/bash
# Remote Dev sox shim — redirects audio input from FIFO when voice mode is active
# Falls through to real sox for all other operations

REAL_SOX="$(command -v sox 2>/dev/null)"
VOICE_FIFO="/tmp/rdv-voice-${RDV_SESSION_ID}.fifo"

# Detect recording mode: --default-device flag present
is_recording=false
for arg in "$@"; do
  if [[ "$arg" == "--default-device" ]]; then
    is_recording=true
    break
  fi
done

# If recording and voice FIFO exists, read from FIFO
if $is_recording && [[ -p "$VOICE_FIFO" ]]; then
  # Extract output format args (everything after --default-device ... -)
  # Feed FIFO as input instead of default device
  # The FIFO contains raw PCM: 16kHz, 16-bit signed, mono, little-endian
  exec cat "$VOICE_FIFO"
else
  # Pass through to real sox
  exec "$REAL_SOX" "$@"
fi
```

**PATH setup:**
When creating an agent session with voice support, prepend `~/.remote-dev/bin` to `$PATH` in the tmux session environment. Also set `RDV_SESSION_ID` env var so the shim knows which FIFO to read.

**Shim installation:**
- Installed during agent profile setup (`AgentProfileService`)
- Or lazily created on first voice session

### 5. Agent Session Environment

**Modified files:** `src/lib/terminal-plugins/plugins/agent-plugin.tsx`, `src/server/terminal.ts`

When creating an agent session:
- Set `RDV_SESSION_ID={sessionId}` in tmux session environment
- Prepend `~/.remote-dev/bin` to `PATH` in tmux session environment
- These are set via `tmux set-environment` after session creation

### 6. UI Integration

**Mic button placement:** Terminal toolbar, next to existing controls. Only visible when `terminalType === "agent"`.

**States:**
| State | Icon | Style |
|-------|------|-------|
| Idle | Mic icon | Default, muted color |
| Recording | Mic icon | Pulsing red ring, filled red |
| No permission | Mic-off icon | Disabled, tooltip explains |
| Error | Mic-off icon | Red, tooltip with error |

**Mobile:** Same button, works with touch (touch-start / touch-end).

## Data Flow (Happy Path)

1. User enables `/voice` in Claude Code terminal session
2. User presses & holds mic button in Remote Dev UI
3. Browser requests mic permission (first time only)
4. `voice_start` sent over WebSocket
5. Server creates FIFO, sends spacebar to PTY
6. Claude Code detects spacebar hold, enters recording mode, spawns sox
7. Sox shim opens FIFO for reading
8. Browser captures audio via AudioWorklet, streams binary PCM frames
9. Server writes PCM to FIFO
10. Sox shim outputs PCM to Claude Code
11. User releases mic button
12. `voice_stop` sent — server closes FIFO, releases spacebar
13. Sox shim gets EOF, Claude Code receives complete audio
14. Claude Code sends audio to Whisper, gets transcription
15. Transcription appears in Claude Code prompt

## Edge Cases

**FIFO timing race:** Sox must open the FIFO before audio is lost. The server buffers the first ~500ms of audio in memory while waiting for the shim to open the read end. Once the FIFO write-open succeeds (indicating reader is connected), flush the buffer.

**Double-press:** If user rapidly presses/releases, debounce with 200ms minimum hold time. Ignore sub-200ms presses.

**Claude Code not in voice mode:** If user hasn't run `/voice`, the spacebar press just types a space. No harm done — FIFO is created/destroyed but sox is never called. Could detect this and show a tooltip: "Enable /voice in Claude Code first."

**WebSocket disconnect during voice:** `cleanupSession()` already handles cleanup. Add FIFO unlink to the cleanup path.

**Sox shim not installed:** On first voice attempt, check if shim exists. If not, auto-install it and notify user.

**Non-agent sessions:** Mic button hidden. Voice only works with agent terminal type.

**Multiple concurrent voice sessions:** Each session has its own FIFO (`/tmp/rdv-voice-{sessionId}.fifo`) and its own `RDV_SESSION_ID` env var. No conflicts.

## Audio Format Details

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Sample rate | 16000 Hz | Standard for speech recognition / Whisper |
| Bit depth | 16-bit | Matches sox `--bits 16` |
| Channels | 1 (mono) | Speech is mono |
| Encoding | Signed integer, little-endian | Matches sox `--encoding signed-integer` |
| Container | Raw PCM (headerless) | FIFO is a stream, no seeking for headers |

Browser AudioWorklet captures at the system sample rate (typically 44100 or 48000 Hz). Downsampling to 16kHz is done in the worklet processor using linear interpolation.

## Security Considerations

- FIFO created in `/tmp` with restrictive permissions (`0600`)
- FIFO path includes session ID (UUID) — not guessable
- Sox shim only activates when FIFO exists — no effect on normal sox usage
- Mic permission gated by browser — user must explicitly grant
- Binary WebSocket frames validated: must have correct prefix byte and active voice session

## Testing Strategy

- **Unit:** AudioWorklet PCM conversion (Float32 -> Int16, downsampling)
- **Unit:** Sox shim script — test fallthrough, test FIFO read
- **Integration:** WebSocket voice_start/stop lifecycle
- **Integration:** FIFO creation/cleanup on disconnect
- **E2E:** Full flow with mock sox (verify PCM arrives correctly)

## Future Extensions

- Voice mode for other agents (Codex, Gemini) — same shim, different activation
- Browser-side STT fallback for non-agent sessions (Approach C)
- Always-listening mode with VAD (voice activity detection)
- Audio output: pipe Claude Code's TTS back to browser (reverse direction)
