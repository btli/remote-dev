/**
 * DrizzleDeploymentRepository - SQLite-backed implementation of DeploymentRepository.
 *
 * Stores deployment lifecycle state as a JSON blob in the deploymentStateJson
 * column of the existing system_update_cache singleton row.
 */

import { db } from "@/db";
import { systemUpdateCache } from "@/db/schema";
import { eq } from "drizzle-orm";
import { UpdateDeployment } from "@/domain/entities/UpdateDeployment";
import type { DeploymentRepository } from "@/application/ports/DeploymentRepository";
import { createLogger } from "@/lib/logger";

const log = createLogger("DrizzleDeploymentRepository");

const SINGLETON_ID = "singleton";

export class DrizzleDeploymentRepository implements DeploymentRepository {
  async getCurrent(): Promise<UpdateDeployment | null> {
    const row = await db.query.systemUpdateCache.findFirst({
      where: eq(systemUpdateCache.id, SINGLETON_ID),
    });

    if (!row?.deploymentStateJson) {
      return null;
    }

    try {
      const json = JSON.parse(row.deploymentStateJson);
      return UpdateDeployment.fromPlainObject(json);
    } catch (error) {
      log.error("Failed to parse deployment state", { error: String(error) });
      return null;
    }
  }

  async save(deployment: UpdateDeployment): Promise<void> {
    const json = JSON.stringify(deployment.toPlainObject());

    await db
      .insert(systemUpdateCache)
      .values({
        id: SINGLETON_ID,
        deploymentStateJson: json,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemUpdateCache.id,
        set: {
          deploymentStateJson: json,
          updatedAt: new Date(),
        },
      });
  }

  async clear(): Promise<void> {
    await db
      .update(systemUpdateCache)
      .set({
        deploymentStateJson: null,
        updatedAt: new Date(),
      })
      .where(eq(systemUpdateCache.id, SINGLETON_ID));
  }
}
