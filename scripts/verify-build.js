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
const sourceMaps = files.filter((file) => file.endsWith(".map"));
const unsafeFiles = files.filter((file) => {
  if (!/\.(js|sh)$/.test(file)) return false;
  return /your-server\.com|localhost:[0-9]{4}/.test(readFileSync(file, "utf8"));
});

if (testFiles.length || sourceMaps.length || unsafeFiles.length) {
  if (testFiles.length) {
    console.error("::error::Test files found in build output:");
    testFiles.forEach((file) => console.error(`  - ${file}`));
  }
  if (sourceMaps.length) {
    console.error("::error::Source maps found in build output:");
    sourceMaps.forEach((file) => console.error(`  - ${file}`));
  }
  if (unsafeFiles.length) {
    console.error("::error::Hardcoded URL fallbacks found in build output:");
    unsafeFiles.forEach((file) => console.error(`  - ${file}`));
  }
  process.exit(1);
}

console.log(`Build validation passed: ${files.length} files checked; no test files, source maps, or hardcoded URL fallbacks.`);
