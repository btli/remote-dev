/**
 * SessionAdapterImpl - Implements SessionAdapter over the SessionRepository port.
 *
 * Decouples the application-layer {@link PortMonitor} from the concrete
 * repository. `findByUser` returns only the sessions that can currently hold a
 * port: those whose status is active OR suspended. A suspended session keeps
 * its tmux session alive, so its claimed ports remain reachable and worth
 * scanning. All returned sessions are reported as `isActive: true` — they are
 * the live ones the monitor sweeps.
 */

import type { SessionAdapter } from "@/application/services/PortMonitor";
import type { SessionRepository } from "@/application/ports/SessionRepository";

export class SessionAdapterImpl implements SessionAdapter {
  constructor(private readonly sessionRepository: SessionRepository) {}

  async findByUser(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      projectId: string | null;
      tmuxSessionName: string;
      isActive: boolean;
    }>
  > {
    const sessions = await this.sessionRepository.findByUser(userId);

    return sessions
      .filter((session) => session.isActive() || session.isSuspended())
      .map((session) => ({
        id: session.id,
        name: session.name,
        projectId: session.projectId,
        tmuxSessionName: session.tmuxSessionName.toString(),
        // Active or suspended sessions are the live ones the monitor scans.
        isActive: true,
      }));
  }
}
