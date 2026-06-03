import { describe, it, expect } from "vitest";
import { collectSessionCookies, encodeAuthCookies } from "@/lib/mobile-callback";

const store = (pairs: [string, string][]) => ({
  getAll: () => pairs.map(([name, value]) => ({ name, value })),
});

describe("collectSessionCookies", () => {
  it("returns the single unchunked cookie at the given path", () => {
    expect(
      collectSessionCookies(
        store([["__Secure-rdv-demo-session-token", "abc"]]),
        "__Secure-rdv-demo-session-token",
        "/demo",
      ),
    ).toEqual([{ name: "__Secure-rdv-demo-session-token", value: "abc", path: "/demo" }]);
  });

  it("collects chunks in numeric order", () => {
    expect(
      collectSessionCookies(
        store([
          ["__Secure-rdv-demo-session-token.1", "B"],
          ["__Secure-rdv-demo-session-token.0", "A"],
        ]),
        "__Secure-rdv-demo-session-token",
        "/demo",
      ).map((c) => c.value),
    ).toEqual(["A", "B"]);
  });

  it("does not substring-match siblings", () => {
    expect(
      collectSessionCookies(
        store([
          ["__Secure-rdv-demo-session-token", "A"],
          ["__Secure-rdv-demo-callback-url", "X"],
        ]),
        "__Secure-rdv-demo-session-token",
        "/demo",
      ),
    ).toHaveLength(1);
  });

  it("returns [] when absent", () => {
    expect(collectSessionCookies(store([]), "x", "/")).toEqual([]);
  });
});

describe("encodeAuthCookies", () => {
  it("round-trips via base64url JSON", () => {
    const enc = encodeAuthCookies([{ name: "a", value: "b", path: "/" }]);
    expect(enc).not.toMatch(/[+/=]/);
    expect(JSON.parse(Buffer.from(enc, "base64url").toString())).toEqual([
      { name: "a", value: "b", path: "/" },
    ]);
  });
});
