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
RUN bun install --frozen-lockfile

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: build the application (Next.js standalone + terminal bundle + rdv)
# ──────────────────────────────────────────────────────────────────────────────
FROM build-deps AS build

WORKDIR /app

COPY . .

# Rebuild native modules (better-sqlite3, node-pty) for the target arch.
# If this fails, the resulting image would crash at runtime with cryptic NAPI
# errors — fail the build loudly here instead.
RUN bun rebuild better-sqlite3 node-pty

ENV NODE_ENV=production
RUN bun run build
RUN bun run terminal:build

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
COPY --from=oven/bun:${BUN_VERSION} /usr/local/bin/bun /usr/local/bin/bun

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

# Bring the rebuilt native modules in (next build's standalone output already
# includes node_modules, but better-sqlite3 / node-pty must match the runtime
# arch — they were compiled in stage 1 for this stage's arch via buildx, so the
# binaries in standalone/node_modules are already correct).

# rdv Rust CLI
COPY --from=build --chown=rdv:rdv /tmp/rdv-binary /usr/local/bin/rdv

# Native ABI smoke test: native modules (better-sqlite3, node-pty) were
# rebuilt in stage 1 against the bun debian image. Both build and runtime
# stages use Debian/glibc so the ABI should match — fail-fast here if it
# doesn't, instead of crashing at the first runtime request with a cryptic
# NAPI error.
RUN node -e "require('better-sqlite3'); require('node-pty'); console.log('native modules OK')"

# Future work: `src/` + `tsconfig.json` are copied solely so `bun run db:seed`
# can resolve `@/lib/paths` and `@/db/schema` from `src/db/seed.ts` when
# invoked via `kubectl exec`. They are unused by the standalone runtime
# server. A future Dockerfile.seed sidecar image could carry the seed
# dependencies separately, trimming the main runtime image's surface area.
# Left in-place for Phase 5 to avoid breaking the existing seed flow.

# Entrypoint
COPY --chown=rdv:rdv docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER rdv

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
