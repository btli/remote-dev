import { describe, it, expect } from "vitest";
import { resolveExternalOrigin } from "@/lib/request-origin";

// Build a header getter from a plain map (case-insensitive like real Headers).
function hdr(map: Record<string, string>): (n: string) => string | null {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return (n) => lower[n.toLowerCase()] ?? null;
}

describe("resolveExternalOrigin", () => {
  it("uses x-forwarded-host + x-forwarded-proto (Cloudflare tunnel / Traefik)", () => {
    expect(
      resolveExternalOrigin(hdr({ "x-forwarded-host": "dev.example.com", "x-forwarded-proto": "https" }), "http://localhost:54928"),
    ).toBe("https://dev.example.com");
  });
  it("prefers x-forwarded-host over host", () => {
    expect(
      resolveExternalOrigin(hdr({ "x-forwarded-host": "rdv.example.com", host: "localhost:3000", "x-forwarded-proto": "https" }), "http://localhost:3000"),
    ).toBe("https://rdv.example.com");
  });
  it("defaults to https for a real host when x-forwarded-proto is absent", () => {
    expect(resolveExternalOrigin(hdr({ host: "dev.example.com" }), "http://localhost:54928")).toBe("https://dev.example.com");
  });
  it("uses http for loopback dev (no forwarded headers)", () => {
    expect(resolveExternalOrigin(hdr({ host: "localhost:6001" }), "http://localhost:6001")).toBe("http://localhost:6001");
  });
  it("takes the first value of a comma-separated forwarded chain", () => {
    expect(
      resolveExternalOrigin(hdr({ "x-forwarded-host": "dev.example.com, internal-lb", "x-forwarded-proto": "https, http" }), "http://localhost:1"),
    ).toBe("https://dev.example.com");
  });
  it("falls back to the internal origin when no host header is present", () => {
    expect(resolveExternalOrigin(hdr({}), "http://localhost:54928")).toBe("http://localhost:54928");
  });
  it("produces the right absolute redirect target via new URL()", () => {
    const single = resolveExternalOrigin(hdr({ "x-forwarded-host": "dev.example.com", "x-forwarded-proto": "https" }), "http://localhost:54928");
    expect(new URL("/login", single).href).toBe("https://dev.example.com/login");
    const instance = resolveExternalOrigin(hdr({ "x-forwarded-host": "rdv.example.com", "x-forwarded-proto": "https" }), "http://localhost:3000");
    expect(new URL("/dev/login", instance).href).toBe("https://rdv.example.com/dev/login");
  });
});
