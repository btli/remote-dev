# Task 1 report: CLI spike, dual-credential schema, and account view

## Scope and safety

- Worked only in the `feat/usage-oauth-creds` worktree.
- Inspected only CLI help metadata: `claude --help` and `claude auth login --help`.
  No login was started, no browser was opened, and no Keychain operation or
  credential access occurred.
- Confirmed the approved command choice, `claude auth login`, in
  `CLAUDE_USAGE_OAUTH_LOGIN_COMMAND`; its adjacent comment records why the later
  capture route uses it and still pre-seeds `.claude.json` defensively.
- Did not run `db:push` or contact a live database.

## Files changed

- `src/db/schema.def.ts` — added four nullable additive `claude_account`
  usage-OAuth fields, with encryption, expiry, and open-scope storage docs.
- `src/db/schema.sqlite.ts`, `src/db/schema.pg.ts` — generated from the schema
  definition with `bun run db:codegen`.
- `drizzle/pg/0017_romantic_squadron_supreme.sql`,
  `drizzle/pg/meta/0017_snapshot.json`, and `drizzle/pg/meta/_journal.json` —
  generated PostgreSQL migration artifacts.
- `src/types/claude-limits.ts` — added the token-free `usageCredential` summary
  flag and API documentation.
- `src/services/claude-account-service.ts` — added the direct-login command
  constant and projects `usageCredential` from the encrypted refresh-token
  presence only.
- `src/services/claude-account-service.test.ts` — added true/false projection
  coverage, checks that both encrypted usage token fields are absent from the
  API view, and completed the mocked account-row defaults.

## Red–green TDD record

### Red

Added two `toAccountView` tests before implementation, then ran:

```sh
bun run test:run src/services/claude-account-service.test.ts
```

Expected failure occurred (67 tests total: 65 passed, 2 failed):

```text
AssertionError: expected undefined to be true // Object.is equality
- Expected: true
+ Received: undefined

AssertionError: expected undefined to be false // Object.is equality
- Expected: false
+ Received: undefined
```

The failures were the new `usageCredential` assertions for rows with and without
`usageOauthRefreshEncrypted`.

### Green

Implemented the nullable schema fields, API type/documentation, refresh-token
presence projection, and test-fake defaults. The encrypted access and refresh
fields are intentionally not included in the view object.

Ran:

```sh
bun run test:run src/services/claude-account-service.test.ts src/db/__tests__/codegen-in-sync.test.ts
bun run typecheck
```

Result: 2 test files passed; 69 tests passed. `tsc --noEmit` passed.

## Generated artifacts

Schema generation command and output:

```sh
bun run db:codegen
```

```text
Codegen complete: 83 tables, 883 columns
  src/db/schema.sqlite.ts (83790 bytes)
  src/db/schema.pg.ts     (84455 bytes)
  src/db/schema.ts        (2301 bytes, barrel)
```

PostgreSQL generation command and relevant output (with the required blank
database URL safeguard):

```sh
DATABASE_URL='' bun run db:generate:pg
```

```text
83 tables
claude_account 21 columns 3 indexes 2 fks
[✓] Your SQL migration file ➜ drizzle/pg/0017_romantic_squadron_supreme.sql 🚀
```

The generated migration contains exactly four nullable `ALTER TABLE
claude_account ADD COLUMN` statements for the usage access ciphertext, refresh
ciphertext, expiry, and scopes fields.

## Self-review

- Field names, SQL names, kinds, and nullability match the task brief exactly.
- No foreign keys or unrelated columns were added.
- Usage credential availability is true iff the encrypted refresh value is
  truthy; access-token presence cannot enable it.
- Neither encrypted usage token value is projected by `toAccountView`.
- The command finding is documented at the exported command constant intended
  for the later capture flow.
- `git diff --check` passed.

## Concerns

None. The capture route, Linux file harvest path, and credential refresh flow
belong to later slices and were deliberately not implemented here.
