export interface ClaudeHookGroup { [key: string]: unknown; hooks: Array<Record<string, unknown>> }
export interface ClaudeSettings { [key: string]: unknown; hooks: Record<string, ClaudeHookGroup[]> }
export function mergeSettings(existing?: unknown): ClaudeSettings;
export function installClaudeHooks(settingsFile?: string): { settingsPath: string; hooksDir: string; cliPath: string };
