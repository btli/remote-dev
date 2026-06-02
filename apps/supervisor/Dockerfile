# syntax=docker/dockerfile:1.7
#
# remote-dev Supervisor control-plane image (spec §6.1, §9).
#
# Monorepo-aware: the build context is the REPO ROOT (the bun workspace), so this
# Dockerfile is built FROM the repository root, NOT from apps/supervisor:
#
#   docker buildx build \
#     --platform linux/amd64,linux/arm64 \
#     --file apps/supervisor/Dockerfile \
#     --tag ghcr.io/btli/remote-dev-supervisor:<sha> \
#     --push \
#     .
#
# One image runs BOTH supervisor processes (the Deployment picks which via the
# container `command`):
#   • web        — `bun run start`      → next start -p 6003   (default CMD)
#   • controller — `bun run controller` → bun src/controller/index.ts
# Both run from /app/apps/supervisor and share the same SQLite DB on the PVC.
#
# Non-root runtime (uid 10001, matching the Deployment securityContext).

ARG BUN_VERSION=debian

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: install workspace deps + build the Next.js app
# ──────────────────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION} AS build

WORKDIR /app

# @kubernetes/client-node / @libsql pull native or postinstall steps; give them a
# toolchain + git in the build stage. ca-certificates for any fetch during build.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        ca-certificates \
        git \
    && rm -rf /var/lib/apt/lists/*

# Bring in the full repo (the .dockerignore at the repo root excludes
# node_modules, .next, dist, secrets, etc — so the build does a clean install).
COPY . .

# Install the whole workspace from the lockfile. The supervisor's deps — next,
# @kubernetes/client-node, @libsql/client, drizzle, tsx — live in the repo-root
# store and bun's isolated layout symlinks them into apps/supervisor/node_modules
# so `next`/`tsx`/`@kubernetes` resolve from the app. A single install after the
# full COPY is unambiguous (no symlink-farm overlay to repair); --frozen-lockfile
# guarantees the image matches the committed bun.lock.
RUN bun install --frozen-lockfile

# Build the Next.js app (produces apps/supervisor/.next, incl. standalone output).
ENV NODE_ENV=production
RUN cd apps/supervisor && bun run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: runtime
#
# Two processes run from this one image (the Deployment picks via `command`):
#   • web        — `node .next/standalone/apps/supervisor/server.js` (the SUPPORTED
#                  runtime for `output: "standalone"`; `next start` is NOT — Next
#                  warns it "does not work with standalone"). The standalone tree
#                  is self-contained (its relative symlinks resolve within
#                  .next/standalone/node_modules/.bun), so the web server needs no
#                  outside node_modules.
#   • controller — `bun run controller` (bun src/controller/index.ts — bun runs
#                  the TypeScript entry natively; tsx is a Node loader that does
#                  not work under bun). @kubernetes/client-node + drizzle + @libsql
#                  are runtime deps that are NOT in the Next standalone trace, so
#                  we ALSO ship the workspace node_modules for this process.
# Hence we copy BOTH the built app (incl. .next/standalone + .next/static) and the
# repo-root node_modules.
# ──────────────────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION} AS runtime

# tini reaps the bun/tsx child; ca-certificates for outbound TLS (k8s API, CF).
RUN apt-get update && apt-get install -y --no-install-recommends \
        tini \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Fixed non-root user (uid 10001 matches the Deployment securityContext + the PVC
# fsGroup) so the SQLite directory on the PVC is writable.
RUN useradd --create-home --shell /bin/bash --uid 10001 rdv \
    && mkdir -p /var/lib/rdv-supervisor \
    && chown -R rdv:rdv /var/lib/rdv-supervisor

WORKDIR /app

# Repo-root node_modules (the bun store + symlink farm) and the built app.
# Copy the root store first, then the app — preserving the relative symlinks bun
# uses (the app's node_modules symlink into ../../node_modules/.bun). Docker COPY
# preserves symlinks within the copied tree, so the self-contained standalone
# layout stays valid.
COPY --from=build --chown=rdv:rdv /app/node_modules ./node_modules
COPY --from=build --chown=rdv:rdv /app/package.json ./package.json
COPY --from=build --chown=rdv:rdv /app/apps/supervisor ./apps/supervisor
COPY --from=build --chown=rdv:rdv /app/packages ./packages

# `next build` does NOT copy .next/static into the standalone output, so the
# standalone server.js (which serves static from <its dir>/.next/static) can't
# find client chunks until we place them there. Mirror the main app's Dockerfile:
# copy .next/static into the standalone app dir. (The supervisor has no public/
# dir.)
COPY --from=build --chown=rdv:rdv \
    /app/apps/supervisor/.next/static \
    ./apps/supervisor/.next/standalone/apps/supervisor/.next/static

# Migrate-on-boot needs the committed Drizzle migrations at runtime. The whole
# app dir COPY above already lands them at /app/apps/supervisor/drizzle (resolved
# via process.cwd() — WORKDIR is /app/apps/supervisor), but ALSO place them right
# next to the standalone server.js so the migrations folder resolves regardless
# of how cwd is set. `src/db/migrate.ts` probes both locations.
COPY --from=build --chown=rdv:rdv \
    /app/apps/supervisor/drizzle \
    ./apps/supervisor/.next/standalone/apps/supervisor/drizzle

# libsql standalone fix: provide the missing `web.*` files for the `@libsql`
# isomorphic shims so libsql resolves under the bun runtime.
#
# `@libsql/client` (a hrana/libsql stack) is `serverExternalPackages`, so the web
# process `await import()`s it at runtime. Its transitive `@libsql/hrana-client`
# imports `@libsql/isomorphic-ws` + `@libsql/isomorphic-fetch`, whose package.json
# `exports` select a file by RUNTIME CONDITION:
#     "import": { "bun": "./web.mjs", "node": "./node.mjs", "default": "./web.mjs" }
# The runtime image is `oven/bun`, where `node` is a bun shim — so the resolver
# matches the `bun` condition and looks for `./web.mjs` / `./web.cjs` (fetch:
# `./web.js`). But these two packages are PUBLISHED WITHOUT their `web.*` files
# (only the `node.*` variants ship), so the bun condition resolves to a missing
# file and the whole DB layer (drizzle/libsql in src/db/index.ts) dies at startup
# with:  Cannot find module '@libsql/isomorphic-ws' from '.../@libsql/hrana-client'.
# (Real Node.js dodges this by matching the `node` condition, which DOES exist —
# which is why it was never seen until the image was actually run under bun.)
#
# Fix: materialize the missing `web.*` from the working `node.*` siblings (both
# are trivial — they just re-export `WebSocket`/`fetch` from `ws`/`node-fetch`,
# which ARE installed). Patch the canonical package in the standalone `.bun`
# store; every bun-isolated symlink points back to it, so one copy covers all
# resolution paths. The path is globbed (not version-pinned) so a libsql bump
# can't silently un-fix it — the `test -f` guard fails the build instead.
RUN set -eux; \
    SR="apps/supervisor/.next/standalone/node_modules/.bun"; \
    WS="$(readlink -f "$SR"/@libsql+isomorphic-ws@*/node_modules/@libsql/isomorphic-ws)"; \
    FT="$(readlink -f "$SR"/@libsql+isomorphic-fetch@*/node_modules/@libsql/isomorphic-fetch)"; \
    cp -n "$WS/node.mjs" "$WS/web.mjs"; \
    cp -n "$WS/node.cjs" "$WS/web.cjs"; \
    cp -n "$FT/node.js"  "$FT/web.js";  \
    cp -n "$FT/node.cjs" "$FT/web.cjs"; \
    chown rdv:rdv "$WS"/web.* "$FT"/web.*; \
    test -f "$WS/web.mjs" && test -f "$WS/web.cjs" && test -f "$FT/web.js" && test -f "$FT/web.cjs"

# The Supervisor's own SQLite database lives here (a PVC is mounted at this path
# in the Deployment).
ENV SUPERVISOR_DATA_DIR=/var/lib/rdv-supervisor \
    NODE_ENV=production \
    PORT=6003 \
    HOSTNAME=0.0.0.0

WORKDIR /app/apps/supervisor

USER rdv

VOLUME ["/var/lib/rdv-supervisor"]
EXPOSE 6003

# Default to the web process via the SUPPORTED standalone server entry (NOT
# `next start`, which Next rejects for `output: "standalone"`). server.js reads
# PORT (6003) + HOSTNAME (0.0.0.0) from env. The Deployment's `controller`
# container overrides this with `bun run controller`.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", ".next/standalone/apps/supervisor/server.js"]
