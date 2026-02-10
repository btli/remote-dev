import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

/**
 * Tab navigation layout.
 * Bottom tabs for Sessions, Folders, and Settings.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#7aa2f7",
        tabBarInactiveTintColor: "#565f89",
        tabBarStyle: {
          backgroundColor: "#1a1b26",
          borderTopColor: "#24283b",
          borderTopWidth: 1,
        },
        headerStyle: {
          backgroundColor: "#1a1b26",
          borderBottomColor: "#24283b",
          borderBottomWidth: 1,
        },
        headerTintColor: "#c0caf5",
        headerTitleStyle: {
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Sessions",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="terminal" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="folders"
        options={{
          title: "Folders",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="folder" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
