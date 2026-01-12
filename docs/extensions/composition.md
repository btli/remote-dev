# Extension Composition

The rdv-sdk extension system provides a powerful composition framework for building agent capabilities. Extensions can declare dependencies, implement traits, and compose together into cohesive stacks.

## Table of Contents

- [Extension Traits](#extension-traits)
- [Dependencies](#dependencies)
- [Composition Builder](#composition-builder)
- [Prebuilt Compositions](#prebuilt-compositions)
- [Dependency Resolution](#dependency-resolution)
- [Examples](#examples)

## Extension Traits

Extensions are classified by their primary function using the `ExtensionTrait` enum:

```rust
pub enum ExtensionTrait {
    Perception,    // Gathers information from the environment
    Reasoning,     // Analyzes, transforms, and derives insights
    Action,        // Modifies state or performs operations
    Memory,        // Stores and retrieves information
    UI,            // User interface components
    Orchestration, // Coordinates other extensions
}
```

### Trait Descriptions

| Trait | Purpose | Examples |
|-------|---------|----------|
| **Perception** | Gather information from environment | File reading, web scraping, API polling |
| **Reasoning** | Analyze and transform data | Code analysis, pattern detection, planning |
| **Action** | Execute operations, modify state | File writing, shell commands, API calls |
| **Memory** | Store and retrieve information | Vector stores, caches, session history |
| **UI** | Render information to users | Status panels, progress indicators |
| **Orchestration** | Coordinate multiple extensions | Workflow engines, task schedulers |

### Mapping from Capabilities

Traits are automatically derived from extension capabilities:

```rust
impl ExtensionTrait {
    pub fn from_capabilities(capabilities: &[ExtensionCapability]) -> Vec<Self> {
        capabilities.iter().filter_map(|cap| {
            match cap {
                ExtensionCapability::Tools => Some(Self::Action),
                ExtensionCapability::Prompts => Some(Self::Reasoning),
                ExtensionCapability::Resources => Some(Self::Perception),
                ExtensionCapability::Memory => Some(Self::Memory),
                ExtensionCapability::UI => Some(Self::UI),
            }
        }).collect()
    }
}
```

## Dependencies

Extensions can declare dependencies on other extensions:

```rust
pub struct ExtensionDependency {
    /// Extension identifier
    pub id: String,

    /// Version constraint (semver)
    pub version: String,

    /// Whether the dependency is optional
    pub optional: bool,

    /// Required features from the dependency
    pub features: Vec<String>,
}
```

### Creating Dependencies

```rust
use rdv_sdk::extensions::ExtensionDependency;

// Required dependency
let core_dep = ExtensionDependency::required("core-tools", "^1.0");

// Optional dependency
let viz_dep = ExtensionDependency::optional("visualization", ">=2.0");

// Dependency with specific features
let mem_dep = ExtensionDependency::required("memory", "^1.0")
    .with_features(vec!["vector-store", "semantic-search"]);
```

## Composition Builder

The `ExtensionComposer` provides a fluent API for composing extensions:

```rust
use rdv_sdk::extensions::ExtensionComposer;

let stack = ExtensionComposer::new("my-agent")
    // Add perception extensions (gather information)
    .with_perception("file-reader")
    .with_perception("web-scraper")

    // Add reasoning extensions (analyze and plan)
    .with_reasoning("code-analyzer")
    .with_reasoning("planner")

    // Add action extensions (execute operations)
    .with_action("shell-executor")
    .with_action("file-writer")

    // Add memory extension (store context)
    .with_memory("vector-memory")

    // Build the composition
    .build()?;

// Access the ordered extension list
for ext_id in stack.extensions() {
    println!("Loading: {}", ext_id);
}
```

### Builder Methods

| Method | Description |
|--------|-------------|
| `with_perception(id)` | Add a perception extension |
| `with_reasoning(id)` | Add a reasoning extension |
| `with_action(id)` | Add an action extension |
| `with_memory(id)` | Add a memory extension |
| `with_extension(id, trait)` | Add an extension with explicit trait |
| `with_config(config)` | Apply a configuration preset |
| `build()` | Resolve dependencies and build stack |

### Extension Metadata

The builder collects metadata about each extension:

```rust
pub struct ExtensionMetadata {
    pub id: String,
    pub traits: Vec<ExtensionTrait>,
}
```

## Prebuilt Compositions

Common extension combinations are available as presets:

### Minimal

A lightweight composition for simple tasks:

```rust
use rdv_sdk::extensions::presets;

let stack = presets::minimal()
    .with_action("custom-tool")
    .build()?;

// Includes: file-reader, shell
```

### Development

Full-featured development environment:

```rust
let stack = presets::development()
    .build()?;

// Includes: file-reader, git, lsp, code-analyzer,
//           shell, file-writer, session-memory
```

### Web Development

Specialized for web development tasks:

```rust
let stack = presets::web_development()
    .build()?;

// Includes: development preset +
//           browser-automation, api-client,
//           frontend-analyzer, css-tools
```

### Data Science

For data analysis and ML workflows:

```rust
let stack = presets::data_science()
    .build()?;

// Includes: file-reader, database-client,
//           data-analyzer, visualization,
//           notebook-executor, model-runner,
//           experiment-memory
```

## Dependency Resolution

The `DependencyResolver` handles extension ordering and cycle detection:

```rust
use rdv_sdk::extensions::DependencyResolver;
use std::collections::HashMap;

// Create resolver with available extensions
let mut manifests: HashMap<String, ExtensionManifest> = HashMap::new();
// ... populate manifests ...

let mut resolver = DependencyResolver::new(manifests);

// Resolve a set of extensions
let load_order = resolver.resolve(&[
    "code-analyzer",
    "shell-executor",
    "file-writer",
])?;

// Extensions are returned in dependency-first order
for ext_id in load_order {
    println!("Load: {}", ext_id);
}
```

### Circular Dependency Detection

The resolver detects circular dependencies:

```rust
// This will fail with CompositionError::CircularDependency
let result = resolver.resolve(&["ext-a"]);
// If ext-a depends on ext-b, and ext-b depends on ext-a

match result {
    Err(CompositionError::CircularDependency(chain)) => {
        println!("Cycle detected: {:?}", chain);
        // e.g., ["ext-a", "ext-b", "ext-a"]
    }
    _ => {}
}
```

## Examples

### Custom Agent with Dependencies

```rust
use rdv_sdk::extensions::{
    ExtensionComposer, ExtensionDependency, ExtensionTrait,
};

// Define a custom extension with dependencies
let code_reviewer = ExtensionManifest::builder("code-reviewer")
    .description("AI-powered code review")
    .capabilities(vec![
        ExtensionCapability::Tools,
        ExtensionCapability::Prompts,
    ])
    .build();

// Compose agent with the custom extension
let stack = ExtensionComposer::new("review-agent")
    .with_perception("file-reader")
    .with_perception("git")
    .with_reasoning("code-analyzer")
    .with_extension("code-reviewer", ExtensionTrait::Reasoning)
    .with_action("comment-writer")
    .with_memory("review-history")
    .build()?;
```

### Multi-Repository Development Agent

```rust
let stack = presets::development()
    // Add multi-repo support
    .with_perception("repo-scanner")
    .with_reasoning("cross-repo-analyzer")
    .with_action("worktree-manager")
    .with_memory("project-graph")
    .build()?;

// Stack now includes all development tools plus
// multi-repository capabilities
```

### Incremental Composition

```rust
// Start with minimal setup
let mut composer = presets::minimal();

// Conditionally add extensions based on project type
if project.has_web_frontend() {
    composer = composer
        .with_perception("browser-automation")
        .with_reasoning("frontend-analyzer");
}

if project.has_python() {
    composer = composer
        .with_action("python-runner")
        .with_reasoning("python-analyzer");
}

let stack = composer.build()?;
```

## Error Handling

The composition system uses typed errors:

```rust
pub enum CompositionError {
    /// Extension not found in registry
    ExtensionNotFound(String),

    /// Circular dependency detected
    CircularDependency(Vec<String>),

    /// Dependency version mismatch
    VersionMismatch {
        extension: String,
        required: String,
        available: String
    },

    /// Required feature not available
    MissingFeature {
        extension: String,
        feature: String
    },
}
```

### Handling Errors

```rust
use rdv_sdk::extensions::{ExtensionComposer, CompositionError};

match ExtensionComposer::new("my-agent")
    .with_action("unknown-extension")
    .build()
{
    Ok(stack) => {
        // Use the stack
    }
    Err(CompositionError::ExtensionNotFound(id)) => {
        eprintln!("Extension '{}' not found. Install it first.", id);
    }
    Err(CompositionError::CircularDependency(chain)) => {
        eprintln!("Circular dependency: {}", chain.join(" -> "));
    }
    Err(e) => {
        eprintln!("Composition failed: {:?}", e);
    }
}
```

## Best Practices

### 1. Use Traits for Clarity

Explicitly categorize extensions by their primary function:

```rust
// Good: Clear trait assignment
composer.with_perception("code-scanner")
        .with_reasoning("vulnerability-detector")
        .with_action("patch-applier");

// Avoid: Ambiguous without trait context
composer.with_extension("security-tool", ExtensionTrait::Action);
```

### 2. Keep Dependencies Minimal

Only declare dependencies that are truly required:

```rust
// Good: Minimal dependencies
ExtensionDependency::required("core-utils", "^1.0")

// Avoid: Overly broad dependencies
ExtensionDependency::required("mega-toolkit", "*")
    .with_features(vec!["feature1", "feature2", ..., "feature50"])
```

### 3. Use Presets as Starting Points

Start with presets and customize:

```rust
// Good: Start from preset, add specifics
presets::development()
    .with_action("custom-deployer")
    .build()

// Avoid: Rebuilding common stacks from scratch
ExtensionComposer::new("dev")
    .with_perception("file-reader")
    .with_perception("git")
    // ... 20 more common extensions ...
    .build()
```

### 4. Handle Optional Dependencies Gracefully

```rust
let dep = ExtensionDependency::optional("enhanced-viz", "^2.0");

// In your extension, check if optional dep is available
if stack.has_extension("enhanced-viz") {
    // Use enhanced visualization
} else {
    // Fall back to basic output
}
```

## See Also

- [Extension System Overview](./README.md)
- [Building Custom Extensions](./building-extensions.md)
- [MCP Integration](./mcp-integration.md)
- [arXiv 2512.10398v5](https://arxiv.org/abs/2512.10398) - Agent UX patterns reference
