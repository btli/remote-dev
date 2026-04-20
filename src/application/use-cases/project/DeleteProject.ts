import { ProjectRepository } from "@/application/ports/ProjectRepository";

export class DeleteProject {
  constructor(private readonly repo: ProjectRepository) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
