import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet, View, ActivityIndicator, Text } from "react-native";
import { useAuthStore } from "@/application/state/stores/authStore";

/**
 * Auth gate component that checks authentication and redirects accordingly.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, checkAuthStatus } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await checkAuthStatus();
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, [checkAuthStatus]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "auth";

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to login if not authenticated and not already on auth screens
      router.replace("/auth/login");
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect to main app if authenticated but on auth screens
      router.replace("/");
    }
  }, [isAuthenticated, segments, isLoading, router]);

  // Show loading screen while checking auth
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#7aa2f7" />
        <Text style={styles.loadingText}>Remote Dev</Text>
      </View>
    );
  }

  return <>{children}</>;
}

/**
 * Root layout for the app.
 * Sets up navigation structure, auth gate, and global providers.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar style="light" />
      <AuthGate>
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
              presentation: "fullScreenModal",
            }}
          />
        </Stack>
      </AuthGate>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1b26",
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: "#1a1b26",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 24,
    fontWeight: "600",
    color: "#c0caf5",
  },
});
