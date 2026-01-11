# Git Enhanced Extension

Enhanced Git tools for code review, commit analysis, and repository insights.

## Tools

### git_status_enhanced
Get detailed Git status including staged, unstaged, and untracked files with diff statistics.

### git_diff_summary
Generate a human-readable summary of changes between commits or branches.

### git_commit_analyzer
Analyze commit history to identify patterns, frequent contributors, and hotspots.

### git_branch_compare
Compare two branches showing divergence, merge conflicts potential, and file-level differences.

## Prompts

### commit_message
Generate conventional commit messages from staged changes.

### pr_description
Generate pull request descriptions from branch changes.

### code_review
Provide code review feedback on git diffs.

## Configuration

```json
{
  "default_remote": "origin",
  "max_commits": 100
}
```

## Permissions

- `command:execute` - Execute git commands
- `file:read` - Read repository files

## License

MIT
