# Project Migration (Instance → Instance)

> Move a project from one Remote Dev instance to another over HTTPS. The
> **source** pushes; the **destination** receives. Useful when consolidating
> instances, moving a project from a laptop to a homelab instance, or
> retiring a machine.

## Concepts

- **Peer instance** — a destination registered on the source under
  **Settings → Instances**: a name, a base URL, and an API key created on the
  destination (Settings → Mobile → API keys). Credentials are encrypted at
  rest and never shown again after saving (reads only see a masked preview).
  If the destination sits behind Cloudflare Access, add its **service token**
  (Client ID + Secret) in the collapsible section of the same dialog.
- **Migration job** — one push of one project. Lifecycle:
  `pending → running → db_done → files_done → verifying → completed`
  (with `failed` / `aborted` as terminal escapes). The destination imports
  everything in a single transaction and **verifies** row counts before the
  job is declared complete; on failure or abort it rolls the import back.
- Jobs run **server-side**: closing the dialog does not stop one. Watch or
  abort from Settings → Instances → *Recent migrations*, or with the CLI.

## Starting a migration

**Web UI:** right-click a project in the sidebar → **Migrate to instance…**
Pick the destination peer (use **Test** to live-verify reachability +
capability version), choose a working-tree mode, review the toggles, then
**Start migration**. The dialog shows phase + progress and offers **Abort**.

**CLI** (`rdv` runs on the source instance — no extra env needed):

```bash
rdv migrate peers                                  # list registered destinations
rdv migrate preview --project-id <id> --mode full_tar
rdv migrate run --project-id <id> --peer homelab   # watches by default
rdv migrate status <job-id>
```

`rdv migrate run` flags: `--mode full_tar|git_essentials|none`,
`--remove-source`, `--no-env`, `--no-agent-creds`, `--ssh-keys`,
`--no-agent-settings`, `--channel-history`, `--watch=false` (fire-and-forget).
With watch on (default) the command exits non-zero if the job fails or is
aborted.

## Working-tree modes

| Mode | What travels |
|------|--------------|
| **Full copy** (`full_tar`, default) | The whole working tree, minus heavy caches (`node_modules`, `.next`, `dist`, build/venv caches, …) |
| **Git clone + essentials** (`git_essentials`) | `.git` plus uncommitted changes — the destination restores the rest from git |
| **No files** (`none`) | Database records only — re-clone the repository on the destination |

The dialog shows an estimated size per mode (the preview endpoint ships with
the file-transfer stage; older instances show "preview unavailable").

## Toggles

| Toggle | Default | Covers |
|--------|---------|--------|
| Environment files | **on** | `.env` / `.env.local` in the working tree |
| Agent credentials | **on** | Stored provider API keys (project + linked profile secrets) — decrypted for transport over the authenticated HTTPS channel and re-encrypted under the destination's own secret |
| SSH keys | **off** | Profile SSH keys |
| Agent settings | **on** | MCP servers, per-agent configs, profile JSON settings |
| Channel history | **off** | Inter-agent channel/peer messages (channel structure always travels) |
| Remove from source after verification | **off** | Deletes the source project (and closes its sessions) only after the destination verifies a clean import. Working-tree files on the source disk are not deleted. |

## What moves / what doesn't

**Moves:** the project row, node preferences, tasks + dependencies, channels
(history opt-in), MCP servers, agent configs, the linked agent profile (git
identity, appearance, JSON configs, secrets per the toggles), trigger
configs, agent schedules, secrets-provider configs, and working-tree files
per the selected mode. GitHub repo/account linkage travels as **relink
hints** (repo id + login — never tokens) and is re-attached only when the
destination has the same repo/account linked.

**Doesn't move:**

- **Sessions.** Terminal/agent sessions (and their tmux state, run history,
  and stats caches) stay on the source. Start fresh sessions on the
  destination.
- **Claude Code macOS Keychain credentials.** Claude Code stores its OAuth
  token in the macOS Keychain, which no migration can read or transplant —
  run `claude login` on the destination, or set `ANTHROPIC_API_KEY` there.
  Other agent CLIs may likewise need a one-time re-login if they keep
  host-bound state outside the profile directory.
- **GitHub tokens.** Only relink hints travel; link the GitHub account on
  the destination if it isn't already.

**Arrives disabled:** imported **triggers and agent schedules** land disabled
(schedules also paused) so nothing double-fires while both copies of the
project exist. Re-enable them on the destination once you retire the source
copy.

**Conflicts:** if the project id (or working directory path) is already taken
on the destination, the import remaps it (directories get `-2`/`-3`
suffixes) and records a note in the job's **conflict report**, visible in the
result step and in Settings → Instances → Recent migrations.

## Troubleshooting

- **"Peer unreachable" / HTTP 401 on Test** — re-check the base URL and the
  API key (create a fresh one on the destination); behind Cloudflare Access,
  set the service token fields.
- **Job failed mid-flight** — the destination rolls back its partial import;
  the source project is untouched. Fix the cause (the job's error message is
  shown in the dialog and job list) and run it again.
- **Stuck job** — jobs with no progress for 2 hours are automatically marked
  failed at server startup; you can also Abort any non-terminal job.
