import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transformAnsiColors, createColorTransformer } from "./ansi-color-transform";

describe("ANSI Color Transform", () => {
  // Suppress console.log during tests
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("transformAnsiColors", () => {
    describe("light mode transformations", () => {
      it("converts very light foreground to semantic default", () => {
        // White text (255,255,255) - luminance = 255
        const input = "\x1b[38;2;255;255;255mHello\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).toContain("\x1b[39m"); // Semantic default foreground
      });

      it("converts near-white foreground to semantic default", () => {
        // Light gray text (220,220,220) - luminance = 220
        const input = "\x1b[38;2;220;220;220mHello\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).toContain("\x1b[39m"); // Semantic default foreground
      });

      it("converts dark foreground to semantic default in light mode", () => {
        // Very dark text (30,30,30) - luminance = 30
        const input = "\x1b[38;2;30;30;30mHello\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).toContain("\x1b[39m"); // Semantic default foreground
      });

      it("converts dark background to semantic default", () => {
        // Dark gray background (55,55,55) - luminance = 55
        const input = "\x1b[48;2;55;55;55mHello\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).toContain("\x1b[49m"); // Semantic default background
      });

      it("converts very light background to semantic default", () => {
        // Very light background (240,240,240) - luminance = 240
        const input = "\x1b[48;2;240;240;240mHello\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).toContain("\x1b[49m"); // Semantic default background
      });

      it("maps saturated red background to pastel pink", () => {
        // Saturated red background that's above luminance 80 threshold
        // 150,60,60 → lum = 0.299*150 + 0.587*60 + 0.114*60 = 44.85+35.22+6.84 = 86.91
        // Also within red range: r=[80,180], g=[20,80], b=[20,80]
        const input = "\x1b[48;2;150;60;60mDeleted\x1b[0m";
        const output = transformAnsiColors(input, "light");
        // Should contain pastel pink: 252,228,228
        expect(output).toContain("252;228;228");
      });

      it("maps saturated green background to pastel green", () => {
        // Saturated green background that's above luminance 80 threshold
        // 60,140,70 → lum = 0.299*60 + 0.587*140 + 0.114*70 = 17.94+82.18+7.98 = 108.1
        // Also within green range: r=[20,80], g=[70,160], b=[20,90]
        const input = "\x1b[48;2;60;140;70mAdded\x1b[0m";
        const output = transformAnsiColors(input, "light");
        // Should contain pastel green: 228,245,228
        expect(output).toContain("228;245;228");
      });

      it("converts low-luminance blue backgrounds to semantic default", () => {
        // Dark blue background (50,50,150) - luminance = 0.299*50 + 0.587*50 + 0.114*150 = 61.43 < 80
        // Should be converted to semantic default (not color mapping)
        const input = "\x1b[48;2;50;50;150mInfo\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).toContain("\x1b[49m"); // Semantic default background
      });
    });

    describe("dark mode transformations", () => {
      it("preserves most colors in dark mode", () => {
        // Medium gray text should be preserved
        const input = "\x1b[38;2;128;128;128mText\x1b[0m";
        const output = transformAnsiColors(input, "dark");
        // Should be unchanged (128,128,128 has luminance ~128)
        expect(output).toBe(input);
      });

      it("still converts very dark foreground to semantic default", () => {
        // Very dark text (30,30,30) - luminance = 30
        const input = "\x1b[38;2;30;30;30mHello\x1b[0m";
        const output = transformAnsiColors(input, "dark");
        expect(output).toContain("\x1b[39m");
      });

      it("still converts very light foreground to semantic default", () => {
        // Very light text (250,250,250) - luminance > 200
        const input = "\x1b[38;2;250;250;250mHello\x1b[0m";
        const output = transformAnsiColors(input, "dark");
        expect(output).toContain("\x1b[39m");
      });
    });

    describe("edge cases", () => {
      it("handles text without ANSI codes", () => {
        const input = "Plain text without colors";
        const output = transformAnsiColors(input, "light");
        expect(output).toBe(input);
      });

      it("handles empty string", () => {
        const output = transformAnsiColors("", "light");
        expect(output).toBe("");
      });

      it("handles regular ANSI codes (non-24bit)", () => {
        // Standard 16-color ANSI codes should be unchanged
        const input = "\x1b[31mRed\x1b[0m \x1b[32mGreen\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).toBe(input);
      });

      it("handles combined foreground and background sequences", () => {
        // Combined: fg white, bg dark gray
        const input = "\x1b[38;2;255;255;255;48;2;50;50;50mText\x1b[0m";
        const output = transformAnsiColors(input, "light");
        // Should have semantic codes
        expect(output).toContain("\x1b[39"); // fg default
      });

      it("handles multiple 24-bit sequences in one string", () => {
        const input =
          "\x1b[38;2;255;255;255mWhite\x1b[0m and \x1b[38;2;200;200;200mGray\x1b[0m";
        const output = transformAnsiColors(input, "light");
        // First should be transformed (255 > 200)
        expect(output).toContain("\x1b[39m");
        // Second should also be transformed (200 == 200, borderline)
        expect(output).not.toContain("255;255;255");
      });

      it("preserves mid-range colors that don't need transformation", () => {
        // A medium orange color that shouldn't match any mapping
        const input = "\x1b[38;2;180;120;60mOrange\x1b[0m";
        const output = transformAnsiColors(input, "light");
        // Luminance = 0.299*180 + 0.587*120 + 0.114*60 = 53.82+70.44+6.84 = 131
        // This is in the safe range (50-200), should be unchanged
        expect(output).toBe(input);
      });
    });

    describe("luminance thresholds", () => {
      it("uses luminance > 200 threshold for light foreground", () => {
        // luminance = 201 → should transform
        const input201 = "\x1b[38;2;201;201;201mTest\x1b[0m"; // lum ≈ 201
        const output201 = transformAnsiColors(input201, "light");
        expect(output201).toContain("\x1b[39m");

        // luminance = 199 → should NOT transform
        const input199 = "\x1b[38;2;199;199;199mTest\x1b[0m"; // lum ≈ 199
        const output199 = transformAnsiColors(input199, "light");
        expect(output199).toBe(input199);
      });

      it("uses luminance < 50 threshold for dark foreground", () => {
        // luminance = 49 → should transform
        const input49 = "\x1b[38;2;49;49;49mTest\x1b[0m"; // lum ≈ 49
        const output49 = transformAnsiColors(input49, "light");
        expect(output49).toContain("\x1b[39m");

        // luminance = 51 → should NOT transform
        const input51 = "\x1b[38;2;51;51;51mTest\x1b[0m"; // lum ≈ 51
        const output51 = transformAnsiColors(input51, "light");
        expect(output51).toBe(input51);
      });

      it("uses luminance < 80 threshold for dark background", () => {
        // luminance = 79 → should transform
        const input79 = "\x1b[48;2;79;79;79mTest\x1b[0m"; // lum ≈ 79
        const output79 = transformAnsiColors(input79, "light");
        expect(output79).toContain("\x1b[49m");

        // luminance = 81 → should NOT transform (unless in color mapping)
        const input81 = "\x1b[48;2;81;81;81mTest\x1b[0m"; // lum ≈ 81
        const output81 = transformAnsiColors(input81, "light");
        expect(output81).toBe(input81);
      });

      it("uses luminance > 220 threshold for light background", () => {
        // luminance = 221 → should transform
        const input221 = "\x1b[48;2;221;221;221mTest\x1b[0m"; // lum ≈ 221
        const output221 = transformAnsiColors(input221, "light");
        expect(output221).toContain("\x1b[49m");

        // luminance = 219 → should NOT transform
        const input219 = "\x1b[48;2;219;219;219mTest\x1b[0m"; // lum ≈ 219
        const output219 = transformAnsiColors(input219, "light");
        expect(output219).toBe(input219);
      });
    });
  });

  describe("createColorTransformer", () => {
    it("creates a transformer function for light mode", () => {
      const transformer = createColorTransformer("light");
      expect(typeof transformer).toBe("function");

      const input = "\x1b[38;2;255;255;255mWhite\x1b[0m";
      const output = transformer(input);
      expect(output).toContain("\x1b[39m");
    });

    it("creates a transformer function for dark mode", () => {
      const transformer = createColorTransformer("dark");
      expect(typeof transformer).toBe("function");

      const input = "\x1b[38;2;128;128;128mGray\x1b[0m";
      const output = transformer(input);
      // Mid-gray should be preserved in dark mode
      expect(output).toBe(input);
    });

    it("returns same result as direct function call", () => {
      const input = "\x1b[48;2;120;50;50mRed bg\x1b[0m";

      const transformer = createColorTransformer("light");
      const transformerOutput = transformer(input);
      const directOutput = transformAnsiColors(input, "light");

      expect(transformerOutput).toBe(directOutput);
    });
  });

  describe("color mapping ranges", () => {
    describe("red background mapping (diff deletions)", () => {
      it("transforms colors in the red range", () => {
        // Within red range: r=[80,180], g=[20,80], b=[20,80]
        // Use values with luminance > 80: 140,60,60 → lum = 0.299*140 + 0.587*60 + 0.114*60 = 83.28
        const input = "\x1b[48;2;140;60;60mDeleted\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).toContain("252;228;228");
      });

      it("does not transform colors outside red range", () => {
        // Outside red range (g too high, and luminance > 80)
        const input = "\x1b[48;2;100;100;40mNotRed\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).not.toContain("252;228;228");
      });
    });

    describe("green background mapping (diff additions)", () => {
      it("transforms colors in the green range", () => {
        // Within green range: r=[20,80], g=[70,160], b=[20,90]
        // Use values with luminance > 80: 60,140,60 → lum = 0.299*60 + 0.587*140 + 0.114*60 = 106.98
        const input = "\x1b[48;2;60;140;60mAdded\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).toContain("228;245;228");
      });

      it("does not transform colors outside green range", () => {
        // Outside green range (r too high, and luminance > 80)
        const input = "\x1b[48;2;100;120;50mNotGreen\x1b[0m";
        const output = transformAnsiColors(input, "light");
        expect(output).not.toContain("228;245;228");
      });
    });
  });
});
