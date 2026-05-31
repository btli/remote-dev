# syntax=docker/dockerfile:1.7
#
# remote-dev Supervisor router image (spec §5, §9).
#
# A tiny stateless Bun reverse proxy. It has NO runtime dependencies (only
# devDependencies — bun-types, eslint, etc.) and Bun runs TypeScript directly,
# so the runtime image is just Bun + the router's own source; no node_modules,
# no build step, no bundler.
#
# Monorepo-aware: the build context is the REPO ROOT (the bun workspace), built
# FROM the repository root, NOT from apps/supervisor-router:
#
#   docker buildx build \
#     --platform linux/amd64,linux/arm64 \
#     --file apps/supervisor-router/Dockerfile \
#     --tag ghcr.io/btli/remote-dev-router:<sha> \
#     --push \
#     .
#
# Runs `bun run start` (== `bun run src/index.ts`, the package.json `start`
# script) — the same command the router Deployment uses. Non-root (uid 10001,
# matching the Deployment securityContext).

ARG BUN_VERSION=alpine

FROM oven/bun:${BUN_VERSION} AS runtime

# tini reaps the bun process and forwards signals (the router handles SIGTERM for
# graceful shutdown — drain in-flight connections, stop the allowlist poller).
RUN apk add --no-cache tini

# Fixed non-root user (uid 10001 matches the Deployment securityContext).
RUN addgroup -g 10001 rdv \
    && adduser -D -u 10001 -G rdv rdv

WORKDIR /app

# The router imports nothing outside its own src/ (the `@/...` alias resolves
# within src/ via tsconfig). Ship just source + the manifests `bun run start`
# needs — no node_modules, no .next, no bundler output.
COPY --chown=rdv:rdv apps/supervisor-router/package.json ./package.json
COPY --chown=rdv:rdv apps/supervisor-router/tsconfig.json ./tsconfig.json
COPY --chown=rdv:rdv apps/supervisor-router/src ./src

ENV NODE_ENV=production \
    ROUTER_PORT=6004
# HOSTNAME is intentionally not set: Bun.serve binds 0.0.0.0 by default.

USER rdv

EXPOSE 6004

# `bun run start` == `bun run src/index.ts` (Bun executes the TS entrypoint
# directly). Matches the router Deployment's command.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "run", "start"]
