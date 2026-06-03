/**
 * TmuxAdapterImpl - Implements TmuxAdapter over the TmuxGateway port.
 *
 * Decouples the application-layer {@link PortMonitor} from the concrete tmux
 * gateway. `getEnvironment` flattens the gateway's `TmuxEnvironment` value
 * object into a plain `Record<string, string>` (the shape the monitor expects).
 */

import type { TmuxAdapter } from "@/application/services/PortMonitor";
import type { TmuxGateway } from "@/application/ports/TmuxGateway";

export class TmuxAdapterImpl implements TmuxAdapter {
  constructor(private readonly tmuxGateway: TmuxGateway) {}

  async sessionExists(sessionName: string): Promise<boolean> {
    return this.tmuxGateway.sessionExists(sessionName);
  }

  async getEnvironment(
    sessionName: string
  ): Promise<Record<string, string>> {
    const environment = await this.tmuxGateway.getEnvironment(sessionName);
    return environment.toRecord();
  }
}
