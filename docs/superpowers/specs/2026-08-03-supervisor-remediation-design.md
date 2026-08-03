# Supervisor UI and State Remediation - Design Spec

**Date:** 2026-08-03
**Status:** Draft pending written review
**Groups:** S1-S3
**Source audit:** `remote-dev-9vik.1-.5`

## 1. Goals

Supervisor must remain trustworthy when used as the control plane. This work makes
its light/dark behavior deliberate, gives authenticated operators a complete
account lifecycle, restores phone-width access and assistive-technology feedback,
and stops presenting accepted desired state as observed cluster success.

The three groups are stacked because they share protected-route chrome and the
instance detail UI:

1. S1 establishes semantic theme and authenticated shell boundaries.
2. S2 makes those boundaries responsive and accessible and adds the shared async
   feedback presentation.
3. S3 adds the durable operation model and uses the prior feedback contract for
   pending and failed reconciliation.

## 2. Non-goals

- Do not import the main Remote Dev application shell or its complete Settings
  implementation into Supervisor.
- Do not style Supervisor chrome with terminal palette literals.
- Do not imply that local OIDC logout terminates Cloudflare Access unless an
  upstream logout actually occurs.
- Do not stream Kubernetes watch data to the browser in the first operation-model
  change. Durable bounded polling is sufficient.
- Do not let the browser become a second Kubernetes writer. The reconciler remains
  the sole cluster mutation path.

## 3. S1: semantic theme and authenticated account shell

### 3.1 Theme resolution

Supervisor remains visually standalone but uses semantic roles matching the main
product: background, foreground, surface/card, muted, border/input, primary,
destructive, status, and focus ring.

The root theme contract is:

- With no override, CSS media queries render the preferred system scheme before
  hydration.
- An explicit System/Light/Dark choice is available from the authenticated account
  menu and the login surface. It persists locally under a Supervisor-specific key.
- A minimal pre-hydration resolver applies an explicit override before paint. It
  accepts only `system`, `light`, or `dark`; any other value is discarded.
- The root declares matching `color-scheme`. Viewport `theme-color` values are
  media-aware for System and updated for explicit modes.
- Runtime OS changes update System mode without reload.

The unconditional `class="dark"` is removed. The mobile-auth callback error page
uses the same semantic variables, follows system/override mode, names the failure,
and provides a safe recovery action. Tokyo Night hex literals are not used for
Supervisor application chrome.

The theme preference is intentionally browser-profile-wide, not operator-specific,
so login and callback pages can honor it before identity exists. The bootstrap is
a static CSP-compatible script with a hash or nonce supplied by the app; it does
not require `unsafe-inline`. Computed-style tests cover contrast for status badges,
focus rings, native controls, scrollbars, callback chrome, and browser theme color.

### 3.2 Protected route group

Dashboard, new instance, and instance detail move under a URL-transparent protected
route group with one server-rendered authenticated layout. The layout resolves the
current operator, applies no-store behavior to privileged output, and provides:

- Product/home link.
- Current email and role.
- Theme selection.
- Account/sign-out menu.
- A compact slot that S2 can recompose at phone widths.

Page-level owner and role authorization remains in place. The layout is not a
substitute for API or resource authorization.

Unauthenticated protected-layout requests use a server redirect to `/login`.
Privileged HTML and action responses are dynamic and send private no-store cache
semantics. Logout expires the Auth.js cookie, redirects through a server response,
and forces route revalidation so browser Back cannot reveal cached privileged
content.

### 3.3 Logout semantics

Native OIDC Sign out calls the existing Auth.js server action, invalidates the
local session, and redirects to a fixed safe `/login?signedOut=1` destination.
Back navigation cannot restore privileged server-rendered content from cache.

Authentication modes are presented accurately:

- OIDC only: `Sign out` ends the Supervisor session.
- Cloudflare Access only: the menu offers `Sign out of organization SSO` only when
  the application can construct the standard fixed logout path from the validated
  configured Cloudflare team origin. Otherwise it explains that access is
  controlled upstream and does not render a fake local action.
- Dual mode: `End local Supervisor session` clears Auth.js but accurately warns
  that Cloudflare Access can immediately identify the operator again. `Sign out of
  organization SSO` performs the full upstream flow. The UI does not promise a
  signed-out login state after only the local action.

The upstream destination is assembled from validated
`SUPERVISOR_CF_ACCESS_TEAM` configuration and a fixed logout path. Its safe return
target is application-owned. An arbitrary origin or return URL cannot be supplied
through a request query parameter.

## 4. S2: responsive composition

Supervisor layouts recompose at content breakpoints rather than shrinking the
desktop grid.

### 4.1 Protected header

At phone widths, identity/role and account actions move into a full-width second
row or compact menu. Nothing is positioned outside the viewport. Focus order
follows visual order, and all coarse-pointer actions provide at least a 44 by 44
target area. Desktop retains its current density.

### 4.2 Dashboard and create form

- Dashboard title, create action, identity, instance cards/rows, long URLs, and
  status values wrap within their containers.
- Create-form labels and actions stack at the smallest breakpoint.
- The closed storage select shows a concise target name/kind; resiliency detail
  remains in associated explanatory text rather than forcing a long option label
  into the control.
- Validation messages remain adjacent and programmatically associated.

### 4.3 Instance detail

- Header title, status, namespace, and base URL wrap or reflow.
- Metadata becomes one column at the smallest width and preserves copyable full
  identifiers.
- Action input/button rows stack without hiding either element.
- Storage, logs, and events own their local overflow.
- Audit history uses compact labeled event cards on phones and the existing table
  at desktop widths. The table, when shown, sits in a named local horizontal
  scroller rather than clipping under `overflow-hidden`.

The dashboard, new-instance, and detail routes have no document-level horizontal
overflow at 320, 375, or 430 CSS pixels, including 200% text zoom. Layout is also
checked at 1024 and 1440 pixels to protect desktop density.

## 5. S2: accessibility and async feedback

### 5.1 Shared feedback primitive

A small `AsyncFeedback` presentation distinguishes:

- Polite progress and accepted/success messages through `role="status"`.
- Assertive failures through `role="alert"`.
- Stable message identity so the same text is not announced repeatedly on poll.
- Optional action controls such as Retry without moving focus from a recoverable
  initiating control.

Live-region elements remain mounted for the workflow lifetime and update atomic
text content. Polling does not repeatedly mount/unmount a status node or announce
an unchanged operation revision.

The region being refreshed receives `aria-busy`; the entire page does not. A
changing button label does not duplicate the live-region announcement.

### 5.2 Form errors and focus

Inputs receive persistent help and error IDs, `aria-invalid`, and
`aria-describedby` or `aria-errormessage`. After a failed submit, focus moves only
to the first invalid field or a route-level error summary when continued
interaction is otherwise impossible. Network and server errors preserve form
input and leave the submitting control available for retry.

### 5.3 Logs, storage, and events

The read-only log control has a stable name such as `Instance logs`, derived from
its section heading. Loading and empty text are separate status content and never
become the textbox name. Logs, storage, and events announce loading, completion,
and failure while retaining predictable keyboard focus.

S2 applies the pattern to create discovery/submission, lifecycle/spec actions,
storage, logs, events, and inline validation. S3 later replaces the lifecycle
accepted message with durable operation state without changing the accessibility
contract.

## 6. S3: desired, observed, and operation data model

### 6.1 Instance fields

The existing instance row keeps desired configuration and gains explicit observed
fields:

- `desiredStatus`: nullable steady-state target limited to `ready`, `suspended`,
  or `deleted`.
- `imageTag`: desired image, retained for API compatibility.
- `storageRequest`: desired PVC request, retained for API compatibility.
- `observedImageTag`: image confirmed on every ready target pod.
- `observedStorageCapacity`: capacity confirmed on the live PVC.
- `observedSpecReplicas`, `observedCurrentReplicas`, `observedUpdatedReplicas`, and
  `observedReadyReplicas`: distinct StatefulSet replica observations.
- `observedGeneration`, `observedCurrentRevision`, and `observedUpdateRevision`:
  rollout identity from the live StatefulSet.
- `observedReady`: readiness confirmed by the live readiness contract.
- `observedAt`: timestamp of the last successful live observation.

`instance.status` remains the observed lifecycle status and compatibility field.
Request routes no longer advance it to the desired result. In particular, Resume
does not write `ready`; it writes `desiredStatus=ready` and creates an operation.
The reconciler moves `status` only after its live checks succeed.

### 6.2 Durable operations

An additive `instance_operation` table records each asynchronous intent:

| Field | Purpose |
|---|---|
| `id` | Stable operation identifier returned by the API. |
| `instanceId` | Cascading instance reference. |
| `kind` | `suspend`, `resume`, `image_rollout`, `storage_resize`, or `terminate`. |
| `domain` | `lifecycle`, `image`, or `storage` conflict domain. |
| `status` | Stored state: `queued`, `applying`, `succeeded`, `failed`, or `superseded`. |
| `revision` | Monotonic per-operation revision incremented on every durable update. |
| `retryOfOperationId` | Immutable link to the prior attempt when Retry creates a new operation. |
| `desiredValue` | Validated JSON snapshot of the requested target. |
| `observedValue` | JSON snapshot captured on success or failure. |
| `errorCode`, `errorMessage` | Sanitized durable failure data. |
| `actorId`, `actorEmail` | Requesting operator audit identity. |
| `leaseOwner`, `leaseEpoch`, `leaseExpiresAt` | Crash-recoverable controller claim and fencing epoch. |
| `fenceInstalledAt` | Time every required external domain fence was installed. |
| `createdAt`, `startedAt`, `lastObservedAt`, `lastProgressAt`, `completedAt` | Durable lifecycle timestamps. |

The schema source remains `schema.def.ts`; generated SQLite and PostgreSQL schemas
and migrations are updated together. Operation kinds and statuses are branded
types with exhaustive transition tests.

An `instance_operation_slot` table serializes active work without relying on
partial indexes unsupported by the shared schema DSL. Its composite primary key is
`(instanceId, domain)`, and it stores `operationId`, `version`, and `updatedAt`.
Each instance owns lifecycle, image, and storage slots.

The API claims a slot and inserts its operation in one transaction using an
optimistic compare-and-swap update:

```text
UPDATE slot
SET operationId = newId, version = version + 1
WHERE instanceId = ? AND domain = ?
  AND version = expectedVersion AND operationId IS NULL
```

Zero changed rows means a concurrent claimant won; the transaction rolls back and
the API reloads the active operation. Completion clears a slot only where
`operationId` still equals the completing operation. PostgreSQL retries
serialization failures; SQLite uses the dialect's immediate write transaction.
Tests run two concurrent writers against both dialects.

One active operation per conflicting domain is therefore enforced as follows:

- Suspend and resume conflict with each other.
- Image rollout conflicts with another image rollout but not an independent
  storage resize.
- Storage resize conflicts with another resize.
- Terminate atomically compare-and-swaps all three slots, marks the exact displaced
  operations `superseded`, and rolls back the entire transaction if any slot
  changed concurrently.

An `instance_operation_request` ledger makes request idempotency independent from
operation identity. It has a unique `(instanceId, idempotencyKey)`, canonical
`requestHash`, immutable serialized response/status, and created/completed
timestamps. A join table records the ordered operation IDs returned by that
request. Ledger rows remain until the instance is purged.

The request row, synchronous rename, slot claims, operations, join rows, and final
response snapshot commit in one transaction. Reusing a key/hash returns that exact
snapshot, including after a lost HTTP response; a different hash returns 409
`IDEMPOTENCY_MISMATCH`. When a new key requests an equivalent active target, its
own ledger row maps durably to the existing operation. A later retry of either key
therefore cannot create a duplicate. A different conflicting target returns 409
with the active operation and that response is also ledgered.

### 6.3 API response

Asynchronous endpoints return 202 with:

```json
{
  "instance": {
    "desired": {},
    "observed": {}
  },
  "operations": [
    {
      "id": "...",
      "kind": "...",
      "status": "queued",
      "revision": 1,
      "url": "/api/instances/.../operations/...",
      "createdAt": "..."
    }
  ]
}
```

The client sends one required `Idempotency-Key` for the whole mutation. A
multi-field PATCH may create or reuse independent image and storage operations;
rename is applied synchronously in the same ledger transaction. The one request
row records all ordered operation IDs and the rename result. Responses always use
`operations[]`. A single-operation response sets `Location` to that operation; a
multi-operation response sets it to the instance operation collection.

`GET /api/instances/:id/operations/:operationId` returns one authorized operation.
`GET /api/instances/:id/operations?cursor=...&limit=...` returns newest-first
history with bounded cursor pagination. These endpoints and instance detail send
`Cache-Control: private, no-store`. Authorization and owner scoping match the
instance resource and return the same non-enumerating response for missing and
foreign operation IDs.

Rename remains a synchronous database-only update and returns normal success. It
does not create a fake reconciliation operation.

### 6.4 Reconciler ownership

The reconciler claims a queued operation by compare-and-swapping its status and
revision to `applying` with a bounded owner lease. After a crash, another controller
may claim an expired lease only by matching the prior revision and lease expiry;
it observes live state before issuing an idempotent mutation. Lease renewal updates
`lastObservedAt`; `lastProgressAt` advances only when kind-specific cluster state
actually changes.

Slot version plus lease epoch form a fencing token. The controller must renew its
lease and verify every occupied slot still points to its operation/fence immediately
before each external mutation. Kubernetes helpers require that token: they install
or test a per-domain fence annotation with a `metadata.resourceVersion`
precondition, and updates/patches test both the current fence and resource version.
Namespace deletion carries UID/resourceVersion preconditions. A controller does
not enter `applying` presentation until the external fence is installed. After a
takeover, completion, Retry supersession, or Terminate claim, an old worker fails
the database renewal or Kubernetes precondition and exits without a blind write.

On every tick it observes the live StatefulSet, pods, PVC, namespace, and readiness
contract, then:

- Confirms Resume only after replicas and readiness are healthy; until then the
  instance remains `suspended` or displays `starting` as a derived presentation.
- Confirms Suspend only after scale-to-zero is observed.
- Confirms image rollout only when observed generation has caught up, current and
  update revisions agree, updated/current/ready replicas all equal the desired
  replica count, and every ready target pod reports the requested image identity.
- For a suspended zero-replica instance, an updated StatefulSet template is labeled
  `Configured for next start`, not observed success. The image operation remains
  active until a later Resume produces ready pods with that image.
- Confirms storage resize only when live PVC capacity meets or exceeds the desired
  quantity.
- Confirms termination only after the namespace is absent.

Successful observation updates instance observed fields and the operation in one
database transaction. A Kubernetes or validation failure records the latest
observation and durable error. No-controller state remains `queued`; it is not
converted to success or a generic fatal instance error.

A `supervisor_controller_heartbeat` table stores each controller ID and last-seen
time independently of operation progress. `Stalled` is a derived read state, not a
stored operation status. The shared pure presentation function derives it from
created/progress/observation/lease timestamps, fresh controller heartbeats, and a
server-clock offset. It distinguishes controller offline, queue backlog, and
cluster no-progress. A stalled active operation continues automatic convergence
when a controller resumes. Explicit Retry atomically marks the old attempt
`superseded` and creates one new operation with `retryOfOperationId`; operation
history is immutable. A stored `failed` operation is terminal and its domain
pauses until Retry, while desired divergence remains visible.

All downstream writers and consumers use the operation service:

- Label-gated automatic image rollout creates a system-authored idempotent image
  operation instead of rewriting `imageTag` directly.
- Idle reaping creates one system suspend operation and deduplicates concurrent
  reaper passes.
- `agent-dispatch.ts` requesting a suspended instance creates/reuses Resume and
  returns explicit 202 `STARTING` plus the operation URL. It does not proxy into an
  unready instance or retain an opaque request payload for later replay.
- Delete/terminate and internal ready-route consumers read observed state and the
  active lifecycle operation, not desired status.

### 6.5 Derived display state and routing

Operator UI derives presentation from observed status plus the newest active
operation:

- `Queued` and `Applying` appear next to the exact requested value.
- Desired and observed image/storage are shown side by side while divergent.
- `Starting` replaces Ready while Resume is active and readiness is false.
- `Failed` or `Stalled` remains visible with time, reason, observed value, and a
  permitted Retry action.
- `Ready` is shown only when observed lifecycle and live readiness agree.

The instance router uses observed readiness, not `desiredStatus` or an accepted
Resume operation. A temporary 502/503 during Resume is represented as Starting,
not advertised as successful availability.

### 6.6 Client refresh

After a 202, `InstanceActions` retains the user's submitted value, renders the
returned operation immediately, and polls its resource with abortable exponential
backoff while the page is visible. It disables only conflicting actions. Reload or
a second browser reconstructs the same state from the server.

Polling gates durable operation fields by their revision and gates heartbeat data
by heartbeat timestamp. The client uses the shared pure presentation function and
schedules a timer at the next derived-state boundary, so Queued becomes
controller-offline/Stalled even when no database operation revision changes.
Equal-revision responses may update server-clock offset and heartbeat but never
replace durable fields. Switching to a newer operation aborts prior requests, so
an older operation cannot overwrite current input. Polling slows after the normal
convergence budget and then offers manual Refresh; durable and derived status
remain visible. S2 live regions announce derived changes once as well as durable
revisions.

## 7. Migration and compatibility

The database change is additive, but semantic activation uses a maintenance-window
deployment because an already-running old binary cannot be forced to understand
new desired/observed rules:

1. Stop all old API and controller processes using a Recreate/scale-to-zero release
   step. Mixed old/new writers are unsupported and blocked by deployment policy.
2. Add desired/observed columns, operation/slot/request-ledger/join and controller-
   heartbeat tables, and a singleton `supervisor_schema_contract` semantic-version
   row for both dialects.
3. Map legacy status to the narrower desired target: requested/provisioning/ready
   to `ready`, suspended to `suspended`, terminating/deleted to `deleted`, and
   error to null for explicit operator recovery. Keep current desired image/storage
   fields and create no synthetic historical operations.
4. Run one new-controller observe-only pass before opening API traffic. It records
   live observations without mutating desired state. Rows it cannot inspect remain
   `Verifying` and are not routed as Ready.
5. Start the new controller and API only after both check the exact schema contract
   version in `controller/index.ts` and `instrumentation.ts`.

Future new binaries refuse older or newer semantic versions. The release procedure
prevents old binaries from starting after activation. Rollback after activation is
forward-only to a compatible binary or restores the pre-migration database backup;
it never starts the old writer against the new contract or drops operation data.
Tests exercise new-binary/old-schema refusal, observe-only activation, and the
documented prohibition of mixed writer versions.

## 8. Group-specific acceptance

| Group | Required proof |
|---|---|
| S1 | Light/dark system preference works before hydration; explicit mode persists; callback uses semantic colors; every protected route exposes accurate identity and logout behavior in OIDC, CF Access, and dual modes. |
| S2 | No route overflows at 320/375/430; controls remain reachable at large text; names, descriptions, live status, errors, busy states, and focus transitions are correct for every audited workflow. |
| S3 | Accepted-but-not-applied, delayed success, failure, stall, controller offline, duplicate request, restart, and two-browser cases preserve distinct desired/observed/operation truth through API, controller, router, and UI. |

## 9. Bead-to-test traceability

Every source Bead acceptance criterion remains normative. These cases are the
minimum proof carried into the detailed plans.

| Bead | Design section | Minimum focused proof |
|---|---|---|
| `.1` | 4 | Dashboard/new/detail at 320/375/430 without document overflow; email/role/status/metadata/forms/actions/audit remain reachable; 44x44 coarse targets; long owner/URL/image/storage/event/audit data; 1024/1440 density; keyboard and 200% zoom. |
| `.2` | 3.1 | Preferred light/dark before hydration; explicit System/Light/Dark persistence/runtime change; body/cards/text/borders/focus/status/native controls/scrollbars/theme color contrast; callback recovery; no Tokyo Night chrome or unconditional dark class. |
| `.3` | 6, 7 | 202 queued/applying truth; desired/observed image/storage/readiness; delayed rollout revision and ready-pod proof; success/failure/fake-clock derived stall/retry/offline controller; lost-response/equivalent-key/mismatched idempotency ledger; two clients/controllers; restart/lease takeover with stale-worker fencing; router and dispatch never claim early Ready. |
| `.4` | 5 | Create/lifecycle/rollout/resize/storage/logs/events progress/success/error; mounted polite/assertive regions without duplicates; scoped busy; field error association; stable `Instance logs` name in every state; focus after success/error/retry; browser AX assertions. |
| `.5` | 3.2, 3.3 | Account control on every protected route; native OIDC cookie invalidation/safe redirect/Back; CF-only and dual-mode accurate labels/full upstream path; email/role at desktop/phone; keyboard/focus. |

## 10. Verification matrix

Supervisor groups run focused Vitest suites in `apps/supervisor`, root and
Supervisor typechecks, changed-file lint, Supervisor production build, database
schema generation/drift checks, and SQLite tests. S3 additionally requires an
ephemeral PostgreSQL service in CI; migration, slot CAS, duplicate idempotency key,
equivalent-target/lost-response ledger replay, terminate supersession, lease
takeover, stale-worker Kubernetes fencing, and two-controller/two-request races
must pass on both dialects. PostgreSQL coverage is not optional for S3.

Automated browser verification covers dashboard, create, detail, login, and mobile
callback under preferred light/dark before paint and explicit overrides. It checks
native controls, theme color, computed contrast, OIDC/CF/dual logout and Back
behavior, document overflow and target bounds at 320/375/430/1024/1440, 200% text
zoom, keyboard focus, and browser accessibility-tree names/roles/descriptions.

S3 additionally uses an injectable fake clock and Kubernetes gateway to prove
operation transitions. Integration fixtures cover controller absence, delayed
readiness, image rollout, PVC growth, scale down/up, terminate, retry, and process
restart without contacting or mutating a live production cluster. Rollout proof
asserts generation, current/update revision, spec/current/updated/ready replicas,
and ready-pod image identity rather than template equality alone.
Fake-clock UI tests advance Queued through controller-offline and Stalled without
writing a new operation revision, then prove a fresh heartbeat/revision announces
recovery exactly once.
