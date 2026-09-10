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
