"use client";

/**
 * useProjectKnowledge - Hook for project knowledge queries and updates.
 *
 * Provides:
 * - Fetch project knowledge for a folder
 * - Search knowledge semantically
 * - Add conventions, patterns, skills, tools
 * - Update tech stack and metadata
 */

import { useState, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Convention {
  id: string;
  category: "code_style" | "naming" | "architecture" | "testing" | "git" | "other";
  description: string;
  examples: string[];
  confidence: number;
  source: "observed" | "inferred" | "manual";
}

export interface LearnedPattern {
  id: string;
  type: "success" | "failure" | "preference" | "anti_pattern";
  description: string;
  context: string;
  confidence: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  command: string;
  steps: Array<{
    action: string;
    tool?: string;
    parameters?: Record<string, unknown>;
    successCriteria?: string;
  }>;
  triggers: string[];
  scope: "global" | "project";
  verified: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  implementation: {
    type: "command" | "function" | "mcp";
    code: string;
  };
  triggers: string[];
  confidence: number;
  verified: boolean;
}

export interface ProjectKnowledge {
  id: string;
  folderId: string;
  techStack: string[];
  metadata: {
    projectName?: string;
    projectPath?: string;
    framework?: string;
    packageManager?: string;
    testRunner?: string;
    linter?: string;
    buildTool?: string;
  };
  conventions: Convention[];
  patterns: LearnedPattern[];
  skills: SkillDefinition[];
  tools: ToolDefinition[];
  lastScannedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchResult {
  type: "convention" | "pattern" | "skill" | "tool";
  item: Convention | LearnedPattern | SkillDefinition | ToolDefinition;
  score: number;
}

interface UseProjectKnowledgeOptions {
  folderId: string;
  autoFetch?: boolean;
}

interface UseProjectKnowledgeReturn {
  knowledge: ProjectKnowledge | null;
  loading: boolean;
  error: string | null;
  exists: boolean;
  fetch: () => Promise<void>;
  search: (query: string) => Promise<SearchResult[]>;
  addConvention: (convention: Omit<Convention, "id">) => Promise<void>;
  addPattern: (pattern: Omit<LearnedPattern, "id">) => Promise<void>;
  addSkill: (skill: Omit<SkillDefinition, "id">) => Promise<void>;
  addTool: (tool: Omit<ToolDefinition, "id">) => Promise<void>;
  updateTechStack: (techStack: string[]) => Promise<void>;
  updateMetadata: (metadata: ProjectKnowledge["metadata"]) => Promise<void>;
  scan: () => Promise<void>;
  deleteKnowledge: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useProjectKnowledge(
  options: UseProjectKnowledgeOptions
): UseProjectKnowledgeReturn {
  const { folderId, autoFetch = true } = options;

  const [knowledge, setKnowledge] = useState<ProjectKnowledge | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);

  const fetch = useCallback(async () => {
    if (!folderId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await globalThis.fetch(`/api/folders/${folderId}/knowledge`);
      if (!response.ok) {
        throw new Error("Failed to fetch knowledge");
      }

      const data = await response.json();
      setExists(data.exists);

      if (data.knowledge) {
        setKnowledge(parseKnowledge(data));
      } else {
        setKnowledge(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  // Fetch knowledge on mount
  useEffect(() => {
    if (autoFetch && folderId) {
      fetch();
    }
  }, [folderId, autoFetch, fetch]);

  const search = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      if (!folderId) return [];

      const response = await globalThis.fetch(
        `/api/folders/${folderId}/knowledge?search=${encodeURIComponent(query)}`
      );

      if (!response.ok) {
        throw new Error("Failed to search knowledge");
      }

      const data = await response.json();
      return data.searchResults || [];
    },
    [folderId]
  );

  const patchKnowledge = useCallback(
    async (action: string, data?: Record<string, unknown>) => {
      if (!folderId) return;

      setLoading(true);
      setError(null);

      try {
        const response = await globalThis.fetch(`/api/folders/${folderId}/knowledge`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, data }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to update knowledge");
        }

        // Refresh after update
        await fetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [folderId, fetch]
  );

  const addConvention = useCallback(
    async (convention: Omit<Convention, "id">) => {
      await patchKnowledge("add_convention", convention as Record<string, unknown>);
    },
    [patchKnowledge]
  );

  const addPattern = useCallback(
    async (pattern: Omit<LearnedPattern, "id">) => {
      await patchKnowledge("add_pattern", pattern as Record<string, unknown>);
    },
    [patchKnowledge]
  );

  const addSkill = useCallback(
    async (skill: Omit<SkillDefinition, "id">) => {
      await patchKnowledge("add_skill", skill as Record<string, unknown>);
    },
    [patchKnowledge]
  );

  const addTool = useCallback(
    async (tool: Omit<ToolDefinition, "id">) => {
      await patchKnowledge("add_tool", tool as Record<string, unknown>);
    },
    [patchKnowledge]
  );

  const updateTechStack = useCallback(
    async (techStack: string[]) => {
      await patchKnowledge("update_tech_stack", { techStack });
    },
    [patchKnowledge]
  );

  const updateMetadata = useCallback(
    async (metadata: ProjectKnowledge["metadata"]) => {
      await patchKnowledge("update_metadata", metadata);
    },
    [patchKnowledge]
  );

  const scan = useCallback(async () => {
    await patchKnowledge("scan");
  }, [patchKnowledge]);

  const deleteKnowledge = useCallback(async () => {
    if (!folderId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await globalThis.fetch(`/api/folders/${folderId}/knowledge`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete knowledge");
      }

      setKnowledge(null);
      setExists(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  return {
    knowledge,
    loading,
    error,
    exists,
    fetch,
    search,
    addConvention,
    addPattern,
    addSkill,
    addTool,
    updateTechStack,
    updateMetadata,
    scan,
    deleteKnowledge,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseKnowledge(data: Record<string, unknown>): ProjectKnowledge {
  const k = data.knowledge as Record<string, unknown>;
  return {
    id: k.id as string,
    folderId: k.folderId as string,
    techStack: k.techStack as string[],
    metadata: k.metadata as ProjectKnowledge["metadata"],
    conventions: (data.conventions as Convention[]) || [],
    patterns: (data.patterns as LearnedPattern[]) || [],
    skills: (data.skills as SkillDefinition[]) || [],
    tools: (data.tools as ToolDefinition[]) || [],
    lastScannedAt: k.lastScannedAt ? new Date(k.lastScannedAt as string) : null,
    createdAt: new Date(k.createdAt as string),
    updatedAt: new Date(k.updatedAt as string),
  };
}
