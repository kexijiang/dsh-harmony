import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  assertReleaseTag,
  assertReleaseTarball,
  changelogSection,
  finalizePack,
  loadPackageJson,
  parseNpmPackJson,
  parseReleaseTag,
  root,
  sha256Line,
} from '../scripts/release-metadata.mjs';

const script = join(root, 'scripts/release-metadata.mjs');
const packageJson = loadPackageJson();

function runCli(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: root });
}

test('accepts vX.Y.Z tags and marks alpha, beta, and rc as prereleases', () => {
  assert.deepEqual(parseReleaseTag('v0.4.2'), { tag: 'v0.4.2', version: '0.4.2', prerelease: false });
  assert.equal(parseReleaseTag('  v0.4.2 \r').prerelease, false);
  for (const tag of ['v0.5.0-alpha', 'v0.5.0-alpha.1', 'v0.5.0-alpha1', 'v0.5.0-beta', 'v0.5.0-beta.2', 'v0.5.0-rc', 'v0.5.0-rc.1', 'v0.5.0-RC.1']) {
    const parsed = parseReleaseTag(tag);
    assert.equal(parsed.prerelease, true, tag);
    assert.equal(parsed.version, tag.trim().slice(1));
  }
  assert.equal(parseReleaseTag('v0.5.0-dev.1').prerelease, false);
});

test('rejects tags that are not vX.Y.Z', () => {
  for (const tag of ['', '0.4.2', 'v0.4', 'v01.2.3', 'v0.4.2-', 'vv0.4.2', 'v0.4.2+build']) {
    assert.throws(() => parseReleaseTag(tag), /not a publishable tag/);
  }
});

test('requires the tag version and package name to match package.json', () => {
  const manifest = { name: 'dsh-plugin-harmony', version: '1.2.3' };
  assert.deepEqual(assertReleaseTag('v1.2.3', manifest), { tag: 'v1.2.3', version: '1.2.3', prerelease: false });
  assert.equal(assertReleaseTag('v1.2.3-rc.1', { ...manifest, version: '1.2.3-rc.1' }).prerelease, true);
  assert.throws(() => assertReleaseTag('v1.2.3', { ...manifest, version: '1.2.4' }), /Tag v1\.2\.3 does not match package\.json version 1\.2\.4/);
  assert.throws(() => assertReleaseTag('v1.2.3', { name: 'other', version: '1.2.3' }), /package\.json name/);
});

test('extracts only the matching CHANGELOG section', () => {
  const changelog = [
    '# 更新说明',
    '',
    '## 0.4.20 - 2026-12-01',
    '',
    '- newer patch',
    '',
    '## 0.4.2 - 2026-11-09',
    '',
    '- current',
    '- second',
    '',
    '## 0.4.1 - 2026-10-30',
    '',
    '- older',
    '',
  ].join('\n');
  assert.equal(changelogSection(changelog, '0.4.2'), '## 0.4.2 - 2026-11-09\n\n- current\n- second\n');
  assert.match(changelogSection(changelog.replace('## 0.4.2 - 2026-11-09', '## v0.4.2 - 2026-11-09'), '0.4.2'), /^## v0\.4\.2 /);
  assert.equal(changelogSection(changelog, '0.4.3'), null);
  assert.equal(changelogSection('## 0.4.2 - 2026-11-09\n\n', '0.4.2'), null);
  assert.equal(changelogSection('## 0.4.2.1 - 2026-11-09\n\n- no\n', '0.4.2'), null);
  const prerelease = '## 0.5.0-beta.1 - 2026-12-01\n\n- beta\n\n## 0.5.0-beta.10 - 2026-12-02\n\n- later\n';
  assert.equal(changelogSection(prerelease, '0.5.0-beta.1'), '## 0.5.0-beta.1 - 2026-12-01\n\n- beta\n');
  assert.equal(changelogSection(prerelease.replaceAll('\n', '\r\n'), '0.5.0-beta.1'), '## 0.5.0-beta.1 - 2026-12-01\n\n- beta\n');
});

test('checksum line is sha256sum compatible', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sha-'));
  const file = join(dir, 'dsh-plugin-harmony.tgz');
  writeFileSync(file, 'hello');
  const line = sha256Line(file);
  assert.equal(line, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  dsh-plugin-harmony.tgz\n');
  writeFileSync(join(dir, 'dsh-plugin-harmony.tgz.sha256'), line);
  const check = spawnSync('sha256sum', ['-c', 'dsh-plugin-harmony.tgz.sha256'], { cwd: dir, encoding: 'utf8' });
  if (check.error?.code !== 'ENOENT') assert.equal(check.status, 0, check.stderr);
});

test('parses npm pack json and ignores surrounding notices', () => {
  const payload = parseNpmPackJson('npm notice\n[{"filename":"dsh-plugin-harmony-0.4.2.tgz","name":"dsh-plugin-harmony","version":"0.4.2"}]\n');
  assert.equal(payload.filename, 'dsh-plugin-harmony-0.4.2.tgz');
  assert.throws(() => parseNpmPackJson('not json'), /JSON array/);
});

function packFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-'));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const tarball = join(dir, 'packed.tgz');
  execFileSync('tar', ['-czf', tarball, '-C', dir, 'package']);
  return { dir, tarball };
}

const requiredFixture = () => ({
  'package/package.json': JSON.stringify({ name: 'dsh-plugin-harmony', version: packageJson.version }),
  'package/README.md': 'readme',
  'package/LICENSE': 'license',
  'package/NOTICE.md': 'notice',
  'package/cordis.patch.yml': 'patch',
  'package/dist/index.js': 'index',
  'package/dist/client.js': 'client',
});

test('accepts an npm pack shaped tarball and rejects extra paths', () => {
  const good = packFixture(requiredFixture());
  assert.equal(assertReleaseTarball(good.tarball, packageJson.version).name, 'dsh-plugin-harmony');
  const incomplete = packFixture(Object.fromEntries(Object.entries(requiredFixture()).filter(([name]) => name !== 'package/dist/client.js')));
  assert.throws(() => assertReleaseTarball(incomplete.tarball, packageJson.version), /missing package\/dist\/client\.js/);
  const leaked = packFixture({ ...requiredFixture(), 'package/scripts/release-metadata.mjs': 'nope' });
  assert.throws(() => assertReleaseTarball(leaked.tarball, packageJson.version), /not part of the published plugin/);
});

test('renames the versioned npm pack to dsh-plugin-harmony.tgz and writes its checksum', () => {
  const fixture = packFixture(requiredFixture());
  const filename = `dsh-plugin-harmony-${packageJson.version}.tgz`;
  const source = join(fixture.dir, filename);
  copyFileSync(fixture.tarball, source);
  const packJson = join(fixture.dir, 'npm-pack.json');
  writeFileSync(packJson, JSON.stringify([{ filename, name: 'dsh-plugin-harmony', version: packageJson.version }]));
  const result = finalizePack(packJson, packageJson);
  assert.equal(result.tarball, join(fixture.dir, 'dsh-plugin-harmony.tgz'));
  assert.equal(readFileSync(result.checksum, 'utf8'), sha256Line(result.tarball));
  assert.equal(existsSync(source), false);
  assert.equal(existsSync(packJson), false);
});

test('CLI verifies the repository version and rejects a mismatch', () => {
  const tag = `v${packageJson.version}`;
  const ok = runCli(['verify', tag]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, `tag=${tag}\nversion=${packageJson.version}\nprerelease=${/-(?:alpha|beta|rc)(?:\.|\d|$)/i.test(tag)}\n`);
  const mismatch = runCli(['verify', 'v9.9.9']);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, new RegExp(`Tag v9\\.9\\.9 does not match package\\.json version ${packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const malformed = runCli(['verify', '0.4.2']);
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /not a publishable tag/);
});

test('CLI writes the current CHANGELOG section when one exists', () => {
  const section = changelogSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), packageJson.version);
  const output = join(mkdtempSync(join(tmpdir(), 'dsh-notes-')), 'release-notes.md');
  const result = runCli(['notes', `v${packageJson.version}`, output]);
  assert.equal(result.status, 0, result.stderr);
  if (section) {
    assert.equal(result.stdout, `notes_file=${output}\n`);
    assert.equal(readFileSync(output, 'utf8'), section);
  } else {
    assert.equal(result.stdout, 'notes_file=\n');
  }
});
