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

/**
 * Securely appends content to a file, preventing symlink following (TOCTOU attacks).
 * If the file is a symlink, the operation will fail safely.
 *
 * @param filePath - The absolute path of the file to append to.
 * @param content - The content to append to the file.
 * @param mode - The file mode to use if creating a new file (defaults to 0o600).
 * @throws {Error} If the file cannot be opened securely (e.g. if it is a symlink).
 */
export function appendFileSyncNoFollow(filePath: string, content: string, mode: number = 0o600): void {
  let fd: number;
  try {
    fd = fs.openSync(
      filePath,
      fs.constants.O_CREAT |   // Create file if it doesn't exist
      fs.constants.O_WRONLY |  // Open for writing
      fs.constants.O_APPEND |  // Append file content if it exists
      fs.constants.O_NOFOLLOW, // Prevent symlink following
      mode
    );
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`Failed to safely open file for appending: Directory does not exist (${err.message})`);
    }
    throw new Error(`Failed to safely open file for appending: ${err.message}`);
  }
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

export function writeFileSyncNoFollow(filePath: string, content: string, mode: number = 0o600): void {
  const fd = fs.openSync(
    filePath,
    fs.constants.O_CREAT |   // Create file if it doesn't exist
    fs.constants.O_WRONLY |  // Open for writing
    fs.constants.O_TRUNC |   // Truncate file content if it exists
    fs.constants.O_NOFOLLOW, // Prevent symlink following
    mode
  );
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}
