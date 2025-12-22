/**
 * Template types and utilities shared between client and server.
 * This file must NOT import database or server-only dependencies.
 */

export interface SessionTemplate {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  sessionNamePattern: string | null;
  projectPath: string | null;
  startupCommand: string | null;
  folderId: string | null;
  icon: string | null;
  theme: string | null;
  fontSize: number | null;
  fontFamily: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  sessionNamePattern?: string;
  projectPath?: string;
  startupCommand?: string;
  folderId?: string;
  icon?: string;
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string | null;
  sessionNamePattern?: string | null;
  projectPath?: string | null;
  startupCommand?: string | null;
  folderId?: string | null;
  icon?: string | null;
  theme?: string | null;
  fontSize?: number | null;
  fontFamily?: string | null;
}

/**
 * Expand session name pattern with variables
 * Supported: ${n} = counter, ${date} = YYYY-MM-DD, ${time} = HH:MM
 */
export function expandNamePattern(pattern: string | null, counter: number): string {
  if (!pattern) return `Terminal ${counter}`;

  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toTimeString().slice(0, 5);

  return pattern
    .replace(/\$\{n\}/g, String(counter))
    .replace(/\$\{date\}/g, date)
    .replace(/\$\{time\}/g, time);
}
