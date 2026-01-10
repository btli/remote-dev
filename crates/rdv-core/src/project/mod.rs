//! Project detection and metadata.
//!
//! Provides basic project type detection for session creation.
//! For comprehensive metadata enrichment, see the TypeScript MCP tools.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tracing::debug;

/// Detected project information.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectInfo {
    /// Primary programming language
    pub primary_language: Option<String>,
    /// Detected framework (nextjs, fastapi, etc.)
    pub framework: Option<String>,
    /// Package manager (bun, npm, pip, cargo, etc.)
    pub package_manager: Option<String>,
    /// Project category (web, api, cli, etc.)
    pub category: Option<String>,
    /// Whether TypeScript is used
    pub has_typescript: bool,
    /// Whether project has tests
    pub has_tests: bool,
    /// Suggested dev command
    pub dev_command: Option<String>,
}

/// Quickly detect basic project information.
///
/// This is a fast, non-exhaustive detection for session creation.
/// For comprehensive detection, use the TypeScript ProjectMetadataService.
pub fn detect_project(project_path: &Path) -> Result<ProjectInfo> {
    let mut info = ProjectInfo::default();

    // Detect by config files (in priority order)

    // JavaScript/TypeScript (check for Next.js first, then others)
    if exists(project_path, "next.config.js")
        || exists(project_path, "next.config.ts")
        || exists(project_path, "next.config.mjs")
    {
        info.framework = Some("nextjs".to_string());
        info.primary_language = Some("typescript".to_string());
        info.category = Some("web-fullstack".to_string());
        info.has_typescript = true;
    } else if exists(project_path, "nuxt.config.js") || exists(project_path, "nuxt.config.ts") {
        info.framework = Some("nuxt".to_string());
        info.primary_language = Some("typescript".to_string());
        info.category = Some("web-fullstack".to_string());
    } else if exists(project_path, "vite.config.js") || exists(project_path, "vite.config.ts") {
        info.framework = Some("vite".to_string());
        info.primary_language = Some("typescript".to_string());
        info.category = Some("web-frontend".to_string());
    } else if exists(project_path, "svelte.config.js") {
        info.framework = Some("sveltekit".to_string());
        info.primary_language = Some("typescript".to_string());
        info.category = Some("web-fullstack".to_string());
    }

    // Python
    if exists(project_path, "pyproject.toml") || exists(project_path, "requirements.txt") {
        if info.framework.is_none() {
            info.primary_language = Some("python".to_string());
            // Check for framework hints in pyproject.toml
            if let Ok(content) = fs::read_to_string(project_path.join("pyproject.toml")) {
                if content.contains("fastapi") {
                    info.framework = Some("fastapi".to_string());
                    info.category = Some("api".to_string());
                } else if content.contains("django") {
                    info.framework = Some("django".to_string());
                    info.category = Some("web-fullstack".to_string());
                } else if content.contains("flask") {
                    info.framework = Some("flask".to_string());
                    info.category = Some("api".to_string());
                } else if content.contains("typer") || content.contains("click") {
                    info.category = Some("cli".to_string());
                }
            }
        }
    }

    // Rust
    if exists(project_path, "Cargo.toml") {
        if info.framework.is_none() {
            info.primary_language = Some("rust".to_string());
            // Check for framework hints
            if let Ok(content) = fs::read_to_string(project_path.join("Cargo.toml")) {
                if content.contains("axum") {
                    info.framework = Some("axum".to_string());
                    info.category = Some("api".to_string());
                } else if content.contains("actix-web") {
                    info.framework = Some("actix".to_string());
                    info.category = Some("api".to_string());
                } else if content.contains("clap") {
                    info.category = Some("cli".to_string());
                }
            }
        }
    }

    // Go
    if exists(project_path, "go.mod") {
        if info.framework.is_none() {
            info.primary_language = Some("go".to_string());
            if let Ok(content) = fs::read_to_string(project_path.join("go.mod")) {
                if content.contains("gin-gonic") {
                    info.framework = Some("gin".to_string());
                    info.category = Some("api".to_string());
                } else if content.contains("cobra") {
                    info.category = Some("cli".to_string());
                }
            }
        }
    }

    // Detect package manager
    if exists(project_path, "bun.lockb") {
        info.package_manager = Some("bun".to_string());
    } else if exists(project_path, "pnpm-lock.yaml") {
        info.package_manager = Some("pnpm".to_string());
    } else if exists(project_path, "yarn.lock") {
        info.package_manager = Some("yarn".to_string());
    } else if exists(project_path, "package-lock.json") {
        info.package_manager = Some("npm".to_string());
    } else if exists(project_path, "uv.lock") {
        info.package_manager = Some("uv".to_string());
    } else if exists(project_path, "requirements.txt") || exists(project_path, "pyproject.toml") {
        if info.package_manager.is_none() {
            info.package_manager = Some("pip".to_string());
        }
    } else if exists(project_path, "Cargo.toml") {
        info.package_manager = Some("cargo".to_string());
    } else if exists(project_path, "go.mod") {
        info.package_manager = Some("go".to_string());
    }

    // Detect TypeScript
    if exists(project_path, "tsconfig.json") {
        info.has_typescript = true;
        if info.primary_language.is_none() {
            info.primary_language = Some("typescript".to_string());
        }
    }

    // Detect tests
    info.has_tests = exists(project_path, "vitest.config.ts")
        || exists(project_path, "jest.config.js")
        || exists(project_path, "jest.config.ts")
        || exists(project_path, "pytest.ini")
        || (exists(project_path, "pyproject.toml")
            && fs::read_to_string(project_path.join("pyproject.toml"))
                .map(|c| c.contains("pytest"))
                .unwrap_or(false));

    // Generate dev command suggestion
    info.dev_command = generate_dev_command(&info);

    debug!("Detected project info for {:?}: {:?}", project_path, info);
    Ok(info)
}

/// Check if a file exists in the project.
fn exists(project_path: &Path, filename: &str) -> bool {
    project_path.join(filename).exists()
}

/// Generate a suggested dev command based on detected info.
fn generate_dev_command(info: &ProjectInfo) -> Option<String> {
    let pm = info.package_manager.as_deref();

    match info.framework.as_deref() {
        Some("nextjs") | Some("vite") | Some("nuxt") | Some("sveltekit") => {
            let cmd = match pm {
                Some("bun") => "bun run dev",
                Some("pnpm") => "pnpm dev",
                Some("yarn") => "yarn dev",
                _ => "npm run dev",
            };
            Some(cmd.to_string())
        }
        Some("fastapi") => Some("uvicorn main:app --reload".to_string()),
        Some("django") => Some("python manage.py runserver".to_string()),
        Some("flask") => Some("flask run --reload".to_string()),
        _ => match pm {
            Some("cargo") => Some("cargo run".to_string()),
            Some("go") => Some("go run .".to_string()),
            _ => None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::tempdir;

    #[test]
    fn test_detect_nextjs_project() {
        let dir = tempdir().unwrap();
        File::create(dir.path().join("next.config.ts")).unwrap();
        File::create(dir.path().join("bun.lockb")).unwrap();

        let info = detect_project(dir.path()).unwrap();
        assert_eq!(info.framework.as_deref(), Some("nextjs"));
        assert_eq!(info.package_manager.as_deref(), Some("bun"));
        assert!(info.has_typescript);
    }

    #[test]
    fn test_detect_rust_project() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[package]\nname = \"test\"").unwrap();

        let info = detect_project(dir.path()).unwrap();
        assert_eq!(info.primary_language.as_deref(), Some("rust"));
        assert_eq!(info.package_manager.as_deref(), Some("cargo"));
    }

    #[test]
    fn test_detect_python_fastapi() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("pyproject.toml"),
            "[project]\ndependencies = [\"fastapi\"]",
        )
        .unwrap();

        let info = detect_project(dir.path()).unwrap();
        assert_eq!(info.primary_language.as_deref(), Some("python"));
        assert_eq!(info.framework.as_deref(), Some("fastapi"));
    }
}
