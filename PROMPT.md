# PROMPT.md - Ralph Loop Orchestration Guide

> **Ralph Loops** are autonomous, iterative development cycles designed for sustained, high-quality software development. Each loop operates as a complete unit of work: branch creation → implementation → testing → code review → merge.

## Invoking Ralph Loops

Ralph loops are executed via the `ralph-loop` skill:

```bash
# Start a ralph loop for a specific task
/ralph-loop "Implement feature X with full test coverage"

# Or with specific bead reference
/ralph-loop "Complete work for remote-dev-xyz"
```

The skill reads this PROMPT.md file and orchestrates the entire loop autonomously.

---

## Table of Contents

1. [Loop Lifecycle](#loop-lifecycle)
2. [Pre-Loop Checklist](#pre-loop-checklist)
3. [Discovery & Exploration](#discovery--exploration)
4. [Feature-Dev Agent Integration](#feature-dev-agent-integration)
5. [Branch Management](#branch-management)
6. [Bead Tracking](#bead-tracking)
7. [Handling Discovered Work](#handling-discovered-work)
8. [Implementation Standards](#implementation-standards)
9. [Test Coverage Requirements](#test-coverage-requirements)
10. [Code Review Protocol](#code-review-protocol)
11. [PR Creation and Merge](#pr-creation-and-merge)
12. [Claude Code Integration](#claude-code-integration)
13. [Agent Profile Configuration](#agent-profile-configuration)
14. [Completion Criteria](#completion-criteria)
15. [Completion Promise](#completion-promise)

---

## Loop Lifecycle

Each ralph loop follows this iterative sequence with discovery built-in:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RALPH LOOP CYCLE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. INIT           Create feature branch from main/master                   │
│       ↓            Create initial EPIC + Task beads                         │
│                                                                             │
│  2. DISCOVER       Run feature-dev:code-explorer                            │
│       ↓            Analyze existing patterns and dependencies               │
│                    Identify hidden complexity and edge cases                │
│                    CREATE NEW BEADS for discovered work                     │
│                                                                             │
│  3. ARCHITECT      Run feature-dev:code-architect                           │
│       ↓            Design implementation blueprint                          │
│                    Define component boundaries                              │
│                    UPDATE BEADS with refined scope                          │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────┐           │
│  │  4. IMPLEMENT   Write code following blueprint               │           │
│  │       ↓         Use Clean Architecture principles            │  ITERATE  │
│  │                 Write tests alongside code                   │           │
│  │                                                              │           │
│  │  5. REVIEW      Run code-reviewer after each component       │     ↑     │
│  │       ↓         Fix issues immediately                       │     │     │
│  │                 DISCOVER new tasks → CREATE BEADS            │─────┘     │
│  │                                                              │           │
│  │  6. TEST        Run tests, check coverage                    │           │
│  │       ↓         If <80%, write more tests                    │           │
│  │                 If failures, fix and re-test                 │           │
│  └──────────────────────────────────────────────────────────────┘           │
│                                                                             │
│  7. FINALIZE       Run full pr-review-toolkit suite                         │
│       ↓            Address ALL remaining issues                             │
│                    Ensure all discovered beads are closed                   │
│                                                                             │
│  8. PR             Create PR with comprehensive summary                     │
│       ↓            Link ALL beads (original + discovered)                   │
│                    Include discovery notes                                  │
│                                                                             │
│  9. MERGE          Merge to main/master                                     │
│       ↓            Close ALL related beads                                  │
│                    Push to remote                                           │
│                                                                             │
│  10. VERIFY        All beads closed (including discovered)                  │
│        ↓           All branches merged                                      │
│                    Test coverage >80%                                       │
│                    Production readiness checks                              │
│                                                                             │
│  11. COMPLETE      Output completion promise                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Discovery Mindset

**Discovery is not optional** - it's a core part of every loop. You WILL find:
- Hidden dependencies you didn't anticipate
- Edge cases the original task didn't account for
- Refactoring opportunities that improve the solution
- Test scenarios you hadn't considered
- Integration points that need attention

**Every discovery becomes a bead.** Track everything.

---

## Pre-Loop Checklist

Before starting any ralph loop, verify:

```bash
# 1. Check current branch is clean
git status  # Should show clean working tree

# 2. Ensure on main/master
git branch --show-current  # Should be main or master

# 3. Pull latest changes
git pull origin main  # or master

# 4. Check beads status
bd stats
bd ready

# 5. Verify test infrastructure exists
bun test --run 2>/dev/null || echo "Tests need setup"

# 6. Check coverage baseline (if tests exist)
bun test --coverage 2>/dev/null || echo "Coverage needs setup"
```

---

## Discovery & Exploration

Discovery happens at multiple points in the loop. This section defines when and how to explore.

### When to Run Discovery

| Phase | Trigger | Agent | Output |
|-------|---------|-------|--------|
| **Initial** | After branch creation | `code-explorer` | Understanding of existing patterns |
| **Pre-Implementation** | Before each component | `code-architect` | Component design |
| **Mid-Implementation** | When hitting complexity | `code-explorer` | Dependency mapping |
| **Post-Implementation** | After each component | `code-reviewer` | Issues and improvements |
| **Integration** | When connecting components | `code-explorer` | Integration points |

### Discovery Protocol

```markdown
1. **State your hypothesis**
   - What do you expect to find?
   - What patterns should exist?

2. **Run exploration**
   - Use appropriate feature-dev agent
   - Cast a wide net initially

3. **Document findings**
   - Create beads for discovered work
   - Update existing beads with new scope
   - Note patterns for reuse

4. **Assess impact**
   - Does this change the architecture?
   - Are there new dependencies?
   - Does scope need adjustment?

5. **Iterate or proceed**
   - If major discovery → re-architect
   - If minor discovery → add bead, continue
```

### Discovery Questions to Ask

Before implementing ANY component, answer:

```markdown
□ What existing code does this touch?
□ What patterns does this codebase use for similar features?
□ What are the integration points?
□ What edge cases exist?
□ What tests already cover related functionality?
□ What dependencies will this introduce?
□ What could break?
```

### Discovery Output Format

After each discovery phase, document:

```markdown
## Discovery Report: [Component/Feature Name]

### Explored Areas
- [File/module 1]: [What was found]
- [File/module 2]: [What was found]

### Patterns Identified
- [Pattern 1]: Used in [locations], should follow for [reason]
- [Pattern 2]: ...

### Dependencies Found
- [Dependency 1]: Required because [reason]
- [Dependency 2]: ...

### New Beads Created
- [bead-id]: [Title] - [Why discovered]
- [bead-id]: [Title] - [Why discovered]

### Scope Adjustments
- Original scope: [description]
- Adjusted scope: [description]
- Reason: [explanation]

### Risks Identified
- [Risk 1]: [Mitigation]
- [Risk 2]: [Mitigation]
```

---

## Feature-Dev Agent Integration

Feature-dev agents are your primary tools for discovery and quality. Use them aggressively.

### Agent Capabilities

| Agent | Purpose | When to Use | Output |
|-------|---------|-------------|--------|
| `code-explorer` | Deep codebase analysis | Start of loop, when stuck, integration points | Patterns, dependencies, architecture map |
| `code-architect` | Design blueprints | Before implementation, after major discovery | Component design, file structure, interfaces |
| `code-reviewer` | Quality assurance | After each component, before PR | Issues, improvements, bugs |

### code-explorer Usage

**Invocation:**
```markdown
Use Task tool with subagent_type: feature-dev:code-explorer

Prompt template:
"Analyze [target area] in this codebase. I need to understand:
1. Existing patterns for [functionality type]
2. How [related feature] is implemented
3. Dependencies and integration points for [component]
4. Test coverage patterns

Focus on: [specific files/directories]
Goal: [what you're trying to build]"
```

**When to use:**
- Start of every loop (mandatory)
- Before touching unfamiliar code
- When implementation feels harder than expected
- When tests are failing unexpectedly
- When integrating multiple components

**Expected outputs:**
- File-by-file analysis
- Pattern documentation
- Dependency graphs
- Integration point identification
- Risk assessment

### code-architect Usage

**Invocation:**
```markdown
Use Task tool with subagent_type: feature-dev:code-architect

Prompt template:
"Design the implementation for [feature]. Based on exploration:
- Existing patterns: [summary from explorer]
- Constraints: [technical constraints]
- Requirements: [functional requirements]

Provide:
1. Component breakdown
2. File structure
3. Interface definitions
4. Data flow
5. Test strategy"
```

**When to use:**
- After initial exploration
- When scope changes significantly
- Before complex multi-file changes
- When introducing new patterns

**Expected outputs:**
- Implementation blueprint
- File creation/modification plan
- Interface definitions
- Sequence diagrams (textual)
- Test plan

### code-reviewer Usage

**Invocation:**
```markdown
Use Task tool with subagent_type: feature-dev:code-reviewer

Prompt template:
"Review the changes in [files/components]. Check for:
1. Adherence to existing patterns
2. Clean Architecture compliance
3. Test coverage adequacy
4. Error handling completeness
5. Security concerns
6. Performance implications

Context: [what was implemented and why]"
```

**When to use:**
- After completing each component (mandatory)
- Before moving to next task
- When uncertain about implementation
- Before PR creation

**Expected outputs:**
- Issue list with severity
- Suggested fixes
- Pattern violations
- Test gaps
- Security concerns

### Agent Chaining Pattern

For complex features, chain agents:

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENT CHAIN FLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  code-explorer ──→ Initial understanding                    │
│        │           Create discovery beads                   │
│        ↓                                                    │
│  code-architect ──→ Design blueprint                        │
│        │            Update beads with design                │
│        ↓                                                    │
│  [IMPLEMENT COMPONENT 1]                                    │
│        ↓                                                    │
│  code-reviewer ──→ Review component 1                       │
│        │           Create beads for issues                  │
│        │           Fix issues                               │
│        ↓                                                    │
│  code-explorer ──→ Re-explore if needed                     │
│        │           (integration points, dependencies)       │
│        ↓                                                    │
│  [IMPLEMENT COMPONENT 2]                                    │
│        ↓                                                    │
│  code-reviewer ──→ Review component 2                       │
│        │           ... repeat ...                           │
│        ↓                                                    │
│  [ALL COMPONENTS DONE]                                      │
│        ↓                                                    │
│  pr-review-toolkit ──→ Final comprehensive review           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Parallel Agent Execution

When exploring multiple areas, run agents in parallel:

```typescript
// Example: Exploring 3 independent areas simultaneously
// Use multiple Task tool calls in single message

Task 1: code-explorer for "authentication layer"
Task 2: code-explorer for "database schema"
Task 3: code-explorer for "API routes"

// Wait for all, then synthesize findings
```

---

## Branch Management

### Branch Naming Convention

```
<type>/<bead-id>-<short-description>

Types:
- feature/  → New functionality
- fix/      → Bug fixes
- refactor/ → Code restructuring
- test/     → Test additions/modifications
- docs/     → Documentation only
- chore/    → Maintenance tasks
```

### Examples

```bash
feature/remote-dev-xj6-claude-code-theme-system
fix/remote-dev-abc-terminal-reconnection
refactor/remote-dev-123-clean-architecture-session
test/remote-dev-yup-domain-layer-coverage
```

### Branch Lifecycle Commands

```bash
# Start of loop - create branch
git checkout main
git pull origin main
git checkout -b feature/remote-dev-xxx-description

# During loop - commit frequently
git add -A
git commit -m "feat: implement X component"

# End of loop - prepare for PR
git push -u origin feature/remote-dev-xxx-description

# After merge - cleanup
git checkout main
git pull origin main
git branch -d feature/remote-dev-xxx-description
```

---

## Bead Tracking

### Required Beads Structure

Every ralph loop MUST have:

1. **EPIC Bead** - High-level feature/goal
2. **Task Beads** - Specific implementation units
3. **Dependencies** - Properly linked

### Creating Beads

```bash
# Create EPIC
bd create --title="[EPIC] Feature Name" --type=feature --priority=1 \
  --description="High-level description of the feature goal"

# Create Tasks (run in parallel for efficiency)
bd create --title="Task 1 description" --type=task --priority=1 \
  --description="Detailed description"
bd create --title="Task 2 description" --type=task --priority=1 \
  --description="Detailed description"

# Link dependencies
bd dep add <task-id> <epic-id>
```

### Bead Status Management

```bash
# When starting work
bd update <id> --status=in_progress

# When blocked
bd update <id> --status=blocked
bd dep add <id> <blocking-id>

# When complete
bd close <id> --reason="Implemented in PR #X"

# Batch close multiple
bd close <id1> <id2> <id3>
```

### Bead Verification Before Completion

```bash
# Check all beads are closed
bd list --status=open  # Should return empty

# Check no blocked items
bd blocked  # Should return empty

# Sync to remote
bd sync
```

---

## Handling Discovered Work

Discovery is continuous. You WILL find additional work during implementation. Here's how to handle it.

### Discovery Categories

| Category | Action | Example |
|----------|--------|---------|
| **Blocker** | Create bead, fix immediately | Missing dependency, broken integration |
| **Required** | Create bead, complete in this loop | Edge case, missing validation |
| **Enhancement** | Create bead, assess scope | Refactoring opportunity, optimization |
| **Future** | Create bead, link to EPIC, defer | Nice-to-have, out of scope |

### Decision Tree for Discovered Work

```
┌─────────────────────────────────────────────────────────────────┐
│                 DISCOVERED WORK DECISION TREE                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Discovery Found                                                │
│        │                                                        │
│        ↓                                                        │
│  Does it BLOCK current work?                                    │
│        │                                                        │
│    YES ↓                 NO ↓                                   │
│  ┌─────────────┐    Is it REQUIRED for feature correctness?     │
│  │ IMMEDIATE   │         │                                      │
│  │ Create bead │     YES ↓                 NO ↓                 │
│  │ Fix NOW     │    ┌─────────────┐   Does it fit in scope?     │
│  │ Block task  │    │ REQUIRED    │        │                    │
│  └─────────────┘    │ Create bead │    YES ↓           NO ↓     │
│                     │ Add to loop │   ┌─────────────┐ ┌────────┐│
│                     │ Must close  │   │ ENHANCEMENT │ │ FUTURE ││
│                     └─────────────┘   │ Create bead │ │ Create ││
│                                       │ Best effort │ │ bead   ││
│                                       │ in loop     │ │ Link   ││
│                                       └─────────────┘ │ defer  ││
│                                                       └────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Creating Discovery Beads

When you discover work, create a bead immediately:

```bash
# For blocking issues
bd create --title="[BLOCKER] Description" --type=bug --priority=0 \
  --description="Discovered during: [task]. Blocks: [what]. Fix: [approach]"
bd dep add <current-task> <blocker-id>  # Current task depends on blocker

# For required work
bd create --title="[REQUIRED] Description" --type=task --priority=1 \
  --description="Discovered during: [task]. Required for: [reason]"
bd dep add <new-task> <epic-id>  # Link to EPIC

# For enhancements
bd create --title="[ENHANCEMENT] Description" --type=task --priority=2 \
  --description="Discovered during: [task]. Improves: [what]"
bd dep add <enhancement> <epic-id>

# For future work (outside this loop)
bd create --title="[FUTURE] Description" --type=feature --priority=3 \
  --description="Discovered during: [task]. Deferred because: [reason]"
# Don't link as dependency - it's truly separate work
```

### Discovery Documentation

Track all discoveries in your PR:

```markdown
## Discovered During Implementation

### Blockers Resolved
- [bead-id]: [Description] - [How resolved]

### Required Work Added
- [bead-id]: [Description] - [Why required]

### Enhancements Included
- [bead-id]: [Description] - [Benefit]

### Deferred to Future
- [bead-id]: [Description] - [Why deferred]
```

### Scope Management

**Scope creep is real.** Use these guidelines:

| Original Scope | Discovery | Action |
|----------------|-----------|--------|
| Small (1-3 tasks) | +1-2 required | Include |
| Small | +3+ required | Split into multiple loops |
| Medium (4-7 tasks) | +1-3 required | Include |
| Medium | +4+ required | Split or defer |
| Large (8+ tasks) | Any | Assess carefully, prefer defer |

**Rule of thumb**: A single ralph loop should complete in a reasonable timeframe. If discoveries push it beyond that, split the work.

### Mid-Loop Scope Reset

If discoveries significantly change scope:

```bash
# 1. Document current state
git add -A
git commit -m "WIP: checkpoint before scope adjustment"

# 2. Update EPIC description
bd update <epic-id> --description="Updated scope: [new description]"

# 3. Re-run architect agent
# Use feature-dev:code-architect to redesign

# 4. Create/update beads to reflect new scope

# 5. Continue implementation
```

### Discovery Log Template

Maintain a discovery log during the loop:

```markdown
## Discovery Log - [Loop Name]

### [Timestamp] Discovery 1
- **Found in**: [file/component]
- **Type**: Blocker/Required/Enhancement/Future
- **Description**: [what was found]
- **Bead created**: [bead-id]
- **Action taken**: [immediate fix/scheduled/deferred]

### [Timestamp] Discovery 2
...
```

---

## Implementation Standards

### Clean Architecture Requirements

Follow the existing layer structure:

```
src/
├── domain/              # Layer 1: Pure business logic
│   ├── entities/        # Core domain objects
│   ├── value-objects/   # Immutable typed values
│   └── errors/          # Domain-specific errors
│
├── application/         # Layer 2: Use cases
│   ├── use-cases/       # Single-responsibility orchestrators
│   └── ports/           # Interface definitions
│
├── infrastructure/      # Layer 3: Implementations
│   ├── persistence/     # Database repositories
│   ├── external/        # External service gateways
│   └── container.ts     # Dependency injection
│
└── interface/           # Layer 4: API adapters
    └── presenters/      # Domain → API transformers
```

### Architecture Principles

1. **Dependency Rule**: Inner layers know nothing about outer layers
2. **Immutable Entities**: State changes return new instances
3. **Repository Pattern**: Abstract persistence behind interfaces
4. **Use Case Single Responsibility**: One use case, one job
5. **Value Objects**: Type-safe wrappers for domain concepts

### Feature-Dev Skill Usage

For complex features, use the feature-dev agents:

```markdown
# Planning Phase
Use: feature-dev:code-architect
Purpose: Design implementation blueprint

# Exploration Phase
Use: feature-dev:code-explorer
Purpose: Understand existing patterns

# Implementation Phase
Use: feature-dev:code-reviewer (after each component)
Purpose: Catch issues early

# Pre-PR Phase
Use: pr-review-toolkit agents
Purpose: Final quality checks
```

### Decision Making Without User Input

When facing implementation choices:

1. **Research best practices** via documentation skills
2. **Prefer full capability** over simplicity
3. **Choose Clean Architecture** compliant approaches
4. **Document decisions** in code comments or ADRs
5. **Optimize for testability** and maintainability

---

## Test Coverage Requirements

### Minimum Coverage: 80%

Coverage must meet or exceed 80% across:
- Statements
- Branches
- Functions
- Lines

### Test Infrastructure Setup

```bash
# Install test dependencies
bun add -d vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom

# Configure vitest (vitest.config.ts)
```

### Required Test Types

#### 1. Domain Layer Tests (Unit)
```typescript
// src/domain/entities/__tests__/Session.test.ts
describe('Session Entity', () => {
  it('should create with valid properties', () => {})
  it('should transition states correctly', () => {})
  it('should enforce invariants', () => {})
})
```

#### 2. Application Layer Tests (Integration)
```typescript
// src/application/use-cases/__tests__/CreateSession.test.ts
describe('CreateSessionUseCase', () => {
  it('should create session with valid input', () => {})
  it('should fail with invalid input', () => {})
  it('should call repository correctly', () => {})
})
```

#### 3. Infrastructure Layer Tests (Integration)
```typescript
// src/infrastructure/persistence/__tests__/SessionRepository.test.ts
describe('DrizzleSessionRepository', () => {
  it('should persist session to database', () => {})
  it('should retrieve session by id', () => {})
})
```

#### 4. API Route Tests (E2E)
```typescript
// src/app/api/sessions/__tests__/route.test.ts
describe('Sessions API', () => {
  it('GET /api/sessions returns user sessions', () => {})
  it('POST /api/sessions creates new session', () => {})
})
```

### Coverage Commands

```bash
# Run tests with coverage
bun test --coverage

# Check specific threshold
bun test --coverage --coverage.thresholds.statements=80

# Generate HTML report
bun test --coverage --coverage.reporter=html
```

### Coverage Enforcement

Add to `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      exclude: [
        'node_modules/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/**',
      ],
    },
  },
})
```

---

## Code Review Protocol

### Automated Review Agents

Run these agents in sequence before PR:

```markdown
1. **code-reviewer** (pr-review-toolkit)
   - Check code quality
   - Identify bugs and logic errors
   - Verify project conventions

2. **code-simplifier** (pr-review-toolkit)
   - Simplify complex code
   - Remove unnecessary abstractions
   - Improve readability

3. **silent-failure-hunter** (pr-review-toolkit)
   - Find silent failures
   - Check error handling
   - Identify swallowed exceptions

4. **type-design-analyzer** (pr-review-toolkit)
   - Review new types
   - Check encapsulation
   - Verify invariants

5. **comment-analyzer** (pr-review-toolkit)
   - Verify comment accuracy
   - Check documentation completeness
```

### Review Issue Resolution

**ALL issues must be addressed.** No exceptions.

Resolution options:
1. **Fix** - Implement the suggested change
2. **Explain** - If the reviewer misunderstood, fix the code to be clearer
3. **Split** - Create a new bead for complex issues that require separate work

**NOT acceptable:**
- Deferring to "future work"
- Adding TODO comments
- Disabling linter rules
- Marking as "won't fix"

---

## PR Creation and Merge

### PR Template

```markdown
## Summary
- [Bullet point summary of changes]
- [Link to EPIC bead: remote-dev-xxx]

## Changes
- [Specific change 1]
- [Specific change 2]

## Test Coverage
- Current: X%
- Target: 80%
- Status: PASS/FAIL

## Beads Addressed
- [x] remote-dev-xxx: Task description
- [x] remote-dev-yyy: Task description

## Review Checklist
- [ ] Code review agent passed
- [ ] All tests passing
- [ ] Coverage >= 80%
- [ ] No linter warnings
- [ ] Types verified
- [ ] Documentation updated

---
Generated with [Claude Code](https://claude.com/claude-code)
```

### PR Creation Command

```bash
gh pr create \
  --title "feat: Description of feature" \
  --body "$(cat <<'EOF'
## Summary
...

## Test plan
...

Addresses: remote-dev-xxx, remote-dev-yyy

---
Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Merge Process

```bash
# After PR approval
gh pr merge <pr-number> --squash --delete-branch

# Verify merge
git checkout main
git pull origin main

# Close beads
bd close remote-dev-xxx remote-dev-yyy --reason="Merged in PR #X"

# Sync beads
bd sync
```

---

## Claude Code Integration

### Theme System Configuration

Instead of intercepting ANSI codes at the terminal level, leverage Claude Code's native configuration:

#### Status Line Configuration (`.claude/settings.json`)

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 0
  }
}
```

#### Status Line Script

Create `~/.claude/statusline.sh`:

```bash
#!/bin/bash
# Read JSON from stdin
read -r input

# Parse with jq
model=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
tokens=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // 0')
max_tokens=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')

# Calculate usage percentage
usage_pct=$((tokens * 100 / max_tokens))

# ANSI color codes (semantic - follows terminal theme)
RESET="\033[0m"
BOLD="\033[1m"
DIM="\033[2m"
CYAN="\033[36m"
YELLOW="\033[33m"
GREEN="\033[32m"
RED="\033[31m"

# Color based on usage
if [ $usage_pct -lt 50 ]; then
  USAGE_COLOR=$GREEN
elif [ $usage_pct -lt 80 ]; then
  USAGE_COLOR=$YELLOW
else
  USAGE_COLOR=$RED
fi

# Output status line
printf "${BOLD}${CYAN}%s${RESET} ${DIM}|${RESET} ${USAGE_COLOR}%d%%${RESET} ${DIM}|${RESET} \$%.4f" \
  "$model" "$usage_pct" "$cost"
```

### Memory File Hierarchy

Leverage Claude Code's 4-tier memory system:

```
/Library/Application Support/ClaudeCode/CLAUDE.md  # Enterprise (macOS)
~/.claude/CLAUDE.md                                 # User-wide
./CLAUDE.md                                         # Project (checked in)
./CLAUDE.local.md                                   # Project local (gitignored)
./.claude/rules/*.md                                # Modular rules
```

### Model Configuration

Environment variables for model control:

```bash
# In .env or shell profile
export ANTHROPIC_MODEL=opus                    # Default model
export CLAUDE_CODE_SUBAGENT_MODEL=sonnet       # Subagent model
export ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-5-20251101
export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-5-20250929
export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-3-5-20241022
```

### Hooks Integration

Configure hooks in `.claude/settings.json`:

```json
{
  "hooks": {
    "pre-tool-call": {
      "bash": "~/.claude/hooks/pre-tool.sh"
    },
    "post-tool-call": {
      "bash": "~/.claude/hooks/post-tool.sh"
    },
    "notification": {
      "bash": "~/.claude/hooks/notify.sh"
    }
  }
}
```

---

## Agent Profile Configuration

### Database Schema Extension

Add to user settings:

```typescript
// Agent profile configuration
interface AgentProfile {
  id: string;
  name: string;  // e.g., "Claude Code", "Cursor", "Windsurf"
  enabled: boolean;

  // Model preferences
  defaultModel: string;
  subagentModel: string;
  planningModel: string;

  // Status line
  statusLineEnabled: boolean;
  statusLineScript: string;

  // Memory files
  memoryFiles: {
    user: string;      // ~/.claude/CLAUDE.md path
    project: string;   // ./CLAUDE.md path
    local: string;     // ./CLAUDE.local.md path
  };

  // Hooks
  hooks: {
    preToolCall?: string;
    postToolCall?: string;
    notification?: string;
  };

  // Theme integration
  themeSync: boolean;  // Sync with Remote Dev theme
  terminalTheme: string;
}
```

### Profile Management API

```
GET  /api/profiles              # List agent profiles
POST /api/profiles              # Create profile
GET  /api/profiles/:id          # Get profile
PATCH /api/profiles/:id         # Update profile
DELETE /api/profiles/:id        # Delete profile
POST /api/profiles/:id/generate # Generate config files
```

### Config File Generation

The `generate` endpoint creates:
- `.claude/settings.json`
- `~/.claude/CLAUDE.md` (with imports)
- `.claude/rules/*.md` files
- Status line script
- Hook scripts

---

## Completion Criteria

Before outputting the completion promise, ALL of the following MUST be true:

### Discovery & Exploration
- [ ] Initial code-explorer run completed
- [ ] code-architect blueprint created for complex features
- [ ] All discoveries documented
- [ ] All discovered beads created and tracked
- [ ] No unaddressed blockers

### Code Quality
- [ ] All linter checks pass (`bun run lint`)
- [ ] All type checks pass (`bun run typecheck`)
- [ ] No disabled linter rules
- [ ] No `@ts-ignore` or `// noqa` comments
- [ ] Clean architecture principles followed

### Test Coverage
- [ ] Test suite exists and runs
- [ ] Coverage >= 80% (statements, branches, functions, lines)
- [ ] All tests passing
- [ ] Domain layer fully tested
- [ ] Application layer use cases tested
- [ ] Critical API routes tested

### Bead Management (Including Discovered Work)
- [ ] All ORIGINAL beads for this loop are closed
- [ ] All DISCOVERED beads (blocker, required, enhancement) are closed
- [ ] FUTURE beads properly documented and linked
- [ ] No blocked beads remain
- [ ] `bd sync` completed successfully
- [ ] `bd list --status=open` returns empty (for this loop's beads)

### Branch Management
- [ ] All feature branches merged to main/master
- [ ] No orphaned branches
- [ ] `git push` completed to remote
- [ ] Working tree clean (`git status` shows nothing)

### PR Status
- [ ] All PRs merged
- [ ] No open PRs for this loop's work
- [ ] PR reviews addressed
- [ ] Discovery documentation included in PR

### Code Review
- [ ] code-reviewer agent run after each component
- [ ] Final pr-review-toolkit suite completed
- [ ] All identified issues resolved
- [ ] No deferred issues

### Production Readiness
- [ ] Build succeeds (`bun run build`)
- [ ] No runtime errors in dev server
- [ ] Database migrations applied if needed
- [ ] Environment variables documented

---

## Completion Promise

**CRITICAL**: Only output this promise when ALL completion criteria are verified.

When all work is complete, tests pass with >80% coverage, all beads are closed, all branches are merged, and all checks pass, output EXACTLY:

```
<promise>IAMFINALLYDONE</promise>
```

### Pre-Promise Verification Script

Run this before outputting the promise:

```bash
#!/bin/bash
set -e

echo "=== Ralph Loop Completion Verification ==="

# 1. Git status
echo -n "Git clean: "
if [ -z "$(git status --porcelain)" ]; then
  echo "PASS"
else
  echo "FAIL - uncommitted changes"
  exit 1
fi

# 2. On main/master
echo -n "On main branch: "
branch=$(git branch --show-current)
if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  echo "PASS ($branch)"
else
  echo "FAIL - on $branch"
  exit 1
fi

# 3. Beads closed
echo -n "Beads closed: "
open_beads=$(bd list --status=open 2>/dev/null | grep -c "remote-dev" || true)
if [ "$open_beads" -eq 0 ]; then
  echo "PASS"
else
  echo "FAIL - $open_beads open beads"
  exit 1
fi

# 4. Tests pass
echo -n "Tests: "
if bun test --run; then
  echo "PASS"
else
  echo "FAIL"
  exit 1
fi

# 5. Coverage
echo -n "Coverage >= 80%: "
coverage=$(bun test --coverage 2>&1 | grep "All files" | awk '{print $4}' | tr -d '%')
if [ "${coverage:-0}" -ge 80 ]; then
  echo "PASS ($coverage%)"
else
  echo "FAIL ($coverage%)"
  exit 1
fi

# 6. Lint
echo -n "Lint: "
if bun run lint; then
  echo "PASS"
else
  echo "FAIL"
  exit 1
fi

# 7. Typecheck
echo -n "Typecheck: "
if bun run typecheck; then
  echo "PASS"
else
  echo "FAIL"
  exit 1
fi

# 8. Build
echo -n "Build: "
if bun run build; then
  echo "PASS"
else
  echo "FAIL"
  exit 1
fi

echo ""
echo "=== ALL CHECKS PASSED ==="
echo "You may now output: <promise>IAMFINALLYDONE</promise>"
```

---

## Quick Reference

### Invoking Ralph Loop
```bash
# Via skill (recommended)
/ralph-loop "Implement feature X"

# Or with existing bead
/ralph-loop "Complete remote-dev-xyz"
```

### Loop Start (Manual)
```bash
git checkout main && git pull
git checkout -b feature/remote-dev-xxx-description
bd create --title="[EPIC] ..." --type=feature --priority=1
bd update remote-dev-xxx --status=in_progress
```

### Discovery Phase
```bash
# Run code-explorer (mandatory at loop start)
# Use Task tool with subagent_type: feature-dev:code-explorer

# Create beads for discovered work
bd create --title="[REQUIRED] ..." --type=task --priority=1

# Link to EPIC
bd dep add <discovered-task> <epic-id>
```

### Implementation Cycle
```bash
# For each component:
# 1. Run code-architect (design)
# 2. Implement
# 3. Run code-reviewer
# 4. Fix issues, create beads for discoveries
# 5. Write tests
# 6. Repeat
```

### Loop End
```bash
# Verify all discovered beads are addressed
bd list --status=open  # Should be empty

# Run full quality checks
bun test --coverage
bun run lint && bun run typecheck

# Commit and push
git add -A && git commit -m "feat: ..."
git push -u origin feature/remote-dev-xxx-description

# Create PR with discovery documentation
gh pr create --title "..." --body "..."

# Merge and cleanup
gh pr merge --squash --delete-branch
git checkout main && git pull

# Close all beads (original + discovered)
bd close remote-dev-xxx remote-dev-yyy remote-dev-zzz
bd sync

# Verify and complete
./scripts/verify-ralph-loop.sh
<promise>IAMFINALLYDONE</promise>
```

### Discovery Commands Quick Ref
```bash
# Create blocker
bd create --title="[BLOCKER] ..." --type=bug --priority=0

# Create required
bd create --title="[REQUIRED] ..." --type=task --priority=1

# Create enhancement
bd create --title="[ENHANCEMENT] ..." --type=task --priority=2

# Create future (out of scope)
bd create --title="[FUTURE] ..." --type=feature --priority=3
```

---

## Appendix: Claude Code Documentation References

### Terminal Configuration
- Theme matching via `/config` command
- Vim mode with `/vim` command
- Shift+Enter with `/terminal-setup`
- iTerm2 notifications via Preferences

### Model Configuration
- Aliases: `default`, `sonnet`, `opus`, `haiku`, `opusplan`
- Extended context: `sonnet[1m]` for 1M tokens
- Environment variables for model overrides

### Memory System
- 4-tier hierarchy (Enterprise → User → Project → Local)
- Imports via `@path/to/file` syntax
- Modular rules in `.claude/rules/*.md`
- Path-specific rules with YAML frontmatter

### Status Line
- JSON input via stdin
- ANSI colors supported
- 300ms update throttle
- Fields: model, workspace, cost, context_window
