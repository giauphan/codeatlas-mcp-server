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
        fs.writeFileSync(path.join(TEST_DIR, ".gitignore"), `
# ignores build folder
build/
# ignores all .pyc files
*.pyc
`);
    });
    after(() => {
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        }
    });
    it("should index only non-ignored files", async () => {
        const analyzer = new CodeAnalyzer(TEST_DIR);
        const result = await analyzer.analyzeProject();
        const nodeIds = Array.from(analyzer.nodes.keys());
        const indexedFiles = nodeIds
            .map(id => {
            const filePath = analyzer.nodes.get(id).filePath;
            if (!filePath)
                return null;
            return path.resolve(TEST_DIR, filePath);
        })
            .filter(Boolean)
            .map(p => path.relative(TEST_DIR, p).replace(/\\/g, "/"));
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
        const nodeIds = Array.from(analyzer.nodes.keys());
        const links = analyzer.links;
        assert.ok(nodeIds.includes("module:src/main.py"), "Should include module:src/main.py");
        assert.ok(nodeIds.includes("module:src/utils.py"), "Should include module:src/utils.py");
        assert.strictEqual(nodeIds.includes("external:json"), false, "Should exclude external:json");
        assert.strictEqual(nodeIds.includes("external:requests"), false, "Should exclude external:requests");
        const hasLocalImportLink = links.some((l) => l.source === "module:src/main.py" &&
            l.target === "module:src/utils.py" &&
            l.type === "import");
        assert.ok(hasLocalImportLink, "Should link main.py to utils.py");
        const hasExternalLink = links.some((l) => l.source.startsWith("external:") || l.target.startsWith("external:"));
        assert.strictEqual(hasExternalLink, false, "Should have no links to external libraries");
    });
});
//# sourceMappingURL=parser.test.js.map