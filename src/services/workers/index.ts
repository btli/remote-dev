/**
 * Background Workers Module
 *
 * Provides background processing for:
 * - Task delegation monitoring
 * - Project knowledge refresh
 *
 * Usage:
 * ```ts
 * import { workerManager, createTaskMonitorWorker, createKnowledgeRefreshWorker } from "@/services/workers";
 *
 * workerManager.register(createTaskMonitorWorker());
 * workerManager.register(createKnowledgeRefreshWorker());
 * await workerManager.startAll();
 * ```
 */

export { workerManager, WorkerManager, type Worker, type WorkerConfig } from "./worker-manager";
export { TaskMonitorWorker, createTaskMonitorWorker } from "./task-monitor-worker";
export { KnowledgeRefreshWorker, createKnowledgeRefreshWorker } from "./knowledge-refresh-worker";
