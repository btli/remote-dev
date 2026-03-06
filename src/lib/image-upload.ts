/**
 * Shared image upload utilities for terminal components.
 *
 * Used by both Terminal.tsx (desktop drag-and-drop / paste) and
 * TerminalWithKeyboard.tsx (mobile camera button).
 */

export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/**
 * Upload an image file to the server and return the saved file path.
 *
 * The server stores the image on disk and returns a path that AI agents
 * (e.g. Claude Code) can read directly.
 */
export async function uploadImage(file: File): Promise<string> {
  const formData = new FormData();
  const extension = IMAGE_EXTENSIONS[file.type] ?? "";
  const safeName = `image-${Date.now()}${extension}`;
  formData.append("image", file, safeName);

  const response = await fetch("/api/images", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to upload image");
  }

  const result = await response.json();
  return result.path;
}

/**
 * Upload an image and send its file path as terminal input via WebSocket.
 *
 * AI agents read images from file paths, so this uploads the file to disk
 * and pastes the resulting path into the terminal session.
 */
export async function sendImageToTerminal(
  file: File,
  ws: WebSocket | null
): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const filePath = await uploadImage(file);
  ws.send(JSON.stringify({ type: "input", data: filePath }));
}
