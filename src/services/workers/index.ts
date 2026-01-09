/**
 * Background Workers Module
 *
 * Provides background processing for:
 * - Task delegation monitoring
 * - Project knowledge refresh
 * - Asynchronous oversight (safety monitoring)
 *
 * Usage:
 * ```ts
 * import { workerManager, createTaskMonitorWorker, createKnowledgeRefreshWorker, createOversightWorker } from "@/services/workers";
 *
 * workerManager.register(createTaskMonitorWorker());
 * workerManager.register(createKnowledgeRefreshWorker());
 * workerManager.register(createOversightWorker());
 * await workerManager.startAll();
 * ```
 */

export { workerManager, WorkerManager, type Worker, type WorkerConfig } from "./worker-manager";
export { TaskMonitorWorker, createTaskMonitorWorker } from "./task-monitor-worker";
export { KnowledgeRefreshWorker, createKnowledgeRefreshWorker } from "./knowledge-refresh-worker";
export { OversightWorker, createOversightWorker } from "./oversight-worker";
