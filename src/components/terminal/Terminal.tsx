"use client";

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle, Activity } from "react";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import type { ImageAddon as ImageAddonType } from "@xterm/addon-image";
import type { SearchAddon as SearchAddonType } from "@xterm/addon-search";
import type { ConnectionStatus } from "@/types/terminal";
import { getTerminalTheme, getThemeBackground } from "@/lib/terminal-themes";
import { Search, X, ChevronUp, ChevronDown, Circle } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export interface TerminalRef {
  focus: () => void;
}

interface TerminalProps {
  sessionId: string;
  tmuxSessionName: string;
  sessionName?: string;
  projectPath?: string | null;
  wsUrl?: string;
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  notificationsEnabled?: boolean;
  isRecording?: boolean;
  isActive?: boolean;
  onStatusChange?: (status: ConnectionStatus) => void;
  onWebSocketReady?: (ws: WebSocket | null) => void;
  onSessionExit?: (exitCode: number) => void;
  onOutput?: (data: string) => void;
  onDimensionsChange?: (cols: number, rows: number) => void;
}

export const Terminal = forwardRef<TerminalRef, TerminalProps>(function Terminal({
  sessionId,
  tmuxSessionName,
  sessionName = "Terminal",
  projectPath,
  wsUrl = "ws://localhost:3001",
  theme = "tokyo-night",
  fontSize = 14,
  fontFamily = "'JetBrainsMono Nerd Font Mono', monospace",
  notificationsEnabled = true,
  isRecording = false,
  isActive = false,
  onStatusChange,
  onWebSocketReady,
  onSessionExit,
  onOutput,
  onDimensionsChange,
}, ref) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermType | null>(null);
  const fitAddonRef = useRef<FitAddonType | null>(null);
  const imageAddonRef = useRef<ImageAddonType | null>(null);
  const searchAddonRef = useRef<SearchAddonType | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const isUnmountingRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalExitRef = useRef(false);
  const maxReconnectAttempts = 5;

  // Notifications hook for command completion
  const { recordActivity } = useNotifications({
    enabled: notificationsEnabled,
    sessionName,
    inactivityDelay: 3000, // 3 seconds of inactivity = command finished
  });

  // FIX: Use refs for callbacks to avoid re-creating terminal on callback changes
  const onStatusChangeRef = useRef(onStatusChange);
  const onWebSocketReadyRef = useRef(onWebSocketReady);
  const onSessionExitRef = useRef(onSessionExit);
  const onOutputRef = useRef(onOutput);
  const onDimensionsChangeRef = useRef(onDimensionsChange);
  const recordActivityRef = useRef(recordActivity);

  // FIX: Capture initial theme/font values to avoid recreating terminal on changes
  // Updates are handled by a separate useEffect that modifies terminal.options
  const initialThemeRef = useRef(theme);
  const initialFontSizeRef = useRef(fontSize);
  const initialFontFamilyRef = useRef(fontFamily);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
    onWebSocketReadyRef.current = onWebSocketReady;
    onSessionExitRef.current = onSessionExit;
    onOutputRef.current = onOutput;
    onDimensionsChangeRef.current = onDimensionsChange;
    recordActivityRef.current = recordActivity;
  }, [onStatusChange, onWebSocketReady, onSessionExit, onOutput, onDimensionsChange, recordActivity]);

  // Expose focus method to parent components
  useImperativeHandle(ref, () => ({
    focus: () => {
      xtermRef.current?.focus();
    },
  }), []);

  const updateStatus = useCallback(
    (status: ConnectionStatus) => {
      onStatusChangeRef.current?.(status);
    },
    []
  );

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    let terminal: XTermType;
    let fitAddon: FitAddonType;
    let mounted = true;
    isUnmountingRef.current = false;
    intentionalExitRef.current = false;

    // Dynamically import xterm modules (browser-only)
    async function initTerminal() {
      const [
        { Terminal: XTerm },
        { FitAddon },
        { WebLinksAddon },
        { ImageAddon },
        { SearchAddon },
      ] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
        import("@xterm/addon-image"),
        import("@xterm/addon-search"),
      ]);

      // Also import CSS
      await import("@xterm/xterm/css/xterm.css");

      if (!mounted || !terminalRef.current) return;

      terminal = new XTerm({
        cursorBlink: true,
        fontSize: initialFontSizeRef.current,
        fontFamily: initialFontFamilyRef.current,
        theme: getTerminalTheme(initialThemeRef.current),
        allowProposedApi: true,
        scrollback: 10000,
      });

      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      const imageAddon = new ImageAddon();
      const searchAddon = new SearchAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.loadAddon(imageAddon);
      terminal.loadAddon(searchAddon);

      terminal.open(terminalRef.current);

      // Custom keyboard handler for macOS shortcuts
      // xterm.js doesn't translate Cmd/Option key combinations by default
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;

        // Cmd+Enter: Let this bubble up to app-level handler (creates new terminal)
        if (event.metaKey && event.key === "Enter") {
          return false;
        }

        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return true;
        }

        // Cmd+key shortcuts (macOS)
        if (event.metaKey && !event.altKey) {
          switch (event.key) {
            case "Backspace": // Delete line (kill line)
              ws.send(JSON.stringify({ type: "input", data: "\x15" })); // Ctrl+U
              return false;
            case "Delete": // Kill to end of line (fn+backspace on Mac)
              ws.send(JSON.stringify({ type: "input", data: "\x0b" })); // Ctrl+K
              return false;
            case "ArrowLeft": // Jump to line start
              ws.send(JSON.stringify({ type: "input", data: "\x01" })); // Ctrl+A
              return false;
            case "ArrowRight": // Jump to line end
              ws.send(JSON.stringify({ type: "input", data: "\x05" })); // Ctrl+E
              return false;
          }
        }

        // Option+key shortcuts (macOS)
        if (event.altKey && !event.metaKey) {
          switch (event.key) {
            case "Backspace": // Delete word backward
              ws.send(JSON.stringify({ type: "input", data: "\x17" })); // Ctrl+W
              return false;
            case "ArrowLeft": // Move word backward
              ws.send(JSON.stringify({ type: "input", data: "\x1bb" })); // ESC+b
              return false;
            case "ArrowRight": // Move word forward
              ws.send(JSON.stringify({ type: "input", data: "\x1bf" })); // ESC+f
              return false;
          }
        }

        // Shift+Enter - Send Kitty keyboard protocol sequence
        // xterm.js doesn't yet support extended keyboard protocols (PR #5424 pending)
        // so we manually send CSI 13;2u (Enter=13, Shift modifier=2)
        // This allows apps like Claude Code to distinguish Shift+Enter from Enter
        if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Enter") {
          ws.send(JSON.stringify({ type: "input", data: "\x1b[13;2u" }));
          return false;
        }

        // Ctrl+Enter - Send CSI 13;5u (Enter=13, Ctrl modifier=5)
        if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key === "Enter") {
          ws.send(JSON.stringify({ type: "input", data: "\x1b[13;5u" }));
          return false;
        }

        return true; // Let xterm handle other key combinations
      });

      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;
      imageAddonRef.current = imageAddon;
      searchAddonRef.current = searchAddon;

      async function connect() {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        updateStatus("connecting");

        // Fetch auth token from Next.js server
        let token: string;
        try {
          const tokenResponse = await fetch(`/api/sessions/${sessionId}/token`);
          if (!tokenResponse.ok) {
            throw new Error("Failed to get auth token");
          }
          const tokenData = await tokenResponse.json();
          token = tokenData.token;
        } catch (error) {
          console.error("Failed to get WebSocket token:", error);
          terminal.writeln("\r\n\x1b[31mError: Failed to authenticate\x1b[0m");
          updateStatus("error");
          return;
        }

        const cols = terminal.cols;
        const rows = terminal.rows;
        const params = new URLSearchParams({
          token,
          sessionId,
          tmuxSession: tmuxSessionName,
          cols: String(cols),
          rows: String(rows),
        });
        // Include working directory if specified
        if (projectPath) {
          params.set("cwd", projectPath);
        }

        const ws = new WebSocket(`${wsUrl}?${params.toString()}`);
        wsRef.current = ws;

        ws.onopen = () => {
          updateStatus("connected");
          reconnectAttemptsRef.current = 0;
          onWebSocketReadyRef.current?.(ws);

          // Send resize immediately after connection to sync dimensions
          // The URL params may be stale if container resized during connection
          requestAnimationFrame(() => {
            fitAddon.fit();
            ws.send(
              JSON.stringify({
                type: "resize",
                cols: terminal.cols,
                rows: terminal.rows,
              })
            );
          });
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            switch (msg.type) {
              case "output":
                terminal.write(msg.data);
                // Record activity for notification detection
                recordActivityRef.current?.();
                // Emit output for recording
                onOutputRef.current?.(msg.data);
                break;
              case "ready":
                console.log("Terminal session ready:", msg.sessionId);
                break;
              case "session_created":
                console.log("New tmux session created:", msg.tmuxSessionName);
                break;
              case "session_attached":
                console.log("Attached to existing tmux session:", msg.tmuxSessionName);
                break;
              case "exit":
                terminal.writeln(
                  `\r\n\x1b[33mSession ended (exit code ${msg.code})\x1b[0m`
                );
                // Mark as intentional exit to prevent reconnection
                intentionalExitRef.current = true;
                onSessionExitRef.current?.(msg.code);
                break;
              case "error":
                terminal.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
                break;
            }
          } catch {
            terminal.write(event.data);
            // Record activity for notification detection (raw data)
            recordActivityRef.current?.();
            // Emit output for recording
            onOutputRef.current?.(event.data);
          }
        };

        ws.onclose = () => {
          if (isUnmountingRef.current) {
            return;
          }

          updateStatus("disconnected");
          onWebSocketReadyRef.current?.(null);

          // Don't reconnect if this was an intentional exit (user typed "exit" or Ctrl+D)
          if (intentionalExitRef.current) {
            return;
          }

          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            updateStatus("reconnecting");
            reconnectAttemptsRef.current++;

            terminal.writeln(
              `\r\n\x1b[33mReconnecting (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...\x1b[0m`
            );

            reconnectTimeoutRef.current = setTimeout(() => {
              connect();
            }, 3000);
          } else {
            terminal.writeln(
              "\r\n\x1b[31mConnection lost. Refresh to reconnect.\x1b[0m"
            );
            updateStatus("error");
          }
        };

        ws.onerror = () => {
          console.error("WebSocket error");
        };
      }

      // Wait for fonts and container layout before connecting
      // This prevents incorrect initial sizing from various race conditions
      const initAndConnect = async () => {
        // Extract the primary font family name for loading
        const fontMatch = initialFontFamilyRef.current.match(/^['"]?([^'"]+)/);
        const primaryFont = fontMatch ? fontMatch[1] : initialFontFamilyRef.current;
        const fs = initialFontSizeRef.current;

        try {
          // Explicitly load the font we need (both weights)
          await Promise.all([
            document.fonts.load(`${fs}px "${primaryFont}"`),
            document.fonts.load(`bold ${fs}px "${primaryFont}"`),
          ]);
        } catch {
          // Font loading failed, continue with fallback
        }

        // Wait for all fonts to be ready
        await document.fonts.ready;

        // Wait for container dimensions to stabilize
        // On hard refresh, the layout may take multiple frames to settle
        const MIN_CONTAINER_WIDTH = 100;
        const MIN_CONTAINER_HEIGHT = 80;
        const MAX_WAIT_ATTEMPTS = 30; // ~500ms max wait
        const STABLE_FRAMES_REQUIRED = 3; // Dimensions must be stable for 3 frames

        let lastWidth = 0;
        let lastHeight = 0;
        let stableFrames = 0;

        for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS; attempt++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

          const container = terminalRef.current;
          if (!container) continue;

          const rect = container.getBoundingClientRect();

          // Check if dimensions are valid and stable
          if (rect.width >= MIN_CONTAINER_WIDTH && rect.height >= MIN_CONTAINER_HEIGHT) {
            if (rect.width === lastWidth && rect.height === lastHeight) {
              stableFrames++;
              if (stableFrames >= STABLE_FRAMES_REQUIRED) {
                break; // Container dimensions are stable
              }
            } else {
              // Dimensions changed, reset stability counter
              stableFrames = 0;
              lastWidth = rect.width;
              lastHeight = rect.height;
            }
          }
        }

        // Now fit with accurate measurements
        fitAddon.fit();

        // Connect with correct dimensions
        connect();
      };

      initAndConnect();

      terminal.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Minimum dimensions to prevent resizing to unusable sizes
      const MIN_WIDTH = 100;
      const MIN_HEIGHT = 80;

      const handleResize = () => {
        const container = terminalRef.current;
        if (!container) return;

        // Skip resize if page is hidden (browser tab backgrounded)
        if (document.hidden) return;

        // Skip if container is not visible (display: none from "hidden" class)
        // offsetParent is null when element or ancestor has display: none
        if (container.offsetParent === null) return;

        // Skip if container is too small
        const rect = container.getBoundingClientRect();
        if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return;

        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          fitAddon.fit();

          // Don't send resize events for invalid dimensions
          // This prevents resizing tmux when terminal is hidden or minimized
          const MIN_COLS = 10;
          const MIN_ROWS = 3;
          if (terminal.cols < MIN_COLS || terminal.rows < MIN_ROWS) {
            return;
          }

          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "resize",
                cols: terminal.cols,
                rows: terminal.rows,
              })
            );
          }
          // Emit dimensions for recording
          onDimensionsChangeRef.current?.(terminal.cols, terminal.rows);
        });
      };

      // Re-fit when page becomes visible again (returning from background)
      let visibilityTimeout: ReturnType<typeof setTimeout> | null = null;
      const handleVisibilityChange = () => {
        if (!document.hidden) {
          // Clear any pending timeout to avoid duplicate calls
          if (visibilityTimeout) {
            clearTimeout(visibilityTimeout);
          }
          // Small delay to let the browser settle after becoming visible
          visibilityTimeout = setTimeout(() => {
            visibilityTimeout = null;
            handleResize();
            // Focus terminal when page becomes visible
            terminal.focus();
          }, 100);
        }
      };

      window.addEventListener("resize", handleResize);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      // Use ResizeObserver to detect when terminal container becomes visible
      // This handles the case when switching tabs (hidden -> visible)
      let lastWidth = 0;
      let lastHeight = 0;
      let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          // Only trigger resize when dimensions are above minimum threshold
          // and actually change to new values
          if (
            width >= MIN_WIDTH &&
            height >= MIN_HEIGHT &&
            (width !== lastWidth || height !== lastHeight)
          ) {
            lastWidth = width;
            lastHeight = height;

            // Debounce rapid resize events (e.g., during window drag)
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(handleResize, 16); // ~60fps
          }
        }
      });

      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }

      // Store cleanup in closure
      return () => {
        if (visibilityTimeout) {
          clearTimeout(visibilityTimeout);
        }
        window.removeEventListener("resize", handleResize);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        resizeObserver.disconnect();
        if (resizeTimeout) clearTimeout(resizeTimeout);
      };
    }

    let cleanup: (() => void) | undefined;

    initTerminal().then((cleanupFn) => {
      cleanup = cleanupFn;
    });

    return () => {
      mounted = false;
      isUnmountingRef.current = true;
      cleanup?.();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
      imageAddonRef.current?.dispose();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      imageAddonRef.current = null;
      searchAddonRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId, tmuxSessionName, projectPath, wsUrl, updateStatus]);

  // Update terminal options when preferences change
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    // Track if this effect has been superseded by a newer one
    let cancelled = false;

    terminal.options.theme = getTerminalTheme(theme);
    terminal.options.fontSize = fontSize;
    terminal.options.fontFamily = fontFamily;

    // Load the font before fitting to ensure accurate cell dimensions
    // The fontFamily value is like "'FiraCode Nerd Font Mono', monospace"
    // Extract the primary font family name for loading
    const fontMatch = fontFamily.match(/^['"]?([^'"]+)/);
    const primaryFont = fontMatch ? fontMatch[1] : fontFamily;

    // Use Font Loading API to ensure font is loaded before fitting
    // This triggers the browser to actually fetch and render the font
    const loadFontAndFit = async () => {
      try {
        // Load both regular and bold weights
        await Promise.all([
          document.fonts.load(`${fontSize}px "${primaryFont}"`),
          document.fonts.load(`bold ${fontSize}px "${primaryFont}"`),
        ]);
      } catch {
        // Font loading failed (e.g., font not found), continue with fallback
      }

      // Wait for all fonts to be ready (including the loaded one)
      await document.fonts.ready;

      // Bail out if this effect was superseded by a newer font change
      if (cancelled) return;

      // Apply the same safety checks as handleResize() to prevent
      // resizing to invalid dimensions when terminal is hidden/backgrounded
      const container = terminalRef.current;
      if (!container) return;

      // Skip if page is hidden (browser tab backgrounded)
      if (document.hidden) return;

      // Skip if container is not visible (display: none)
      if (container.offsetParent === null) return;

      // Skip if container is too small
      const MIN_WIDTH = 100;
      const MIN_HEIGHT = 80;
      const rect = container.getBoundingClientRect();
      if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT) return;

      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (cancelled) return;

        fitAddonRef.current?.fit();

        // Don't send resize for invalid dimensions
        const MIN_COLS = 10;
        const MIN_ROWS = 3;
        if (terminal.cols < MIN_COLS || terminal.rows < MIN_ROWS) return;

        // Send resize to server if connected
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            })
          );
        }
      });
    };

    loadFontAndFit();

    // Cleanup: cancel pending operations if effect re-runs
    return () => {
      cancelled = true;
    };
  }, [theme, fontSize, fontFamily]);

  // Trigger resize when terminal becomes active (e.g., switching tabs or splits)
  useEffect(() => {
    if (!isActive) return;

    const terminal = xtermRef.current;
    const fitAddon = fitAddonRef.current;
    const ws = wsRef.current;

    if (!terminal || !fitAddon) return;

    // Small delay to ensure container has finished layout
    const timeoutId = setTimeout(() => {
      fitAddon.fit();

      // Send resize to sync tmux dimensions
      if (ws?.readyState === WebSocket.OPEN && terminal.cols > 0 && terminal.rows > 0) {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          })
        );
      }

      // Focus the terminal
      terminal.focus();
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [isActive]);

  // Search functions
  const findNext = useCallback(() => {
    if (!searchAddonRef.current || !searchQuery) return;
    searchAddonRef.current.findNext(searchQuery, { caseSensitive: false });
  }, [searchQuery]);

  const findPrevious = useCallback(() => {
    if (!searchAddonRef.current || !searchQuery) return;
    searchAddonRef.current.findPrevious(searchQuery, { caseSensitive: false });
  }, [searchQuery]);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    searchAddonRef.current?.clearDecorations();
    xtermRef.current?.focus();
  }, []);

  // Handle search input changes
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (query && searchAddonRef.current) {
      searchAddonRef.current.findNext(query, { caseSensitive: false });
    } else {
      searchAddonRef.current?.clearDecorations();
    }
  }, []);

  // Handle search keyboard shortcuts
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        findPrevious();
      } else {
        findNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  }, [findNext, findPrevious, closeSearch]);

  // Global keyboard shortcut for opening search (Cmd/Ctrl + F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setIsSearchOpen(true);
        // Focus input after state update
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };

    const container = terminalRef.current;
    if (container) {
      container.addEventListener("keydown", handleKeyDown);
      return () => container.removeEventListener("keydown", handleKeyDown);
    }
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [isSearchOpen]);

  // Upload image to server and return file path
  const uploadImage = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData();
    const extension = IMAGE_EXTENSIONS[file.type] ?? "";
    const safeName = `image-${Date.now()}${extension}`;
    formData.append("image", file, safeName);

    const response = await fetch("/api/images", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to upload image");
    }

    const result = await response.json();
    return result.path;
  }, []);

  // Send image file path to terminal
  // Claude Code reads images from file paths, so we upload and paste the path
  const sendImageToTerminal = useCallback(
    async (file: File) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.error("WebSocket not connected");
        return;
      }

      try {
        const filePath = await uploadImage(file);
        // Send the file path as terminal input
        wsRef.current.send(JSON.stringify({ type: "input", data: filePath }));
      } catch (error) {
        console.error("Failed to upload image:", error);
      }
    },
    [uploadImage]
  );

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if leaving the container entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // First try dataTransfer.files (works for Finder files, macOS screenshot thumbnails)
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));

      if (imageFiles.length > 0) {
        for (const file of imageFiles) {
          await sendImageToTerminal(file);
        }
        return;
      }

      // Fallback: check dataTransfer.items for images dragged from browsers/other apps
      // These may not appear in files but can be retrieved as blobs via getAsFile()
      const items = Array.from(e.dataTransfer.items);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));

      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          await sendImageToTerminal(file);
        }
      }
    },
    [sendImageToTerminal]
  );

  // Handle paste events for images
  // Note: We use a native event listener in the capture phase because xterm.js
  // creates its own internal textarea that captures paste events. React's onPaste
  // on the container div never fires because the event goes to xterm's element.
  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    const handlePaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;

      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith("image/"));

      if (imageItems.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          await sendImageToTerminal(file);
        }
      }
    };

    // Use capture phase to intercept before xterm.js processes the paste
    container.addEventListener("paste", handlePaste, { capture: true });

    return () => {
      container.removeEventListener("paste", handlePaste, { capture: true });
    };
  }, [sendImageToTerminal]);

  // Focus terminal on click/mousedown/touch to ensure it maintains focus
  // This fixes the issue where selecting text would quickly lose focus, preventing copy
  // Also ensures mobile keyboard appears when tapping the terminal
  const handleContainerInteraction = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  return (
    <div
      ref={terminalRef}
      className={`h-full w-full rounded-lg overflow-hidden relative ${
        isDragging ? "ring-2 ring-blue-500 ring-opacity-50" : ""
      }`}
      style={{ backgroundColor: getThemeBackground(theme) }}
      onMouseDown={handleContainerInteraction}
      onTouchStart={handleContainerInteraction}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Recording indicator */}
      {isRecording && (
        <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 bg-red-500/90 backdrop-blur-sm rounded-full px-2.5 py-1 shadow-lg animate-pulse">
          <Circle className="w-2 h-2 fill-white text-white" />
          <span className="text-xs font-medium text-white">REC</span>
        </div>
      )}

      {/* Search overlay - Activity preserves search state when hidden */}
      <Activity mode={isSearchOpen ? "visible" : "hidden"}>
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-slate-800/95 backdrop-blur-sm border border-white/10 rounded-lg px-2 py-1.5 shadow-lg">
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            className="w-48 bg-transparent border-none outline-none text-sm text-white placeholder:text-slate-500"
          />
          <div className="flex items-center gap-0.5">
            <button
              onClick={findPrevious}
              disabled={!searchQuery}
              className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              title="Previous (Shift+Enter)"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={findNext}
              disabled={!searchQuery}
              className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              title="Next (Enter)"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={closeSearch}
              className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white"
              title="Close (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </Activity>

      {isDragging && (
        <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center pointer-events-none z-10">
          <div className="bg-background/90 px-4 py-2 rounded-lg border border-blue-500/50 text-sm">
            Drop image to paste
          </div>
        </div>
      )}
    </div>
  );
});
