import { allocatePioraPort } from '@piora/lib/harmony/runtime/local-port';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** One plugin-owned native window; no device authority or secrets enter its renderer. */
export class NativeMirror {
  state: any = { serial: '', scale: 100, alwaysOnTop: false, open: false, minimized: false, ownerId: randomUUID(), presentation: 'sidebar', theme: {mode:'light'}, command: null, commandId: 0 };
  private child?: ChildProcess;
  private server?: Server;
  private starting?: Promise<void>;
  private closing = false;
  private origin = '';
  private token = randomBytes(32).toString('base64url');
  constructor(private options: { root: string; dataDir: string; electronPath?: string; createHandler: (origin: string) => any; allowOrigin: (origin: string) => void; removeOrigin: (origin: string) => void }) {}
  private async launch() {
    if (this.closing) throw new Error('Mirror is stopping');
    if (this.starting) return this.starting;
    if (this.child?.connected) { this.child.send({type:'focus'}); return; }
    this.starting = this.start();
    try { await this.starting; } finally { this.starting = undefined; }
  }
  private async start() {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh');
    const candidates = [this.options.electronPath, process.env.DSH_HARMONY_ELECTRON_PATH, join(home, 'electron/electron.exe')];
    let runtime = candidates.find((path): path is string => !!path && existsSync(path));
    if (!runtime) {
      // Reuse the shared runtime when available; otherwise provision our pinned runtime on first open.
      const { downloadArtifact } = await import('@electron/get');
      const { default: extract } = await import('extract-zip');
      const directory = join(this.options.dataDir, 'electron-43.3.0');
      runtime = join(directory, 'electron.exe');
      if (!existsSync(runtime)) {
        const zip = await downloadArtifact({ version:'43.3.0', artifactName:'electron', platform:'win32', arch:'x64' });
        await extract(zip, {dir:directory});
      }
    }
    if (this.closing) throw new Error('Mirror is stopping');
    if (!this.server) {
      let handler: any;
      this.server = createServer((req, res) => {
        const supplied = Buffer.from(String(req.headers['x-harmony-native'] || ''));
        const expected = Buffer.from(this.token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(403); res.end(); return; }
        void handler(req, res);
      });
      const port = await allocatePioraPort();
      await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(port, '127.0.0.1', resolve); });
      const address = this.server.address() as {port:number};
      this.origin = `http://127.0.0.1:${address.port}`;
      this.options.allowOrigin(this.origin);
      handler = this.options.createHandler(this.origin);
    }
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    // This is the explicitly requested GUI, not a background console process.
    const child = spawn(runtime, [join(this.options.root, 'native-mirror.cjs')], {env, stdio:['ignore','ignore','pipe','ipc'], windowsHide:false});
    this.child = child;
    let errors = '';
    child.stderr?.on('data', data => { errors = (errors + data.toString()).slice(-1500); });
    child.on('message', (message: any) => {
      if (message?.type === 'window-state') this.state.nativeWindow = message.value;
      if (message?.type === 'closed' && this.child === child) this.state.open = false;
      if (message?.type === 'command' && ['screenshot','record','reconnect','details'].includes(message.command)) { this.state.command = message.command; this.state.commandId++; }
      if (message?.type === 'pin') this.state.alwaysOnTop = !!message.value;
    });
    child.once('exit', () => { if (this.child === child) { this.child = undefined; if (this.state.presentation === 'floating') this.state.open = false; } });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('悬浮投屏窗口启动超时')), 20000);
        const done = (error?: Error) => { clearTimeout(timer); child.off('message', ready); child.off('error', fail); child.off('exit', exited); error ? reject(error) : resolve(); };
        const ready = (message: any) => { if (message?.type === 'ready') done(); if (message?.type === 'error') done(new Error(message.message)); };
        const fail = (error: Error) => done(error);
        const exited = () => done(new Error(`悬浮投屏启动失败：${errors}`));
        child.on('message', ready); child.once('error', fail); child.once('exit', exited);
        child.send({type:'init', origin:this.origin, token:this.token, dataDir:this.options.dataDir, state:this.state});
      });
    } catch (error) { child.kill(); throw error; }
  }
  async action(action: string, value?: any) {
    if (this.closing) throw new Error('Mirror is stopping');
    switch (action) {
      case 'open':
        if (typeof value !== 'string' || !value || value.length > 256) throw new Error('请选择设备');
        this.state.serial = value; this.state.presentation = 'floating'; this.state.open = true;
        try { await this.launch(); } catch (error) { this.state.open = false; throw error; }
        break;
      case 'close': this.state.open = false; this.child?.send({type:'hide'}); break;
      case 'selectDevice': if (typeof value !== 'string' || value.length > 256) throw new Error('Invalid device'); this.state.serial = value; break;
      case 'setPresentation':
        if (!['sidebar','floating'].includes(value)) throw new Error('Invalid presentation');
        if (value === 'floating') return this.action('open', this.state.serial);
        this.state.presentation = 'sidebar'; this.state.open = true; this.child?.send({type:'hide'}); break;
      case 'setScale': if (!Number.isFinite(value) || value < 40 || value > 200) throw new Error('Invalid scale'); this.state.scale = value; break;
      case 'setAlwaysOnTop': this.state.alwaysOnTop = !!value; break;
      case 'theme':
        if (!value || !['light','dark'].includes(value.mode)) throw new Error('Invalid theme');
        this.state.theme = {mode:value.mode, colors: Object.fromEntries(Object.entries(value.colors || {}).filter(([k,v]) => /^--[a-z-]+$/.test(k) && typeof v === 'string' && v.length < 150).slice(0,20))}; break;
      case 'focus': this.child?.send({type:'focus'}); break;
      case 'showMenu': this.child?.send({type:'menu'}); break;
      case 'reportFrame':
        if (value?.serial === this.state.serial && Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0 && value.width < 10000 && value.height < 10000) {
          this.state.frame = {width:value.width,height:value.height};
          this.child?.send({type:'geometry', width:value.width, height:value.height, chromeHeight:Number.isFinite(value.chromeHeight) ? Math.max(36,Math.min(300,value.chromeHeight)) : 84});
        }
        break;
      default: throw new Error('Unknown mirror action');
    }
    if (this.child?.connected) this.child.send({type:'state', state:this.state});
    return this.state;
  }
  async dispose() {
    this.closing = true;
    await this.starting?.catch(() => {});
    const child = this.child;
    if (child && child.exitCode === null) await new Promise<void>(resolve => {
      const timer = setTimeout(() => {child.kill(); resolve();}, 2500);
      child.once('exit', () => {clearTimeout(timer); resolve();});
      if (child.connected) child.send({type:'quit'}); else child.kill();
    });
    if (this.server) { this.server.closeAllConnections(); await new Promise<void>(resolve => this.server!.close(() => resolve())); }
    if (this.origin) this.options.removeOrigin(this.origin);
  }
}
