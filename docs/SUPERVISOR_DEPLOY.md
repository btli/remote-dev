# Supervisor Platform — k3s Deploy Runbook

Operator steps to deploy the **k3s Supervisor platform**: the control-plane
**Supervisor** (operator UI + REST API + reconciler controller) and the
stateless **router** that fronts provisioned instances. Once running, the
Supervisor provisions/suspends/deletes instances itself — there are **no
per-instance manifests** to apply.

> Design reference: [`docs/plans/2026-05-30-k3s-supervisor-platform.md`](./plans/2026-05-30-k3s-supervisor-platform.md).
> This runbook delivers Phase 1 (RBAC + Deployments + Dockerfiles).
>
> Manifests live in [`deploy/k8s/supervisor/`](../deploy/k8s/supervisor/):
> `namespace.yaml`, `rbac.yaml`, `secrets.example.yaml` (template),
> `supervisor.yaml`, `router.yaml`.

> **Deployment shapes.** Remote Dev runs in one of two shapes. **Shape A**
> (single-instance / "routerless") is the base app at root with **no Supervisor
> and no router** (local dev, Electron, self-hosted single-tenant prod) — that is
> [`docs/SETUP.md`](./SETUP.md), not this runbook. **Shape B** (multi-instance) is
> this runbook: the Supervisor + the router as the **single external front door**
> — one hostname, one Cloudflare Access app, `/` → the dashboard and `/<slug>/*`
> → instances.

## Topology

A **single front door** (Option C): the router is the only external entry. One
hostname, one Cloudflare Access app. The router proxies `/` (and every
non-instance path — `/login`, `/api/*`, assets) to the Supervisor dashboard
**internally**, and `/<slug>/*` to the matching instance — both with no prefix
stripping. The Supervisor Service is internal (ClusterIP), reached only via the
router; it has **no** public hostname of its own.

```
            Cloudflare Access app "remote-dev"  (single host: dev.example.com/*, one AUD)
                                    │
                              CF tunnel
                                    ▼
                         Service router:6004
                         (rdv-system, ≥2 replicas)
                          │                        │
            non-instance  │  /  /login  /api/*     │  /<slug>/*  (no strip)
            (no strip)    ▼                        ▼
                 Service supervisor:6003     StatefulSet rdv per instance ns
                 (rdv-system, ClusterIP)     (rdv-<slug>, created at RUNTIME
                          │                   by the Supervisor — NOT here)
            ┌─────────────┴────────────┐
            │ Deployment rdv-supervisor │
            │  • web container (6003)   │
            │  • controller container   │
            │  • shared PVC (SQLite)    │
            └───────────────────────────┘
```

One **hostname**, one **Cloudflare Access app** (one AUD). The router forwards
`CF_Authorization` untouched to whichever upstream it selects (dashboard or
instance) — it never terminates auth. Auth isolation between the dashboard and
instances is by **policy within that one app** plus the Supervisor's own role
gate (spec §15 M3 revision). No wildcard DNS is needed (path routing).

---

## Prerequisites

- A k3s cluster + `kubectl` context pointing at it.
- A **replicated** StorageClass for control-plane + instance data (Longhorn, an
  NFS dynamic provisioner, or a cloud CSI). `local-path` is **not** acceptable
  for the Supervisor PVC — its SQLite is the source of truth for every instance
  and must survive node loss (spec §6.1).
- A Cloudflare account with the existing tunnel, and permission to create a
  Cloudflare Access app (one app fronts the single host).
- A GHCR push token (or another registry) for the three images.
- `docker buildx` configured for multi-arch (a `docker-container` builder).

---

## 1. Build + push the three images

Multi-arch (`linux/amd64,linux/arm64`), tagged by git SHA — never `:latest` in
manifests (spec §9). The **instance** image already exists (it is the main app's
`Dockerfile` at the repo root, slug-aware via the `/rdvslug` sentinel). Build the
two new control-plane images from the **repo root** (the bun workspace is the
build context):

```bash
SHA="$(git rev-parse --short HEAD)"

# Instance (data plane) — main app image (if not already pushed):
docker buildx build --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/btli/remote-dev:"$SHA" --push .

# Supervisor (control plane):
docker buildx build --platform linux/amd64,linux/arm64 \
  --file apps/supervisor/Dockerfile \
  --tag ghcr.io/btli/remote-dev-supervisor:"$SHA" --push .

# Router (data-plane front door):
docker buildx build --platform linux/amd64,linux/arm64 \
  --file apps/supervisor-router/Dockerfile \
  --tag ghcr.io/btli/remote-dev-router:"$SHA" --push .
```

Record the three `:$SHA` tags — they go into the Secret
(`SUPERVISOR_INSTANCE_IMAGE`) and the two Deployment manifests
(`supervisor.yaml`, `router.yaml` — replace the `REPLACE_ME-…:<sha>` image
fields).

> If GHCR is private, create an image-pull Secret in `rdv-system` and add it to
> the Deployments' `imagePullSecrets` (and the provisioner config for instance
> pulls). For the **instance** images specifically, set
> `SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME` (+
> `SUPERVISOR_INSTANCE_IMAGE_PULL_DOCKERCONFIGJSON`) in the config Secret — the
> provisioner then AUTO-creates the per-instance dockerconfigjson pull Secret in
> each `rdv-<slug>` namespace and references it from the instance pod (set just
> the NAME if you provision that Secret out-of-band). On a **mixed-arch** cluster
> set `SUPERVISOR_INSTANCE_NODE_SELECTOR` (e.g. `kubernetes.io/arch=amd64`) to
> pin instance pods to nodes matching the instance image's architecture.

---

## 2. Create the single Cloudflare Access app + point the tunnel

Operator-managed (spec §14.1/§14.2/§15 M3 revision). One app fronts the one
external host; the router serves both the dashboard (at `/`) and instances (at
`/<slug>/*`) behind it. In the Cloudflare Zero Trust dashboard:

1. **Remote Dev app** — a **single** application covering `dev.example.com/*`
   (the host the router serves). Note its **AUD**: use it for **both**
   `CF_ACCESS_AUD` (the value injected into each instance) and
   `SUPERVISOR_CF_ACCESS_AUD` (the Supervisor's own validation) — under one app
   these are the **same value**. Scope its policy to your operators/users;
   instance-vs-dashboard access is then differentiated by the Supervisor's own
   role gate, not by a second app.

`CF_ACCESS_TEAM` and `SUPERVISOR_CF_ACCESS_TEAM` are likewise the same team
subdomain.

Point the Cloudflare **tunnel** (one public hostname → the router Service):

| Public hostname | Service | Notes |
|---|---|---|
| `dev.example.com` | `http://router.rdv-system.svc.cluster.local:6004` | single front door — dashboard at `/`, instances at `/<slug>/*` (WebSockets included) |

The router forwards `CF_Authorization` untouched to whichever upstream it
selects (the Supervisor dashboard or an instance); each validates the CF Access
JWT itself (the router does not terminate auth). The `supervisor` Service is
**internal** (ClusterIP) — it is **not** a tunnel target.

---

## 2b. OIDC (optional native login)

The dashboard can authenticate operators with a **generic OIDC** identity
provider (Authentik, Keycloak, Okta, Entra ID, Google, …) **in addition to or
instead of** Cloudflare Access. This is the "native login" path — a `/login`
page with a **Sign in with `<SUPERVISOR_OIDC_NAME>`** button.

**Dual auth.** A request is authenticated if it carries a valid **CF Access JWT
OR** a valid **NextAuth OIDC session** (resolution order: CF first when
configured, then the OIDC session, then — dev only — `SUPERVISOR_ADMIN_EMAIL`).
The two coexist: behind CF Access, the OIDC session is what a browser uses once
the user signs in; both resolve to an email that maps to a `supervisor_user`
(the role mapping is unchanged). The fail-closed startup guard accepts **either**
CF Access **or** OIDC — configuring OIDC alone is enough to boot in production.

**Closed allowlist (the security rule).** An OIDC login is accepted **only if
the email is already a known `supervisor_user` row OR equals
`SUPERVISOR_ADMIN_EMAIL`** (the seeded admin). Unknown emails the IdP
authenticates are **denied** — provisioning access is an explicit admin action
(create the `supervisor_user` first), not an automatic consequence of the IdP
trusting someone. (The CF Access path keeps its existing auto-`viewer` behavior.)
The same allowlist is **re-checked on every request**, so **deleting a user's
`supervisor_user` row revokes their access on the next request** even though
sessions are stateless JWTs — no session-table cleanup or cookie expiry needed.

**Configure.** Set these keys in the `rdv-supervisor-config` Secret (all four
required to enable OIDC; omit them all for a CF-Access-only deploy):

| Key | Value |
|---|---|
| `SUPERVISOR_OIDC_ISSUER` | Issuer URL; discovery is `{issuer}/.well-known/openid-configuration` |
| `SUPERVISOR_OIDC_CLIENT_ID` | OAuth client id from the IdP |
| `SUPERVISOR_OIDC_CLIENT_SECRET` | OAuth client secret (a secret — never commit/log) |
| `SUPERVISOR_OIDC_NAME` | Display label for the button (e.g. `Authentik`); default `SSO` |
| `AUTH_SECRET` | Signs the NextAuth JWT session cookie — `openssl rand -base64 32` |

**Register the callback URL** with the IdP (the provider id is the fixed string
`oidc`):

```
https://<host>/api/auth/callback/oidc
```

where `<host>` is the single external host the router fronts (e.g.
`https://dev.example.com/api/auth/callback/oidc`). The login flow (`/login` and
`/api/auth/*`) is reachable without a CF assertion so users can sign in.

---

## 3. Apply the control-plane manifests

```bash
# 3a. Namespace
kubectl apply -f deploy/k8s/supervisor/namespace.yaml

# 3b. Config Secret — REAL values, out-of-band (do NOT commit). Use the
#     secrets.example.yaml keys as the checklist. Either kubectl create secret
#     (see the header of secrets.example.yaml) or sealed-secrets/SOPS.
#     Under the single-front-door model there is ONE CF Access app, so
#     SUPERVISOR_CF_ACCESS_AUD == CF_ACCESS_AUD and
#     SUPERVISOR_CF_ACCESS_TEAM == CF_ACCESS_TEAM (same values below).
kubectl -n rdv-system create secret generic rdv-supervisor-config \
  --from-literal=SUPERVISOR_CF_ACCESS_TEAM=my-team \
  --from-literal=SUPERVISOR_CF_ACCESS_AUD=<remote-dev-app-aud> \
  --from-literal=SUPERVISOR_INTERNAL_SECRET="$(openssl rand -base64 32)" \
  --from-literal=SUPERVISOR_ADMIN_EMAIL=admin@example.com \
  --from-literal=SUPERVISOR_INSTANCE_HOST=dev.example.com \
  --from-literal=SUPERVISOR_INSTANCE_IMAGE=ghcr.io/btli/remote-dev:"$SHA" \
  --from-literal=SUPERVISOR_DEFAULT_STORAGE_CLASS=longhorn \
  --from-literal=SUPERVISOR_DEFAULT_STORAGE_SIZE=10Gi \
  --from-literal=CF_ACCESS_TEAM=my-team \
  --from-literal=CF_ACCESS_AUD=<remote-dev-app-aud>   # same AUD as SUPERVISOR_CF_ACCESS_AUD
# Optional — for a PRIVATE registry / mixed-arch instances, append these flags to
# the command above (add a trailing `\` to its CF_ACCESS_AUD line first):
#   --from-literal=SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME=harbor-registry
#   --from-literal=SUPERVISOR_INSTANCE_IMAGE_PULL_DOCKERCONFIGJSON="$(cat ~/.docker/config.json)"
#   --from-literal=SUPERVISOR_INSTANCE_NODE_SELECTOR=kubernetes.io/arch=amd64
# Optional — a fleet-wide package BASELINE applied to every instance on boot
# (see "Per-instance package provisioning" in docs/MULTI_INSTANCE.md). A JSON
# manifest string injected as the instance's RDV_PROVISION_BASELINE; malformed
# JSON fails that instance's provision loudly. NOTE: `cargo` packages that compile
# native code need a C toolchain, so include "build-essential" in the same
# manifest's `apt` list (apt is applied before cargo in the entrypoint):
#   --from-literal=SUPERVISOR_INSTANCE_BASELINE_PACKAGES='{"apt":["build-essential"],"npm":["typescript"],"pip":["ruff"]}'

# 3c. RBAC (ServiceAccount + ClusterRole + ClusterRoleBinding)
kubectl apply -f deploy/k8s/supervisor/rbac.yaml

# 3d. Before applying: edit the two Deployment manifests —
#       • supervisor.yaml + router.yaml: set the two `REPLACE_ME-…:<sha>` images
#       • supervisor.yaml PVC:           set storageClassName (replicated SC)
kubectl apply -f deploy/k8s/supervisor/supervisor.yaml
kubectl apply -f deploy/k8s/supervisor/router.yaml
```

> **Instance namespaces/objects are created at runtime by the Supervisor.** When
> an operator provisions an instance, the reconciler creates the `rdv-<slug>`
> namespace and its Service/Secret(s)/StatefulSet (+ optional seed Job). There
> are **no per-instance manifests** in this repo.

---

## 3b. (Optional) PostgreSQL via CloudNativePG

By default instances use per-PVC SQLite. To run the fleet on **PostgreSQL** with
a **database-per-instance** model instead, stand up one shared HA CloudNativePG
cluster and set the `CNPG_*` keys in the supervisor config Secret. With those
set, the provisioner creates a role + database `rdv_<slug>` per instance and
injects its `DATABASE_URL` (pointed at the PgBouncer Pooler). Leave the `CNPG_*`
keys unset to keep SQLite.

- Cluster setup: [`deploy/k8s/cnpg/`](../deploy/k8s/cnpg/) (+ its `README.md`).
- Config keys + soft-teardown/purge runbook: the "CloudNativePG
  (database-per-instance)" section in [`docs/MULTI_INSTANCE.md`](./MULTI_INSTANCE.md).

---

## 4. Verify

```bash
# Pods Ready (rdv-supervisor 2/2 — web + controller; rdv-router 2 replicas).
kubectl -n rdv-system get pods

# Supervisor liveness (in-cluster):
kubectl -n rdv-system exec deploy/rdv-supervisor -c web -- \
  curl -sf http://localhost:6003/api/health        # → {"status":"ok"}

# Router liveness (in-cluster):
kubectl -n rdv-system exec deploy/rdv-router -- \
  curl -sf http://localhost:6004/healthz            # → {"status":"ok"}
```

External (through the tunnel + Cloudflare Access — one app):

1. Browse to `https://<host>/` (e.g. `https://dev.example.com/`) → authenticate
   via the **single** Access app → the router proxies `/` to the Supervisor
   dashboard, which loads (you are the `SUPERVISOR_ADMIN_EMAIL` admin).
2. Create a test instance (e.g. slug `alpha`) with a storage target. Watch it
   go `requested → provisioning → ready`:
   ```bash
   kubectl get ns -l managed-by=rdv-supervisor   # rdv-alpha appears
   kubectl -n rdv-alpha get statefulset,pod,svc
   ```
3. Reach the instance through the router at `https://dev.example.com/alpha`
   (the **same** Access app — no second login). Confirm assets load, login
   round-trips, and a terminal attaches over
   `wss://dev.example.com/alpha/ws` (the end-to-end tunnel + Access WebSocket
   path is the jvcx.11 smoke criterion, spec §15 M5).

---

## Rollout + rollback

- **New version:** build/push new `:$SHA` images, then patch the two control-
  plane Deployments (`kubectl -n rdv-system set image …`). For instances, the
  Supervisor patches each StatefulSet to the new instance image (spec §9 — a
  ~30s blip per single-replica instance).
- **Rollback:** `kubectl -n rdv-system rollout undo deploy/rdv-supervisor` /
  `deploy/rdv-router`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Supervisor pod `CrashLoopBackOff`, "CF Access … must be configured" | `SUPERVISOR_CF_ACCESS_*` missing in the Secret (prod refuses to start). |
| `/api/internal/routes` returns 503 to the router | `SUPERVISOR_INTERNAL_SECRET` mismatch (it must be identical in the Secret the supervisor and router both read). |
| Supervisor PVC won't bind | `storageClassName` placeholder not replaced, or the SC isn't installed. Use a replicated class. |
| Provisioning stuck in `provisioning`/`error` | Check RBAC (`kubectl auth can-i --as=system:serviceaccount:rdv-system:rdv-supervisor create statefulsets -n rdv-alpha`) and the instance pod's readiness at `/<slug>/api/readyz`. |
| Instance 404 at the router | slug not yet `ready` in the allowlist, or a reserved/invalid slug. |
