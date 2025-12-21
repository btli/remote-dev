"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { SessionTemplate, CreateTemplateInput, UpdateTemplateInput } from "@/services/template-service";

interface TemplateContextValue {
  templates: SessionTemplate[];
  loading: boolean;
  error: string | null;
  refreshTemplates: () => Promise<void>;
  createTemplate: (input: CreateTemplateInput) => Promise<SessionTemplate | null>;
  updateTemplate: (id: string, input: UpdateTemplateInput) => Promise<SessionTemplate | null>;
  deleteTemplate: (id: string) => Promise<boolean>;
  recordUsage: (id: string) => Promise<void>;
}

const TemplateContext = createContext<TemplateContextValue | null>(null);

export function useTemplateContext() {
  const context = useContext(TemplateContext);
  if (!context) {
    throw new Error("useTemplateContext must be used within a TemplateProvider");
  }
  return context;
}

interface TemplateProviderProps {
  children: ReactNode;
}

export function TemplateProvider({ children }: TemplateProviderProps) {
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/templates");
      if (!response.ok) {
        throw new Error("Failed to fetch templates");
      }
      const data = await response.json();
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load templates on mount
  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);

  const createTemplate = useCallback(
    async (input: CreateTemplateInput): Promise<SessionTemplate | null> => {
      try {
        const response = await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          throw new Error("Failed to create template");
        }
        const template = await response.json();
        setTemplates((prev) => [template, ...prev]);
        return template;
      } catch (err) {
        console.error("Error creating template:", err);
        return null;
      }
    },
    []
  );

  const updateTemplate = useCallback(
    async (id: string, input: UpdateTemplateInput): Promise<SessionTemplate | null> => {
      try {
        const response = await fetch(`/api/templates/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          throw new Error("Failed to update template");
        }
        const template = await response.json();
        setTemplates((prev) =>
          prev.map((t) => (t.id === id ? template : t))
        );
        return template;
      } catch (err) {
        console.error("Error updating template:", err);
        return null;
      }
    },
    []
  );

  const deleteTemplate = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/templates/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete template");
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      return true;
    } catch (err) {
      console.error("Error deleting template:", err);
      return false;
    }
  }, []);

  const recordUsage = useCallback(async (id: string): Promise<void> => {
    try {
      await fetch(`/api/templates/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "use" }),
      });
      // Update local state to reflect usage
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, usageCount: t.usageCount + 1, lastUsedAt: new Date() }
            : t
        )
      );
    } catch (err) {
      console.error("Error recording template usage:", err);
    }
  }, []);

  return (
    <TemplateContext.Provider
      value={{
        templates,
        loading,
        error,
        refreshTemplates,
        createTemplate,
        updateTemplate,
        deleteTemplate,
        recordUsage,
      }}
    >
      {children}
    </TemplateContext.Provider>
  );
}
