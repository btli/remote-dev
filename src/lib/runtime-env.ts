/**
 * Runtime-env bridge for the Next.js 16 proxy (Node middleware).
 *
 * ## Why this exists
 *
 * In Next.js **standalone** output (the Docker / build-once-run-many shape we
 * ship to k8s), the proxy/middleware bundle does NOT reliably receive the
 * container's RUNTIME environment. This is a known Next limitation
 * (vercel/next.js#53367): values referenced as `process.env.X` inside the
 * middleware graph resolve from a context that, in standalone, can be empty for
 * vars that were absent at BUILD time — even though the surrounding Node server
 * has them. The symptom for this app was an OIDC login LOOP on a `RDV_BASE_PATH`
 * instance: the proxy's `getToken()` saw an empty `AUTH_SECRET` (and an empty
 * `AUTH_URL`/`RDV_INSTANCE_SLUG`, so it also computed the wrong cookie name),
 * returned null for a perfectly valid session cookie, and bounced every page
 * back to `/login` — while the login page (rendered by the main Node server,
 * which DOES have the runtime env) saw the real session and bounced back.
 *
 * `RDV_BASE_PATH` itself is already handled by a different mechanism — build-time
 * inlining of a `/rdvslug` sentinel (`next.config.ts` `env`) that
 * `docker/entrypoint.sh` seds to the real slug at boot. That trick CANNOT be
 * used for `AUTH_SECRET`: it is a per-instance random secret minted at provision
 * time, and the image is built once and shared by every instance — inlining
 * would both bake the wrong (build-time-empty) value AND leak a secret into an
 * image layer.
 *
 * ## How it works
 *
 * `instrumentation.ts` `register()` runs ONCE at server startup on the Node.js
 * runtime, in the SAME process and SAME `globalThis` that later loads the proxy
 * bundle (Next loads Node middleware via a plain in-process `require` of
 * `.next/server/middleware.js`; there is no edge VM sandbox for the nodejs
 * runtime — verified empirically). `register()` calls {@link captureRuntimeEnv}
 * to snapshot the relevant runtime env into `globalThis.__RDV_RUNTIME_ENV`.
 * Proxy-path code then reads values via {@link runtimeEnv}, which prefers a
 * populated `process.env[key]` and only falls back to the captured global when
 * `process.env[key]` is empty/undefined.
 *
 * ## Why this is safe for single-server (AC-1: byte-identical when unset)
 *
 * `runtimeEnv()` reads `process.env[key]` FIRST. In the main Node server (and in
 * any single-process deployment, including local dev and single-host prod), the
 * proxy shares the live `process.env`, so the global fallback is never consulted
 * and behavior is unchanged. The fallback only ever supplies a value in the
 * specific standalone-middleware context where `process.env[key]` is empty. The
 * captured global is a verbatim copy of `process.env` at startup, so it can only
 * ever return the SAME value the env would have had — never a different one. No
 * secret is written to disk or baked into the image; the global lives only in
 * the running process's memory.
 */

/** Env keys the proxy (Node middleware) needs but cannot read reliably in standalone. */
export const RUNTIME_ENV_KEYS = [
  "AUTH_SECRET",
  "AUTH_URL",
  "NEXTAUTH_URL",
  "RDV_INSTANCE_SLUG",
] as const;

export type RuntimeEnvKey = (typeof RUNTIME_ENV_KEYS)[number];

type RuntimeEnvSnapshot = Partial<Record<RuntimeEnvKey, string>>;

declare global {
  // `var` (not let/const) is the required idiom for augmenting `globalThis` in
  // TypeScript: only `var` declarations in an ambient global block become
  // properties on `globalThis`. The project's lint config does not flag it here.
  var __RDV_RUNTIME_ENV: RuntimeEnvSnapshot | undefined;
}

/**
 * Snapshot the runtime-only env into `globalThis` so the proxy can fall back to
 * it. Call from `instrumentation.ts` `register()` (Node.js runtime), where the
 * full container env is present. Idempotent: a later call overwrites with the
 * current (identical) env. Never throws.
 *
 * Only keys with a non-empty value are stored, so an unset var stays unset and
 * {@link runtimeEnv} returns `undefined` for it (matching `process.env`).
 */
export function captureRuntimeEnv(): void {
  const snapshot: RuntimeEnvSnapshot = {};
  for (const key of RUNTIME_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined && value !== "") {
      snapshot[key] = value;
    }
  }
  globalThis.__RDV_RUNTIME_ENV = snapshot;
}

/**
 * Read a runtime-env value, preferring the live `process.env` and falling back
 * to the startup snapshot in `globalThis.__RDV_RUNTIME_ENV` only when
 * `process.env[key]` is absent or empty.
 *
 * Returns `undefined` when neither source has a non-empty value — identical to a
 * bare `process.env[key]` read for an unset var, which is what preserves
 * single-server byte-for-byte behavior.
 */
export function runtimeEnv(key: RuntimeEnvKey): string | undefined {
  const live = process.env[key];
  if (live !== undefined && live !== "") {
    return live;
  }
  return globalThis.__RDV_RUNTIME_ENV?.[key];
}
