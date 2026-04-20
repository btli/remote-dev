import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { container } from "@/infrastructure/container";
import { NodeRef } from "@/domain/value-objects/NodeRef";
import { NodePreferences } from "@/domain/value-objects/NodePreferences";

const ownerSchema = z.object({
  ownerType: z.enum(["group", "project"]),
  ownerId: z.string().min(1),
});

function refFromParams(params: Record<string, string>): NodeRef {
  const parsed = ownerSchema.parse(params);
  return parsed.ownerType === "group"
    ? NodeRef.group(parsed.ownerId)
    : NodeRef.project(parsed.ownerId);
}

export const GET = withApiAuth(async (_req, { userId, params }) => {
  try {
    const ref = refFromParams(params!);
    const prefs = await container.nodePreferencesRepository.findForNode(ref, userId);
    return NextResponse.json({ preferences: prefs?.fields ?? null });
  } catch (err) {
    return errorResponse(String(err), 400);
  }
});

export const PUT = withApiAuth(async (req, { userId, params }) => {
  try {
    const ref = refFromParams(params!);
    const result = await parseJsonBody<Record<string, unknown>>(req);
    if ("error" in result) return result.error;
    const prefs =
      ref.type === "group"
        ? NodePreferences.forGroup(result.data as Parameters<typeof NodePreferences.forGroup>[0])
        : NodePreferences.forProject(
            result.data as Parameters<typeof NodePreferences.forProject>[0]
          );
    await container.nodePreferencesRepository.save(ref, userId, prefs);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(String(err), 400);
  }
});

export const DELETE = withApiAuth(async (_req, { userId, params }) => {
  try {
    const ref = refFromParams(params!);
    await container.nodePreferencesRepository.delete(ref, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(String(err), 400);
  }
});
