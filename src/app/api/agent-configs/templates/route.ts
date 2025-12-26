import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as TemplateService from "@/services/agent-config-template-service";

/**
 * GET /api/agent-configs/templates - Get all available templates
 *
 * Query params:
 * - projectType: Filter by project type (typescript, python, rust)
 * - provider: Filter by provider (claude, codex, gemini)
 * - tags: Comma-separated list of tags to filter by
 */
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const projectType = searchParams.get("projectType");
  const provider = searchParams.get("provider");
  const tagsParam = searchParams.get("tags");

  let templates = TemplateService.getAllTemplates();

  // Apply filters
  if (projectType) {
    templates = templates.filter((t) => t.projectType === projectType);
  }

  if (provider) {
    templates = templates.filter((t) => t.provider === provider);
  }

  if (tagsParam) {
    const tags = tagsParam.split(",").map((t) => t.trim());
    templates = templates.filter((t) => tags.some((tag) => t.tags.includes(tag)));
  }

  return NextResponse.json({
    templates,
    projectTypes: TemplateService.getProjectTypes(),
    tags: TemplateService.getAllTags(),
  });
});

/**
 * POST /api/agent-configs/templates/apply - Apply a template to a folder
 */
export const POST = withAuth(async (request, { userId }) => {
  const result = await parseJsonBody<{
    templateId?: string;
    projectType?: string;
    folderId: string;
  }>(request);

  if ("error" in result) {
    return result.error;
  }

  const { templateId, projectType, folderId } = result.data;

  if (!folderId) {
    return errorResponse("folderId is required", 400);
  }

  if (!templateId && !projectType) {
    return errorResponse("Either templateId or projectType is required", 400);
  }

  try {
    if (templateId) {
      // Apply single template
      await TemplateService.applyTemplateToFolder(templateId, folderId, userId);
      const template = TemplateService.getTemplateById(templateId);
      return NextResponse.json({
        success: true,
        applied: [template],
      });
    } else if (projectType) {
      // Apply all templates for project type
      const templates = await TemplateService.applyProjectTypeTemplates(
        projectType,
        folderId,
        userId
      );
      return NextResponse.json({
        success: true,
        applied: templates,
      });
    }
  } catch (error) {
    if (error instanceof TemplateService.TemplateServiceError) {
      return errorResponse(error.message, 400, error.code);
    }
    throw error;
  }

  return errorResponse("Invalid request", 400);
});
