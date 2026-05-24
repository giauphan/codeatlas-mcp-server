import { describe, it } from "node:test";
import * as assert from "node:assert";
import { getWorkspaceFromAncestors, fsWrapper } from "./projectService.js";
// Helper to temporarily stub fsWrapper functions
function stubFsWrapper(stubs) {
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
                existsSync: (p) => {
                    if (p === "/proc/9999/status" || p === "/proc/5000/status" || p === "/proc/5000/cmdline")
                        return true;
                    if (p.includes(".."))
                        return true;
                    return false;
                },
                readFileSync: (p, enc) => {
                    if (p === "/proc/9999/status")
                        return "PPid: 5000\n";
                    if (p === "/proc/5000/status")
                        return "PPid: 1\n";
                    if (p === "/proc/5000/cmdline")
                        return "--workspace_id\0file_.._.._etc_passwd\0";
                    return "";
                }
            });
            try {
                const res = getWorkspaceFromAncestors(9999);
                assert.strictEqual(res, null, "Should reject directory traversal path");
            }
            finally {
                restore();
            }
        });
        it("should successfully match exact casing of paths", () => {
            const restore = stubFsWrapper({
                existsSync: (p) => {
                    if (p === "/proc/9999/status" || p === "/proc/5000/status" || p === "/proc/5000/cmdline")
                        return true;
                    const norm = p.replace(/\\/g, "/");
                    return norm === "/" || norm === "/home" || norm === "/home/biibon" || norm === "/home/biibon/CodeAtlas";
                },
                readdirSync: (p) => {
                    const norm = p.replace(/\\/g, "/");
                    if (norm === "/")
                        return ["home"];
                    if (norm === "/home")
                        return ["biibon"];
                    if (norm === "/home/biibon")
                        return ["CodeAtlas", "codeatlas-mcp"];
                    return [];
                },
                readFileSync: (p, enc) => {
                    if (p === "/proc/9999/status")
                        return "PPid: 5000\n";
                    if (p === "/proc/5000/status")
                        return "PPid: 1\n";
                    if (p === "/proc/5000/cmdline")
                        return "--workspace_id\0file_home_biibon_CodeAtlas\0";
                    return "";
                }
            });
            try {
                const res = getWorkspaceFromAncestors(9999);
                assert.ok(res !== null, "Should resolve a path");
                assert.ok(res.endsWith("CodeAtlas"), `Expected path to end with CodeAtlas, got: ${res}`);
            }
            finally {
                restore();
            }
        });
        it("should match normalized folder names with hyphens", () => {
            const restore = stubFsWrapper({
                existsSync: (p) => {
                    if (p === "/proc/9999/status" || p === "/proc/5000/status" || p === "/proc/5000/cmdline")
                        return true;
                    const norm = p.replace(/\\/g, "/");
                    return norm === "/" || norm === "/home" || norm === "/home/biibon" || norm === "/home/biibon/auto-edit-video-reup-tool";
                },
                readdirSync: (p) => {
                    const norm = p.replace(/\\/g, "/");
                    if (norm === "/")
                        return ["home"];
                    if (norm === "/home")
                        return ["biibon"];
                    if (norm === "/home/biibon")
                        return ["auto-edit-video-reup-tool"];
                    return [];
                },
                readFileSync: (p, enc) => {
                    if (p === "/proc/9999/status")
                        return "PPid: 5000\n";
                    if (p === "/proc/5000/status")
                        return "PPid: 1\n";
                    if (p === "/proc/5000/cmdline")
                        return "--workspace_id\0file_home_biibon_auto_edit_video_reup_tool\0";
                    return "";
                }
            });
            try {
                const res = getWorkspaceFromAncestors(9999);
                assert.ok(res !== null, "Should resolve a path");
                assert.ok(res.endsWith("auto-edit-video-reup-tool"), `Expected path to end with auto-edit-video-reup-tool, got: ${res}`);
            }
            finally {
                restore();
            }
        });
        it("should resolve workspace path from a sibling process (e.g. language server)", () => {
            const restore = stubFsWrapper({
                existsSync: (p) => {
                    if (p === "/proc" || p === "/proc/9999/status" || p === "/proc/5000/status" || p === "/proc/5001/status" || p === "/proc/5001/cmdline")
                        return true;
                    const norm = p.replace(/\\/g, "/");
                    return norm === "/" || norm === "/home" || norm === "/home/biibon" || norm === "/home/biibon/auto-edit-video-reup-tool";
                },
                readdirSync: (p) => {
                    const norm = p.replace(/\\/g, "/");
                    if (norm === "/proc")
                        return ["9999", "5000", "5001"];
                    if (norm === "/")
                        return ["home"];
                    if (norm === "/home")
                        return ["biibon"];
                    if (norm === "/home/biibon")
                        return ["auto-edit-video-reup-tool"];
                    return [];
                },
                readFileSync: (p, enc) => {
                    if (p === "/proc/9999/status")
                        return "PPid: 5000\n";
                    if (p === "/proc/5000/status")
                        return "PPid: 1\n";
                    if (p === "/proc/5001/status")
                        return "PPid: 5000\n"; // sibling!
                    if (p === "/proc/5001/cmdline")
                        return "--workspace_id\0file_home_biibon_auto_edit_video_reup_tool\0";
                    return "";
                }
            });
            try {
                const res = getWorkspaceFromAncestors(9999);
                assert.ok(res !== null, "Should resolve a path");
                assert.ok(res.endsWith("auto-edit-video-reup-tool"), `Expected path to end with auto-edit-video-reup-tool, got: ${res}`);
            }
            finally {
                restore();
            }
        });
    });
    describe("getWorkspaceFromAncestors traversal loop protection", () => {
        it("should prevent infinite loops and break on matching parent-child loops", () => {
            const restore = stubFsWrapper({
                existsSync: (p) => {
                    if (p === "/proc/9999/status" || p === "/proc/9999/cmdline")
                        return true;
                    return false;
                },
                readFileSync: (p, enc) => {
                    if (p === "/proc/9999/status")
                        return "PPid: 9999\n"; // PPid equals currentPid
                    if (p === "/proc/9999/cmdline")
                        return "--workspace_id\0file_home_biibon_CodeAtlas\0";
                    return "";
                }
            });
            try {
                const res = getWorkspaceFromAncestors(9999);
                assert.strictEqual(res, null, "Should break immediately on self-loop PPid");
            }
            finally {
                restore();
            }
        });
    });
});
//# sourceMappingURL=projectService.test.js.map