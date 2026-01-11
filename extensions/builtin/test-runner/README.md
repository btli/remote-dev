# Test Runner Extension

Universal test runner with framework detection, coverage analysis, and result formatting.

## Tools

### detect_test_framework
Auto-detect the test framework used in a project based on config files and dependencies.

Supported frameworks:
- jest
- vitest
- mocha
- pytest
- cargo-test
- go-test
- rspec

### run_tests
Execute tests with optional filtering, coverage, and custom arguments.

Options:
- `pattern` - Test file pattern or specific test name
- `coverage` - Enable coverage reporting
- `watch` - Run in watch mode
- `verbose` - Enable verbose output
- `args` - Additional arguments to pass

### analyze_test_failures
Parse test output to extract structured failure information with suggestions.

Returns:
- Test name and file location
- Error type and message
- Expected vs actual values
- Stack trace
- Suggested fixes

### coverage_report
Generate detailed coverage report with uncovered lines and improvement suggestions.

Output includes:
- Overall coverage percentages (lines, functions, branches, statements)
- Per-file coverage breakdown
- Uncovered line numbers
- Suggestions for improving coverage

## Prompts

### generate_test
Generate comprehensive unit tests for given code.

Variables:
- `code` (required) - The code to generate tests for
- `framework` - Test framework (default: vitest)
- `language` - Programming language (default: typescript)
- `existing_tests` - Existing test code to avoid duplication
- `focus` - Specific areas to focus testing on

### fix_failing_test
Analyze and suggest fixes for failing tests.

Variables:
- `test_code` (required) - The failing test code
- `implementation` (required) - The implementation being tested
- `error` (required) - The error message
- `stack_trace` - Full stack trace if available
- `language` - Programming language (default: typescript)

### improve_coverage
Suggest additional tests to improve coverage.

Variables:
- `coverage_percent` (required) - Current coverage percentage
- `target_percent` - Target coverage percentage (default: 80)
- `uncovered_code` (required) - Code that lacks test coverage
- `existing_tests` (required) - Existing test code
- `language` - Programming language (default: typescript)

## Configuration

```json
{
  "timeout_ms": 300000,
  "coverage_threshold": 80,
  "parallel": true
}
```

## Permissions

- `command:execute` - Execute test commands
- `file:read` - Read test files and coverage reports

## License

MIT
