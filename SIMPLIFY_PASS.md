# Simplify pass — `feat/claude-accounts-decouple`

Behaviour-preserving expression cleanup only. No public export renames, no API
route shape changes, no schema/migration edits, no test edits. Read against
`DRY_PASS.md` and the post-review fix commits so deliberate decisions stay.

Outcome: a **small** set of real simplifications. Most of the branch is already
tight after two reviews, a fix pass, a DRY pass, and a value-object cleanup —
preferring no churn over inventing more.

## Simplifications made

1. **`src/services/claude-account-service.ts`**
   - `findOwnedRow` and `saveAccountToken`'s update `.where(...)` now use the
     existing `ownedBy` predicate instead of repeating the id+userId `and(eq…)`.
   - `extractSetupToken`: `!matches || matches.length === 0` → `!matches?.length`.

2. **`src/infrastructure/usage-limit/usage-poll-sweep.ts`**
   - Dropped the dead `skipped` counter. The query already uses
     `isNotNull(profileId)`; the inner guard only narrows the TypeScript type
     (column remains `string | null` in the inferred row). Logging no longer
     pretends skips can happen after that filter.

3. **`src/application/use-cases/profile/RelaunchOnLimitUseCase.ts`**
   - Extracted `notifyWithRelaunch` for the duplicated limit+CTA notification
     payload used by notify-mode success and auto-mode launch failure.
   - Notify-mode still logs `"Notified limit with relaunch CTA"`; the auto-fail
     path still only logs the warn (no extra info log) so observability is
     unchanged. Notify-mode also uses an early `!next` return so both modes
     share the same guard shape.

4. **`src/app/api/claude-accounts/[accountId]/route.ts`**
   - PATCH alias normalization: nested ternary → flat if/else chain.

5. **`src/domain/value-objects/LimitState.ts`**
   - `toSnapshot` `limitStatus` derivation: nested ternary → if/else.

6. **`src/components/claude-limits/ClaudeAccountRow.tsx`**
   - `UsageBar` color selection: nested ternary / `high`/`mid` flags → simple
     if/else on `barClass`.

7. **`src/components/claude-limits/ClaudeAccountsDashboard.tsx`**
   - Clock `useEffect`: removed needless `useRef` for the interval id; local
     `const id` + cleanup is enough.

## Deliberately left complex

- **Load-bearing WHY comments** (ProfileIsolation “CLAUDE IS DELIBERATELY
  EXCLUDED”, `resolveAccountEnv` ownership invariant, capture scrollback wipe
  order, setup-session marker, Keychain/`CLAUDE_CONFIG_DIR` hazard, etc.) —
  these record verified facts from earlier passes; not restating the code.
- **DRY_PASS extractions helpers** (`requireOwnedPool`, `loadPoolMemberViews`,
  `requireAccountId`, `identityDisplayColumns`, `markAccountUnhealthy`, wire
  type aliases) — already the right grain; inlining would undo that pass.
- **Two-line “Account not found” after `getAccount`** — ownership 404 stays next
  to each verb (DRY_PASS decision).
- **`RotationPolicy` instance method forwarding to static** — matches the other
  VO shapes; not needless once that convention is fixed.
- **`buildInitialEnv` / `SessionEnvLayers`** — pure extracted precedence contract
  with tests; not a pass-through wrapper.
- **`usage-poll-sweep` origin-profile bridge + TODO** — temporary until the
  gateway takes `accountId` + token; simplifying would redesign, not express.
- **Presync vs backfill / CLI wrappers / `CLAUDE_CAPABLE_PROVIDERS` vs
  `isClaudeCapable`** — left alone per DRY_PASS (layering / CLI entry points).
- **`defaultClaudeAccountInfo()` spreading a const** — defensive copy so callers
  cannot mutate the shared default.
- **Create-path `configDir` ternary in `session-service`** — single-level, clear;
  not worth a shared helper with the resume path (different profile source).
- **Resume-path nested `configDir` ternary** — a flatten that defaulted to
  `HOME` then overwrote would change behaviour when a non-Claude `profileId`
  points at a missing profile (`undefined` → skip hooks vs install into HOME).
  Left as-is; added a short WHY comment so the next pass does not “fix” it.
- **AddAccountDialog / large UI surfaces** — mode/state machine is already the
  product shape; collapsing would hurt readability.
- **Comments that look long but explain absence or hazards** — kept.

## Gates

`bun run lint`, `bun run typecheck`, `bun run test:run` — all green after this
pass (2999 tests passed).
