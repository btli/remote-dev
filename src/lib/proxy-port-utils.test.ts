/**
 * Tests for `src/lib/proxy-port-utils.ts` — the pure helpers behind the in-pod
 * HTTP port proxy (plan §6 B1). These are side-effect-free, so we import them
 * statically and call directly (no env/module-cache juggling needed).
 */

import { describe, it, expect } from "vitest";
import {
  HARD_BLOCKED,
  isPortProxyable,
  proxyBasePath,
  rewriteLocationHeader,
  rewriteCookiePath,
  injectBaseTag,
} from "./proxy-port-utils";

describe("HARD_BLOCKED", () => {
  it("blocks the instance HTTP (6001) and terminal (6002) ports", () => {
    expect(HARD_BLOCKED.has(6001)).toBe(true);
    expect(HARD_BLOCKED.has(6002)).toBe(true);
  });
});

describe("isPortProxyable", () => {
  it("accepts a normal unprivileged port", () => {
    expect(isPortProxyable(3000)).toBe(true);
    expect(isPortProxyable(5173)).toBe(true);
    expect(isPortProxyable(8080)).toBe(true);
  });

  it("rejects hard-blocked ports 6001 and 6002", () => {
    expect(isPortProxyable(6001)).toBe(false);
    expect(isPortProxyable(6002)).toBe(false);
  });

  it("treats privileged ports (< 1024) as blocked", () => {
    expect(isPortProxyable(1023)).toBe(false);
    expect(isPortProxyable(80)).toBe(false);
    expect(isPortProxyable(1)).toBe(false);
  });

  it("accepts the 1024 boundary (lowest unprivileged port)", () => {
    expect(isPortProxyable(1024)).toBe(true);
  });

  it("accepts the high boundary 65535 and rejects 65536", () => {
    expect(isPortProxyable(65535)).toBe(true);
    expect(isPortProxyable(65536)).toBe(false);
  });

  it("rejects 0", () => {
    expect(isPortProxyable(0)).toBe(false);
  });

  it("rejects negatives", () => {
    expect(isPortProxyable(-1)).toBe(false);
    expect(isPortProxyable(-3000)).toBe(false);
  });

  it("rejects non-integers (floats) and NaN", () => {
    expect(isPortProxyable(3000.5)).toBe(false);
    expect(isPortProxyable(Number.NaN)).toBe(false);
    expect(isPortProxyable(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("proxyBasePath", () => {
  it("builds a slugged base without a trailing slash", () => {
    expect(proxyBasePath({ slug: "dev", port: 6000 })).toBe("/dev/proxy/6000");
  });

  it("omits the slug segment when slug is null", () => {
    expect(proxyBasePath({ slug: null, port: 6000 })).toBe("/proxy/6000");
  });

  it("treats empty-string slug as unscoped", () => {
    expect(proxyBasePath({ slug: "", port: 6000 })).toBe("/proxy/6000");
  });

  it("trims whitespace-only slug to unscoped", () => {
    expect(proxyBasePath({ slug: "  ", port: 6000 })).toBe("/proxy/6000");
  });
});

describe("rewriteLocationHeader", () => {
  const opts = { slug: "dev", port: 6000 };

  it("re-homes a root-relative redirect under the proxy base", () => {
    expect(rewriteLocationHeader("/dashboard", opts)).toBe(
      "/dev/proxy/6000/dashboard",
    );
  });

  it("re-homes the bare root path", () => {
    expect(rewriteLocationHeader("/", opts)).toBe("/dev/proxy/6000/");
  });

  it("preserves query and fragment on a root-relative redirect", () => {
    expect(rewriteLocationHeader("/login?next=%2Fx#top", opts)).toBe(
      "/dev/proxy/6000/login?next=%2Fx#top",
    );
  });

  it("leaves an external absolute http(s) URL untouched", () => {
    expect(rewriteLocationHeader("https://github.com/login", opts)).toBe(
      "https://github.com/login",
    );
    expect(rewriteLocationHeader("http://other.example/x", opts)).toBe(
      "http://other.example/x",
    );
  });

  it("leaves a protocol-relative (//host) URL untouched", () => {
    expect(rewriteLocationHeader("//cdn.example.com/a.js", opts)).toBe(
      "//cdn.example.com/a.js",
    );
  });

  it("leaves a non-slash-relative redirect untouched (browser resolves it)", () => {
    expect(rewriteLocationHeader("next-page", opts)).toBe("next-page");
    expect(rewriteLocationHeader("../up", opts)).toBe("../up");
    expect(rewriteLocationHeader("?q=1", opts)).toBe("?q=1");
    expect(rewriteLocationHeader("#frag", opts)).toBe("#frag");
  });

  it("is idempotent for already-proxied paths (slugged)", () => {
    expect(rewriteLocationHeader("/dev/proxy/6000/x", opts)).toBe(
      "/dev/proxy/6000/x",
    );
    expect(rewriteLocationHeader("/dev/proxy/6000", opts)).toBe(
      "/dev/proxy/6000",
    );
  });

  it("is idempotent (defensively) for an unprefixed /proxy/<port> path", () => {
    expect(rewriteLocationHeader("/proxy/6000/x", opts)).toBe("/proxy/6000/x");
  });

  it("does NOT treat a different port's proxy path as already-proxied", () => {
    // /proxy/7000/... belongs to another port → it IS root-relative, re-home it.
    expect(rewriteLocationHeader("/proxy/7000/x", opts)).toBe(
      "/dev/proxy/6000/proxy/7000/x",
    );
  });

  it("works for an unscoped instance (no slug)", () => {
    const u = { slug: null, port: 6000 };
    expect(rewriteLocationHeader("/x", u)).toBe("/proxy/6000/x");
    expect(rewriteLocationHeader("/proxy/6000/x", u)).toBe("/proxy/6000/x");
  });

  it("returns empty input unchanged", () => {
    expect(rewriteLocationHeader("", opts)).toBe("");
  });
});

describe("rewriteCookiePath", () => {
  const opts = { slug: "dev", port: 6000 };

  it("re-homes a Path=/ attribute", () => {
    expect(rewriteCookiePath("sid=abc; Path=/; HttpOnly", opts)).toBe(
      "sid=abc; Path=/dev/proxy/6000/; HttpOnly",
    );
  });

  it("re-homes a Path=/sub attribute", () => {
    expect(rewriteCookiePath("sid=abc; Path=/admin; Secure", opts)).toBe(
      "sid=abc; Path=/dev/proxy/6000/admin; Secure",
    );
  });

  it("is case-insensitive on the attribute name", () => {
    expect(rewriteCookiePath("sid=abc; path=/x", opts)).toBe(
      "sid=abc; path=/dev/proxy/6000/x",
    );
    expect(rewriteCookiePath("sid=abc; PATH=/x", opts)).toBe(
      "sid=abc; PATH=/dev/proxy/6000/x",
    );
  });

  it("leaves a cookie WITHOUT a Path attribute unchanged", () => {
    expect(rewriteCookiePath("sid=abc; HttpOnly; Secure", opts)).toBe(
      "sid=abc; HttpOnly; Secure",
    );
  });

  it("is idempotent for an already-proxied Path", () => {
    expect(rewriteCookiePath("sid=abc; Path=/dev/proxy/6000/", opts)).toBe(
      "sid=abc; Path=/dev/proxy/6000/",
    );
    expect(rewriteCookiePath("sid=abc; Path=/dev/proxy/6000/admin", opts)).toBe(
      "sid=abc; Path=/dev/proxy/6000/admin",
    );
  });

  it("is idempotent (defensively) for an unprefixed /proxy/<port> Path", () => {
    expect(rewriteCookiePath("sid=abc; Path=/proxy/6000/x", opts)).toBe(
      "sid=abc; Path=/proxy/6000/x",
    );
  });

  it("does not touch a non-slash Path value", () => {
    // Malformed/relative Path — leave it to the browser's own handling.
    expect(rewriteCookiePath("sid=abc; Path=relative", opts)).toBe(
      "sid=abc; Path=relative",
    );
  });

  it("works for an unscoped instance (no slug)", () => {
    const u = { slug: null, port: 6000 };
    expect(rewriteCookiePath("sid=abc; Path=/", u)).toBe(
      "sid=abc; Path=/proxy/6000/",
    );
  });

  it("does not rewrite a value that merely contains the word path", () => {
    // No "; Path=" attribute present → unchanged.
    expect(rewriteCookiePath("redirect=/some/path; HttpOnly", opts)).toBe(
      "redirect=/some/path; HttpOnly",
    );
  });
});

describe("injectBaseTag", () => {
  const opts = { slug: "dev", port: 6000 };

  it("injects <base> right after a plain <head>", () => {
    const html = "<html><head><title>x</title></head><body>hi</body></html>";
    expect(injectBaseTag(html, opts)).toBe(
      '<html><head><base href="/dev/proxy/6000/"><title>x</title></head><body>hi</body></html>',
    );
  });

  it("injects after a <head> that carries attributes", () => {
    const html = '<head data-x="1">stuff</head>';
    expect(injectBaseTag(html, opts)).toBe(
      '<head data-x="1"><base href="/dev/proxy/6000/">stuff</head>',
    );
  });

  it("is case-insensitive on the <HEAD> tag", () => {
    const html = "<HTML><HEAD></HEAD></HTML>";
    expect(injectBaseTag(html, opts)).toBe(
      '<HTML><HEAD><base href="/dev/proxy/6000/"></HEAD></HTML>',
    );
  });

  it("falls back to after <html> when there is no <head>", () => {
    const html = "<html><body>no head</body></html>";
    expect(injectBaseTag(html, opts)).toBe(
      '<html><base href="/dev/proxy/6000/"><body>no head</body></html>',
    );
  });

  it("prepends defensively when there is neither <head> nor <html>", () => {
    const html = "<div>fragment</div>";
    expect(injectBaseTag(html, opts)).toBe(
      '<base href="/dev/proxy/6000/"><div>fragment</div>',
    );
  });

  it("does not double-inject when a <base> already exists", () => {
    const html = '<head><base href="/other/"></head>';
    expect(injectBaseTag(html, opts)).toBe(html);
  });

  it("does not treat a self-closing existing <base/> as injectable", () => {
    const html = "<head><base/></head>";
    expect(injectBaseTag(html, opts)).toBe(html);
  });

  it("uses a slug-less base href for an unscoped instance", () => {
    const u = { slug: null, port: 6000 };
    expect(injectBaseTag("<head></head>", u)).toBe(
      '<head><base href="/proxy/6000/"></head>',
    );
  });

  it("does not mistake the word 'base' in text/CSS for a <base> tag", () => {
    const html = "<head><style>.baseline{}</style></head>";
    expect(injectBaseTag(html, opts)).toBe(
      '<head><base href="/dev/proxy/6000/"><style>.baseline{}</style></head>',
    );
  });
});
