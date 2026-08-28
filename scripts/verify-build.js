import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || "dist";
const files = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const file = join(directory, name);
    if (statSync(file).isDirectory()) walk(file);
    else files.push(file);
  }
}

try {
  walk(root);
} catch (error) {
  console.error(`::error::Unable to inspect ${root}: ${error.message}`);
  process.exit(1);
}

const testFiles = files.filter((file) => /\.(test|spec)\.(js|js\.map)$/.test(file));
const unsafeFiles = files.filter((file) => {
  if (!/\.(js|sh)$/.test(file)) return false;
  return /your-server\.com|localhost:[0-9]{4}/.test(readFileSync(file, "utf8"));
});

if (testFiles.length || unsafeFiles.length) {
  if (testFiles.length) {
    console.error("::error::Test files found in build output:");
    testFiles.forEach((file) => console.error(`  - ${file}`));
  }
  if (unsafeFiles.length) {
    console.error("::error::Hardcoded URL fallbacks found in build output:");
    unsafeFiles.forEach((file) => console.error(`  - ${file}`));
  }
  process.exit(1);
}

console.log(`Build validation passed: ${files.length} files checked; no test files or hardcoded URL fallbacks.`);
