/**
 * ProjectMetadataService - Comprehensive project detection and analysis
 *
 * This service analyzes project directories to detect:
 * - Programming languages and frameworks
 * - Build tools and package managers
 * - Test frameworks
 * - CI/CD configurations
 * - Git repository state
 * - Dependencies and their versions
 *
 * Results are used by orchestrators to provide intelligent suggestions
 * and context-aware monitoring.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import type {
  DetectionResult,
  DetectedDependency,
  CICDConfig,
  TestFrameworkInfo,
  BuildToolInfo,
  GitRepoInfo,
  ProjectCategoryType,
  ProgrammingLanguageType,
} from "@/types/project-metadata";

const execFileAsync = promisify(execFile);

// File extensions to language mapping
const EXTENSION_LANGUAGE_MAP: Record<string, ProgrammingLanguageType> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".cs": "csharp",
  ".scala": "scala",
  ".ex": "elixir",
  ".exs": "elixir",
};

// Framework detection patterns
const FRAMEWORK_PATTERNS: Record<string, { files?: string[]; deps?: string[] }> = {
  // JavaScript/TypeScript
  nextjs: { files: ["next.config.js", "next.config.ts", "next.config.mjs"], deps: ["next"] },
  remix: { files: ["remix.config.js"], deps: ["@remix-run/react"] },
  nuxt: { files: ["nuxt.config.js", "nuxt.config.ts"], deps: ["nuxt"] },
  sveltekit: { files: ["svelte.config.js"], deps: ["@sveltejs/kit"] },
  astro: { files: ["astro.config.mjs", "astro.config.ts"], deps: ["astro"] },
  vite: { files: ["vite.config.js", "vite.config.ts"], deps: ["vite"] },
  express: { deps: ["express"] },
  fastify: { deps: ["fastify"] },
  hono: { deps: ["hono"] },
  nest: { deps: ["@nestjs/core"] },
  react: { deps: ["react"] },
  vue: { deps: ["vue"] },
  angular: { deps: ["@angular/core"] },
  svelte: { deps: ["svelte"] },
  solid: { deps: ["solid-js"] },
  electron: { deps: ["electron"] },
  tauri: { files: ["tauri.conf.json"] },
  // Python
  fastapi: { deps: ["fastapi"] },
  django: { files: ["manage.py"], deps: ["django"] },
  flask: { deps: ["flask"] },
  starlette: { deps: ["starlette"] },
  typer: { deps: ["typer"] },
  click: { deps: ["click"] },
  pytorch: { deps: ["torch"] },
  tensorflow: { deps: ["tensorflow"] },
  langchain: { deps: ["langchain"] },
  pandas: { deps: ["pandas"] },
  // Rust
  actix: { deps: ["actix-web"] },
  axum: { deps: ["axum"] },
  rocket: { deps: ["rocket"] },
  clap: { deps: ["clap"] },
  tokio: { deps: ["tokio"] },
  // Go
  gin: { deps: ["github.com/gin-gonic/gin"] },
  echo: { deps: ["github.com/labstack/echo"] },
  fiber: { deps: ["github.com/gofiber/fiber"] },
  cobra: { deps: ["github.com/spf13/cobra"] },
};

// Test framework detection
const TEST_FRAMEWORK_PATTERNS: Record<string, { files?: string[]; deps?: string[] }> = {
  jest: { files: ["jest.config.js", "jest.config.ts"], deps: ["jest"] },
  vitest: { files: ["vitest.config.js", "vitest.config.ts"], deps: ["vitest"] },
  mocha: { deps: ["mocha"] },
  pytest: { files: ["pytest.ini", "pyproject.toml"], deps: ["pytest"] },
  unittest: { files: [] }, // Built into Python
  cargo: { files: [] }, // Rust built-in
  "go-test": { files: [] }, // Go built-in
};

// CI/CD detection
const CI_CD_PATTERNS: Record<string, { dirs: string[]; files: string[] }> = {
  "github-actions": { dirs: [".github/workflows"], files: [] },
  "gitlab-ci": { dirs: [], files: [".gitlab-ci.yml"] },
  circleci: { dirs: [".circleci"], files: [] },
  jenkins: { dirs: [], files: ["Jenkinsfile"] },
  travis: { dirs: [], files: [".travis.yml"] },
};

export class ProjectMetadataService {
  /**
   * Detect project metadata for a given directory.
   */
  async detect(projectPath: string): Promise<DetectionResult> {
    const [
      languageStats,
      packageInfo,
      frameworkInfo,
      testInfo,
      cicdInfo,
      gitInfo,
      fileStats,
    ] = await Promise.all([
      this.detectLanguages(projectPath),
      this.detectPackageInfo(projectPath),
      this.detectFramework(projectPath),
      this.detectTestFramework(projectPath),
      this.detectCICD(projectPath),
      this.detectGitInfo(projectPath),
      this.countFiles(projectPath),
    ]);

    const languages = Object.keys(languageStats) as ProgrammingLanguageType[];
    const primaryLanguage = this.determinePrimaryLanguage(languageStats);

    // Detect category based on framework, dependencies, and structure
    const category = this.categorizeProject({
      framework: frameworkInfo.framework,
      languages,
      dependencies: packageInfo.dependencies,
      hasDocker: await this.fileExists(path.join(projectPath, "Dockerfile")),
      isMonorepo: packageInfo.isMonorepo,
    });

    // Generate suggested commands
    const suggestedStartupCommands = this.generateStartupCommands({
      packageManager: packageInfo.packageManager,
      framework: frameworkInfo.framework,
      category,
      hasDocker: await this.fileExists(path.join(projectPath, "Dockerfile")),
      buildTool: packageInfo.buildTool,
    });

    // Generate agent instructions
    const suggestedAgentInstructions = this.generateAgentInstructions({
      category,
      framework: frameworkInfo.framework,
      languages,
      testFramework: testInfo,
      packageManager: packageInfo.packageManager,
    });

    return {
      category,
      primaryLanguage,
      languages,
      framework: frameworkInfo.framework,
      isMonorepo: packageInfo.isMonorepo,
      hasTypeScript: languages.includes("typescript"),
      hasDocker: await this.fileExists(path.join(projectPath, "Dockerfile")),
      hasCI: cicdInfo !== null,
      dependencies: packageInfo.dependencies,
      devDependencies: packageInfo.devDependencies,
      packageManager: packageInfo.packageManager,
      buildTool: packageInfo.buildTool,
      testFramework: testInfo,
      cicd: cicdInfo,
      git: gitInfo,
      totalFiles: fileStats.total,
      sourceFiles: fileStats.source,
      testFiles: fileStats.test,
      configFiles: fileStats.config,
      suggestedStartupCommands,
      suggestedAgentInstructions,
    };
  }

  /**
   * Detect languages by file extensions.
   */
  private async detectLanguages(
    projectPath: string
  ): Promise<Record<ProgrammingLanguageType, number>> {
    const stats: Record<string, number> = {};

    try {
      const files = await this.walkDir(projectPath, 3); // Max depth 3

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const lang = EXTENSION_LANGUAGE_MAP[ext];
        if (lang) {
          stats[lang] = (stats[lang] || 0) + 1;
        }
      }
    } catch {
      // Ignore errors, return empty stats
    }

    return stats as Record<ProgrammingLanguageType, number>;
  }

  /**
   * Detect package manager, dependencies, and build tool.
   */
  private async detectPackageInfo(projectPath: string): Promise<{
    packageManager: DetectionResult["packageManager"];
    dependencies: DetectedDependency[];
    devDependencies: DetectedDependency[];
    buildTool: BuildToolInfo | null;
    isMonorepo: boolean;
  }> {
    let packageManager: DetectionResult["packageManager"] = null;
    const dependencies: DetectedDependency[] = [];
    const devDependencies: DetectedDependency[] = [];
    let buildTool: BuildToolInfo | null = null;
    let isMonorepo = false;

    // Check for JavaScript/TypeScript projects
    const packageJsonPath = path.join(projectPath, "package.json");
    if (await this.fileExists(packageJsonPath)) {
      try {
        const content = await readFile(packageJsonPath, "utf-8");
        const pkg = JSON.parse(content);

        // Detect package manager
        if (await this.fileExists(path.join(projectPath, "bun.lockb"))) {
          packageManager = "bun";
        } else if (await this.fileExists(path.join(projectPath, "pnpm-lock.yaml"))) {
          packageManager = "pnpm";
        } else if (await this.fileExists(path.join(projectPath, "yarn.lock"))) {
          packageManager = "yarn";
        } else {
          packageManager = "npm";
        }

        // Parse dependencies
        if (pkg.dependencies) {
          for (const [name, version] of Object.entries(pkg.dependencies)) {
            dependencies.push({
              name,
              version: version as string,
              isDev: false,
              source: "package.json",
            });
          }
        }

        if (pkg.devDependencies) {
          for (const [name, version] of Object.entries(pkg.devDependencies)) {
            devDependencies.push({
              name,
              version: version as string,
              isDev: true,
              source: "package.json",
            });
          }
        }

        // Detect monorepo
        if (pkg.workspaces) {
          isMonorepo = true;
        }

        // Build tool info
        buildTool = {
          tool: packageManager ?? "npm",
          configFile: "package.json",
          scripts: pkg.scripts || {},
        };
      } catch {
        // Ignore parse errors
      }
    }

    // Check for Python projects
    const pyprojectPath = path.join(projectPath, "pyproject.toml");
    const requirementsPath = path.join(projectPath, "requirements.txt");

    if (await this.fileExists(pyprojectPath)) {
      try {
        const content = await readFile(pyprojectPath, "utf-8");

        // Simple TOML parsing for dependencies
        const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
        if (depsMatch) {
          const depLines = depsMatch[1].match(/"([^"]+)"/g);
          if (depLines) {
            for (const depLine of depLines) {
              const dep = depLine.replace(/"/g, "").trim();
              const [name] = dep.split(/[<>=!]/);
              dependencies.push({
                name: name.trim(),
                version: null,
                isDev: false,
                source: "pyproject.toml",
              });
            }
          }
        }

        // Detect package manager
        if (await this.fileExists(path.join(projectPath, "uv.lock"))) {
          packageManager = "uv";
        } else {
          packageManager = "pip";
        }
      } catch {
        // Ignore errors
      }
    } else if (await this.fileExists(requirementsPath)) {
      packageManager = "pip";
      try {
        const content = await readFile(requirementsPath, "utf-8");
        const lines = content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            const [name] = trimmed.split(/[<>=!]/);
            dependencies.push({
              name: name.trim(),
              version: null,
              isDev: false,
              source: "requirements.txt",
            });
          }
        }
      } catch {
        // Ignore errors
      }
    }

    // Check for Rust projects
    const cargoPath = path.join(projectPath, "Cargo.toml");
    if (await this.fileExists(cargoPath)) {
      packageManager = "cargo";
      try {
        const content = await readFile(cargoPath, "utf-8");

        // Simple parsing for dependencies section
        const depsSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
        if (depsSection) {
          const lines = depsSection[1].split("\n");
          for (const line of lines) {
            const match = line.match(/^(\w[\w-]*)\s*=/);
            if (match) {
              dependencies.push({
                name: match[1],
                version: null,
                isDev: false,
                source: "Cargo.toml",
              });
            }
          }
        }

        // Check for monorepo (workspace)
        if (content.includes("[workspace]")) {
          isMonorepo = true;
        }
      } catch {
        // Ignore errors
      }
    }

    // Check for Go projects
    const goModPath = path.join(projectPath, "go.mod");
    if (await this.fileExists(goModPath)) {
      packageManager = "go";
      try {
        const content = await readFile(goModPath, "utf-8");
        const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);
        if (requireMatch) {
          const lines = requireMatch[1].split("\n");
          for (const line of lines) {
            const match = line.trim().match(/^(\S+)\s+v?/);
            if (match && !match[1].startsWith("//")) {
              dependencies.push({
                name: match[1],
                version: null,
                isDev: false,
                source: "go.mod",
              });
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return { packageManager, dependencies, devDependencies, buildTool, isMonorepo };
  }

  /**
   * Detect framework from files and dependencies.
   */
  private async detectFramework(projectPath: string): Promise<{ framework: string | null }> {
    // Check file-based detection first (more reliable)
    for (const [framework, patterns] of Object.entries(FRAMEWORK_PATTERNS)) {
      if (patterns.files) {
        for (const file of patterns.files) {
          if (await this.fileExists(path.join(projectPath, file))) {
            return { framework };
          }
        }
      }
    }

    // Check dependency-based detection
    const packageJsonPath = path.join(projectPath, "package.json");
    if (await this.fileExists(packageJsonPath)) {
      try {
        const content = await readFile(packageJsonPath, "utf-8");
        const pkg = JSON.parse(content);
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };

        for (const [framework, patterns] of Object.entries(FRAMEWORK_PATTERNS)) {
          if (patterns.deps) {
            for (const dep of patterns.deps) {
              if (allDeps[dep]) {
                return { framework };
              }
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return { framework: null };
  }

  /**
   * Detect test framework.
   */
  private async detectTestFramework(projectPath: string): Promise<TestFrameworkInfo | null> {
    // Check for test config files
    for (const [framework, patterns] of Object.entries(TEST_FRAMEWORK_PATTERNS)) {
      if (patterns.files) {
        for (const file of patterns.files) {
          if (file && await this.fileExists(path.join(projectPath, file))) {
            const hasUnitTests = await this.hasTestFiles(projectPath, "test", "spec");
            const hasE2E = await this.hasTestFiles(projectPath, "e2e", "integration");

            return {
              framework,
              configFile: file,
              hasUnitTests,
              hasIntegrationTests: hasE2E,
              hasE2ETests: hasE2E,
            };
          }
        }
      }
    }

    // Check for test dependencies
    const packageJsonPath = path.join(projectPath, "package.json");
    if (await this.fileExists(packageJsonPath)) {
      try {
        const content = await readFile(packageJsonPath, "utf-8");
        const pkg = JSON.parse(content);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        for (const [framework, patterns] of Object.entries(TEST_FRAMEWORK_PATTERNS)) {
          if (patterns.deps) {
            for (const dep of patterns.deps) {
              if (allDeps[dep]) {
                const hasUnitTests = await this.hasTestFiles(projectPath, "test", "spec");
                const hasE2E = await this.hasTestFiles(projectPath, "e2e", "integration");

                return {
                  framework,
                  configFile: null,
                  hasUnitTests,
                  hasIntegrationTests: hasE2E,
                  hasE2ETests: hasE2E,
                };
              }
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return null;
  }

  /**
   * Check if project has test files with given patterns.
   */
  private async hasTestFiles(projectPath: string, ...patterns: string[]): Promise<boolean> {
    try {
      const files = await this.walkDir(projectPath, 3);
      return files.some((f) =>
        patterns.some((p) => f.toLowerCase().includes(p))
      );
    } catch {
      return false;
    }
  }

  /**
   * Detect CI/CD configuration.
   */
  private async detectCICD(projectPath: string): Promise<CICDConfig | null> {
    for (const [provider, patterns] of Object.entries(CI_CD_PATTERNS)) {
      // Check directories
      for (const dir of patterns.dirs) {
        const dirPath = path.join(projectPath, dir);
        if (await this.fileExists(dirPath)) {
          const workflows = await this.listCIWorkflows(dirPath);
          return {
            provider: provider as CICDConfig["provider"],
            hasTests: workflows.some((w) =>
              w.toLowerCase().includes("test")
            ),
            hasLinting: workflows.some((w) =>
              w.toLowerCase().includes("lint")
            ),
            hasBuild: workflows.some((w) =>
              w.toLowerCase().includes("build")
            ),
            hasDeploy: workflows.some((w) =>
              w.toLowerCase().includes("deploy")
            ),
            workflows,
          };
        }
      }

      // Check files
      for (const file of patterns.files) {
        if (await this.fileExists(path.join(projectPath, file))) {
          return {
            provider: provider as CICDConfig["provider"],
            hasTests: true,
            hasLinting: false,
            hasBuild: true,
            hasDeploy: false,
            workflows: [file],
          };
        }
      }
    }

    return null;
  }

  /**
   * List CI workflow files.
   */
  private async listCIWorkflows(dirPath: string): Promise<string[]> {
    try {
      const entries = await readdir(dirPath);
      return entries.filter((e) => e.endsWith(".yml") || e.endsWith(".yaml"));
    } catch {
      return [];
    }
  }

  /**
   * Detect Git repository information.
   */
  private async detectGitInfo(projectPath: string): Promise<GitRepoInfo | null> {
    const gitDir = path.join(projectPath, ".git");
    if (!(await this.fileExists(gitDir))) {
      return null;
    }

    try {
      const [
        remoteResult,
        branchResult,
        defaultBranchResult,
        logResult,
        statusResult,
      ] = await Promise.all([
        this.execGit(projectPath, ["remote", "get-url", "origin"]).catch(() => ({ stdout: "" })),
        this.execGit(projectPath, ["branch", "--show-current"]),
        this.execGit(projectPath, ["config", "--get", "init.defaultBranch"]).catch(() => ({ stdout: "main" })),
        this.execGit(projectPath, ["log", "-1", "--format=%H %ct"]),
        this.execGit(projectPath, ["status", "--porcelain"]),
      ]);

      const remoteUrl = remoteResult.stdout.trim() || null;
      const currentBranch = branchResult.stdout.trim() || "main";
      const defaultBranch = defaultBranchResult.stdout.trim() || "main";

      const [lastCommitHash, timestamp] = logResult.stdout.trim().split(" ");
      const lastCommitDate = timestamp ? new Date(parseInt(timestamp) * 1000) : null;

      const statusLines = statusResult.stdout.trim().split("\n").filter(Boolean);
      const untrackedCount = statusLines.filter((l) => l.startsWith("??")).length;
      const modifiedCount = statusLines.filter((l) => !l.startsWith("??")).length;
      const isDirty = statusLines.length > 0;

      // Count commits
      let commitCount = 0;
      try {
        const countResult = await this.execGit(projectPath, ["rev-list", "--count", "HEAD"]);
        commitCount = parseInt(countResult.stdout.trim()) || 0;
      } catch {
        // Ignore
      }

      return {
        remoteUrl,
        defaultBranch,
        currentBranch,
        commitCount,
        lastCommitHash: lastCommitHash || null,
        lastCommitDate,
        isDirty,
        untrackedCount,
        modifiedCount,
      };
    } catch {
      return null;
    }
  }

  /**
   * Execute a git command.
   */
  private async execGit(cwd: string, args: string[]): Promise<{ stdout: string }> {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return { stdout };
  }

  /**
   * Count files by type.
   */
  private async countFiles(projectPath: string): Promise<{
    total: number;
    source: number;
    test: number;
    config: number;
  }> {
    const stats = { total: 0, source: 0, test: 0, config: 0 };

    try {
      const files = await this.walkDir(projectPath, 5);

      for (const file of files) {
        stats.total++;

        const ext = path.extname(file).toLowerCase();
        const basename = path.basename(file).toLowerCase();

        // Source files
        if (EXTENSION_LANGUAGE_MAP[ext]) {
          stats.source++;
        }

        // Test files
        if (
          file.includes("test") ||
          file.includes("spec") ||
          file.includes("__tests__")
        ) {
          stats.test++;
        }

        // Config files
        if (
          basename.startsWith(".") ||
          basename.endsWith(".config.js") ||
          basename.endsWith(".config.ts") ||
          basename.endsWith(".json") ||
          basename.endsWith(".toml") ||
          basename.endsWith(".yaml") ||
          basename.endsWith(".yml")
        ) {
          stats.config++;
        }
      }
    } catch {
      // Ignore errors
    }

    return stats;
  }

  /**
   * Walk directory recursively.
   */
  private async walkDir(dir: string, maxDepth: number, currentDepth = 0): Promise<string[]> {
    if (currentDepth >= maxDepth) return [];

    const files: string[] = [];

    try {
      const entries = await readdir(dir);

      for (const entry of entries) {
        // Skip common non-source directories
        if (
          entry === "node_modules" ||
          entry === ".git" ||
          entry === "dist" ||
          entry === "build" ||
          entry === ".next" ||
          entry === "__pycache__" ||
          entry === "target" ||
          entry === "vendor"
        ) {
          continue;
        }

        const fullPath = path.join(dir, entry);

        try {
          const stats = await stat(fullPath);

          if (stats.isDirectory()) {
            const subFiles = await this.walkDir(fullPath, maxDepth, currentDepth + 1);
            files.push(...subFiles);
          } else if (stats.isFile()) {
            files.push(fullPath);
          }
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Ignore errors
    }

    return files;
  }

  /**
   * Check if a file/directory exists.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Determine primary language from stats.
   */
  private determinePrimaryLanguage(
    stats: Record<ProgrammingLanguageType, number>
  ): ProgrammingLanguageType | null {
    let maxCount = 0;
    let primary: ProgrammingLanguageType | null = null;

    for (const [lang, count] of Object.entries(stats)) {
      if (count > maxCount) {
        maxCount = count;
        primary = lang as ProgrammingLanguageType;
      }
    }

    return primary;
  }

  /**
   * Categorize project based on detected information.
   */
  private categorizeProject(info: {
    framework: string | null;
    languages: ProgrammingLanguageType[];
    dependencies: DetectedDependency[];
    hasDocker: boolean;
    isMonorepo: boolean;
  }): ProjectCategoryType {
    const { framework, languages, dependencies, isMonorepo } = info;
    const depNames = dependencies.map((d) => d.name.toLowerCase());

    if (isMonorepo) {
      return "monorepo";
    }

    // Full-stack frameworks
    if (["nextjs", "remix", "nuxt", "sveltekit", "astro"].includes(framework ?? "")) {
      return "web-fullstack";
    }

    // API/Backend frameworks
    if (
      ["express", "fastify", "hono", "nest", "fastapi", "django", "flask", "actix", "axum", "gin", "echo"].includes(
        framework ?? ""
      )
    ) {
      return "api";
    }

    // CLI tools
    if (["typer", "click", "clap", "cobra"].includes(framework ?? "")) {
      return "cli";
    }

    // Desktop apps
    if (["electron", "tauri"].includes(framework ?? "")) {
      return "desktop";
    }

    // Frontend-only (React, Vue, etc. without backend)
    if (
      ["react", "vue", "angular", "svelte", "solid"].includes(framework ?? "") &&
      !depNames.some((d) => d.includes("server") || d.includes("express") || d.includes("fastify"))
    ) {
      return "web-frontend";
    }

    // Data/ML projects
    if (
      depNames.some(
        (d) => d.includes("pandas") || d.includes("numpy") || d.includes("tensorflow") || d.includes("torch")
      )
    ) {
      return "data";
    }

    // Library detection
    if (
      depNames.some((d) => d === "@types/node") &&
      !depNames.some((d) => d.includes("express") || d.includes("react") || d.includes("vue"))
    ) {
      return "library";
    }

    // Default based on language
    if (languages.includes("typescript") || languages.includes("javascript")) {
      return "web-fullstack"; // Most JS/TS projects are web
    }

    if (languages.includes("python")) {
      return "api"; // Most Python projects are backends/APIs
    }

    if (languages.includes("go") || languages.includes("rust")) {
      return "cli"; // Often CLI tools
    }

    return "unknown";
  }

  /**
   * Generate suggested startup commands.
   */
  private generateStartupCommands(info: {
    packageManager: DetectionResult["packageManager"];
    framework: string | null;
    category: ProjectCategoryType;
    hasDocker: boolean;
    buildTool: BuildToolInfo | null;
  }): string[] {
    const commands: string[] = [];
    const { packageManager, framework, buildTool, hasDocker } = info;

    // Install dependencies first
    if (packageManager === "bun") {
      commands.push("bun install");
    } else if (packageManager === "pnpm") {
      commands.push("pnpm install");
    } else if (packageManager === "yarn") {
      commands.push("yarn");
    } else if (packageManager === "npm") {
      commands.push("npm install");
    } else if (packageManager === "uv") {
      commands.push("uv sync");
    } else if (packageManager === "pip") {
      commands.push("pip install -r requirements.txt");
    } else if (packageManager === "cargo") {
      commands.push("cargo build");
    } else if (packageManager === "go") {
      commands.push("go mod download");
    }

    // Framework-specific dev commands
    if (framework === "nextjs") {
      commands.push(`${packageManager === "bun" ? "bun" : "npm"} run dev`);
    } else if (framework === "vite") {
      commands.push(`${packageManager === "bun" ? "bun" : "npm"} run dev`);
    } else if (framework === "django") {
      commands.push("python manage.py runserver");
    } else if (framework === "fastapi") {
      commands.push("uvicorn main:app --reload");
    } else if (buildTool?.scripts?.dev) {
      commands.push(`${packageManager === "bun" ? "bun" : "npm"} run dev`);
    } else if (buildTool?.scripts?.start) {
      commands.push(`${packageManager === "bun" ? "bun" : "npm"} run start`);
    }

    // Docker option
    if (hasDocker) {
      commands.push("docker compose up -d");
    }

    return commands;
  }

  /**
   * Generate agent-specific instructions.
   */
  private generateAgentInstructions(info: {
    category: ProjectCategoryType;
    framework: string | null;
    languages: ProgrammingLanguageType[];
    testFramework: TestFrameworkInfo | null;
    packageManager: DetectionResult["packageManager"];
  }): string | null {
    const parts: string[] = [];

    // Package manager instruction
    if (info.packageManager === "bun") {
      parts.push("Use 'bun' instead of 'npm' for all package operations.");
    } else if (info.packageManager === "pnpm") {
      parts.push("Use 'pnpm' instead of 'npm' for all package operations.");
    } else if (info.packageManager === "uv") {
      parts.push("Use 'uv' instead of 'pip' for all Python package operations.");
    }

    // Framework hint
    if (info.framework) {
      parts.push(`This is a ${info.framework} project.`);
    }

    // Test framework hint
    if (info.testFramework) {
      parts.push(
        `Tests use ${info.testFramework.framework}. Run tests after making changes.`
      );
    }

    // Language-specific hints
    if (info.languages.includes("typescript")) {
      parts.push("Ensure TypeScript types are correct. Run type checks before committing.");
    }

    return parts.length > 0 ? parts.join(" ") : null;
  }
}
