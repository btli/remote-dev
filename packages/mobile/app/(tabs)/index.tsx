import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSessionStore } from "@/application/state/stores/sessionStore";
import { useEffect, useState, useCallback } from "react";

/**
 * Sessions screen - displays list of terminal sessions.
 * Main entry point for the app.
 */
export default function SessionsScreen() {
  const router = useRouter();
  const { sessions, loading, error, fetchSessions, setActiveSession, createSession, suspendSession, closeSession } = useSessionStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSessions();
    setRefreshing(false);
  }, [fetchSessions]);

  const handleSessionPress = (sessionId: string) => {
    setActiveSession(sessionId);
    router.push(`/session/${sessionId}`);
  };

  const handleNewSession = useCallback(() => {
    if (Platform.OS === "ios") {
      Alert.prompt(
        "New Session",
        "Enter a name for the terminal session:",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Create",
            onPress: async (name?: string) => {
              if (!name?.trim()) return;
              try {
                const session = await createSession({ name: name.trim() });
                setActiveSession(session.id);
                router.push(`/session/${session.id}`);
              } catch (error) {
                Alert.alert("Error", error instanceof Error ? error.message : "Failed to create session");
              }
            },
          },
        ],
        "plain-text"
      );
    } else {
      // Android: create with default name since Alert.prompt is iOS-only
      (async () => {
        try {
          const name = `Session ${sessions.length + 1}`;
          const session = await createSession({ name });
          setActiveSession(session.id);
          router.push(`/session/${session.id}`);
        } catch (error) {
          Alert.alert("Error", error instanceof Error ? error.message : "Failed to create session");
        }
      })();
    }
  }, [createSession, setActiveSession, router, sessions.length]);

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle" size={48} color="#f7768e" />
        <Text style={styles.errorText}>{error.message}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchSessions}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#7aa2f7"
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.sessionCard}
            onPress={() => handleSessionPress(item.id)}
          >
            <View style={styles.sessionIcon}>
              <Ionicons
                name={item.terminalType === "agent" ? "sparkles" : "terminal"}
                size={24}
                color="#7aa2f7"
              />
            </View>
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionName}>{item.name}</Text>
              <Text style={styles.sessionMeta}>
                {item.status} • {item.terminalType}
                {item.agentProvider && item.agentProvider !== "none"
                  ? ` • ${item.agentProvider}`
                  : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#565f89" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Ionicons name="terminal-outline" size={64} color="#565f89" />
              <Text style={styles.emptyText}>No sessions yet</Text>
              <Text style={styles.emptySubtext}>
                Create a new session to get started
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={sessions.length === 0 ? styles.emptyContainer : undefined}
      />

      {/* Floating action button */}
      <TouchableOpacity style={styles.fab} onPress={handleNewSession}>
        <Ionicons name="add" size={28} color="#1a1b26" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1b26",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#1a1b26",
  },
  errorText: {
    color: "#f7768e",
    fontSize: 16,
    marginTop: 12,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "#7aa2f7",
    borderRadius: 8,
  },
  retryText: {
    color: "#1a1b26",
    fontWeight: "600",
  },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#24283b",
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
  },
  sessionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1a1b26",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionName: {
    color: "#c0caf5",
    fontSize: 16,
    fontWeight: "600",
  },
  sessionMeta: {
    color: "#565f89",
    fontSize: 13,
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
  },
  emptyText: {
    color: "#c0caf5",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
  },
  emptySubtext: {
    color: "#565f89",
    fontSize: 14,
    marginTop: 8,
  },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#7aa2f7",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
