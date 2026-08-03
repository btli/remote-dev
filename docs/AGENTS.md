# Multi-Agent CLI Support

Remote Dev runs multiple AI coding agents under one roof, each with an isolated,
per-profile environment. This document is the canonical reference for the supported
provider roster, agent profile isolation, per-profile theming, CLI verification, and
a summary of agent-to-agent peer communication.

> Sources of truth: [`src/types/agent.ts`](../src/types/agent.ts),
> [`src/services/agent-cli-service.ts`](../src/services/agent-cli-service.ts),
> [`src/services/agent-profile-service.ts`](../src/services/agent-profile-service.ts).

---

## 1. Supported providers

There are **five** agent providers (the `all` sentinel is a UI/template convenience,
not a runnable provider).

| Provider id | CLI command | Config file | Config dir (rel. to `HOME`) | Required env | Isolation env var |
|-------------|-------------|-------------|-----------------------------|--------------|-------------------|
| `claude` | `claude` | `CLAUDE.md` | `.claude` | `ANTHROPIC_API_KEY` | **none — shared config, see below** |
| `codex` | `codex` | `AGENTS.md` | `.codex` | `OPENAI_API_KEY` | `CODEX_HOME` |
| `gemini` | `gemini` | `GEMINI.md` | `.gemini` | `GOOGLE_API_KEY` | `GEMINI_HOME` |
| `antigravity` | `agy` | `ANTIGRAVITY.md` | `.gemini` (shares Gemini's dir) | `GOOGLE_API_KEY` | `ANTIGRAVITY_HOME` |
| `opencode` | `opencode` | `OPENCODE.md` | `.config/opencode` | _none required_ | `OPENCODE_HOME` |

> **Claude is deliberately NOT config-dir isolated** [remote-dev-n4x4.6].
> `ProfileIsolation` emits no `CLAUDE_CONFIG_DIR`, so every Claude session uses
> the user's real `~/.claude` and they all share one config: the same skills,
> `CLAUDE.md`, MCP servers, settings and agents. A session's Claude *identity*
> comes from an injected `CLAUDE_CODE_OAUTH_TOKEN` instead (see
> [§2 Claude accounts](#claude-accounts-usage-limits--fallback-pools)). The
> variable must stay **unset** rather than be pointed at `$HOME/.claude`: Claude
> Code derives its macOS Keychain service name from the setting, so any explicit
> value lands in a different credential namespace.

Notes confirmed against source:

- **`antigravity`** uses CLI command **`agy`**, config file **`ANTIGRAVITY.md`**, and
  **shares the Gemini config directory** (`.gemini`) while isolating via its own
  `ANTIGRAVITY_HOME`. Its required env is `GOOGLE_API_KEY` (same as Gemini). See
  `PROVIDER_CLI_COMMANDS`, `PROVIDER_CONFIG_FILES`, `PROVIDER_CONFIG_DIRS`, and
  `getRequiredEnvVars()`.
- **`opencode`** has **no required env var** — it supports multiple model providers
  configured in its own config, so `getRequiredEnvVars("opencode")` returns `[]`.

Display names (`PROVIDER_DISPLAY_NAMES`): Claude Code, OpenAI Codex, Gemini CLI,
Antigravity CLI, OpenCode.

> The codex config file is literally named `AGENTS.md`. That is unrelated to *this*
> documentation file (`docs/AGENTS.md`).

### Install instructions & docs

`getInstallInstructions()` and `getProviderDocsUrl()` return per-provider install
commands and documentation links:

| Provider | Install (npm) | Docs |
|----------|---------------|------|
| `claude` | `npm install -g @anthropic-ai/claude-code` | https://docs.anthropic.com/claude-code |
| `codex` | `npm install -g @openai/codex` | https://platform.openai.com/docs/codex-cli |
| `gemini` | `npm install -g @google/gemini-cli` | https://geminicli.com/docs/ |
| `antigravity` | _CLI install currently unavailable — the documented `https://google.dev/antigravity/install` installer URL is 404 (TBD)_ | https://antigravity.google/docs/cli-overview |
| `opencode` | `npm install -g opencode-ai` | https://opencode.ai/docs/ |

> **Package names ≠ binary names.** The npm packages `@openai/codex` and
> `opencode-ai` install the binaries `codex` and `opencode` respectively (the
> bare `@openai/codex-cli` / `opencode` package names are 404 on the registry).
> Antigravity's `agy` CLI has no working published installer at present.

---

## 2. Agent profile isolation

Each **agent profile** gets its own config directory under
`~/.remote-dev/profiles/{profile-id}/`, created by `initializeProfileDirectory()` in
[`agent-profile-service.ts`](../src/services/agent-profile-service.ts). The directory
holds provider configs, an isolated git identity, an SSH dir, and a `.config` root:

```
~/.remote-dev/profiles/{profile-id}/
├── .claude/           # Claude Code config (+ settings.json, CLAUDE.md when provider=claude/all)
├── .codex/            # Codex CLI config (+ AGENTS.md)
├── .gemini/           # Gemini + Antigravity config (+ GEMINI.md / ANTIGRAVITY.md)
├── .config/opencode/  # OpenCode config (+ OPENCODE.md)
├── .config/           # XDG config root
├── .ssh/              # Isolated SSH keys
├── .gitconfig         # Isolated git identity (+ [credential] section)
└── .local/share/      # XDG data root (created via XDG_DATA_HOME)
```

Which provider config files are written depends on the profile's `provider`: a
single-provider profile gets only that provider's dir + config file; a profile with
provider `all` gets every provider's config. Each generated config file is seeded
with a header plus an **`rdv` quick-reference** section so the agent immediately
knows it is running inside Remote Dev (start with `rdv context`).

### Isolation via XDG, not `HOME`

**`HOME` is intentionally NOT overridden.** This lets the user's normal dotfiles
(`.bashrc`, `.zshrc`, etc.) load as usual. Isolation is achieved by overlaying
**XDG** and provider-specific environment variables that redirect config/data paths,
generated by the `ProfileIsolation` value object and surfaced as a
`ProfileEnvironment` (see `getProfileEnvironment()` and the `ProfileEnvironment`
interface in [`src/types/agent.ts`](../src/types/agent.ts)):

| Var | Role |
|-----|------|
| `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` | Redirect config/data/cache into the profile dir |
| `CODEX_HOME`, `GEMINI_HOME`, `ANTIGRAVITY_HOME`, `OPENCODE_HOME` | Per-provider config roots. **`CLAUDE_CONFIG_DIR` is deliberately absent** — Claude shares the real `~/.claude`; identity comes from an injected `CLAUDE_CODE_OAUTH_TOKEN` [remote-dev-n4x4.6] |
| `GIT_CONFIG_GLOBAL`, `GIT_SSH_COMMAND` | Point git at the profile's `.gitconfig` / SSH key |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` | Injected per provider |

### Git identity & secrets

- **Git identity** is stored per profile and written into the profile's `.gitconfig`
  (`setProfileGitIdentity()`), with all values sanitized to prevent git-config
  injection and a `[credential]` section appended to suppress macOS keychain prompts.
- **Profile secrets** can be fetched from a configured secrets provider
  (currently **Phase.dev only** — `SecretsProviderType = "phase"`, which shells
  out to the `phase` CLI) and merged into the profile environment
  (`fetchProfileSecrets()` / `updateProfileSecretsConfig()`); provider config is
  encrypted at rest.

### Profile model & linking

- DB-backed profiles are managed by `getProfiles` / `createProfile` / `updateProfile`
  / `deleteProfile`. Setting a profile as default atomically unsets the previous
  default (transaction-guarded against races).
- A profile can be **linked to a project** (`linkFolderToProfile` /
  `getProjectProfile`), binding that project's agent sessions to the profile via the
  `project_profile_link` table.

### Claude accounts, usage limits & fallback pools

A **Claude account** (`claude_account`) is one Claude subscription (or API key)
and is **independent of any agent profile** (remote-dev-n4x4.6). Every session
shares the user's real Claude config dir — identical skills, `CLAUDE.md`, MCP
servers, settings and agents for all of them — and selects its account by having
`CLAUDE_CODE_OAUTH_TOKEN` injected into its process env. That env var picks the
account per-process independently of `CLAUDE_CONFIG_DIR`, so N accounts run in
parallel with no credential swapping, locking, or restarts. The token is stored
encrypted (AES-256-GCM) on the account row and never leaves the server.

Because the limit belongs to the subscription, usage-limit state
(`claude_usage_limit_state`: 5h/7d window utilization + reset times) and
**fallback pools** (`claude_profile_pool` / `claude_profile_pool_member`, ordered
by rotation priority) both key on `claude_account.id`. A project's
`project_profile_link` references a primary account plus an optional pool, and
`node_preferences` carries an inherited `claudeProfilePoolId` so a pool can be
set at the group level and inherited by its projects. When a `claude` session is
created **without an explicit profile**, the project's account is resolved
server-side (primary → pool rotation to the first available account), its token
is injected, and the id is recorded on `terminal_session.claude_account_id`; the
account's origin profile (when it has one) still supplies the config dir / env
overlay and `RDV_PROFILE_ID`.

**Adding an account** is a single "Add account" action in Settings → Claude
Accounts. It launches a live terminal session running `claude setup-token`; once
the user finishes the browser sign-in, remote-dev captures the printed token,
stores it encrypted, and reads identity from `claude auth status --json`. A
paste-a-token fallback covers remote/PWA use where no local browser exists. There
is no "Sync" step — the old file-reading sync parsed a `.credentials.json` that
never exists on macOS (the CLI writes to the Keychain) and was silently dead.

**Limits are detected two ways.** Reactive detection is always on: when a Claude
session goes idle or ends, its recent scrollback is scanned for the usage-limit
phrase (`ReactiveOutputDetector`), and a hit marks the session's ACCOUNT limited.

A proactive **usage poller** is available but **opt-in** — set
`RDV_CLAUDE_USAGE_POLL_ENABLED=1` (see [`SETUP.md`](./SETUP.md)). When enabled it
sweeps every Claude account about every 10 minutes, reading Anthropic's
structured usage endpoint with that account's stored OAuth token: a free GET
that sends no message and burns no quota. It is opt-in because enabling it makes
the server contact a third party on a timer with stored user credentials, not
because it costs anything. The sweep bounds its concurrency and backs off
exponentially per account after a failure, so a revoked token is not retried
every 10 minutes forever. A 429 with a usable `retry-after` is NOT treated as a
failure: Anthropic rate-limits long-lived setup-token credentials on the usage
endpoint to roughly one read per hour, so the sweep schedules that account's
next attempt just past the reported reset (plus jitter) instead of the
exponential ladder — the dominant path for healthy setup-token accounts. The
once-planned `rdv` Stop-hook limit detector was never built.

**Rotation is model-aware — but only when the poller is enabled**, since it is
the only source of per-model `weekly_scoped` windows (stored per account in
`claude_usage_limit_window`). A Claude subscription can exhaust one model's
weekly window — premium models hard-reject with 429 — while the account-level
status still reads "allowed". When a session requests a model (`--model` in its
resolved agent flags), account selection treats an account with a matching
scoped window as unavailable *for that model* and rotates to a sibling account
with headroom.

Blocking is deliberately narrow, because a wrong block is worse than no block. A
window must be **all** of: `kind = weekly_scoped`, scoped to a model whose family
is in the explicit registry, `critical` or ≥100%, flagged active by the endpoint,
observed within the last hour, and carrying a reset that is still in the future.
Matching is on the endpoint's model display name (`"Fable"`) — the only
per-model identity it reports — case- and whitespace-tolerantly, against known
families only; an unrecognized model never matches anything. Anything else, and
any failure reading the data, leaves the decision exactly account-level. Model
awareness can only ever widen the rejected set for a named, recognized model; it
can never narrow availability by accident. **On a limit**, the
default `notify` mode records the limit and posts a notification; the
notification payload carries a relaunch CTA, **but no client renders an inline
"relaunch" button yet** — so today `notify` mode surfaces a notification only. An
optional per-project **`auto`** mode does work: it spawns a *parallel* session
under an available account (it never force-kills the running one). See
[`API.md`](./API.md) → "Claude accounts, usage limits & pools" and the
`RDV_CLAUDE_USAGE_POLL_ENABLED` flag in [`SETUP.md`](./SETUP.md).

---

## 3. Per-profile appearance / theming

Each profile can carry its own appearance settings, managed by
**`AgentProfileAppearanceService`** and exposed through the profile appearance API
(`ProfileAppearanceSettings` in [`src/types/agent.ts`](../src/types/agent.ts)):

| Setting | Values |
|---------|--------|
| `appearanceMode` | light / dark / system (see appearance types) |
| `lightColorScheme`, `darkColorScheme` | Color scheme id per mode |
| `terminalOpacity`, `terminalBlur` | Glassmorphism tuning |
| `terminalCursorStyle` | `block` \| `underline` \| `bar` |

API (see [`API.md`](./API.md)):

- `GET /api/profiles/:id/appearance` — read appearance settings
- `PUT /api/profiles/:id/appearance` — update mode / schemes / terminal settings
- `DELETE /api/profiles/:id/appearance` — reset to defaults

---

## 4. CLI verification & install instructions

`AgentCLIService` ([`agent-cli-service.ts`](../src/services/agent-cli-service.ts))
verifies whether each agent CLI is installed and resolves its version.

- **`GET /api/agent-cli/status`** returns the status of all five providers:
  `{ statuses[], installedCount, totalCount }`, where each status carries
  `{ provider, installed, version?, command, path?, error? }`.
- Detection runs `which <command>` to find the binary, then tries `<command>
  --version` (falling back to `-v`) and parses a semver-like version out of the
  output; if the binary exists but no version parses, `version` is `"unknown"`.
- When a CLI is missing, the UI (`AgentCLIStatusPanel`) surfaces the per-provider
  install command from `getInstallInstructions()` and the docs link from
  `getProviderDocsUrl()` (tables in [§1](#1-supported-providers)).
- `getRequiredEnvVars()` / `checkRequiredEnvVars()` report which API-key env vars a
  provider needs and which are missing in a given environment.

---

## 5. Agent peer communication (summary)

Agents in the **same project** can discover each other and coordinate. **bd
(beads) tracks the work** (issues, status, assignment); **chat tracks awareness**
— who's-active-right-now, gotchas, heads-ups, and overlap warnings that bd does
not hold. Do **not** duplicate task state in chat.

**Durable delivery — but automatic only for Claude Code.** Each message gets a
per-recipient **durable inbox** row (`message_delivery`) that advances
`pending → delivered → acked`. How an agent *drains* that inbox depends on its
provider, and **automatic delivery is gated to Claude Code**: both the MCP push
and the poll hook are installed only when `provider === "claude"`
(`ensureAgentConfig` in `src/services/session-service.ts` and `installAgentHooks`
in `src/services/agent-profile-service.ts` return early for every other
provider).

- **Claude Code — automatic (push + poll).** Only Claude profiles get the `rdv`
  MCP server and the lifecycle hooks. The MCP server keeps a persistent Unix
  socket and surfaces pushed messages instantly, **acking** each so the server
  marks it delivered; on (re)connect it requests a **replay** of anything it
  missed (compaction, brief disconnect), driven by a durable per-session cursor.
  The PreToolUse hook additionally drains the inbox as a poll fallback. This is
  the only provider with hands-off delivery.
- **Codex, Gemini, OpenCode, Antigravity — manual pull.** These providers have
  **no MCP server and no hooks**, so nothing is pushed to them. They must poll
  their own inbox by running `rdv peer messages` (which reads the same durable
  cursor and auto-acks the batch it returns). Until an agent calls it, queued
  messages simply wait in the durable inbox — there is no automatic delivery.
- **At-least-once, not exactly-once.** Delivery is **at-least-once with
  idempotent de-duplication**: an in-process dedup set (capped at 500 ids,
  `peer-server.ts`) plus the durable cursor prevent re-surfacing, but a
  delivered-but-unacked message can briefly appear twice (see the note below).
  De-dup by message id / timestamp.
- **Channel subscriptions** — a channel's broadcasts auto-deliver only to
  subscribed *Claude* sessions (`#general` is auto-subscribe for all; opt out
  with `direct_only`). Non-subscribers still get **@mentions** and
  replies-to-them; non-Claude providers see channel traffic when they poll.
- **TTL** — awareness chat is ephemeral; messages prune after
  `RDV_CHAT_TTL_DAYS` (default 14), but **never** while an unacked delivery
  remains, so a long-disconnected agent never loses something it hasn't seen.

The `rdv` MCP server is auto-registered into each **Claude Code** profile's
`.claude/settings.json` at session creation (`installAgentHooks()`), alongside
the lifecycle hooks (PreToolUse, PreCompact, Notification, Stop, SubagentStop,
PostToolUse, SessionEnd). MCP tools handle the **write** side (`send_message`,
`send_to_channel`, `set_summary`); read paths go through the `rdv` CLI. Non-Claude
providers use the `rdv peer` / `rdv channel` CLI for both reading and writing.

**Coordination discipline (check in → read peers → check out).** The
*automatic* steps below fire from the lifecycle hooks, so they run hands-off
**only for Claude Code**; agents on the other providers perform the equivalent
by hand (e.g. `rdv peer note`, `rdv peer messages`, `rdv peer summary`).

1. **Check in** (automatic, first PreToolUse) — a structured post to the
   per-project `#agents` channel: *"checked in — branch …, working on …"*.
2. **Read peers** (the **start digest**, printed at session start) — who's
   working on what (branch + claimed bd issue), recent gotchas, and any
   **collision** (another active session on your branch / worktree / claimed
   issue). Read it before acting.
3. **Post gotchas** — when you discover a footgun, `rdv peer note "<body>"`
   (optionally `--kind heads-up|progress`) broadcasts it to `#agents` so it
   surfaces in every peer's next start digest.
4. **Check out** (automatic, on Stop) — *"checked out — branch …"* to `#agents`.

> Note on "acked": the MCP ack means the message was **surfaced to the client**,
> the strongest signal MCP logging affords — not a guaranteed human/agent read.
>
> Because ack means "surfaced," not "consumed," a delivered-but-unacked message
> can briefly **display twice**: once via the live MCP push, and again in the
> next session-start "read peers" digest (the start digest lists
> delivered-but-unacked rows as *New messages*). This is a narrow window when an
> ack is slow or dropped — a duplicate, never a loss. Expect it as **normal
> behavior, not a bug**: de-dup mentally by message id / timestamp and treat the
> two copies as the same message.

For the full design (Unix-socket push relay, internal endpoints, dedup), see the
"Agent Peer Communication" section of [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 6. Session durability & resume (Vault)

When an agent CLI process dies, the terminal server restarts, or the host/pod
restarts, the agent's **conversation** is brought back via the provider's native
resume mechanism — not just an empty tmux pane. The behavior is **declarative**:
a single per-provider registry (`src/lib/agent-resume/agent-resume-registry.ts`)
is the source of truth, consumed by the resume resolver
(`src/infrastructure/agent-resume/AgentResumeResolverImpl.ts`) and wired into
**every** launch path (create, HTTP `RestartAgentUseCase`, WS `restart_agent`,
cold-attach recreate).

### Resume capability matrix

| Provider | Resumes? | Mechanism | Session-id source | Id capture |
|----------|----------|-----------|-------------------|------------|
| `claude` | ✅ | `claude --resume <id>` (flag) | `.jsonl` filename / header `sessionId` under `~/.claude/projects/<encodePath(cwd)>/` (the shared config dir — `CLAUDE_CONFIG_DIR` is unset, and is only honoured if a pre-n4x4.6 session's resume binding still carries it) | Push (Stop hook → `/internal/agent-session-id`) **+** disk fallback |
| `codex` | ✅ | `codex resume <id>` (**subcommand**, argv override) | newest rollout file under `$CODEX_HOME` (default `~/.codex/sessions`) | Disk discovery at relaunch |
| `gemini` | ✅ | `gemini --resume <id>` (flag) | newest checkpoint under `$GEMINI_HOME` (default `~/.gemini/tmp`) | Disk discovery at relaunch |
| `opencode` | ✅ | `opencode --session <id>` (flag) | newest session under `$OPENCODE_HOME` (default `~/.local/share/opencode`) | Disk discovery at relaunch |
| `antigravity` | ❌ | — (no confirmed resume flag) | — | — — relaunches **fresh** (UI marks "Fresh (resume unsupported)") |

Notes:

- **Codex resume is a subcommand, not a flag** — the registry models this with a
  `resume: { kind: "subcommand" }` template that produces a full argv override
  (`["codex","resume","<id>"]`) rather than appended flags.
- **Flag spelling is version-dependent** for gemini/opencode. `verifyResumeFlag()`
  probes the installed CLI's `--help` at startup diagnostics and logs a `warn`
  if the token is missing, so drift is detectable without changing the resolver
  (adjust the registry only).
- **Native id capture asymmetry:** Claude pushes its id in real time via the
  Stop hook; the other providers have no hook system today and rely on **disk
  discovery** (newest session file under the profile-isolated home dir) at
  relaunch.
- **Durable resume binding:** at create time a sanitized resume binding
  (provider + flags + **secrets-stripped** env) is persisted into
  `terminalSessions.typeMetadata.resumeBinding`. After a pod restart this env is
  re-injected into the recreated tmux so the profile-isolated home dir that
  holds the resume files is present. Secrets are never persisted; the agent
  re-resolves API keys from its own profile credential store.

---

## See also

- [`RDV_CLI.md`](./RDV_CLI.md) — `rdv` CLI reference (agent + peer + session commands)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — agent profiles, peer communication, terminal plugin system
- [`API.md`](./API.md) — agent CLI status, profile appearance, and session endpoints
- [`README.md`](./README.md) — documentation index
