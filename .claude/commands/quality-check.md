Run complete pre-commit quality validation for the current project.

**Workflow**:

1. **Lint and Format**
   - Run ruff linting with auto-fix
   - Run ruff formatting

2. **Type Check**
   - Run mypy type checking with project configuration

3. **Run Tests**
   - Run pytest with stop-on-first-failure
   - Display short traceback for failures

4. **Check Coverage**
   - Run pytest with coverage report
   - Display missing coverage lines

5. **Project-Specific Validation**
   - For Home Assistant projects: Run tier validation scripts
   - For web projects: Run build check

6. **Generate Report**
   - ✅ Pass/Fail status for each check
   - 📊 Coverage percentage
   - ⚠️ Warnings summary
   - 🔧 Auto-fixable issues identified

**Auto-Fix Mode**: Automatically fix linting errors and re-run checks (max 3 iterations).

**Error Recovery**: If tests fail, attempt to analyze and fix errors automatically (max 3 iterations).

**Use TodoWrite**: Track progress through each validation step.

**Only report success if all checks pass**. Do not ask for confirmation to continue between steps - this is a mechanical task that should run automatically.
