"use client";

import type { CSSProperties } from "react";
import { Github, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GitProvider } from "@/db/schema";

interface GitProviderIconProps {
  provider: GitProvider;
  className?: string;
  size?: "sm" | "md" | "lg";
}

interface CustomIconProps {
  className?: string;
  style?: CSSProperties;
}

// Brand colors for each provider
const providerColors: Record<GitProvider, string> = {
  github: "#ffffff",
  gitlab: "#FC6D26",
  bitbucket: "#2684FF",
  gitea: "#609926",
  "azure-devops": "#0078D7",
};

// Provider display names
export const providerNames: Record<GitProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  gitea: "Gitea",
  "azure-devops": "Azure DevOps",
};

const sizeClasses = {
  sm: "w-3 h-3",
  md: "w-4 h-4",
  lg: "w-5 h-5",
};

// Custom SVG icons for providers without lucide icons
function GitLabIcon({ className, style }: CustomIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
    >
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

function BitbucketIcon({ className, style }: CustomIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
    >
      <path d="M.778 1.211a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.893H.778zM14.52 15.53H9.522L8.17 8.466h7.561l-1.211 7.064z" />
    </svg>
  );
}

function GiteaIcon({ className, style }: CustomIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
    >
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 1.5c4.687 0 8.5 3.813 8.5 8.5s-3.813 8.5-8.5 8.5S3.5 16.687 3.5 12 7.313 3.5 12 3.5zm-2.5 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-5.5 5c0 1.657 1.343 3 3 3s3-1.343 3-3h-6z" />
    </svg>
  );
}

function AzureDevOpsIcon({ className, style }: CustomIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
    >
      <path d="M22 6.5v11l-7 4v-3.5l-7-5V8l4.5-1.5V2l9.5 4.5zm-18 6l5 3.5V9L4 6.5v6zm8-10.5v4L7 8V4.5l5-2.5z" />
    </svg>
  );
}

export function GitProviderIcon({
  provider,
  className,
  size = "md",
}: GitProviderIconProps) {
  const sizeClass = sizeClasses[size];
  const color = providerColors[provider];

  switch (provider) {
    case "github":
      return (
        <Github
          className={cn(sizeClass, className)}
          style={{ color }}
        />
      );
    case "gitlab":
      return (
        <GitLabIcon
          className={cn(sizeClass, className)}
          style={{ color }}
        />
      );
    case "bitbucket":
      return (
        <BitbucketIcon
          className={cn(sizeClass, className)}
          style={{ color }}
        />
      );
    case "gitea":
      return (
        <GiteaIcon
          className={cn(sizeClass, className)}
          style={{ color }}
        />
      );
    case "azure-devops":
      return (
        <AzureDevOpsIcon
          className={cn(sizeClass, className)}
          style={{ color }}
        />
      );
    default:
      return (
        <GitBranch
          className={cn(sizeClass, "text-slate-400", className)}
        />
      );
  }
}

// Utility to get provider color
export function getProviderColor(provider: GitProvider): string {
  return providerColors[provider];
}

// Utility to get provider name
export function getProviderName(provider: GitProvider): string {
  return providerNames[provider];
}
