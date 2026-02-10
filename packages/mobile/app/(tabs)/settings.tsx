import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/application/state/stores/authStore";

/**
 * Settings screen - app configuration and account settings.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { isAuthenticated, biometricsEnabled, logout, toggleBiometrics } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    router.replace("/auth/login");
  };

  return (
    <ScrollView style={styles.container}>
      {/* Account Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="person-circle" size={24} color="#7aa2f7" />
              <Text style={styles.rowLabel}>Authentication</Text>
            </View>
            <Text style={styles.rowValue}>
              {isAuthenticated ? "Connected" : "Not connected"}
            </Text>
          </View>
        </View>
      </View>

      {/* Security Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="finger-print" size={24} color="#9ece6a" />
              <Text style={styles.rowLabel}>Biometric Unlock</Text>
            </View>
            <Switch
              value={biometricsEnabled}
              onValueChange={toggleBiometrics}
              trackColor={{ false: "#414868", true: "#9ece6a" }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </View>

      {/* Appearance Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="text" size={24} color="#bb9af7" />
              <Text style={styles.rowLabel}>Font Size</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.rowValue}>14</Text>
              <Ionicons name="chevron-forward" size={20} color="#565f89" />
            </View>
          </TouchableOpacity>
          <View style={styles.separator} />
          <TouchableOpacity style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="color-palette" size={24} color="#f7768e" />
              <Text style={styles.rowLabel}>Theme</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.rowValue}>Tokyo Night</Text>
              <Ionicons name="chevron-forward" size={20} color="#565f89" />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Ionicons name="information-circle" size={24} color="#7dcfff" />
              <Text style={styles.rowLabel}>Version</Text>
            </View>
            <Text style={styles.rowValue}>0.1.0</Text>
          </View>
        </View>
      </View>

      {/* Logout Button */}
      {isAuthenticated && (
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out" size={20} color="#f7768e" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      )}

      <View style={styles.footer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1b26",
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    color: "#565f89",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: "#24283b",
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowLabel: {
    color: "#c0caf5",
    fontSize: 16,
  },
  rowValue: {
    color: "#565f89",
    fontSize: 16,
  },
  separator: {
    height: 1,
    backgroundColor: "#1a1b26",
    marginLeft: 52,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 32,
    marginHorizontal: 16,
    padding: 16,
    backgroundColor: "#24283b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f7768e33",
  },
  logoutText: {
    color: "#f7768e",
    fontSize: 16,
    fontWeight: "600",
  },
  footer: {
    height: 50,
  },
});
