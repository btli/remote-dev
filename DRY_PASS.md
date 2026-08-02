# DRY pass — `feat/model-aware-limits`

Behaviour-preserving cleanup only. No production logic, exports, schema, or
review-rationale comments were changed.

## Extractions

1. **`makeWindow` in `DrizzleUsageLimitWindowRepository.test.ts`**
   Port-shape factory (exhausted-Fable defaults) replacing ~8 copy-pasted write-
   path / assertion literals. Mirrors the existing in-file `makeRow` helper.

2. **`makeSnapshot` in `UsageEndpointPoller.test.ts`**
   Adapter-snapshot factory with null rollup defaults, replacing the repeated
   `{ window5hPct, window7dPct, resetAt5h, resetAt7d, orgPct, resetAtOrg,
   limits: [] }` blocks across the poller suite.

3. **Fail-open `it.each` matrix in `PriorityProfileSelectionPolicy.test.ts`**
   Twelve near-identical “keep primary” cases collapsed into one table-driven
   test. Review tags (G3 / G4 / G5 / G11) and their WHY comments stay above the
   rows they document. Narrative `it()`s kept for the multi-assertion “no
   model” case, positive blocking cases, and the DB-throw / all-blocked paths.

## Deliberately left

| Duplication | Why left |
|-------------|----------|
| `FakeWindowRepo` / `FakeStateRepo` in Priority vs Track tests | Only two call sites; Track’s fakes add `onlyIfNewer` / `shouldThrow` / call tracking that Priority does not need. A shared “options bag” fake is less clear than the readable local classes. |
| `scopedWindow()` (Priority) vs `scoped()` (Track) | Already local factories; defaults differ (`NOW`-relative dates + `observedAt` vs plain reset). Cross-layer shared fixture would force awkward overrides. |
| `makeResult` in Composite vs Sweep tests | Two sites, different `window5hPct` / parameterized `accountId`. Not worth a new module. |
| Fable `limits[]` literal in poller + integration tests | One epic-scenario copy each; integration’s value is reading the full shape inline. |
| `ClaudeUsageLimitEntry` ↔ `UsageLimitWindow` (+ `toWindow`) | Intentional layer boundary (`resetAt` wire vs `resetsAt` port). Unifying renames a public adapter field. |
| Local `clampPct` / `clampPercent` (Track, Drizzle, adapter) | Same idea, **non-identical** NaN / bound edges. Sharing without freezing one semantics risks behaviour change. |
| `resolveKind` in Composite vs Poller | Same DB read, different contracts (VO/`null` vs binary default). Merging would blur fail-open seams. |
| Double `isUsagePollEnabled` check (poller + sweep) | Already one helper; sweep short-circuits DB enumeration when off on purpose. |
| Vitest `vi.mock("@/db")` / `pollEnabled` flag pairs | Look copy-pasted; Vitest hoist rules make a shared mock helper fragile. |
| Load-bearing comments (fail-open, always-null adapter, `NON_FAMILY_ALIASES`) | Explicitly out of scope. |

Finding little production duplication to remove is the expected outcome after two
reviews and a fix pass — the settled logic was already fairly tight.
