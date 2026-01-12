"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ArboristTree, ArboristTreeProps } from "./ArboristTree";
import { useSecretsContext } from "@/contexts/SecretsContext";

/**
 * Props for the SidebarTree wrapper component
 * Excludes dimensions which are calculated internally
 */
export interface SidebarTreeProps extends Omit<ArboristTreeProps, "height" | "width" | "folderHasSecrets"> {
  /** Container width from parent sidebar */
  containerWidth: number;
  /** Minimum height for the tree */
  minHeight?: number;
  /** Maximum height for the tree (defaults to fill available space) */
  maxHeight?: number;
}

/**
 * SidebarTree - Wrapper component for ArboristTree that handles:
 * - Auto-sizing based on container
 * - Secrets context integration
 * - Collapsed state synchronization
 */
export function SidebarTree({
  containerWidth,
  minHeight = 200,
  maxHeight,
  folders,
  ...props
}: SidebarTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(minHeight);
  const { folderConfigs } = useSecretsContext();

  // Calculate height based on available space
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        // Get available space from container to bottom of viewport
        const availableHeight = window.innerHeight - rect.top - 16; // 16px padding
        const newHeight = maxHeight
          ? Math.min(Math.max(availableHeight, minHeight), maxHeight)
          : Math.max(availableHeight, minHeight);
        setHeight(newHeight);
      }
    };

    updateHeight();

    // Update on resize
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [minHeight, maxHeight]);

  // Check if a folder has secrets configured and enabled
  const folderHasSecrets = useCallback((folderId: string): boolean => {
    const config = folderConfigs.get(folderId);
    return config?.enabled ?? false;
  }, [folderConfigs]);

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden">
      <ArboristTree
        {...props}
        folders={folders}
        height={height}
        width={containerWidth}
        folderHasSecrets={folderHasSecrets}
      />
    </div>
  );
}
