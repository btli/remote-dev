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

## Topology

```
  Cloudflare Access app "supervisor"        Cloudflare Access app "instances"
  (sup.example.com, its own AUD)            (dev.example.com/*, its own AUD)
              │                                          │
        CF tunnel ───────────────┐         ┌──────── CF tunnel
              ▼                   │         │              ▼
   Service supervisor:6003        │         │     Service router:6004
   (rdv-system)                   │         │     (rdv-system, ≥2 replicas)
              │                   │         │              │  /<slug>/* (no strip)
   ┌──────────┴───────────┐       │         │              ▼
   │ Deployment rdv-supervisor    │         │   StatefulSet rdv per instance ns
   │  • web container (6003)      │         │   (rdv-<slug>, created at RUNTIME
   │  • controller container      │         │    by the Supervisor — NOT here)
   │  • shared PVC (SQLite)       │         │
   └──────────────────────────────┘         └─────────────────────────────────
```

Two **separate hostnames**, two **separate Cloudflare Access apps** with
**distinct AUDs** (spec §15 M3): putting the Supervisor on its own host avoids
`CF_Authorization` cookie/AUD ambiguity and re-auth loops. No wildcard DNS is
needed (path routing).

---

## Prerequisites

- A k3s cluster + `kubectl` context pointing at it.
- A **replicated** StorageClass for control-plane + instance data (Longhorn, an
  NFS dynamic provisioner, or a cloud CSI). `local-path` is **not** acceptable
  for the Supervisor PVC — its SQLite is the source of truth for every instance
  and must survive node loss (spec §6.1).
- A Cloudflare account with the existing tunnel, and permission to create
  Cloudflare Access apps.
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

## 2. Create the two Cloudflare Access apps + point the tunnel

Operator-managed (spec §14.1/§14.2/§15 M3). In the Cloudflare Zero Trust
dashboard:

1. **Instances app** — application covering `dev.example.com/*` (the host the
   router serves). Note its **AUD** → this is `CF_ACCESS_AUD` (the *instances'*
   app) in the Secret.
2. **Supervisor app** — a **separate** application for `sup.example.com` (a
   distinct hostname). Note its **AUD** → this is `SUPERVISOR_CF_ACCESS_AUD`.
   Restrict its policy to operators/admins only — Supervisor access never grants
   instance access.

Both apps share the same Cloudflare **team** subdomain (`CF_ACCESS_TEAM` /
`SUPERVISOR_CF_ACCESS_TEAM`).

Point the Cloudflare **tunnel** (public hostnames → in-cluster Services):

| Public hostname | Service | Notes |
|---|---|---|
| `dev.example.com` | `http://router.rdv-system.svc.cluster.local:6004` | instances front door (WebSockets included) |
| `sup.example.com` | `http://supervisor.rdv-system.svc.cluster.local:6003` | operator dashboard |

The router and instances forward `CF_Authorization` untouched; each instance
validates the CF Access JWT itself (the router does not terminate auth).

---

## 3. Apply the control-plane manifests

```bash
# 3a. Namespace
kubectl apply -f deploy/k8s/supervisor/namespace.yaml

# 3b. Config Secret — REAL values, out-of-band (do NOT commit). Use the
#     secrets.example.yaml keys as the checklist. Either kubectl create secret
#     (see the header of secrets.example.yaml) or sealed-secrets/SOPS.
kubectl -n rdv-system create secret generic rdv-supervisor-config \
  --from-literal=SUPERVISOR_CF_ACCESS_TEAM=my-team \
  --from-literal=SUPERVISOR_CF_ACCESS_AUD=<supervisor-app-aud> \
  --from-literal=SUPERVISOR_INTERNAL_SECRET="$(openssl rand -base64 32)" \
  --from-literal=SUPERVISOR_ADMIN_EMAIL=admin@example.com \
  --from-literal=SUPERVISOR_INSTANCE_HOST=dev.example.com \
  --from-literal=SUPERVISOR_INSTANCE_IMAGE=ghcr.io/btli/remote-dev:"$SHA" \
  --from-literal=SUPERVISOR_DEFAULT_STORAGE_CLASS=longhorn \
  --from-literal=SUPERVISOR_DEFAULT_STORAGE_SIZE=10Gi \
  --from-literal=CF_ACCESS_TEAM=my-team \
  --from-literal=CF_ACCESS_AUD=<instances-app-aud>
# Optional — for a PRIVATE registry / mixed-arch instances, append these flags to
# the command above (add a trailing `\` to its CF_ACCESS_AUD line first):
#   --from-literal=SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME=harbor-registry
#   --from-literal=SUPERVISOR_INSTANCE_IMAGE_PULL_DOCKERCONFIGJSON="$(cat ~/.docker/config.json)"
#   --from-literal=SUPERVISOR_INSTANCE_NODE_SELECTOR=kubernetes.io/arch=amd64

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

External (through the tunnel + Cloudflare Access):

1. Browse to `https://sup.example.com` → authenticate via the **Supervisor**
   Access app → the operator dashboard loads (you are the `SUPERVISOR_ADMIN_EMAIL`
   admin).
2. Create a test instance (e.g. slug `alpha`) with a storage target. Watch it
   go `requested → provisioning → ready`:
   ```bash
   kubectl get ns -l managed-by=rdv-supervisor   # rdv-alpha appears
   kubectl -n rdv-alpha get statefulset,pod,svc
   ```
3. Reach the instance through the router at `https://dev.example.com/alpha`
   (authenticate via the **instances** Access app). Confirm assets load, login
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
