---
description: "Autonomous codebase polish — explore, identify 10+ items, plan, implement in parallel worktrees, ship-it review, merge. Optional focus: security, admin, observability, ux, performance, accessibility, seo, billing, brand, error-handling, hardening."
allowed-tools: Agent, Bash, Edit, Glob, Grep, Read, Write, Skill, TaskCreate, TaskUpdate, TaskList, EnterPlanMode, ExitPlanMode, WebSearch, WebFetch, SendMessage
user-invocable: true
argument-description: "Optional focus area(s): security, admin, observability, ux, performance, accessibility, seo, billing, brand, error-handling, hardening. Leave empty for broad scan."
---

# Polish: $ARGUMENTS

Read the full polish skill at `.claude/skills/polish.md` and follow it step by step.

This is an autonomous, non-interactive workflow. Do not use AskUserQuestion — research the best approach and use best judgement throughout.

**Focus area**: $ARGUMENTS (if empty, scan broadly and prioritize the worst gaps)

## Quick Reference

1. **Explore** — Launch 3 parallel Explore agents scoped to the focus area
2. **Identify** — Compile 10+ polish items in a severity table
3. **Plan** — Group into 3-6 worktrees, write plan to `docs/superpowers/plans/`
4. **Implement** — Dispatch worktree agents in parallel (`isolation: "worktree"`, `run_in_background: true`)
5. **Ship** — Run `/global:ship-it` review on each worktree, create PRs
6. **Merge** — Merge PRs sequentially, resolve conflicts, verify main, clean up, update docs
