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
 * Reads a file, enforcing symlink protections.
 */
export function readFileSyncNoFollow(filePath: string): Buffer;
export function readFileSyncNoFollow(filePath: string, encoding: BufferEncoding): string;
export function readFileSyncNoFollow(filePath: string, encoding?: BufferEncoding): string | Buffer {
  if (process.platform === "win32" && process.env.CODEATLAS_WINDOWS_WARNINGS !== "false" && process.env.NODE_ENV !== "production") {
    console.warn(`[readFileSyncNoFollow] O_NOFOLLOW is not supported on Windows. Symlink protection is disabled for ${filePath}`);
  }
  const flags = fs.constants.O_RDONLY | (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW);
  const fd = fs.openSync(filePath, flags);
  try {
    const stat = fs.fstatSync(fd);
    const buffer = Buffer.alloc(stat.size);
    fs.readSync(fd, buffer, 0, stat.size, 0);
    if (encoding) {
      return buffer.toString(encoding);
    }
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

export function writeFileSyncNoFollow(filePath: string, content: string, mode: number = 0o600): void {
  if (process.platform === "win32" && process.env.CODEATLAS_WINDOWS_WARNINGS !== "false" && process.env.NODE_ENV !== "production") {
    console.warn(`[writeFileSyncNoFollow] O_NOFOLLOW is not supported on Windows. Symlink protection is disabled for ${filePath}`);
  }
  const flags = fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_TRUNC | (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW);
  const fd = fs.openSync(filePath, flags, mode);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Appends to a file, enforcing symlink protections.
 * Default mode is 0o600 for security, but consider 0o644 for shared files like .gitignore.
 */
export function appendFileSyncNoFollow(filePath: string, content: string, mode: number = 0o600): void {
  if (process.platform === "win32" && process.env.CODEATLAS_WINDOWS_WARNINGS !== "false" && process.env.NODE_ENV !== "production") {
    console.warn(`[appendFileSyncNoFollow] O_NOFOLLOW is not supported on Windows. Symlink protection is disabled for ${filePath}`);
  }
  const flags = fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_APPEND | (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW);
  const fd = fs.openSync(filePath, flags, mode);
  try {
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}
