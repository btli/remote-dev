/**
 * Remote Dev SDK
 *
 * The Remote Dev SDK provides a Three-Perspective Architecture (AX/UX/DX)
 * for building and extending the Remote Dev platform.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createRemoteDevSDK } from '@remote-dev/sdk';
 *
 * const sdk = createRemoteDevSDK({
 *   userId: 'user-123',
 *   apiBaseUrl: 'http://localhost:6001',
 * });
 *
 * await sdk.initialize();
 *
 * // Agent Experience (AX)
 * await sdk.ax.memory.remember('Important context');
 * const tools = sdk.ax.tools.getAll();
 *
 * // User Experience (UX)
 * const sessions = await sdk.ux.sessions.getActiveSessions();
 * const insights = await sdk.ux.insights.getUnread();
 *
 * // Developer Experience (DX)
 * const extensions = await sdk.dx.extensions.list();
 * sdk.dx.tools.register(myCustomTool);
 *
 * await sdk.shutdown();
 * ```
 *
 * @module @remote-dev/sdk
 */

// Core SDK factory and utilities
export { createRemoteDevSDK } from "./core/sdk";
export { createConfig, validateConfig, DEFAULT_SDK_CONFIG } from "./core/config";
export { createHttpClient } from "./core/http-client";

// Types - Re-export all types for convenience
export * from "./types";
