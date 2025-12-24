import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  getTemplate,
  updateTemplate,
  deleteTemplate,
  recordTemplateUsage,
  type UpdateTemplateInput,
} from "@/services/template-service";

export const GET = withAuth(async (_request, { userId, params }) => {
  const template = await getTemplate(params!.id, userId);

  if (!template) {
    return errorResponse("Template not found", 404);
  }

  return NextResponse.json(template);
});

export const PATCH = withAuth(async (request, { userId, params }) => {
  const body = (await request.json()) as UpdateTemplateInput;
  const template = await updateTemplate(params!.id, userId, body);

  if (!template) {
    return errorResponse("Template not found", 404);
  }

  return NextResponse.json(template);
});

export const DELETE = withAuth(async (_request, { userId, params }) => {
  const deleted = await deleteTemplate(params!.id, userId);

  if (!deleted) {
    return errorResponse("Template not found", 404);
  }

  return NextResponse.json({ success: true });
});

// POST to record template usage
export const POST = withAuth(async (request, { userId, params }) => {
  const body = await request.json();

  if (body.action === "use") {
    await recordTemplateUsage(params!.id, userId);
    return NextResponse.json({ success: true });
  }

  return errorResponse("Unknown action", 400);
});
