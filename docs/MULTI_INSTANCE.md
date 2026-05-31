# Multi-Instance Deployment on Kubernetes

Reference manifests for running `remote-dev` as one or more path-prefixed
instances behind a shared Cloudflare tunnel + Access policy. Each instance
is a single-replica StatefulSet with its own PVC, SQLite database, tmux
namespace, and `AUTH_SECRET`.

> **Status — superseded approach.** The Traefik/Ingress prefix-stripping model
> documented here is being superseded by the k3s **"supervisor platform"**
> (supervisor-owned router + slug-aware data-plane image). That design is a
> **DRAFT** — see
> [`docs/plans/2026-05-30-k3s-supervisor-platform.md`](./plans/2026-05-30-k3s-supervisor-platform.md);
> the `apps/supervisor` control plane is **not yet built**. The manifests below
> remain valid for hand-rolled multi-instance hosting today.
>
> Regardless of orchestration approach, **`src/lib/base-path.ts` is the runtime
> single source of truth for `RDV_BASE_PATH`** URL prefixing (ESLint-guarded;
> only it and `next.config.ts` may read the env var). See
> [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) → "Multi-instance / multi-tenant
> hosting".

See also:
- `docs/plans/multi-instance-basepath.md` — the design spec and acceptance criteria
- `docs/plans/2026-05-30-k3s-supervisor-platform.md` — the newer k3s supervisor platform (DRAFT)
- `docs/SETUP.md` — single-host installation
- `Dockerfile` — image build (multi-arch supported via `buildx`)

---

## Architecture summary

```
                              Cloudflare tunnel + Access
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                  Ingress  /alpha/* → Svc:alpha   /beta/* → Svc:beta
                              │                       │
                  StatefulSet: rdv-alpha     StatefulSet: rdv-beta
                  Pod 1/1 (RDV_BASE_PATH=/alpha)   Pod 1/1 (RDV_BASE_PATH=/beta)
                              │                       │
                  PVC: data-alpha-0           PVC: data-beta-0
                  (ReadWriteOnce, 5Gi)        (ReadWriteOnce, 5Gi)
```

Key constraints:

- **StatefulSet, not Deployment.** Each instance has on-disk state (SQLite WAL,
  tmux sockets, cloned repos). ReadWriteOnce PVCs cannot be shared across
  pods, and we don't want them to be.
- **`replicas: 1` per instance.** Horizontal scaling is out of scope — the
  app is single-writer by design. Add more instances under different
  prefixes, not more replicas of the same instance.
- **Per-instance `AUTH_SECRET`.** Spec §6.1 (AC-5): the `__Host-` CSRF
  cookie sits at `Path=/`, so isolation between instances comes from
  distinct signing secrets, not cookie paths.

---

## Building the image

The runtime image must be built with `docker buildx` (not the legacy
`docker build`) so the native modules (`better-sqlite3`, `node-pty`) are
compiled for both architectures K8s nodes commonly run on:

```sh
# One-time: create a multi-arch builder
docker buildx create --use --name rdv-builder

# Build + push (replace VERSION with your tag, e.g. 0.3.18 or a git SHA)
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/btli/remote-dev:VERSION \
  --push \
  .
```

Verify the manifest list includes both architectures:

```sh
docker buildx imagetools inspect ghcr.io/btli/remote-dev:VERSION
# → look for `linux/amd64` AND `linux/arm64` under Manifests
```

If you're rolling out from a CI pipeline, use the commit SHA as the tag so
each deploy is uniquely identifiable and rollbacks are precise.

---

## StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: rdv-alpha
  namespace: rdv
spec:
  serviceName: rdv-alpha-headless
  replicas: 1                       # NEVER >1 — see §0 of basepath spec
  selector:
    matchLabels:
      app: rdv
      instance: alpha
  template:
    metadata:
      labels:
        app: rdv
        instance: alpha
    spec:
      # fsGroup must match the rdv user uid baked into the image (10001).
      # Without this, the PVC mounts root-owned and entrypoint.sh fails
      # the writability pre-check.
      securityContext:
        fsGroup: 10001
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
      # K8s default is 30s; entrypoint.sh force-kills children at 25s so
      # we exit cleanly before SIGKILL. If you raise this, also raise the
      # `sleep 25` in docker/entrypoint.sh.
      terminationGracePeriodSeconds: 30
      containers:
        - name: rdv
          # Replace VERSION with the tag you built and pushed (see
          # "Building the image" below). Do NOT use `latest` in production —
          # it disables image-pull cache invalidation.
          image: ghcr.io/btli/remote-dev:VERSION
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 6001
            - name: ws
              containerPort: 6002
          env:
            - name: RDV_BASE_PATH
              value: "/alpha"
            - name: RDV_INSTANCE_SLUG
              value: "alpha"
            - name: RDV_DATA_DIR
              value: "/var/lib/rdv"
            - name: PORT
              value: "6001"
            - name: TERMINAL_PORT
              value: "6002"
            - name: NEXT_PUBLIC_TERMINAL_PORT
              value: "6002"
            - name: AUTH_URL
              value: "https://dev.example.com/alpha"
            # Disable the localhost credentials provider in containers —
            # x-forwarded-for from the LB never equals 127.0.0.1 anyway,
            # but explicit is safer than implicit.
            - name: ENABLE_LOCAL_CREDENTIALS
              value: "false"
            - name: CF_ACCESS_TEAM
              valueFrom:
                secretKeyRef: { name: rdv-shared, key: cf-team }
            - name: CF_ACCESS_AUD
              valueFrom:
                secretKeyRef: { name: rdv-shared, key: cf-aud }
            # Per-instance AUTH_SECRET (see AC-5). Do NOT share across
            # instances — that breaks the only isolation guarantee for
            # the __Host- CSRF cookie.
            - name: AUTH_SECRET
              valueFrom:
                secretKeyRef: { name: rdv-alpha, key: auth-secret }
            - name: GITHUB_CLIENT_ID
              valueFrom:
                secretKeyRef: { name: rdv-alpha, key: github-client-id }
            - name: GITHUB_CLIENT_SECRET
              valueFrom:
                secretKeyRef: { name: rdv-alpha, key: github-client-secret }
          volumeMounts:
            - name: data
              mountPath: /var/lib/rdv
          # K8s probes hit the in-pod IP, not the LB, so the basePath is
          # part of the URL Next.js serves. With RDV_BASE_PATH=/alpha,
          # the route is reachable at /alpha/api/healthz.
          livenessProbe:
            httpGet:
              path: /alpha/api/healthz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /alpha/api/readyz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          resources:
            requests:
              cpu: "200m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "2Gi"
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 5Gi
        # storageClassName: <your CSI driver>
```

For the `/beta` instance, copy the manifest and substitute `alpha → beta`
everywhere (including `RDV_BASE_PATH`, `RDV_INSTANCE_SLUG`, `AUTH_URL`,
probe paths, and the secret name).

---

## Headless Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: rdv-alpha-headless
  namespace: rdv
spec:
  clusterIP: None             # headless — StatefulSet wires DNS per pod
  selector:
    app: rdv
    instance: alpha
  ports:
    - name: http
      port: 6001
      targetPort: http
    - name: ws
      port: 6002
      targetPort: ws
---
# ClusterIP for the Ingress to target.
apiVersion: v1
kind: Service
metadata:
  name: rdv-alpha
  namespace: rdv
spec:
  selector:
    app: rdv
    instance: alpha
  ports:
    - name: http
      port: 6001
      targetPort: http
    - name: ws
      port: 6002
      targetPort: ws
```

---

## Ingress (Traefik example)

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: rdv
  namespace: rdv
spec:
  entryPoints: [websecure]
  routes:
    # /alpha → Next.js (handles both /alpha/login and /alpha/api/*)
    - match: Host(`dev.example.com`) && PathPrefix(`/alpha`) && !PathPrefix(`/alpha/ws`)
      kind: Rule
      services:
        - name: rdv-alpha
          port: http
    # /alpha/ws → terminal server (WebSocket upgrade)
    - match: Host(`dev.example.com`) && PathPrefix(`/alpha/ws`)
      kind: Rule
      services:
        - name: rdv-alpha
          port: ws
    # Repeat for /beta...
    - match: Host(`dev.example.com`) && PathPrefix(`/beta`) && !PathPrefix(`/beta/ws`)
      kind: Rule
      services:
        - name: rdv-beta
          port: http
    - match: Host(`dev.example.com`) && PathPrefix(`/beta/ws`)
      kind: Rule
      services:
        - name: rdv-beta
          port: ws
  tls:
    secretName: dev-example-com-tls
```

Notes:
- The `!PathPrefix(/alpha/ws)` exclusion on the first rule is what routes
  WebSocket upgrades to the terminal server (port 6002) while everything
  else hits Next.js (6001). Traefik picks the most-specific match first,
  so this works without explicit priorities.
- If your Ingress controller can't do path-based service selection,
  consider routing all traffic to Next.js and having Next.js rewrite
  `/{prefix}/ws → terminal-server:6002` internally — but that adds a
  proxy hop on the hot path.

---

## Secrets

```yaml
# Shared across all instances — only the unsensitive CF Access tags
apiVersion: v1
kind: Secret
metadata:
  name: rdv-shared
  namespace: rdv
type: Opaque
stringData:
  cf-team: yourteam
  cf-aud: aud-tag-from-cf-access-app

---
# Per-instance — AUTH_SECRET must be unique per instance (AC-5).
# Generate with: openssl rand -base64 32
apiVersion: v1
kind: Secret
metadata:
  name: rdv-alpha
  namespace: rdv
type: Opaque
stringData:
  auth-secret: REPLACE_ME_alpha_32_byte_base64
  github-client-id: Iv1.xxxx
  github-client-secret: REPLACE_ME_alpha

---
apiVersion: v1
kind: Secret
metadata:
  name: rdv-beta
  namespace: rdv
type: Opaque
stringData:
  auth-secret: REPLACE_ME_beta_32_byte_base64    # MUST differ from alpha
  github-client-id: Iv1.yyyy
  github-client-secret: REPLACE_ME_beta
```

---

## First-boot seeding

The image deliberately does not seed `authorized_users` from the
entrypoint. Run the seed manually once per instance:

```sh
kubectl -n rdv exec -it rdv-alpha-0 -- \
  env AUTHORIZED_USERS=ops@example.com,you@example.com bun run db:seed
```

---

## Verifying a deployment

After applying manifests for `/alpha`:

```sh
# Probes (kubelet-internal, no auth, must succeed)
kubectl -n rdv exec rdv-alpha-0 -- \
  curl -sf http://localhost:6001/alpha/api/healthz
# → {"status":"ok"}

kubectl -n rdv exec rdv-alpha-0 -- \
  curl -sf http://localhost:6001/alpha/api/readyz
# → {"ready":true,"checks":{"db":{"ok":true},"tmux":{"ok":true}}}

# External (Cloudflare Access required)
curl -sI https://dev.example.com/alpha/login
# → 200 OK, with header `x-rdv-instance: alpha`
```

If `/readyz` returns 503, inspect `kubectl logs rdv-alpha-0` — the JSON
body in the 503 response identifies which check failed.

---

## Known limitations

- **Instance lock is advisory.** `src/lib/instance-lock.ts` writes a PID
  sentinel at `${RDV_DATA_DIR}/instance.lock` and refuses to start if a
  live PID holds it. This catches accidental misconfiguration (two pods
  sharing a PVC via a non-RWO mount) but is not kernel-enforced. ReadWriteOnce
  PVCs are the real isolation guarantee.

  The lock engages **only in multi-instance mode** — i.e. when `RDV_BASE_PATH`
  is non-empty (as in every manifest above). In single-host mode (empty
  `RDV_BASE_PATH`: dev, Electron, self-hosted single-tenant prod) it is a no-op:
  there, the launchd/systemd watchdog and the deploy/restart scripts are the
  single-writer guard, and an engaged lock would deadlock a restart (the new
  server sees the old one's still-live lock and crash-loops). Set
  `RDV_FORCE_INSTANCE_LOCK=1` to force the lock on even with an empty
  `RDV_BASE_PATH` — for the unusual single-host setup that genuinely runs
  multiple writers against one `RDV_DATA_DIR`.
- **No horizontal scale per instance.** SQLite is single-writer. Use
  more instances under different prefixes if you need to spread load.
- **tmux sockets on PVC.** `entrypoint.sh` sets `TMUX_TMPDIR` under
  `RDV_DATA_DIR/tmux` so sessions survive container restarts within a
  pod. Cross-pod migration is not supported.
