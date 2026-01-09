/**
 * ProjectType - Value object representing the classification of a project.
 *
 * Projects can have:
 * 1. A primary category (e.g., web, cli, library)
 * 2. A framework (e.g., nextjs, fastapi, express)
 * 3. Language(s) used
 *
 * This value object encapsulates the rules for valid project classifications
 * and provides semantic accessors for project type queries.
 */

import { InvalidValueError } from "../errors/DomainError";

// Primary project categories
const PROJECT_CATEGORIES = [
  "web-frontend",     // React, Vue, Angular, static sites
  "web-backend",      // Express, FastAPI, Django
  "web-fullstack",    // Next.js, SvelteKit, Remix
  "cli",              // Command-line tools
  "library",          // npm/pip packages, shared libraries
  "mobile",           // React Native, Flutter
  "desktop",          // Electron, Tauri
  "api",              // REST/GraphQL APIs
  "microservice",     // Small focused services
  "monorepo",         // Multi-package repositories
  "infrastructure",   // Terraform, CDK, Pulumi
  "data",             // Data pipelines, ML projects
  "unknown",          // Unclassified
] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

// Common frameworks by ecosystem
const FRAMEWORKS = {
  javascript: [
    "nextjs", "remix", "nuxt", "sveltekit", "astro",
    "express", "fastify", "hono", "nest", "koa",
    "react", "vue", "angular", "svelte", "solid",
    "electron", "tauri",
  ],
  typescript: [
    "nextjs", "remix", "nuxt", "sveltekit", "astro",
    "express", "fastify", "hono", "nest", "koa",
    "react", "vue", "angular", "svelte", "solid",
    "electron", "tauri",
  ],
  python: [
    "fastapi", "django", "flask", "starlette", "quart",
    "typer", "click", "rich",
    "pytorch", "tensorflow", "langchain", "pandas",
  ],
  rust: [
    "actix", "axum", "rocket", "warp",
    "tauri", "dioxus",
    "clap", "tokio",
  ],
  go: [
    "gin", "echo", "fiber", "chi",
    "cobra", "viper",
  ],
} as const;

// Primary languages
const LANGUAGES = [
  "javascript", "typescript", "python", "rust", "go",
  "java", "kotlin", "swift", "ruby", "php",
  "c", "cpp", "csharp", "scala", "elixir",
] as const;

export type ProgrammingLanguage = (typeof LANGUAGES)[number];

export interface ProjectTypeData {
  category: ProjectCategory;
  primaryLanguage: ProgrammingLanguage | null;
  languages: ProgrammingLanguage[];
  framework: string | null;
  isMonorepo: boolean;
  hasTypeScript: boolean;
  hasPython: boolean;
  hasRust: boolean;
  hasDocker: boolean;
  hasCI: boolean;
}

export class ProjectType {
  private constructor(private readonly data: ProjectTypeData) {}

  /**
   * Create a ProjectType from raw data.
   * @throws InvalidValueError if the data is invalid
   */
  static create(data: Partial<ProjectTypeData>): ProjectType {
    const category = data.category ?? "unknown";

    if (!PROJECT_CATEGORIES.includes(category)) {
      throw new InvalidValueError(
        "ProjectType.category",
        category,
        `Must be one of: ${PROJECT_CATEGORIES.join(", ")}`
      );
    }

    const primaryLanguage = data.primaryLanguage ?? null;
    if (primaryLanguage !== null && !LANGUAGES.includes(primaryLanguage)) {
      throw new InvalidValueError(
        "ProjectType.primaryLanguage",
        primaryLanguage,
        `Must be one of: ${LANGUAGES.join(", ")}`
      );
    }

    const languages = data.languages ?? [];
    for (const lang of languages) {
      if (!LANGUAGES.includes(lang)) {
        throw new InvalidValueError(
          "ProjectType.languages",
          lang,
          `Must be one of: ${LANGUAGES.join(", ")}`
        );
      }
    }

    return new ProjectType({
      category,
      primaryLanguage,
      languages,
      framework: data.framework ?? null,
      isMonorepo: data.isMonorepo ?? false,
      hasTypeScript: data.hasTypeScript ?? languages.includes("typescript"),
      hasPython: data.hasPython ?? languages.includes("python"),
      hasRust: data.hasRust ?? languages.includes("rust"),
      hasDocker: data.hasDocker ?? false,
      hasCI: data.hasCI ?? false,
    });
  }

  /** Create an unknown/unclassified project type */
  static unknown(): ProjectType {
    return new ProjectType({
      category: "unknown",
      primaryLanguage: null,
      languages: [],
      framework: null,
      isMonorepo: false,
      hasTypeScript: false,
      hasPython: false,
      hasRust: false,
      hasDocker: false,
      hasCI: false,
    });
  }

  // Accessors
  get category(): ProjectCategory {
    return this.data.category;
  }

  get primaryLanguage(): ProgrammingLanguage | null {
    return this.data.primaryLanguage;
  }

  get languages(): ProgrammingLanguage[] {
    return [...this.data.languages];
  }

  get framework(): string | null {
    return this.data.framework;
  }

  get isMonorepo(): boolean {
    return this.data.isMonorepo;
  }

  get hasTypeScript(): boolean {
    return this.data.hasTypeScript;
  }

  get hasPython(): boolean {
    return this.data.hasPython;
  }

  get hasRust(): boolean {
    return this.data.hasRust;
  }

  get hasDocker(): boolean {
    return this.data.hasDocker;
  }

  get hasCI(): boolean {
    return this.data.hasCI;
  }

  // Semantic queries
  isWeb(): boolean {
    return this.data.category.startsWith("web-");
  }

  isFullStack(): boolean {
    return this.data.category === "web-fullstack";
  }

  isCLI(): boolean {
    return this.data.category === "cli";
  }

  isLibrary(): boolean {
    return this.data.category === "library";
  }

  isUnknown(): boolean {
    return this.data.category === "unknown";
  }

  usesFramework(name: string): boolean {
    return this.data.framework?.toLowerCase() === name.toLowerCase();
  }

  usesLanguage(lang: ProgrammingLanguage): boolean {
    return this.data.languages.includes(lang);
  }

  /** Get a human-readable description */
  describe(): string {
    const parts: string[] = [];

    if (this.data.framework) {
      parts.push(this.data.framework);
    }

    if (this.data.primaryLanguage) {
      parts.push(this.data.primaryLanguage);
    }

    parts.push(this.data.category.replace("-", " "));

    if (this.data.isMonorepo) {
      parts.push("(monorepo)");
    }

    return parts.join(" ");
  }

  /** Convert to JSON-serializable data */
  toJSON(): ProjectTypeData {
    return { ...this.data };
  }

  /** Value equality */
  equals(other: ProjectType): boolean {
    return JSON.stringify(this.data) === JSON.stringify(other.data);
  }
}

// Export valid categories and languages for external use
export { PROJECT_CATEGORIES, LANGUAGES, FRAMEWORKS };
