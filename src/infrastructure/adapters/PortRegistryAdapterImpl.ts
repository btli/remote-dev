/**
 * PortRegistryAdapterImpl - Implements PortRegistryAdapter over the
 * functional `port-registry-service` module.
 *
 * This adapter decouples the application-layer {@link PortMonitor} from the
 * concrete port-registry service. It performs two pieces of impedance matching:
 *
 *  1. `getPortsForUser` drops entries with a null `projectId`. The adapter
 *     interface requires a non-null `projectId`, and the only consumer of this
 *     method (`PortMonitor.suggestAvailablePort`) needs nothing more than the
 *     set of allocated port numbers — every active row still contributes its
 *     port to that set, so dropping project-less rows is harmless there.
 *  2. `validatePorts` remaps the service's `conflictingFolder` field to the
 *     adapter's `conflictingProject` field (the service predates the
 *     folder→project rename).
 */

import type { PortRegistryAdapter } from "@/application/services/PortMonitor";
import * as PortRegistryService from "@/services/port-registry-service";

export class PortRegistryAdapterImpl implements PortRegistryAdapter {
  async getPortsForUser(userId: string): Promise<
    Array<{ projectId: string; port: number; variableName: string }>
  > {
    const entries = await PortRegistryService.getPortsForUser(userId);
    // The interface requires a non-null projectId. Drop project-less rows:
    // the sole caller only needs the allocated port set, which is unaffected.
    return entries
      .filter(
        (entry): entry is typeof entry & { projectId: string } =>
          entry.projectId !== null
      )
      .map((entry) => ({
        projectId: entry.projectId,
        port: entry.port,
        variableName: entry.variableName,
      }));
  }

  async validatePorts(
    projectId: string,
    userId: string,
    envVars: Record<string, string> | null
  ): Promise<{
    conflicts: Array<{
      port: number;
      variableName: string;
      conflictingProject: { id: string; name: string };
      conflictingVariableName: string;
      suggestedPort: number | null;
    }>;
    hasConflicts: boolean;
  }> {
    const result = await PortRegistryService.validatePorts(
      projectId,
      userId,
      envVars
    );

    return {
      conflicts: result.conflicts.map((conflict) => ({
        port: conflict.port,
        variableName: conflict.variableName,
        // Service still names this `conflictingFolder` (pre-rename); the
        // adapter contract expects `conflictingProject`.
        conflictingProject: {
          id: conflict.conflictingFolder.id,
          name: conflict.conflictingFolder.name,
        },
        conflictingVariableName: conflict.conflictingVariableName,
        suggestedPort: conflict.suggestedPort,
      })),
      hasConflicts: result.hasConflicts,
    };
  }

  async suggestAlternativePort(
    userId: string,
    preferredPort: number
  ): Promise<number | null> {
    return PortRegistryService.suggestAlternativePort(userId, preferredPort);
  }
}
