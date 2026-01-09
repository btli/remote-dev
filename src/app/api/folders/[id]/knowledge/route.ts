import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { projectKnowledgeService, folderRepository } from "@/infrastructure/container";
import type { Convention, LearnedPattern, SkillDefinition, ToolDefinition } from "@/domain/entities/ProjectKnowledge";

/**
 * GET /api/folders/[id]/knowledge - Get project knowledge for a folder
 *
 * Query parameters:
 * - search?: Search query for semantic search through knowledge
 * - type?: Filter by type (convention, pattern, skill, tool)
 * - category?: Filter conventions by category
 */
export const GET = withAuth(async (request, { userId, params }) => {
  try {
    const folderId = params!.id;
    const url = new URL(request.url);

    // Verify folder belongs to user (findById checks userId)
    const folder = await folderRepository.findById(folderId, userId);
    if (!folder) {
      return errorResponse("Folder not found", 404, "FOLDER_NOT_FOUND");
    }

    // Get knowledge for folder
    const knowledge = await projectKnowledgeService.getByFolderId(folderId);

    if (!knowledge) {
      return NextResponse.json({
        knowledge: null,
        exists: false,
      });
    }

    // Handle search
    const searchQuery = url.searchParams.get("search");
    if (searchQuery) {
      const results = await projectKnowledgeService.searchKnowledge(
        knowledge.id,
        searchQuery,
        10
      );

      return NextResponse.json({
        knowledge: {
          id: knowledge.id,
          folderId: knowledge.folderId,
          techStack: knowledge.techStack,
          metadata: knowledge.metadata,
          lastScannedAt: knowledge.lastScannedAt,
        },
        searchResults: results.map((r) => ({
          type: r.type,
          item: r.item,
          score: r.score,
        })),
      });
    }

    // Handle type filter
    const typeFilter = url.searchParams.get("type");
    const categoryFilter = url.searchParams.get("category");

    const response: Record<string, unknown> = {
      knowledge: {
        id: knowledge.id,
        folderId: knowledge.folderId,
        techStack: knowledge.techStack,
        metadata: knowledge.metadata,
        lastScannedAt: knowledge.lastScannedAt,
        createdAt: knowledge.createdAt,
        updatedAt: knowledge.updatedAt,
      },
      exists: true,
    };

    // Include filtered content
    if (!typeFilter || typeFilter === "convention") {
      let conventions = knowledge.conventions;
      if (categoryFilter) {
        conventions = conventions.filter((c) => c.category === categoryFilter);
      }
      response.conventions = conventions;
    }

    if (!typeFilter || typeFilter === "pattern") {
      response.patterns = knowledge.patterns;
    }

    if (!typeFilter || typeFilter === "skill") {
      response.skills = knowledge.skills;
    }

    if (!typeFilter || typeFilter === "tool") {
      response.tools = knowledge.tools;
    }

    // Include agent performance stats
    if (!typeFilter) {
      response.agentPerformance = knowledge.agentPerformance;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error getting knowledge:", error);
    return errorResponse("Failed to get knowledge", 500);
  }
});

/**
 * PATCH /api/folders/[id]/knowledge - Update project knowledge
 *
 * Body options:
 * - action: "add_convention" | "add_pattern" | "add_skill" | "add_tool" | "update_tech_stack" | "update_metadata" | "scan"
 * - data: Data for the action
 */
export const PATCH = withAuth(async (request, { userId, params }) => {
  try {
    const folderId = params!.id;

    // Verify folder belongs to user (findById checks userId)
    const folder = await folderRepository.findById(folderId, userId);
    if (!folder) {
      return errorResponse("Folder not found", 404, "FOLDER_NOT_FOUND");
    }

    const result = await parseJsonBody<{
      action:
        | "add_convention"
        | "add_pattern"
        | "add_skill"
        | "add_tool"
        | "update_tech_stack"
        | "update_metadata"
        | "scan";
      data?: Record<string, unknown>;
    }>(request);
    if ("error" in result) return result.error;
    const { action, data } = result.data;

    // Get or create knowledge
    // Note: Folder entity doesn't have defaultPath. Use "." as default.
    // In production, this should be retrieved from folder preferences.
    const folderPath = ".";
    let knowledge = await projectKnowledgeService.getOrCreateForFolder(
      folderId,
      userId,
      folderPath
    );

    switch (action) {
      case "add_convention": {
        if (!data?.description || !data?.category) {
          return errorResponse(
            "description and category required for add_convention",
            400,
            "INVALID_DATA"
          );
        }
        knowledge = knowledge.addConvention({
          category: data.category as Convention["category"],
          description: data.description as string,
          examples: (data.examples as string[]) ?? [],
          confidence: (data.confidence as number) ?? 0.8,
          source: "manual",
        });
        break;
      }

      case "add_pattern": {
        if (!data?.type || !data?.description) {
          return errorResponse(
            "type and description required for add_pattern",
            400,
            "INVALID_DATA"
          );
        }
        knowledge = knowledge.addPattern({
          type: data.type as LearnedPattern["type"],
          description: data.description as string,
          context: (data.context as string) ?? "",
          confidence: (data.confidence as number) ?? 0.7,
        });
        break;
      }

      case "add_skill": {
        if (!data?.name || !data?.command) {
          return errorResponse(
            "name and command required for add_skill",
            400,
            "INVALID_DATA"
          );
        }
        knowledge = knowledge.addSkill({
          name: data.name as string,
          description: (data.description as string) ?? "",
          command: data.command as string,
          steps: (data.steps as SkillDefinition["steps"]) ?? [],
          triggers: (data.triggers as string[]) ?? [],
          scope: "project",
          verified: false,
        });
        break;
      }

      case "add_tool": {
        if (!data?.name || !data?.description) {
          return errorResponse(
            "name and description required for add_tool",
            400,
            "INVALID_DATA"
          );
        }
        knowledge = knowledge.addTool({
          name: data.name as string,
          description: data.description as string,
          inputSchema: (data.inputSchema as Record<string, unknown>) ?? {},
          implementation: {
            type: (data.implementationType as ToolDefinition["implementation"]["type"]) ?? "command",
            code: (data.implementationCode as string) ?? "",
          },
          triggers: (data.triggers as string[]) ?? [],
          confidence: (data.confidence as number) ?? 0.5,
          verified: false,
        });
        break;
      }

      case "update_tech_stack": {
        if (!data?.techStack || !Array.isArray(data.techStack)) {
          return errorResponse(
            "techStack array required for update_tech_stack",
            400,
            "INVALID_DATA"
          );
        }
        knowledge = knowledge.updateTechStack(data.techStack as string[]);
        break;
      }

      case "update_metadata": {
        if (!data) {
          return errorResponse(
            "metadata object required for update_metadata",
            400,
            "INVALID_DATA"
          );
        }
        knowledge = knowledge.updateMetadata({
          projectName: data.projectName as string | undefined,
          projectPath: data.projectPath as string | undefined,
          framework: data.framework as string | undefined,
          packageManager: data.packageManager as string | undefined,
          testRunner: data.testRunner as string | undefined,
          linter: data.linter as string | undefined,
          buildTool: data.buildTool as string | undefined,
        });
        break;
      }

      case "scan": {
        // Re-scan folder for tech stack and mark as scanned
        knowledge = knowledge.markScanned();
        // TODO: Trigger full project scan using project-metadata-service
        break;
      }

      default:
        return errorResponse(`Unknown action: ${action}`, 400, "UNKNOWN_ACTION");
    }

    // Save updates via repository (access through container)
    const { projectKnowledgeRepository } = await import("@/infrastructure/container");
    await projectKnowledgeRepository.save(knowledge);

    return NextResponse.json({
      knowledge: {
        id: knowledge.id,
        folderId: knowledge.folderId,
        techStack: knowledge.techStack,
        metadata: knowledge.metadata,
        lastScannedAt: knowledge.lastScannedAt,
        updatedAt: knowledge.updatedAt,
      },
      action,
      success: true,
    });
  } catch (error) {
    console.error("Error updating knowledge:", error);
    return errorResponse("Failed to update knowledge", 500);
  }
});

/**
 * DELETE /api/folders/[id]/knowledge - Delete project knowledge
 */
export const DELETE = withAuth(async (request, { userId, params }) => {
  try {
    const folderId = params!.id;

    // Verify folder belongs to user (findById checks userId)
    const folder = await folderRepository.findById(folderId, userId);
    if (!folder) {
      return errorResponse("Folder not found", 404, "FOLDER_NOT_FOUND");
    }

    // Get knowledge
    const knowledge = await projectKnowledgeService.getByFolderId(folderId);
    if (!knowledge) {
      return errorResponse("Knowledge not found", 404, "KNOWLEDGE_NOT_FOUND");
    }

    // Delete
    await projectKnowledgeService.delete(knowledge.id);

    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("Error deleting knowledge:", error);
    return errorResponse("Failed to delete knowledge", 500);
  }
});
