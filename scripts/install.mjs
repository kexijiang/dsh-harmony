import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { readdir, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
const root = resolve(import.meta.dirname, '..');
const profile = process.argv[2] || 'desktop';
if (!/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('Invalid dsh profile name');
let cli = process.env.DSH_CLI_PATH;
let executable = process.execPath;
let environment = { ...process.env };
if (profile !== 'web') {
  const desktop = process.env.DSH_DESKTOP_EXE || (process.platform === 'win32' ? execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -Like 'DSH NEXT*' | Select-Object -First 1 -ExpandProperty UninstallString"], { encoding: 'utf8', windowsHide: true }).trim().replace(/^\"(.*)[\\/]Uninstall DSH NEXT\.exe\".*$/, '$1\\DSH NEXT.exe') : '');
  if (!desktop || !existsSync(desktop)) throw new Error('DSH NEXT not found. Set DSH_DESKTOP_EXE to its installed executable.');
  executable = desktop;
  cli = join(dirname(desktop), 'resources/app.asar/lib/desktop-cli.js');
  // Use NEXT's own CLI and Electron-native dependency policy, never the global old dsh CLI.
  environment.ELECTRON_RUN_AS_NODE = '1';
  environment.DSH_DESKTOP_DEFAULT_PROFILE = profile;
  if (!environment.DSH_HOME) {
    const location = join(process.env.APPDATA || '', 'DSH NEXT/home/desktop-next-location.json');
    environment.DSH_HOME = existsSync(location) ? JSON.parse(await readFile(location, 'utf8')).home : process.env.DSH_DESKTOP_NEXT_HOME || join(homedir(), '.dsh');
  }
} else if (!cli) {
  const command = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [process.platform === 'win32' ? 'dsh.cmd' : 'dsh'], {encoding:'utf8'}).trim().split(/\r?\n/)[0];
  cli = process.platform === 'win32' ? join(dirname(command), 'node_modules/@deepseek-ai/dsh/lib/bin.js') : realpathSync(command);
}
const packages = (await readdir(join(root,'artifacts'))).filter(name => /^dsh-plugin-harmony-.*\.tgz$/.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
const archive = process.argv[3] ? resolve(process.argv[3]) : packages[0] && join(root,'artifacts',packages[0]);
if (!archive || !existsSync(archive)) throw new Error('Run npm run bundle first, or pass an existing .tgz path.');
const profileDir = join(environment.DSH_HOME || join(homedir(),'.dsh'),'profiles',profile);
if (profile !== 'web') {
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'));
  if (!manifest.dsh?.profile?.bundles?.includes('dsh-better-sidebar')) throw new Error('Enable Better Sidebar in the selected DSH NEXT profile before installing Harmony.');
}
const backup = join(root,'artifacts','profile-backups',new Date().toISOString().replaceAll(':','-'),profile);
await mkdir(backup,{recursive:true});
for (const name of ['package.json','cordis.patch.yml','pnpm-lock.yaml']) if (existsSync(join(profileDir,name))) await copyFile(join(profileDir,name),join(backup,name));
// node-pty ships a verified Windows prebuild; protobufjs ships generated JS.
// Keep lifecycle scripts disabled for this transaction, without changing the user's build policy.
const result = spawnSync(executable,[...(profile !== 'web' ? ['--expose-internals'] : []),cli,'plugin','--profile',profile,'add',archive,'--ignore-scripts','--config.strictDepBuilds=false'],{stdio:'inherit',windowsHide:true,env:environment});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`dsh plugin install failed (${result.status}); backup: ${backup}`);
// New Desktop CLIs forward pnpm only; installing and enabling are distinct steps.
// Re-read after pnpm to retain any other plugins/preferences added during installation.
const manifestPath = join(profileDir, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const bundles = ((manifest.dsh ??= {}).profile ??= {}).bundles ??= [];
if (!bundles.includes('dsh-plugin-harmony')) {
  bundles.push('dsh-plugin-harmony');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
console.log(`Installed Harmony into dsh profile ${profile}. Restart that profile to load the workbench and agent tool. Backup: ${backup}`);
