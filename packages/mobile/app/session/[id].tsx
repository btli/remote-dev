import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSessionStore } from "@/application/state/stores/sessionStore";
import { TerminalView } from "@/presentation/components/TerminalView";
import { getWebSocketManager } from "@/infrastructure/websocket/WebSocketManager";
import { getApiClient } from "@/infrastructure/api/RemoteDevApiClient";

/**
 * Terminal session screen.
 * Displays xterm.js terminal in a WebView with WebSocket connection.
 */
export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getSession, updateSession } = useSessionStore();
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const wsManagerRef = useRef(getWebSocketManager());
  const isMountedRef = useRef(true);

  const session = getSession(id);

  // Connect to WebSocket on mount
  useEffect(() => {
    isMountedRef.current = true;

    if (!session) {
      router.back();
      return;
    }

    const wsManager = wsManagerRef.current;

    const connectToSession = async (): Promise<void> => {
      try {
        const apiClient = getApiClient();
        const token = await apiClient.getSessionToken(id);
        await wsManager.connect(id, token);
      } catch (error) {
        // Only update state if still mounted
        if (isMountedRef.current) {
          console.error("[SessionScreen] Failed to connect:", error);
          setConnectionError(
            error instanceof Error ? error.message : "Failed to connect"
          );
        }
      }
    };

    connectToSession();

    return () => {
      isMountedRef.current = false;
      wsManager.disconnect(id);
    };
  }, [session, id, router]);

  const handleReconnect = useCallback(async () => {
    setConnectionError(null);
    try {
      const apiClient = getApiClient();
      const token = await apiClient.getSessionToken(id);
      await wsManagerRef.current.connect(id, token);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : "Failed to reconnect"
      );
    }
  }, [id]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  if (!session) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#7aa2f7" />
      </View>
    );
  }

  const isAgentSession = session.terminalType === "agent";
  const isExited = session.agentExitState === "exited";

  return (
    <>
      <Stack.Screen
        options={{
          title: session.name,
          headerRight: () => (
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.headerButton}>
                <Ionicons name="settings-outline" size={22} color="#c0caf5" />
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      <View style={styles.container}>
        {/* Connection status bar - handled by TerminalView now */}

        {connectionError && (
          <View style={[styles.statusBar, styles.errorBar]}>
            <Ionicons name="alert-circle" size={18} color="#f7768e" />
            <Text style={styles.errorText}>{connectionError}</Text>
            <TouchableOpacity onPress={handleReconnect}>
              <Text style={styles.reconnectText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Agent exit screen */}
        {isAgentSession && isExited ? (
          <View style={styles.exitScreen}>
            <View style={styles.exitIcon}>
              <Ionicons name="checkmark-circle" size={64} color="#9ece6a" />
            </View>
            <Text style={styles.exitTitle}>Agent Completed</Text>
            <Text style={styles.exitMessage}>
              Exit code: {session.agentExitCode ?? "unknown"}
            </Text>
            <View style={styles.exitActions}>
              <TouchableOpacity
                style={styles.restartButton}
                onPress={() => {
                  // TODO: Restart agent
                  updateSession(id, { agentExitState: "running" });
                }}
              >
                <Ionicons name="refresh" size={20} color="#1a1b26" />
                <Text style={styles.restartText}>Restart</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
                <Ionicons name="close" size={20} color="#f7768e" />
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Terminal WebView */
          <TerminalView
            sessionId={id}
            onError={(error) => {
              setConnectionError(error.message);
            }}
          />
        )}

        {/* Mobile keyboard toolbar */}
        <View style={styles.keyboardToolbar}>
          <TouchableOpacity style={styles.keyButton}>
            <Text style={styles.keyText}>ESC</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.keyButton}>
            <Text style={styles.keyText}>TAB</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.keyButton}>
            <Text style={styles.keyText}>CTRL</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.keyButton}>
            <Ionicons name="arrow-up" size={18} color="#c0caf5" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.keyButton}>
            <Ionicons name="arrow-down" size={18} color="#c0caf5" />
          </TouchableOpacity>
        </View>
      </View>
    </>
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
    backgroundColor: "#1a1b26",
  },
  headerActions: {
    flexDirection: "row",
    gap: 12,
  },
  headerButton: {
    padding: 4,
  },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
    backgroundColor: "#24283b",
  },
  statusText: {
    color: "#7aa2f7",
    fontSize: 14,
  },
  errorBar: {
    backgroundColor: "#f7768e22",
  },
  errorText: {
    color: "#f7768e",
    fontSize: 14,
    flex: 1,
  },
  reconnectText: {
    color: "#7aa2f7",
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 12,
  },
  exitScreen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  exitIcon: {
    marginBottom: 24,
  },
  exitTitle: {
    color: "#c0caf5",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  exitMessage: {
    color: "#565f89",
    fontSize: 16,
    marginBottom: 32,
  },
  exitActions: {
    flexDirection: "row",
    gap: 16,
  },
  restartButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: "#9ece6a",
    borderRadius: 8,
  },
  restartText: {
    color: "#1a1b26",
    fontSize: 16,
    fontWeight: "600",
  },
  closeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: "#24283b",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f7768e33",
  },
  closeText: {
    color: "#f7768e",
    fontSize: 16,
    fontWeight: "600",
  },
  keyboardToolbar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#24283b",
    borderTopWidth: 1,
    borderTopColor: "#1a1b26",
  },
  keyButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#1a1b26",
    borderRadius: 6,
    minWidth: 50,
    alignItems: "center",
  },
  keyText: {
    color: "#c0caf5",
    fontSize: 12,
    fontWeight: "600",
  },
});
