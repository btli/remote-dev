import { describe, expect, it } from "vitest";
import {
  decideRoute,
  firstSegment,
  upstreamAuthority,
  type AllowlistLookup,
  type RouteEntry,
  type SupervisorBases,
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

/** The default upstream: the Supervisor dashboard on the same host (Option C). */
const SUP: SupervisorBases = {
  httpBase: "http://supervisor.rdv-system.svc.cluster.local:6003",
  wsBase: "ws://supervisor.rdv-system.svc.cluster.local:6003",
};

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

describe("decideRoute — locally-answered paths", () => {
  it("/healthz → health (router liveness, never proxied — even though it's a reserved slug)", () => {
    expect(decideRoute("/healthz", false, EMPTY, SUP)).toEqual({
      kind: "health",
    });
  });

  it("/api/internal/routes → blocked (the allowlist endpoint is not exposed at the front door)", () => {
    expect(decideRoute("/api/internal/routes", false, EMPTY, SUP)).toEqual({
      kind: "blocked",
    });
  });

  it.each([
    "/api/internal", // the bare path (no trailing slash) is blocked too
    "/api/internal/anything",
    "/api/internal/",
    "/api/internal/deep/nested/path",
  ])("%s → blocked (defense-in-depth on the bare path + the whole /api/internal/* prefix)", (p) => {
    expect(decideRoute(p, false, EMPTY, SUP)).toEqual({ kind: "blocked" });
  });

  it("a /api/internal/* WS upgrade is still blocked (never proxied to the Supervisor)", () => {
    expect(decideRoute("/api/internal/routes", true, EMPTY, SUP)).toEqual({
      kind: "blocked",
    });
  });
});

describe("decideRoute — Supervisor dashboard is the DEFAULT upstream", () => {
  it("root / → proxy-http to the Supervisor base (UNCHANGED path, no strip)", () => {
    expect(decideRoute("/", false, EMPTY, SUP)).toEqual({
      kind: "proxy-http",
      upstreamBase: SUP.httpBase,
      path: "/",
      slug: "",
    });
  });

  it("/login → proxy-http to the Supervisor (it owns its own login)", () => {
    expect(decideRoute("/login", false, EMPTY, SUP)).toEqual({
      kind: "proxy-http",
      upstreamBase: SUP.httpBase,
      path: "/login",
      slug: "",
    });
  });

  it("/api/foo (reserved first segment 'api', NOT internal) → proxy-http to the Supervisor", () => {
    expect(decideRoute("/api/foo", false, EMPTY, SUP)).toEqual({
      kind: "proxy-http",
      upstreamBase: SUP.httpBase,
      path: "/api/foo",
      slug: "",
    });
  });

  it.each(["_next", "icons", "supervisor", "readyz"])(
    "reserved first segment %s → proxy-http to the Supervisor (even if such a slug were in the allowlist)",
    (slug) => {
      expect(
        decideRoute(`/${slug}/whatever`, false, allowlistOf(slug), SUP),
      ).toEqual({
        kind: "proxy-http",
        upstreamBase: SUP.httpBase,
        path: `/${slug}/whatever`,
        slug: "",
      });
    },
  );

  it("healthz as a deeper path (not exactly /healthz) → Supervisor (reserved, not the router probe)", () => {
    expect(decideRoute("/healthz/sub", false, EMPTY, SUP)).toEqual({
      kind: "proxy-http",
      upstreamBase: SUP.httpBase,
      path: "/healthz/sub",
      slug: "",
    });
  });

  it.each([
    "/1bad/foo", // must start with a letter
    "/Bad/foo", // uppercase not allowed
    "/has_underscore/x", // underscore not allowed
    "/way-too-long-slug-here/x", // > 15 chars
    "/has.dot/x", // dot not allowed
  ])("malformed slug %s → Supervisor (the dashboard 404s, the router does not)", (pathname) => {
    expect(decideRoute(pathname, false, EMPTY, SUP)).toEqual({
      kind: "proxy-http",
      upstreamBase: SUP.httpBase,
      path: pathname,
      slug: "",
    });
  });

  it("valid slug NOT in the allowlist → Supervisor (unknown/not-ready falls through to the dashboard)", () => {
    expect(decideRoute("/ghost/api/x", false, allowlistOf("alpha"), SUP)).toEqual({
      kind: "proxy-http",
      upstreamBase: SUP.httpBase,
      path: "/ghost/api/x",
      slug: "",
    });
  });

  it("a NON-instance WS upgrade (e.g. root /) → proxy-ws to the Supervisor ws base", () => {
    expect(decideRoute("/", true, EMPTY, SUP)).toEqual({
      kind: "proxy-ws",
      upstreamWsBase: SUP.wsBase,
      path: "/",
      slug: "",
    });
  });

  it("a WS upgrade for a valid-but-unknown slug → proxy-ws to the Supervisor (allowlist gates instances)", () => {
    expect(decideRoute("/ghost/ws", true, allowlistOf("alpha"), SUP)).toEqual({
      kind: "proxy-ws",
      upstreamWsBase: SUP.wsBase,
      path: "/ghost/ws",
      slug: "",
    });
  });
});

describe("decideRoute — encoded-slash / double-slash safety (Fix 6)", () => {
  // `index.ts` derives the pathname from `new URL(req.url).pathname`, which does
  // NOT decode `%2F`. These cases lock in that first-segment extraction can never
  // be tricked into emitting an INSTANCE proxy decision via encoded/extra slashes
  // — even when `alpha` IS in the allowlist. (They fall through to the Supervisor
  // default, which is safe — they never reach an instance authority.)
  const al = allowlistOf("alpha");

  it.each([
    "/%2Falpha/x", // encoded leading slash → segment "%2Falpha" (invalid)
    "/%252F/x", // double-encoded slash → segment "%252F" (invalid)
    "/alpha%2Fevil/x", // encoded slash inside the first segment (invalid)
    "/%2e%2e/x", // encoded dot-dot (invalid)
  ])("%s never proxies to an instance (→ Supervisor, not an instance authority)", (pathname) => {
    const d = decideRoute(pathname, false, al, SUP);
    expect(d).toEqual({
      kind: "proxy-http",
      upstreamBase: SUP.httpBase,
      path: pathname,
      slug: "",
    });
  });

  it("//alpha/x (leading double slash) → empty first segment → Supervisor, never an instance", () => {
    const d = decideRoute("//alpha/x", false, al, SUP);
    expect(d).toMatchObject({ kind: "proxy-http", upstreamBase: SUP.httpBase });
    expect(d).toMatchObject({ slug: "" });
  });

  it("an encoded-slash path under a WS upgrade also never proxies to an instance ws", () => {
    const d = decideRoute("/%2Falpha/ws", true, al, SUP);
    expect(d).toEqual({
      kind: "proxy-ws",
      upstreamWsBase: SUP.wsBase,
      path: "/%2Falpha/ws",
      slug: "",
    });
  });
});

describe("decideRoute — instance HTTP proxy (no prefix stripping)", () => {
  it("known ready slug → proxy-http to :6001 with UNCHANGED path", () => {
    const d = decideRoute(
      "/alpha/api/sessions",
      false,
      allowlistOf("alpha"),
      SUP,
    );
    expect(d).toEqual({
      kind: "proxy-http",
      upstreamBase: "http://rdv.rdv-alpha.svc.cluster.local:6001",
      path: "/alpha/api/sessions",
      slug: "alpha",
    });
  });

  it("bare /<slug> → proxy-http with the slug path preserved", () => {
    const d = decideRoute("/alpha", false, allowlistOf("alpha"), SUP);
    expect(d).toMatchObject({
      kind: "proxy-http",
      upstreamBase: "http://rdv.rdv-alpha.svc.cluster.local:6001",
      path: "/alpha",
      slug: "alpha",
    });
  });

  it("/<slug>/ws as a NON-upgrade request → HTTP proxy to the instance (not WS)", () => {
    const d = decideRoute("/alpha/ws", false, allowlistOf("alpha"), SUP);
    expect(d).toMatchObject({
      kind: "proxy-http",
      path: "/alpha/ws",
      upstreamBase: "http://rdv.rdv-alpha.svc.cluster.local:6001",
      slug: "alpha",
    });
  });

  it("a hyphenated slug resolves to its rdv-<slug> namespace", () => {
    const d = decideRoute("/my-inst/x", false, allowlistOf("my-inst"), SUP);
    expect(d).toMatchObject({
      kind: "proxy-http",
      upstreamBase: "http://rdv.rdv-my-inst.svc.cluster.local:6001",
      path: "/my-inst/x",
    });
  });

  it("an upgrade to a ready instance's NON-/ws path → HTTP proxy (only /ws upgrades to ws)", () => {
    // Upgrade header present but path isn't the terminal WS endpoint.
    const d = decideRoute("/alpha/api/other", true, allowlistOf("alpha"), SUP);
    expect(d).toMatchObject({
      kind: "proxy-http",
      path: "/alpha/api/other",
      upstreamBase: "http://rdv.rdv-alpha.svc.cluster.local:6001",
      slug: "alpha",
    });
  });
});

describe("decideRoute — instance WebSocket proxy", () => {
  it("/<slug>/ws upgrade (ready) → proxy-ws to the INSTANCE :6002 with UNCHANGED path", () => {
    const d = decideRoute("/alpha/ws", true, allowlistOf("alpha"), SUP);
    expect(d).toEqual({
      kind: "proxy-ws",
      upstreamWsBase: "ws://rdv.rdv-alpha.svc.cluster.local:6002",
      path: "/alpha/ws",
      slug: "alpha",
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
    expect(decideRoute("/beta/x", false, custom, SUP)).toMatchObject({
      kind: "proxy-http",
      upstreamBase: "http://rdv.rdv-beta.svc.cluster.local:7001",
    });
    expect(decideRoute("/beta/ws", true, custom, SUP)).toMatchObject({
      kind: "proxy-ws",
      upstreamWsBase: "ws://rdv.rdv-beta.svc.cluster.local:7002",
    });
  });
});
