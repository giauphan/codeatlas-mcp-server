import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync, renameSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const MANIFEST = 'build-manifest.json';

function hash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function filesUnder(directory) {
  let directoryInfo;
  try { directoryInfo = lstatSync(directory); } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) return [];
  return readdirSync(directory).sort().flatMap(name => {
    const file = join(directory, name);
    const entry = lstatSync(file);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return filesUnder(file);
    return entry.isFile() ? [file] : [];
  });
}

function hashes(base, files) {
  return Object.fromEntries(files.sort().map(file => [relative(base, file).replaceAll('\\', '/'), hash(file)]));
}

function sourceHashes(root) {
  const top = ['index.ts', 'package.json', 'tsconfig.json', 'tsconfig.build.json'].map(name => join(root, name)).filter(existsSync);
  const sources = filesUnder(join(root, 'src')).filter(file => /\.(ts|js|sh|py)$/.test(file) && !/\.(test|spec)\.[tj]s$/.test(file) && !/[\\/]fixtures[\\/]/.test(file));
  const scripts = filesUnder(join(root, 'scripts')).filter(file => file.endsWith('.js'));
  return hashes(root, [...top, ...sources, ...scripts]);
}

function artifactHashes(dist) {
  return hashes(dist, filesUnder(dist).filter(file => ![MANIFEST, `${MANIFEST}.tmp`].includes(relative(dist, file))));
}

export function writeBuildManifest(root = process.cwd()) {
  const dist = join(root, 'dist');
  const manifest = { schema_version: 1, source_sha256: sourceHashes(root), artifact_sha256: artifactHashes(dist) };
  const file = join(dist, MANIFEST);
  writeFileSync(`${file}.tmp`, JSON.stringify(manifest, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
  return manifest;
}

export function verifyBuildManifest(dist = 'dist', root = process.cwd()) {
  const canonicalRoot = realpathSync(root);
  const directory = realpathSync(resolve(canonicalRoot, dist));
  const relativeDirectory = relative(canonicalRoot, directory);
  if (relativeDirectory === '..' || relativeDirectory.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || relativeDirectory.startsWith('/')) {
    throw new Error('Build directory resolves outside build root');
  }
  const file = join(directory, MANIFEST);
  if (!existsSync(file)) throw new Error('Build manifest missing; run npm run build before release');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (manifest.schema_version !== 1 || !manifest.source_sha256 || !manifest.artifact_sha256) throw new Error('Invalid build manifest; rebuild required');
  if (JSON.stringify(sourceHashes(canonicalRoot)) !== JSON.stringify(manifest.source_sha256)) throw new Error('Sources differ from the compiled build; run npm run build');
  if (JSON.stringify(artifactHashes(directory)) !== JSON.stringify(manifest.artifact_sha256)) throw new Error('Compiled artifacts differ from build manifest; rebuild required');
}
