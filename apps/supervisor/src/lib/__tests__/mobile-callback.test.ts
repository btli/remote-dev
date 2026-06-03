import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  collectSessionCookies,
  encodeAuthCookies,
  resolveSupervisorMobileCallback,
} from "../mobile-callback";
import type { AuthCookie } from "../mobile-callback";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Cookie store state — tests manipulate this directly.
type CookieEntry = { name: string; value: string };
const cookieJar: CookieEntry[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const found = cookieJar.find((c) => c.name === name);
      return found ? { value: found.value } : undefined;
    },
    getAll: () => cookieJar.map((c) => ({ name: c.name, value: c.value })),
  }),
  headers: async () => new Map(),
}));

// CF Access seam
const cfState: { user: { email: string; sub: string } | null } = { user: null };
vi.mock("@/lib/cf-access", () => ({
  validateAccessJWT: async () => cfState.user,
}));

// Supervisor user resolution seam
const userState: { id: string; email: string; role: string } = {
  id: "sup-user-1",
  email: "host@example.com",
  role: "admin",
};
const resolveSpy = vi.fn(async (_email: string) => userState);
vi.mock("@/lib/auth", () => ({
  resolveSupervisorUser: (email: string) => resolveSpy(email),
}));

// NextAuth auth() seam
const oidcState: { email: string | null } = { email: null };
vi.mock("@/auth", () => ({
  auth: async () =>
    oidcState.email ? { user: { email: oidcState.email } } : null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setCookie(name: string, value: string) {
  cookieJar.push({ name, value });
}

function clearCookies() {
  cookieJar.length = 0;
}

beforeEach(() => {
  clearCookies();
  cfState.user = null;
  oidcState.email = null;
  userState.id = "sup-user-1";
  userState.email = "host@example.com";
  userState.role = "admin";
  resolveSpy.mockClear();
});

// ---------------------------------------------------------------------------
// collectSessionCookies unit tests
// ---------------------------------------------------------------------------

describe("collectSessionCookies", () => {
  const makeStore = (entries: CookieEntry[]) => ({
    getAll: () => entries.map((e) => ({ name: e.name, value: e.value })),
  });

  it("returns [] when neither the base nor any chunk is present", () => {
    const store = makeStore([{ name: "other-cookie", value: "x" }]);
    expect(collectSessionCookies(store, "authjs.session-token", "/")).toEqual([]);
  });

  it("returns the base cookie alone when no chunks", () => {
    const store = makeStore([
      { name: "authjs.session-token", value: "base-value" },
    ]);
    const result = collectSessionCookies(store, "authjs.session-token", "/");
    expect(result).toEqual<AuthCookie[]>([
      { name: "authjs.session-token", value: "base-value", path: "/" },
    ]);
  });

  it("returns chunks in ascending numeric order when base is absent", () => {
    const store = makeStore([
      { name: "authjs.session-token.1", value: "chunk-1" },
      { name: "authjs.session-token.0", value: "chunk-0" },
    ]);
    const result = collectSessionCookies(store, "authjs.session-token", "/");
    expect(result).toEqual<AuthCookie[]>([
      { name: "authjs.session-token.0", value: "chunk-0", path: "/" },
      { name: "authjs.session-token.1", value: "chunk-1", path: "/" },
    ]);
  });

  it("returns base then chunks in numeric order", () => {
    const store = makeStore([
      { name: "authjs.session-token.1", value: "chunk-1" },
      { name: "authjs.session-token", value: "base" },
      { name: "authjs.session-token.0", value: "chunk-0" },
    ]);
    const result = collectSessionCookies(store, "authjs.session-token", "/");
    expect(result).toEqual<AuthCookie[]>([
      { name: "authjs.session-token", value: "base", path: "/" },
      { name: "authjs.session-token.0", value: "chunk-0", path: "/" },
      { name: "authjs.session-token.1", value: "chunk-1", path: "/" },
    ]);
  });

  it("does NOT capture cookies that merely contain the base name as a substring", () => {
    const store = makeStore([
      { name: "authjs.session-token-callback-url", value: "should-not-match" },
      { name: "authjs.session-token.abc", value: "non-numeric-suffix" },
      { name: "authjs.session-token", value: "real" },
    ]);
    const result = collectSessionCookies(store, "authjs.session-token", "/");
    // Only the exact base matches; the others must be excluded.
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("authjs.session-token");
  });

  it("uses the provided path for all returned cookies", () => {
    const store = makeStore([
      { name: "__Secure-authjs.session-token", value: "v" },
      { name: "__Secure-authjs.session-token.0", value: "c0" },
    ]);
    const result = collectSessionCookies(
      store,
      "__Secure-authjs.session-token",
      "/custom-path",
    );
    for (const c of result) {
      expect(c.path).toBe("/custom-path");
    }
  });
});

// ---------------------------------------------------------------------------
// encodeAuthCookies unit tests
// ---------------------------------------------------------------------------

describe("encodeAuthCookies", () => {
  it("produces a base64url string that round-trips back to the input", () => {
    const input: AuthCookie[] = [
      { name: "CF_Authorization", value: "ey.cf", path: "/" },
    ];
    const encoded = encodeAuthCookies(input);
    // No +, /, = characters (base64url, no padding)
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as AuthCookie[];
    expect(decoded).toEqual(input);
  });

  it("encodes multiple cookies", () => {
    const input: AuthCookie[] = [
      { name: "authjs.session-token.0", value: "c0", path: "/" },
      { name: "authjs.session-token.1", value: "c1", path: "/" },
    ];
    const decoded = JSON.parse(
      Buffer.from(encodeAuthCookies(input), "base64url").toString("utf8"),
    ) as AuthCookie[];
    expect(decoded).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// resolveSupervisorMobileCallback — CF path
// ---------------------------------------------------------------------------

describe("resolveSupervisorMobileCallback — CF path", () => {
  it("redirects with scope=host, cfToken, authCookies[CF@/], email, userId", async () => {
    setCookie("CF_Authorization", "ey.cf.jwt");
    cfState.user = { email: "host@example.com", sub: "cf-sub-1" };

    const result = await resolveSupervisorMobileCallback();
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;

    const uri = new URL(result.url);
    expect(uri.protocol).toBe("remotedev:");
    expect(uri.host).toBe("auth");
    expect(uri.pathname).toBe("/callback");
    expect(uri.searchParams.get("scope")).toBe("host");
    expect(uri.searchParams.get("cfToken")).toBe("ey.cf.jwt");
    expect(uri.searchParams.get("email")).toBe("host@example.com");
    expect(uri.searchParams.get("userId")).toBe("sup-user-1");

    // authCookies must encode [{ name:"CF_Authorization", value:"ey.cf.jwt", path:"/" }]
    const authCookiesRaw = uri.searchParams.get("authCookies");
    expect(authCookiesRaw).not.toBeNull();
    const authCookies = JSON.parse(
      Buffer.from(authCookiesRaw!, "base64url").toString("utf8"),
    ) as AuthCookie[];
    expect(authCookies).toEqual<AuthCookie[]>([
      { name: "CF_Authorization", value: "ey.cf.jwt", path: "/" },
    ]);

    // Must NOT include apiKey
    expect(uri.searchParams.get("apiKey")).toBeNull();

    // resolveSupervisorUser called with the CF email
    expect(resolveSpy).toHaveBeenCalledWith("host@example.com");
  });

  it("falls through to OIDC when CF token is present but invalid", async () => {
    setCookie("CF_Authorization", "ey.bad.jwt");
    cfState.user = null; // validateAccessJWT rejects it
    oidcState.email = null; // no OIDC session either

    const result = await resolveSupervisorMobileCallback();
    // Falls through to no-identity → login
    expect(result.kind).toBe("login");
  });
});

// ---------------------------------------------------------------------------
// resolveSupervisorMobileCallback — OIDC path (single cookie)
// ---------------------------------------------------------------------------

describe("resolveSupervisorMobileCallback — OIDC path (single cookie)", () => {
  it("redirects with scope=host, authCookies[session@/], no cfToken", async () => {
    // No CF cookie
    setCookie("__Secure-authjs.session-token", "jwe-value");
    cfState.user = null;
    oidcState.email = "host@example.com";

    const result = await resolveSupervisorMobileCallback();
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;

    const uri = new URL(result.url);
    expect(uri.searchParams.get("scope")).toBe("host");
    // No cfToken on OIDC path
    expect(uri.searchParams.get("cfToken")).toBeNull();
    expect(uri.searchParams.get("email")).toBe("host@example.com");
    expect(uri.searchParams.get("userId")).toBe("sup-user-1");

    const authCookiesRaw = uri.searchParams.get("authCookies");
    expect(authCookiesRaw).not.toBeNull();
    const authCookies = JSON.parse(
      Buffer.from(authCookiesRaw!, "base64url").toString("utf8"),
    ) as AuthCookie[];
    expect(authCookies).toEqual<AuthCookie[]>([
      { name: "__Secure-authjs.session-token", value: "jwe-value", path: "/" },
    ]);

    expect(resolveSpy).toHaveBeenCalledWith("host@example.com");
  });

  it("also works with an unprefixed authjs.session-token", async () => {
    setCookie("authjs.session-token", "jwe-plain");
    oidcState.email = "host@example.com";

    const result = await resolveSupervisorMobileCallback();
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;

    const authCookiesRaw = new URL(result.url).searchParams.get("authCookies")!;
    const authCookies = JSON.parse(
      Buffer.from(authCookiesRaw, "base64url").toString("utf8"),
    ) as AuthCookie[];
    expect(authCookies[0].name).toBe("authjs.session-token");
    expect(authCookies[0].value).toBe("jwe-plain");
  });
});

// ---------------------------------------------------------------------------
// resolveSupervisorMobileCallback — OIDC path (chunked cookies)
// ---------------------------------------------------------------------------

describe("resolveSupervisorMobileCallback — OIDC path (chunked cookies)", () => {
  it("collects chunks in ascending numeric order, no cfToken", async () => {
    // Chunks in reverse insertion order (resolution must sort them)
    setCookie("__Secure-authjs.session-token.1", "chunk-1");
    setCookie("__Secure-authjs.session-token.0", "chunk-0");
    oidcState.email = "host@example.com";
    cfState.user = null;

    const result = await resolveSupervisorMobileCallback();
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;

    const uri = new URL(result.url);
    expect(uri.searchParams.get("cfToken")).toBeNull();

    const authCookies = JSON.parse(
      Buffer.from(uri.searchParams.get("authCookies")!, "base64url").toString(
        "utf8",
      ),
    ) as AuthCookie[];

    expect(authCookies).toEqual<AuthCookie[]>([
      { name: "__Secure-authjs.session-token.0", value: "chunk-0", path: "/" },
      { name: "__Secure-authjs.session-token.1", value: "chunk-1", path: "/" },
    ]);
  });

  it("includes the base cookie before chunks when both are present", async () => {
    setCookie("__Secure-authjs.session-token", "base-jwe");
    setCookie("__Secure-authjs.session-token.0", "chunk-0");
    setCookie("__Secure-authjs.session-token.1", "chunk-1");
    oidcState.email = "host@example.com";

    const result = await resolveSupervisorMobileCallback();
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;

    const authCookies = JSON.parse(
      Buffer.from(
        new URL(result.url).searchParams.get("authCookies")!,
        "base64url",
      ).toString("utf8"),
    ) as AuthCookie[];

    expect(authCookies[0].name).toBe("__Secure-authjs.session-token");
    expect(authCookies[1].name).toBe("__Secure-authjs.session-token.0");
    expect(authCookies[2].name).toBe("__Secure-authjs.session-token.1");
  });
});

// ---------------------------------------------------------------------------
// resolveSupervisorMobileCallback — OIDC user but no session cookie
// ---------------------------------------------------------------------------

describe("resolveSupervisorMobileCallback — OIDC user resolved, cookie missing", () => {
  it("returns an error (not a login loop) when the session cookie is absent", async () => {
    // auth() returns a session but no matching cookie is in the store.
    oidcState.email = "host@example.com";
    // No authjs session cookie in the jar — only an unrelated cookie.
    setCookie("other-cookie", "irrelevant");

    const result = await resolveSupervisorMobileCallback();
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toMatch(/missing its authentication cookie/);
  });
});

// ---------------------------------------------------------------------------
// resolveSupervisorMobileCallback — no identity
// ---------------------------------------------------------------------------

describe("resolveSupervisorMobileCallback — no identity", () => {
  it("returns { kind: 'login' } when neither CF nor OIDC yields a user", async () => {
    cfState.user = null;
    oidcState.email = null;

    const result = await resolveSupervisorMobileCallback();
    expect(result.kind).toBe("login");
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("returns login even when an invalid CF cookie is present", async () => {
    setCookie("CF_Authorization", "ey.bad");
    cfState.user = null;
    oidcState.email = null;

    const result = await resolveSupervisorMobileCallback();
    expect(result.kind).toBe("login");
  });
});
