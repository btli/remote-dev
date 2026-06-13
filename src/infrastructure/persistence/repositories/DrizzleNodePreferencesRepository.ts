import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { nodePreferences } from "@/db/schema";
import { NodeRef } from "@/domain/value-objects/NodeRef";
import { NodePreferences } from "@/domain/value-objects/NodePreferences";
import { NodePreferencesRepository } from "@/application/ports/NodePreferencesRepository";
import * as mapper from "@/infrastructure/persistence/mappers/nodePreferencesMapper";
import type { ClaudeAutoRelaunchMode } from "@/types/claude-limits";

export class DrizzleNodePreferencesRepository implements NodePreferencesRepository {
  async findForNode(node: NodeRef, userId: string): Promise<NodePreferences | null> {
    const rows = await db
      .select()
      .from(nodePreferences)
      .where(
        and(
          eq(nodePreferences.ownerId, node.id),
          eq(nodePreferences.ownerType, node.type),
          eq(nodePreferences.userId, userId)
        )
      );
    return rows[0] ? mapper.toDomain(rows[0]) : null;
  }

  async listForUser(userId: string): Promise<Map<string, NodePreferences>> {
    const rows = await db
      .select()
      .from(nodePreferences)
      .where(eq(nodePreferences.userId, userId));
    const out = new Map<string, NodePreferences>();
    for (const r of rows) {
      out.set(`${r.ownerType}:${r.ownerId}`, mapper.toDomain(r));
    }
    return out;
  }

  async save(node: NodeRef, userId: string, prefs: NodePreferences): Promise<void> {
    const existing = await this.findForNode(node, userId);
    const now = new Date();
    const fields = prefs.fields;
    // The domain layer keeps this loose (string) to avoid importing
    // claude-limits types; narrow it back to the branded column type here.
    const claudeAutoRelaunchMode =
      (fields.claudeAutoRelaunchMode as ClaudeAutoRelaunchMode | null) ?? null;
    if (existing) {
      await db
        .update(nodePreferences)
        .set({
          defaultWorkingDirectory: fields.defaultWorkingDirectory ?? null,
          defaultShell: fields.defaultShell ?? null,
          theme: fields.theme ?? null,
          fontSize: fields.fontSize ?? null,
          fontFamily: fields.fontFamily ?? null,
          githubRepoId: fields.githubRepoId ?? null,
          localRepoPath: fields.localRepoPath ?? null,
          defaultAgentProvider: fields.defaultAgentProvider ?? null,
          agentProviderSettings: fields.agentProviderSettings ?? null,
          claudeProfilePoolId: fields.claudeProfilePoolId ?? null,
          claudeAutoRelaunchMode,
          environmentVars: fields.environmentVars ?? null,
          pinnedFiles: fields.pinnedFiles ?? null,
          gitIdentityName: fields.gitIdentityName ?? null,
          gitIdentityEmail: fields.gitIdentityEmail ?? null,
          isSensitive: fields.isSensitive ?? false,
          updatedAt: now,
        })
        .where(
          and(
            eq(nodePreferences.ownerId, node.id),
            eq(nodePreferences.ownerType, node.type),
            eq(nodePreferences.userId, userId)
          )
        );
    } else {
      await db.insert(nodePreferences).values({
        id: randomUUID(),
        ownerId: node.id,
        ownerType: node.type,
        userId,
        defaultWorkingDirectory: fields.defaultWorkingDirectory ?? null,
        defaultShell: fields.defaultShell ?? null,
        theme: fields.theme ?? null,
        fontSize: fields.fontSize ?? null,
        fontFamily: fields.fontFamily ?? null,
        githubRepoId: fields.githubRepoId ?? null,
        localRepoPath: fields.localRepoPath ?? null,
        defaultAgentProvider: fields.defaultAgentProvider ?? null,
        agentProviderSettings: fields.agentProviderSettings ?? null,
        claudeProfilePoolId: fields.claudeProfilePoolId ?? null,
        claudeAutoRelaunchMode,
        environmentVars: fields.environmentVars ?? null,
        pinnedFiles: fields.pinnedFiles ?? null,
        gitIdentityName: fields.gitIdentityName ?? null,
        gitIdentityEmail: fields.gitIdentityEmail ?? null,
        isSensitive: fields.isSensitive ?? false,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async delete(node: NodeRef, userId: string): Promise<void> {
    await db
      .delete(nodePreferences)
      .where(
        and(
          eq(nodePreferences.ownerId, node.id),
          eq(nodePreferences.ownerType, node.type),
          eq(nodePreferences.userId, userId)
        )
      );
  }
}
