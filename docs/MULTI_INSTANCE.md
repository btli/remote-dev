# Multi-Instance Deployment on Kubernetes

Reference manifests for running `remote-dev` as one or more path-prefixed
instances behind a shared Cloudflare tunnel + Access policy. Each instance
is a single-replica StatefulSet with its own PVC, SQLite database, tmux
namespace, and `AUTH_SECRET`.

> **Two deployment shapes.** Remote Dev runs in one of two shapes:
>
> - **Shape A — single-instance ("routerless").** The original product: the base
>   `remote-dev` app at root (`RDV_BASE_PATH=""`), with **no Supervisor and no
>   router** (local dev, Electron, self-hosted single-tenant prod). See
>   [`docs/SETUP.md`](./SETUP.md).
> - **Shape B — multi-instance (Supervisor + router).** N independent
>   single-tenant instances on k3s, provisioned by the **Supervisor** and fronted
>   by the **router** as the **single external front door**: one hostname, one
>   Cloudflare Access app — `/` → the Supervisor dashboard, `/<slug>/*` → the
>   matching instance, both with **no prefix stripping** and **no per-instance
>   Ingress object**. The Phase 1+2 control plane (`apps/supervisor` +
>   `apps/supervisor-router`) exists; deploy it with the runbook
>   **[`docs/SUPERVISOR_DEPLOY.md`](./SUPERVISOR_DEPLOY.md)** (manifests in
>   [`deploy/k8s/supervisor/`](../deploy/k8s/supervisor/)). Design:
>   [`docs/plans/2026-05-30-k3s-supervisor-platform.md`](./plans/2026-05-30-k3s-supervisor-platform.md).
>
> The hand-rolled Traefik/`IngressRoute` manifests below are a **third, manual**
> path: static multi-instance hosting **without** the Supervisor (path-prefixed
> instances behind your own Ingress). They remain valid, but Shape B supersedes
> the per-instance `IngressRoute` for any dynamic multi-instance deployment.
>
> Regardless of shape, **`src/lib/base-path.ts` is the runtime single source of
> truth for `RDV_BASE_PATH`** URL prefixing (ESLint-guarded; only it and
> `next.config.ts` may read the env var). See
> [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) → "Multi-instance / multi-tenant
> hosting".

See also:
- `docs/SUPERVISOR_DEPLOY.md` — **deploy runbook for the k3s supervisor platform** (router + control plane; supersedes the per-instance IngressRoute model below)
- `docs/plans/multi-instance-basepath.md` — the design spec and acceptance criteria
- `docs/plans/2026-05-30-k3s-supervisor-platform.md` — the k3s supervisor platform design
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

> **Superseded by the supervisor router.** Under the k3s supervisor platform you
> do **not** create this `IngressRoute` (or any per-instance Ingress): the
> stateless `router` Deployment forwards `/<slug>/*` to the matching instance
> Service by convention, with WebSocket-aware `/<slug>/ws` handling and no prefix
> stripping. See [`docs/SUPERVISOR_DEPLOY.md`](./SUPERVISOR_DEPLOY.md). The
> example below applies only to the hand-rolled, Supervisor-less model.

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

## CloudNativePG (database-per-instance)

By default each instance keeps its own **SQLite** DB on its PVC. Optionally, a
fleet can instead run on **PostgreSQL** with a **database-per-instance** model
on one shared, highly-available [CloudNativePG](https://cloudnative-pg.io/)
(CNPG) cluster. This is opt-in: leave the `CNPG_*` env unset and instances stay
on SQLite (unchanged behavior).

- **One shared HA cluster.** `deploy/k8s/cnpg/` (`namespace.yaml`,
  `cluster.yaml`) declares a single `rdv-pg` cluster (primary + standbys), a
  daily backup, and a **PgBouncer Pooler**. See
  [`deploy/k8s/cnpg/README.md`](../deploy/k8s/cnpg/README.md) for operator
  install + cluster setup.
- **One database + role per instance.** When CNPG is configured, the supervisor
  provisioner creates a login role + database `rdv_<slug>` for each instance
  (`bootstrapInstanceDatabase`, idempotent DDL). This DDL runs against the CNPG
  **RW Service**, not the Pooler — PgBouncer's transaction-pooling mode blocks
  session-level DDL like `CREATE DATABASE`.
- **Per-instance `DATABASE_URL`.** The provisioner injects each instance's
  connection string as a per-instance `rdv-<slug>-db` Secret, pointed at the
  **PgBouncer Pooler** (the supervisor and instance apps connect through the
  pool, not the RW Service). The instance StatefulSet reads `DATABASE_URL` from
  that Secret as a `secretKeyRef`.
- **Migrate-on-boot.** An instance whose `DATABASE_URL` is a `postgresql://` URL
  applies its schema via the app's Postgres migrate-on-boot; the container
  entrypoint **skips the SQLite schema bootstrap** in that case (`docker/
  entrypoint.sh`).

### CNPG_* configuration

Set these on the supervisor (see
`deploy/k8s/supervisor/secrets.example.yaml`) only for a Postgres-backed fleet;
leave them all unset for SQLite:

| Key | Purpose |
|-----|---------|
| `CNPG_CLUSTER_NAMESPACE`, `CNPG_CLUSTER_NAME` | Identify the shared cluster (e.g. `cnpg-clusters` / `rdv-pg`). |
| `CNPG_POOLER_HOST`, `CNPG_POOLER_PORT` | PgBouncer Pooler endpoint baked into each instance's `DATABASE_URL`. |
| `CNPG_RW_HOST` | RW Service used for provisioning DDL (`CREATE ROLE`/`CREATE DATABASE`). |
| `CNPG_SUPERUSER_SECRET_NAME`, `CNPG_SUPERUSER_SECRET_NAMESPACE` | The CNPG-generated superuser Secret the provisioner reads to run that DDL. |

### Soft teardown + manual purge

Instance teardown is **soft** by design: deleting an instance removes its
namespace/objects but **does not drop its CNPG database or role** (dropping a
database is irreversible — a mis-fire would destroy user data). To reclaim a
deleted instance's database, run the purge **manually against the CNPG RW
Service** (not the Pooler):

```sql
DROP DATABASE rdv_<slug>;
DROP ROLE rdv_<slug>;
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

## Per-instance package provisioning

Each instance is a real dev environment, so agents install their own toolchains
at runtime. By default those installs land on the container's ephemeral layer and
are wiped on the next restart. The entrypoint fixes this by pointing every
language tool's global prefix at the PVC under `${RDV_DATA_DIR}/provision`:

| Tool   | Env exported          | Persists where                       |
|--------|-----------------------|--------------------------------------|
| npm    | `NPM_CONFIG_PREFIX`   | `${RDV_DATA_DIR}/provision/npm-global` |
| cargo  | `CARGO_HOME`          | `${RDV_DATA_DIR}/provision/cargo`    |
| rustup | `RUSTUP_HOME`         | `${RDV_DATA_DIR}/provision/rustup`   |
| pipx   | `PIPX_HOME` / `PIPX_BIN_DIR` | `${RDV_DATA_DIR}/provision/pipx` |

Their `bin/` dirs are prepended to `PATH` for both servers and every agent PTY
(the terminal server copies the process env into each session). So an ad-hoc
`npm i -g <pkg>`, `pipx install <pkg>`, or `cargo install <pkg>` an agent runs
**persists across restarts with no manifest required** (`rustup` is bootstrapped
into the PVC on first `cargo install`). The baked agent CLIs stay in the system
prefix `/usr/local` — the boot auto-update targets them explicitly with
`npm update -g --prefix /usr/local`, so they are never duplicated onto the PVC.

### Declarative manifest (two layers)

For reproducible instances, declare packages in a manifest. Two layers are merged
+ de-duped at boot:

1. **Supervisor baseline** — `SUPERVISOR_INSTANCE_BASELINE_PACKAGES` in the
   supervisor config Secret, an OPTIONAL JSON manifest string injected into every
   instance it provisions as `RDV_PROVISION_BASELINE`. Malformed JSON fails that
   instance's provision loudly.
2. **Per-instance** — `${RDV_DATA_DIR}/provision/packages.yaml` (or
   `packages.json`), user/agent-editable and persisted on the PVC.

Manifest schema (all keys optional; each an array of package names):

```yaml
apt:   [ ripgrep, fd-find ]   # system pkgs — re-applied each boot (ephemeral)
npm:   [ typescript, prettier ] # npm install -g — persists (NPM_CONFIG_PREFIX)
pip:   [ ruff, httpie ]       # pipx install (one venv each) — persists (PIPX_HOME)
cargo: [ ripgrep, just ]      # cargo install — persists (CARGO_HOME)
```

Provisioning runs in the **background after the servers are up**, so it never
delays readiness; all errors are swallowed and logged to `/tmp/provision.log`.
Every entry is validated against a conservative token allowlist
(`/^[A-Za-z0-9._@/+-]+$/`) and de-duped; invalid entries are skipped + logged.
Installs are idempotent (the package managers skip already-installed packages), so
because the npm/pip/cargo prefixes live on the PVC, warm reboots only re-run the
ephemeral `apt` layer.

> **`cargo` packages that compile native code need a C toolchain** — list
> `build-essential` under `apt:` in the same manifest (apt is applied before
> cargo in the entrypoint, so it will be present in time).

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
