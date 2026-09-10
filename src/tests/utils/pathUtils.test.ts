import { writeFileSyncNoFollow, getHomePath } from "../../utils/pathUtils.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";

describe("pathUtils", () => {
  describe("writeFileSyncNoFollow", () => {
    const tempDir = path.join(os.tmpdir(), "codeatlas-test-pathutils-" + Math.random().toString(36).slice(2));

    before(() => {
      fs.mkdirSync(tempDir, { recursive: true });
    });

    after(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should write a new file successfully", () => {
      const filePath = path.join(tempDir, "new-file.txt");
      writeFileSyncNoFollow(filePath, "test content");
      assert.strictEqual(fs.readFileSync(filePath, "utf-8"), "test content");
    });

    it("should truncate and overwrite an existing file", () => {
      const filePath = path.join(tempDir, "existing-file.txt");
      fs.writeFileSync(filePath, "old content");
      writeFileSyncNoFollow(filePath, "new content");
      assert.strictEqual(fs.readFileSync(filePath, "utf-8"), "new content");
    });

    it("should throw an error when attempting to write to a symlink", () => {
      const realFile = path.join(tempDir, "real-file.txt");
      fs.writeFileSync(realFile, "real content");

      const symlinkPath = path.join(tempDir, "symlink-file.txt");
      fs.symlinkSync(realFile, symlinkPath);

      assert.throws(() => {
        writeFileSyncNoFollow(symlinkPath, "malicious content");
      }, /ELOOP|EBADF/);

      // Verify real file wasn't overwritten
      assert.strictEqual(fs.readFileSync(realFile, "utf-8"), "real content");
    });
  });
});
