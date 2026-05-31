# Remote-Dev on k3s: Supervisor Control Plane + Slug-Aware Data Plane — Spec & Build Sheet

> Status: **DRAFT / PLAN ONLY** (no code written). Authored 2026-05-30.
> Supersedes the deployment scope deferred by `docs/plans/multi-instance-basepath.md` §10.
> Builds **on top of** the `feature/multi-instance-basepath` branch (kept as the data plane).
>
> **§15 (Codex review revisions, 2026-05-30) supersedes earlier sections where they conflict.**
> Read §15 before implementing — it corrects the materialization scope, the namespace model,
> the basePath-sensitive asset/auth surfaces, RBAC, the node-token handling, and the drain guard.

---

## 0. TL;DR

Deploy `remote-dev` on **k3s** as many independent single-tenant **instances**, fronted by a
**supervisor-owned router**, provisioned and lifecycle-managed by a standalone **Supervisor**
control-plane service. The Supervisor offers an operator UI to spin up new instances, pick a
**persistent-data location** (storage target) per instance for resiliency, and — in a later phase
— add k3s **worker machines** on demand.

Three locked decisions from design review:

1. **Routing = supervisor router + slug-aware image.** A request to `dev.example.com/<slug>/…`
   is routed by the Supervisor's own router to the matching instance. The instance image is
   **slug-aware at runtime**: `RDV_BASE_PATH` is a true **init variable that defaults to root**.
   No Traefik prefix-stripping. No per-slug image builds. One shared image.
2. **Supervisor = standalone service** in this monorepo (`apps/supervisor`), with its own auth +
   roles + DB, talking to the Kubernetes API directly, deployed as a workload on the cluster.
3. **Storage = pluggable targets** (per-node local-path, Longhorn, NFS, cloud CSI), discovered
   live and chosen per-instance via a dropdown.

Scope is **both** instances *and* machines, delivered in phases. **Phase 0 + 1** delivers the
core ask (one-image multi-instance + supervisor that provisions instances and selects storage).
Phases 3–4 add machine autoscaling.

---

## 1. Goals & Non-Goals

### Goals
- Run N independent `remote-dev` instances on a k3s cluster from **one container image**.
- Each instance keeps the data-plane isolation the branch already provides: own SQLite, own tmux
  namespace, own `AUTH_SECRET`, own PVC, advisory single-writer lock.
- A **Supervisor router** routes `/<slug>/…` to the right instance with no prefix stripping.
- A **Supervisor** service provisions/suspends/deletes instances against the k8s API, with an
  operator dashboard and a **storage-target dropdown** populated from live cluster discovery.
- Resiliency: choose where an instance's persistent data lives; document per-backend recovery.
- Later: add k3s worker **machines** automatically when capacity is short; baseline manual join.

### Non-Goals
- Multi-tenancy *within* a single instance process (each instance stays single-writer).
- Zero-downtime upgrades of a single instance (single-replica StatefulSet ⇒ brief restart blip).
- Replacing the Electron/local single-host path (it stays `RDV_BASE_PATH=""`, no materialization).
- A general-purpose PaaS. This provisions `remote-dev` instances only.

---

## 2. Why this design (resolving the routing fork)

`next.config.ts:14` bakes Next.js `basePath` (and `assetPrefix`) at **build** time. The branch
relied on building per-slug, which conflicts with "one image, runtime slug." Two rejected
alternatives and the chosen one:

| Option | Verdict |
|---|---|
| Subdomain per instance (`<slug>.host`, `basePath=""`) | Rejected by operator: wants slug paths + a real router, not DNS-per-instance. |
| Traefik `StripPrefix` + response rewrite | Rejected: fragile; mutates the hot path; Traefik owns routing we want the Supervisor to own. |
| **Supervisor router + runtime-materialized basePath** | **Chosen.** Instance genuinely serves under `/<slug>` (its runtime basePath); the Supervisor router forwards `/<slug>/…` unchanged. No stripping, no rewriting, no wildcard DNS. |

Everything the branch already made runtime-aware (`base-path.ts` exports, cookie path-scoping in
`auth-cookies.ts`, the WS upgrade gate `WS_PATH_PREFIX` in `terminal.ts`, `apiFetch` reading
`window.__RDV_BASE_PATH__`, the `x-rdv-instance` header) is **reused as-is**. The single new
data-plane capability is making Next.js's baked `basePath` a **runtime** value — see §4.

---

## 3. Architecture

```
                         Cloudflare Tunnel  (single host: dev.example.com)
                         + Cloudflare Access (one app/policy)
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │      Supervisor Router         │  Deployment (stateless, replicas≥1)
                    │  /<slug>/*  →  rdv-<slug>:6001  │  • slug → Service by convention
                    │  /<slug>/ws →  rdv-<slug>:6002  │  • allowlist refreshed from Supervisor
                    │  /         →  Supervisor UI      │  • WebSocket upgrade aware
                    └───────┬───────────────┬─────────┘  • NO prefix stripping
                            │               │
              ┌─────────────┘               └───────────────┐
              ▼                                              ▼
   rdv-alpha (StatefulSet 1/1)                    rdv-beta (StatefulSet 1/1)
   • RDV_BASE_PATH=/alpha (runtime)               • RDV_BASE_PATH=/beta (runtime)
   • Next:6001 + terminal:6002                    • Next:6001 + terminal:6002
   • PVC ← storage target A                       • PVC ← storage target B
   • Secret rdv-alpha (unique AUTH_SECRET)        • Secret rdv-beta
              ▲                                              ▲
              │   creates / suspends / deletes               │
   ┌──────────┴──────────────────────────────────────────────┐
   │                  Supervisor (control plane)               │  Deployment + own PVC
   │  • Next.js dashboard + REST API (apps/supervisor)         │  ServiceAccount + RBAC
   │  • Controller process (reconciler + capacity loop)        │  @kubernetes/client-node
   │  • Own SQLite: instances, storage targets, users, machines│  roles: admin/operator/viewer
   └──────────┬────────────────────────────────────────────────┘
              │  MachineProvider (Phase 3–4): add k3s workers when capacity is short
              ▼
   manual join-token (baseline) │ cloud-VM │ Proxmox/libvirt
```

Components:
- **Instance (data plane):** the existing `remote-dev` app, made slug-aware at runtime (§4).
- **Supervisor router (data path):** stateless reverse proxy owned by the Supervisor (§5).
- **Supervisor (control plane):** provisioning, lifecycle, storage selection, UI, RBAC (§6–7).
- **Machine layer (later):** pluggable worker-node provisioning + capacity controller (§8).

Namespacing: instances live in a dedicated namespace (e.g. `rdv-instances`); the Supervisor and
router live in `rdv-system`. Convention: instance `slug` → Service `rdv-<slug>` in `rdv-instances`.

---

## 4. Slug-aware image: runtime basePath materialization

### 4.1 The mechanism
Build the image **once** with a sentinel basePath, then rewrite it to the real slug at container
start. The sentinel must satisfy `base-path.ts`'s validator `^(/[a-z0-9][a-z0-9-]*)+$`.

- **Sentinel:** `/rdvslug` (lowercase alnum; unique token unlikely to collide in build output).
- **Build (Dockerfile build stage):** `ENV RDV_BASE_PATH=/rdvslug` before `bun run build`, so
  Next bakes `basePath=/rdvslug` and `assetPrefix=/rdvslug` into `.next/` (standalone + static +
  `routes-manifest.json` + client chunks).
- **Boot (`docker/entrypoint.sh`)**, before starting the two servers:
  1. Resolve the desired runtime prefix: `SLUG_PREFIX="${RDV_BASE_PATH:-}"` (empty ⇒ root).
  2. Materialize: recursively replace the sentinel in the build output:
     `grep -rl '/rdvslug' .next | xargs sed -i "s#/rdvslug#${SLUG_PREFIX}#g"`
     (covers `.next/server`, `.next/static`, standalone chunks; empty replacement yields root).
  3. Export the **real** `RDV_BASE_PATH` (and `RDV_INSTANCE_SLUG`) for the node processes so
     `base-path.ts` computes `BASE_PATH`, `COOKIE_PATH`, `WS_PATH_PREFIX`, `INSTANCE_SLUG`
     consistently with what was just baked into the static output.
  4. Mark materialization done (sentinel file) so a pod restart is idempotent / skipped.

After this pass the instance genuinely serves at `/<slug>` — assets at `/<slug>/_next/static/…`,
routes under `/<slug>`, cookies path-scoped to `/<slug>`, WS upgrade gate at `/<slug>/ws`. The
Supervisor router therefore **forwards `/<slug>/…` unchanged** — no stripping, no rewriting.

### 4.2 Default-root and local/Electron paths
- Root instance: `RDV_BASE_PATH` unset ⇒ sentinel replaced with empty ⇒ assets at `/_next/…`.
- `bun run dev` and Electron do **not** use this image; they keep today's behavior (next.config
  conditional `basePath` from env, default `""`). Materialization is purely a k3s-image concern.

### 4.3 Risk & fallback
- **Risk:** a future Next version could transform the basePath constant in minified output so a
  plain text replace misses an occurrence. **Mitigation:** Phase-0 acceptance test materializes
  the same image to two distinct slugs **and** root, and verifies asset load, client-side
  navigation, login round-trip, and a live WS terminal for each.
- **Fallback (only if materialization proves brittle):** the Supervisor router performs HTML/JS
  response rewriting (inject prefix on `/_next` URLs + `window.__RDV_BASE_PATH__`) and the image
  stays root. Documented as a contingency; not the primary path.

### 4.4 What changes vs the branch
| File | Change |
|---|---|
| `Dockerfile` | Add `ENV RDV_BASE_PATH=/rdvslug` in the **build** stage only; runtime stage unsets it. Multi-arch buildx (amd64+arm64). |
| `docker/entrypoint.sh` | Add the materialization pass + idempotency sentinel; then export real `RDV_BASE_PATH`/`RDV_INSTANCE_SLUG`. Keep existing `TMUX_TMPDIR`-on-PVC + graceful shutdown. |
| `next.config.ts` | No logic change (conditional basePath already present). Build env supplies the sentinel. |
| `base-path.ts`, `auth-cookies.ts`, `proxy.ts`, `terminal.ts`, `api-fetch.ts`, `useTerminalWsUrl.ts`, `layout.tsx`, `instance-lock.ts`, `healthz`/`readyz` | **Unchanged** — already runtime-correct for path mode. |

---

## 5. Supervisor router

A small, **stateless** reverse proxy (own Deployment, can scale `replicas>1`) that is the single
front door behind the Cloudflare tunnel.

- **Routing (convention-based):** first path segment `/<slug>` → `rdv-<slug>.rdv-instances.svc.cluster.local`.
  HTTP → port 6001; `/<slug>/ws` → port 6002 with WebSocket upgrade. Root `/` → Supervisor UI
  (or a landing/instance-picker). No prefix stripping (instance is slug-aware).
- **Allowlist:** the router refuses unknown slugs (404) using an allowlist of `ready` instances
  refreshed from the Supervisor (`GET /internal/routes`, poll ~10s or push on change). Avoids
  proxying to nonexistent Services and leaking cluster DNS errors.
- **Health:** if the target instance is not `ready`, return a friendly 503/landing page.
- **Why not Traefik per-instance IngressRoutes:** the operator wants the Supervisor to own
  routing programmatically; convention routing means **provisioning creates no Ingress object**
  at all — just StatefulSet + Service + Secret + PVC. Simpler and fully dynamic.
- **Front door:** Cloudflare tunnel maps the single host `dev.example.com` → router Service. **No
  wildcard DNS or wildcard TLS needed** (a benefit of path routing). Cloudflare Access (one app)
  still gates everything; the router forwards `CF_Authorization` untouched (it does not terminate
  auth — each instance validates the CF Access JWT as today).
- **Implementation:** lightweight Node/Bun HTTP proxy (`node:http` + `ws` upgrade handling, or a
  minimal proxy lib). Stateless ⇒ horizontally scalable. Lives at `apps/supervisor-router` (or as
  a sub-package of the supervisor workspace).

Reserved slugs (router + validator): `api`, `ws`, `_next`, `login`, `healthz`, `readyz`, plus any
Supervisor UI prefix — disallowed as instance slugs to avoid collisions.

---

## 6. Supervisor service (control plane)

### 6.1 Stack & placement
- New bun workspace **`apps/supervisor`**: Next.js + shadcn/ui (reuse the design system), Drizzle +
  libsql, `@kubernetes/client-node`. Mirrors remote-dev's **two-process model**: Next.js
  (UI + REST API) plus a long-running **controller process** (reconciler + capacity loop), exactly
  as the app runs Next.js + terminal server today.
- **k8s client config:** `kc.loadFromDefault()` — in-cluster ServiceAccount token in prod,
  `~/.kube/config` for local dev (k3d/kind). No runtime switching.
- **Monorepo, not a separate repo:** the Supervisor version-locks to the instance image it
  provisions; lockstep in one repo prevents drift. Its own multi-arch image via the same buildx
  pipeline. Root scripts: `bun run dev:supervisor` (e.g. port 6003).
- **Deployment:** runs in `rdv-system`, its own PVC for SQLite (use Longhorn/NFS — **not**
  local-path — so its state survives node replacement). Pin near the control-plane node.

### 6.2 Data model (Drizzle, `apps/supervisor/src/db/schema.ts`)
- `supervisor_user(id, email unique, role: admin|operator|viewer, timestamps)` — the role concept
  remote-dev lacks. First admin seeded from `SUPERVISOR_ADMIN_EMAIL`.
- `instance(id, slug unique, displayName, ownerId→supervisor_user, status, errorMessage,
  namespace, imageTag, baseUrl, storageTargetId, storageConfigSnapshot json, cpu/mem/storage
  requests+limits, lastReconciledAt, provisionedAt, suspendedAt, deletedAt, timestamps)`.
- `registered_storage_target(id, name unique, kind: local-path|storage-class|nfs|cloud-csi,
  config json, resiliencyNote, isDefault, createdAt)` — for NFS/custom targets not discoverable
  live (StorageClasses + nodes are discovered, not stored).
- `instance_audit_log(id, instanceId→instance cascade, actorId, actorEmail, action,
  previousStatus, newStatus, metadata json, createdAt)`.
- `instance_seed(id, instanceId unique, authorizedEmails, jobDispatched, jobName, completedAt)`.
- `machine(...)`, `capacity_event(...)` — added in Phase 3 (§8.7).

### 6.3 Instance state machine
`requested → provisioning → ready ↔ suspended → terminating → deleted`, plus `error` from any
state. Reconciler advances states from live k8s (30s poll, no Watch streams — simpler, restart-safe
at O(10–100) instances).
- `requested→provisioning`: reconciler claims the row.
- `provisioning→ready`: StatefulSet `readyReplicas≥1` **and** in-pod `GET /<slug>/api/readyz` 200.
- `provisioning→error`: readiness timeout (120s) or `CrashLoopBackOff`.
- `ready↔suspended`: scale StatefulSet to 0 / back to 1 (PVC retained).
- `→terminating→deleted`: delete the instance's namespace (atomic cascade), confirm gone.

### 6.4 Provisioning flow (transactional, all owned by the controller)
On `POST /api/instances`: validate slug (`^[a-z][a-z0-9-]{0,14}$`, not reserved, unique), generate
`AUTH_SECRET` (`crypto.randomBytes(32).toString("base64")`), insert `requested`, optional seed row.
Reconciler then, **stopping and rolling back (delete namespace) on first error**:
1. Create Namespace (labelled `managed-by=rdv-supervisor`).
2. Create Secret `rdv-shared` (CF Access tags) + Secret `rdv-<slug>` (generated `AUTH_SECRET`,
   optional GitHub creds).
3. Create headless + ClusterIP Service `rdv-<slug>`.
4. Create StatefulSet (1 replica, `volumeClaimTemplate` from the chosen storage target → §7).
5. (No Ingress — the router handles routing by convention.)
6. Optional first-boot **seed Job** (`bun run db:seed` with `AUTHORIZED_USERS`).
7. Poll `/<slug>/api/readyz` (≤120s) → `ready`, else `error` + rollback.

Env injected per instance (path model, single host):
```
RDV_BASE_PATH=/<slug>            # runtime init var → materialized at boot
RDV_INSTANCE_SLUG=<slug>
RDV_DATA_DIR=/var/lib/rdv
PORT=6001  TERMINAL_PORT=6002  NEXT_PUBLIC_TERMINAL_PORT=6002
AUTH_URL=https://dev.example.com/<slug>     # single host + path; no wildcard
ENABLE_LOCAL_CREDENTIALS=false
CF_ACCESS_TEAM / CF_ACCESS_AUD  ← secret rdv-shared
AUTH_SECRET                     ← secret rdv-<slug>  (UNIQUE per instance)
GITHUB_CLIENT_ID / SECRET       ← secret rdv-<slug>  (optional)
```
StatefulSet keeps `securityContext.fsGroup/runAsUser=10001`, `terminationGracePeriodSeconds:30`,
probes at `/<slug>/api/healthz` + `/<slug>/api/readyz` (the pod serves under its basePath).

K8s object builders live in `provisioner-service.ts` as typed `@kubernetes/client-node` objects,
parameterized by slug + storage target; unit-testable with injected client mocks.

### 6.5 RBAC (ServiceAccount + ClusterRole, least-privilege)
- `namespaces`: get/list/create/delete
- `apps/statefulsets`: get/list/create/patch/update/delete
- `services`, `secrets`: get/list/create/delete (secrets never read back after create)
- `persistentvolumeclaims`: get/list (StatefulSet owns PVC creation)
- `pods`, `pods/log`: get/list; `pods/eviction`: create (Phase 3 drain)
- `nodes`: get/list (+ patch/delete in Phase 3 for machine lifecycle)
- `storage.k8s.io/storageclasses`: get/list (storage discovery)
- `events`: get/list; `metrics.k8s.io/nodes`: get/list (Phase 3 utilization)
- No `watch` (poll model); no `pods/exec` (seed via Job).

### 6.6 Supervisor auth
Separate Cloudflare Access application/policy for the Supervisor UI (distinct `CF_ACCESS_AUD`);
access to the Supervisor does not grant access to any instance. `withSupervisorAuth(requiredRole)`
wraps routes (mirrors `withApiAuth`, adds role gate). Role matrix: viewer (read), operator
(create/suspend/resume), admin (delete, register storage, manage users).

### 6.7 REST API surface
```
GET    /api/instances                 viewer    list + status
POST   /api/instances                 operator  create
GET    /api/instances/:id             viewer    detail
PATCH  /api/instances/:id             operator  rename / resize
DELETE /api/instances/:id             admin     terminate
POST   /api/instances/:id/suspend     operator
POST   /api/instances/:id/resume      operator
GET    /api/instances/:id/logs        viewer    pod logs (tail)
GET    /api/instances/:id/events      viewer    namespace events
GET    /api/storage-targets           viewer    live discovery (StorageClasses+nodes+registered)
POST   /api/storage-targets           admin     register NFS/custom
DELETE /api/storage-targets/:id       admin
GET    /api/nodes                     viewer    nodes + capacity summary
GET    /internal/routes               (router)  ready-instance slug→service allowlist
GET    /api/health                    (none)    liveness
```

---

## 7. Storage targets (resiliency selector)

A `StorageTarget` abstraction maps a chosen target → a PVC spec (+ optional node affinity),
mirroring the existing `/api/directories` "discover & select" UX.

```ts
type StorageTargetKind = "local-path" | "storage-class" | "nfs" | "cloud-csi";
interface StorageTargetOption {
  id: string; name: string; kind: StorageTargetKind;
  resiliencyNote: string; isDefault: boolean; config: StorageTargetConfig;
}
```

**Discovery (`GET /api/storage-targets`):**
- List StorageClasses (detect `driver.longhorn.io` → label "replicated"; others → cloud-csi/generic).
- List schedulable Nodes (skip control-plane) → one `local-path on <node>` option each.
- Merge `registered_storage_target` rows (NFS/custom).

**Translation → PVC (`toVolumeClaimSpec`):**
| Kind | PVC spec | Affinity | Resiliency |
|---|---|---|---|
| local-path | `storageClassName: local-path`, RWO | `nodeAffinity` to `kubernetes.io/hostname` | node-pinned, **no replication** |
| storage-class (Longhorn) | chosen SC, RWO | none | replicated; survives node loss |
| nfs | `nfs-client` SC / static PV (RWO, server selector) | none | off-cluster; NFS server is SPOF unless HA |
| cloud-csi | chosen SC, RWO | none | cloud-AZ durability; reattaches on node loss (same AZ) |

The chosen config is **snapshotted** into `instance.storageConfigSnapshot` so target edits/deletes
don't corrupt existing instances. Each option's `resiliencyNote` is surfaced in the dropdown so the
operator sees the trade-off when picking a data location.

---

## 8. Machine layer (Phases 3–4)

### 8.1 MachineProvider port
Pluggable interface (`provision, buildJoinScript, execJoin, getProviderHealth, cordon, drain,
terminate`) with `providerType: cloud-vm | proxmox | libvirt | manual`. The **manual join-token**
provider is the always-works baseline; cloud-VM and Proxmox are automated adapters.

### 8.2 k3s join mechanics
New worker joins via `curl -sfL https://get.k3s.io | sh -` with `K3S_URL`, `K3S_TOKEN`,
`INSTALL_K3S_EXEC="agent --node-label rdv.io/role=worker --node-taint rdv.io/worker=true:NoSchedule"`.
Instances tolerate `rdv.io/worker` and `nodeSelector: rdv.io/role=worker`; the control-plane node
gets the standard control-plane taint so app pods never land there. The node-token is read from
`/var/lib/rancher/k3s/server/node-token` via a read-only hostPath mount into the Supervisor pod;
**never logged, never stored in etcd/Secret, never returned via API** (manual flow prints the join
command without echoing the token to logs).

### 8.3 Capacity controller (custom — k3s has no cluster-autoscaler)
Poll `Pending` rdv pods that fail to schedule on resource pressure; when sustained beyond
`SCALE_UP_DEBOUNCE_SECONDS` (120) and under `MAX_WORKER_NODES`, respecting `SCALE_UP_COOLDOWN_SECONDS`
(300) and `MAX_PROVISIONS_PER_HOUR` (3): `provision → buildJoinScript → execJoin → wait Node Ready`
(timeout 15m) → pending pods schedule. All transitions recorded in `capacity_event`.

### 8.4 Scale-down + the local-path pin (hard constraint)
Before draining a node, run a **PVC locality check**: any pod on the node with a `local-path`
(`rancher.io/local-path`) PVC ⇒ **block drain** (data is node-pinned; no migration path). Longhorn
/ NFS / cloud-CSI (same-AZ) ⇒ drain allowed (volume detaches + reschedules). Flow: cordon → settle
→ drain (ignore DaemonSets, `deleteEmptyDirData:false`) → verify empty → terminate. Cross-AZ cloud
CSI also blocks.

### 8.5 Per-backend recovery matrix (node hard-failure)
| Backend | Recovery | Time | Data risk |
|---|---|---|---|
| local-path | **manual** (restore node or accept loss) | — | high |
| Longhorn | auto replica rebuild + reschedule | 2–10m | low (replicated) |
| NFS | reschedule, remount | 1–3m | none (server-side) |
| cloud-CSI same-AZ | detach + reattach | 2–5m | none |
| cloud-CSI cross-AZ | **manual** | — | availability blocked |

### 8.6 Supervisor / control-plane HA
Supervisor is single-replica with its state on a replicated PVC; on restart it reconciles `machine`
rows against `kubectl get nodes`. Manually-joined workers (label present, no `machine` row) are
imported as `manual` and never auto-drained. Orphans (provider VM with no row) are surfaced, never
auto-terminated. Optional: k3s embedded-etcd 3-server HA for control-plane durability.

### 8.7 Phase-3 schema
`machine(machineId pk, providerId, providerType, displayName, nodeName, arch, instanceType, phase,
provisionedAt, readyAt, errorMessage, labels json, pinnedPvcCount, timestamps)`;
`capacity_event(id, eventType, machineId, pendingPods, workerCount, detail json, createdAt)`.

---

## 9. Image & CI strategy
- **One** runtime image, multi-arch (`docker buildx --platform linux/amd64,linux/arm64`), built
  with the `/rdvslug` sentinel; tag by git SHA in GHCR; never `latest` in manifests.
- Separate images for `apps/supervisor` and `apps/supervisor-router` (same buildx pipeline).
- Image rollout across instances: Supervisor patches each StatefulSet
  `spec.template.spec.containers[0].image` to the new SHA (rolling, ~30s blip per single-replica
  instance — accepted).

---

## 10. Security
- Per-instance unique `AUTH_SECRET` (the only isolation guarantee for the `__Host-` CSRF cookie).
- Router does not terminate auth; CF Access JWT validated per instance as today.
- Supervisor RBAC least-privilege; secrets write-only from the Supervisor's perspective.
- k3s node-token handled as in §8.2 (hostPath, never logged/stored/returned).
- All subprocess calls use `execFile` array-args (existing `src/lib/exec.ts` pattern) for any
  `kubectl`/provider CLI usage.
- Reserved-slug allowlist prevents route/segment collisions.

---

## 11. Testing strategy
- **Unit:** materialization idempotence + correctness (sentinel→slug, sentinel→root); router slug
  parsing + allowlist + reserved slugs; `toVolumeClaimSpec` per backend; instance state-machine
  guards; provisioner object builders (injected k8s client mocks).
- **Integration:** provision/suspend/resume/delete against a local **k3d/kind** cluster; storage
  discovery; rollback-on-failure deletes the namespace.
- **Smoke (Phase 0 gate):** build image once → run as two distinct slugs **and** root → for each,
  assert assets load, client navigation works, login round-trips, and a live WS terminal attaches.

---

## 12. Phased roadmap

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **0 — Slug-aware data plane** | Merge branch; build with sentinel; entrypoint materialization; multi-arch image | One image runs at 2 slugs + root; §11 smoke passes |
| **1 — Supervisor MVP** | `apps/supervisor` (auth+roles, DB, k8s client, instance CRUD→provision, storage dropdown, dashboard, RBAC, Deployment) + `apps/supervisor-router` (convention routing, allowlist, WS) | Operator creates an instance with a chosen storage target and reaches it at `/<slug>` through the router |
| **2 — Lifecycle depth** | suspend/resume, logs/events, image rollout, status reconcile, audit log UI | Full instance lifecycle operable from the dashboard |
| **3 — Capacity + manual machines** | capacity controller (visibility), manual join-token flow, worker labels/taints, orphan import, scale-down with local-path pin guard | Operator joins a worker via printed token; pending pods schedule; drain refuses local-path nodes |
| **4 — Automated autoscale** | cloud-VM + Proxmox providers, auto scale-up/down, guardrails, optional etcd HA | Cluster grows/shrinks within guardrails; recovery matrix verified |

---

## 13. bd issue breakdown

> ⚠️ The bd Dolt server is currently in a bad state (`database "remote_dev" not found`). Run
> `bd doctor` then `bd bootstrap` (or restart the Dolt server on the correct data dir) before
> running these. Create the epic first, then children depend on it.

```bash
# Epic
bd create --title "Deploy remote-dev on k3s: supervisor control plane + slug-aware data plane" \
  --type epic --priority p2 --body-from docs/plans/2026-05-30-k3s-supervisor-platform.md

# Phase 0 — slug-aware data plane (one image, runtime basePath)
bd create --title "Phase 0: runtime basePath materialization (sentinel build + entrypoint rewrite)" \
  --type task --priority p2 --depends-on <epic> \
  --body 'Build with RDV_BASE_PATH=/rdvslug sentinel; entrypoint materializes to runtime slug/root
          (idempotent). Multi-arch buildx. Acceptance: §11 smoke (2 slugs + root: assets, nav,
          login, WS). Reuse branch primitives unchanged (base-path/auth-cookies/proxy/terminal).'
bd create --title "Phase 0: merge feature/multi-instance-basepath to master" \
  --type task --priority p2 --depends-on <epic> \
  --body 'Rebase/merge the branch (data-plane isolation primitives). Resolve conflicts; keep
          path-mode plumbing. Update docs/MULTI_INSTANCE.md to the router model (drop per-instance
          Traefik IngressRoute guidance).'

# Phase 1 — Supervisor MVP + router
bd create --title "Phase 1: apps/supervisor scaffold (Next.js + Drizzle + k8s client + auth/roles)" \
  --type task --priority p2 --depends-on <epic> \
  --body 'bun workspace; supervisor_user/role; withSupervisorAuth; loadFromDefault(); own SQLite PVC.'
bd create --title "Phase 1: provisioner-service (k8s object builders + transactional create/rollback)" \
  --type task --priority p2 --depends-on <epic> \
  --body 'StatefulSet/Service/Secret(+generated AUTH_SECRET)/Namespace builders; readyz poll;
          delete-namespace rollback; instance state machine + reconciler (30s poll).'
bd create --title "Phase 1: storage-target discovery + translation + dropdown UI" \
  --type task --priority p2 --depends-on <epic> \
  --body 'List StorageClasses + nodes + registered NFS; StorageTarget→PVC spec (4 backends);
          snapshot chosen config; resiliencyNote in dropdown (mirror /api/directories UX).'
bd create --title "Phase 1: apps/supervisor-router (convention slug routing + WS + allowlist)" \
  --type task --priority p2 --depends-on <epic> \
  --body 'Stateless proxy: /<slug>/* → rdv-<slug>:6001, /<slug>/ws → :6002 (no strip). Allowlist
          from /internal/routes. Reserved slugs. Cloudflare tunnel → router (single host).'
bd create --title "Phase 1: RBAC + Supervisor/router Deployments + supervisor CF Access app" \
  --type task --priority p2 --depends-on <epic> \
  --body 'ServiceAccount+ClusterRole (§6.5); Deployments in rdv-system; instances in rdv-instances;
          separate CF Access policy for the supervisor UI.'

# Phase 2 — lifecycle depth
bd create --title "Phase 2: suspend/resume, logs, events, image rollout, audit UI" \
  --type task --priority p3 --depends-on <epic>

# Phase 3 — capacity + manual machines
bd create --title "Phase 3: capacity controller + manual join-token provider + worker taints" \
  --type task --priority p3 --depends-on <epic> \
  --body 'Pending-pod pressure detection; print join command (token never logged); worker
          label/taint + instance toleration/nodeSelector; orphan import; scale-down local-path
          pin guard + per-backend drain rules.'

# Phase 4 — automated autoscale
bd create --title "Phase 4: cloud-VM + Proxmox MachineProviders, auto scale-up/down, guardrails" \
  --type task --priority p3 --depends-on <epic> \
  --body 'Provider adapters; MAX_WORKER_NODES / cooldown / MAX_PROVISIONS_PER_HOUR; optional k3s
          embedded-etcd HA; verify recovery matrix.'
```

---

## 14. Open questions (resolve before/with Phase 1)

> **Phase 1 status:** being built task-by-task against this section. `jvcx.3`
> (the `apps/supervisor` scaffold) has landed: bun workspace, Drizzle schema
> (owner-scoped instances), role-based `withSupervisorAuth`, `@kubernetes/client-node`
> wrapper, slug validation + reserved names, dashboard shell, health route,
> auth-wrapped API route stubs, and a controller-process skeleton. Provisioning
> (`jvcx.4`), storage discovery (`jvcx.5`), the router (`jvcx.6`), and
> RBAC/Deployments (`jvcx.7`) are the remaining Phase-1 tasks.

1. **Host + tunnel:** confirm the single external host (e.g. `dev.example.com`) and that the
   existing Cloudflare tunnel can be pointed at the router Service.
2. **Cloudflare Access:** one app covering `dev.example.com/*` for instances + a separate app for
   the Supervisor UI — confirm team/AUD provisioning is operator-managed.
3. **GitHub OAuth at scale:** one GitHub App with callback `https://dev.example.com/<slug>/api/auth/callback/github`
   per instance, vs a shared wildcard-capable GitHub App. Decide before enabling GitHub features
   on provisioned instances.
4. **Instance ownership / multi-user:** **RESOLVED — instances are owner-scoped** (operators
   manage only their own; admins see all). `instance.ownerId` enforcement is baked into the
   schema and the `canManageInstance(user, instance)` auth helper from Phase 1 (`jvcx.3`):
   non-admin list/detail/mutation paths funnel through it, and detail returns 404 (not 403) for
   instances the caller doesn't own so existence isn't leaked.
5. **Default storage target:** which backend is the default in the dropdown for this cluster
   (local-path vs Longhorn)? Drives the resiliency default.
6. **Router vs Supervisor co-location:** ship the router as a separate Deployment (recommended,
   stateless, scalable) vs embed in the Supervisor process for MVP simplicity.

---

## 15. Codex review revisions (2026-05-30)

Independent adversarial review by Codex; all items below were **verified against the codebase**
and are now authoritative (they supersede earlier sections where they conflict).

### 15.1 BLOCKERS

**B1 — Materialization must rewrite the whole runtime tree, not just `.next/` (corrects §4.1).**
`Dockerfile:142` copies `.next/standalone` → `/app`, so the standalone entry `/app/server.js`
(and standalone server chunks) also embed the baked `basePath`. Scoping `sed` to `.next/` leaves
`server.js` pointing at `/rdvslug`. Corrected entrypoint pass:
```sh
SLUG_PREFIX="${RDV_BASE_PATH:-}"
grep -rlZ '/rdvslug' /app/server.js /app/.next /app/public 2>/dev/null \
  | xargs -0 -r sed -i "s#/rdvslug#${SLUG_PREFIX}#g"
# Hard gate: no sentinel may survive, anywhere.
if grep -rq '/rdvslug' /app/server.js /app/.next /app/public; then
  echo "[fatal] basePath materialization incomplete" >&2; exit 1
fi
```
Idempotency keyed to (image digest + target slug) via a sentinel-done file. Use `-Z/-0` for
safe filenames; escape the replacement.

**B2 — Pick ONE namespace model (corrects §3, §5, §6.3, §6.4).** The draft both (a) routed to
`rdv-<slug>.rdv-instances.svc` (shared namespace) and (b) created/deleted a namespace per
instance. **Decision: one namespace per instance, `rdv-<slug>`**, Service named `rdv` inside it →
DNS `rdv.rdv-<slug>.svc.cluster.local`. Rationale: atomic cascade delete (delete namespace =
delete all instance objects), clean per-instance RBAC/quotas. Consequence: the router's route
table is **not** a bare DNS convention — `GET /internal/routes` returns
`slug → { namespace, service, httpPort, wsPort, ready }`, and the router resolves from that. Update
§3 (instances are NOT in a shared namespace) and §5 (table carries namespace) accordingly.

**B3 — RBAC gaps (corrects §6.5).** Seed Job (§6.4) needs `batch/jobs: create,get,list,delete`
(none granted). PVC resize exposed by §6.7 `PATCH` needs `persistentvolumeclaims: patch,update`
(only `get,list` granted). Static-NFS-PV support implies `persistentvolumes: create,delete`.
**Fix:** add `batch/jobs` verbs for Phase 1; **defer PVC resize to Phase 2** and drop it from the
Phase-1 `PATCH /api/instances/:id` contract; prefer the `nfs-subdir-external-provisioner`
StorageClass (dynamic) over static PVs so no `persistentvolumes` verbs are needed.

### 15.2 MAJORS

**M1 — The k3s image is always slugged; do not materialize-to-empty (corrects §4.2).** Next
rejects `basePath: ""` and *omits* basePath for true root builds, so replacing the sentinel with
empty does **not** reproduce a real root build. Resolution: under the Supervisor every instance
has a slug (instances live at `/<slug>`; only the Supervisor/router occupies root). The
sentinel image therefore only ever materializes to a **real** `/<slug>`. "Defaults to root if not
provided" remains true for the **non-k8s** build path (local dev / Electron / single-host prod),
which builds normally with `basePath` omitted — that path does not use materialization. The
"materialize to empty" idea is dropped.

**M2 — basePath-sensitive asset & auth surfaces (new §4.5; confirmed in source).** Several
app-owned, root-absolute references are NOT prefixed by Next's `basePath` and contain no sentinel,
so neither Next nor `sed` fixes them. Verified: `src/app/layout.tsx:28` `manifest:"/manifest.json"`,
`:85` `/favicon.svg`, `:86` `/icons/icon-192x192.png`; `public/sw.js` caches `/`, `/manifest.json`,
`/icons/*`; `AppShell.tsx:18` mounts `next-auth/react` `SessionProvider` with **no `basePath`**.
Required Phase-0 fixes:
- Server-rendered refs in `layout.tsx` → interpolate the runtime `BASE_PATH`
  (`manifest: \`${BASE_PATH}/manifest.json\``, icon `<link href={\`${BASE_PATH}/...\`}>`). Because
  `BASE_PATH` is read at process start and the root layout renders server-side, these emit correct
  per-slug URLs with no materialization.
- `SessionProvider` → pass `basePath={\`${BASE_PATH}/api/auth\`}` so client session
  refresh/signout/CSRF calls hit `/<slug>/api/auth`, not root. (Latent bug in the branch's path
  mode too.)
- `public/sw.js` (static, can't read env) → either serve it from a route handler that templates
  `BASE_PATH` and register with a slug-scoped `scope`, **or** author its cached URLs with the
  `/rdvslug` sentinel so the boot pass rewrites them; also scope registration to `${BASE_PATH}/`.
- Consider disabling the PWA/SW for path-mode instances in Phase 1 and re-enabling once the
  slug-scoped SW is verified.

**M3 — Put the Supervisor on its own hostname (corrects §5, §6.6, §14.2).** Two Cloudflare Access
apps with distinct AUDs on one host risk `CF_Authorization` cookie/AUD ambiguity and re-auth
loops. Use a **separate hostname** for the Supervisor UI (e.g. `sup.example.com`) with its own
Access policy; instances stay on `dev.example.com/<slug>`. Still no wildcard DNS.

**M4 — Router fail semantics + liveness (corrects §5).** The router is on the data path; define
behavior explicitly: run `replicas ≥ 2` (stateless); on Supervisor unreachable, **fail-open from
last-known-good cache** (keep routing known-ready slugs) rather than fail-closed; unknown slug →
404; not-ready slug → 503 landing. Prefer the router **watching k8s Endpoints/Services directly**
(it already needs read access) for readiness, using the Supervisor allowlist only for slug
validity. Specify cache TTL + invalidation on create/delete.

**M5 — Tunneled WebSocket is a Phase-0/1 exit criterion, not just a unit (corrects §5, §11).** The
terminal server accepts only exact `WS_PATH_PREFIX`. End-to-end correctness depends on the router
forwarding `Upgrade`/`Sec-WebSocket-*`, Cloudflare Tunnel WS handling, Access cookies/headers on
the upgrade, and idle-timeout behavior. Add an explicit exit test: a live terminal over
`wss://dev.example.com/<slug>/ws` through tunnel + Access + router, including a long-idle reconnect.

**M6 — node-token via admin-provisioned Secret, not hostPath (corrects §8.2, §10).**
`/var/lib/rancher/k3s/server/node-token` is `root:root 0600`; RBAC can't grant Unix read, and
running the Supervisor as root to read it inflates blast radius. Instead an admin places the join
token in a Kubernetes Secret out-of-band; the Supervisor reads that Secret (RBAC-scoped). The
Supervisor runs non-root. Token still never logged/returned.

**M7 — Drain guard must check bound PV node-affinity, not running pods (corrects §8.4).** Suspended
instances scale to 0 pods but their local-path data is still pinned to the node. A pod-only guard
would wrongly clear such a node for drain. Guard on **bound local-path PVCs/PVs whose
`nodeAffinity`/path targets the candidate node**, independent of whether a pod is currently
running.

**M8 — Phase-0 smoke becomes an artifact-compatibility suite (corrects §4.3, §11).** Add, per
materialized slug (and via the non-k8s root build for parity): residual-sentinel scan of
`server.js` + `.next` + `public`; RSC prefetch/flight navigation; `next/image` optimizer path;
public assets (manifest, favicon, icons); service-worker scope + cached URLs; client-side NextAuth
session refresh + signout; tunneled WS (M5).

### 15.3 MINORS

**m1 — Replacement is a coverage problem, not an offset problem (refines §4.1).** Content-hashed JS
has no default SRI manifest, so variable-length replacement won't break integrity by byte offset;
the real risk is **missing an artifact type**. The B1 hard gate (no surviving sentinel) plus M8's
suite is the mitigation.

**m2 — Centralize slug validation + reserved names (corrects §5, §6.4).** One shared library used
by Supervisor, router, and instance-env generation. Reserved set must include the root public
paths: `api`, `ws`, `_next`, `login`, `healthz`, `readyz`, `manifest.json`, `sw.js`, `favicon.svg`,
`favicon.ico`, `icons`, plus the Supervisor UI prefix.

### 15.4 Verdict & impact on phasing
Materialization is **viable but only after B1 + M1 + M2**: rewrite the full `/app` tree with a
hard no-residual-sentinel gate, drop materialize-to-empty (k3s instances are always slugged), and
make the manifest/favicon/SW/`SessionProvider` surfaces basePath-aware. With those, the
"supervisor router + slug-aware image, no stripping" model holds and is preferable to
response-rewriting. **Phase 0 expands** to include M2 (asset/auth surface fixes) and M8 (artifact
suite); response-rewriting remains the documented fallback only if the artifact suite reveals an
un-rewritable surface. No change to the overall phase ordering.
```
