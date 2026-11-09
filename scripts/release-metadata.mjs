import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const root = join(import.meta.dirname, '..');

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const PRERELEASE_PATTERN = /-(?:alpha|beta|rc)(?:\.|\d|$)/i;
const REQUIRED_ENTRIES = [
  'package/package.json',
  'package/README.md',
  'package/LICENSE',
  'package/NOTICE.md',
  'package/cordis.patch.yml',
  'package/dist/index.js',
  'package/dist/client.js',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readText(path) {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
}

export function loadPackageJson(packagePath = join(root, 'package.json')) {
  return JSON.parse(readText(packagePath));
}

// Tag vX.Y.Z must equal "v" + package.json version. -alpha/-beta/-rc marks a prerelease.
export function parseReleaseTag(input) {
  const tag = String(input ?? '').trim();
  if (!TAG_PATTERN.test(tag)) {
    throw new Error(
      `Tag ${JSON.stringify(input)} is not a publishable tag. Use vX.Y.Z, or the same form with a suffix such as -alpha.1, -beta.1, or -rc.1.`,
    );
  }
  return { tag, version: tag.slice(1), prerelease: PRERELEASE_PATTERN.test(tag) };
}

export function assertReleaseTag(input, packageJson = loadPackageJson()) {
  const parsed = parseReleaseTag(input);
  if (packageJson.name !== 'dsh-plugin-harmony') {
    throw new Error(`package.json name is ${JSON.stringify(packageJson.name)}; expected "dsh-plugin-harmony".`);
  }
  if (packageJson.version !== parsed.version) {
    throw new Error(
      `Tag ${parsed.tag} does not match package.json version ${packageJson.version}. ` +
      `Update package.json and CHANGELOG.md to ${parsed.version} before tagging, or push tag v${packageJson.version}.`,
    );
  }
  return parsed;
}

// Returns the matching CHANGELOG section, or null when the release should use generated notes.
export function changelogSection(changelog, version) {
  const lines = String(changelog).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const heading = new RegExp(`^##\\s+v?${escapeRegExp(version)}(?:\\s|$)`);
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  if (!body) return null;
  return `${lines[start]}\n\n${body}\n`;
}

export function sha256Line(filePath) {
  const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  return `${hash}  ${basename(filePath)}\n`;
}

export function parseNpmPackJson(text) {
  const source = String(text);
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('npm pack --json did not return a JSON array.');
  const rows = JSON.parse(source.slice(start, end + 1));
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0].filename !== 'string') {
    throw new Error('npm pack --json returned an unexpected payload.');
  }
  return rows[0];
}

function normalizeTarEntry(entry) {
  return entry.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function listTarball(tarballPath) {
  return execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map(normalizeTarEntry)
    .filter(Boolean);
}

export function assertReleaseTarball(tarballPath, version) {
  const entries = listTarball(tarballPath);
  const present = new Set(entries);
  for (const required of REQUIRED_ENTRIES) {
    if (!present.has(required)) throw new Error(`Release tarball is missing ${required}.`);
  }
  for (const entry of entries) {
    if (!entry.startsWith('package/')) throw new Error(`Release tarball entry ${entry} is outside package/.`);
    const parts = entry.split('/');
    const top = parts[1];
    if (parts.includes('node_modules') || top === '.git' || top === '.github' || top === 'tests' || top === 'scripts' || top === 'artifacts') {
      throw new Error(`Release tarball contains ${entry}, which is not part of the published plugin.`);
    }
  }
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], { encoding: 'utf8' }));
  if (manifest.name !== 'dsh-plugin-harmony') {
    throw new Error(`Packed package name is ${JSON.stringify(manifest.name)}; expected "dsh-plugin-harmony".`);
  }
  if (manifest.version !== version) {
    throw new Error(`Packed package version ${manifest.version} does not match ${version}.`);
  }
  return manifest;
}

// Rename npm's versioned tarball to the historical asset name and write a sha256sum-compatible checksum.
export function finalizePack(packJsonPath, packageJson = loadPackageJson()) {
  const directory = dirname(packJsonPath);
  const payload = parseNpmPackJson(readText(packJsonPath));
  if (payload.name !== 'dsh-plugin-harmony') {
    throw new Error(`npm pack name is ${JSON.stringify(payload.name)}; expected "dsh-plugin-harmony".`);
  }
  if (payload.version !== packageJson.version) {
    throw new Error(`npm pack version ${payload.version} does not match package.json version ${packageJson.version}.`);
  }
  const expectedFilename = `dsh-plugin-harmony-${payload.version}.tgz`;
  if (payload.filename !== expectedFilename || payload.filename.includes('..') || /[\\/]/.test(payload.filename)) {
    throw new Error(`Unexpected npm pack filename ${JSON.stringify(payload.filename)}; expected ${expectedFilename}.`);
  }
  const source = join(directory, payload.filename);
  if (!existsSync(source)) throw new Error(`npm pack did not create ${source}.`);
  const destination = join(directory, 'dsh-plugin-harmony.tgz');
  if (source !== destination) renameSync(source, destination);
  const checksum = `${destination}.sha256`;
  writeFileSync(checksum, sha256Line(destination));
  assertReleaseTarball(destination, packageJson.version);
  unlinkSync(packJsonPath);
  return { tarball: destination, checksum, version: packageJson.version };
}

function writeOutput(lines) {
  process.stdout.write(`${lines.join('\n')}\n`);
}

function verifyCommand(tag) {
  const parsed = assertReleaseTag(tag);
  writeOutput([
    `tag=${parsed.tag}`,
    `version=${parsed.version}`,
    `prerelease=${parsed.prerelease ? 'true' : 'false'}`,
  ]);
}

function notesCommand(tag, outputPath) {
  const parsed = assertReleaseTag(tag);
  const section = changelogSection(readText(join(root, 'CHANGELOG.md')), parsed.version);
  if (!section) {
    console.error(`No CHANGELOG section for ${parsed.version}; GitHub will generate the release notes.`);
    writeOutput(['notes_file=']);
    return;
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, section);
  console.error(`Using CHANGELOG section for ${parsed.version}.`);
  writeOutput([`notes_file=${outputPath}`]);
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exit(1);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    switch (command) {
      case 'verify':
        if (args.length !== 1) throw new Error('Usage: release-metadata.mjs verify <tag>');
        verifyCommand(args[0]);
        break;
      case 'notes':
        if (args.length !== 2) throw new Error('Usage: release-metadata.mjs notes <tag> <output>');
        notesCommand(args[0], args[1]);
        break;
      case 'finalize-pack':
        if (args.length !== 1) throw new Error('Usage: release-metadata.mjs finalize-pack <npm-pack.json>');
        {
          const result = finalizePack(args[0]);
          console.error(`Packed ${result.tarball}`);
          console.error(readText(result.checksum).trim());
        }
        break;
      default:
        throw new Error('Usage: release-metadata.mjs <verify|notes|finalize-pack> ...');
    }
  } catch (error) {
    fail(error);
  }
}

const entry = process.argv[1]?.replaceAll('\\', '/');
if (entry?.endsWith('scripts/release-metadata.mjs')) main();
