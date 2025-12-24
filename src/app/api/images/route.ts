import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

/**
 * Directory for storing uploaded images.
 * Images are stored in /tmp to ensure they're cleaned up on system restart.
 */
const UPLOAD_DIR = "/tmp/rdv-images";

/**
 * Maximum file size (5MB) - matches Claude's limit
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Allowed MIME types for images
 */
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * Map MIME types to file extensions
 */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/**
 * POST /api/images - Upload an image and return its file path
 *
 * Accepts multipart form data with an "image" field.
 * Returns the absolute file path that can be used with Claude Code.
 */
export const POST = withAuth(async (request) => {
  const contentType = request.headers.get("content-type") || "";

  let imageBuffer: Buffer;
  let mimeType: string;

  if (contentType.includes("multipart/form-data")) {
    // Handle FormData upload
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return errorResponse("No image file provided", 400);
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return errorResponse(`Unsupported file type: ${file.type}`, 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return errorResponse("File too large (max 5MB)", 400);
    }

    imageBuffer = Buffer.from(await file.arrayBuffer());
    mimeType = file.type;
  } else if (contentType.includes("application/json")) {
    // Handle base64 JSON upload
    const body = await request.json();
    const { data, mediaType } = body;

    if (!data || !mediaType) {
      return errorResponse("Missing data or mediaType", 400);
    }

    if (!ALLOWED_TYPES.has(mediaType)) {
      return errorResponse(`Unsupported media type: ${mediaType}`, 400);
    }

    // Remove data URL prefix if present
    const base64Data = data.includes(",") ? data.split(",")[1] : data;
    imageBuffer = Buffer.from(base64Data, "base64");

    if (imageBuffer.length > MAX_FILE_SIZE) {
      return errorResponse("File too large (max 5MB)", 400);
    }

    mimeType = mediaType;
  } else {
    return errorResponse("Unsupported content type", 400);
  }

  // Ensure upload directory exists
  await mkdir(UPLOAD_DIR, { recursive: true });

  // Generate unique filename
  const ext = MIME_TO_EXT[mimeType] || ".png";
  const uniqueId = randomUUID().split("-")[0];
  const timestamp = Date.now();
  const safeFileName = `${timestamp}-${uniqueId}${ext}`;
  const filePath = join(UPLOAD_DIR, safeFileName);

  // Write file to disk
  await writeFile(filePath, imageBuffer);

  return NextResponse.json({
    path: filePath,
    size: imageBuffer.length,
    mediaType: mimeType,
  });
});
