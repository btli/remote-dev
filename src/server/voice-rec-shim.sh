#!/bin/bash
# Remote Dev rec shim — redirects audio input from FIFO when voice mode is active.
# `rec` is equivalent to `sox --default-device` for recording.
# When Claude Code spawns rec to capture mic audio, this shim reads from the
# voice FIFO instead of CoreAudio.
# For all other rec operations, passes through to the real binary.

# Find the real rec binary (skip this shim in PATH)
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_REC=""
IFS=':' read -ra PATH_DIRS <<< "$PATH"
for dir in "${PATH_DIRS[@]}"; do
  if [[ "$dir" != "$SELF_DIR" ]] && [[ -x "$dir/rec" ]]; then
    REAL_REC="$dir/rec"
    break
  fi
done

if [[ -z "$REAL_REC" ]]; then
  echo "Error: real rec not found in PATH" >&2
  exit 1
fi

# Voice FIFO path uses session ID from environment
VOICE_FIFO="/tmp/rdv-voice-${RDV_SESSION_ID}.fifo"

# rec is always a recording operation — if our voice FIFO exists, read from it
if [[ -n "$RDV_SESSION_ID" ]] && [[ -p "$VOICE_FIFO" ]]; then
  # The FIFO contains: 16kHz, 16-bit signed integer, mono, little-endian
  cat "$VOICE_FIFO"
else
  # Pass through to real rec for all other operations
  exec "$REAL_REC" "$@"
fi
