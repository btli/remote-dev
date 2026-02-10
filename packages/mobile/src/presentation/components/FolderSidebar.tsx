import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { useSessionStore } from "@/application/state/stores/sessionStore";
import { useFolderStore } from "@/application/state/stores/folderStore";
import type { FolderDTO, TerminalSessionDTO, SessionStatusType } from "@remote-dev/domain";

interface FolderSidebarProps {
  onSessionSelect: (sessionId: string) => void;
}

const STATUS_COLORS: Record<SessionStatusType, string> = {
  active: "#9ece6a",
  suspended: "#e0af68",
  closed: "#565f89",
  trashed: "#565f89",
};

interface FolderItemProps {
  folder: FolderDTO;
  sessions: TerminalSessionDTO[];
  onSessionSelect: (sessionId: string) => void;
  onToggleCollapse: (folderId: string) => void;
  level: number;
}

/**
 * Individual folder item with collapsible sessions.
 */
function FolderItem({
  folder,
  sessions,
  onSessionSelect,
  onToggleCollapse,
  level,
}: FolderItemProps) {
  const folderSessions = sessions.filter((s) => s.folderId === folder.id);
  const hasChildren = folderSessions.length > 0;

  return (
    <View style={styles.folderItem}>
      {/* Folder header */}
      <TouchableOpacity
        style={[styles.folderHeader, { paddingLeft: 12 + level * 16 }]}
        onPress={() => onToggleCollapse(folder.id)}
        activeOpacity={0.7}
      >
        {/* Collapse indicator */}
        <Text style={styles.collapseIcon}>
          {hasChildren ? (folder.collapsed ? "▶" : "▼") : "  "}
        </Text>
        {/* Folder icon */}
        <Text style={styles.folderIcon}>📁</Text>
        <Text style={styles.folderName} numberOfLines={1}>
          {folder.name}
        </Text>
        {hasChildren && (
          <Text style={styles.sessionCount}>{folderSessions.length}</Text>
        )}
      </TouchableOpacity>

      {/* Sessions (when expanded) */}
      {!folder.collapsed &&
        folderSessions.map((session) => (
          <TouchableOpacity
            key={session.id}
            style={[styles.sessionItem, { paddingLeft: 28 + level * 16 }]}
            onPress={() => onSessionSelect(session.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.sessionIcon}>
              {session.terminalType === "agent" ? "🤖" : "💻"}
            </Text>
            <Text style={styles.sessionName} numberOfLines={1}>
              {session.name}
            </Text>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: STATUS_COLORS[session.status] },
              ]}
            />
          </TouchableOpacity>
        ))}
    </View>
  );
}

/**
 * Sidebar component for tablet landscape mode.
 * Shows folder hierarchy with sessions organized by folder.
 */
export function FolderSidebar({ onSessionSelect }: FolderSidebarProps) {
  const [refreshing, setRefreshing] = useState(false);

  const { sessions, fetchSessions } = useSessionStore();
  const { folders, toggleCollapsed, fetchFolders } = useFolderStore();

  // Sessions without a folder (root level)
  const rootSessions = sessions.filter((s) => !s.folderId && s.status !== "closed");

  // Root level folders (no parent)
  const rootFolders = folders.filter((f) => !f.parentId);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchSessions(), fetchFolders()]);
    setRefreshing(false);
  }, [fetchSessions, fetchFolders]);

  const handleToggleCollapse = useCallback(
    (folderId: string) => {
      toggleCollapsed(folderId);
    },
    [toggleCollapsed]
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sessions</Text>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#7aa2f7"
          />
        }
      >
        {/* Root sessions (no folder) */}
        {rootSessions.length > 0 && (
          <View style={styles.rootSessionsSection}>
            {rootSessions.map((session) => (
              <TouchableOpacity
                key={session.id}
                style={styles.sessionItem}
                onPress={() => onSessionSelect(session.id)}
                activeOpacity={0.7}
              >
                <Text style={styles.sessionIcon}>
                  {session.terminalType === "agent" ? "🤖" : "💻"}
                </Text>
                <Text style={styles.sessionName} numberOfLines={1}>
                  {session.name}
                </Text>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: STATUS_COLORS[session.status] },
                  ]}
                />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Folders with sessions */}
        {rootFolders.map((folder) => (
          <FolderItem
            key={folder.id}
            folder={folder}
            sessions={sessions.filter((s) => s.status !== "closed")}
            onSessionSelect={onSessionSelect}
            onToggleCollapse={handleToggleCollapse}
            level={0}
          />
        ))}

        {/* Empty state */}
        {rootSessions.length === 0 && rootFolders.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={styles.emptyText}>No sessions yet</Text>
            <Text style={styles.emptyHint}>
              Create a new session from the Sessions tab
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1b26",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#24283b",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#c0caf5",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingVertical: 8,
  },
  rootSessionsSection: {
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#24283b",
    marginBottom: 8,
  },
  folderItem: {
    marginBottom: 4,
  },
  folderHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingRight: 12,
  },
  collapseIcon: {
    width: 16,
    fontSize: 10,
    color: "#565f89",
    marginRight: 4,
  },
  folderIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  folderName: {
    flex: 1,
    fontSize: 14,
    color: "#c0caf5",
    fontWeight: "500",
  },
  sessionCount: {
    fontSize: 12,
    color: "#565f89",
    backgroundColor: "#24283b",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sessionIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  sessionName: {
    flex: 1,
    fontSize: 14,
    color: "#a9b1d6",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 16,
    opacity: 0.5,
  },
  emptyText: {
    fontSize: 16,
    color: "#565f89",
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 14,
    color: "#414868",
    textAlign: "center",
  },
});
