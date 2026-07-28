# DRY pass — `feat/claude-accounts-decouple`

Behaviour-preserving cleanup only. No public export renames, no API route
changes, no schema/migration edits.

## Extractions

1. **`src/app/api/_lib/claude-pool.ts`**
   - `requireOwnedPool` — the repeated `poolId` missing → 400 / foreign-or-missing → 404 gate used by every `/api/claude-pools/[poolId]/*` verb.
   - `loadPoolMemberViews` — the duplicated “members + account labels + serialized limit states” assembly that lived identically in `[poolId]/route.ts` GET and `[poolId]/status/route.ts` GET.

2. **`src/app/api/_lib/claude-account-params.ts`**
   - `requireAccountId` — the repeated `params.accountId` missing → 400 check across the `[accountId]` account routes.

3. **Parallel wire types collapsed to aliases**
   - `SerializedLimitState` → type-alias of `LimitStateBlock` (`types/claude-limits.ts`).
   - `ClaudeAccountView` → type-alias of `ClaudeAccountSummary` (same file). Export names kept so callers do not break.

4. **`claude-account-service.ts` internals**
   - `identityDisplayColumns` — shared identity→DB column mapping used by both `saveAccountToken` and `verifyAccount`.
   - `markAccountUnhealthy` — shared “no token / decrypt failed” path inside `verifyAccount`.

## Deliberately left

- **Presync vs backfill CLI wrappers** (`scripts/*claude*`) — thin `then/catch` + `console.log` entry points around already-shared library functions; extracting a runner would obscure more than it helps.
- **`CLAUDE_CAPABLE_PROVIDERS` in `backfill-claude-accounts.ts` vs `isClaudeCapable` / `isClaudeCapableProvider`** — backfill needs an array for Drizzle `inArray`; the predicates live in client-safe / API `_lib` layers. Unifying would either violate layering or pull `types/agent.ts` (out of branch scope) into the change.
- **In-memory drizzle fakes in service vs backfill tests** — similar shape, different tables and predicates; a shared factory would be more opaque than the current local fakes.
- **Capture vs paste-token success responses** — both call `saveAccountToken` but wrap different teardown / status semantics; not the same block.
- **Two-line “Account not found” after `getAccount`** — ownership 404 stays next to the verb that needs the account row; folding it into `requireAccountId` would force every route to load the account even when the service already does ownership.

## Gates

`bun run lint`, `bun run typecheck`, `bun run test:run` — all green after this pass.
