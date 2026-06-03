# CloudNativePG (CNPG) — shared HA Postgres for the Supervisor fleet

These manifests stand up **one** highly-available PostgreSQL cluster
(`rdv-pg`) in the `cnpg-clusters` namespace that serves the entire
remote-dev Supervisor platform on a **database-per-instance** model:

- The supervisor's own control-plane DB is `rdv_supervisor` (created at
  cluster init).
- Each provisioned instance gets its own role + database
  `rdv_<slug>`, created at runtime by the supervisor provisioner.
- App traffic flows through a **PgBouncer Pooler**; DDL flows directly to
  the **RW Service** (see the DDL note at the bottom).

> This directory is **pure YAML/manifests**. It does not change any
> application code paths — those land in the supervisor provisioner unit.

## Files

| File             | What it declares                                              |
| ---------------- | ------------------------------------------------------------- |
| `namespace.yaml` | The `cnpg-clusters` Namespace.                                |
| `cluster.yaml`   | The `Cluster` (`rdv-pg`), a daily `ScheduledBackup`, a `Pooler`. |

## 1. Prerequisite — install the CloudNativePG operator

The operator (which owns the `postgresql.cnpg.io/v1` CRDs these manifests
use) must be installed **cluster-wide first**. Pick ONE method.

> Do **not** copy a stale patch version from here. Resolve the current
> stable release from the CNPG releases page / Helm repo before applying.

```bash
# Option A — plain kubectl apply of the release manifest. Replace <VERSION>
# with the current stable CNPG release (e.g. from
# https://github.com/cloudnative-pg/cloudnative-pg/releases):
kubectl apply --server-side -f \
  https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/<VERSION>/releases/cnpg-<VERSION>.yaml

# Option B — Helm (tracks the latest chart automatically):
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update
helm upgrade --install cnpg cnpg/cloudnative-pg \
  --namespace cnpg-system --create-namespace
```

Wait for the operator to be Ready before applying the cluster:

```bash
kubectl -n cnpg-system rollout status deploy/cnpg-cloudnative-pg-controller-manager
```

## 2. Create the namespace

```bash
kubectl apply -f namespace.yaml
```

## 3. Create the required Secrets (before `cluster.yaml`)

All three live in the `cnpg-clusters` namespace. **Do not commit real
values.** Apply out-of-band (sealed-secrets / SOPS / imperative `kubectl`).

### `rdv-pg-superuser` — the `postgres` superuser

CNPG **generates and manages** this Secret when `enableSuperuserAccess:
true` + `superuserSecret.name` are set, so you normally do **not** create
it by hand. The supervisor provisioner reads it to run `CREATE ROLE` /
`CREATE DATABASE` against the RW Service. To pre-seed a known password
instead, create it as a `kubernetes.io/basic-auth` Secret before applying
the cluster:

```bash
kubectl -n cnpg-clusters create secret generic rdv-pg-superuser \
  --type=kubernetes.io/basic-auth \
  --from-literal=username=postgres \
  --from-literal=password="$(openssl rand -base64 32)"
```

### `rdv-pg-supervisor-creds` — owner of `rdv_supervisor`

Consumed by `bootstrap.initdb` to create the `rdv_supervisor` DB and its
owner role at cluster init. Must be a `basic-auth` Secret:

```bash
kubectl -n cnpg-clusters create secret generic rdv-pg-supervisor-creds \
  --type=kubernetes.io/basic-auth \
  --from-literal=username=rdv_supervisor \
  --from-literal=password="$(openssl rand -base64 32)"
```

### `rdv-pg-s3-creds` — object-storage backup credentials

Only needed if you keep the `backup:` stanza (remove it for a dev cluster
with no object store). Keys must be `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY`:

```bash
kubectl -n cnpg-clusters create secret generic rdv-pg-s3-creds \
  --from-literal=ACCESS_KEY_ID="<s3-access-key>" \
  --from-literal=SECRET_ACCESS_KEY="<s3-secret-key>"
```

## 4. Apply the cluster

```bash
kubectl apply -f cluster.yaml
kubectl -n cnpg-clusters get cluster rdv-pg -w   # wait until Cluster in healthy state
```

## 5. Connection endpoints (in-cluster DNS)

CNPG creates Services for the cluster; the Pooler creates its own Service.

| Purpose                          | DNS name                                                | Port |
| -------------------------------- | ------------------------------------------------------- | ---- |
| **RW Service** (primary; for DDL) | `rdv-pg-rw.cnpg-clusters.svc.cluster.local`             | 5432 |
| **Pooler** (PgBouncer; app conns) | `pooler-rdv-pg-rw.cnpg-clusters.svc.cluster.local`      | 5432 |

(CNPG also provides `rdv-pg-ro` for read-only replicas and `rdv-pg-r` for
any instance — not used by the supervisor flow.)

## 6. DATABASE_URL shapes

App connections go through the **Pooler**:

```text
# Per-instance (one role + DB per instance):
postgresql://rdv_<slug>:<pw>@pooler-rdv-pg-rw.cnpg-clusters.svc.cluster.local:5432/rdv_<slug>

# Supervisor control-plane DB:
postgresql://rdv_supervisor:<pw>@pooler-rdv-pg-rw.cnpg-clusters.svc.cluster.local:5432/rdv_supervisor
```

## 7. DDL must target the RW Service, NOT the Pooler

`CREATE ROLE` / `CREATE DATABASE` (and any other DDL the provisioner runs
to set up `rdv_<slug>`) **must connect to the RW Service**:

```text
postgresql://postgres:<superuser-pw>@rdv-pg-rw.cnpg-clusters.svc.cluster.local:5432/postgres
```

The PgBouncer Pooler runs in **transaction** pooling mode, which blocks
session-level statements like `CREATE DATABASE` (it cannot run inside a
pooled transaction and PgBouncer multiplexes server connections). Route
provisioning DDL straight to the primary via the RW Service; only the
runtime app `DATABASE_URL` should go through the Pooler.
