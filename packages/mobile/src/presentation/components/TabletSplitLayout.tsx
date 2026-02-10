import { useEffect, useState } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { TerminalView } from "./TerminalView";
import { FolderSidebar } from "./FolderSidebar";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

interface TabletSplitLayoutProps {
  leftSessionId: string | null;
  rightSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
}

const MIN_PANE_WIDTH = 200;
const SIDEBAR_WIDTH = 280;

/**
 * Tablet split-screen layout with sidebar and dual terminal panes.
 * Supports landscape orientation with draggable resize handle.
 */
export function TabletSplitLayout({
  leftSessionId,
  rightSessionId,
  onSessionSelect,
}: TabletSplitLayoutProps) {
  const [dimensions, setDimensions] = useState(Dimensions.get("window"));
  const [splitRatio, setSplitRatio] = useState(0.5);

  const isLandscape = dimensions.width > dimensions.height;
  const isTablet = Math.min(dimensions.width, dimensions.height) >= 600;
  const contentWidth = dimensions.width - (isLandscape ? SIDEBAR_WIDTH : 0);
  const leftPaneWidth = rightSessionId ? contentWidth * splitRatio : contentWidth;
  const rightPaneWidth = contentWidth - leftPaneWidth;

  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      setDimensions(window);
    });
    return () => subscription.remove();
  }, []);

  // Pan gesture for resize handle using react-native-gesture-handler
  const panGesture = Gesture.Pan().onEnd((event) => {
    const newRatio = (leftPaneWidth + event.translationX) / contentWidth;
    const clampedRatio = Math.max(
      MIN_PANE_WIDTH / contentWidth,
      Math.min(1 - MIN_PANE_WIDTH / contentWidth, newRatio)
    );
    setSplitRatio(clampedRatio);
  });

  // Don't render split layout on phones or portrait tablets
  if (!isTablet || !isLandscape) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Sidebar */}
      <View style={[styles.sidebar, { width: SIDEBAR_WIDTH }]}>
        <FolderSidebar onSessionSelect={onSessionSelect} />
      </View>

      {/* Content area with split panes */}
      <View style={styles.content}>
        {/* Left pane */}
        <View style={[styles.pane, { width: leftPaneWidth }]}>
          {leftSessionId ? (
            <TerminalView sessionId={leftSessionId} />
          ) : (
            <View style={styles.emptyPane} />
          )}
        </View>

        {/* Resize handle (only shown when split) */}
        {rightSessionId && (
          <GestureDetector gesture={panGesture}>
            <View style={styles.resizeHandleContainer}>
              <View style={styles.resizeHandle} />
            </View>
          </GestureDetector>
        )}

        {/* Right pane */}
        {rightSessionId && (
          <View style={[styles.pane, { width: rightPaneWidth }]}>
            <TerminalView sessionId={rightSessionId} />
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Hook to detect if device is a tablet in landscape.
 */
export function useTabletLandscape(): boolean {
  const [isTabletLandscape, setIsTabletLandscape] = useState(false);

  useEffect(() => {
    const checkOrientation = () => {
      const { width, height } = Dimensions.get("window");
      const isLandscape = width > height;
      const isTablet = Math.min(width, height) >= 600;
      setIsTabletLandscape(isTablet && isLandscape);
    };

    checkOrientation();

    const subscription = Dimensions.addEventListener("change", checkOrientation);
    return () => subscription.remove();
  }, []);

  return isTabletLandscape;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#1a1b26",
  },
  sidebar: {
    backgroundColor: "#1a1b26",
    borderRightWidth: 1,
    borderRightColor: "#24283b",
  },
  content: {
    flex: 1,
    flexDirection: "row",
  },
  pane: {
    flex: 1,
    backgroundColor: "#1a1b26",
  },
  emptyPane: {
    flex: 1,
    backgroundColor: "#1a1b26",
  },
  resizeHandleContainer: {
    width: 8,
    backgroundColor: "#24283b",
    justifyContent: "center",
    alignItems: "center",
  },
  resizeHandle: {
    width: 4,
    height: 40,
    backgroundColor: "#565f89",
    borderRadius: 2,
  },
});
