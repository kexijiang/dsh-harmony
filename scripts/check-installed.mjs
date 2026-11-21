import { createRequire } from 'node:module';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync, fork } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const pkg = process.argv[2] || join(homedir(), '.dsh/profiles/desktop/node_modules/dsh-plugin-harmony');
const require = createRequire(join(pkg, 'package.json'));
const pty = require('node-pty');
const terminal = pty.spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'echo DSH_HARMONY_PTY_OK'], {
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env,
  useConptyDll: true,
});
let output = '';
terminal.onData(data => { output += data; });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { terminal.kill(); reject(new Error('PTY timeout')); }, 5000);
  terminal.onExit(({ exitCode }) => {
    clearTimeout(timer);
    if (exitCode !== 0) reject(new Error('PTY exited ' + exitCode));
    else resolve();
  });
});
assert.match(output, /DSH_HARMONY_PTY_OK/);

const dir = await mkdtemp(join(tmpdir(), 'dsh-harmony-installed-'));
const dbPath = join(dir, 'test.db');
const db = new DatabaseSync(dbPath);
db.exec('CREATE TABLE test (value TEXT)');
db.close();

const sqlite = new Worker(join(pkg, 'dist/lib/harmony/runtime/sqlite-inspector.cjs'), {
  workerData: { path: dbPath, offset: 0 },
});
const result = await new Promise((resolve, reject) => {
  sqlite.once('message', resolve);
  sqlite.once('error', reject);
});
await sqlite.terminate();
assert.deepEqual(result.tables, ['test']);

const worker = fork(
  join(pkg, 'dist/.harmony-worker/harmony/runtime/worker-entry.js'),
  [],
  {
    env: {
      ...process.env,
      PIORA_HARMONY_WORKER_EPOCH: 'test-epoch',
      PIORA_HARMONY_WORKER_SERIAL: 'test-serial',
      PIORA_HARMONY_WORKER_HDC: join(pkg, 'dist/resources/tools/windows-x64/hdc.exe'),
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  },
);
let stderr = '';
worker.stderr.on('data', data => { stderr += data; });
try {
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker timeout ' + stderr)), 5000);
    worker.once('message', value => { clearTimeout(timer); resolve(value); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.send({ id: 1, protocol: -1 });
  });
  assert.ok(reply.error);
} finally {
  worker.disconnect();
}

// Verify bundled ARM64 native video libraries and absence of removed legacy HAP/DevEco signing files.
const videoDir = join(pkg, 'dist/third_party/harmony-video');
const videoManifest = JSON.parse(readFileSync(join(videoDir, 'manifest.json'), 'utf8'));
assert.ok(Array.isArray(videoManifest.assets) && videoManifest.assets.length > 0);
const videoFiles = readdirSync(videoDir);
assert.ok(videoManifest.assets.every(asset => videoFiles.includes(asset.name)));
assert.ok(existsSync(join(pkg, 'dist/native-mirror.cjs')));
assert.equal(existsSync(join(pkg, 'dist/resources/tools/windows-x64/OHScrcpyServer.hap')), false);
assert.equal(existsSync(join(pkg, 'dist/lib/harmony/runtime/PioraHapSigner.java')), false);
assert.equal(existsSync(join(pkg, 'dist/resources/signing-project')), false);

// Verify Log Workbench assets, unbundled ES modules, 7z-bin and yauzl in the installed (--ignore-scripts) tree.
assert.ok(existsSync(join(pkg, 'dist/third_party/harmony-log-workbench/7zip-runtime.json')));
const logLibPath = join(pkg, 'dist/lib/harmony/log-library/vendor/log-library.mjs');
const logWorkerPath = join(pkg, 'dist/lib/harmony/log-library/vendor/log-worker.mjs');
assert.ok(existsSync(logLibPath));
assert.ok(existsSync(logWorkerPath));
const logLib = await import(pathToFileURL(logLibPath).href);
assert.equal(typeof logLib.createLogLibrary, 'function');

const sevenZip = require('7z-bin');
assert.ok(existsSync(sevenZip.path7z), '7z-bin path7z missing in installed package');
assert.match(execFileSync(sevenZip.path7z, [], { encoding: 'utf8' }), /7-Zip/);
const yauzl = require('yauzl');
assert.equal(typeof yauzl.open, 'function');

await import('node:fs/promises').then(fs =>
  fs.writeFile(
    '.verification/installed-runtime.json',
    JSON.stringify(
      {
        package: pkg,
        version: require('./package.json').version,
        pty: true,
        sqlite: true,
        hypiumIPC: true,
        nativeVideoAssets: videoManifest.assets.length,
        logWorkbench: true,
        sevenZip: true,
        yauzl: true,
      },
      null,
      2,
    ),
  ),
);
console.log('Installed package: PTY, SQLite, Hypium IPC, bundled video, 7z-bin, yauzl and log-library passed.');
terminal.kill();
process.exit(0);
