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
