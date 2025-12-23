import { db } from "@/db";
import { sessionTemplates } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

// Re-export types and utilities from shared module for backwards compatibility
export type {
  SessionTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
} from "@/types/template";
export { expandNamePattern } from "@/types/template";

import type { SessionTemplate, CreateTemplateInput, UpdateTemplateInput } from "@/types/template";

/**
 * Get all templates for a user, ordered by usage count (most used first)
 */
export async function getTemplates(userId: string): Promise<SessionTemplate[]> {
  const results = await db
    .select()
    .from(sessionTemplates)
    .where(eq(sessionTemplates.userId, userId))
    .orderBy(desc(sessionTemplates.usageCount));

  return results;
}

/**
 * Get a single template by ID
 */
export async function getTemplate(
  templateId: string,
  userId: string
): Promise<SessionTemplate | null> {
  const results = await db
    .select()
    .from(sessionTemplates)
    .where(
      and(
        eq(sessionTemplates.id, templateId),
        eq(sessionTemplates.userId, userId)
      )
    );

  return results[0] ?? null;
}

/**
 * Create a new template
 */
export async function createTemplate(
  userId: string,
  input: CreateTemplateInput
): Promise<SessionTemplate> {
  const [template] = await db
    .insert(sessionTemplates)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
      sessionNamePattern: input.sessionNamePattern ?? null,
      projectPath: input.projectPath ?? null,
      startupCommand: input.startupCommand ?? null,
      folderId: input.folderId ?? null,
      icon: input.icon ?? null,
      theme: input.theme ?? null,
      fontSize: input.fontSize ?? null,
      fontFamily: input.fontFamily ?? null,
    })
    .returning();

  return template;
}

/**
 * Update an existing template
 */
export async function updateTemplate(
  templateId: string,
  userId: string,
  input: UpdateTemplateInput
): Promise<SessionTemplate | null> {
  const results = await db
    .update(sessionTemplates)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionTemplates.id, templateId),
        eq(sessionTemplates.userId, userId)
      )
    )
    .returning();

  return results[0] ?? null;
}

/**
 * Delete a template
 */
export async function deleteTemplate(
  templateId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(sessionTemplates)
    .where(
      and(
        eq(sessionTemplates.id, templateId),
        eq(sessionTemplates.userId, userId)
      )
    )
    .returning({ id: sessionTemplates.id });

  return result.length > 0;
}

/**
 * Record template usage (increment counter and update lastUsedAt)
 */
export async function recordTemplateUsage(
  templateId: string,
  userId: string
): Promise<void> {
  const template = await getTemplate(templateId, userId);
  if (!template) return;

  await db
    .update(sessionTemplates)
    .set({
      usageCount: template.usageCount + 1,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(sessionTemplates.id, templateId));
}

