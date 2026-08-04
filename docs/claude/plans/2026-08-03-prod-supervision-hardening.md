# Spec v3: Single-Owner Prod Supervision — launchd custody + hardened watchdog

**Issue:** remote-dev-7fsq · **Status:** SPEC v3 — implementation-ready · **Date:** 2026-08-03
**Review history:** Codex `gpt-5.6-sol` (xhigh, session `019fc883-3e86-7070-aea0-fe3c5e32538d`): v1 → **redesign** (18 findings, `[F1..F18]`); v2 → **approve-with-changes** (15 findings, `[R1..R15]`). v3 incorporates all; citations inline.
**Scope:** macOS self-hosted prod (`dev.bryanli.net`). Linux/k8s out of scope (container runtime supervises).

## 1. Background

Prod had four independent actors spawning/restarting the server stack (launchd `dev.remote.app.prod` KeepAlive job; the watchdog whose recovery action was `rdv.ts restart prod`; `deploy.ts` killing/spawning outside launchd; humans/agents running `rdv:restart`). On 2026-08-03 an agent restart dual-writer-flapped against launchd: each copy's shutdown unlinked the other's bound sockets, leaving a live-but-unreachable next-server, a hung restart, and launchd retry-looping — a manual-recovery outage.

**Blind-unlink inventory** (all must close `[F4]`): `rdv.ts cleanupSocket()` (start + stop paths), global `stop()` re-reading shared PID files, `standalone-server.js` startup unlink (line 54) and delayed shutdown unlink (line 146).

**Detection gaps:** watchdog 300s×3 ≈ 15 min; actuator spawns a competing stack; Next.js-only probes; dev-TCP fallback can mask dead prod `[F14]`.

**Config drift:** installed `dev.remote.app.prod.plist` is hand-authored, not in repo; `install.sh` still renders a stale two-job layout `[F15]`.

## 2. Goals / non-goals

**Goals:** (1) launchd is the sole process owner; every other actor signals it; nothing kills or unlinks what it cannot prove it owns (generation + socket identity, §3.3). (2) Self-healing within the SLA of §3.6 (≤4 min worst-case tick alignment, typical ≤2–3 min `[R10]`). (3) Fail closed on unknown launchd state `[F9]`. (4) Deploys hold launchd custody via bootout/bootstrap with crash-safe recovery `[F3, R4]`. (5) Durable desired-state so intentional stops aren't undone `[R5]`. (6) Truthful status, ledgered restarts, escalation. (7) Repo-canonical config, one transactional installer `[F15, F16, R6]`.

**Non-goals:** headless operation; systemd/k8s parity; launchd socket activation (deferred: bd `remote-dev-7vra` `[F18]`); `AbandonProcessGroup`/`ProcessType` tuning `[F8]`.

## 3. Design

### 3.0 Supervision core is TypeScript `[R7]`

All lock-holding, manifest, custody, and actuator logic lives in **`scripts/rdv-supervision.ts`** (Bun). macOS has no `flock(1)` and bash cannot hold a `bun:ffi` flock across a transaction, so `watchdog.sh` reduces to a thin shim: probes with `curl` (cheap, no Bun startup on healthy ticks), and on any actionable condition calls `bun scripts/rdv-supervision.ts watchdog-act <reason>`, which holds the control lock for the entire recovery transaction. The installer is likewise `install-supervision.ts` with a `.sh` wrapper.

### 3.1 Locks `[F1, F11, R8, R14]`

| Lock | Path | Held by | Lifetime |
|---|---|---|---|
| **Control** | `$DATA_DIR/run/rdv-control.lock` | Any actuator transaction: delegation, watchdog recovery, installer, deploy custody transitions | Duration of the action; kernel-released on death |
| **Foreground** | `$DATA_DIR/run/rdv-foreground.lock` | The wrapper itself, only in job-absent foreground mode | Wrapper lifetime |

- The launchd-owned wrapper holds neither (launchd serializes its own instances `[F1]`).
- **Primitive `[R14]`:** extract from `deploy-flock.ts` a *pure* inode-stable kernel-flock primitive (`acquireFlock(path)`). The legacy stale-PID-content backoff stays **only** in `acquireDeployFlock()` (deploy.lock compatibility); control/foreground locks use the pure primitive — file content is informational (`pid`), never consulted for liveness.
- **Contention:** control-lock contenders retry with backoff up to 30s, then abort with the holder's pid — never partially proceed `[R8]`. A deploy that cannot get the control lock for its custody step aborts before bootout.
- **Deploy coordination `[F11, R8]`:** actuators check the deploy lock (shared parsing helper: bare-PID + legacy-JSON, EPERM-is-alive) and refuse while live. Deploy's own custody transitions are **internal function calls** inside `deploy.ts` — there is no `--during-deploy` CLI flag to forge; the only external surface is the ordinary refusal.

### 3.2 Delegation, provenance, desired state (`scripts/rdv.ts`)

- **Provenance (marker optional) `[F2, R1]`:** the canonical plist runs `… rdv.ts start prod --launchd-child`, but **provenance is what is verified and provenance alone is sufficient**: `process.ppid === 1` **and** `XPC_SERVICE_NAME` matches the job label. The flag is a hint. Forged invocations — a marker without provenance — still get the delegation/foreground logic (where the locks live) `[R1]`, and an accidental shell invocation has neither property.
  **Why the marker cannot be required:** a host still running the pre-supervision hand-authored plist passes no marker, so requiring it would send the launchd-started wrapper to `delegate-kickstart`, which probes an unstarted stack as unhealthy and `kickstart -k`s its own job — an infinite ThrottleInterval-paced loop with prod never coming up. Because provenance alone suffices, **the new code runs correctly under BOTH the legacy and the canonical plist**, so merging the branch and running the installer are INDEPENDENTLY ORDERABLE: the merge is safe on its own, and `install-supervision.sh` becomes a pure upgrade rather than a prerequisite. A legacy-plist start logs a one-line upgrade warning into the wrapper banner (and therefore the server logs).
- `launchdJobLoaded(label)`: **exit status only** of `launchctl print gui/<uid>/<label>` `[F10]`. Health comes from HTTP probes, never from launchctl output.
- **Desired-state file `[R5]`** `$PID_DIR/desired-state.json`: `{ state: "running" | "stopped" | "maintenance", owner?: {pid, startTimeNs}, ts }`, written atomically (temp+rename) by stop/start/deploy/installer. The watchdog acts only when state is `running`; `maintenance` entries whose owner is dead and whose deploy-custody journal (§3.5) is abandoned trigger the recovery path, not a blind bootstrap.

Command behavior (prod; dev untouched):

| Command | Condition | Behavior |
|---|---|---|
| `start prod` | launchd provenance verified | Real start path (§3.3). |
| `start prod` | job loaded | Control lock → probes healthy? report+exit 0 (idempotent; no `kickstart -k` on a healthy stack `[F10]`) : `kickstart -k` → poll ≤90s. Set desired=running. |
| `start prod` | plist installed, not loaded | Control lock → desired=running → `bootstrap` (starts it; KeepAlive⇒RunAtLoad, no follow-up kickstart `[F10]`) → poll. |
| `start prod` | plist not installed | Foreground: foreground lock, real start path, desired=running. |
| `restart prod` | job loaded | Control lock → deploy-lock check → `kickstart -k` → poll. |
| `restart prod` | plist installed, intentionally unloaded (desired=stopped) `[R15]` | Refuse with explanation (`rdv start prod` is the explicit re-enable). |
| `restart prod` | job absent (foreground mode) `[R15]` | Control lock → signal foreground owner's manifest PGIDs, wait for foreground lock to free (bounded), then foreground start (reacquires it). |
| `stop` | job loaded | Control lock → desired=stopped → `bootout` → wait for generation exit (manifest-verified). |
| `stop` | foreground mode `[R15]` | Control lock → desired=stopped → signal the manifest owner's PGIDs (the wrapper's own shutdown handles children), wait. |
| delegation step fails | — | **Fail closed** `[F9]`: exact state + remediation, non-zero exit. No foreground spawn while a plist is installed. |

### 3.3 Generation & socket ownership `[F4, F5, F6, R2, R3, R13]`

- **Immutable per-generation manifests `[R3]`:** wrapper writes `$PID_DIR/generations/<gen>.json` (never mutated in place except its `phase` field via temp+rename) and flips `$PID_DIR/current-generation` (one-line file, atomic rename) only after both children are recorded. Manifest: `{ gen, phase: "starting"|"running"|"stopping", wrapper: id, next: id, terminal: id, sockets: { next: {path, dev, ino}, terminal: {path, dev, ino} } }` where `id = {pid, pgid, startTimeNs}`.
- **Process identity `[R13]`:** `startTimeNs` from `sysctl kern.proc.pid` (kern_proc start time — stable, locale-free; not `ps -o lstart`). Verify identity before any signal.
- **Socket identity `[R2]`:** children do **not** unlink at startup any more. The wrapper (holding foreground lock or launchd provenance) reclaims paths *before* spawn (below), children just bind; on successful bind the wrapper `lstat`s the path and records `{dev, ino}` in the manifest. **Unlink rule:** compare `lstat` dev/ino against your own manifest — match ⇒ yours, unlink allowed; mismatch or unknown ⇒ never unlink. `standalone-server.js` loses both its unlink sites (startup `[R2]` and delayed-shutdown; the wrapper owns cleanup).
- **Kill rule:** signal only manifest-verified `(pid, startTimeNs)` entries, by their recorded **PGID** (`kill(-pgid)`) `[R13]` — a socket-holder pid is not necessarily a group leader `[F5]`. Wrapper shutdown signals both child PGIDs concurrently `[F8]`.
- **Reclaim (pre-spawn / recovery):** read prior generation manifests; identity-verify each recorded process; any verified-alive process from a non-current generation ⇒ SIGTERM its PGID, wait ≤5s, SIGKILL; then unlink socket paths whose dev/ino match that generation's manifest (or which `lstat` as sockets with no manifest claim and no verifiable holder). `lsof -U` output is logged as diagnostics only `[F6]`. Prior-generation manifests are retained until their processes are verified dead, then archived `[R3]`.
- **Missing/corrupt manifest ⇒ fail closed `[R3]`:** report, require operator `rdv doctor-supervision --force-reclaim` (which does the reclaim with explicit human consent), never guess.

### 3.4 launchd job config `[F8]`

Repo-canonical `dev.remote.app.prod.plist`: `--launchd-child` argv, `ExitTimeOut 30` (concurrent shutdown still bounded under it), `KeepAlive`, `ThrottleInterval 30`. kickstart-vs-throttle behavior validated on a throwaway fixture pre-rollout `[F10]`.

### 3.5 Deploy custody (`scripts/deploy.ts`) `[F3, R4, R9]`

A `LaunchdCustody` object owns **all** stop/start transitions — replacing every direct call site: pre-migration stop (~1498), local-health rollback (~1531), external-health rollback (~1541), manual rollback (~1626), and `restartViaRdvAsync()` `[R9]`. When the job is loaded:

1. **Journal first `[R4]`:** before bootout, atomically write `$DEPLOY_DIR/custody-journal.json`: `{ ownerPid, ownerStartTimeNs, priorLoaded: true, plistPath, slot, phase, ts }`; set desired=maintenance.
2. `bootout` (stops KeepAlive resurrection) → wait for generation exit → migrate/activate exactly as today.
3. `bootstrap` → health gate as today → clear journal, desired=running.
4. `try/finally` attempts bootstrap on same-process failure; **crash recovery `[R4]`:** if the journal exists and its owner `(pid,startTimeNs)` is dead and the deploy lock is not live, custody is *abandoned* → the watchdog's recovery transaction (control lock) restores per journal: restore-slot if the journal phase says activation was incomplete, `bootstrap`, desired=running, escalate a notification. Distinguished from intentional stop by desired-state `[R5]`.
5. Custody methods never branch on live "job loaded" probes mid-deploy (the job is *deliberately* unloaded then) `[R9]` — they use the journal's `priorLoaded`.

Job-absent installs keep current behavior.

### 3.6 Watchdog (`watchdog.sh` shim + `rdv-supervision.ts watchdog-act`)

- `StartInterval` 60, `MAX_FAILURES` 2. **Prod-only**: missing `nextjs.sock` is failure evidence; no dev-TCP fallback `[F14]`.
- **Probes:** `nextjs.sock` `/api/healthz`==200 && `/login`==200, and `terminal.sock` existing `GET /health`==200 (503-until-scheduler-ready; v1's new endpoint remains dropped `[F13]`).
- **Desired-state gate `[R5]`:** act only when desired=running; on maintenance, run the abandoned-custody check (§3.5.4).
- **Grace `[F7, F12, R10]`:** actuators stamp `$DEPLOY_DIR/last-restart`. Within 120s of the stamp the watchdog **still counts** failed observations but defers action until grace expiry; if the first post-grace tick is healthy the counter resets. This keeps worst-case detection ≤ grace + 1 tick ≈ 3 min (matrix updated; worst tick alignment ≤4 min `[R10]`).
- **Deploy suppression resets the counter `[F12]`.**
- **Flap fast-path `[F7, R10]`:** socket path absent + current-generation next PID identity-verified alive + generation age >120s + persisted 2 consecutive ticks (state file **keyed by gen**, reset on healthy/suppressed/grace/gen-change ticks) → `watchdog-act flap` (control lock → reclaim → kickstart).
- **Ledger & escalation `[F17, R12]`:** every actuator appends `<epoch> <actor> <reason>` to `$DEPLOY_DIR/restart-ledger`; threshold **≥3 in 3600s** → restart anyway + `ESCALATION` log + `osascript` + best-effort app-API POST. **KeepAlive respawns aren't actuators:** the wrapper's `--launchd-child` start appends `<epoch> generation-start <gen>` to a separate `generation-ledger` that feeds the same escalation math (native crash loops escalate `[R12]`) but does **not** stamp `last-restart` (no perpetual grace renewal).

### 3.7 Truthful `rdv:status` `[R11]`

Launchd line (exit-status only), desired state, current generation summary (identity-verified PIDs/phases). Socket-absent + PID-alive reports **`STARTING`** while generation age ≤ grace, and `UNREACHABLE (socket unlinked — flap suspected)` only past grace/persistence. "No servers running" only with no manifest evidence.

### 3.8 Canonical installer (`install-supervision.ts` + shim) `[F15, F16, R6]`

Order matters — **nothing destructive before the trap is armed `[R6]`:**

1. Control lock; refuse if deploy lock live.
2. Render both plists → `plutil -lint` → diff vs installed → **no-op exit if identical** `[R6]` → back up installed plists + record each job's current loaded state.
3. **Arm restore logic** (TS `finally` + best-effort signal handlers): restore backups and re-bootstrap only jobs that were loaded before `[R6]`.
4. Bootout watchdog → bootout prod → install both plists → bootstrap prod → wait probe-ready (bounded) → bootstrap watchdog → desired=running → disarm.

`install.sh` (macOS prod branch) and `deploy-setup.sh` (watchdog block) delegate here; stale `dev.remote.app.plist` / `dev.remote.app.terminal.plist` templates deleted `[F15]`. Watchdog plist: `StartInterval 60`.

## 4. Failure-mode matrix

| Failure | Today | After v3 |
|---|---|---|
| Agent/human `rdv:restart` | Dual-writer flap outage | Control-locked kickstart delegation; forged `--launchd-child` rejected by provenance `[R1]` |
| next-server crash | KeepAlive ≤30s ✅ | Same + generation-ledger escalation on crash loops `[R12]` |
| Build serves 500s | 10–15 min | grace+1 tick ≈ 3 min (≤4 min worst alignment `[R10]`) |
| Terminal server dies alone | Never detected | `/health` probe ≈ 3 min |
| Socket unlinked under live server | Permanent outage | Gen-keyed 2-tick fast-path → reclaim + kickstart |
| Deploy vs KeepAlive | Old build respawned mid-migration | bootout custody; journal-based crash recovery `[R4]` |
| Deploy process SIGKILLed after bootout | (new) stranded unloaded | Watchdog restores from custody journal `[R4]` |
| Intentional `rdv stop` | (new) watchdog would undo it | desired=stopped gates the watchdog `[R5]` |
| Manual restart during deploy | Uncoordinated | Refused (deploy lock); no forgeable bypass `[R8]` |
| Post-deploy primed counter | Instant restart | Counter reset + grace |
| Dev server masks dead prod | Probes pass wrongly | Prod watchdog socket-only |
| Older gen unlinks newer gen's socket | The outage class | dev/ino ownership rule `[R2]`; children never unlink |
| Two starts interleave | PID races | Locks + launchd serialization; TS core holds flock `[R7]` |
| kickstart fails / unknown state | n/a | Fail closed + remediation text |
| Installer dies mid-transaction | Watchdog stranded unloaded | Trap-before-bootout, restore prior loaded states `[R6]` |

## 5. Testing & validation

**Unit (Vitest, injectable exec/fs/clock):** delegation decision table incl. provenance forgeries `[R1]` and every fail-closed branch; manifest lifecycle (atomic pointer flip, phase transitions, corrupt-manifest fail-closed `[R3]`); identity verification (startTimeNs mismatch ⇒ refuse); socket dev/ino unlink rule incl. mismatch `[R2]`; custody journal write/recovery classification (abandoned vs intentional `[R4, R5]`); grace counting math incl. worst-case alignment `[R10]`; ledger thresholds ≥3 + generation-ledger separation `[R12]`; pure-flock vs deploy-flock behavior split `[R14]` (existing deploy-lock tests stay green).

**Pre-rollout fixture (throwaway LaunchAgent):** kickstart-vs-ThrottleInterval `[F10]`; bootout with slow-exiting child under `ExitTimeOut 30`; installer forced mid-transaction failure (restore verified) `[R6]`.

**Prod drills (maintenance window, in order `[F17]`):** non-destructive: (1) status truthfulness incl. STARTING `[R11]`; (2) delegated restart (ledger entry, single next-server invariant, ≤30s); (3) deploy smoke (custody journal appears/clears). Destructive (recovery pre-staged): (4) SIGKILL next-server → KeepAlive ≤60s + generation-ledger entry; (5) SIGKILL terminal → ≤ ~3 min; (6) socket unlink (the v1 outage repro — only after 1–5 pass); (7) SIGKILL a deploy after bootout on a no-op deploy → journal recovery restores prod `[R4]`; (8) ≥3 restarts in an hour → escalation fires `[R12]`.

**Gates:** `bun run lint && bun run typecheck && bun run test:run`.

## 6. Rollout

1. Merge PR (scripts/plists only; **no `src/` app changes**). `git pull --ff-only` PROJECT_ROOT (memory `deploy_flock_lock`).
2. Fixture validation → 3. `install-supervision` in a maintenance window → 4. drills in order → 5. update memories (`rdv_restart_bad_state`, `prod_pgroup_sweep`, `deploy_flock_lock`) + `docs/DEPLOYMENT.md`.

## 7. Deferred

bd `remote-dev-7vra`: launchd socket activation `[F18]` + `proc_pidfdinfo` bound-socket inspector `[F6]`.

## 8. Implementation plan (single PR, worktree subagent)

| Step | Files | Content |
|---|---|---|
| 1 | `scripts/rdv-supervision.ts` (new) | §3.0–3.3, 3.6-act, 3.7 helpers: locks, launchd (exit-status), provenance, generation manifests + reclaim, desired state, ledger, custody-journal recovery — injectable |
| 2 | `scripts/deploy-flock.ts` | Pure `acquireFlock` extraction; legacy PID backoff stays deploy-only `[R14]` |
| 3 | `scripts/rdv.ts` | §3.2 command matrix, §3.3 wrapper (manifest, pre-spawn reclaim, concurrent PGID shutdown), §3.7 status |
| 4 | `scripts/standalone-server.js` | Remove both unlink sites; bind-only `[R2]` |
| 5 | `scripts/watchdog.sh` (shim) + watchdog-act in step 1 | §3.6 |
| 6 | `scripts/deploy.ts` | `LaunchdCustody` across all five call sites `[R9]`, journal `[R4]` |
| 7 | `scripts/install-supervision.ts` + shim, `scripts/service-config/`, `install.sh`, `deploy-setup.sh` | §3.8 |
| 8 | `scripts/*.test.ts` | §5 |
| 9 | `CHANGELOG.md`, `docs/DEPLOYMENT.md` | Docs |

No DB/schema changes. No `src/` changes.
