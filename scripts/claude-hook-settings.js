/** One compatibility-preserving Claude hook installer for CLI, npm and legacy bridges. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const routes = [
  ['PreToolUse', 'task-router', '*'], ['SessionStart', 'brain-context'], ['UserPromptSubmit', 'brain-context'],
  ['PostToolUse', 'brain-save', '*'], ['PostToolUseFailure', 'brain-save', '*'], ['Stop', 'brain-save'], ['PreCompact', 'brain-save'],
];
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const cliPath = existsSync(join(packageRoot, 'index.js')) ? join(packageRoot, 'index.js') : join(packageRoot, 'dist', 'index.js');
const nativeCommand = (route) => `${quote(process.execPath)} ${quote(cliPath)} hook ${route}`;

function ownsRoute(hook, route) {
  const command = typeof hook === 'string' ? hook : typeof hook?.command === 'string' ? hook.command.trim() : '';
  const args = Array.isArray(hook?.args) ? hook.args : [];
  if (command === nativeCommand(route)) return true;
  // Native routes written by earlier installs embed different node/CLI paths.
  if (new RegExp(`[\\\\/]index\\.js["']?\\s+hook\\s+${route}\\s*$`).test(command)) return true;
  const executable = command.replaceAll('\\', '/').split('/').at(-1);
  if (/^codeatlas(?:-enterprise|-mcp)?$/.test(executable) && args.includes(route)) return true;
  if (new RegExp(`(?:^|[\\s/])codeatlas(?:-enterprise|-mcp)?\\s+(?:hook\\s+)?${route}$`).test(command)) return true;
  // Remove only known CodeAtlas compatibility assets, never arbitrary vendor shell hooks.
  if (new RegExp(`(?:^|/)\\.claude/hooks/${route}\\.sh(?:["']|$)`).test(command.replaceAll('\\', '/'))) return true;
  return false;
}

export function mergeSettings(existing = {}) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) throw new Error('Claude settings root must be an object');
  const merged = JSON.parse(JSON.stringify(existing));
  if (merged.hooks !== undefined && (!merged.hooks || typeof merged.hooks !== 'object' || Array.isArray(merged.hooks))) throw new Error('settings.hooks must be an object');
  merged.hooks ??= {};
  for (const [event, route, matcher] of routes) {
    if (merged.hooks[event] !== undefined && !Array.isArray(merged.hooks[event])) throw new Error(`settings.hooks.${event} must be an array`);
    const preserved = [];
    for (const group of merged.hooks[event] ?? []) {
      if (group && typeof group === 'object' && Array.isArray(group.hooks)) {
        const hooks = group.hooks.filter((hook) => !ownsRoute(hook, route));
        if (hooks.length === group.hooks.length) preserved.push(group);
        else if (hooks.length) preserved.push({ ...group, hooks });
      } else if (!ownsRoute(group, route)) {
        // Older flat formats are upgraded without dropping any third-party command.
        preserved.push(typeof group === 'string' ? { hooks: [{ type: 'command', command: group }] }
          : group && typeof group === 'object' && typeof group.command === 'string' ? { hooks: [group] } : group);
      }
    }
    merged.hooks[event] = [...preserved, { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: nativeCommand(route) }] }];
  }
  return merged;
}

export function installClaudeHooks(settingsFile = join(homedir(), '.claude', 'settings.json')) {
  const settingsPath = resolve(settingsFile);
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  const merged = mergeSettings(settings); // Validate before touching assets or settings.
  const hooksDir = join(dirname(settingsPath), 'hooks');
  const sourceHooks = join(packageRoot, 'src', 'cli', 'hooks');
  const assets = ['brain-save.sh', 'brain-context.sh', 'task-router.sh'];
  for (const file of assets) if (!existsSync(join(sourceHooks, file))) throw new Error(`Missing hook asset: ${file}`);
  mkdirSync(hooksDir, { recursive: true, mode: 0o700 });
  for (const file of assets) {
    const target = join(hooksDir, file);
    copyFileSync(join(sourceHooks, file), target);
    chmodSync(target, 0o700);
  }
  const wrapper = [
    '#!/bin/bash', 'set -euo pipefail',
    `export CODEATLAS_CLI_PATH=${quote(cliPath)}`,
    'command_name="${1:-}"', 'if [ "$command_name" = "hook" ]; then shift; command_name="${1:-}"; fi',
    'case "$command_name" in',
    ...['brain-context', 'brain-save', 'task-router'].map((route) => `  ${route}) exec ${quote(join(hooksDir, `${route}.sh`))} ;;`),
    '  *) echo "usage: codeatlas hook <brain-context|brain-save|task-router>" >&2; exit 2 ;;', 'esac', '',
  ].join('\n');
  const wrapperPath = join(hooksDir, 'codeatlas');
  writeFileSync(wrapperPath, wrapper, { mode: 0o700 });
  chmodSync(wrapperPath, 0o700);
  const temporary = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, settingsPath);
  return { settingsPath, hooksDir, cliPath };
}
