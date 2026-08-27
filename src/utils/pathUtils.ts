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

export function safeWriteFileSync(filePath: string, content: string): void {
  const fd = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o644);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}
