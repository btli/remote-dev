---
name: polish
description: Autonomous codebase polish workflow that explores the app, identifies 10+ improvements, plans them into parallel worktrees, dispatches agent teams to implement, runs ship-it review on each, and merges clean PRs to main. Use whenever the user says "polish", "tighten up", "prepare for launch", "production readiness", "clean up for release", "harden", "audit", or "what needs fixing". Accepts an optional focus area — security, admin, observability, UX, performance, accessibility, SEO, billing, brand, error-handling, hardening — or runs a broad scan without one. Always use this skill when the user mentions polishing, hardening, or auditing any part of the application, even if they phrase it casually like "the admin pages need work" or "make sure the billing stuff is solid".
---

# Polish

Autonomous polish workflow. Explore the application, identify rough edges, plan fixes, implement in parallel worktrees, review each branch, and merge to main. This is a non-interactive workflow — never use AskUserQuestion. Research the best approach and use best judgement throughout.

## Focus Areas

The user may provide a focus area as an argument or in their message. Scope exploration accordingly. Multiple areas can be combined. Without a focus area, scan broadly and prioritize the worst gaps.

| Focus | What to Investigate |
|---|---|
| `security` | Auth guards, input validation, CSRF/XSS/SQLi, rate limiting, secret handling, CORS, headers |
| `admin` | Admin panel completeness, role enforcement, impersonation safety, dashboard data accuracy |
| `observability` | Logging coverage, error tracking, metrics, health checks, alerting gaps |
| `performance` | Bundle size, lazy loading, N+1 queries, missing indexes, caching, image optimization |
| `ux` | Loading states, empty states, error states, form validation, mobile responsiveness, navigation |
| `accessibility` | ARIA labels, focus management, keyboard navigation, color contrast, screen reader support |
| `seo` | Page metadata, OG images, structured data, sitemap, canonical URLs, heading hierarchy |
| `billing` | Subscription lifecycle, usage tracking, limit enforcement, cron jobs, cost controls |
| `brand` | Design consistency, font usage, color system, icon library, motion patterns |
| `error-handling` | Try/catch coverage, error boundaries, graceful degradation, user-facing error messages |
| `hardening` | Input sanitization, rate limits, circuit breakers, timeout configs, data validation |
| *(no focus)* | Shallow scan of all areas, prioritize the worst gaps |

## Step 1: Explore

Launch 3 Explore agents in parallel (`subagent_type: "Explore"`), each targeting a different layer. Tailor the specific investigation to the focus area, but the structural split stays the same:

- **Agent 1 — Pages & Routes**: All route groups, page completeness, placeholder content, missing metadata, TODO comments, missing loading/error states
- **Agent 2 — Components & UI**: Brand consistency (fonts, colors, icons, motion), accessibility, responsive behavior, shadcn customization, empty/loading/error state coverage
- **Agent 3 — Backend & Infrastructure**: lib modules, API routes, DB schema, auth flow, error handling, rate limiting, cron jobs, cost controls, security posture

Each agent returns the **15 most important files to read** plus a quality assessment with specific issues.

After agents return, **read the key files yourself**. You need first-hand understanding of the code to make good prioritization decisions. Read at minimum:
- The main layout files (app layout, marketing layout)
- The PHASES.md and BRAND.md docs
- Any files the agents flagged as problematic

## Step 2: Identify Items

Compile a table of **at least 10 concrete improvements**:

```
| # | Item | Severity | Files Affected | Worktree |
|---|------|----------|----------------|----------|
| 1 | Description | Critical/High/Medium | path/to/file.tsx | A |
```

**Severity**:
- **Critical** — Broken functionality, billing bugs, security holes, data loss risk
- **High** — Missing expected features, placeholder content visible to users, poor UX on key flows
- **Medium** — Inconsistencies, missing polish, improvement opportunities

Group items by file affinity into worktree labels (A, B, C...). The rule: no two worktrees modify the same file. This prevents merge conflicts entirely.

## Step 3: Plan

Write a plan to `docs/superpowers/plans/YYYY-MM-DD-polish-<focus>.md`. For each worktree:

- Branch name (`feat/` or `fix/` prefix)
- Which polish items it contains
- Every file to create or modify with specific instructions
- Expected commits

Use TaskCreate to track each worktree as a task, plus a final "ship and merge" task blocked by all worktree tasks.

The plan is the thinking. Do not start implementation until the plan is complete.

## Step 4: Implement

Dispatch all worktrees simultaneously:

```
Agent tool with:
  isolation: "worktree"
  mode: "bypassPermissions"
  run_in_background: true
```

Each agent prompt must be **completely self-contained** because worktree agents have zero context from the parent conversation. Include these in every prompt:

1. **Project rules** — Extract the relevant non-negotiables from CLAUDE.md and include them literally. At minimum: package manager, icon library, font scoping, design tokens, build-time safety rules, naming conventions.
2. **Branch name** — The exact branch to create
3. **Complete task list** — Every file to create/modify with specific, actionable instructions. Include code snippets where the intent might be ambiguous.
4. **Quality gates** — Run typecheck after changes, use conventional commit messages
5. **Constraints** — What NOT to do, per CLAUDE.md (e.g., no npm, no Lucide, no pure black, no module-scope DB calls)
6. **Context files to read first** — Tell the agent which existing files to read before making changes so it understands the current patterns

## Step 5: Ship

After all implementation agents complete, dispatch ship-it agents in parallel — one per worktree. Each agent:

1. Reviews the full diff (`git diff main...HEAD`) for correctness, security, brand consistency, accessibility
2. Fixes all issues found (even minor ones — the review is the quality gate)
3. Runs typecheck + lint
4. Pushes the branch to origin
5. Creates a PR via `gh pr create` with a summary, key decisions, and test plan
6. Does NOT merge — reports completion with PR URL

## Step 6: Merge

After all ship-it agents report completion, merge PRs to main **sequentially** (not in parallel — each merge changes main):

1. Start with the smallest or least-conflict-prone PR
2. Merge: `gh pr merge <number> --merge --admin`
3. If a PR shows conflicts (because main moved from prior merges):
   ```bash
   cd <worktree-path>
   git fetch origin main
   git rebase origin/main
   # Resolve any conflicts
   git push --force-with-lease origin <branch>
   ```
   Then retry the merge.
4. After all PRs merge, pull main and run final verification:
   ```bash
   git checkout main && git pull origin main
   bun run typecheck && bun run lint
   ```
5. Clean up worktrees (`git worktree remove <path> --force`) and delete merged local branches
6. Update `docs/specs/PHASES.md` with a dated "Post-Phase: Polish" section documenting what shipped
7. Commit the docs update on a branch, PR it, merge it

## Red Flags — You're Rationalizing

| Thought | Reality |
|---|---|
| "This codebase is too big to explore properly" | That's why you have 3 parallel explore agents. Use them. |
| "10 items is too many, let me just do 5" | 10 is the minimum. Polish means thoroughness. |
| "I'll skip the plan and just start fixing" | The plan prevents file conflicts between worktrees. Skip it and you'll waste time on merge conflicts. |
| "This worktree agent doesn't need all the project rules" | Worktree agents have ZERO parent context. Include everything or they'll violate conventions. |
| "I'll merge all PRs at once to save time" | Parallel merges cause conflicts. Sequential is correct. |
| "The review step is overkill for small changes" | Small changes have small bugs. The review catches them. |
| "Let me fix this extra thing I noticed" | Stay in scope. Polish items are planned in Step 2. New items go in the next polish run. |
| "Typecheck passed, so it's fine" | Typecheck doesn't catch logic errors, missing error states, or accessibility gaps. Review catches those. |

## Principles

These are the values that produced good results when this workflow was first executed. They're why the steps are ordered the way they are:

- **Autonomy** — Never ask questions. Research the best approach. The user invoked this skill because they want results, not a conversation.
- **Depth over breadth** — 10 well-implemented fixes beat 30 shallow ones. Every fix should be complete with types passing.
- **Plan before code** — The plan is where the real decisions happen. Implementation is mechanical. A thorough plan prevents rework.
- **Parallel execution** — 5 worktrees running simultaneously is dramatically faster than 5 sequential branches. The isolation model (no shared files) makes this safe.
- **Self-contained agents** — Worktree agents have zero parent context. Every prompt must stand alone with all rules, files, and instructions included. Skimping here causes agents to violate project conventions.
- **Ship-it discipline** — Every worktree gets reviewed before merge. The review catches accessibility gaps, missing error handling, stale references, and convention violations that implementation missed.
- **Sequential merges** — PRs merge one at a time because each merge changes main. Trying to merge in parallel causes conflicts. Start with the smallest PR to minimize rebase work.
