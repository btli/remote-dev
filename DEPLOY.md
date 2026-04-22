# Deployment

## Production deploy

Pushes to `master` automatically trigger `.github/workflows/deploy.yml`,
which POSTs to a webhook at `$DEPLOY_URL/api/deploy` (configured via
the `DEPLOY_URL` repo variable and `DEPLOY_WEBHOOK_SECRET` /
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` secrets). The target
server pulls the new commit, rebuilds, and restarts.

### Verifying a deploy

1. Watch the run: `gh run list --repo btli/remote-dev --workflow "Deploy to Production" --limit 5`.
2. Expected webhook response: HTTP 202 ("Deploy triggered successfully"). HTTP 409 means a deploy is already in progress. Anything else fails the job.
3. Once the server finishes, hit the app to confirm the new code is live (header, version, or a feature you just shipped).

### Manual triggers

- `bun run deploy` — runs `scripts/deploy.ts` locally (if you have the right credentials).
- `bun run deploy:status` — check current deploy state.
- `bun run deploy:rollback` — roll back the last deploy.
- `gh workflow run "Deploy to Production" --repo btli/remote-dev` — trigger the webhook workflow without a commit.

### Troubleshooting

- **502 from webhook**: the deploy target is offline. Check the host (currently `dev.bryanli.net`) is up; restart the deploy service there. The GitHub workflow cannot self-heal this.
- **401/403 from webhook**: `DEPLOY_WEBHOOK_SECRET` or Cloudflare Access creds are stale. Rotate in the repo secrets.
- **Deploy succeeds but app is stale**: browser / CDN cache; hard-refresh. If persistent, check the server logs on the target host.

## Electron distributables

The Electron desktop app is a separate distribution channel.

- `bun run electron:dist:mac` / `:linux` / `:win` — build a platform distributable.
- Tag-push (`vX.Y.Z`) triggers `.github/workflows/release.yml` for a GitHub Release with auto-update artifacts.
- The in-app auto-updater checks GitHub releases; nothing manual required on the user side once a tag is published.
