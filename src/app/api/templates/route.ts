import { NextResponse } from "next/server";
import { withAuth, errorResponse, parseJsonBody } from "@/lib/api";
import {
  getTemplates,
  createTemplate,
  type CreateTemplateInput,
} from "@/services/template-service";

export const GET = withAuth(async (_request, { userId }) => {
  const templates = await getTemplates(userId);
  return NextResponse.json(templates);
});

export const POST = withAuth(async (request, { userId }) => {
  const result = await parseJsonBody<CreateTemplateInput>(request);
  if ("error" in result) return result.error;
  const body = result.data;

  if (!body.name?.trim()) {
    return errorResponse("Template name is required", 400);
  }

  const template = await createTemplate(userId, body);
  return NextResponse.json(template, { status: 201 });
});
