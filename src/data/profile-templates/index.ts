/**
 * Profile Templates Library
 *
 * Pre-configured starter profiles for common use cases.
 * Users can select these when creating new profiles.
 */

import type {
  ClaudeCodeConfig,
  GeminiCLIConfig,
  OpenCodeConfig,
  CodexCLIConfig,
} from "@/types/agent-config";

export interface ProfileTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  tags: string[];
  configs: {
    claude: ClaudeCodeConfig;
    gemini: GeminiCLIConfig;
    opencode: OpenCodeConfig;
    codex: CodexCLIConfig;
  };
}

/**
 * Secure Profile Template
 *
 * Strict permissions, sandboxing enabled, minimal auto-approval.
 * Best for: Production work, security-sensitive projects, compliance requirements.
 */
export const SECURE_TEMPLATE: ProfileTemplate = {
  id: "secure",
  name: "Secure",
  description: "Strict permissions and sandboxing for security-sensitive work",
  icon: "🔒",
  color: "#ef4444",
  tags: ["security", "production", "compliance"],
  configs: {
    claude: {
      model: "claude-sonnet-4-20250514",
      cleanupPeriodDays: 7,
      permissions: {
        defaultMode: "readOnly",
        allow: [],
        deny: ["*.env*", "*secret*", "*credential*", "*password*", "*.pem", "*.key"],
        ask: ["*"],
        additionalDirectories: [],
      },
      sandbox: {
        enabled: true,
        network: {
          httpProxyPort: 8080,
        },
      },
      output: {
        verbose: true,
      },
    },
    gemini: {
      previewFeatures: false,
      vimMode: false,
      sessionRetention: {
        maxAge: 1,
        maxCount: 5,
      },
      model: {
        name: "gemini-2.0-flash",
        maxSessionTurns: 10,
      },
      ui: {
        theme: "default",
      },
      tools: {
        sandbox: {
          enabled: true,
          mode: "strict",
        },
        shell: {
          allowedCommands: [],
          blockedCommands: ["*"],
        },
        coreTools: {
          webSearch: false,
          codeExecution: false,
        },
      },
      security: {
        disableYoloMode: true,
        environmentVariableRedaction: {
          enabled: true,
          patterns: ["*KEY*", "*SECRET*", "*TOKEN*", "*PASSWORD*", "*CREDENTIAL*"],
        },
      },
    },
    opencode: {
      models: {
        model: "gpt-4o",
        smallModel: "gpt-4o-mini",
        disabledProviders: [],
      },
      interface: {
        theme: "default",
        tuiScroll: true,
        diffStyle: "unified",
      },
      tools: {
        write: false,
        bash: false,
        permissionMode: "deny",
      },
      codeQuality: {
        autoLint: true,
        smartFormat: true,
        formatOnSave: true,
      },
    },
    codex: {
      model: {
        provider: "openai",
        model: "o4-mini",
        reasoningEffort: "high",
        verbosity: "verbose",
      },
      execution: {
        approvalPolicy: "suggest",
        sandboxMode: "docker",
      },
      features: {
        unifiedExec: true,
        skills: false,
        tui2: false,
      },
      observability: {
        logLevel: "info",
        loggingEnabled: true,
      },
    },
  },
};

/**
 * Development Profile Template
 *
 * Permissive settings, auto-approval for common operations.
 * Best for: Active development, prototyping, local projects.
 */
export const DEVELOPMENT_TEMPLATE: ProfileTemplate = {
  id: "development",
  name: "Development",
  description: "Permissive settings for active development and prototyping",
  icon: "🛠️",
  color: "#22c55e",
  tags: ["development", "prototyping", "local"],
  configs: {
    claude: {
      model: "claude-sonnet-4-20250514",
      cleanupPeriodDays: 30,
      permissions: {
        defaultMode: "acceptEdits",
        allow: ["src/**", "test/**", "*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.md"],
        deny: ["*.env*", ".git/**", "node_modules/**"],
        ask: ["package.json", "*.config.*"],
        additionalDirectories: ["."],
      },
      sandbox: {
        enabled: false,
      },
      output: {
        verbose: false,
      },
    },
    gemini: {
      previewFeatures: true,
      vimMode: true,
      sessionRetention: {
        maxAge: 30,
        maxCount: 100,
      },
      model: {
        name: "gemini-2.0-flash",
        maxSessionTurns: 50,
      },
      ui: {
        theme: "default",
      },
      tools: {
        sandbox: {
          enabled: false,
          mode: "permissive",
        },
        shell: {
          allowedCommands: ["npm", "npx", "bun", "yarn", "pnpm", "git", "ls", "cat", "grep", "find"],
          blockedCommands: ["rm -rf /", "sudo rm", "chmod 777"],
        },
        coreTools: {
          webSearch: true,
          codeExecution: true,
        },
      },
      security: {
        disableYoloMode: false,
        environmentVariableRedaction: {
          enabled: true,
          patterns: ["*KEY*", "*SECRET*"],
        },
      },
    },
    opencode: {
      models: {
        model: "gpt-4o",
        smallModel: "gpt-4o-mini",
        disabledProviders: [],
      },
      interface: {
        theme: "default",
        tuiScroll: true,
        diffStyle: "split",
      },
      tools: {
        write: true,
        bash: true,
        permissionMode: "auto",
      },
      codeQuality: {
        autoLint: true,
        smartFormat: true,
        formatOnSave: true,
      },
    },
    codex: {
      model: {
        provider: "openai",
        model: "o4-mini",
        reasoningEffort: "medium",
        verbosity: "normal",
      },
      execution: {
        approvalPolicy: "auto-edit",
        sandboxMode: "none",
      },
      features: {
        unifiedExec: true,
        skills: true,
        tui2: false,
      },
      observability: {
        logLevel: "warn",
        loggingEnabled: true,
      },
    },
  },
};

/**
 * Minimal Profile Template
 *
 * Basic configuration with few tools enabled.
 * Best for: Learning, simple tasks, reduced complexity.
 */
export const MINIMAL_TEMPLATE: ProfileTemplate = {
  id: "minimal",
  name: "Minimal",
  description: "Simple configuration for basic tasks and learning",
  icon: "📝",
  color: "#6366f1",
  tags: ["simple", "learning", "basic"],
  configs: {
    claude: {
      model: "claude-sonnet-4-20250514",
      cleanupPeriodDays: 14,
      permissions: {
        defaultMode: "askOnEdit",
        allow: [],
        deny: [],
        ask: ["*"],
        additionalDirectories: [],
      },
      output: {
        verbose: false,
      },
    },
    gemini: {
      previewFeatures: false,
      vimMode: false,
      sessionRetention: {
        maxAge: 7,
        maxCount: 20,
      },
      model: {
        name: "gemini-2.0-flash",
        maxSessionTurns: 20,
      },
      ui: {
        theme: "default",
      },
      tools: {
        sandbox: {
          enabled: true,
          mode: "strict",
        },
        coreTools: {
          webSearch: false,
          codeExecution: false,
        },
      },
      security: {
        disableYoloMode: true,
      },
    },
    opencode: {
      models: {
        model: "gpt-4o-mini",
        smallModel: "gpt-4o-mini",
      },
      interface: {
        theme: "default",
        tuiScroll: true,
        diffStyle: "unified",
      },
      tools: {
        write: false,
        bash: false,
        permissionMode: "ask",
      },
      codeQuality: {
        autoLint: false,
        smartFormat: false,
        formatOnSave: false,
      },
    },
    codex: {
      model: {
        provider: "openai",
        model: "o4-mini",
        reasoningEffort: "low",
        verbosity: "quiet",
      },
      execution: {
        approvalPolicy: "suggest",
        sandboxMode: "docker",
      },
      features: {
        unifiedExec: true,
        skills: false,
        tui2: false,
      },
      observability: {
        logLevel: "warn",
        loggingEnabled: false,
      },
    },
  },
};

/**
 * Full Featured Profile Template
 *
 * All tools enabled, MCP servers configured, maximum capabilities.
 * Best for: Power users, complex projects, multi-tool workflows.
 */
export const FULL_FEATURED_TEMPLATE: ProfileTemplate = {
  id: "full-featured",
  name: "Full Featured",
  description: "Maximum capabilities with all tools and MCP servers enabled",
  icon: "🚀",
  color: "#f59e0b",
  tags: ["power-user", "advanced", "full"],
  configs: {
    claude: {
      model: "claude-sonnet-4-20250514",
      cleanupPeriodDays: 60,
      permissions: {
        defaultMode: "acceptEdits",
        allow: ["**/*"],
        deny: [".git/**", "node_modules/**"],
        ask: [],
        additionalDirectories: ["."],
      },
      sandbox: {
        enabled: false,
      },
      mcpServers: {
        filesystem: {
          command: "npx -y @anthropic/mcp-server-filesystem",
          args: ["."],
        },
        github: {
          command: "npx -y @anthropic/mcp-server-github",
        },
        "brave-search": {
          command: "npx -y @anthropic/mcp-server-brave-search",
          env: {
            BRAVE_API_KEY: "${BRAVE_API_KEY}",
          },
        },
      },
      output: {
        verbose: true,
      },
    },
    gemini: {
      previewFeatures: true,
      vimMode: true,
      sessionRetention: {
        maxAge: 90,
        maxCount: 500,
      },
      model: {
        name: "gemini-2.0-flash",
        maxSessionTurns: 100,
      },
      ui: {
        theme: "default",
      },
      tools: {
        sandbox: {
          enabled: false,
          mode: "permissive",
        },
        shell: {
          allowedCommands: ["*"],
          blockedCommands: [],
        },
        coreTools: {
          webSearch: true,
          codeExecution: true,
        },
      },
      security: {
        disableYoloMode: false,
        environmentVariableRedaction: {
          enabled: true,
          patterns: ["*KEY*", "*SECRET*", "*TOKEN*"],
        },
      },
    },
    opencode: {
      models: {
        model: "gpt-4o",
        smallModel: "gpt-4o-mini",
        disabledProviders: [],
      },
      interface: {
        theme: "default",
        tuiScroll: true,
        diffStyle: "split",
      },
      tools: {
        write: true,
        bash: true,
        permissionMode: "auto",
      },
      codeQuality: {
        autoLint: true,
        smartFormat: true,
        formatOnSave: true,
      },
      server: {
        previewPort: 3100,
      },
    },
    codex: {
      model: {
        provider: "openai",
        model: "o4-mini",
        reasoningEffort: "high",
        verbosity: "verbose",
      },
      execution: {
        approvalPolicy: "full-auto",
        sandboxMode: "none",
      },
      features: {
        unifiedExec: true,
        skills: true,
        tui2: true,
      },
      observability: {
        logLevel: "debug",
        loggingEnabled: true,
      },
    },
  },
};

/**
 * All available profile templates
 */
export const PROFILE_TEMPLATES: ProfileTemplate[] = [
  SECURE_TEMPLATE,
  DEVELOPMENT_TEMPLATE,
  MINIMAL_TEMPLATE,
  FULL_FEATURED_TEMPLATE,
];

/**
 * Get a template by ID
 */
export function getTemplateById(id: string): ProfileTemplate | undefined {
  return PROFILE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Get templates by tag
 */
export function getTemplatesByTag(tag: string): ProfileTemplate[] {
  return PROFILE_TEMPLATES.filter((t) => t.tags.includes(tag));
}
