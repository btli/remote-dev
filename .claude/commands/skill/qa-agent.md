---
description: Launch Quality Assurance subagent for autonomous testing and validation
---

Launch a specialized Quality Assurance subagent to autonomously handle testing, validation, and quality checks with context isolation.

**Purpose**: Offload comprehensive testing workflows to a dedicated subagent, preserving main conversation context while performing thorough quality validation.

## When to Use

- Before committing code changes
- Before creating pull requests
- After major refactoring
- During CI/CD troubleshooting
- When quality checks fail repeatedly

## Subagent Capabilities

The QA subagent has access to all testing and validation tools:
- Read, Edit, Write tools for code fixes
- Bash tool for running tests, linters, type checkers
- Grep and Glob for code analysis
- Full repository access

## Workflow

### 1. Launch QA Subagent

Use the Task tool with specialized QA prompt:

```
Launch a Quality Assurance subagent to perform comprehensive testing and validation.

The subagent should:

**Phase 1: Analysis**
- Analyze the current codebase changes
- Identify files that have been modified
- Determine appropriate test strategy
- Check for common issues

**Phase 2: Quality Validation**
1. Run linting (ruff check --fix && ruff format)
2. Run type checking (mypy with project config)
3. Run unit tests (pytest -x --tb=short)
4. Run coverage analysis (pytest --cov with >95% target)
5. Run project-specific validators

**Phase 3: Auto-Fix Attempts (Max 3 Iterations)**
For each failing check:
- Analyze the error message
- Identify root cause
- Attempt automatic fix
- Re-run the check
- Track iteration count

Common auto-fixes:
- Linting errors → ruff check --fix
- Import errors → add missing imports
- Type hints → add for simple cases
- Simple test failures → fix obvious issues

**Phase 4: Project-Specific Validation**
For Home Assistant projects:
- Run validate_platinum_tier.py
- Run validate_gold_tier.py
- Run validate_silver_tier.py
- Check manifest.json compliance
- Validate translations completeness

For web projects:
- Run npm run build / yarn build
- Check for build errors
- Validate TypeScript compilation

**Phase 5: Generate Report**
Return a concise summary containing:

✅ **Passed Checks**:
- Linting: [status]
- Type checking: [status]
- Unit tests: [status]
- Coverage: [percentage]%
- Project validators: [status]

❌ **Failed Checks** (if any):
- Check name: [error summary]
- Attempted fixes: [count]
- Remaining issues: [description]

🔧 **Auto-Fix Summary**:
- Fixes attempted: [count]
- Fixes successful: [count]
- Iterations used: [X/3]

⚠️ **Warnings**:
- Coverage gaps: [files with low coverage]
- Deprecated usage: [instances]
- Code smells: [issues found]

📊 **Statistics**:
- Total tests: [count]
- Tests passed: [count]
- Tests failed: [count]
- Code coverage: [percentage]%
- Files changed: [count]
- Lines added/removed: [+X/-Y]

💡 **Recommendations**:
- [Specific actionable suggestions]
- [Areas needing attention]
- [Best practices to apply]

**IMPORTANT**:
- Do NOT return full test output or logs (too verbose)
- Do NOT return file contents unless specifically problematic
- Focus on actionable summary
- Keep report under 2000 tokens
```

### 2. Subagent Execution

The subagent will:
- Execute all quality checks autonomously
- Attempt automatic fixes without asking
- Re-run tests after fixes
- Stop after 3 fix iterations per issue
- Preserve all test output in its context

### 3. Main Agent Receives Report

The main conversation receives only:
- Concise summary report (~500-2000 tokens)
- Pass/fail status for each check
- Auto-fix attempts and results
- Actionable recommendations

**Context saved**: 20-30k tokens (full test output stays in subagent)

### 4. Act on Report

Based on subagent report:
- If all passed → proceed with commit
- If failures with fixes → review fixes and commit
- If failures without fixes → investigate issues
- If warnings → optionally address before commit

## Auto-Fix Strategy

### Iteration 1: Obvious Fixes
- Run auto-formatters (ruff format)
- Fix auto-fixable linting (ruff check --fix)
- Add obvious missing imports
- Fix simple type hints

### Iteration 2: Analytical Fixes
- Analyze error messages
- Fix based on error context
- Correct common patterns
- Update test assertions if needed

### Iteration 3: Conservative Fixes
- Only high-confidence fixes
- Document uncertainty
- Suggest manual intervention if unclear

### Stop Conditions
- All checks pass
- 3 iterations completed
- No progress made in last iteration
- Breaking changes detected

## Safety Features

**Never auto-fix**:
- Breaking API changes
- Database migrations
- Security-related code
- Complex business logic
- User-facing error messages

**Always preserve**:
- Original code semantics
- Existing test coverage
- API contracts
- Documentation accuracy

**Ask for confirmation on**:
- Potential breaking changes
- Large refactoring needed
- Unclear error causes
- Security implications

## Example Usage

### Simple Quality Check
```
User: Launch QA agent to validate my changes

Claude: *Launches QA subagent*

Subagent Report:
✅ All checks passed
- Linting: ✅ 0 errors
- Type checking: ✅ 0 errors
- Tests: ✅ 301/301 passed
- Coverage: ✅ 96.2%

Ready to commit!
```

### With Auto-Fixes
```
User: Launch QA agent

Claude: *Launches QA subagent*

Subagent Report:
✅ Passed after auto-fixes

Initial failures:
- Linting: 12 errors
- Type hints: 3 missing

Auto-fixes applied (Iteration 1):
- Fixed all linting errors
- Added type hints for 3 functions

Final status:
- Linting: ✅ 0 errors
- Type checking: ✅ 0 errors
- Tests: ✅ 301/301 passed
- Coverage: ✅ 96.3%

Ready to commit!
```

### With Manual Intervention Needed
```
User: Launch QA agent

Claude: *Launches QA subagent*

Subagent Report:
❌ Unable to auto-fix after 3 iterations

Persistent failures:
- Test: test_session_management::test_re_authentication
  Error: AssertionError expected 200, got 401
  Issue: Authentication logic may be incorrect

Attempted fixes:
1. Updated mock credentials
2. Adjusted timeout values
3. Fixed session header format

Recommendation:
Manual review needed for authentication flow.
Check coordinator.py:145 for session handling.
```

## Integration with Other Commands

### With /quality-check
```
/quality-check
→ Internally uses QA subagent for testing
→ Main agent handles commit decision
```

### With /test-fix-deploy
```
/test-fix-deploy
→ Step 1: Launches QA subagent
→ Proceeds only if QA passes
→ Preserves main context for deployment
```

### With /git:feature
```
/git:feature "new feature"
→ Before PR: Launches QA subagent
→ Validates quality
→ Continues with PR creation
```

## Performance Benefits

**Context Preservation**:
- Main conversation: ~10k tokens used
- Test output: ~25k tokens (in subagent only)
- **Savings**: 25k tokens per quality check

**Speed Optimization**:
- Parallel test execution
- Cached dependency resolution
- Incremental test runs (when possible)

**Cost Reduction**:
- Fewer tokens in main context
- Less repetitive output
- More efficient conversations

## Best Practices

### DO
- Use QA subagent for comprehensive testing
- Trust auto-fix attempts (they're conservative)
- Review subagent report carefully
- Act on recommendations

### DON'T
- Skip QA validation before commits
- Ignore persistent test failures
- Override QA decisions without review
- Disable auto-fix unnecessarily

## Troubleshooting

### QA Subagent Fails to Launch
- Check Task tool is available
- Verify repository access
- Ensure test environment configured

### Auto-Fixes Not Working
- Review error messages in report
- Check if errors are auto-fixable
- Consider manual intervention

### Tests Timing Out
- Increase timeout in test configuration
- Check for infinite loops
- Review slow test performance

### Coverage Dropping
- Review newly added code
- Add tests for uncovered lines
- Check for dead code removal

## Advanced Configuration

### Custom Validation Rules
Add to project CLAUDE.md:
```markdown
## QA Subagent Configuration

Custom validators:
- Security scan: npm audit
- License check: license-checker
- Bundle size: webpack-bundle-analyzer

Coverage thresholds:
- Statements: 95%
- Branches: 90%
- Functions: 95%
- Lines: 95%
```

### Project-Specific Commands
```bash
# Add to quality checks
npm run lint:security
npm run test:integration
npm run validate:dependencies
```

## Success Metrics

Track QA subagent effectiveness:
- Auto-fix success rate (target: >80%)
- Iteration count (target: <2 average)
- Time saved per check (target: 5+ min)
- Context tokens saved (target: 20k+)

---

**Status**: Production Ready
**Context Isolation**: ✅ Yes
**Auto-Fix**: ✅ Up to 3 iterations
**Token Savings**: ~20-30k per use
