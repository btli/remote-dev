// @vitest-environment node
/**
 * [n6uc.9] execFileCapped: byte-bounded stdout capture that never throws on
 * overflow (unlike execFile's maxBuffer) and reports a `truncated` flag. This is
 * what lets the diff route surface "too large" with a partial body.
 */
import { describe, it, expect } from "vitest";
import { execFileCapped } from "../exec";

describe("execFileCapped", () => {
  it("returns full stdout + truncated:false when under the cap", async () => {
    const res = await execFileCapped("printf", ["hello"], {
      maxBytes: 1024,
    });
    expect(res.stdout).toBe("hello");
    expect(res.truncated).toBe(false);
    expect(res.exitCode).toBe(0);
    expect(res.bytes).toBe(5);
  });

  it("caps stdout at maxBytes and flags truncated for large output", async () => {
    // Emit ~1MB of zeros; cap at 1000 bytes.
    const res = await execFileCapped(
      "sh",
      ["-c", "head -c 1000000 /dev/zero | tr '\\0' 'a'"],
      { maxBytes: 1000 },
    );
    expect(res.truncated).toBe(true);
    // Captured body never exceeds the cap.
    expect(Buffer.byteLength(res.stdout)).toBeLessThanOrEqual(1000);
    // We still counted (at least) the captured bytes.
    expect(res.bytes).toBeGreaterThanOrEqual(1000);
  });

  it("flags truncated when the process exceeds the timeout", async () => {
    const res = await execFileCapped("sh", ["-c", "sleep 5; echo done"], {
      timeout: 150,
      maxBytes: 1024,
    });
    expect(res.truncated).toBe(true);
    expect(res.stdout).not.toContain("done");
  });
});
