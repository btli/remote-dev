/**
 * Profile Resources - Read-only access to agent profile data
 *
 * MCP resources provide read access to agent profiles.
 * Resources use URI patterns like rdv://profiles/{id}
 */
import { createResource, extractUriParams } from "../registry.js";
import * as AgentProfileService from "@/services/agent-profile-service";
import type { RegisteredResource } from "../types.js";

/**
 * rdv://profiles - List all profiles
 */
const profilesListResource = createResource({
  uri: "rdv://profiles",
  name: "Profiles List",
  description: "List all agent profiles with their configuration.",
  mimeType: "application/json",
  handler: async (_uri, context) => {
    const profiles = await AgentProfileService.getProfiles(context.userId);

    // Get folder links for all profiles
    const folderLinks = await AgentProfileService.getFolderProfileLinks(
      context.userId
    );

    const data = {
      count: profiles.length,
      profiles: profiles.map((p) => {
        // Find folders linked to this profile
        const linkedFolders = folderLinks
          .filter((link) => link.profileId === p.id)
          .map((link) => link.folderId);

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          provider: p.provider,
          isDefault: p.isDefault,
          configDir: p.configDir,
          linkedFolders,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        };
      }),
    };

    return {
      uri: "rdv://profiles",
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    };
  },
});

/**
 * rdv://profiles/{id} - Get profile details with environment
 */
const profileDetailResource = createResource({
  uri: "rdv://profiles/{id}",
  name: "Profile Details",
  description:
    "Get detailed information about an agent profile including environment variables and git identity.",
  mimeType: "application/json",
  handler: async (uri, context) => {
    const params = extractUriParams("rdv://profiles/{id}", uri);
    const profileId = params.id;

    const profile = await AgentProfileService.getProfile(
      profileId,
      context.userId
    );

    if (!profile) {
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          error: "Profile not found",
          code: "PROFILE_NOT_FOUND",
        }),
      };
    }

    // Get git identity
    const gitIdentity = await AgentProfileService.getProfileGitIdentity(
      profileId
    );

    // Get environment overlay
    const environment = await AgentProfileService.getProfileEnvironment(
      profileId,
      context.userId
    );

    // Check if directory is accessible
    const isAccessible = await AgentProfileService.isProfileDirectoryAccessible(
      profileId
    );

    // Get folder links for this profile
    const folderLinks = await AgentProfileService.getFolderProfileLinks(
      context.userId
    );
    const linkedFolders = folderLinks
      .filter((link) => link.profileId === profileId)
      .map((link) => link.folderId);

    const data = {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      provider: profile.provider,
      isDefault: profile.isDefault,
      configDir: profile.configDir,
      isAccessible,
      linkedFolders,
      gitIdentity: gitIdentity
        ? {
            userName: gitIdentity.userName,
            userEmail: gitIdentity.userEmail,
            sshKeyPath: gitIdentity.sshKeyPath,
            gpgKeyId: gitIdentity.gpgKeyId,
            githubUsername: gitIdentity.githubUsername,
          }
        : null,
      environment,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };

    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    };
  },
});

/**
 * Export all profile resources
 */
export const profileResources: RegisteredResource[] = [
  profilesListResource,
  profileDetailResource,
];
