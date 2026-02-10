import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useAuthStore } from "@/application/state/stores/authStore";

/**
 * Login screen with Cloudflare Access and API key authentication.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { loginWithApiKey, loginWithCloudflareAccess, loading, error } = useAuthStore();
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  const handleApiKeyLogin = async () => {
    if (!apiKey.trim()) {
      Alert.alert("Error", "Please enter an API key");
      return;
    }

    try {
      await loginWithApiKey(apiKey.trim());
      router.replace("/(tabs)");
    } catch (err) {
      Alert.alert("Login Failed", (err as Error).message);
    }
  };

  const handleCloudflareLogin = async () => {
    try {
      await loginWithCloudflareAccess();
      router.replace("/(tabs)");
    } catch (err) {
      Alert.alert("Login Failed", (err as Error).message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.content}>
        <View style={styles.logo}>
          <Ionicons name="terminal" size={64} color="#7aa2f7" />
        </View>
        <Text style={styles.title}>Remote Dev</Text>
        <Text style={styles.subtitle}>Mobile Terminal Client</Text>

        <TouchableOpacity
          style={styles.cfButton}
          onPress={handleCloudflareLogin}
          disabled={loading}
        >
          <Ionicons name="shield-checkmark" size={24} color="#fff" />
          <Text style={styles.cfButtonText}>
            {loading ? "Authenticating..." : "Login with Cloudflare Access"}
          </Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Enter API Key"
            placeholderTextColor="#565f89"
            value={apiKey}
            onChangeText={setApiKey}
            secureTextEntry={!showApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowApiKey(!showApiKey)}
          >
            <Ionicons
              name={showApiKey ? "eye-off" : "eye"}
              size={22}
              color="#565f89"
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.loginButton, !apiKey.trim() && styles.loginButtonDisabled]}
          onPress={handleApiKeyLogin}
          disabled={loading || !apiKey.trim()}
        >
          <Text style={styles.loginButtonText}>
            {loading ? "Logging in..." : "Login with API Key"}
          </Text>
        </TouchableOpacity>

        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={18} color="#f7768e" />
            <Text style={styles.errorText}>{error.message}</Text>
          </View>
        )}

        <Text style={styles.helpText}>
          Generate an API key from the web interface at Settings → API Keys
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1b26",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  logo: {
    marginBottom: 16,
  },
  title: {
    color: "#c0caf5",
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    color: "#565f89",
    fontSize: 16,
    marginBottom: 48,
  },
  cfButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    width: "100%",
    paddingVertical: 16,
    backgroundColor: "#f97316",
    borderRadius: 12,
    marginBottom: 24,
  },
  cfButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#24283b",
  },
  dividerText: {
    color: "#565f89",
    paddingHorizontal: 16,
    fontSize: 14,
  },
  inputContainer: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#24283b",
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    color: "#c0caf5",
    fontSize: 16,
  },
  eyeButton: {
    padding: 4,
  },
  loginButton: {
    width: "100%",
    paddingVertical: 16,
    backgroundColor: "#7aa2f7",
    borderRadius: 12,
    alignItems: "center",
  },
  loginButtonDisabled: {
    backgroundColor: "#7aa2f744",
  },
  loginButtonText: {
    color: "#1a1b26",
    fontSize: 16,
    fontWeight: "600",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  errorText: {
    color: "#f7768e",
    fontSize: 14,
  },
  helpText: {
    color: "#565f89",
    fontSize: 13,
    textAlign: "center",
    marginTop: 24,
    paddingHorizontal: 16,
  },
});
