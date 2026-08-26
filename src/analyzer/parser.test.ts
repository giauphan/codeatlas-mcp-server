import { describe, it, before, after } from "node:test";
import * as assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { CodeAnalyzer } from "./parser.js";

const TEST_DIR = path.resolve("./temp_test_workspace");

describe("CodeAnalyzer .gitignore support", () => {
  before(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR);
    
    // Create folders and files
    fs.mkdirSync(path.join(TEST_DIR, "src"));
    fs.mkdirSync(path.join(TEST_DIR, "build"));
    fs.mkdirSync(path.join(TEST_DIR, "dist"));
    
    fs.writeFileSync(path.join(TEST_DIR, "src/main.py"), "print('hello')");
    fs.writeFileSync(path.join(TEST_DIR, "src/utils.ts"), "export const a = 1;");
    fs.writeFileSync(path.join(TEST_DIR, "build/index.js"), "console.log('built')");
    fs.writeFileSync(path.join(TEST_DIR, "dist/index.js"), "console.log('dist')");
    fs.writeFileSync(path.join(TEST_DIR, "src/ignored.pyc"), "binary content");
    
    // Create .gitignore
    fs.writeFileSync(
      path.join(TEST_DIR, ".gitignore"),
      `
# ignores build folder
build/
# ignores all .pyc files
*.pyc
`
    );
  });

  after(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should index only non-ignored files", async () => {
    const analyzer = new CodeAnalyzer(TEST_DIR);
    
    const result = await analyzer.analyzeProject();
    
    const nodeIds = Array.from((analyzer as any).nodes.keys());
    const indexedFiles = nodeIds
      .map(id => {
        const filePath = (analyzer as any).nodes.get(id).filePath;
        if (!filePath) return null;
        return path.resolve(TEST_DIR, filePath);
      })
      .filter(Boolean)
      .map(p => path.relative(TEST_DIR, p!).replace(/\\/g, "/"));

    assert.ok(indexedFiles.includes("src/main.py"), "Should include src/main.py");
    assert.ok(indexedFiles.includes("src/utils.ts"), "Should include src/utils.ts");
    assert.strictEqual(indexedFiles.includes("build/index.js"), false, "Should ignore build/index.js");
    assert.strictEqual(indexedFiles.includes("dist/index.js"), false, "Should ignore dist/index.js");
    assert.strictEqual(indexedFiles.includes("src/ignored.pyc"), false, "Should ignore src/ignored.pyc");
  });

  it("should exclude external modules and resolve local python imports", async () => {
    fs.writeFileSync(path.join(TEST_DIR, "src/main.py"), "import json\nimport requests\nfrom src.utils import helper");
    fs.writeFileSync(path.join(TEST_DIR, "src/utils.py"), "def helper():\n    return 42");

    const analyzer = new CodeAnalyzer(TEST_DIR);
    await analyzer.analyzeProject();

    const nodeIds = Array.from((analyzer as any).nodes.keys());
    const links = (analyzer as any).links;

    assert.ok(nodeIds.includes("module:src/main.py"), "Should include module:src/main.py");
    assert.ok(nodeIds.includes("module:src/utils.py"), "Should include module:src/utils.py");

    assert.strictEqual(nodeIds.includes("external:json"), false, "Should exclude external:json");
    assert.strictEqual(nodeIds.includes("external:requests"), false, "Should exclude external:requests");

    const hasLocalImportLink = links.some((l: any) => 
      l.source === "module:src/main.py" && 
      l.target === "module:src/utils.py" && 
      l.type === "import"
    );
    assert.ok(hasLocalImportLink, "Should link main.py to utils.py");

    const hasExternalLink = links.some((l: any) => 
      l.source.startsWith("external:") || l.target.startsWith("external:")
    );
    assert.strictEqual(hasExternalLink, false, "Should have no links to external libraries");
  });
});

describe("CodeAnalyzer allFiles Set implementation", () => {
  const INCREMENTAL_TEST_DIR = path.resolve("./temp_incremental_test");

  before(() => {
    if (fs.existsSync(INCREMENTAL_TEST_DIR)) {
      fs.rmSync(INCREMENTAL_TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(INCREMENTAL_TEST_DIR);
    fs.writeFileSync(path.join(INCREMENTAL_TEST_DIR, "a.ts"), "export const a = 1;");
    fs.writeFileSync(path.join(INCREMENTAL_TEST_DIR, "b.ts"), "import { a } from './a';");
  });

  after(() => {
    if (fs.existsSync(INCREMENTAL_TEST_DIR)) {
      fs.rmSync(INCREMENTAL_TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should accurately maintain allFiles Set during initial load", async () => {
    const analyzer = new CodeAnalyzer(INCREMENTAL_TEST_DIR);
    const result = await analyzer.analyzeProject();
    const allFiles = (analyzer as any).allFiles as Set<string>;

    assert.strictEqual(allFiles.size, 2);
    assert.ok(allFiles.has(path.resolve(INCREMENTAL_TEST_DIR, "a.ts")));
    assert.ok(allFiles.has(path.resolve(INCREMENTAL_TEST_DIR, "b.ts")));
    assert.strictEqual(result.totalFilesAnalyzed, 2);
  });

  it("should accurately maintain allFiles Set when adding a file", async () => {
    const analyzer = new CodeAnalyzer(INCREMENTAL_TEST_DIR);
    await analyzer.analyzeProject();

    const newFilePath = path.resolve(INCREMENTAL_TEST_DIR, "c.ts");
    fs.writeFileSync(newFilePath, "export const c = 3;");

    const result = await analyzer.analyzeFileIncremental(newFilePath);
    const allFiles = (analyzer as any).allFiles as Set<string>;

    assert.strictEqual(allFiles.size, 3);
    assert.ok(allFiles.has(newFilePath));
    assert.strictEqual(result.totalFilesAnalyzed, 3);
  });

  it("should accurately maintain allFiles Set when deleting a file", async () => {
    // Setup fresh environment for delete test to ensure no state pollution
    const TEST_DEL_DIR = path.resolve("./temp_del_test_2");
    if (fs.existsSync(TEST_DEL_DIR)) {
      fs.rmSync(TEST_DEL_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DEL_DIR);
    fs.writeFileSync(path.join(TEST_DEL_DIR, "a.ts"), "a");
    fs.writeFileSync(path.join(TEST_DEL_DIR, "b.ts"), "b");

    const analyzer = new CodeAnalyzer(TEST_DEL_DIR);
    await analyzer.analyzeProject();

    const deleteFilePath = path.resolve(TEST_DEL_DIR, "b.ts");
    fs.rmSync(deleteFilePath);

    const result = await analyzer.analyzeFileIncremental(deleteFilePath);
    const allFiles = (analyzer as any).allFiles as Set<string>;

    assert.strictEqual(allFiles.size, 1);
    assert.strictEqual(allFiles.has(deleteFilePath), false);
    assert.strictEqual(result.totalFilesAnalyzed, 1);

    fs.rmSync(TEST_DEL_DIR, { recursive: true, force: true });
  });

  it("should maintain unique files when re-analyzing an existing file", async () => {
    // Setup fresh environment
    const TEST_UNIQ_DIR = path.resolve("./temp_uniq_test_2");
    if (fs.existsSync(TEST_UNIQ_DIR)) {
      fs.rmSync(TEST_UNIQ_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_UNIQ_DIR);
    fs.writeFileSync(path.join(TEST_UNIQ_DIR, "a.ts"), "a");
    fs.writeFileSync(path.join(TEST_UNIQ_DIR, "b.ts"), "b");

    const analyzer = new CodeAnalyzer(TEST_UNIQ_DIR);
    await analyzer.analyzeProject();

    const existingFilePath = path.resolve(TEST_UNIQ_DIR, "a.ts");
    fs.writeFileSync(existingFilePath, "export const a = 2;");

    const result = await analyzer.analyzeFileIncremental(existingFilePath);
    const allFiles = (analyzer as any).allFiles as Set<string>;

    assert.strictEqual(allFiles.size, 2);
    assert.ok(allFiles.has(existingFilePath));
    assert.strictEqual(result.totalFilesAnalyzed, 2);

    fs.rmSync(TEST_UNIQ_DIR, { recursive: true, force: true });
  });
});
