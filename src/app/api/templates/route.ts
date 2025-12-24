import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
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
  const body = (await request.json()) as CreateTemplateInput;

  if (!body.name?.trim()) {
    return errorResponse("Template name is required", 400);
  }

  const template = await createTemplate(userId, body);
  return NextResponse.json(template, { status: 201 });
});
