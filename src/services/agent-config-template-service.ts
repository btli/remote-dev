/**
 * AgentConfigTemplateService - Manages built-in and custom config templates
 *
 * Provides pre-built templates for common project types (TypeScript, Python, Rust)
 * that can be applied to folders to bootstrap agent configurations.
 */

import type {
  AgentConfigTemplate,
  AgentProvider,
} from "@/types/agent";
import * as AgentConfigService from "./agent-config-service";
import { TemplateServiceError } from "@/lib/errors";

// ============================================================================
// Built-in Templates
// ============================================================================

const TYPESCRIPT_CLAUDE_TEMPLATE: AgentConfigTemplate = {
  id: "typescript-claude",
  name: "TypeScript - Claude",
  description: "Claude Code configuration for TypeScript/Node.js projects",
  provider: "claude",
  configType: "CLAUDE.md",
  tags: ["typescript", "javascript", "node", "bun"],
  projectType: "typescript",
  content: `# CLAUDE.md - TypeScript Project

## Project Overview
This is a TypeScript project. Follow these guidelines when working with the codebase.

## Code Style
- Use TypeScript strict mode
- Prefer \`const\` over \`let\`, avoid \`var\`
- Use async/await over Promises where possible
- Use descriptive variable and function names
- Add JSDoc comments for public APIs

## Commands
\`\`\`bash
# Development
bun run dev        # Start development server
bun run build      # Build for production
bun run typecheck  # Run TypeScript type checking
bun run lint       # Run ESLint
bun run test       # Run tests
\`\`\`

## Testing
- Write tests for new functionality
- Use describe/it pattern for test organization
- Mock external dependencies

## Architecture
- Keep components small and focused
- Use dependency injection for testability
- Separate business logic from I/O
`,
};

const TYPESCRIPT_CODEX_TEMPLATE: AgentConfigTemplate = {
  id: "typescript-codex",
  name: "TypeScript - Codex",
  description: "OpenAI Codex configuration for TypeScript/Node.js projects",
  provider: "codex",
  configType: "AGENTS.md",
  tags: ["typescript", "javascript", "node"],
  projectType: "typescript",
  content: `# AGENTS.md - TypeScript Project

## Project Context
TypeScript project with strict type checking.

## Guidelines
- Maintain type safety
- Follow existing code patterns
- Run \`bun run typecheck\` before committing
- Write unit tests for new code

## Available Commands
- \`bun run dev\` - Development server
- \`bun run build\` - Production build
- \`bun run test\` - Run tests
`,
};

const TYPESCRIPT_GEMINI_TEMPLATE: AgentConfigTemplate = {
  id: "typescript-gemini",
  name: "TypeScript - Gemini",
  description: "Gemini CLI configuration for TypeScript/Node.js projects",
  provider: "gemini",
  configType: "GEMINI.md",
  tags: ["typescript", "javascript", "node"],
  projectType: "typescript",
  content: `# GEMINI.md - TypeScript Project

## Project Setup
This is a TypeScript project using modern tooling.

## Development Workflow
1. \`bun install\` - Install dependencies
2. \`bun run dev\` - Start development
3. \`bun run typecheck\` - Verify types
4. \`bun run test\` - Run tests
5. \`bun run build\` - Build for production

## Code Standards
- TypeScript strict mode enabled
- ESLint for code quality
- Prettier for formatting
`,
};

const PYTHON_CLAUDE_TEMPLATE: AgentConfigTemplate = {
  id: "python-claude",
  name: "Python - Claude",
  description: "Claude Code configuration for Python projects",
  provider: "claude",
  configType: "CLAUDE.md",
  tags: ["python", "uv", "ruff"],
  projectType: "python",
  content: `# CLAUDE.md - Python Project

## Project Overview
Python project managed with uv.

## Package Manager
**ALWAYS use uv** for Python operations:
- \`uv sync\` - Install dependencies
- \`uv run pytest\` - Run tests
- \`uv run ruff check --fix\` - Lint and fix
- \`uv add <package>\` - Add dependency

## Code Quality
- Run \`uv run ruff check --fix && uv run ruff format\` before commits
- Use type hints for function signatures
- Write docstrings for public functions

## Testing
- Use pytest for testing
- Aim for high test coverage
- Mock external services in tests

## Commands
\`\`\`bash
uv sync                    # Install dependencies
uv run pytest              # Run tests
uv run ruff check --fix    # Lint
uv run ruff format         # Format
uv run mypy .              # Type check
\`\`\`
`,
};

const PYTHON_CODEX_TEMPLATE: AgentConfigTemplate = {
  id: "python-codex",
  name: "Python - Codex",
  description: "OpenAI Codex configuration for Python projects",
  provider: "codex",
  configType: "AGENTS.md",
  tags: ["python", "uv"],
  projectType: "python",
  content: `# AGENTS.md - Python Project

## Package Manager
Use uv (not pip):
- \`uv sync\` for dependencies
- \`uv run\` to execute commands

## Quality Checks
- \`uv run ruff check --fix\` - Linting
- \`uv run pytest\` - Testing
- \`uv run mypy .\` - Type checking
`,
};

const PYTHON_GEMINI_TEMPLATE: AgentConfigTemplate = {
  id: "python-gemini",
  name: "Python - Gemini",
  description: "Gemini CLI configuration for Python projects",
  provider: "gemini",
  configType: "GEMINI.md",
  tags: ["python", "uv"],
  projectType: "python",
  content: `# GEMINI.md - Python Project

## Development Setup
Python project using uv for package management.

## Commands
- \`uv sync\` - Sync dependencies
- \`uv run pytest\` - Run tests
- \`uv run ruff check --fix\` - Fix linting issues
`,
};

const RUST_CLAUDE_TEMPLATE: AgentConfigTemplate = {
  id: "rust-claude",
  name: "Rust - Claude",
  description: "Claude Code configuration for Rust projects",
  provider: "claude",
  configType: "CLAUDE.md",
  tags: ["rust", "cargo"],
  projectType: "rust",
  content: `# CLAUDE.md - Rust Project

## Project Overview
Rust project managed with Cargo.

## Commands
\`\`\`bash
cargo build          # Build project
cargo run            # Run project
cargo test           # Run tests
cargo clippy         # Lint
cargo fmt            # Format code
cargo doc --open     # Generate docs
\`\`\`

## Code Quality
- Run \`cargo clippy\` before commits
- Use \`cargo fmt\` for consistent formatting
- Add documentation comments for public items
- Handle all Result/Option types explicitly

## Best Practices
- Prefer \`&str\` over \`String\` for function parameters
- Use descriptive error types
- Leverage the type system for safety
`,
};

const REACT_CLAUDE_TEMPLATE: AgentConfigTemplate = {
  id: "react-claude",
  name: "React - Claude",
  description: "Claude Code configuration for React projects",
  provider: "claude",
  configType: "CLAUDE.md",
  tags: ["react", "typescript", "frontend"],
  projectType: "typescript",
  content: `# CLAUDE.md - React Project

## Project Overview
React application with TypeScript.

## Component Guidelines
- Use functional components with hooks
- Keep components small and focused
- Colocate related files (Component, test, styles)
- Use TypeScript for prop types

## State Management
- Prefer local state when possible
- Use Context for shared state
- Consider external store for complex state

## Commands
\`\`\`bash
bun run dev     # Development server
bun run build   # Production build
bun run test    # Run tests
bun run lint    # Lint code
\`\`\`

## Best Practices
- Memoize expensive computations
- Use proper key props in lists
- Avoid inline functions in render
`,
};

const NEXTJS_CLAUDE_TEMPLATE: AgentConfigTemplate = {
  id: "nextjs-claude",
  name: "Next.js - Claude",
  description: "Claude Code configuration for Next.js projects",
  provider: "claude",
  configType: "CLAUDE.md",
  tags: ["nextjs", "react", "typescript"],
  projectType: "typescript",
  content: `# CLAUDE.md - Next.js Project

## Project Overview
Next.js application with App Router and TypeScript.

## File Structure
- \`app/\` - App Router pages and layouts
- \`components/\` - Reusable UI components
- \`lib/\` - Utility functions and services
- \`public/\` - Static assets

## Commands
\`\`\`bash
bun run dev      # Development server (port 3000)
bun run build    # Production build
bun run start    # Production server
bun run lint     # ESLint
bun run typecheck # TypeScript checks
\`\`\`

## Routing
- Use App Router conventions
- Prefer Server Components by default
- Use 'use client' only when needed
- Implement loading.tsx for suspense

## Data Fetching
- Fetch in Server Components when possible
- Use React Query for client-side fetching
- Implement proper error boundaries
`,
};

const TYPESCRIPT_OPENCODE_TEMPLATE: AgentConfigTemplate = {
  id: "typescript-opencode",
  name: "TypeScript - OpenCode",
  description: "OpenCode configuration for TypeScript/Node.js projects",
  provider: "opencode",
  configType: "OPENCODE.md",
  tags: ["typescript", "javascript", "node", "bun"],
  projectType: "typescript",
  content: `# OPENCODE.md - TypeScript Project

## Project Overview
This is a TypeScript project. OpenCode provides multi-provider AI assistance.

## Code Style
- Use TypeScript strict mode
- Prefer \`const\` over \`let\`, avoid \`var\`
- Use async/await over Promises where possible
- Use descriptive variable and function names
- Add JSDoc comments for public APIs

## Commands
\`\`\`bash
# Development
bun run dev        # Start development server
bun run build      # Build for production
bun run typecheck  # Run TypeScript type checking
bun run lint       # Run ESLint
bun run test       # Run tests
\`\`\`

## Provider Configuration
OpenCode supports multiple AI providers. Configure your preferred provider in settings.

## Testing
- Write tests for new functionality
- Use describe/it pattern for test organization
- Mock external dependencies
`,
};

const PYTHON_OPENCODE_TEMPLATE: AgentConfigTemplate = {
  id: "python-opencode",
  name: "Python - OpenCode",
  description: "OpenCode configuration for Python projects",
  provider: "opencode",
  configType: "OPENCODE.md",
  tags: ["python", "uv", "ruff"],
  projectType: "python",
  content: `# OPENCODE.md - Python Project

## Project Overview
Python project managed with uv. OpenCode provides multi-provider AI assistance.

## Package Manager
**ALWAYS use uv** for Python operations:
- \`uv sync\` - Install dependencies
- \`uv run pytest\` - Run tests
- \`uv run ruff check --fix\` - Lint and fix
- \`uv add <package>\` - Add dependency

## Code Quality
- Run \`uv run ruff check --fix && uv run ruff format\` before commits
- Use type hints for function signatures
- Write docstrings for public functions

## Provider Configuration
OpenCode supports multiple AI providers. Configure in ~/.config/opencode/config.json

## Commands
\`\`\`bash
uv sync                    # Install dependencies
uv run pytest              # Run tests
uv run ruff check --fix    # Lint
uv run ruff format         # Format
uv run mypy .              # Type check
\`\`\`
`,
};

const RUST_OPENCODE_TEMPLATE: AgentConfigTemplate = {
  id: "rust-opencode",
  name: "Rust - OpenCode",
  description: "OpenCode configuration for Rust projects",
  provider: "opencode",
  configType: "OPENCODE.md",
  tags: ["rust", "cargo"],
  projectType: "rust",
  content: `# OPENCODE.md - Rust Project

## Project Overview
Rust project managed with Cargo. OpenCode provides multi-provider AI assistance.

## Commands
\`\`\`bash
cargo build          # Build project
cargo run            # Run project
cargo test           # Run tests
cargo clippy         # Lint
cargo fmt            # Format code
cargo doc --open     # Generate docs
\`\`\`

## Code Quality
- Run \`cargo clippy\` before commits
- Use \`cargo fmt\` for consistent formatting
- Add documentation comments for public items
- Handle all Result/Option types explicitly

## Provider Configuration
OpenCode supports multiple AI providers. Configure in ~/.config/opencode/config.json
`,
};

// Collection of all built-in templates
const BUILT_IN_TEMPLATES: AgentConfigTemplate[] = [
  TYPESCRIPT_CLAUDE_TEMPLATE,
  TYPESCRIPT_CODEX_TEMPLATE,
  TYPESCRIPT_GEMINI_TEMPLATE,
  TYPESCRIPT_OPENCODE_TEMPLATE,
  PYTHON_CLAUDE_TEMPLATE,
  PYTHON_CODEX_TEMPLATE,
  PYTHON_GEMINI_TEMPLATE,
  PYTHON_OPENCODE_TEMPLATE,
  RUST_CLAUDE_TEMPLATE,
  RUST_OPENCODE_TEMPLATE,
  REACT_CLAUDE_TEMPLATE,
  NEXTJS_CLAUDE_TEMPLATE,
];

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get all available templates
 */
export function getAllTemplates(): AgentConfigTemplate[] {
  return BUILT_IN_TEMPLATES;
}

/**
 * Get templates filtered by project type
 */
export function getTemplatesByProjectType(
  projectType: string
): AgentConfigTemplate[] {
  return BUILT_IN_TEMPLATES.filter((t) => t.projectType === projectType);
}

/**
 * Get templates filtered by provider
 */
export function getTemplatesByProvider(
  provider: AgentProvider
): AgentConfigTemplate[] {
  return BUILT_IN_TEMPLATES.filter((t) => t.provider === provider);
}

/**
 * Get templates filtered by tags
 */
export function getTemplatesByTags(tags: string[]): AgentConfigTemplate[] {
  return BUILT_IN_TEMPLATES.filter((t) =>
    tags.some((tag) => t.tags.includes(tag))
  );
}

/**
 * Get a template by ID
 */
export function getTemplateById(id: string): AgentConfigTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}

/**
 * Apply a template to a folder
 * Creates or updates the config in the folder
 */
export async function applyTemplateToFolder(
  templateId: string,
  folderId: string,
  userId: string
): Promise<void> {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new TemplateServiceError(
      `Template '${templateId}' not found`,
      "TEMPLATE_NOT_FOUND"
    );
  }

  await AgentConfigService.upsertConfig(userId, {
    folderId,
    provider: template.provider,
    configType: template.configType,
    content: template.content,
  });
}

/**
 * Apply all templates for a project type to a folder
 * Applies all provider configs for the given project type
 */
export async function applyProjectTypeTemplates(
  projectType: string,
  folderId: string,
  userId: string
): Promise<AgentConfigTemplate[]> {
  const templates = getTemplatesByProjectType(projectType);

  for (const template of templates) {
    await AgentConfigService.upsertConfig(userId, {
      folderId,
      provider: template.provider,
      configType: template.configType,
      content: template.content,
    });
  }

  return templates;
}

/**
 * Get all unique project types
 */
export function getProjectTypes(): string[] {
  const types = new Set(BUILT_IN_TEMPLATES.map((t) => t.projectType));
  return Array.from(types).sort();
}

/**
 * Get all unique tags
 */
export function getAllTags(): string[] {
  const tags = new Set(BUILT_IN_TEMPLATES.flatMap((t) => t.tags));
  return Array.from(tags).sort();
}

// Re-export error class from centralized location for backwards compatibility
export { TemplateServiceError } from "@/lib/errors";
