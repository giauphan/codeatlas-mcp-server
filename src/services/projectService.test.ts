import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert";
import { getWorkspaceFromAncestors, fsWrapper, isSystemIdeDirectory, getResolvedApiKey } from "./projectService.js";

// Helper to temporarily stub fsWrapper functions
function stubFsWrapper(stubs: { existsSync?: (p: string) => boolean; readFileSync?: (p: string, encoding: "utf8") => string; readdirSync?: (p: string) => string[] }) {
  const originalExists = fsWrapper.existsSync;
  const originalReadFile = fsWrapper.readFileSync;
  const originalReaddir = fsWrapper.readdirSync;

  if (stubs.existsSync) {
    fsWrapper.existsSync = stubs.existsSync;
  }
  if (stubs.readFileSync) {
    fsWrapper.readFileSync = stubs.readFileSync;
  }
  if (stubs.readdirSync) {
    fsWrapper.readdirSync = stubs.readdirSync;
  }

  return () => {
    fsWrapper.existsSync = originalExists;
    fsWrapper.readFileSync = originalReadFile;
    fsWrapper.readdirSync = originalReaddir;
  };
}

describe("Workspace Path Resolution & Discovery Tests", () => {
  describe("findDirMatchingNormalized security and matching", () => {
    it("should prevent directory traversal attempts", () => {
      const restore = stubFsWrapper({
        existsSync: (p: string) => {
          if (p === "/proc/9999/status" || p === "/proc/5000/status" || p === "/proc/5000/cmdline") return true;
          if (p.includes("..")) return true;
          return false;
        },
        readFileSync: (p: string, enc: "utf8") => {
          if (p === "/proc/9999/status") return "PPid: 5000\n";
          if (p === "/proc/5000/status") return "PPid: 1\n";
          if (p === "/proc/5000/cmdline") return "--workspace_id\0file_.._.._etc_passwd\0";
          return "";
        }
      });
      try {
        const res = getWorkspaceFromAncestors(9999);
        assert.strictEqual(res, null, "Should reject directory traversal path");
      } finally {
        restore();
      }
    });

    it("should successfully match exact casing of paths", () => {
      const restore = stubFsWrapper({
        existsSync: (p: string) => {
          if (p === "/proc/9999/status" || p === "/proc/5000/status" || p === "/proc/5000/cmdline") return true;
          const norm = p.replace(/\\/g, "/");
          return norm === "/" || norm === "/home" || norm === "/home/user" || norm === "/home/user/CodeAtlas";
        },
        readdirSync: (p: string) => {
          const norm = p.replace(/\\/g, "/");
          if (norm === "/") return ["home"];
          if (norm === "/home") return ["user"];
          if (norm === "/home/user") return ["CodeAtlas", "codeatlas-mcp"];
          return [];
        },
        readFileSync: (p: string, enc: "utf8") => {
          if (p === "/proc/9999/status") return "PPid: 5000\n";
          if (p === "/proc/5000/status") return "PPid: 1\n";
          if (p === "/proc/5000/cmdline") return "--workspace_id\0file_home_user_CodeAtlas\0";
          return "";
        }
      });

      try {
        const res = getWorkspaceFromAncestors(9999);
        assert.ok(res !== null, "Should resolve a path");
        assert.ok(res!.endsWith("CodeAtlas"), `Expected path to end with CodeAtlas, got: ${res}`);
      } finally {
        restore();
      }
    });

    it("should match normalized folder names with hyphens", () => {
      const restore = stubFsWrapper({
        existsSync: (p: string) => {
          if (p === "/proc/9999/status" || p === "/proc/5000/status" || p === "/proc/5000/cmdline") return true;
          const norm = p.replace(/\\/g, "/");
          return norm === "/" || norm === "/home" || norm === "/home/user" || norm === "/home/user/auto-edit-video-reup-tool";
        },
        readdirSync: (p: string) => {
          const norm = p.replace(/\\/g, "/");
          if (norm === "/") return ["home"];
          if (norm === "/home") return ["user"];
          if (norm === "/home/user") return ["auto-edit-video-reup-tool"];
          return [];
        },
        readFileSync: (p: string, enc: "utf8") => {
          if (p === "/proc/9999/status") return "PPid: 5000\n";
          if (p === "/proc/5000/status") return "PPid: 1\n";
          if (p === "/proc/5000/cmdline") return "--workspace_id\0file_home_user_auto_edit_video_reup_tool\0";
          return "";
        }
      });

      try {
        const res = getWorkspaceFromAncestors(9999);
        assert.ok(res !== null, "Should resolve a path");
        assert.ok(res!.endsWith("auto-edit-video-reup-tool"), `Expected path to end with auto-edit-video-reup-tool, got: ${res}`);
      } finally {
        restore();
      }
    });

    it("should resolve workspace path from a sibling process (e.g. language server)", () => {
      const restore = stubFsWrapper({
        existsSync: (p: string) => {
          if (p === "/proc" || p === "/proc/9999/status" || p === "/proc/5000/status" || p === "/proc/5001/status" || p === "/proc/5001/cmdline") return true;
          const norm = p.replace(/\\/g, "/");
          return norm === "/" || norm === "/home" || norm === "/home/user" || norm === "/home/user/auto-edit-video-reup-tool";
        },
        readdirSync: (p: string) => {
          const norm = p.replace(/\\/g, "/");
          if (norm === "/proc") return ["9999", "5000", "5001"];
          if (norm === "/") return ["home"];
          if (norm === "/home") return ["user"];
          if (norm === "/home/user") return ["auto-edit-video-reup-tool"];
          return [];
        },
        readFileSync: (p: string, enc: "utf8") => {
          if (p === "/proc/9999/status") return "PPid: 5000\n";
          if (p === "/proc/5000/status") return "PPid: 1\n";
          if (p === "/proc/5001/status") return "PPid: 5000\n"; // sibling!
          if (p === "/proc/5001/cmdline") return "--workspace_id\0file_home_user_auto_edit_video_reup_tool\0";
          return "";
        }
      });

      try {
        const res = getWorkspaceFromAncestors(9999);
        assert.ok(res !== null, "Should resolve a path");
        assert.ok(res!.endsWith("auto-edit-video-reup-tool"), `Expected path to end with auto-edit-video-reup-tool, got: ${res}`);
      } finally {
        restore();
      }
    });
  });

  describe("getWorkspaceFromAncestors traversal loop protection", () => {
    it("should prevent infinite loops and break on matching parent-child loops", () => {
      const restore = stubFsWrapper({
        existsSync: (p: string) => {
          if (p === "/proc/9999/status" || p === "/proc/9999/cmdline") return true;
          return false;
        },
        readFileSync: (p: string, enc: "utf8") => {
          if (p === "/proc/9999/status") return "PPid: 9999\n"; // PPid equals currentPid
          if (p === "/proc/9999/cmdline") return "--workspace_id\0file_home_user_CodeAtlas\0";
          return "";
        }
      });

      try {
        const res = getWorkspaceFromAncestors(9999);
        assert.strictEqual(res, null, "Should break immediately on self-loop PPid");
      } finally {
        restore();
      }
    });
  });

  describe("isSystemIdeDirectory exclusion checks", () => {
    it("should flag system IDE directories and subdirectories", () => {
      assert.strictEqual(isSystemIdeDirectory("/config/Downloads/Antigravity"), true);
      assert.strictEqual(isSystemIdeDirectory("/config/Downloads/Antigravity/resources/app"), true);
      assert.strictEqual(isSystemIdeDirectory("/home/user/codeatlas-mcp-enterprise"), false);
    });

    it("should detect IDE resources directory content structure", () => {
      const restore = stubFsWrapper({
        existsSync: (p: string) => {
          const norm = p.replace(/\\/g, "/");
          return norm === "/some/custom/path/resources/app/extensions" || norm === "/some/custom/path/resources/app/out/vs";
        }
      });
      try {
        assert.strictEqual(isSystemIdeDirectory("/some/custom/path"), true);
        assert.strictEqual(isSystemIdeDirectory("/other/path"), false);
      } finally {
        restore();
      }
    });
  });
});

describe("getResolvedApiKey", () => {
  let originalEnvKey: string | undefined;

  beforeEach(() => {
    originalEnvKey = process.env.CODEATLAS_API_KEY;
    delete process.env.CODEATLAS_API_KEY;
  });

  afterEach(() => {
    if (originalEnvKey === undefined) {
      delete process.env.CODEATLAS_API_KEY;
    } else {
      process.env.CODEATLAS_API_KEY = originalEnvKey;
    }
  });

  it("returns key from process.env if it starts with ca_", () => {
    process.env.CODEATLAS_API_KEY = "ca_test_123";
    assert.strictEqual(getResolvedApiKey(), "ca_test_123");
  });

  it("returns key from process.env if it starts with test-", () => {
    process.env.CODEATLAS_API_KEY = "test-123";
    assert.strictEqual(getResolvedApiKey(), "test-123");
  });

  it("ignores invalid process.env key and falls back to searching configs", () => {
    process.env.CODEATLAS_API_KEY = "invalid-key-no-prefix";
    // We expect it to try to find a config and likely return undefined
    // since we haven't stubbed config files for this test.
    const res = getResolvedApiKey();
    assert.ok(res !== "invalid-key-no-prefix");
  });

  it("returns key from parsed config file if present", () => {
    const restore = stubFsWrapper({
      existsSync: (p: string) => p.includes("mcp_config.json"),
      readFileSync: (p: string) => {
        if (p.includes("mcp_config.json")) {
          return JSON.stringify({
            mcpServers: {
              codeatlas: {
                env: {
                  CODEATLAS_API_KEY: "ca_from_config"
                }
              }
            }
          });
        }
        return "";
      }
    });

    try {
      assert.strictEqual(getResolvedApiKey(), "ca_from_config");
    } finally {
      restore();
    }
  });

  it("returns undefined if no config files have the key", () => {
    const restore = stubFsWrapper({
      existsSync: () => false
    });
    try {
      assert.strictEqual(getResolvedApiKey(), undefined);
    } finally {
      restore();
    }
  });
});
