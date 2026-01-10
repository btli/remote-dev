/**
 * Learning MCP Tools
 *
 * Tools for managing project knowledge and episodic memory.
 */
import { z } from "zod";
import { db } from "@/db";
import { projectKnowledge, sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createTool } from "../registry";
import { successResult, errorResult } from "../utils/error-handler";
import type { RegisteredTool } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// knowledge_add - Add new knowledge to project
// ─────────────────────────────────────────────────────────────────────────────

const knowledgeAdd = createTool({
  name: "knowledge_add",
  description:
    "Add a new convention, pattern, skill, or tool to the project knowledge base. " +
    "Use this after learning something new about the project that should be remembered.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("The folder UUID to add knowledge to"),
    type: z
      .enum(["convention", "pattern", "skill", "tool"])
      .describe("Type of knowledge to add"),
    name: z.string().min(1).describe("Short name for the knowledge item"),
    description: z.string().min(1).describe("Detailed description"),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.8)
      .describe("Confidence score 0-1 (default: 0.8)"),
    source: z
      .string()
      .optional()
      .describe("Source of this knowledge (e.g., 'session-abc123', 'manual')"),
  }),
  handler: async (input, context) => {
    // Verify folder exists and belongs to user
    const folder = await db
      .select()
      .from(sessionFolders)
      .where(
        and(
          eq(sessionFolders.id, input.folderId),
          eq(sessionFolders.userId, context.userId)
        )
      )
      .limit(1);

    if (folder.length === 0) {
      return errorResult(
        `Folder ${input.folderId} not found or access denied`,
        "FOLDER_NOT_FOUND"
      );
    }

    // Get existing knowledge or create new
    let existing = await db
      .select()
      .from(projectKnowledge)
      .where(eq(projectKnowledge.folderId, input.folderId))
      .limit(1);

    const newItem = {
      name: input.name,
      description: input.description,
      confidence: input.confidence,
      source: input.source || "mcp",
      createdAt: new Date().toISOString(),
    };

    const now = new Date();

    if (existing.length === 0) {
      // Create new knowledge record
      const initialData: Record<string, string> = {};
      if (input.type === "convention") {
        initialData.conventionsJson = JSON.stringify([newItem]);
      } else if (input.type === "pattern") {
        initialData.patternsJson = JSON.stringify([newItem]);
      } else if (input.type === "skill") {
        initialData.skillsJson = JSON.stringify([newItem]);
      } else if (input.type === "tool") {
        initialData.toolsJson = JSON.stringify([newItem]);
      }

      await db.insert(projectKnowledge).values({
        id: crypto.randomUUID(),
        folderId: input.folderId,
        userId: context.userId,
        ...initialData,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      // Update existing knowledge
      const data = existing[0];
      let items: unknown[] = [];

      // Parse existing items
      if (input.type === "convention" && data.conventionsJson) {
        items = JSON.parse(data.conventionsJson);
      } else if (input.type === "pattern" && data.patternsJson) {
        items = JSON.parse(data.patternsJson);
      } else if (input.type === "skill" && data.skillsJson) {
        items = JSON.parse(data.skillsJson);
      } else if (input.type === "tool" && data.toolsJson) {
        items = JSON.parse(data.toolsJson);
      }

      // Add new item
      items.push(newItem);

      // Build update
      const update: Record<string, unknown> = { updatedAt: now };
      if (input.type === "convention") {
        update.conventionsJson = JSON.stringify(items);
      } else if (input.type === "pattern") {
        update.patternsJson = JSON.stringify(items);
      } else if (input.type === "skill") {
        update.skillsJson = JSON.stringify(items);
      } else if (input.type === "tool") {
        update.toolsJson = JSON.stringify(items);
      }

      await db
        .update(projectKnowledge)
        .set(update)
        .where(eq(projectKnowledge.id, data.id));
    }

    return successResult({
      success: true,
      folderId: input.folderId,
      type: input.type,
      name: input.name,
      hint: `Added ${input.type} "${input.name}" to project knowledge.`,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// knowledge_update - Update existing knowledge
// ─────────────────────────────────────────────────────────────────────────────

const knowledgeUpdate = createTool({
  name: "knowledge_update",
  description:
    "Update an existing knowledge item's description or confidence. " +
    "Use this to refine or correct previously learned knowledge.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("The folder UUID"),
    type: z
      .enum(["convention", "pattern", "skill", "tool"])
      .describe("Type of knowledge"),
    name: z.string().min(1).describe("Name of the knowledge item to update"),
    description: z.string().optional().describe("New description"),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("New confidence score 0-1"),
  }),
  handler: async (input, context) => {
    // Verify folder exists and belongs to user
    const folder = await db
      .select()
      .from(sessionFolders)
      .where(
        and(
          eq(sessionFolders.id, input.folderId),
          eq(sessionFolders.userId, context.userId)
        )
      )
      .limit(1);

    if (folder.length === 0) {
      return errorResult(
        `Folder ${input.folderId} not found or access denied`,
        "FOLDER_NOT_FOUND"
      );
    }

    // Get existing knowledge
    const existing = await db
      .select()
      .from(projectKnowledge)
      .where(eq(projectKnowledge.folderId, input.folderId))
      .limit(1);

    if (existing.length === 0) {
      return errorResult(
        "No project knowledge found for this folder",
        "KNOWLEDGE_NOT_FOUND"
      );
    }

    const data = existing[0];
    let items: { name: string; description: string; confidence: number }[] = [];
    let jsonField: string;

    // Parse existing items
    if (input.type === "convention" && data.conventionsJson) {
      items = JSON.parse(data.conventionsJson);
      jsonField = "conventionsJson";
    } else if (input.type === "pattern" && data.patternsJson) {
      items = JSON.parse(data.patternsJson);
      jsonField = "patternsJson";
    } else if (input.type === "skill" && data.skillsJson) {
      items = JSON.parse(data.skillsJson);
      jsonField = "skillsJson";
    } else if (input.type === "tool" && data.toolsJson) {
      items = JSON.parse(data.toolsJson);
      jsonField = "toolsJson";
    } else {
      return errorResult(
        `No ${input.type}s found in project knowledge`,
        "TYPE_NOT_FOUND"
      );
    }

    // Find and update item
    const itemIndex = items.findIndex((i) => i.name === input.name);
    if (itemIndex === -1) {
      return errorResult(
        `${input.type} "${input.name}" not found`,
        "ITEM_NOT_FOUND"
      );
    }

    if (input.description !== undefined) {
      items[itemIndex].description = input.description;
    }
    if (input.confidence !== undefined) {
      items[itemIndex].confidence = input.confidence;
    }

    // Update database
    await db
      .update(projectKnowledge)
      .set({
        [jsonField]: JSON.stringify(items),
        updatedAt: new Date(),
      })
      .where(eq(projectKnowledge.id, data.id));

    return successResult({
      success: true,
      folderId: input.folderId,
      type: input.type,
      name: input.name,
      hint: `Updated ${input.type} "${input.name}".`,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// knowledge_delete - Delete knowledge item
// ─────────────────────────────────────────────────────────────────────────────

const knowledgeDelete = createTool({
  name: "knowledge_delete",
  description:
    "Delete a knowledge item that is no longer relevant or was incorrect.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("The folder UUID"),
    type: z
      .enum(["convention", "pattern", "skill", "tool"])
      .describe("Type of knowledge"),
    name: z.string().min(1).describe("Name of the knowledge item to delete"),
  }),
  handler: async (input, context) => {
    // Verify folder exists and belongs to user
    const folder = await db
      .select()
      .from(sessionFolders)
      .where(
        and(
          eq(sessionFolders.id, input.folderId),
          eq(sessionFolders.userId, context.userId)
        )
      )
      .limit(1);

    if (folder.length === 0) {
      return errorResult(
        `Folder ${input.folderId} not found or access denied`,
        "FOLDER_NOT_FOUND"
      );
    }

    // Get existing knowledge
    const existing = await db
      .select()
      .from(projectKnowledge)
      .where(eq(projectKnowledge.folderId, input.folderId))
      .limit(1);

    if (existing.length === 0) {
      return errorResult(
        "No project knowledge found for this folder",
        "KNOWLEDGE_NOT_FOUND"
      );
    }

    const data = existing[0];
    let items: { name: string }[] = [];
    let jsonField: string;

    // Parse existing items
    if (input.type === "convention" && data.conventionsJson) {
      items = JSON.parse(data.conventionsJson);
      jsonField = "conventionsJson";
    } else if (input.type === "pattern" && data.patternsJson) {
      items = JSON.parse(data.patternsJson);
      jsonField = "patternsJson";
    } else if (input.type === "skill" && data.skillsJson) {
      items = JSON.parse(data.skillsJson);
      jsonField = "skillsJson";
    } else if (input.type === "tool" && data.toolsJson) {
      items = JSON.parse(data.toolsJson);
      jsonField = "toolsJson";
    } else {
      return errorResult(
        `No ${input.type}s found in project knowledge`,
        "TYPE_NOT_FOUND"
      );
    }

    // Find and remove item
    const originalLength = items.length;
    items = items.filter((i) => i.name !== input.name);

    if (items.length === originalLength) {
      return errorResult(
        `${input.type} "${input.name}" not found`,
        "ITEM_NOT_FOUND"
      );
    }

    // Update database
    await db
      .update(projectKnowledge)
      .set({
        [jsonField]: JSON.stringify(items),
        updatedAt: new Date(),
      })
      .where(eq(projectKnowledge.id, data.id));

    return successResult({
      success: true,
      folderId: input.folderId,
      type: input.type,
      name: input.name,
      hint: `Deleted ${input.type} "${input.name}".`,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Export all learning tools
// ─────────────────────────────────────────────────────────────────────────────

export const learningTools: RegisteredTool[] = [
  knowledgeAdd,
  knowledgeUpdate,
  knowledgeDelete,
];
