---
name: process-feedback
description: Process tester feedback from the AskCV production database. Use this skill when the user mentions feedback, tester reports, user complaints, UX issues from testers, or wants to work through feedback items. Also use when the user runs /process-feedback. This skill covers the full lifecycle — querying the DB, triaging items, evaluating whether feedback is actionable, getting user approval on ambiguous items, fixing issues in worktrees, and marking feedback resolved.
---

# Process Tester Feedback

This skill handles the end-to-end workflow for processing feedback submitted by testers via the in-app feedback chatbot. Feedback lives in the `tester_feedback` table in the production Neon Postgres database.

## Why This Matters

Tester feedback is the primary signal for UX issues before public launch. But not all feedback is equal — some items are clear bugs, some are subjective preferences, and some are misunderstandings. Your job is to triage intelligently, not blindly implement every request.

## Step 0: Load Sprint Context

Before processing feedback, check the active sprint:

```bash
source /Users/bryanli/Projects/askcv.ai/.env.local && psql "$DATABASE_URL" -c "
  SELECT id, name, status, milestone_tag, start_date, end_date,
    (SELECT COUNT(*) FROM tester_feedback WHERE sprint_id = fs.id) as item_count
  FROM feedback_sprints fs
  WHERE status IN ('planning', 'active')
  ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, start_date ASC;"
```

If an active sprint exists, prioritize items assigned to that sprint. Use the sprint context to inform your triage decisions — items aligned with the active sprint's milestone get higher priority.

## Step 1: Query Unresolved Feedback

Pull all `new` feedback items from prod. The DATABASE_URL is in `.env.local` at the project root.

```bash
source /Users/bryanli/Projects/askcv.ai/.env.local && psql "$DATABASE_URL" -c "
  SELECT id, category, status, title, description, page_url,
         screenshot_url IS NOT NULL as has_screenshot,
         jsonb_typeof(metadata->'diagnostics') IS NOT NULL as has_diagnostics,
         jsonb_array_length(coalesce(metadata->'diagnostics'->'errors', '[]'::jsonb)) as error_count,
         jsonb_array_length(coalesce(metadata->'diagnostics'->'failedRequests', '[]'::jsonb)) as failed_request_count,
         created_at
  FROM tester_feedback
  WHERE status = 'new'
  ORDER BY created_at ASC;"
```

If no items are found, report that and stop.

## Step 2: Triage Each Item

For each feedback item, gather the full context before deciding what to do:

1. **Read the conversation history** — the chatbot captures the back-and-forth with the tester
2. **View the screenshot** — if `screenshot_url` is not null, fetch it and visually inspect it
3. **Identify the affected page/component** — use the `page_url` to find the relevant source files
4. **Read the relevant source code** — understand what the tester is seeing and why
5. **Read the diagnostic context** — the `metadata.diagnostics` field contains:
   - `errors`: Recent JS errors with stack traces — check if the feedback correlates with an actual error
   - `console`: Recent console.error/warn entries — often reveals the root cause
   - `failedRequests`: API requests that failed or were slow (>2s) — check if the issue is a backend problem
   - `recentRequests`: Last 30 API requests (method, path, status, duration) — network timeline leading up to the report
   - `longTasks`: Main-thread tasks >100ms — relevant for "felt slow/frozen" reports
   - `navigation`: Route history leading up to the feedback — understand the user's journey

   If diagnostics show actual JS errors or failed API calls, this is likely a real bug (not a UX preference).
   If diagnostics show long tasks, correlate with "performance" category feedback.
   If navigation shows the user bounced between pages, the issue may be cross-page rather than page-specific.

6. **Check for element metadata** — if `metadata.elementSelection` exists, it contains:
   - `selector`: CSS selector for the exact element the user pointed to
   - `tagName`, `id`, `classList`: Element identification
   - `textContent`: Truncated visible text of the element
   - `parentPath`: DOM breadcrumb showing where in the component tree the element lives
   - `computedStyles`: Current visual styles (color, background, font-size, display, visibility)
   - `dataAttributes`, `ariaLabel`, `role`: Semantic info

   Use the `selector` and `parentPath` to locate the exact React component in the source code.
   The `computedStyles` tell you what the user actually saw — compare against BRAND.md expectations.

```bash
source /Users/bryanli/Projects/askcv.ai/.env.local && psql "$DATABASE_URL" -c "
  SELECT conversation_history, screenshot_url, screenshot_urls, metadata,
         metadata->'diagnostics'->'errors' as js_errors,
         metadata->'diagnostics'->'failedRequests' as failed_requests,
         metadata->'diagnostics'->'console' as console_entries,
         metadata->'diagnostics'->'navigation' as nav_history,
         metadata->'elementSelection' as element_selection
  FROM tester_feedback
  WHERE id = '<feedback-id>';"
```

## Step 2.5: AI Priority Scoring

For each item, assess priority using these criteria:

1. Read `docs/specs/ROADMAP.md` and `docs/specs/PHASES.md` for strategic context
2. Score each item:
   - **Priority**: p0 (blocks alpha/data loss), p1 (high impact on core loop), p2 (medium), p3 (cosmetic)
   - **Effort**: xs (<30min), s (30min-2hr), m (2-4hr), l (4-8hr), xl (>8hr)
   - **Alignment**: high (supports alpha/beta priorities), medium (supports differentiation), low (tangential)

3. Save suggestions:

```bash
source /Users/bryanli/Projects/askcv.ai/.env.local && psql "$DATABASE_URL" -c "
  UPDATE tester_feedback
  SET ai_priority_suggestion = '<priority>',
      ai_effort_suggestion = '<effort>',
      ai_alignment_suggestion = '<alignment>',
      ai_scoring_rationale = '<one sentence rationale>',
      updated_at = NOW()
  WHERE id = '<feedback-id>';"
```

Bryan will confirm or override these suggestions in the admin UI.

## Step 3: Evaluate the Feedback

This is the critical thinking step. For each item, classify it:

### Clear and Actionable
The feedback describes a real issue with a clear fix. Examples:
- Text wrapping or alignment bugs (visual proof in screenshot)
- Broken links or missing functionality
- Wrong data displayed
- Accessibility issues

**Action**: Proceed to fix.

### Ambiguous or Subjective
The feedback is a preference or the right approach isn't obvious. Examples:
- "I think the colors should be different"
- "This section feels cluttered" (but follows the design system)
- Feature requests that may conflict with existing decisions
- UX suggestions that trade off against other concerns

**Action**: Use `AskUserQuestion` to present the feedback to Bryan with your analysis and a recommendation. Include:
- What the tester said
- What the current code does and why
- Whether it aligns with or contradicts BRAND.md / design conventions
- Your recommendation (fix, ignore, or defer)

### Invalid or Won't Fix
The feedback is based on a misunderstanding, is already-fixed, or conflicts with intentional design decisions. Examples:
- "This should work like [competitor]" — when the current behavior is intentional
- Feedback about a feature that's intentionally disabled for their tier
- Duplicate of already-resolved feedback

**Action**: Use `AskUserQuestion` to confirm with Bryan before marking as `wontfix`. Never unilaterally dismiss feedback.

## Step 4: Fix in a Worktree

For each approved fix, follow the project's standard workflow:

0. **Acquire checkout lock** before starting work:

   ```bash
   source /Users/bryanli/Projects/askcv.ai/.env.local && psql "$DATABASE_URL" -c "
     UPDATE tester_feedback
     SET checked_out_by = 'agent-process-feedback',
         checked_out_at = NOW(),
         updated_at = NOW()
     WHERE id = '<feedback-id>'
       AND (checked_out_at IS NULL OR checked_out_at < NOW() - INTERVAL '2 hours')
     RETURNING id, checked_out_by;"
   ```

   If 0 rows returned, the item is locked by another agent — skip it.

1. **Create a worktree**:
   ```bash
   git worktree add .claude/worktrees/fix-feedback-<short-name> -b fix/<descriptive-name>
   ```

2. **Make the fix** in the worktree. Follow all project conventions:
   - Read `docs/architecture/BRAND.md` if it's a UI change
   - Check `docs/architecture/COMPONENTS.md` for existing utilities
   - Use existing patterns (e.g., `font-mono` not `font-[family-name:var(--font-mono)]`)

3. **Typecheck**: `bun run typecheck`

4. **Commit** with a conventional commit message referencing the feedback ID:
   ```
   fix: <description>

   Resolves tester feedback: <feedback-uuid>
   ```

5. **Push and create PR** via `gh pr create`

6. **Follow the merge checklist**:
   - Run code-simplifier agent on changed files
   - Commit simplifier changes
   - Run pr-review-toolkit:code-reviewer agent
   - Fix all issues
   - Create `.merge-ready` file
   - Merge the PR

## Step 5: Mark Feedback Resolved

After the fix is merged and deployed:

```bash
source /Users/bryanli/Projects/askcv.ai/.env.local && psql "$DATABASE_URL" -c "
  UPDATE tester_feedback
  SET status = 'resolved', dev_status = 'done',
      checked_out_by = NULL, checked_out_at = NULL,
      updated_at = NOW()
  WHERE id = '<feedback-id>'
  RETURNING id, status, dev_status, updated_at;"
```

For items marked `wontfix` (with Bryan's approval):

```bash
source /Users/bryanli/Projects/askcv.ai/.env.local && psql "$DATABASE_URL" -c "
  UPDATE tester_feedback
  SET status = 'wontfix', dev_status = 'wontfix',
      checked_out_by = NULL, checked_out_at = NULL,
      updated_at = NOW()
  WHERE id = '<feedback-id>'
  RETURNING id, status, dev_status, updated_at;"
```

## Step 6: Clean Up

After all items are processed:
- Remove worktrees: `git worktree remove .claude/worktrees/fix-feedback-*`
- Pull latest main: `git pull`
- Report a summary: how many items processed, fixed, deferred, rejected

## Red Flags — You're Rationalizing

| Thought | Reality |
|---|---|
| "This feedback is just a preference, I'll skip it" | Present it to Bryan. Never unilaterally dismiss. |
| "I know what they mean, I don't need to read the conversation" | The conversation has context you can't guess. Read it. |
| "The screenshot isn't important" | Screenshots are evidence. If it exists, look at it. |
| "I'll batch all fixes into one PR" | Group by file affinity, not by convenience. Separate PRs for separate areas. |
| "This is a wontfix" | Only Bryan decides wontfix. Use AskUserQuestion. |
| "I'll fix this differently than what they asked" | Understand the request first. Then decide on implementation. |
| "The current behavior is intentional" | Confirm by reading the code and checking BRAND.md / design docs. Don't assume. |

## Batch Processing

When multiple feedback items exist, process them efficiently:
- Group items that affect the same page/component into a single worktree/PR
- Process independent items in parallel when possible (separate worktrees)
- Present all ambiguous items to the user at once rather than one-by-one interruptions

## Database Schema Reference

```sql
tester_feedback (
  id                       UUID PRIMARY KEY,
  tenant_id                TEXT NOT NULL,        -- userId of the tester
  page_url                 TEXT NOT NULL,        -- URL where feedback was submitted
  category                 TEXT NOT NULL,        -- bug, ux, feature_request, performance, content, other
  title                    TEXT NOT NULL,        -- AI-generated summary
  description              TEXT NOT NULL,        -- AI-generated structured description
  screenshot_url           TEXT,                 -- Vercel Blob URL (may be null)
  status                   TEXT NOT NULL,        -- new, reviewed, resolved, wontfix
  conversation_history     JSONB NOT NULL,       -- [{role, content}] from the chatbot
  metadata                 JSONB,                -- Browser info, viewport, etc.
  created_at               TIMESTAMP NOT NULL,
  updated_at               TIMESTAMP NOT NULL,

  -- Dev lifecycle
  dev_status               TEXT NOT NULL,        -- triage, backlog, sprint, in_progress, in_review, done, wontfix
  sort_order               INTEGER NOT NULL,     -- ordering within kanban columns
  sprint_id                UUID,                 -- soft FK to feedback_sprints

  -- Prioritization
  priority                 TEXT,                 -- p0, p1, p2, p3
  effort                   TEXT,                 -- xs, s, m, l, xl
  strategic_alignment      TEXT,                 -- high, medium, low

  -- AI scoring suggestions (user confirms/overrides)
  ai_priority_suggestion   TEXT,                 -- p0, p1, p2, p3
  ai_effort_suggestion     TEXT,                 -- xs, s, m, l, xl
  ai_alignment_suggestion  TEXT,                 -- high, medium, low
  ai_scoring_rationale     TEXT,                 -- one sentence rationale

  -- Checkout lock
  checked_out_by           TEXT,                 -- agent identifier holding the lock
  checked_out_at           TIMESTAMP             -- lock expiry: stale after 2 hours
)

feedback_sprints (
  id                       UUID PRIMARY KEY,
  name                     TEXT NOT NULL,        -- e.g. "Alpha Sprint 1"
  status                   TEXT NOT NULL,        -- planning, active, completed
  milestone_tag            TEXT,                 -- e.g. "alpha", "beta"
  start_date               TIMESTAMP,
  end_date                 TIMESTAMP,
  capacity                 INTEGER,              -- max items for the sprint
  notes                    TEXT,
  created_at               TIMESTAMP NOT NULL,
  updated_at               TIMESTAMP NOT NULL
)
```
