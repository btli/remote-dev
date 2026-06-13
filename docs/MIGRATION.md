# Project Migration (Instance → Instance)

> Move a project from one Remote Dev instance to another over HTTPS. The
> **source** pushes; the **destination** receives. Useful when consolidating
> instances, moving a project from a laptop to a homelab instance, or
> retiring a machine.

## Concepts

- **Peer instance** — a destination registered on the source under
  **Settings → Instances**: a name, a base URL, and an API key created on the
  destination (open the destination's **Settings → Mobile** and click **New
  API Key**, for the user who will own the migrated project). Credentials are
  encrypted at rest and never shown again after saving (reads only see a
  masked preview). If the destination sits behind Cloudflare Access, add its
  **service token** (Client ID + Secret) in the collapsible section of the
  same dialog.
- **Migration job** — one push of one project. Lifecycle:
  `pending → running → db_done → files_done → verifying → completed`
  (with `failed` / `aborted` as terminal escapes). The destination imports
  everything in a single transaction and **verifies** row counts before the
  job is declared complete; on failure or abort it rolls the import back.
- Jobs run **server-side**: closing the dialog does not stop one. Watch or
  abort from Settings → Instances → *Recent migrations*, or with the CLI.

## Prerequisites

Before a migration can succeed, the **destination** must be set up first —
most "I can't migrate" problems are a missing one of these:

1. **The destination instance already exists and is reachable** at its base
   URL from the source machine.
2. **Your account exists on the destination**, and you have **created an API
   key there** (its **Settings → Mobile → New API Key**) for the user who will
   own the migrated project. Paste that key into the source's **Settings →
   Instances → Add instance**. The key is created on the *destination*, not
   the source.
3. **Cloudflare Access service token (off-LAN only).** If the destination is
   reached through Cloudflare Access (e.g. over the public internet), the
   server-to-server call needs a **CF Access service token** (Client ID +
   Secret) saved on the peer, otherwise the edge bounces the request to a
   login page. On-LAN destinations that bypass Access don't need one.
4. **Shape B base URL includes the instance slug.** For an instance hosted
   behind the supervisor router, the base URL must include its path prefix,
   e.g. `https://rdv.joyful.house/homelab` (not just `https://rdv.joyful.house`).

Use **Test** (Settings → Instances, or the Migrate dialog) to confirm all of
the above before starting a transfer — it runs a live capability check with
the stored credential and reports exactly what's wrong.

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

Test connection and migration jobs now surface specific, actionable messages.
Map the message to the fix:

| Message contains… | Cause | Fix |
|-------------------|-------|-----|
| **rejected the API key (401)** | The destination didn't accept the key | Create an API key **on the destination** (its Settings → Mobile → New API Key) for **your** user and paste it exactly — no stray whitespace. |
| **not found (404) … instance path prefix** | Base URL is missing the Shape B slug | Set the base URL to include the instance prefix, e.g. `https://rdv.joyful.house/homelab`. |
| **unexpected redirect … Cloudflare Access** / **expected JSON but got text/html … login page** | The request hit a Cloudflare Access / OIDC login wall instead of the API | Add a **CF Access service token** (Client ID + Secret) to the peer (off-LAN destinations), or verify the base URL points at the instance and not a login page. |
| **Client ID is set but the Client Secret is missing** (or vice-versa) | Only one half of the CF service token was saved | Re-save the peer with **both** the Client ID and Secret, or clear both. |
| **API key cannot be decrypted** | `AUTH_SECRET` on the source changed since the peer was registered | Re-register the peer (re-enter its API key). |

Other notes:

- **Job failed mid-flight** — the destination rolls back its partial import;
  the source project is untouched. Fix the cause (the job's error message is
  shown in the dialog and job list) and run it again.
- **Stuck job** — jobs with no progress for 2 hours are automatically marked
  failed at server startup; you can also Abort any non-terminal job.
