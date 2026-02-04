/**
 * Profile Tools - Agent Profile Management
 *
 * Tools for creating, managing, and configuring agent profiles.
 * Profiles provide isolated environments for AI coding agents.
 */
import { z } from "zod";
import { createTool } from "../registry.js";
import { successResult } from "../utils/error-handler.js";
import * as AgentProfileService from "@/services/agent-profile-service";
import type { RegisteredTool } from "../types.js";

/**
 * profile_list - List all agent profiles
 */
const profileList = createTool({
  name: "profile_list",
  description: "List all agent profiles for the current user.",
  inputSchema: z.object({}),
  handler: async (_input, context) => {
    const profiles = await AgentProfileService.getProfiles(context.userId);

    return successResult({
      success: true,
      count: profiles.length,
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        provider: p.provider,
        isDefault: p.isDefault,
        configDir: p.configDir,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    });
  },
});

/**
 * profile_create - Create a new agent profile
 */
const profileCreate = createTool({
  name: "profile_create",
  description:
    "Create a new agent profile with isolated configuration directory. " +
    "Profiles allow separate configurations for different AI agent providers.",
  inputSchema: z.object({
    name: z.string().min(1).describe("Profile name"),
    description: z.string().optional().describe("Profile description"),
    provider: z
      .enum(["claude", "codex", "gemini", "opencode", "all"])
      .describe("AI agent provider this profile is for"),
    isDefault: z
      .boolean()
      .optional()
      .describe("Set as the default profile for new sessions"),
  }),
  handler: async (input, context) => {
    const profile = await AgentProfileService.createProfile(context.userId, {
      name: input.name,
      description: input.description,
      provider: input.provider,
      isDefault: input.isDefault,
    });

    return successResult({
      success: true,
      profile: {
        id: profile.id,
        name: profile.name,
        description: profile.description,
        provider: profile.provider,
        isDefault: profile.isDefault,
        configDir: profile.configDir,
      },
      hint: `Profile created at ${profile.configDir}. Use profile_set_git_identity to configure git identity.`,
    });
  },
});

/**
 * profile_get - Get profile details with environment
 */
const profileGet = createTool({
  name: "profile_get",
  description:
    "Get detailed information about an agent profile including environment variables and git identity.",
  inputSchema: z.object({
    profileId: z.string().uuid().describe("The profile UUID"),
  }),
  handler: async (input, context) => {
    const profile = await AgentProfileService.getProfile(
      input.profileId,
      context.userId
    );

    if (!profile) {
      return successResult({
        success: false,
        error: "Profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    // Get git identity
    const gitIdentity = await AgentProfileService.getProfileGitIdentity(
      input.profileId
    );

    // Get environment overlay
    const environment = await AgentProfileService.getProfileEnvironment(
      input.profileId,
      context.userId
    );

    // Check if directory is accessible
    const isAccessible = await AgentProfileService.isProfileDirectoryAccessible(
      input.profileId
    );

    return successResult({
      success: true,
      profile: {
        id: profile.id,
        name: profile.name,
        description: profile.description,
        provider: profile.provider,
        isDefault: profile.isDefault,
        configDir: profile.configDir,
        isAccessible,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
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
    });
  },
});

/**
 * profile_update - Update profile properties
 */
const profileUpdate = createTool({
  name: "profile_update",
  description: "Update agent profile properties like name, description, or provider.",
  inputSchema: z.object({
    profileId: z.string().uuid().describe("The profile UUID to update"),
    name: z.string().optional().describe("New profile name"),
    description: z
      .string()
      .nullable()
      .optional()
      .describe("New profile description (null to clear)"),
    provider: z
      .enum(["claude", "codex", "gemini", "opencode", "all"])
      .optional()
      .describe("New AI agent provider"),
    isDefault: z
      .boolean()
      .optional()
      .describe("Set as the default profile"),
  }),
  handler: async (input, context) => {
    const updated = await AgentProfileService.updateProfile(
      input.profileId,
      context.userId,
      {
        name: input.name,
        description: input.description ?? undefined,
        provider: input.provider,
        isDefault: input.isDefault,
      }
    );

    if (!updated) {
      return successResult({
        success: false,
        error: "Profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    return successResult({
      success: true,
      profile: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        provider: updated.provider,
        isDefault: updated.isDefault,
      },
    });
  },
});

/**
 * profile_delete - Delete an agent profile
 */
const profileDelete = createTool({
  name: "profile_delete",
  description:
    "Delete an agent profile. Sessions using this profile will be unlinked.",
  inputSchema: z.object({
    profileId: z.string().uuid().describe("The profile UUID to delete"),
  }),
  handler: async (input, context) => {
    const deleted = await AgentProfileService.deleteProfile(
      input.profileId,
      context.userId
    );

    if (!deleted) {
      return successResult({
        success: false,
        error: "Profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    return successResult({
      success: true,
      profileId: input.profileId,
      message: "Profile deleted. Sessions have been unlinked.",
    });
  },
});

/**
 * profile_set_git_identity - Set git user/email for profile
 */
const profileSetGitIdentity = createTool({
  name: "profile_set_git_identity",
  description:
    "Set the git identity (user name, email, and optional SSH key) for a profile. " +
    "This identity will be used for all git operations in sessions using this profile.",
  inputSchema: z.object({
    profileId: z.string().uuid().describe("The profile UUID"),
    userName: z.string().min(1).describe("Git user name"),
    userEmail: z.string().email().describe("Git user email"),
    sshKeyPath: z
      .string()
      .optional()
      .describe("Absolute path to SSH private key for git operations"),
    gpgKeyId: z
      .string()
      .optional()
      .describe("GPG key ID for commit signing"),
    githubUsername: z
      .string()
      .optional()
      .describe("GitHub username (for GitHub-specific operations)"),
  }),
  handler: async (input, context) => {
    // Verify profile exists
    const profile = await AgentProfileService.getProfile(
      input.profileId,
      context.userId
    );

    if (!profile) {
      return successResult({
        success: false,
        error: "Profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    await AgentProfileService.setProfileGitIdentity(input.profileId, {
      userName: input.userName,
      userEmail: input.userEmail,
      sshKeyPath: input.sshKeyPath,
      gpgKeyId: input.gpgKeyId,
      githubUsername: input.githubUsername,
    });

    return successResult({
      success: true,
      profileId: input.profileId,
      gitIdentity: {
        userName: input.userName,
        userEmail: input.userEmail,
        sshKeyPath: input.sshKeyPath,
        gpgKeyId: input.gpgKeyId,
        githubUsername: input.githubUsername,
      },
    });
  },
});

/**
 * profile_link_folder - Link a folder to a profile
 */
const profileLinkFolder = createTool({
  name: "profile_link_folder",
  description:
    "Link a folder to an agent profile. Sessions created in this folder will use the profile's configuration.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("The folder UUID to link"),
    profileId: z.string().uuid().describe("The profile UUID to link to"),
  }),
  handler: async (input, context) => {
    // Verify profile exists
    const profile = await AgentProfileService.getProfile(
      input.profileId,
      context.userId
    );

    if (!profile) {
      return successResult({
        success: false,
        error: "Profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    await AgentProfileService.linkFolderToProfile(input.folderId, input.profileId);

    return successResult({
      success: true,
      folderId: input.folderId,
      profileId: input.profileId,
      message: `Folder linked to profile "${profile.name}"`,
    });
  },
});

/**
 * profile_unlink_folder - Unlink a folder from its profile
 */
const profileUnlinkFolder = createTool({
  name: "profile_unlink_folder",
  description:
    "Unlink a folder from its agent profile. Sessions in this folder will no longer use the profile.",
  inputSchema: z.object({
    folderId: z.string().uuid().describe("The folder UUID to unlink"),
  }),
  handler: async (input) => {
    await AgentProfileService.unlinkFolderFromProfile(input.folderId);

    return successResult({
      success: true,
      folderId: input.folderId,
      message: "Folder unlinked from profile",
    });
  },
});

/**
 * Export all profile tools
 */
export const profileTools: RegisteredTool[] = [
  profileList,
  profileCreate,
  profileGet,
  profileUpdate,
  profileDelete,
  profileSetGitIdentity,
  profileLinkFolder,
  profileUnlinkFolder,
];
