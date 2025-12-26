/**
 * Framework Detection Service
 *
 * Detects frameworks and runtimes from project configuration files.
 * Used by Port Manager to suggest appropriate ports.
 */
import { promises as fs } from "fs";
import path from "path";
import type {
  RuntimeId,
  FrameworkSignature,
  DetectedFramework,
  DetectedRuntime,
  FrameworkConfidence,
} from "@/types/port";

// ============================================================================
// Framework Signatures
// ============================================================================

export const FRAMEWORK_SIGNATURES: FrameworkSignature[] = [
  {
    id: "nextjs",
    name: "Next.js",
    ports: [
      { variableName: "PORT", defaultPort: 3000, description: "Next.js server" },
    ],
    detection: {
      packageDeps: ["next"],
      configFiles: ["next.config.js", "next.config.mjs", "next.config.ts"],
    },
  },
  {
    id: "vite",
    name: "Vite",
    ports: [
      { variableName: "PORT", defaultPort: 5173, description: "Vite dev server" },
      { variableName: "VITE_PORT", defaultPort: 5173, description: "Vite dev server" },
    ],
    detection: {
      packageDevDeps: ["vite"],
      configFiles: ["vite.config.js", "vite.config.ts", "vite.config.mjs"],
    },
  },
  {
    id: "cra",
    name: "Create React App",
    ports: [
      { variableName: "PORT", defaultPort: 3000, description: "React dev server" },
    ],
    detection: {
      packageDeps: ["react-scripts"],
    },
  },
  {
    id: "express",
    name: "Express",
    ports: [
      { variableName: "PORT", defaultPort: 3000, description: "Express server" },
    ],
    detection: {
      packageDeps: ["express"],
    },
  },
  {
    id: "fastify",
    name: "Fastify",
    ports: [
      { variableName: "PORT", defaultPort: 3000, description: "Fastify server" },
    ],
    detection: {
      packageDeps: ["fastify"],
    },
  },
  {
    id: "nestjs",
    name: "NestJS",
    ports: [
      { variableName: "PORT", defaultPort: 3000, description: "NestJS server" },
    ],
    detection: {
      packageDeps: ["@nestjs/core"],
      configFiles: ["nest-cli.json"],
    },
  },
  {
    id: "angular",
    name: "Angular",
    ports: [
      { variableName: "PORT", defaultPort: 4200, description: "Angular dev server" },
    ],
    detection: {
      packageDeps: ["@angular/core"],
      configFiles: ["angular.json"],
    },
  },
  {
    id: "vue",
    name: "Vue.js",
    ports: [
      { variableName: "PORT", defaultPort: 8080, description: "Vue dev server" },
    ],
    detection: {
      packageDeps: ["vue"],
      configFiles: ["vue.config.js"],
    },
  },
  {
    id: "svelte",
    name: "Svelte",
    ports: [
      { variableName: "PORT", defaultPort: 5000, description: "Svelte dev server" },
    ],
    detection: {
      packageDeps: ["svelte"],
      configFiles: ["svelte.config.js"],
    },
  },
  {
    id: "remix",
    name: "Remix",
    ports: [
      { variableName: "PORT", defaultPort: 3000, description: "Remix server" },
    ],
    detection: {
      packageDeps: ["@remix-run/react"],
      configFiles: ["remix.config.js"],
    },
  },
  {
    id: "astro",
    name: "Astro",
    ports: [
      { variableName: "PORT", defaultPort: 4321, description: "Astro dev server" },
    ],
    detection: {
      packageDeps: ["astro"],
      configFiles: ["astro.config.mjs", "astro.config.js"],
    },
  },
  {
    id: "django",
    name: "Django",
    ports: [
      { variableName: "PORT", defaultPort: 8000, description: "Django server" },
    ],
    detection: {
      pythonPackages: ["django", "Django"],
      configFiles: ["manage.py"],
    },
  },
  {
    id: "flask",
    name: "Flask",
    ports: [
      { variableName: "PORT", defaultPort: 5000, description: "Flask server" },
      { variableName: "FLASK_RUN_PORT", defaultPort: 5000, description: "Flask server" },
    ],
    detection: {
      pythonPackages: ["flask", "Flask"],
    },
  },
  {
    id: "fastapi",
    name: "FastAPI",
    ports: [
      { variableName: "PORT", defaultPort: 8000, description: "FastAPI server" },
    ],
    detection: {
      pythonPackages: ["fastapi"],
    },
  },
  {
    id: "rails",
    name: "Ruby on Rails",
    ports: [
      { variableName: "PORT", defaultPort: 3000, description: "Rails server" },
    ],
    detection: {
      rubyGems: ["rails"],
      configFiles: ["config/routes.rb", "Gemfile"],
    },
  },
];

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Detect frameworks in a project directory
 */
export async function detectFrameworks(
  workingDirectory: string
): Promise<DetectedFramework[]> {
  const results: DetectedFramework[] = [];

  // Read package.json once
  const packageJson = await readPackageJson(workingDirectory);

  // Check each framework signature
  for (const signature of FRAMEWORK_SIGNATURES) {
    const detection = await detectFramework(workingDirectory, signature, packageJson);
    if (detection.detected) {
      results.push(detection);
    }
  }

  // Sort by confidence (high first)
  results.sort((a, b) => {
    const order: Record<FrameworkConfidence, number> = { high: 0, medium: 1, low: 2 };
    return order[a.confidence] - order[b.confidence];
  });

  return results;
}

/**
 * Detect runtime/package manager for a project
 */
export async function detectRuntime(
  workingDirectory: string
): Promise<DetectedRuntime> {
  // Check for lockfiles in order of specificity
  const lockfileChecks: Array<{
    file: string;
    runtime: RuntimeId;
    name: string;
  }> = [
    { file: "bun.lockb", runtime: "bun", name: "Bun" },
    { file: "yarn.lock", runtime: "yarn", name: "Yarn" },
    { file: "pnpm-lock.yaml", runtime: "pnpm", name: "pnpm" },
    { file: "package-lock.json", runtime: "npm", name: "npm" },
    { file: "requirements.txt", runtime: "python", name: "Python" },
    { file: "pyproject.toml", runtime: "python", name: "Python" },
    { file: "Pipfile", runtime: "python", name: "Python" },
    { file: "Gemfile", runtime: "ruby", name: "Ruby" },
  ];

  for (const check of lockfileChecks) {
    if (await fileExists(path.join(workingDirectory, check.file))) {
      return {
        id: check.runtime,
        name: check.name,
        lockfile: check.file,
      };
    }
  }

  // Check for package.json without lockfile (generic Node)
  if (await fileExists(path.join(workingDirectory, "package.json"))) {
    return {
      id: "node",
      name: "Node.js",
    };
  }

  return {
    id: "unknown",
    name: "Unknown",
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageJson(workingDirectory: string): Promise<PackageJson | null> {
  try {
    const content = await fs.readFile(
      path.join(workingDirectory, "package.json"),
      "utf-8"
    );
    return JSON.parse(content) as PackageJson;
  } catch {
    return null;
  }
}

async function readRequirementsTxt(workingDirectory: string): Promise<string[]> {
  try {
    const content = await fs.readFile(
      path.join(workingDirectory, "requirements.txt"),
      "utf-8"
    );
    return content
      .split("\n")
      .map((line) => line.trim().split(/[=<>~!]/)[0])
      .filter((pkg) => pkg && !pkg.startsWith("#"));
  } catch {
    return [];
  }
}

async function readGemfile(workingDirectory: string): Promise<string[]> {
  try {
    const content = await fs.readFile(
      path.join(workingDirectory, "Gemfile"),
      "utf-8"
    );
    const gems: string[] = [];
    const gemRegex = /gem\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = gemRegex.exec(content)) !== null) {
      gems.push(match[1]);
    }
    return gems;
  } catch {
    return [];
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectFramework(
  workingDirectory: string,
  signature: FrameworkSignature,
  packageJson: PackageJson | null
): Promise<DetectedFramework> {
  const baseResult: DetectedFramework = {
    id: signature.id,
    name: signature.name,
    confidence: "low",
    detected: false,
    suggestedPorts: signature.ports,
  };

  // Check config files (highest confidence)
  if (signature.detection.configFiles) {
    for (const configFile of signature.detection.configFiles) {
      const configPath = path.join(workingDirectory, configFile);
      if (await fileExists(configPath)) {
        return {
          ...baseResult,
          confidence: "high",
          detected: true,
          configPath: configFile,
        };
      }
    }
  }

  // Check package.json dependencies
  if (packageJson) {
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};

    // Check main dependencies
    if (signature.detection.packageDeps) {
      for (const dep of signature.detection.packageDeps) {
        if (deps[dep]) {
          return {
            ...baseResult,
            confidence: "high",
            detected: true,
          };
        }
      }
    }

    // Check devDependencies
    if (signature.detection.packageDevDeps) {
      for (const dep of signature.detection.packageDevDeps) {
        if (devDeps[dep]) {
          return {
            ...baseResult,
            confidence: "medium",
            detected: true,
          };
        }
      }
    }
  }

  // Check Python packages
  if (signature.detection.pythonPackages) {
    const requirements = await readRequirementsTxt(workingDirectory);
    for (const pkg of signature.detection.pythonPackages) {
      if (requirements.includes(pkg.toLowerCase())) {
        return {
          ...baseResult,
          confidence: "high",
          detected: true,
        };
      }
    }
  }

  // Check Ruby gems
  if (signature.detection.rubyGems) {
    const gems = await readGemfile(workingDirectory);
    for (const gem of signature.detection.rubyGems) {
      if (gems.includes(gem)) {
        return {
          ...baseResult,
          confidence: "high",
          detected: true,
        };
      }
    }
  }

  return baseResult;
}
