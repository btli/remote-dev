---
description: "Process tester feedback from the production database — query, triage, evaluate, fix, and resolve. Doesn't blindly accept feedback; uses judgment and asks for approval on ambiguous items."
allowed-tools: Agent, Bash, Edit, Glob, Grep, Read, Write, Skill, TaskCreate, TaskUpdate, TaskList, AskUserQuestion, WebFetch, SendMessage, EnterPlanMode, ExitPlanMode
user-invocable: true
argument-description: "Optional: 'all' to process all new items, a specific feedback UUID, or a category filter (bug, ux, feature_request, performance, content). Default: all new items."
---

# Process Tester Feedback: $ARGUMENTS

Read the full process-feedback skill at `.claude/skills/process-feedback.md` and follow it step by step.

**Filter**: $ARGUMENTS (if empty, process all `status = 'new'` items)

## Workflow

1. **Query** — Pull unresolved feedback from the production database
2. **Triage** — For each item: read conversation history, view screenshot, identify affected code
3. **Evaluate** — Classify each item:
   - **Clear fix**: proceed autonomously
   - **Ambiguous/subjective**: present analysis + recommendation via AskUserQuestion, wait for approval
   - **Invalid/wontfix**: present reasoning via AskUserQuestion, get confirmation before dismissing
4. **Fix** — For each approved item, create a worktree and implement the fix following all project conventions
5. **Ship** — For each fix: typecheck, commit, push, create PR, run code-simplifier + code-reviewer, merge
6. **Resolve** — Mark each processed item as `resolved` or `wontfix` in the production database
7. **Report** — Summarize: items processed, fixed, deferred, rejected

## Key Rules

- **Never blindly accept feedback.** Evaluate if it makes sense given the design system, brand guidelines, and architecture decisions.
- **Always ask before rejecting.** Use AskUserQuestion to confirm before marking anything as `wontfix`.
- **Group related items.** If multiple feedback items touch the same page/component, batch them into one worktree/PR.
- **Follow the merge checklist.** Every PR goes through code-simplifier + code-reviewer before merge.
