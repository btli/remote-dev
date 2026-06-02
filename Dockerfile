# syntax=docker/dockerfile:1.7
#
# remote-dev container image
#
# Build (single arch):
#   docker buildx build \
#     --platform linux/arm64 \
#     --tag ghcr.io/btli/remote-dev:<version> \
#     --push \
#     .
#
# Build (multi-arch — recommended for fleet rollouts):
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     --tag ghcr.io/btli/remote-dev:<version> --push .
#
# Notes:
#   - Builds Next.js standalone + terminal server bundle inside the image
#   - Compiles the rdv Rust CLI in the build stage (optional but recommended)
#   - Runtime stage is Debian-based (slim) because node-pty / better-sqlite3
#     need glibc and a /dev/pts subsystem that Alpine PTY support is shakier on.
#
# Required env at runtime (set in K8s manifest):
#   AUTH_SECRET            openssl rand -base64 32
#   AUTH_URL               https://<external host>
#   AUTHORIZED_USERS       comma-separated allowlist for db:seed
#   RDV_DATA_DIR           /var/lib/rdv  (mount a PVC here)
#   CF_ACCESS_TEAM         your CF team subdomain
#   CF_ACCESS_AUD          your CF Access Application Audience tag
#   PORT                   6001   (Next.js)
#   TERMINAL_PORT          6002   (terminal WebSocket)
#   NEXT_PUBLIC_TERMINAL_PORT  6002

# Auto-updating base image tags per global Docker policy.
# Node major (22) is pinned to match the project's engines; minor + patch auto-update.
# Bun tracks the latest debian-based release.
ARG NODE_VERSION=22-slim
ARG BUN_VERSION=debian

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: build dependencies (native modules need a compiler toolchain)
# ──────────────────────────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION} AS build-deps

WORKDIR /app

# Toolchain for native modules + Rust for the rdv CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        ca-certificates \
        curl \
        git \
        pkg-config \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain (used only in this stage to compile crates/rdv)
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal

COPY package.json bun.lockb* bun.lock* ./
# Workspace members (root package.json declares workspaces: packages/*, apps/*).
# `bun install --frozen-lockfile` validates the unified lockfile against ALL
# members, so each member's package.json must be present before install.
# NOTE: add a line here when a new apps/* or packages/* workspace is created.
COPY apps/supervisor/package.json ./apps/supervisor/package.json
COPY apps/supervisor-router/package.json ./apps/supervisor-router/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/mobile/package.json ./packages/mobile/package.json
RUN bun install --frozen-lockfile

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: build the application (Next.js standalone + terminal bundle + rdv)
# ──────────────────────────────────────────────────────────────────────────────
FROM build-deps AS build

WORKDIR /app

COPY . .

# Native modules (better-sqlite3, node-pty) are compiled during the
# `bun install --frozen-lockfile` in the build-deps stage because they are
# listed in the root package.json `trustedDependencies`, with the build-essential
# + python3 toolchain present there. No separate rebuild step is needed.

# Slug-aware image: build ONCE with a sentinel basePath, then rewrite the
# sentinel to the real per-instance slug at container start (docker/entrypoint.sh).
# Next.js bakes `basePath`/`assetPrefix` at BUILD time, so we cannot pick the
# slug at runtime — instead we bake a placeholder. `/rdvslug` is a valid
# basePath per src/lib/base-path.ts's validator `^(/[a-z0-9][a-z0-9-]*)+$`, and
# is a unique token unlikely to collide with anything else in the build output.
# assetPrefix follows basePath automatically, so assets emit under
# `/rdvslug/_next/...`. The RUNTIME stage deliberately does NOT set
# RDV_BASE_PATH — the entrypoint materializes the sentinel and exports the real
# value per instance.
ENV NODE_ENV=production \
    RDV_BASE_PATH=/rdvslug
RUN bun run build
RUN bun run terminal:build

# Stage the native modules at a known path. The terminal server bundle is
# built with `--external node-pty` (see scripts/build-terminal.ts), so the
# Next.js standalone output ships better-sqlite3 in `.next/standalone/node_modules`
# but NOT node-pty. The terminal server's runtime CWD is `/app`, so we copy
# both into `/app/node_modules` in the runtime stage to keep `require('node-pty')`
# and `require('better-sqlite3')` resolvable from there.
#
# We ALSO stage the platform-native `@libsql` binding: the DB layer
# (src/db/index.ts) uses `@libsql/client/node`, whose underlying `libsql`
# package conditionally `require`s a platform-native binding at runtime (on this
# linux-x64 glibc build runner that's `@libsql/linux-x64-gnu`). That conditional
# require is invisible to the Next.js standalone trace, so the binding ALONE is
# absent from the standalone tree and the Node-run terminal server (CWD=/app)
# crashes with `Cannot find module '@libsql/linux-x64-gnu'`.
#
# Stage ONLY the leaf binding — NOT the whole `@libsql` scope. The standalone
# COPY in the runtime stage already populates /app/node_modules/@libsql/ with
# `client`/`core`/`isomorphic-*` as SYMLINKS; overlaying a full staged scope
# directory on top of that fails in BuildKit with `cannot copy to non-directory:
# .../@libsql/client` (cannot copy a source dir onto a destination symlink).
# Copying just the missing leaf into the existing dir sidesteps the collision.
#
# `cp -RL` dereferences symlinks (bun's isolated layout uses internal symlinks)
# so the staged binding is a self-contained real directory.
RUN mkdir -p /opt/native && \
    cp -RL node_modules/node-pty /opt/native/node-pty && \
    cp -RL node_modules/better-sqlite3 /opt/native/better-sqlite3 && \
    cp -RL node_modules/@libsql/linux-x64-gnu /opt/native/libsql-linux-x64-gnu

# Build the rdv Rust CLI (statically linkable so it runs in the slim runtime)
RUN cd crates/rdv && cargo build --release --locked && \
    cp target/release/rdv /tmp/rdv-binary

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: runtime
# ──────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime

# Runtime dependencies:
#   tmux         — required, sessions are tmux-backed
#   git          — required, worktrees + clone flows
#   gh           — required, multi-GitHub-account flow
#   openssh-client — for SSH session terminal type
#   ca-certificates — TLS
#   tini         — PID 1 / zombie reaper
#   curl, jq     — diagnostic + entrypoint use
RUN apt-get update && apt-get install -y --no-install-recommends \
        tmux \
        git \
        openssh-client \
        ca-certificates \
        tini \
        curl \
        jq \
        less \
    && (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
          | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
        && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
          > /etc/apt/sources.list.d/github-cli.list \
        && apt-get update && apt-get install -y --no-install-recommends gh) \
    && rm -rf /var/lib/apt/lists/*

# Bun for any scripts that need it at runtime (rdv process manager, migrations)
COPY --from=build-deps /usr/local/bin/bun /usr/local/bin/bun

# Create app user + state directory
RUN useradd --create-home --shell /bin/bash --uid 10001 rdv \
    && mkdir -p /var/lib/rdv \
    && chown -R rdv:rdv /var/lib/rdv

WORKDIR /app

# Copy built artifacts
# .next/standalone is what `next build` produces with output: "standalone"
# in next.config.ts.
COPY --from=build --chown=rdv:rdv /app/.next/standalone ./
COPY --from=build --chown=rdv:rdv /app/.next/static ./.next/static
COPY --from=build --chown=rdv:rdv /app/public ./public
COPY --from=build --chown=rdv:rdv /app/dist-terminal ./dist-terminal
COPY --from=build --chown=rdv:rdv /app/scripts ./scripts
COPY --from=build --chown=rdv:rdv /app/drizzle ./drizzle
COPY --from=build --chown=rdv:rdv /app/package.json ./package.json
# src + tsconfig are needed so `bun run db:seed` can resolve @/lib/paths
# and @/db/schema imports from src/db/seed.ts when invoked via
# `kubectl exec`. Not used at runtime by the standalone server.
COPY --from=build --chown=rdv:rdv /app/src ./src
COPY --from=build --chown=rdv:rdv /app/tsconfig.json ./tsconfig.json

# Bring the rebuilt native modules into /app/node_modules. The terminal
# server bundle is built with `--external node-pty`, so node-pty is NOT
# inside the .next/standalone tree — without this COPY the terminal server
# crashes at first session-create with `Cannot find module 'node-pty'`.
# better-sqlite3 is already inside `.next/standalone/node_modules`, but the
# terminal server runs from `/app` (not `.next/standalone`), so we mirror
# it here too so `require('better-sqlite3')` resolves from CWD=/app.
COPY --from=build --chown=rdv:rdv /opt/native/node-pty ./node_modules/node-pty
COPY --from=build --chown=rdv:rdv /opt/native/better-sqlite3 ./node_modules/better-sqlite3
# Add ONLY the platform-native libsql binding into the @libsql scope that the
# standalone COPY above already created. `libsql` (used by `@libsql/client/node`)
# conditionally `require`s `@libsql/linux-x64-gnu` at runtime; the Next.js
# standalone trace cannot see that conditional require, so the binding is the one
# `@libsql/*` package missing from the standalone tree — without it the Node-run
# terminal server (CWD=/app) crashes with `Cannot find module
# '@libsql/linux-x64-gnu'`. Copying just the leaf (rather than overlaying the
# whole scope, which collides with the symlinked `@libsql/client` and fails the
# build with `cannot copy to non-directory`) places the binding where Node's
# ancestor `node_modules` resolution finds it for BOTH the standalone app and
# dist-terminal.
COPY --from=build --chown=rdv:rdv /opt/native/libsql-linux-x64-gnu ./node_modules/@libsql/linux-x64-gnu

# rdv Rust CLI
COPY --from=build --chown=rdv:rdv /tmp/rdv-binary /usr/local/bin/rdv

# Future work: `src/` + `tsconfig.json` are copied solely so `bun run db:seed`
# can resolve `@/lib/paths` and `@/db/schema` from `src/db/seed.ts` when
# invoked via `kubectl exec`. They are unused by the standalone runtime
# server. A future Dockerfile.seed sidecar image could carry the seed
# dependencies separately, trimming the main runtime image's surface area.
# Left in-place for Phase 5 to avoid breaking the existing seed flow.

# Entrypoint
COPY --chown=rdv:rdv docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# The non-root runtime user (uid 10001 `rdv`) must OWN the /app directory itself,
# not just its contents: the entrypoint's basePath materialization runs `sed -i`
# over /app/server.js (and /app/.next, /app/public) for per-instance
# RDV_BASE_PATH, and `sed -i` must create a temp file in the target's directory.
# `WORKDIR /app` creates /app as root and the `COPY --chown=rdv:rdv` lines only
# chown the copied *contents*, leaving /app root-owned → `sed -i` fails with
# "couldn't open temporary file /app/sedXXXX: Permission denied" and provisioned
# instances CrashLoop. (Single-instance / RDV_BASE_PATH="" skips materialization.)
RUN chown -R rdv:rdv /app

USER rdv

# Native ABI smoke test: native modules (better-sqlite3, node-pty) were
# rebuilt in stage 1 against the bun debian image. Both build and runtime
# stages use Debian/glibc so the ABI should match — fail-fast here if it
# doesn't, instead of crashing at the first runtime request with a cryptic
# NAPI error. Run AFTER `USER rdv` so we verify the runtime user can also
# load them (catches permission/path issues that would only manifest at
# request time). `@libsql/client/node` is included so a future packaging
# regression (the platform-native binding missing from /app/node_modules/@libsql)
# fails the build instead of CrashLooping the terminal server at startup.
RUN node -e "require('@libsql/linux-x64-gnu'); require('@libsql/client/node'); require('better-sqlite3'); require('node-pty'); console.log('native modules OK')"

# NOTE: RDV_BASE_PATH is intentionally NOT set here. The build stage baked the
# `/rdvslug` sentinel into the static output; the entrypoint rewrites it to the
# real per-instance slug (from RDV_BASE_PATH injected by the K8s manifest) and
# then exports the real value for the node processes. Hard-baking it here would
# defeat the one-image-many-slugs design.
ENV RDV_DATA_DIR=/var/lib/rdv \
    PORT=6001 \
    TERMINAL_PORT=6002 \
    NEXT_PUBLIC_TERMINAL_PORT=6002 \
    NODE_ENV=production \
    HOSTNAME=0.0.0.0

VOLUME ["/var/lib/rdv"]
EXPOSE 6001 6002

# tini reaps the bun-spawned terminal server and the node-spawned next server
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD []
