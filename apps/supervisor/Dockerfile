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
#   • controller — `bun run controller` → tsx src/controller/index.ts
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
#   • controller — `bun run controller` (tsx src/controller/index.ts). tsx +
#                  @kubernetes/client-node + drizzle + @libsql are devDeps/runtime
#                  deps that are NOT in the Next standalone trace, so we ALSO ship
#                  the workspace node_modules for this process.
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
# dir, so there is nothing else to stage alongside server.js.)
COPY --from=build --chown=rdv:rdv \
    /app/apps/supervisor/.next/static \
    ./apps/supervisor/.next/standalone/apps/supervisor/.next/static

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
