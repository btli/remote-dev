/**
 * Agent Heuristics - Selection logic for choosing optimal agent per task
 *
 * Each agent has different strengths:
 * - Claude: Complex code, architecture, code review, React/TypeScript
 * - Gemini: Research, documentation, exploration, multi-file analysis
 * - Codex: Quick fixes, tests, refactoring, boilerplate
 * - OpenCode: General purpose, similar to Claude
 */

// Executable agents (excludes "all" from ExecutableAgent)
export type ExecutableAgent = "claude" | "gemini" | "codex" | "opencode";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TaskCategory =
  | "research"
  | "complex_code"
  | "quick_fix"
  | "testing"
  | "review"
  | "documentation"
  | "refactoring"
  | "debugging"
  | "architecture"
  | "general";

export interface TaskClassification {
  category: TaskCategory;
  confidence: number;
  keywords: string[];
  reasoning: string;
}

export interface AgentCapability {
  provider: ExecutableAgent;
  categories: TaskCategory[];
  strengths: string[];
  weaknesses: string[];
  speedRating: number; // 1-5, higher is faster
  qualityRating: number; // 1-5, higher is better quality
}

export interface AgentRecommendation {
  recommended: ExecutableAgent;
  alternatives: ExecutableAgent[];
  confidence: number;
  reasoning: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Capability Profiles
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_CAPABILITIES: Record<ExecutableAgent, AgentCapability> = {
  claude: {
    provider: "claude",
    categories: [
      "complex_code",
      "architecture",
      "review",
      "debugging",
      "refactoring",
    ],
    strengths: [
      "Complex multi-file changes",
      "Architectural decisions",
      "Code review and analysis",
      "React/TypeScript expertise",
      "Security considerations",
      "Documentation",
    ],
    weaknesses: [
      "Can be verbose",
      "Slower for simple tasks",
    ],
    speedRating: 3,
    qualityRating: 5,
  },
  gemini: {
    provider: "gemini",
    categories: [
      "research",
      "documentation",
      "general",
    ],
    strengths: [
      "Research and exploration",
      "Multi-file analysis",
      "Documentation generation",
      "API integration research",
      "Long context understanding",
    ],
    weaknesses: [
      "Complex code changes",
      "Architectural decisions",
    ],
    speedRating: 4,
    qualityRating: 3,
  },
  codex: {
    provider: "codex",
    categories: [
      "quick_fix",
      "testing",
      "refactoring",
    ],
    strengths: [
      "Fast execution",
      "Test generation",
      "Quick bug fixes",
      "Boilerplate code",
      "Simple refactoring",
    ],
    weaknesses: [
      "Complex architecture",
      "Multi-file reasoning",
    ],
    speedRating: 5,
    qualityRating: 3,
  },
  opencode: {
    provider: "opencode",
    categories: [
      "general",
      "quick_fix",
      "debugging",
    ],
    strengths: [
      "General purpose coding",
      "Good balance of speed/quality",
      "Wide language support",
    ],
    weaknesses: [
      "May not match specialized agents",
    ],
    speedRating: 4,
    qualityRating: 4,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Task Classification Keywords
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<TaskCategory, string[]> = {
  research: [
    "research",
    "investigate",
    "explore",
    "analyze",
    "find",
    "compare",
    "evaluate",
    "study",
    "understand",
    "learn",
    "discover",
    "identify",
  ],
  complex_code: [
    "implement",
    "build",
    "create",
    "develop",
    "architecture",
    "design",
    "integrate",
    "feature",
    "system",
    "service",
    "module",
  ],
  quick_fix: [
    "fix",
    "bug",
    "patch",
    "hotfix",
    "typo",
    "error",
    "broken",
    "issue",
    "update",
    "change",
  ],
  testing: [
    "test",
    "testing",
    "spec",
    "coverage",
    "unit",
    "integration",
    "e2e",
    "assertion",
    "mock",
    "stub",
  ],
  review: [
    "review",
    "audit",
    "check",
    "verify",
    "validate",
    "assess",
    "inspect",
    "security",
    "quality",
  ],
  documentation: [
    "document",
    "docs",
    "readme",
    "comment",
    "explain",
    "describe",
    "api",
    "guide",
    "tutorial",
  ],
  refactoring: [
    "refactor",
    "clean",
    "reorganize",
    "restructure",
    "simplify",
    "optimize",
    "improve",
    "extract",
    "rename",
  ],
  debugging: [
    "debug",
    "trace",
    "diagnose",
    "troubleshoot",
    "investigate",
    "log",
    "stack",
    "crash",
    "memory",
  ],
  architecture: [
    "architect",
    "design",
    "pattern",
    "structure",
    "layer",
    "module",
    "component",
    "interface",
    "abstraction",
  ],
  general: [
    "update",
    "modify",
    "add",
    "remove",
    "configure",
    "setup",
    "install",
    "deploy",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Classification Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a task based on its title and description.
 */
export function classifyTask(
  title: string,
  description?: string
): TaskClassification {
  const text = `${title} ${description || ""}`.toLowerCase();
  const words = text.split(/\s+/);

  const categoryScores: Record<TaskCategory, number> = {
    research: 0,
    complex_code: 0,
    quick_fix: 0,
    testing: 0,
    review: 0,
    documentation: 0,
    refactoring: 0,
    debugging: 0,
    architecture: 0,
    general: 0,
  };

  const matchedKeywords: string[] = [];

  // Score each category based on keyword matches
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        categoryScores[category as TaskCategory] += 1;
        if (!matchedKeywords.includes(keyword)) {
          matchedKeywords.push(keyword);
        }
      }
    }
  }

  // Find the highest scoring category
  let maxScore = 0;
  let topCategory: TaskCategory = "general";

  for (const [category, score] of Object.entries(categoryScores)) {
    if (score > maxScore) {
      maxScore = score;
      topCategory = category as TaskCategory;
    }
  }

  // Calculate confidence based on score and distinctiveness
  const totalScore = Object.values(categoryScores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0 ? maxScore / totalScore : 0.5;

  // Generate reasoning
  let reasoning = `Task classified as '${topCategory}'`;
  if (matchedKeywords.length > 0) {
    reasoning += ` based on keywords: ${matchedKeywords.slice(0, 5).join(", ")}`;
  }

  return {
    category: topCategory,
    confidence: Math.min(confidence, 1),
    keywords: matchedKeywords,
    reasoning,
  };
}

/**
 * Select the best agent for a given task category.
 */
export function selectAgentForCategory(
  category: TaskCategory,
  availableAgents?: ExecutableAgent[]
): AgentRecommendation {
  const agents = availableAgents || (["claude", "gemini", "codex", "opencode"] as ExecutableAgent[]);

  // Default preference order based on category
  const categoryPreferences: Record<TaskCategory, ExecutableAgent[]> = {
    research: ["gemini", "claude", "opencode", "codex"],
    complex_code: ["claude", "opencode", "codex", "gemini"],
    quick_fix: ["codex", "opencode", "claude", "gemini"],
    testing: ["codex", "claude", "opencode", "gemini"],
    review: ["claude", "opencode", "gemini", "codex"],
    documentation: ["gemini", "claude", "opencode", "codex"],
    refactoring: ["claude", "codex", "opencode", "gemini"],
    debugging: ["claude", "opencode", "codex", "gemini"],
    architecture: ["claude", "opencode", "gemini", "codex"],
    general: ["claude", "opencode", "codex", "gemini"],
  };

  const preferences = categoryPreferences[category];
  const filtered = preferences.filter((p) => agents.includes(p));

  if (filtered.length === 0) {
    // Fallback to first available
    return {
      recommended: agents[0],
      alternatives: agents.slice(1),
      confidence: 0.3,
      reasoning: `No preferred agent available for ${category}, using fallback`,
    };
  }

  const recommended = filtered[0];
  const capability = AGENT_CAPABILITIES[recommended];

  // Calculate confidence based on how well the agent matches the category
  const isPreferred = capability.categories.includes(category);
  const confidence = isPreferred ? 0.9 : 0.6;

  return {
    recommended,
    alternatives: filtered.slice(1),
    confidence,
    reasoning: `${recommended} selected for ${category}: ${capability.strengths.slice(0, 2).join(", ")}`,
  };
}

/**
 * Get the optimal agent for a task.
 */
export function selectAgent(
  title: string,
  description?: string,
  availableAgents?: ExecutableAgent[]
): AgentRecommendation {
  const classification = classifyTask(title, description);
  const recommendation = selectAgentForCategory(
    classification.category,
    availableAgents
  );

  return {
    ...recommendation,
    confidence: recommendation.confidence * classification.confidence,
    reasoning: `${classification.reasoning}. ${recommendation.reasoning}`,
  };
}

/**
 * Estimate task complexity for prioritization.
 */
export function estimateComplexity(
  title: string,
  description?: string
): {
  level: "low" | "medium" | "high";
  score: number;
  factors: string[];
} {
  const text = `${title} ${description || ""}`.toLowerCase();
  const factors: string[] = [];
  let score = 1;

  // Complexity indicators
  const complexityIndicators = [
    { pattern: /multiple|several|many/i, factor: "multiple items", weight: 0.5 },
    { pattern: /refactor|redesign|rewrite/i, factor: "major changes", weight: 1 },
    { pattern: /integrate|integration/i, factor: "integration work", weight: 0.7 },
    { pattern: /security|auth/i, factor: "security considerations", weight: 0.8 },
    { pattern: /performance|optimize/i, factor: "performance work", weight: 0.6 },
    { pattern: /database|migration/i, factor: "database changes", weight: 0.7 },
    { pattern: /api|endpoint/i, factor: "API work", weight: 0.4 },
    { pattern: /test|testing/i, factor: "testing required", weight: 0.3 },
  ];

  for (const indicator of complexityIndicators) {
    if (indicator.pattern.test(text)) {
      score += indicator.weight;
      factors.push(indicator.factor);
    }
  }

  // Simple indicators that reduce complexity
  const simpleIndicators = [
    { pattern: /fix typo|update comment|rename/i, factor: "simple change", weight: -0.5 },
    { pattern: /single|one|simple/i, factor: "limited scope", weight: -0.3 },
  ];

  for (const indicator of simpleIndicators) {
    if (indicator.pattern.test(text)) {
      score += indicator.weight;
      factors.push(indicator.factor);
    }
  }

  // Normalize score to level
  let level: "low" | "medium" | "high";
  if (score <= 1.5) {
    level = "low";
  } else if (score <= 3) {
    level = "medium";
  } else {
    level = "high";
  }

  return {
    level,
    score: Math.max(0, Math.min(5, score)),
    factors,
  };
}

/**
 * Get agent capabilities summary.
 */
export function getAgentCapabilities(provider: ExecutableAgent): AgentCapability {
  return AGENT_CAPABILITIES[provider];
}

/**
 * Compare agents for a specific task.
 */
export function compareAgentsForTask(
  title: string,
  description?: string
): Array<{
  agent: ExecutableAgent;
  score: number;
  reasoning: string;
}> {
  const classification = classifyTask(title, description);

  return (Object.keys(AGENT_CAPABILITIES) as ExecutableAgent[]).map((agent) => {
    const capability = AGENT_CAPABILITIES[agent];
    const isPreferred = capability.categories.includes(classification.category);

    // Score based on category match, speed, and quality
    let score = 0;
    if (isPreferred) {
      score += 3;
    }
    score += capability.speedRating * 0.3;
    score += capability.qualityRating * 0.4;

    return {
      agent,
      score: Math.round(score * 10) / 10,
      reasoning: isPreferred
        ? `${agent} is specialized for ${classification.category}`
        : `${agent} is a general option for ${classification.category}`,
    };
  }).sort((a, b) => b.score - a.score);
}
