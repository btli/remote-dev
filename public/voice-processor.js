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

    const channelData = input[0];
    const downsampled = this.downsample(channelData, sampleRate);

    this._buffer.push(downsampled);
    this._bufferSize += downsampled.length;

    if (this._bufferSize >= this._targetSamples) {
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
