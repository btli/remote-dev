/**
 * TransactionManager - Provides transactional context for repository operations
 *
 * Wraps Drizzle ORM's transaction API to provide a clean abstraction for
 * use cases that need to perform multiple operations atomically.
 *
 * Usage:
 * ```ts
 * const result = await transactionManager.execute(async (tx) => {
 *   await orchestratorRepo.save(orchestrator, tx);
 *   await auditLogRepo.save(auditLog, tx);
 *   return { orchestrator, auditLog };
 * });
 * ```
 */

import { db } from "@/db";

/**
 * Transaction context - either the main db instance or a transaction object
 *
 * Note: We use the db instance type directly since both db and transaction
 * objects share the same query interface (select, insert, update, delete).
 */
export type TransactionContext = typeof db;

/**
 * Transaction callback function type
 */
export type TransactionCallback<T> = (tx: TransactionContext) => Promise<T>;

/**
 * TransactionManager class
 */
export class TransactionManager {
  /**
   * Execute a callback within a database transaction
   *
   * If the callback completes successfully, the transaction is committed.
   * If the callback throws an error, the transaction is rolled back.
   *
   * @param callback - Function to execute within the transaction
   * @returns The result of the callback
   * @throws Any error thrown by the callback (transaction will be rolled back)
   */
  async execute<T>(callback: TransactionCallback<T>): Promise<T> {
    // Type assertion needed because transaction object has a slightly different type
    // than the main db instance, but both support the same query methods we use
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db.transaction(callback as any);
  }

  /**
   * Execute a callback with the main database instance (no transaction)
   *
   * This is useful when you want to conditionally use transactions.
   * If a transaction context is already provided, use it; otherwise use the main db.
   *
   * @param callback - Function to execute
   * @returns The result of the callback
   */
  async executeWithoutTransaction<T>(callback: TransactionCallback<T>): Promise<T> {
    return callback(db);
  }

  /**
   * Get the database instance or transaction context
   *
   * This helper allows repositories to work with either the main db
   * or a transaction context seamlessly.
   *
   * @param tx - Optional transaction context
   * @returns The transaction context or main db instance
   */
  getContext(tx?: TransactionContext): TransactionContext {
    return tx ?? db;
  }
}

/**
 * Singleton instance
 */
export const transactionManager = new TransactionManager();
