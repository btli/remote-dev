import { describe, expect, it } from "vitest";
import {
  decideRoute,
  firstSegment,
  upstreamAuthority,
  type AllowlistLookup,
  type RouteEntry,
} from "@/lib/router-core";

/** A ready entry for a slug, matching the §15 B2 namespace model. */
function entryFor(slug: string): RouteEntry {
  return {
    namespace: `rdv-${slug}`,
    service: "rdv",
    httpPort: 6001,
    wsPort: 6002,
    ready: true,
  };
}

/** A fixed allowlist with only the given slugs ready. */
function allowlistOf(...slugs: string[]): AllowlistLookup {
  const map = new Map(slugs.map((s) => [s, entryFor(s)] as const));
  return { lookup: (slug) => map.get(slug) };
}

const EMPTY: AllowlistLookup = { lookup: () => undefined };

describe("firstSegment", () => {
  it("returns the first path segment", () => {
    expect(firstSegment("/alpha/api/foo")).toBe("alpha");
    expect(firstSegment("/alpha")).toBe("alpha");
    expect(firstSegment("/alpha/")).toBe("alpha");
  });

  it("returns empty for root", () => {
    expect(firstSegment("/")).toBe("");
    expect(firstSegment("")).toBe("");
  });
});

describe("upstreamAuthority", () => {
  it("builds <service>.<namespace>.svc.cluster.local", () => {
    expect(upstreamAuthority(entryFor("alpha"))).toBe(
      "rdv.rdv-alpha.svc.cluster.local",
    );
  });
});

describe("decideRoute — local responses", () => {
  it("/healthz → health (never proxied, even though it's a reserved slug)", () => {
    expect(decideRoute("/healthz", false, EMPTY)).toEqual({ kind: "health" });
  });

  it("root / → landing", () => {
    expect(decideRoute("/", false, EMPTY)).toEqual({ kind: "landing" });
  });

  it.each(["api", "_next", "login", "readyz", "supervisor", "icons"])(
    "reserved first segment %s → landing (not proxied)",
    (slug) => {
      // Even if such a slug were somehow in the allowlist, reserved wins.
      expect(decideRoute(`/${slug}/whatever`, false, allowlistOf(slug))).toEqual(
        { kind: "landing" },
      );
    },
  );

  it("healthz as a deeper path (not exactly /healthz) → landing (reserved)", () => {
    expect(decideRoute("/healthz/sub", false, EMPTY)).toEqual({
      kind: "landing",
    });
  });
});

describe("decideRoute — not found", () => {
  it.each([
    "/1bad/foo", // must start with a letter
    "/Bad/foo", // uppercase not allowed
    "/has_underscore/x", // underscore not allowed
    "/way-too-long-slug-here/x", // > 15 chars
    "/has.dot/x", // dot not allowed
  ])("malformed slug %s → not-found", (pathname) => {
    expect(decideRoute(pathname, false, EMPTY)).toEqual({ kind: "not-found" });
  });

  it("valid slug not in the allowlist → not-found", () => {
    expect(decideRoute("/ghost/api/x", false, allowlistOf("alpha"))).toEqual({
      kind: "not-found",
    });
  });
});

describe("decideRoute — encoded-slash / double-slash safety (Fix 6)", () => {
  // `index.ts` derives the pathname from `new URL(req.url).pathname`, which does
  // NOT decode `%2F`. These cases lock in that first-segment extraction can never
  // be tricked into emitting a proxy decision via encoded/extra slashes — even
  // when `alpha` IS in the allowlist.
  const al = allowlistOf("alpha");

  it.each([
    "/%2Falpha/x", // encoded leading slash → segment "%2Falpha" (invalid)
    "/%252F/x", // double-encoded slash → segment "%252F" (invalid)
    "/alpha%2Fevil/x", // encoded slash inside the first segment (invalid)
    "/%2e%2e/x", // encoded dot-dot (invalid)
  ])("%s never proxies (→ not-found)", (pathname) => {
    const d = decideRoute(pathname, false, al);
    expect(d.kind).toBe("not-found");
    expect(d.kind).not.toBe("proxy-http");
    expect(d.kind).not.toBe("proxy-ws");
  });

  it("//alpha/x (leading double slash) → empty first segment → landing, never proxied", () => {
    const d = decideRoute("//alpha/x", false, al);
    expect(d.kind).toBe("landing");
    expect(d.kind).not.toBe("proxy-http");
  });

  it("an encoded-slash path under a WS upgrade also never proxies", () => {
    const d = decideRoute("/%2Falpha/ws", true, al);
    expect(d.kind).toBe("not-found");
    expect(d.kind).not.toBe("proxy-ws");
  });
});

describe("decideRoute — HTTP proxy (no prefix stripping)", () => {
  it("known ready slug → proxy-http to :6001 with UNCHANGED path", () => {
    const d = decideRoute("/alpha/api/sessions", false, allowlistOf("alpha"));
    expect(d).toEqual({
      kind: "proxy-http",
      upstreamBase: "http://rdv.rdv-alpha.svc.cluster.local:6001",
      path: "/alpha/api/sessions",
      slug: "alpha",
    });
  });

  it("bare /<slug> → proxy-http with the slug path preserved", () => {
    const d = decideRoute("/alpha", false, allowlistOf("alpha"));
    expect(d).toMatchObject({
      kind: "proxy-http",
      upstreamBase: "http://rdv.rdv-alpha.svc.cluster.local:6001",
      path: "/alpha",
    });
  });

  it("/<slug>/ws as a NON-upgrade request → HTTP proxy (not WS)", () => {
    const d = decideRoute("/alpha/ws", false, allowlistOf("alpha"));
    expect(d).toMatchObject({
      kind: "proxy-http",
      path: "/alpha/ws",
      upstreamBase: "http://rdv.rdv-alpha.svc.cluster.local:6001",
    });
  });

  it("a hyphenated slug resolves to its rdv-<slug> namespace", () => {
    const d = decideRoute("/my-inst/x", false, allowlistOf("my-inst"));
    expect(d).toMatchObject({
      kind: "proxy-http",
      upstreamBase: "http://rdv.rdv-my-inst.svc.cluster.local:6001",
      path: "/my-inst/x",
    });
  });
});

describe("decideRoute — WebSocket proxy", () => {
  it("/<slug>/ws upgrade → proxy-ws to :6002 with UNCHANGED path", () => {
    const d = decideRoute("/alpha/ws", true, allowlistOf("alpha"));
    expect(d).toEqual({
      kind: "proxy-ws",
      upstreamWsBase: "ws://rdv.rdv-alpha.svc.cluster.local:6002",
      path: "/alpha/ws",
      slug: "alpha",
    });
  });

  it("an upgrade to a NON-/ws path under the slug → HTTP proxy (only /ws is the WS)", () => {
    // Upgrade header present but path isn't the terminal WS endpoint.
    const d = decideRoute("/alpha/api/other", true, allowlistOf("alpha"));
    expect(d).toMatchObject({ kind: "proxy-http", path: "/alpha/api/other" });
  });

  it("upgrade for an unknown slug → not-found (allowlist gate applies first)", () => {
    expect(decideRoute("/ghost/ws", true, allowlistOf("alpha"))).toEqual({
      kind: "not-found",
    });
  });
});

describe("decideRoute — uses the entry's own ports/namespace", () => {
  it("honours non-default ports/namespace from the route entry", () => {
    const custom: AllowlistLookup = {
      lookup: (slug) =>
        slug === "beta"
          ? {
              namespace: "rdv-beta",
              service: "rdv",
              httpPort: 7001,
              wsPort: 7002,
              ready: true,
            }
          : undefined,
    };
    expect(decideRoute("/beta/x", false, custom)).toMatchObject({
      kind: "proxy-http",
      upstreamBase: "http://rdv.rdv-beta.svc.cluster.local:7001",
    });
    expect(decideRoute("/beta/ws", true, custom)).toMatchObject({
      kind: "proxy-ws",
      upstreamWsBase: "ws://rdv.rdv-beta.svc.cluster.local:7002",
    });
  });
});
