import { describe, it } from "node:test";
import * as assert from "node:assert";
import { getWorkspaceFromAncestors, fsWrapper, isSystemIdeDirectory } from "./projectService.js";

// Helper to temporarily stub fsWrapper functions
function stubFsWrapper(stubs: { existsSync?: (p: string) => boolean; readFileSync?: (p: string, encoding: any) => string; readdirSync?: (p: string) => string[] }) {
  const originalExists = fsWrapper.existsSync;
  const originalReadFile = fsWrapper.readFileSync;
  const originalReaddir = fsWrapper.readdirSync;

  if (stubs.existsSync) {
    fsWrapper.existsSync = stubs.existsSync;
  }
  if (stubs.readFileSync) {
    fsWrapper.readFileSync = stubs.readFileSync as any;
  }
  if (stubs.readdirSync) {
    fsWrapper.readdirSync = stubs.readdirSync as any;
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
        readFileSync: (p: string, enc: any) => {
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
          if (norm === "/home") return ["biibon"];
          if (norm === "/home/user") return ["CodeAtlas", "codeatlas-mcp"];
          return [];
        },
        readFileSync: (p: string, enc: any) => {
          if (p === "/proc/9999/status") return "PPid: 5000\n";
          if (p === "/proc/5000/status") return "PPid: 1\n";
          if (p === "/proc/5000/cmdline") return "--workspace_id\0file_home_biibon_CodeAtlas\0";
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
          if (norm === "/home") return ["biibon"];
          if (norm === "/home/user") return ["auto-edit-video-reup-tool"];
          return [];
        },
        readFileSync: (p: string, enc: any) => {
          if (p === "/proc/9999/status") return "PPid: 5000\n";
          if (p === "/proc/5000/status") return "PPid: 1\n";
          if (p === "/proc/5000/cmdline") return "--workspace_id\0file_home_biibon_auto_edit_video_reup_tool\0";
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
          if (norm === "/home") return ["biibon"];
          if (norm === "/home/user") return ["auto-edit-video-reup-tool"];
          return [];
        },
        readFileSync: (p: string, enc: any) => {
          if (p === "/proc/9999/status") return "PPid: 5000\n";
          if (p === "/proc/5000/status") return "PPid: 1\n";
          if (p === "/proc/5001/status") return "PPid: 5000\n"; // sibling!
          if (p === "/proc/5001/cmdline") return "--workspace_id\0file_home_biibon_auto_edit_video_reup_tool\0";
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
        readFileSync: (p: string, enc: any) => {
          if (p === "/proc/9999/status") return "PPid: 9999\n"; // PPid equals currentPid
          if (p === "/proc/9999/cmdline") return "--workspace_id\0file_home_biibon_CodeAtlas\0";
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
