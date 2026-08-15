import { cpSync, readdirSync, chmodSync } from 'fs';
import { join } from 'path';

const SRC = 'src/cli/hooks';
const DEST = 'dist/src/cli/hooks';

if (!process.platform.startsWith('win')) {
  cpSync(SRC, DEST, { recursive: true });
  for (const name of readdirSync(DEST)) {
    if (name.endsWith('.sh')) {
      chmodSync(join(DEST, name), 0o755);
    }
  }
}
