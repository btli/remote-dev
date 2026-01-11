//! Provider-Specific Configuration Generators
//!
//! Implements the ProviderConfigGenerator trait for each supported agent provider,
//! generating optimized system prompts and instructions files based on task
//! specifications and project context.

use async_trait::async_trait;

use crate::SDKResult;
use super::traits::ProviderConfigGenerator;
use super::types::{AgentProvider, TaskSpec, TaskType, ProjectContext};

// ─────────────────────────────────────────────────────────────────────────────
// Claude Config Generator
// ─────────────────────────────────────────────────────────────────────────────

/// Configuration generator for Claude Code (CLAUDE.md format)
pub struct ClaudeConfigGenerator;

#[async_trait(?Send)]
impl ProviderConfigGenerator for ClaudeConfigGenerator {
    async fn generate_system_prompt(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
    ) -> SDKResult<String> {
        let mut prompt = String::new();

        // Role and context
        prompt.push_str(&format!(
            "You are an expert {} developer working on a {} project.\n\n",
            context.language, context.project_type
        ));

        // Task-specific guidance
        match task.task_type {
            TaskType::Feature => {
                prompt.push_str("Your goal is to implement a new feature following best practices.\n");
                prompt.push_str("Focus on clean, maintainable code with proper error handling.\n");
            }
            TaskType::Bugfix => {
                prompt.push_str("Your goal is to identify and fix the bug.\n");
                prompt.push_str("Start by understanding the root cause before making changes.\n");
            }
            TaskType::Refactor => {
                prompt.push_str("Your goal is to improve code quality without changing behavior.\n");
                prompt.push_str("Ensure all existing tests pass after refactoring.\n");
            }
            TaskType::Test => {
                prompt.push_str("Your goal is to write comprehensive tests.\n");
                prompt.push_str("Cover edge cases and ensure good test isolation.\n");
            }
            TaskType::Docs => {
                prompt.push_str("Your goal is to write clear, helpful documentation.\n");
                prompt.push_str("Include examples and explain the 'why' not just the 'what'.\n");
            }
            TaskType::Review => {
                prompt.push_str("Your goal is to review code for quality and correctness.\n");
                prompt.push_str("Look for bugs, security issues, and maintainability concerns.\n");
            }
        }

        // Framework-specific guidance
        if !context.frameworks.is_empty() {
            prompt.push_str(&format!(
                "\nFrameworks in use: {}\n",
                context.frameworks.join(", ")
            ));
        }

        // Package manager
        prompt.push_str(&format!(
            "Use {} for package management.\n",
            context.package_manager
        ));

        Ok(prompt)
    }

    async fn generate_instructions(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
    ) -> SDKResult<String> {
        let mut instructions = String::new();

        // Header
        instructions.push_str(&format!(
            "# CLAUDE.md - {}\n\n",
            context.project_type.to_uppercase()
        ));

        // Project overview
        instructions.push_str("## Project Overview\n\n");
        instructions.push_str(&format!(
            "This is a {} project using {}.\n",
            context.project_type, context.language
        ));

        if !context.frameworks.is_empty() {
            instructions.push_str(&format!(
                "Frameworks: {}\n",
                context.frameworks.join(", ")
            ));
        }
        instructions.push('\n');

        // Current task
        instructions.push_str("## Current Task\n\n");
        instructions.push_str(&format!("{}\n\n", task.description));

        // Acceptance criteria
        if !task.acceptance_criteria.is_empty() {
            instructions.push_str("### Acceptance Criteria\n\n");
            for criterion in &task.acceptance_criteria {
                instructions.push_str(&format!("- {}\n", criterion));
            }
            instructions.push('\n');
        }

        // Relevant files
        if !task.relevant_files.is_empty() {
            instructions.push_str("### Relevant Files\n\n");
            for file in &task.relevant_files {
                instructions.push_str(&format!("- `{}`\n", file));
            }
            instructions.push('\n');
        }

        // Constraints
        if !task.constraints.is_empty() {
            instructions.push_str("### Constraints\n\n");
            for constraint in &task.constraints {
                instructions.push_str(&format!("- {}\n", constraint));
            }
            instructions.push('\n');
        }

        // Commands section
        instructions.push_str("## Commands\n\n");
        instructions.push_str("```bash\n");
        instructions.push_str(&format!("# Development\n{} run dev\n\n", context.package_manager));

        if let Some(ref test_framework) = context.test_framework {
            instructions.push_str(&format!("# Testing\n{} run test\n\n", context.package_manager));
            instructions.push_str(&format!("# Test Framework: {}\n", test_framework));
        }

        if let Some(ref linter) = context.linter {
            instructions.push_str(&format!("\n# Linting\n{} run lint\n", context.package_manager));
            instructions.push_str(&format!("# Linter: {}\n", linter));
        }
        instructions.push_str("```\n\n");

        // Code style based on language
        instructions.push_str("## Code Style\n\n");
        match context.language.to_lowercase().as_str() {
            "typescript" | "javascript" => {
                instructions.push_str("- Use TypeScript strict mode when available\n");
                instructions.push_str("- Prefer `const` over `let`, avoid `var`\n");
                instructions.push_str("- Use async/await over Promises when possible\n");
                instructions.push_str("- Keep functions small and focused\n");
            }
            "python" => {
                instructions.push_str("- Follow PEP 8 style guidelines\n");
                instructions.push_str("- Use type hints for function signatures\n");
                instructions.push_str("- Prefer pathlib over os.path\n");
                instructions.push_str("- Use async/await for I/O operations\n");
            }
            "rust" => {
                instructions.push_str("- Follow Rust API guidelines\n");
                instructions.push_str("- Use `Result` and `Option` appropriately\n");
                instructions.push_str("- Prefer iterator methods over loops when clearer\n");
                instructions.push_str("- Document public APIs with rustdoc\n");
            }
            "go" => {
                instructions.push_str("- Follow Go idioms and effective Go guidelines\n");
                instructions.push_str("- Handle errors explicitly, don't ignore them\n");
                instructions.push_str("- Use interfaces for abstraction\n");
                instructions.push_str("- Keep packages focused and cohesive\n");
            }
            _ => {
                instructions.push_str("- Follow language-specific best practices\n");
                instructions.push_str("- Write clean, readable code\n");
                instructions.push_str("- Document complex logic\n");
            }
        }
        instructions.push('\n');

        // Testing section if test framework is available
        if context.test_framework.is_some() {
            instructions.push_str("## Testing\n\n");
            instructions.push_str("- Write tests for new functionality\n");
            instructions.push_str("- Ensure existing tests pass before committing\n");
            instructions.push_str("- Aim for meaningful test coverage, not just line coverage\n");
            instructions.push_str("- Test edge cases and error conditions\n\n");
        }

        // CI section if available
        if context.has_ci {
            instructions.push_str("## CI/CD\n\n");
            instructions.push_str("This project has CI configured. Ensure:\n");
            instructions.push_str("- All tests pass locally before pushing\n");
            instructions.push_str("- Linting passes without errors\n");
            instructions.push_str("- Build completes successfully\n\n");
        }

        Ok(instructions)
    }

    fn config_filename(&self) -> &'static str {
        "CLAUDE.md"
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Codex Config Generator
// ─────────────────────────────────────────────────────────────────────────────

/// Configuration generator for OpenAI Codex (AGENTS.md format)
pub struct CodexConfigGenerator;

#[async_trait(?Send)]
impl ProviderConfigGenerator for CodexConfigGenerator {
    async fn generate_system_prompt(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
    ) -> SDKResult<String> {
        // Codex benefits from more explicit, structured prompts
        let mut prompt = String::new();

        prompt.push_str(&format!(
            "Language: {}\nProject Type: {}\n\n",
            context.language, context.project_type
        ));

        prompt.push_str(&format!("Task Type: {:?}\n", task.task_type));
        prompt.push_str(&format!("Description: {}\n\n", task.description));

        prompt.push_str("Instructions:\n");
        prompt.push_str("1. Analyze the codebase structure\n");
        prompt.push_str("2. Plan your implementation approach\n");
        prompt.push_str("3. Write clean, well-documented code\n");
        prompt.push_str("4. Test your changes\n");

        Ok(prompt)
    }

    async fn generate_instructions(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
    ) -> SDKResult<String> {
        let mut instructions = String::new();

        // AGENTS.md format is simpler and more directive
        instructions.push_str(&format!(
            "# AGENTS.md - {} Project\n\n",
            context.project_type.to_uppercase()
        ));

        instructions.push_str("## Project Info\n\n");
        instructions.push_str(&format!("- Language: {}\n", context.language));
        instructions.push_str(&format!("- Package Manager: {}\n", context.package_manager));

        if let Some(ref test_framework) = context.test_framework {
            instructions.push_str(&format!("- Test Framework: {}\n", test_framework));
        }
        instructions.push('\n');

        instructions.push_str("## Task\n\n");
        instructions.push_str(&format!("{}\n\n", task.description));

        if !task.acceptance_criteria.is_empty() {
            instructions.push_str("## Requirements\n\n");
            for (i, criterion) in task.acceptance_criteria.iter().enumerate() {
                instructions.push_str(&format!("{}. {}\n", i + 1, criterion));
            }
            instructions.push('\n');
        }

        if !task.relevant_files.is_empty() {
            instructions.push_str("## Files to Modify\n\n");
            for file in &task.relevant_files {
                instructions.push_str(&format!("- {}\n", file));
            }
            instructions.push('\n');
        }

        Ok(instructions)
    }

    fn config_filename(&self) -> &'static str {
        "AGENTS.md"
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini Config Generator
// ─────────────────────────────────────────────────────────────────────────────

/// Configuration generator for Google Gemini CLI (GEMINI.md format)
pub struct GeminiConfigGenerator;

#[async_trait(?Send)]
impl ProviderConfigGenerator for GeminiConfigGenerator {
    async fn generate_system_prompt(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
    ) -> SDKResult<String> {
        let mut prompt = String::new();

        prompt.push_str(&format!(
            "You are assisting with a {} {} project.\n\n",
            context.language, context.project_type
        ));

        prompt.push_str(&format!("Current task: {}\n", task.description));
        prompt.push_str(&format!("Task type: {:?}\n\n", task.task_type));

        prompt.push_str("Guidelines:\n");
        prompt.push_str("- Provide clear explanations with your code\n");
        prompt.push_str("- Consider edge cases and error handling\n");
        prompt.push_str("- Follow the project's existing patterns\n");

        Ok(prompt)
    }

    async fn generate_instructions(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
    ) -> SDKResult<String> {
        let mut instructions = String::new();

        instructions.push_str(&format!(
            "# GEMINI.md - {} Configuration\n\n",
            context.project_type.to_uppercase()
        ));

        instructions.push_str("## Project Context\n\n");
        instructions.push_str(&format!(
            "This is a {} project written in {}.\n\n",
            context.project_type, context.language
        ));

        instructions.push_str("## Current Objective\n\n");
        instructions.push_str(&format!("{}\n\n", task.description));

        if !task.acceptance_criteria.is_empty() {
            instructions.push_str("## Success Criteria\n\n");
            for criterion in &task.acceptance_criteria {
                instructions.push_str(&format!("✓ {}\n", criterion));
            }
            instructions.push('\n');
        }

        instructions.push_str("## Development Commands\n\n");
        instructions.push_str("```\n");
        instructions.push_str(&format!("{} install    # Install dependencies\n", context.package_manager));
        instructions.push_str(&format!("{} run dev    # Start development\n", context.package_manager));
        instructions.push_str(&format!("{} run test   # Run tests\n", context.package_manager));
        instructions.push_str("```\n");

        Ok(instructions)
    }

    fn config_filename(&self) -> &'static str {
        "GEMINI.md"
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode Config Generator
// ─────────────────────────────────────────────────────────────────────────────

/// Configuration generator for OpenCode (OPENCODE.md format)
pub struct OpenCodeConfigGenerator;

#[async_trait(?Send)]
impl ProviderConfigGenerator for OpenCodeConfigGenerator {
    async fn generate_system_prompt(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
    ) -> SDKResult<String> {
        let mut prompt = String::new();

        prompt.push_str(&format!(
            "Project: {} ({})\n",
            context.project_type, context.language
        ));

        prompt.push_str(&format!("\nTask: {}\n", task.description));

        if !task.constraints.is_empty() {
            prompt.push_str("\nConstraints:\n");
            for constraint in &task.constraints {
                prompt.push_str(&format!("- {}\n", constraint));
            }
        }

        Ok(prompt)
    }

    async fn generate_instructions(
        &self,
        task: &TaskSpec,
        context: &ProjectContext,
    ) -> SDKResult<String> {
        let mut instructions = String::new();

        instructions.push_str(&format!(
            "# OPENCODE.md\n\n## {} Project\n\n",
            context.project_type.to_uppercase()
        ));

        instructions.push_str(&format!("Language: {}\n", context.language));
        instructions.push_str(&format!("Package Manager: {}\n\n", context.package_manager));

        instructions.push_str("## Task Description\n\n");
        instructions.push_str(&format!("{}\n\n", task.description));

        if !task.acceptance_criteria.is_empty() {
            instructions.push_str("## Acceptance Criteria\n\n");
            for criterion in &task.acceptance_criteria {
                instructions.push_str(&format!("- [ ] {}\n", criterion));
            }
            instructions.push('\n');
        }

        if !task.relevant_files.is_empty() {
            instructions.push_str("## Relevant Files\n\n");
            for file in &task.relevant_files {
                instructions.push_str(&format!("- `{}`\n", file));
            }
        }

        Ok(instructions)
    }

    fn config_filename(&self) -> &'static str {
        "OPENCODE.md"
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

/// Create a provider-specific configuration generator
pub fn create_config_generator(provider: AgentProvider) -> Box<dyn ProviderConfigGenerator> {
    match provider {
        AgentProvider::Claude => Box::new(ClaudeConfigGenerator),
        AgentProvider::Codex => Box::new(CodexConfigGenerator),
        AgentProvider::Gemini => Box::new(GeminiConfigGenerator),
        AgentProvider::Opencode => Box::new(OpenCodeConfigGenerator),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_task() -> TaskSpec {
        TaskSpec {
            id: "task-1".into(),
            task_type: TaskType::Feature,
            description: "Add user authentication with OAuth support".into(),
            acceptance_criteria: vec![
                "Users can sign in with Google".into(),
                "Users can sign in with GitHub".into(),
                "Session persists across page reloads".into(),
            ],
            complexity: Some(7),
            relevant_files: vec![
                "src/auth/oauth.ts".into(),
                "src/pages/api/auth/[...nextauth].ts".into(),
            ],
            constraints: vec![
                "Must use NextAuth.js".into(),
                "No storing plain-text passwords".into(),
            ],
            beads_issue_id: Some("beads-123".into()),
        }
    }

    fn sample_context() -> ProjectContext {
        ProjectContext {
            project_path: "/home/user/my-app".into(),
            project_type: "nextjs".into(),
            language: "typescript".into(),
            frameworks: vec!["react".into(), "next".into(), "tailwind".into()],
            package_manager: "bun".into(),
            test_framework: Some("vitest".into()),
            linter: Some("eslint".into()),
            has_ci: true,
            current_branch: Some("feature/auth".into()),
            folder_id: None,
        }
    }

    #[tokio::test]
    async fn test_claude_generator() {
        let generator = ClaudeConfigGenerator;
        let task = sample_task();
        let context = sample_context();

        let system_prompt = generator.generate_system_prompt(&task, &context).await.unwrap();
        assert!(system_prompt.contains("typescript"));
        assert!(system_prompt.contains("nextjs"));

        let instructions = generator.generate_instructions(&task, &context).await.unwrap();
        assert!(instructions.contains("# CLAUDE.md"));
        assert!(instructions.contains("OAuth"));
        assert!(instructions.contains("bun run"));

        assert_eq!(generator.config_filename(), "CLAUDE.md");
    }

    #[tokio::test]
    async fn test_codex_generator() {
        let generator = CodexConfigGenerator;
        let task = sample_task();
        let context = sample_context();

        let instructions = generator.generate_instructions(&task, &context).await.unwrap();
        assert!(instructions.contains("# AGENTS.md"));
        assert!(instructions.contains("typescript"));

        assert_eq!(generator.config_filename(), "AGENTS.md");
    }

    #[tokio::test]
    async fn test_gemini_generator() {
        let generator = GeminiConfigGenerator;
        let task = sample_task();
        let context = sample_context();

        let instructions = generator.generate_instructions(&task, &context).await.unwrap();
        assert!(instructions.contains("# GEMINI.md"));
        assert!(instructions.contains("Success Criteria"));

        assert_eq!(generator.config_filename(), "GEMINI.md");
    }

    #[tokio::test]
    async fn test_opencode_generator() {
        let generator = OpenCodeConfigGenerator;
        let task = sample_task();
        let context = sample_context();

        let instructions = generator.generate_instructions(&task, &context).await.unwrap();
        assert!(instructions.contains("# OPENCODE.md"));
        assert!(instructions.contains("- [ ]")); // Checkbox format

        assert_eq!(generator.config_filename(), "OPENCODE.md");
    }

    #[tokio::test]
    async fn test_factory_function() {
        let generator = create_config_generator(AgentProvider::Claude);
        assert_eq!(generator.config_filename(), "CLAUDE.md");

        let generator = create_config_generator(AgentProvider::Codex);
        assert_eq!(generator.config_filename(), "AGENTS.md");
    }
}
