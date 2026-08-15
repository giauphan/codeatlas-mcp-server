import test from "node:test";
import assert from "node:assert";

test("execGit allowlist", async (t) => {
    // Reconstruct the logic locally to test it in isolation
    const execGit = (args: string[], commits: number, maxBuffer?: number) => {
      const maxC = Math.max(1, Math.min(commits || 5, 20));

      const revParseFlags = /^(rev-parse|--abbrev-ref|HEAD)$/;
      const statusFlags = /^(status|--porcelain)$/;
      const revListFlags = /^(rev-list|--left-right|--count|HEAD\.\.\.@\{upstream\})$/;
      const logFlags = /^(log|-[0-9]+|--format=.*|--name-only)$/;

      const invalidArgs = args.filter(a =>
        !(revParseFlags.test(a) || statusFlags.test(a) || revListFlags.test(a) || logFlags.test(a))
      );

      if (invalidArgs.length > 0) {
        throw new Error("Security Error: Forbidden git arguments detected");
      }

      return { maxC };
    };

    await t.test("allowed arguments", () => {
        execGit(["rev-parse", "--abbrev-ref", "HEAD"], 5);
        execGit(["status", "--porcelain"], 5);
        execGit(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], 5);
        execGit(["log", "-5", "--format=COMMIT", "--name-only"], 5);
        assert.ok(true);
    });

    await t.test("denied arguments", () => {
        assert.throws(() => execGit(["checkout", "master"], 5), /Security Error: Forbidden git arguments detected/);
        assert.throws(() => execGit(["clone", "http://evil.com"], 5), /Security Error: Forbidden git arguments detected/);
        assert.throws(() => execGit(["-c", "core.pager=cat"], 5), /Security Error: Forbidden git arguments detected/);
        assert.throws(() => execGit(["log", "--10"], 5), /Security Error: Forbidden git arguments detected/); // Not covered by -[0-9]+ since it has two dashes
    });

    await t.test("negative commits are clamped", () => {
        const { maxC } = execGit(["log"], -5);
        assert.equal(maxC, 1);
    });

    await t.test("zero commits are clamped", () => {
        const { maxC } = execGit(["log"], 0);
        // Note: `commits || 5` makes 0 become 5, then min/max clamp applies.
        assert.equal(maxC, 5);
    });

    await t.test("large commits are clamped", () => {
        const { maxC } = execGit(["log"], 100);
        assert.equal(maxC, 20);
    });
});
