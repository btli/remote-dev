/**
 * DrizzleProjectKnowledgeRepository - Drizzle ORM implementation of IProjectKnowledgeRepository
 *
 * Handles all project knowledge persistence operations using Drizzle ORM.
 * Converts between database records and ProjectKnowledge domain entities using ProjectKnowledgeMapper.
 */

import { db } from "@/db";
import { projectKnowledge } from "@/db/schema";
import { eq, lt, desc } from "drizzle-orm";
import type { ProjectKnowledge } from "@/domain/entities/ProjectKnowledge";
import type { IProjectKnowledgeRepository } from "@/application/ports/task-ports";
import {
  ProjectKnowledgeMapper,
  type ProjectKnowledgeDbRecord,
} from "../mappers/ProjectKnowledgeMapper";

export class DrizzleProjectKnowledgeRepository implements IProjectKnowledgeRepository {
  /**
   * Save project knowledge.
   */
  async save(knowledge: ProjectKnowledge): Promise<void> {
    const data = ProjectKnowledgeMapper.toPersistence(knowledge);

    await db
      .insert(projectKnowledge)
      .values(data)
      .onConflictDoUpdate({
        target: projectKnowledge.id,
        set: {
          ...data,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Find project knowledge by ID.
   */
  async findById(id: string): Promise<ProjectKnowledge | null> {
    const record = await db.query.projectKnowledge.findFirst({
      where: eq(projectKnowledge.id, id),
    });

    return record ? ProjectKnowledgeMapper.toDomain(record as ProjectKnowledgeDbRecord) : null;
  }

  /**
   * Find project knowledge by folder ID.
   * Each folder has at most one knowledge entry.
   */
  async findByFolderId(folderId: string): Promise<ProjectKnowledge | null> {
    const record = await db.query.projectKnowledge.findFirst({
      where: eq(projectKnowledge.folderId, folderId),
    });

    return record ? ProjectKnowledgeMapper.toDomain(record as ProjectKnowledgeDbRecord) : null;
  }

  /**
   * Find all project knowledge for a user.
   */
  async findByUserId(userId: string): Promise<ProjectKnowledge[]> {
    const records = await db.query.projectKnowledge.findMany({
      where: eq(projectKnowledge.userId, userId),
      orderBy: desc(projectKnowledge.updatedAt),
    });

    return ProjectKnowledgeMapper.toDomainMany(records as ProjectKnowledgeDbRecord[]);
  }

  /**
   * Delete project knowledge.
   */
  async delete(id: string): Promise<void> {
    await db.delete(projectKnowledge).where(eq(projectKnowledge.id, id));
  }

  /**
   * Find stale knowledge entries (not scanned in specified hours).
   */
  async findStale(hoursThreshold: number = 24): Promise<ProjectKnowledge[]> {
    const cutoff = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);

    const records = await db.query.projectKnowledge.findMany({
      where: lt(projectKnowledge.lastScannedAt, cutoff),
      orderBy: projectKnowledge.lastScannedAt,
    });

    return ProjectKnowledgeMapper.toDomainMany(records as ProjectKnowledgeDbRecord[]);
  }

  /**
   * Create or get knowledge entry for a folder.
   * If knowledge doesn't exist, creates a new empty entry.
   */
  async getOrCreate(
    folderId: string,
    userId: string,
    metadata?: { projectPath?: string; projectName?: string }
  ): Promise<ProjectKnowledge> {
    const existing = await this.findByFolderId(folderId);

    if (existing) {
      return existing;
    }

    // Create new knowledge entry
    const { ProjectKnowledge: ProjectKnowledgeEntity } = await import(
      "@/domain/entities/ProjectKnowledge"
    );
    const knowledge = ProjectKnowledgeEntity.create({
      folderId,
      userId,
      techStack: [],
      metadata: {
        projectPath: metadata?.projectPath ?? null,
        projectName: metadata?.projectName ?? null,
      },
    });

    await this.save(knowledge);
    return knowledge;
  }

  /**
   * Get all folders that have knowledge (for admin/stats).
   */
  async listAllFolderIds(): Promise<string[]> {
    const records = await db.query.projectKnowledge.findMany({
      columns: { folderId: true },
    });

    return records.map((r) => r.folderId);
  }

  /**
   * Delete knowledge by folder ID.
   */
  async deleteByFolderId(folderId: string): Promise<void> {
    await db.delete(projectKnowledge).where(eq(projectKnowledge.folderId, folderId));
  }
}
