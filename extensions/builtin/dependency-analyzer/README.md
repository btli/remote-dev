# Dependency Analyzer Extension

Analyze project dependencies for outdated packages, security vulnerabilities, and upgrade paths.

## Tools

### detect_package_manager
Auto-detect the package manager used in a project based on lock files and config.

Supported managers:
- npm / yarn / pnpm / bun (Node.js)
- pip / uv (Python)
- cargo (Rust)
- go (Go modules)
- composer (PHP)

### list_dependencies
List all project dependencies with version information.

Options:
- `include_dev` - Include development dependencies
- `depth` - Depth of transitive dependencies (0 = direct only)

### check_outdated
Check for outdated dependencies with available updates.

Options:
- `include_dev` - Include development dependencies
- `major_only` - Only show major version updates

Returns:
- Current, wanted, and latest versions
- Breaking change indicator
- Changelog URLs

### security_audit
Scan dependencies for known security vulnerabilities.

Options:
- `severity` - Minimum severity to report (low/moderate/high/critical)
- `fix` - Attempt to auto-fix vulnerabilities

Returns:
- CVE identifiers
- Severity ratings
- Patched versions
- Remediation recommendations

### dependency_graph
Generate a dependency graph showing relationships between packages.

Options:
- `package` - Focus on a specific package
- `depth` - Maximum depth of graph
- `format` - Output format (tree/json/dot)

Returns:
- Visual dependency tree
- Circular dependency detection

## Prompts

### upgrade_plan
Create a safe, prioritized upgrade plan for outdated dependencies.

Variables:
- `outdated` (required) - List of outdated packages
- `manager` - Package manager (default: npm)
- `project_name` - Name of the project
- `vulnerabilities` - Known security vulnerabilities
- `constraints` - Upgrade constraints

### vulnerability_report
Generate a comprehensive security vulnerability report.

Variables:
- `vulnerabilities` (required) - List of vulnerabilities
- `project_name` (required) - Name of the project
- `scan_date` - Date of the security scan
- `compliance` - Compliance requirements (SOC2, HIPAA, etc.)

### dependency_cleanup
Suggest unused or redundant dependencies to remove.

Variables:
- `dependencies` (required) - List of all dependencies
- `manager` - Package manager (default: npm)
- `imports` - Import analysis from the codebase
- `bundle_analysis` - Bundle size analysis results

## Configuration

```json
{
  "check_security": true,
  "include_dev": true,
  "severity_threshold": "moderate"
}
```

## Permissions

- `command:execute` - Execute package manager commands
- `file:read` - Read package manifests and lock files

## License

MIT
