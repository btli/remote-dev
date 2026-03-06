// src/__tests__/voice-processor.test.ts
import { describe, it, expect } from "vitest";

// Extract pure functions for testing (AudioWorklet can't run in Node)
function downsample(
  input: Float32Array,
  sourceSampleRate: number
): Float32Array {
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
