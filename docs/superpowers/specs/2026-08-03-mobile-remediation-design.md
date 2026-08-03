# Mobile PWA and Flutter Remediation - Design Spec

**Date:** 2026-08-03
**Status:** Draft pending written review
**Groups:** M1-M6
**Source audit:** `remote-dev-9vik.8`, `.21`, `.27-.37`

## 1. Goals

This work repairs the shipped mobile paths as one product across the PWA and
Flutter shell. It restores reachable navigation, truthful project and Profile
flows, safe terminal input, strict routing identifiers, workspace-qualified
external navigation, compact layout, system text and theme preferences, and
actionable recovery states.

The hybrid boundary remains intentional: Flutter owns device, workspace, native
shell, and native list/form concerns; embedded `/m/*` pages own terminal, channel,
and recording web content. The fix makes the data contracts crossing that boundary
explicit rather than replacing the architecture.

## 2. Non-goals

- Do not reimplement xterm, channel history, or recording playback as Flutter
  widgets.
- Do not revive the superseded Expo/React Native client.
- Do not claim full offline operation. The app must explain and recover from
  offline state, but terminal and server data remain online services.
- Do not make unsupported Profile tasks appear functional through placeholder
  screens.
- Do not reduce device accessibility settings to make a layout test pass.

## 3. Shared mobile contracts

### 3.1 Workspace identity

A workspace is identified externally by a canonical public origin plus normalized
base path. Local Flutter storage may retain an internal workspace ID, but links and
push payloads cannot depend on a device-local ID that the server does not know.

The shared locator shape is:

```text
origin: lowercase HTTPS scheme + host + effective port
basePath: empty or normalized slash-separated Remote Dev base path
```

Secrets, cookies, tokens, user IDs, and raw connection labels are never included.
Flutter resolves this locator against saved workspaces. Two workspaces on one
Supervisor host remain distinct through `basePath`.

### 3.2 Typed destination identity

Session, channel, and recording IDs are distinct destination types at route and
API boundaries. TypeScript uses named input types and runtime validation; Dart
uses distinct route variants/value objects. A session ID is never accepted by a
recording playback route merely because both are strings.

Every external destination is a pair:

```text
workspace locator + typed destination(kind, id)
```

### 3.3 Capability ownership

The PWA and Flutter share `contracts/mobile-profile-capabilities.json`, a
schema-validated machine-readable registry. TypeScript consumes the JSON directly;
a checked-in generated Dart fixture is produced by one repository script, and a
test fails when its source hash differs. Each task has one status per client:

- `native`: implemented in the client shell.
- `embedded`: implemented by a validated `/m/*` surface.
- `handoff`: unavailable in this interaction mode, with a supported destination
  and truthful explanation.
- `unavailable`: not offered as an enabled action.

Labels and outcomes remain consistent even when the presentation differs.

M6 delivers this explicit registry state:

| Capability | PWA | Flutter | Outcome |
|---|---|---|---|
| Account | `native` | `native` | View account and perform supported session/account actions. |
| GitHub accounts | `native` | `native` | List and perform supported connect/disconnect actions. |
| Appearance/Settings | `native` | `native` | Change the preferences supported by that client. |
| Servers | `unavailable` | `native` | Flutter manages saved hosts/workspaces; PWA does not advertise server management. |
| Projects | `native` | `native` | Browse scope and create through the canonical project contract. |
| Agent Profiles | `unavailable` | `unavailable` | Both clients explain that desktop management is required and render no enabled row. |
| Secrets | `native` | `unavailable` | PWA provides authorized redacted management; Flutter does not advertise it. |
| Ports | `native` | `unavailable` | Existing PWA Ports remains functional; Flutter does not advertise it. |
| Trash | `unavailable` | `unavailable` | No enabled mobile destination until restore semantics are implemented. |
| Security | `unavailable` | `native` | Flutter owns biometric security; PWA does not claim an equivalent. |
| About | `native` | `native` | Both clients expose version and product information. |

`unavailable` entries may show static explanatory copy in the Profile index, but
they cannot render as enabled navigation rows. A desktop URL that remounts
`MobileApp` at the current viewport is not a supported handoff.

## 4. M1: PWA shell, projects, scoping, and smart keys

### 4.1 One adaptive shell decision

`MobileViewportSwitch`, `MobileApp`, and `MobileShell` consume one shared shell
mode. A mobile PWA does not drop its global navigation merely because landscape or
foldable width crosses 768 CSS pixels.

The mobile shell has two structural presentations:

- Compact phone mode uses the bottom tab bar.
- Wide-mobile mode uses a compact navigation rail or an equivalently persistent
  tab control while preserving the same destinations.

Sessions, Notifications, Channels, and Profile remain visible and operable at
320 by 568, 568 by 320, 812 by 375, and 932 by 430. Rotation, unfold, and keyboard
resize preserve the selected tab and mounted session view. A keyboard opening is
not treated as a device-class change. The bounded terminal-height behavior from
`remote-dev-9rvt` remains intact on both sides of the 768-pixel transition.

### 4.2 Truthful project state

The Sessions empty state derives from actual tree data and selected scope:

- `All projects` with any existing project is a valid project state.
- No-project copy appears only when the canonical project collection is empty.
- New project and New group are rendered as enabled only when a functional flow
  is wired.
- Opening a create flow does not close the picker until the next surface is known
  to have opened.
- Cancel restores the prior picker state; success selects the new node and makes
  Start session available.

M1 reuses the validated project/group mutations already owned by the desktop
project-tree context. It does not create a second mobile-only data model.

### 4.3 Descendant group scoping

One pure project-tree selector resolves a group to every descendant project ID,
including nested groups. Desktop and mobile use this selector for scope semantics.
Sessions filter by that resolved set. Resolution failure produces an explicit
error, never an `All sessions` fallback under a selected group label.

The selector responds to live project/session moves without leaving stale rows.
Tests use sibling groups with overlapping session names, nested and empty groups,
root/All projects, and direct project selection so label-only assertions cannot
mask a leaked result set.

### 4.4 Safe smart-key activation

The smart-key rail separates scrolling from activation:

- Native button `click` is the single ordinary activation path for pointer,
  keyboard, switch, and assistive technology.
- A horizontal gesture that crosses the scroll threshold cancels key dispatch,
  including when it began on a key.
- Pointer cancellation and lost capture dispatch nothing.
- Intentional key repeat begins only after a stationary hold threshold and stops
  on movement, release, cancellation, blur, or visibility loss. The following
  synthetic click is suppressed after a repeat sequence.
- Latched modifiers expose `aria-pressed`; scrolling does not consume or toggle
  them.
- Every target is at least 44 by 44 CSS pixels.

Control sequences such as Enter and Ctrl-C receive the same gesture protections
as printable keys.

## 5. M2: routing and external navigation

### 5.1 Channel selection

`/m/channel/[id]` consumes and validates its route parameter. The authenticated
route performs a direct owner-scoped `GET /api/channels/:id` lookup before seeding
the channel provider. It does not depend on `activeNode`, a saved channel list, or
the prior provider selection. The returned channel supplies its project/scope to
the embedded provider, which then renders only that channel. Missing and
inaccessible IDs share one non-enumerating `Channel unavailable` state; transport
failure is distinct and retryable. The route never silently selects `#general`.

Flutter channel rows, deep links, and notification taps all pass the same typed
channel destination. Sending, mark-read, thread takeover, and back behavior bind
to that selected channel.

### 5.2 Recording discovery and playback

`View recordings` is a session-scoped discovery action, not playback. It opens a
narrow `GET /api/recordings?sessionId=<id>` query. The authenticated server filters
by both user ID and exact session ID and returns metadata-only `RecordingSummary`
objects, never recording event data. The schema gains a `(userId, sessionId)`
index. Client-side filtering of the all-recordings response is prohibited.

Each list item carries an actual recording ID and
navigates to `/m/recording/<recording-id>`. The playback route rejects a session ID
or malformed recording ID explicitly. The PWA shell exposes the same discovery
contract instead of hard-coding recordings unavailable.

Zero, one, and multiple recording states are all first-class. Direct deep links to
valid recording IDs continue to work.

### 5.3 HTTPS links

The deep-link router retains the HTTPS origin and base path while parsing the
typed destination. Before navigation it:

1. Validates scheme, host, normalized base path, and destination syntax.
2. Resolves the locator to one saved workspace.
3. Prompts for sign-in or a safe workspace choice when the match is absent or no
   longer authenticated.
4. Atomically selects/persists the workspace and invalidates providers tied to the
   old connection.
5. Waits for the new active connection, then pushes the destination route.

Unknown or malicious origins never fall back to the currently active workspace.
The navigation coordinator roots the destination under the selected workspace's
home stack. Back returns to that workspace, not to a target or provider left from
the formerly active workspace.

### 5.4 Push taps

Push registration sends the flat string fields `workspaceLocatorVersion`,
`workspaceOrigin`, and `workspaceBasePath` alongside token, platform, and device
ID. The server does not trust those fields as arbitrary client input. It derives
the canonical public locator from `RDV_PUBLIC_URL` or from forwarded host/proto
headers only when the immediate proxy is explicitly trusted, verifies the supplied
locator matches, and stores the normalized result on the push-token row. Origins
lowercase scheme/host, normalize IDNs and effective ports, remove default HTTPS
port 443, and reject non-HTTPS production values. Base paths use the canonical
Remote Dev base-path validator.

The push-token schema/repository gains nullable locator version/origin/base-path
columns. Notification FCM data uses only string values with those exact flat keys.
Legacy rows and payloads without a locator remain valid but cannot be routed by
guessing; re-registration backfills them. The same installation token may remain
registered with multiple workspaces because each server persists its own bound
locator.

Flutter resolves the payload using the same path as HTTPS links before marking a
notification read or navigating. Mark-read is sent through the newly selected
workspace client only after the switch succeeds.

Legacy payloads without a locator show a workspace picker or explanatory state.
They do not guess the active workspace. Cold-start and warm-start taps share the
same queued navigation coordinator so only the latest accepted destination is
applied after authentication and workspace initialization.

Tests cover spoofed supplied origins, untrusted forwarded headers, default-port
normalization, path-prefixed siblings on one host, removed/signed-out workspaces,
legacy registration/payloads, and real FCM string-only payload shapes.

Tests use two workspaces with overlapping session, channel, recording, and
notification fixture IDs to prove that routing does not accidentally pass against
the active server.

## 6. M3: connection and compatibility recovery

One mobile connection model combines observable events from native HTTP, WebView
document loading, terminal WebSocket/bridge state, authentication, network
connectivity, and bridge protocol version.

| State | Presentation | Actions |
|---|---|---|
| `connected` | Normal content. | None. |
| `reconnecting` | Non-blocking status over preserved content. | Show details; allow wait. |
| `offline` | Device has no network path. | Retry automatically and manually; switch workspace. |
| `server_unreachable` | Network exists but the selected server/load failed. | Retry; edit or switch workspace. |
| `authentication_required` | Credentials expired or were rejected. | Reauthenticate; switch workspace. |
| `version_incompatible` | Native/bridge/server contract is unsupported. | Update action or supported web handoff. |
| `session_ended` | Server is reachable but the requested session ended or is absent. | Back to sessions; open another session. |

The implementation is one reducer owned above API providers and the WebView. A
monotonic destination generation increments on workspace selection, destination
change, and explicit Retry. Every event carries that generation plus workspace and
destination identity; stale events are ignored.

| Event family | Reducer effect |
|---|---|
| Connectivity online/offline | Records network availability; offline dominates transport/reconnect errors until online. |
| WebView load start/success/HTTP error/load error | Tracks whether content ever loaded and whether the document can be retried in place. |
| Native API success/401/403/transport failure | Separates authentication from reachability without trusting connectivity alone. |
| Bridge hello/timeout | Validates the declared bridge version against native minimum and maximum supported versions. |
| Terminal connecting/open/reconnecting/closed | Drives connected or non-blocking reconnect only after document and bridge are ready. |
| Session lookup ended/missing | Produces `session_ended` only from a successful server response. |
| Reauthenticate success / Retry / Switch workspace | Creates a new generation, clears only the relevant diagnosis, and starts the appropriate load. |

State precedence is `version_incompatible`, `authentication_required`,
`session_ended`, `offline`, `server_unreachable`, `reconnecting`, then `connected`.
A higher-priority diagnosis is cleared only by its explicit successful transition,
not by an unrelated late event.

Offline and terminal reconnect preserve a previously loaded WebView. A document
error before first load shows the blocking server screen while retaining the
controller for Retry; a generation-changing workspace switch disposes the old
WebView and all of its event subscriptions. Authentication blocks input, runs the
existing reauth flow, then reloads under a new generation. Version incompatibility
disables bridge commands and requires update/handoff; it never attempts commands
outside the declared `[minBridgeVersion, maxBridgeVersion]` interval.

Transient reconnect keeps terminal output and the WebView instance mounted. A
route-level blocker may replace interaction but retains enough state for Retry.
Status changes are announced without repeatedly interrupting screen-reader users.

The existing `ReconnectingBanner`, `ServerUnreachableScreen`, and
`VersionMismatchScreen` become reachable from production state transitions.
WebView load and HTTP errors feed the model instead of logging only. The PWA
disconnection message offers only interactions that exist; the unsupported
`Pull down for details` instruction is removed unless M3 supplies that gesture.
`offline` and `server_unreachable` retain structured causes so DNS failure, HTTP
document failure, and generic reachability can be explained and tested separately
without multiplying visually identical screens.

## 7. M4: compact Flutter layout and text accessibility

### 7.1 Device text is the baseline

Flutter no longer replaces the operating system `TextScaler` with a fixed app
value. Default appearance leaves the system scaler untouched, including nonlinear
accessibility sizes above 130%.

If the existing in-app UI-size preference remains, it becomes an explicit
multiplier composed on the result of the system scaler. `System` is the default
and reset value. No composition cap may reduce the OS result. Layouts adapt to
large text instead of suppressing it globally.

Terminal canvas font sizing remains a separate terminal preference and is not
confused with application text accessibility.

Large-text coverage spans auth, Edit Host, shell tabs, Notifications, session
chrome, smart keys, Profile, and dialogs. Tests fail on clipped labels,
off-screen actions, or `RenderFlex` diagnostics rather than accepting overflow as
golden churn.

### 7.2 Edit Host

The Edit Host form uses a safe-area and keyboard-aware scroll view. Focus traversal
follows form order, validation identifies and scrolls the first invalid field into
view, and Save remains reachable without obscuring the final field. The original
800 by 600 presentation tests remain at their original size and become green.
Additional tests cover 568 by 320, keyboard insets, and large text.

### 7.3 Notifications

Notification filters use an adaptive secondary row that wraps or scrolls with a
clear affordance. Bulk actions move into an overflow menu when title width is
constrained. The design supports 320, 360, 375, and 430 logical pixels, long
localized labels, and large text. Empty, unread, populated, and all-read states
retain every applicable filter and action. Tests no longer widen the fixture to
450 pixels to avoid overflow.

## 8. M5: Flutter semantic appearance

`AppearanceSettings` gains a persisted `ThemeMode` with System as the fresh-install
default. `MaterialApp.router` receives semantic light and dark `ThemeData` peers
and reacts to OS appearance changes while in System mode.

Core screens use `ColorScheme`, text theme, and narrowly scoped theme extensions
for status colors. Hard-coded Tokyo Night, white, and black application-chrome
literals are removed from auth, workspace, shell, dialogs, errors, biometrics,
Profile, and Settings. The terminal content may retain its deliberate Tokyo Night
palette.

Native status/navigation bars and keyboard-adjacent chrome follow the resolved
mode. Embedded `/m/*` URLs receive the resolved light/dark mode through the exact
`rdvAppearance=light|dark` query parameter. D6 owns the CSP-safe root bootstrap
that validates and applies this parameter before first paint. Missing/invalid input
uses the ordinary persisted/system web precedence.

When a valid parameter is present, the embed mounts `AppearanceProvider` in a
controlled mode: native is authoritative and later authenticated preference fetches
cannot overwrite it. The provider owns semantic variables, browser
`color-scheme`, and theme color from that one resolved mode. Native runtime changes
call the versioned bridge command
`setAppearance({ contractVersion: 1, mode: "light" | "dark" })`; unsupported
contract versions fail into M3 compatibility recovery. This prevents
native/WebView disagreement and dark flashes without letting arbitrary query
values become CSS.

Golden and widget tests cover System resolution, explicit Light/Dark persistence,
runtime OS changes, contrast-sensitive status roles, and every core screen family.

## 9. M6: truthful PWA Profile capabilities

Production `StubBody` destinations are removed. A typed Profile capability
registry owns label, description, availability, destination, and client parity.
Rows render from that registry, so an absent handler cannot appear as an enabled
generic navigation row.

The first implementation delivers these PWA tasks directly through existing
service contracts:

- Account summary and account/session actions.
- GitHub account list and supported connect/disconnect actions.
- Project/group browsing and creation through the M1 project contract.
- Mobile Settings and Appearance preferences.
- Secrets listing and supported create/update/delete actions with existing
  authorization and redaction rules.

Agent Profiles and Trash are `unavailable` until their full mobile workflows
exist. The Profile index states the limitation without rendering an enabled row or
pushing a placeholder. A copied desktop URL may be offered as help text, but is not
classified as a handoff because opening it on the same mobile client remounts the
mobile shell.

Ports and About remain real screens. Tests fail if a machine-registry entry marked
`native` or `embedded` resolves to placeholder copy or a missing handler, if an
`unavailable` entry renders enabled, or if the generated Dart fixture is stale.

## 10. Group-specific acceptance

| Group | Required proof |
|---|---|
| M1 | Navigation remains reachable across portrait, landscape, fold, and keyboard resize without terminal-height or remount regression; project copy matches data; create actions cover cancel/validation/success; live nested-group scope is exact with overlapping names; smart-key tap/drag/cancel/keyboard/repeat behavior is safe. |
| M2 | Two-workspace end-to-end tests prove channel, recording, HTTPS link, push, mark-read, and Back paths retain both workspace and typed ID; thread-first Back behavior remains; invalid and foreign destinations fail safely. |
| M3 | Production events reach every connection state; actions recover without killing the app; transient reconnect preserves terminal output; PWA copy is truthful. |
| M4 | Original 11 Edit Host failures become green; realistic phone widths and large OS text produce no overflow, hidden action, or reduced accessibility scale. |
| M5 | Fresh install follows OS; System/Light/Dark persists and updates; native bars and embedded routes agree; core chrome uses semantic colors in both modes. |
| M6 | Every enabled Profile row completes its task; unavailable tasks are not enabled; no production placeholder copy remains; the machine-readable parity registry and both language consumers agree. |

## 11. Bead-to-test traceability

Every source Bead acceptance criterion remains normative. The detailed plan may
add tests, but it cannot replace these minimum regression proofs with only the
group summary above.

| Bead | Design section | Minimum focused proof |
|---|---|---|
| `.8` | 4.2 | No projects; All Projects with data; active project/group; both create actions; cancel; validation failure; launch failure that keeps the sheet open; success/select/start. |
| `.21` | 5.1 | Valid, malformed, changed, initially unloaded, unavailable, and cross-workspace channel IDs; active scope starts in another project; send/thread and thread-first Back use the requested channel. |
| `.27` | 5.2 | Zero/multiple session summaries; metadata-only response; actual recording IDs reach playback; session ID is rejected; direct valid recording link works in Flutter and PWA. |
| `.28` | 4.1 | 320x568, 568x320, 812x375, 932x430, and Pixel Fold transition; all four destinations; active tab/WebView identity and bounded terminal height survive rotation, unfold, and keyboard resize. |
| `.29` | 7.2 | Original eleven 800x600 tests, 568x320, keyboard inset, focus traversal, scan/token/validation/final field, and no overflow diagnostics. |
| `.30` | 7.1 | OS default and accessibility sizes above 130%; reset to System; composed multiplier; auth, form, tabs, notifications, session chrome, smart keys, Profile, and dialogs. |
| `.31` | 7.3 | 320/360/375/430 widths; empty/unread/populated/all-read; all filters/actions by touch, keyboard, and screen reader; long labels and large text. |
| `.32` | 4.4 | Tap exactly once; drag from every key; cancel/lost capture; Enter/Space; modifier pressed state; repeat lifecycle; 44x44 target geometry. |
| `.33` | 4.3 | Nested/empty/root/direct scopes, sibling groups with duplicate session names, live project/session moves, and selected label/result agreement. |
| `.34` | 3.1, 5.3, 5.4 | A/B both directions with overlapping IDs; HTTPS and FCM shapes; path siblings; removed/signed-out/malicious/legacy locators; cold/warm mark-read; correctly rooted Back. |
| `.35` | 6 | Offline, DNS, HTTP load, auth expiry, terminal reconnect, ended session, and min/max bridge mismatch from production events; Retry/reauth/switch/update and cold-start recovery. |
| `.36` | 8 | Fresh/System/Light/Dark persistence and runtime OS change; all core screen families, system bars, keyboard chrome, controlled embeds, no flash, contrast, and no Tokyo Night chrome literals. |
| `.37` | 3.3, 9 | Account/GitHub/Projects/Settings/Secrets success plus empty/loading/error states; unavailable rows disabled; narrow/large-text Back behavior; no `StubBody` or follow-up copy; generated registry parity. |

## 12. Verification matrix

PWA changes run focused Vitest suites, root typecheck and lint, production build,
and browser interaction checks at all named viewport transitions. Accessibility
checks exercise keyboard and browser accessibility-tree output.

Flutter changes run `flutter analyze`, focused domain/application/widget tests,
the complete presentation suite, and platform builds available in the environment.
M4 records the pre-change 11-failure baseline before editing. Device-only items
such as keyboard insets, universal links, notification cold starts, system bars,
and OS text/theme changes are verified on Android and iOS when runners are
available; unavailable physical checks remain explicit in the draft pull request
instead of being implied by widget tests.
