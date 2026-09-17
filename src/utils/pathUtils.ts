import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export function getHomePath(): string {
  return os.homedir();
}

export function getHermesConfigPath(): string {
  return path.join(getHomePath(), ".hermes", "config.yaml");
}

export function getHermesPluginDir(): string {
  return path.join(getHomePath(), ".hermes", "plugins", "codeatlas_second_brain");
}

export function getClaudeConfigPath(): string {
  return path.join(getHomePath(), ".claude", "claude.json");
}

export function getClaudeSettingsPath(): string {
  return path.join(getHomePath(), ".claude", "settings.json");
}

export function getClaudeJsonPath(): string {
  return path.join(getHomePath(), ".claude.json");
}

export function getClaudeHooksDir(): string {
  return path.join(getHomePath(), ".claude", "hooks");
}

export function getClaudeDesktopConfigPath(): string {
  if (process.platform === "darwin") {
    return path.join(getHomePath(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || getHomePath(), "Claude", "claude_desktop_config.json");
  }
  return path.join(getHomePath(), ".config", "Claude", "claude_desktop_config.json");
}

export function getGeminiSettingsPath(): string {
  return path.join(getHomePath(), ".gemini", "settings.json");
}

export function getGeminiConfigPath(): string {
  return path.join(getHomePath(), ".gemini", "config.json");
}

export function getCursorMcpPath(): string {
  return path.join(getHomePath(), ".cursor", "mcp.json");
}

export function getZedConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || getHomePath(), "zed");
  }
  if (process.platform === "darwin") {
    return path.join(getHomePath(), "Library", "Application Support", "Zed");
  }
  return path.join(getHomePath(), ".config", "zed");
}

export function getZedSettingsPath(): string {
  return path.join(getZedConfigDir(), "settings.json");
}

export function writeFileSyncNoFollow(filePath: string, content: string, mode: number = 0o600): void {
  // O_NOFOLLOW not supported on all platforms (e.g. Windows), silently degrades
  const flags = fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(filePath, flags, mode);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

export function appendFileSyncNoFollow(filePath: string, content: string, mode: number = 0o644): void {
  // O_NOFOLLOW not supported on all platforms (e.g. Windows), silently degrades
  const flags = fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(filePath, flags, mode);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}
