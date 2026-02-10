import { useRef, useCallback, useEffect, useState } from "react";
import { StyleSheet, View, Text, ActivityIndicator } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import {
  getWebSocketManager,
  ConnectionState,
} from "@/infrastructure/websocket/WebSocketManager";

interface TerminalViewProps {
  sessionId: string;
  onConnectionStateChange?: (state: ConnectionState) => void;
  onError?: (error: Error) => void;
}

/**
 * Terminal view using WebView with xterm.js.
 *
 * This component injects xterm.js into a WebView and bridges
 * WebSocket communication between React Native and the terminal.
 */
export function TerminalView({
  sessionId,
  onConnectionStateChange,
  onError,
}: TerminalViewProps) {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const wsManager = getWebSocketManager();

  // Send data to terminal
  const writeToTerminal = useCallback((data: string) => {
    webViewRef.current?.injectJavaScript(`
      if (window.terminal) {
        window.terminal.write(${JSON.stringify(data)});
      }
      true;
    `);
  }, []);

  // Handle messages from WebView (terminal)
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data);

        switch (message.type) {
          case "ready":
            // Terminal is initialized
            setLoading(false);
            break;

          case "input":
            // Send input to WebSocket
            wsManager.sendInput(sessionId, message.data);
            break;

          case "resize":
            // Send resize to WebSocket
            wsManager.sendResize(sessionId, message.cols, message.rows);
            break;

          case "error":
            onError?.(new Error(message.data));
            break;
        }
      } catch (error) {
        console.error("Failed to parse WebView message:", error);
      }
    },
    [sessionId, wsManager, onError]
  );

  // Setup WebSocket listeners
  useEffect(() => {
    const unsubscribeMessage = wsManager.onMessage((sid, message) => {
      if (sid !== sessionId) return;

      if (message.type === "output" && typeof message.data === "string") {
        writeToTerminal(message.data);
      }
    });

    const unsubscribeState = wsManager.onStateChange((sid, state) => {
      if (sid !== sessionId) return;
      setConnectionState(state);
      onConnectionStateChange?.(state);
    });

    // Get initial state
    const initialState = wsManager.getState(sessionId);
    setConnectionState(initialState);
    onConnectionStateChange?.(initialState);

    return () => {
      unsubscribeMessage();
      unsubscribeState();
    };
  }, [sessionId, wsManager, writeToTerminal, onConnectionStateChange]);

  // HTML content with xterm.js
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          html, body {
            width: 100%;
            height: 100%;
            background-color: #1a1b26;
            overflow: hidden;
          }
          #terminal {
            width: 100%;
            height: 100%;
          }
          .xterm {
            padding: 8px;
          }
          .xterm-viewport {
            overflow-y: auto !important;
          }
          /* Tokyo Night theme */
          .xterm-screen {
            background-color: #1a1b26;
          }
        </style>
        <link rel="stylesheet" href="https://unpkg.com/@xterm/xterm@5.5.0/css/xterm.css">
      </head>
      <body>
        <div id="terminal"></div>
        <script src="https://unpkg.com/@xterm/xterm@5.5.0/lib/xterm.js"></script>
        <script src="https://unpkg.com/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
        <script>
          (function() {
            // Initialize terminal
            const terminal = new Terminal({
              theme: {
                background: '#1a1b26',
                foreground: '#c0caf5',
                cursor: '#c0caf5',
                cursorAccent: '#1a1b26',
                black: '#414868',
                red: '#f7768e',
                green: '#9ece6a',
                yellow: '#e0af68',
                blue: '#7aa2f7',
                magenta: '#bb9af7',
                cyan: '#7dcfff',
                white: '#c0caf5',
                brightBlack: '#565f89',
                brightRed: '#f7768e',
                brightGreen: '#9ece6a',
                brightYellow: '#e0af68',
                brightBlue: '#7aa2f7',
                brightMagenta: '#bb9af7',
                brightCyan: '#7dcfff',
                brightWhite: '#c0caf5',
                selectionBackground: '#33467c',
              },
              fontSize: 14,
              fontFamily: 'Menlo, Monaco, "Courier New", monospace',
              cursorBlink: true,
              allowTransparency: true,
              scrollback: 10000,
            });

            const fitAddon = new FitAddon.FitAddon();
            terminal.loadAddon(fitAddon);

            terminal.open(document.getElementById('terminal'));
            fitAddon.fit();

            // Make terminal globally accessible
            window.terminal = terminal;
            window.fitAddon = fitAddon;

            // Handle input
            terminal.onData(function(data) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'input',
                data: data
              }));
            });

            // Handle resize
            window.addEventListener('resize', function() {
              fitAddon.fit();
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'resize',
                cols: terminal.cols,
                rows: terminal.rows
              }));
            });

            // Initial fit after fonts load
            setTimeout(function() {
              fitAddon.fit();
            }, 100);

            // Notify ready
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'ready',
              cols: terminal.cols,
              rows: terminal.rows
            }));

            // Welcome message
            terminal.writeln('\\x1b[1;36mRemote Dev Mobile\\x1b[0m');
            terminal.writeln('Connecting to session...');
            terminal.writeln('');
          })();
        </script>
      </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      {/* Connection status indicator */}
      {connectionState !== "connected" && (
        <View style={styles.statusBar}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  connectionState === "connecting" ||
                  connectionState === "reconnecting"
                    ? "#e0af68"
                    : "#f7768e",
              },
            ]}
          />
          <Text style={styles.statusText}>
            {connectionState === "connecting"
              ? "Connecting..."
              : connectionState === "reconnecting"
                ? "Reconnecting..."
                : connectionState === "disconnecting"
                  ? "Disconnecting..."
                  : "Disconnected"}
          </Text>
        </View>
      )}

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#7aa2f7" />
          <Text style={styles.loadingText}>Loading terminal...</Text>
        </View>
      )}

      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webview}
        onMessage={handleMessage}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs
        scalesPageToFit={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        // iOS specific
        keyboardDisplayRequiresUserAction={false}
        // Android specific
        mixedContentMode="always"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1b26",
  },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    backgroundColor: "#24283b",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: "#a9b1d6",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1a1b26",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#565f89",
  },
  webview: {
    flex: 1,
    backgroundColor: "#1a1b26",
  },
});
