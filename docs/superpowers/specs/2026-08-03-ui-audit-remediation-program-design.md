# UI Audit Remediation Program - Design Spec

**Date:** 2026-08-03
**Status:** Draft pending written review
**Owner:** btli
**Source audit:** `remote-dev-9vik`
**Delivery limit:** 18 implementation pull requests plus this design pull request

## 1. Purpose

The August 3 audit found 36 open UI and UX defects across the desktop web app,
Electron, the mobile PWA, Flutter, and Supervisor. The visible central-terminal
sizing regression is real, but it is not an isolated xterm defect: Settings can
consume four simultaneous horizontal budgets, Electron zoom can select the wrong
shell, and several neighboring surfaces have broken responsive, accessibility,
feedback, navigation, identity, and state-model contracts.

This program fixes the complete audited set without combining all surfaces into
one unsafe change. Work is divided into 18 cohesive implementation groups. Every
group gets its own Beads ownership, GitHub issue, isolated worktree, branch,
verification evidence, and draft pull request. Pull requests remain unmerged.

The audited duplicate `remote-dev-9vik.26` is excluded because its evidence was
consolidated into `remote-dev-9vik.21`. The remaining 36 child bugs are all owned
by exactly one implementation group below.

## 2. Product principles

The remediation must preserve the product direction in `PRODUCT.md` and
`DESIGN.md`:

- The desktop app stays keyboard-first and dense without becoming inaccessible.
- Mobile layouts change structure when space changes; they do not merely shrink.
- Light and dark are first-class semantic themes. Tokyo Night remains a terminal
  palette, not default application chrome.
- Touch targets are at least 44 by 44 CSS or logical pixels on coarse-pointer
  surfaces.
- Failure and pending states are explicit and actionable.
- PWA and Flutter may use different presentation technology, but shared tasks
  have the same names, identifiers, safety rules, and outcomes.
- Existing terminal contents and session processes survive layout, zoom, theme,
  and navigation changes whenever the user did not explicitly end them.

## 3. Scope and pull request map

### 3.1 Supervisor

| Group | Beads | Branch | Outcome |
|---|---|---|---|
| S1 | `.2`, `.5` | `agent/ui-supervisor-theme-account` | Semantic system/light/dark Supervisor chrome and an authenticated account/sign-out control on every protected route. |
| S2 | `.1`, `.4` | `agent/ui-supervisor-responsive-a11y` | Phone-safe Supervisor composition plus consistent names, live status, errors, busy state, and focus behavior. |
| S3 | `.3` | `agent/ui-supervisor-observed-state` | Durable desired-versus-observed operations from API through controller and operator UI. |

### 3.2 Electron, desktop, and Settings

| Group | Beads | Branch | Outcome |
|---|---|---|---|
| E1 | `.6`, `.22` | `agent/ui-electron-startup-recovery` | Reachable first-run setup and a recoverable Electron server-start state machine. |
| D1 | `.7`, `.18`, `.19` | `agent/ui-desktop-compact-sizing` | Scroll-safe New Session, width-safe Settings, and terminal-preserving Electron zoom behavior. |
| D2 | `.9`, `.14`, `.15` | `agent/ui-desktop-control-affordances` | Named icon controls, working collapsed rails, and keyboard-visible row actions. |
| D3 | `.16` | `agent/ui-desktop-async-feedback` | Shared user-visible error and retry feedback for audited high-value actions. |
| D4 | `.10` | `agent/ui-desktop-tree-semantics` | Valid composite tree semantics and complete keyboard operation. |
| D5 | `.11` | `agent/ui-desktop-shortcuts` | One platform-aware shortcut model for labels, handlers, and accessibility metadata. |
| D6 | `.12`, `.13` | `agent/ui-desktop-theme-continuity` | Semantic theme continuity for AppShell-skipped routes and CodeMirror. |
| D7 | `.17` | `agent/ui-tmux-instance-ownership` | Instance-safe tmux ownership and non-destructive cleanup. |
| D8 | `.20`, `.23`, `.24`, `.25` | `agent/ui-settings-integrity` | Accessible Settings controls, controlled deep links, durable pending saves, and exactly-once SSH creation. |

### 3.3 Mobile PWA and Flutter

| Group | Beads | Branch | Outcome |
|---|---|---|---|
| M1 | `.8`, `.28`, `.32`, `.33` | `agent/ui-mobile-pwa-shell` | Truthful project/session flow, adaptive navigation, safe smart keys, and correct group scoping. |
| M2 | `.21`, `.27`, `.34` | `agent/ui-mobile-routing-contracts` | Strict channel/recording identifiers and workspace-qualified links and push taps. |
| M3 | `.35` | `agent/ui-mobile-recovery-states` | Reachable, distinct, actionable connection, authentication, and version recovery. |
| M4 | `.29`, `.30`, `.31` | `agent/ui-flutter-compact-accessibility` | Compact-height forms, realistic narrow notification layouts, and OS-respecting text scale. |
| M5 | `.36` | `agent/ui-flutter-semantic-theme` | Persisted System/Light/Dark Flutter theme using semantic color roles. |
| M6 | `.37` | `agent/ui-mobile-profile-capabilities` | Truthful, tested PWA Profile destinations and a documented PWA/Flutter capability registry. |

## 4. Dependency and publication model

The work uses isolated worktrees under the ignored `.worktrees/` directory.
Implementation branches are created from current `origin/master` unless a stack
is listed below. At most three implementation agents run concurrently, leaving
the primary agent available to coordinate reviews, resolve collisions, and
publish.

### 4.1 Stacks

- Supervisor publishes S1, then S2 based on S1, then S3 based on S2. These groups
  share authenticated chrome and instance-detail components.
- Desktop publishes D1, then D2 based on D1. D3 and D4 branch from the reviewed
  D2 tip. D5 also bases on D2; D6 bases on D5 because both change
  `CodeMirrorEditor.tsx`. D8 bases on D3. E1 remains independent from master.
- Before D7 branches, draft PR #450 is rebased onto current `origin/master`, its
  `TmuxAttachArgumentResolver` and hyperlink tests pass, and its reviewed head is
  recorded in the D7 plan. D7 bases on that exact head and does not overwrite its
  tmux client-attach behavior.
- The mobile publication chain is exact: D6 -> M1 -> M4 -> M5 -> M2. M3 and M6
  then branch independently from the reviewed M2 tip. M4 may be developed in
  parallel from master while M1 is underway, but it is rebased onto M1 before its
  draft is published; the resulting stack contains no synthetic integration
  merge. M5/M2/M3/M6 never publish from the temporary development base.
- D1 owns `NewSessionWizard.tsx` and `NewSessionSheet.tsx`; M1 consumes those
  reviewed changes and does not reopen them. D6 owns the root/embed appearance
  bootstrap before M2 changes `/m/channel/[id]`, and M2 preserves that controlled
  appearance contract.

Logical dependencies do not authorize copying another branch's changes or hiding
an integration merge. A dependent draft waits for its named base and records that
base pull request in GitHub.

### 4.2 Existing GitHub ownership

- Existing issue #171 is rewritten as the grouped E1 issue because its setup
  persistence evidence is stale. Any still-valid automatic-install/web-fallback
  work outside `.6` and `.22` moves to a separately linked follow-up issue instead
  of silently expanding E1.
- Draft PR #450 owns tmux client attach capability in `src/server/terminal.ts`,
  including `TmuxAttachArgumentResolver`, plus `tmux-hyperlinks.ts`. D7 stacks on
  its freshly rebased reviewed head and limits its diff to ownership and cleanup
  safety. Renderer link behavior remains reserved to #451.
- Draft PR #451 owns `Terminal.tsx`, terminal link behavior, and the named terminal
  refit/font-race tests. Other groups avoid those files unless a reviewed stack
  dependency is explicitly established.
- Unrelated open pull requests and all user-owned untracked files in the primary
  checkout remain untouched.

## 5. GitHub issue design

One umbrella GitHub issue tracks the program and links the source audit, the four
design documents, all implementation issues, and the dependency order. There are
18 implementation issues: 17 new grouped issues plus existing #171 for E1.

Each grouped issue contains:

1. The owned Beads IDs and their priorities.
2. A concise reproduction and user impact summary.
3. The agreed architectural boundary and non-goals.
4. Acceptance criteria copied without weakening the source findings.
5. Required viewport, accessibility, failure, or state-transition matrices.
6. Dependencies and known file reservations.
7. A checklist for TDD, DRY review, simplifier review, final verification, and a
   draft pull request.

Issue titles use the group prefix, for example `[D1] Restore compact desktop
sizing and terminal continuity`. Labels reuse repository labels where available;
the program does not create decorative labels merely to mirror group names.

The umbrella issue remains open while any implementation issue or draft pull
request remains open. Implementation issues use `Fixes #<issue>` in their pull
request descriptions so GitHub will close them only if a maintainer later merges
the pull request. No issue is closed merely because a draft was opened.

## 6. Agent and worktree protocol

Every implementation group follows the same isolated protocol:

1. Fetch `origin` and resolve the exact reviewed base commit.
2. Create `.worktrees/<group-slug>` and its `agent/ui-*` branch.
3. Install from the lockfile and record the baseline test result before edits.
4. Mark the owned Beads issues `in_progress` and add the GitHub issue URL to their
   notes. No agent claims an issue owned by another group.
5. Read all scoped `AGENTS.md` files and the group implementation plan before
   editing.
6. Work only in the group's worktree. The primary checkout is never used as a
   scratch area or publication branch.
7. Push the branch and open a draft pull request. Never merge, squash, or close
   another pull request.

An implementation agent may request help but may not broaden its issue set. If a
new defect is discovered, it is filed as follow-up work and linked to the umbrella
issue; it is not silently folded into the current diff.

## 7. Required development and review pipeline

Every implementation pull request must show all of these gates in order.

### 7.1 Test-driven change

1. Add the smallest behavioral test that demonstrates the bug.
2. Run it and record the expected failure, including why it proves the defect.
3. Implement the minimum coherent fix.
4. Re-run the focused test until green, then run the nearby suite.

Tests must exercise behavior through public boundaries. Mock-only tests that
assert the mock itself, production test hooks, arbitrary timing sleeps, or tests
that delete real user state are prohibited.

### 7.2 Independent passes

After the implementer self-review, fresh agents perform these passes:

- **Spec-compliance review:** verifies every owned Bead and every group acceptance
  criterion is satisfied, with no unauthorized scope.
- **DRY review:** identifies newly duplicated policy, formatting, state, validation,
  request, theme, or layout logic. It requires reuse only where the shared concept
  is genuinely stable; superficial similarity is not extracted.
- **Simplifier review:** removes accidental indirection, state, branches, wrappers,
  and comments while preserving the tested behavior. It may not weaken error,
  accessibility, ownership, or durability semantics to reduce line count.
- **Code-quality review:** checks correctness, race behavior, cleanup, naming,
  accessibility, security, migrations, performance, and maintainability after the
  prior fixes.

The implementer addresses findings after each pass and reruns focused tests. The
reviewing agent cannot approve its own implementation.

### 7.3 Verification

Each group runs focused tests plus the applicable typecheck, lint, build, and
runtime checks from its detailed plan. Cross-surface groups verify both sides of
their contract. Responsive checks use real target widths and heights rather than
increasing the viewport until a test passes.

The known Flutter baseline has 11 presentation failures centered on Edit Host.
Only M4 may take ownership of those failures. M4 must first reproduce them, then
make the original tests green without widening their fixture. Any different
baseline failure is investigated before work proceeds.

## 8. Pull request contract

Every pull request is opened as a draft and includes:

- Group name, GitHub issue, and Beads IDs.
- Base branch or parent pull request and all logical dependencies.
- User-visible before/after behavior.
- Red test evidence and green verification commands with results.
- Migration, rollback, accessibility, responsive, and cross-client notes where
  applicable.
- Separate checkboxes and reviewer summaries for spec, DRY, simplifier, and final
  code-quality passes.
- Screenshots or accessibility-tree evidence for visual changes, without adding
  generated artifacts to the repository unless the test suite requires them.

No pull request is marked ready for review until its review passes and verification
are complete. No pull request is merged during this program session.

## 9. Completion and handoff

For this session, success means the design and implementation-plan documents are
approved, grouped GitHub issues exist, each attempted group has a pushed branch
and draft pull request, all verification evidence is attached, and unfinished
work is accurately marked rather than implied complete.

Beads issues remain `in_progress` while their fixes are only in unmerged drafts.
They can be closed after maintainers merge and verify the changes on the target
branch. The final handoff lists open drafts in dependency order, known failures,
review results, and the exact next action for every blocked group.
