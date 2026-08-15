import { cpSync, existsSync, chmodSync } from 'fs';

cpSync('src/cli/hooks', 'dist/src/cli/hooks', { recursive: true });

const hookScripts = [
  'dist/src/cli/hooks/brain-context.sh',
  'dist/src/cli/hooks/brain-save.sh',
  'dist/src/cli/hooks/task-router.sh'
];

for (const scriptPath of hookScripts) {
  if (existsSync(scriptPath)) {
    chmodSync(scriptPath, 0o755);
  }
}
