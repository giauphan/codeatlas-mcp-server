import { cpSync, readdirSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeBuildManifest } from './build-manifest.js';

const source = 'src/cli/hooks';
const destination = 'dist/src/cli/hooks';
mkdirSync(destination, { recursive: true });
// TypeScript hook modules are compiled by tsc; copy only compatibility assets.
for (const name of readdirSync(source)) {
  if (!/\.(sh|py)$/.test(name)) continue;
  const target = join(destination, name);
  cpSync(join(source, name), target);
  if (process.platform !== 'win32') chmodSync(target, 0o755);
}

mkdirSync('dist/scripts', { recursive: true });
for (const file of ['claude-hook-settings.js', 'setup-hooks.js', 'validate-hooks.js']) cpSync(join('scripts', file), join('dist/scripts', file));

for (const [sourcePath, target] of [['src/cli/setup-claude.js', 'dist/src/cli/setup-claude.js']]) {
  if (!existsSync(sourcePath)) continue;
  cpSync(sourcePath, target);
  if (process.platform !== 'win32') chmodSync(target, 0o755);
}
if (process.platform !== 'win32' && existsSync('dist/index.js')) chmodSync('dist/index.js', 0o755);
writeBuildManifest();
