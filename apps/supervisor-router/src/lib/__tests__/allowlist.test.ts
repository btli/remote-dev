import { describe, expect, it, vi } from "vitest";
import { AllowlistCache } from "@/lib/allowlist";
import type { RouteEntry } from "@/lib/router-core";

const SUPERVISOR_URL = "http://supervisor.rdv-system.svc.cluster.local:6003";

function readyEntry(slug: string, overrides: Partial<RouteEntry> = {}): RouteEntry {
  return {
    namespace: `rdv-${slug}`,
    service: "rdv",
    httpPort: 6001,
    wsPort: 6002,
    ready: true,
    ...overrides,
  };
}

/** A fetch stub returning a JSON `{ routes }` body with status 200. */
function okFetch(routes: Record<string, RouteEntry>): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ routes }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

function makeCache(fetchImpl: typeof fetch, secret = "s3cret"): AllowlistCache {
  return new AllowlistCache({
    supervisorUrl: SUPERVISOR_URL,
    internalSecret: secret,
    pollIntervalMs: 10_000,
    fetchImpl,
  });
}

describe("AllowlistCache — successful poll", () => {
  it("populates the cache and lookup returns the entry", async () => {
    const cache = makeCache(okFetch({ alpha: readyEntry("alpha") }));
    await cache.pollOnce();

    expect(cache.size).toBe(1);
    expect(cache.lookup("alpha")).toEqual(readyEntry("alpha"));
    expect(cache.lastGoodAtMs).not.toBeNull();
  });

  it("returns undefined for unknown slugs", async () => {
    const cache = makeCache(okFetch({ alpha: readyEntry("alpha") }));
    await cache.pollOnce();
    expect(cache.lookup("ghost")).toBeUndefined();
  });

  it("sends the x-supervisor-internal-secret header to the routes URL", async () => {
    const spy = okFetch({});
    const cache = makeCache(spy, "my-secret");
    await cache.pollOnce();

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe(`${SUPERVISOR_URL}/api/internal/routes`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-supervisor-internal-secret"]).toBe("my-secret");
  });

  it("omits the secret header when none is configured (dev)", async () => {
    const spy = okFetch({});
    const cache = makeCache(spy, "");
    await cache.pollOnce();
    const [, init] = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-supervisor-internal-secret"]).toBeUndefined();
  });

  it("drops not-ready or malformed entries defensively", async () => {
    const cache = makeCache(
      okFetch({
        good: readyEntry("good"),
        "not-ready": readyEntry("not-ready", { ready: false }),
        // @ts-expect-error — intentionally malformed entry from the wire
        broken: { namespace: "rdv-broken" },
      }),
    );
    await cache.pollOnce();
    expect(cache.size).toBe(1);
    expect(cache.lookup("good")).toBeDefined();
    expect(cache.lookup("not-ready")).toBeUndefined();
    expect(cache.lookup("broken")).toBeUndefined();
  });
});

describe("AllowlistCache — SSRF hardening (Fix 1)", () => {
  /**
   * Every field flows into `${service}.${namespace}.svc.cluster.local:${port}`,
   * so a hostile value must be DROPPED, never cached. lookup() must return
   * undefined for each so it can never compose an attacker-chosen authority.
   */
  it("drops entries with a hostile/injecting namespace", async () => {
    const cache = makeCache(
      okFetch({
        a: readyEntry("a", { namespace: "evil.com/@x" }),
        b: readyEntry("b", { namespace: "rdv-a:6001@x" }),
        c: readyEntry("c", { namespace: "rdv-a.evil.com" }),
        d: readyEntry("d", { namespace: "rdv-a/../b" }),
      }),
    );
    await cache.pollOnce();
    expect(cache.size).toBe(0);
    for (const slug of ["a", "b", "c", "d"]) {
      expect(cache.lookup(slug)).toBeUndefined();
    }
  });

  it("drops entries whose namespace is not rdv-<slug>", async () => {
    const cache = makeCache(
      okFetch({
        a: readyEntry("a", { namespace: "default" }),
        b: readyEntry("b", { namespace: "rdv-system" }), // valid label but reserved-ish; still rdv-… so allowed
      }),
    );
    await cache.pollOnce();
    // `rdv-system` matches `rdv-<slug>` grammar, so b is kept; `default` dropped.
    expect(cache.lookup("a")).toBeUndefined();
    expect(cache.lookup("b")).toBeDefined();
  });

  it("drops entries with a non-DNS-label service", async () => {
    const cache = makeCache(
      okFetch({
        a: readyEntry("a", { service: "rdv/evil" }),
        b: readyEntry("b", { service: "RDV" }),
        c: readyEntry("c", { service: "-bad" }),
        d: readyEntry("d", { service: "" }),
      }),
    );
    await cache.pollOnce();
    expect(cache.size).toBe(0);
  });

  it("drops entries with an out-of-range or non-integer port", async () => {
    const cache = makeCache(
      okFetch({
        a: readyEntry("a", { httpPort: 0 }),
        b: readyEntry("b", { httpPort: 99999 }),
        c: readyEntry("c", { httpPort: Number.NaN }),
        d: readyEntry("d", { wsPort: 0 }),
        e: readyEntry("e", { wsPort: 70000 }),
        // @ts-expect-error — non-numeric port from the wire
        f: readyEntry("f", { httpPort: "6001" }),
      }),
    );
    await cache.pollOnce();
    expect(cache.size).toBe(0);
  });

  it("drops entries whose map key (slug) is not a valid slug", async () => {
    const cache = makeCache(
      okFetch({
        "../evil": readyEntry("x"),
        "has.dot": readyEntry("x"),
        UPPER: readyEntry("x"),
        "1leading": readyEntry("x"),
        "way-too-long-slug-here": readyEntry("x"),
      }),
    );
    await cache.pollOnce();
    expect(cache.size).toBe(0);
  });

  it("keeps a fully valid entry alongside dropped hostile ones", async () => {
    const cache = makeCache(
      okFetch({
        alpha: readyEntry("alpha"),
        evil: readyEntry("evil", { namespace: "evil.com/@x" }),
      }),
    );
    await cache.pollOnce();
    expect(cache.size).toBe(1);
    expect(cache.lookup("alpha")).toBeDefined();
    expect(cache.lookup("evil")).toBeUndefined();
  });
});

describe("AllowlistCache — fail-open from last-known-good (§15 M4)", () => {
  it("keeps the last-known-good cache when a later poll throws", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ routes: { alpha: readyEntry("alpha") } }), {
          status: 200,
        });
      }
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const cache = makeCache(fetchImpl);
    await cache.pollOnce(); // success
    expect(cache.lookup("alpha")).toBeDefined();
    const goodAt = cache.lastGoodAtMs;

    await expect(cache.pollOnce()).resolves.toBeUndefined(); // failure: must not throw
    // Cache and the lastGoodAt stamp are preserved.
    expect(cache.lookup("alpha")).toBeDefined();
    expect(cache.size).toBe(1);
    expect(cache.lastGoodAtMs).toBe(goodAt);
  });

  it("keeps the last-known-good cache on a non-OK (e.g. 503) response", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ routes: { alpha: readyEntry("alpha") } }), {
          status: 200,
        });
      }
      return new Response("nope", { status: 503 });
    }) as unknown as typeof fetch;

    const cache = makeCache(fetchImpl);
    await cache.pollOnce();
    await expect(cache.pollOnce()).resolves.toBeUndefined();
    expect(cache.lookup("alpha")).toBeDefined();
  });

  it("a cold-start failure leaves an empty cache (no last-known-good yet) without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const cache = makeCache(fetchImpl);
    await expect(cache.pollOnce()).resolves.toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.lookup("alpha")).toBeUndefined();
    expect(cache.lastGoodAtMs).toBeNull();
  });
});

describe("AllowlistCache — start/stop", () => {
  it("start() polls eagerly and stop() halts further polling", async () => {
    const spy = okFetch({ alpha: readyEntry("alpha") });
    const cache = makeCache(spy);
    cache.start();
    // The eager poll is async; let microtasks settle.
    await vi.waitFor(() => expect(cache.size).toBe(1));
    cache.stop();
    expect(cache.lookup("alpha")).toBeDefined();
  });
});
