import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFolderStore } from "@/application/state/stores/folderStore";
import { useEffect } from "react";

/**
 * Folders screen - displays folder hierarchy.
 * Allows organizing sessions into folders.
 */
export default function FoldersScreen() {
  const { folders, loading, fetchFolders } = useFolderStore();

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  return (
    <View style={styles.container}>
      <FlatList
        data={folders}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.folderCard}>
            <View style={styles.folderIcon}>
              <Ionicons
                name={item.collapsed ? "folder" : "folder-open"}
                size={24}
                color="#bb9af7"
              />
            </View>
            <View style={styles.folderInfo}>
              <Text style={styles.folderName}>{item.name}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#565f89" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Ionicons name="folder-open-outline" size={64} color="#565f89" />
              <Text style={styles.emptyText}>No folders yet</Text>
              <Text style={styles.emptySubtext}>
                Organize your sessions into folders
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={folders.length === 0 ? styles.emptyContainer : undefined}
      />

      {/* Floating action button */}
      <TouchableOpacity style={styles.fab}>
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
  folderCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#24283b",
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
  },
  folderIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1a1b26",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  folderInfo: {
    flex: 1,
  },
  folderName: {
    color: "#c0caf5",
    fontSize: 16,
    fontWeight: "600",
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
    backgroundColor: "#bb9af7",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
