import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native";

/**
 * Root layout for the app.
 * Sets up navigation structure and global providers.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: "#1a1b26",
          },
          headerTintColor: "#c0caf5",
          headerTitleStyle: {
            fontWeight: "600",
          },
          contentStyle: {
            backgroundColor: "#1a1b26",
          },
        }}
      >
        <Stack.Screen
          name="(tabs)"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="session/[id]"
          options={{
            title: "Terminal",
            presentation: "card",
          }}
        />
        <Stack.Screen
          name="auth/login"
          options={{
            title: "Login",
            headerShown: false,
            presentation: "modal",
          }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1b26",
  },
});
