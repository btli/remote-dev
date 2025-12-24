/**
 * Next.js instrumentation file - runs once when the server starts
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on server (not edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Run startup cleanup for expired trash items
    console.log("[Startup] Running trash cleanup...");
    try {
      const { cleanupExpiredItems } = await import("@/services/trash-service");
      const result = await cleanupExpiredItems();
      if (result.deletedCount > 0) {
        console.log(`[Startup] Cleaned up ${result.deletedCount} expired trash items`);
      } else {
        console.log("[Startup] No expired trash items to clean up");
      }
    } catch (error) {
      console.error("[Startup] Trash cleanup failed:", error);
    }
  }
}
