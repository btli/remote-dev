"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { apiFetch } from "@/lib/api-fetch";
import type {
  CreateScheduleTemplateInput,
  ScheduleTemplate,
  UpdateScheduleTemplateInput,
} from "@/types/schedule-template";

interface ScheduleTemplateContextValue {
  templates: ScheduleTemplate[];
  loading: boolean;
  error: string | null;
  refreshTemplates: () => Promise<void>;
  createTemplate: (
    input: CreateScheduleTemplateInput
  ) => Promise<ScheduleTemplate>;
  updateTemplate: (
    id: string,
    input: UpdateScheduleTemplateInput
  ) => Promise<ScheduleTemplate>;
  deleteTemplate: (id: string) => Promise<boolean>;
  recordUsage: (id: string) => Promise<void>;
}

const ScheduleTemplateContext =
  createContext<ScheduleTemplateContextValue | null>(null);

function hydrateTemplate(template: ScheduleTemplate): ScheduleTemplate {
  return {
    ...template,
    lastUsedAt: template.lastUsedAt ? new Date(template.lastUsedAt) : null,
    createdAt: new Date(template.createdAt),
    updatedAt: new Date(template.updatedAt),
  };
}

async function responseError(
  response: Response,
  fallbackMessage: string
): Promise<Error> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string" &&
      body.error
    ) {
      return new Error(body.error);
    }
  } catch {
    // A non-JSON error response still gets the operation-specific fallback.
  }
  return new Error(fallbackMessage);
}

export function useScheduleTemplateContext(): ScheduleTemplateContextValue {
  const context = useContext(ScheduleTemplateContext);
  if (!context) {
    throw new Error(
      "useScheduleTemplateContext must be used within a ScheduleTemplateProvider"
    );
  }
  return context;
}

export function ScheduleTemplateProvider({ children }: { children: ReactNode }) {
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/schedule-templates");
      if (!response.ok) throw new Error("Failed to load schedule templates");
      const data = (await response.json()) as { templates?: ScheduleTemplate[] };
      setTemplates((data.templates ?? []).map(hydrateTemplate));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);

  const createTemplate = useCallback(
    async (
      input: CreateScheduleTemplateInput
    ): Promise<ScheduleTemplate> => {
      const response = await apiFetch("/api/schedule-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw await responseError(
          response,
          "Failed to create schedule template"
        );
      }
      const template = hydrateTemplate(await response.json());
      setTemplates((current) => [template, ...current]);
      return template;
    },
    []
  );

  const updateTemplate = useCallback(
    async (
      id: string,
      input: UpdateScheduleTemplateInput
    ): Promise<ScheduleTemplate> => {
      const response = await apiFetch(`/api/schedule-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw await responseError(
          response,
          "Failed to update schedule template"
        );
      }
      const template = hydrateTemplate(await response.json());
      setTemplates((current) =>
        current.map((item) => (item.id === id ? template : item))
      );
      return template;
    },
    []
  );

  const deleteTemplate = useCallback(async (id: string): Promise<boolean> => {
    const response = await apiFetch(`/api/schedule-templates/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw await responseError(
        response,
        "Failed to delete schedule template"
      );
    }
    setTemplates((current) => current.filter((item) => item.id !== id));
    return true;
  }, []);

  const recordUsage = useCallback(async (id: string): Promise<void> => {
    try {
      const response = await apiFetch(`/api/schedule-templates/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "use" }),
      });
      if (!response.ok) {
        throw await responseError(
          response,
          "Failed to record schedule template usage"
        );
      }
      setTemplates((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                usageCount: item.usageCount + 1,
                lastUsedAt: new Date(),
              }
            : item
        )
      );
    } catch (err) {
      console.error("Error recording schedule template usage:", err);
    }
  }, []);

  return (
    <ScheduleTemplateContext.Provider
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
    </ScheduleTemplateContext.Provider>
  );
}
