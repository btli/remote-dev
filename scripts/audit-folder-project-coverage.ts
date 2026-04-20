import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import { isNull, and, isNotNull, sql } from "drizzle-orm";
import {
  terminalSessions,
  projectTasks,
  channelGroups,
  channels,
  agentPeerMessages,
  agentConfigs,
  mcpServers,
  sessionMemory,
  githubStatsPreferences,
  portRegistry,
  sessionTemplates,
} from "@/db/schema";

const log = createLogger("AuditFolderProjectCoverage");

const tables = [
  { name: "terminal_session", t: terminalSessions, folderCol: terminalSessions.folderId, projectCol: terminalSessions.projectId },
  { name: "project_task", t: projectTasks, folderCol: projectTasks.folderId, projectCol: projectTasks.projectId },
  { name: "channel_groups", t: channelGroups, folderCol: channelGroups.folderId, projectCol: channelGroups.projectId },
  { name: "channels", t: channels, folderCol: channels.folderId, projectCol: channels.projectId },
  { name: "agent_peer_message", t: agentPeerMessages, folderCol: agentPeerMessages.folderId, projectCol: agentPeerMessages.projectId },
  { name: "agent_config", t: agentConfigs, folderCol: agentConfigs.folderId, projectCol: agentConfigs.projectId },
  { name: "mcp_server", t: mcpServers, folderCol: mcpServers.folderId, projectCol: mcpServers.projectId },
  { name: "session_memory", t: sessionMemory, folderCol: sessionMemory.folderId, projectCol: sessionMemory.projectId },
  { name: "github_stats_preference", t: githubStatsPreferences, folderCol: githubStatsPreferences.folderId, projectCol: githubStatsPreferences.projectId },
  { name: "port_registry", t: portRegistry, folderCol: portRegistry.folderId, projectCol: portRegistry.projectId },
  { name: "session_template", t: sessionTemplates, folderCol: sessionTemplates.folderId, projectCol: sessionTemplates.projectId },
];

async function main() {
  let failed = false;
  for (const tbl of tables) {
    const orphans = await db
      .select({ count: sql<number>`count(*)` })
      .from(tbl.t)
      .where(and(isNotNull(tbl.folderCol), isNull(tbl.projectCol)));
    const count = Number(orphans[0].count);
    if (count > 0) {
      failed = true;
      log.error(`${tbl.name}: ${count} rows have folder_id but no project_id`);
    } else {
      log.info(`${tbl.name}: OK`);
    }
  }
  if (failed) {
    log.error("Audit failed; Phase 6 cannot proceed until every row has project_id");
    process.exit(1);
  }
  log.info("All tables have project_id coverage");
}

main().catch((err) => {
  log.error("audit crashed", { error: String(err) });
  process.exit(1);
});
