# Kimi Agent Provider — Specification

**Date:** 2026-08-04
**Status:** Approved
**Issue:** `remote-dev-mv99`
**Implementation plan:** session plan (approved 2026-08-04), slices below

## Summary

Remote Dev supports Claude, Codex, Gemini, Antigravity, OpenCode, and Cursor as launchable agent providers. This change adds **Kimi** (Moonshot AI's Kimi Code CLI, command `kimi`) as a first-class provider with full parity: type registries, CLI detection, session resume, relaunch, lifecycle hooks that drive the activity-status pipeline, web and mobile UI, Docker dev image, and documentation.

It also removes the dedicated **"New Cursor Agent"** shortcuts from the web project context menu and the mobile new-session sheet. Those shortcuts predate the generic provider pickers and incorrectly elevate one provider; Cursor, like Kimi, launches via **Pick Agent ▸** (web) and the Type→Agent provider dropdown (mobile).

## Evidence

All Kimi CLI behavior below is taken from the official documentation, verified 2026-08-04:

- Command is `kimi`; install via `npm install -g @moonshot-ai/kimi-code`; docs root `https://www.kimi.com/code/docs/en/` ([FAQ](https://www.kimi.com/code/docs/en/kimi-code/faq.html)).
- Resume: `kimi --session <id>` (`-S`; bare `--session` opens an interactive selector; `-r`/`--resume` is a hidden alias). `kimi --continue`/`-c` continues the most recent session in the cwd ([kimi command reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html)).
- Auto-approving flags: `-y`/`--yolo` (hidden aliases `--yes`, `--auto-approve`) and `--auto`. These skip human approval and are treated as dangerous flags.
- Data root is `KIMI_CODE_HOME` (default `~/.kimi-code`). Sessions live at `sessions/<workDirKey>/<sessionId>/`, and a top-level `session_index.jsonl` holds one JSON record per line containing `sessionId`, `sessionDir`, and `workDir` — enabling project-scoped resume discovery by filtering `workDir === projectPath` ([data locations](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/data-locations.html)).
- Auth is OAuth (`kimi login`, device-code flow) or an API key in `config.toml`; no environment variable is required to launch.
- Kimi reads `AGENTS.md` (global at `$KIMI_CODE_HOME/AGENTS.md`, project-level at the repo root).
- Hooks: rules live in the `[[hooks]]` array of `$KIMI_CODE_HOME/config.toml` with exactly four allowed fields — `event`, `matcher` (regex), `command`, `timeout`; any extra field fails config load. Event payloads arrive as JSON on stdin (`hook_event_name`, `session_id`, `cwd`, plus event-specific fields). Exit code 0 allows, 2 blocks, anything else fails open. Hook commands run with the session project directory as cwd ([Hooks](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html)).

Current-state evidence in this repo:

- Only Claude has live hook integration. Every hook gate returns early for non-Claude providers (`src/services/agent-profile-service.ts:741,913`, `src/services/session-service.ts:2136`). Codex lifecycle support (`remote-dev-dexs`) is spec/plan-only; none of its artifacts exist yet.
- Cursor's integration (commits `4dcebee7`, `4f21a174`, `a9623f0c`, `4cccfbe2`) defines the parity surface for a new provider.
- The "New Cursor Agent" items live at `src/components/session/project-tree/ProjectContextMenu.tsx` (both the plain-button test variant and the real context menu) and `mobile/lib/presentation/screens/sessions/new_session_sheet.dart`.

## Goals

1. `kimi` is a valid `AgentProviderType` everywhere the union and provider registries are consumed, in both `src/types/session.ts` and the parity-tested `packages/domain` mirror.
2. The agent-CLI status API detects `kimi`, reports its version, and offers install instructions and a docs URL.
3. Users can launch Kimi from Pick Agent ▸ (web sidebar + project context menu) and from the mobile provider dropdown. Uninstalled providers remain visible but disabled.
4. Resume parity: the Resume modal lists Kimi sessions for the active project (discovered from `session_index.jsonl`, scoped by `workDir`), and relaunch builds `kimi --session <id>`, re-injecting `KIMI_CODE_HOME` when bound.
5. Lifecycle hooks: Kimi sessions report `running`, `subagent`, `compacting`, `waiting`, `idle`, `error`, and `ended` through the existing `rdv hook` → `POST /internal/agent-status` pipeline, so sidebar status chips, browser notifications, and liveness behavior match Claude.
6. Hook installation preserves user-authored `[[hooks]]` rules, is idempotent across re-install/upgrade, and never writes fields outside Kimi's allowed four.
7. "New Cursor Agent" shortcuts are removed from the web project context menu and the mobile new-session sheet; Cursor remains launchable through the generic pickers.
8. The dev container image ships the Kimi CLI alongside the other agent CLIs.
9. All enumerating tests and parity tests pass with the new provider; new tests cover Kimi discovery, hooks writing, and relaunch.

## Non-goals

- A dedicated Kimi quick-start card in `NewSessionWizard.tsx` or any provider-specific menu shortcut. Kimi lives in the generic pickers only.
- Cursor-style identity fingerprinting (`matchesProviderIdentity`, verified-executable plumbing). `kimi` is a distinctive executable name; the default trust path is sufficient.
- Hook runtime health/trust diagnostics and the durable normalized lifecycle ledger/outbox — those belong to `remote-dev-dexs.1`/`.2`. When the dexs adapter registry lands, the Kimi hook wiring migrates to it.
- MCP config parsing, model/usage-limit accounting, or LiteLLM proxy injection for Kimi.
- Changes to the mobile session-view or terminal surfaces beyond provider labels and the removed shortcut.
- Blocking `Stop` hook behavior for Kimi (e.g. beads continuation). Claude's plain-text continuation codec is Claude-specific; Kimi `Stop` hooks report `idle` and exit 0.

## Architecture

### Provider registration

`kimi` is added to every provider-keyed registry: `AgentProviderType`, `AGENT_PROVIDERS` (`command: "kimi"`, `configFile: "AGENTS.md"`, `dangerousFlags: ["-y", "--yolo", "--yes", "--auto-approve", "--auto"]`), `AgentPreset`/`AGENT_PRESETS`, `LOOP_AGENT_PROVIDERS` (`src/types/session.ts` + `packages/domain` mirror), `src/types/agent.ts`, `AGENT_VISUALS` (Moon icon, blue palette), `NewAgentSubmenu` provider lists, `AgentCLIStatusPanel`, `TriggersSection.PROVIDER_OPTIONS`, mobile `_labels`, and the Rust clap help strings. No DB migration is needed: `agent_provider` columns are free text with `$type<AgentProviderType>()` branding that follows the union.

**Profile stance (amended after review):** Kimi follows the Claude model — sessions always use the real kimi home (`$KIMI_CODE_HOME`, default `~/.kimi-code`), even when a profile is bound, and `ProfileIsolation` deliberately does **not** emit `KIMI_CODE_HOME`. Kimi profiles are out of scope (the profile system's `VALID_PROVIDERS` does not include kimi, and no per-profile kimi config tab exists). This unifies hook installation, resume discovery, and relaunch on one home location.

### Resume

A new `kimi` entry in `AGENT_RESUME_REGISTRY` uses a bespoke disk scanner (`listKimiSessionIds`) that reads `$KIMI_CODE_HOME/session_index.jsonl`, keeps records whose `workDir` equals the session's project path, validates session-id safety, and returns ids newest-first. Relaunch uses `resume: { kind: "flag", token: "--session" }`. `KIMI_CODE_HOME` joins the resume-binding safe allowlist and the `/api/agent/sessions` env-override handling, mirroring `CURSOR_DATA_DIR`.

### Lifecycle hooks (Path A: current wired path)

Kimi joins Claude on the existing hook path (Codex's provider-neutral ingestion is unimplemented; see Non-goals). The provider gates in `installAgentHooks`, `validateAgentHooks`, and `ensureAgentConfig` admit `claude | kimi`. A new writer manages the `[[hooks]]` array of `$KIMI_CODE_HOME/config.toml`: rdv-managed blocks (identified by their `rdv hook` command marker and a `# rdv-managed` header comment) are replaced wholesale; all user blocks are preserved verbatim; writes are atomic.

Event→status mapping:

| Kimi event | rdv command | Status |
|---|---|---|
| `SessionStart` | `rdv hook kimi session-start` | `running` |
| `UserPromptSubmit` | `rdv hook kimi prompt-submit` | `running` |
| `PreToolUse` | `rdv hook kimi pre-tool-use` | `running` |
| `SubagentStart` | `rdv hook kimi subagent-start` | `subagent` |
| `SubagentStop` | `rdv hook kimi subagent-stop` | `running` (`source=subagent-stop`) |
| `PermissionRequest` | `rdv hook kimi permission-request` | `waiting` |
| `PreCompact` | `rdv hook kimi compacting` | `compacting` |
| `PostCompact` | `rdv hook kimi running` | `running` |
| `Stop` | `rdv hook kimi stop` | `idle` |
| `StopFailure` | `rdv hook kimi stop-failure` | `error` |
| `Interrupt` | `rdv hook kimi interrupt` | `idle` |
| `SessionEnd` | `rdv hook kimi session-end` | `ended` |

Each command uses the existing `rdvOrCurlCommand` shape (`if command -v rdv … else curl /internal/agent-status?…`) so hooks still report when `rdv` is not on PATH. `crates/rdv` gains a `kimi <event>` arm mirroring the `claude <event>` unified handler, keeping the `source=subagent-stop` ordering guard. Kimi `Stop` never emits blocking output (exit 0 always).

## User Experience Contract

| Situation | Behavior |
|---|---|
| Kimi CLI not installed | Pick Agent rows show Kimi disabled with "Not installed"; Settings → Agents shows install instructions (`npm install -g @moonshot-ai/kimi-code`) and the docs link |
| Launch from Pick Agent | New agent session opens in the project cwd running `kimi`; status chip shows `running` once `SessionStart` fires |
| Agent waits for approval | `PermissionRequest` hook → status `waiting` → existing browser/push notification |
| Turn completes | `Stop` hook → status `idle` → sidebar chip updates; server notifications fire for `waiting`/`error` only |
| Turn fails | `StopFailure` hook → status `error` → error notification |
| User interrupts (Esc) | `Interrupt` hook → status `idle` |
| Session ends | `SessionEnd` hook → status `ended` |
| Resume modal on a project with Kimi history | Kimi sessions appear alongside other providers; selecting one relaunches `kimi --session <id>` |
| Right-click project (web) | No "New Cursor Agent" item; "Pick Agent ▸" lists all providers including Cursor and Kimi |
| Mobile new-session sheet | No "New Cursor Agent" button; Type → Agent shows the provider dropdown |

## Risks and Mitigations

- **`config.toml` parse fragility.** The writer edits user config. Mitigation: line-oriented block replacement keyed on the rdv marker, never a full re-serialization; invalid or surprising content leaves user blocks untouched; atomic tmp→rename write.
- **`session_index.jsonl` record drift.** If Kimi changes the index shape, discovery degrades to "no sessions found" rather than erroring. Mitigation: tolerate missing fields per line, skip malformed lines.
- **Duplicate hook delivery.** Hooks are fire-and-forget; the existing monotonic `agentActivityStatusAt` guard and the `subagent-stop` ordering rule already make repeated status writes safe.
- **Hidden alias drift (`-r`/`--resume`).** We launch with the documented `--session` token only.

## Verification

- `npx vitest run` over all touched suites; repo typecheck and lint.
- `cd mobile && flutter test`.
- `cd crates/rdv && cargo test` (kimi hook arms).
- Manual smoke with `kimi` installed: launch via Pick Agent, observe running → idle transitions in the sidebar, approval → waiting, Resume modal listing.
