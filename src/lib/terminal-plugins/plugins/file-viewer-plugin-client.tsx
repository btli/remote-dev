/**
 * FileViewerPlugin (client half) — React rendering for file-editor sessions.
 *
 * @see ./file-viewer-plugin-server.ts for lifecycle.
 */

import { FileText } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import type { FileViewerMetadata } from "@/types/terminal-type";
import { CodeMirrorEditor } from "@/components/terminal/CodeMirrorEditor";

/**
 * File viewer component.
 *
 * Extracts file path/name from session metadata and mounts the CodeMirror
 * editor directly — no tmux or xterm involved.
 */
function FileViewerComponent({
  session,
  fontSize,
  fontFamily,
}: TerminalTypeClientComponentProps) {
  const metadata = session.typeMetadata as FileViewerMetadata | null;
  const filePath = metadata?.filePath ?? "";
  const fileName = metadata?.fileName ?? "Untitled";

  return (
    <CodeMirrorEditor
      filePath={filePath}
      fileName={fileName}
      fontSize={fontSize}
      fontFamily={fontFamily}
    />
  );
}

/** Default file viewer client plugin instance */
export const FileViewerClientPlugin: TerminalTypeClientPlugin = {
  type: "file",
  displayName: "File Editor",
  description: "Edit markdown files with live preview",
  icon: FileText,
  priority: 80,
  builtIn: true,
  component: FileViewerComponent,
};
