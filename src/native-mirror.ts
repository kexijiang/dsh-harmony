import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HarmonyWindowState, MirrorScale } from '@piora/desktop/src/harmony-window-types';
import type { HarmonyRecordingState } from '@piora/lib/harmony/types';

export interface MirrorBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface SavedWindowPref {
  scale?: MirrorScale;
  alwaysOnTop?: boolean;
  bounds?: MirrorBounds;
  presentation?: 'floating' | 'sidebar';
}

interface InternalWindowState extends HarmonyWindowState {
  ratio: number;
  chromeHeight: number;
  frame?: { width: number; height: number };
  bounds?: MirrorBounds;
  nativeWindow?: unknown;
}

export interface NativeMirrorOptions {
  root: string;
  dataDir: string;
  electronPath?: string;
  transitionTimeoutMs?: number;
  createHandler: (origin: string) => any;
  allowOrigin: (origin: string) => void;
  removeOrigin: (origin: string) => void;
  getRecordingState?: (serial: string) => HarmonyRecordingState | undefined;
  stopRecording?: (options: { serial: string; ownerId: string; recordingId?: string }) => Promise<unknown>;
}

const VALID_SCALES = new Set<number>([25, 50, 75, 100]);
const VALID_COMMANDS = new Set(['screenshot', 'record', 'reconnect', 'details']);
const isValidScale = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 25 && value <= 200;

export class NativeMirror {
  private windows = new Map<string, InternalWindowState>();
  private prefs = new Map<string, SavedWindowPref>();
  private transitionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingIpc = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private activeSerial = '';
  private defaultOwnerId = randomUUID();
  private theme: { mode: 'light' | 'dark'; colors?: Record<string, string> } = { mode: 'light' };
  private command: string | null = null;
  private commandSerial = '';
  private commandId = 0;

  private child?: ChildProcess;
  private server?: Server;
  private starting?: Promise<void>;
  private closing = false;
  private origin = '';
  private token = randomBytes(32).toString('base64url');
  private readonly prefsPath: string;
  private readonly transitionTimeoutMs: number;

  constructor(private options: NativeMirrorOptions) {
    this.prefsPath = join(options.dataDir, 'harmony-mirror-windows.json');
    this.transitionTimeoutMs = options.transitionTimeoutMs ?? 30_000;
    this.loadPrefs();
  }

  /** Legacy compatibility accessor reflecting the active device state. */
  get state(): any {
    return this.getState();
  }

  private loadPrefs(): void {
    try {
      if (!existsSync(this.prefsPath)) return;
      const raw = JSON.parse(readFileSync(this.prefsPath, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      for (const [serial, pref] of Object.entries(raw as Record<string, SavedWindowPref>)) {
        if (!serial || serial.length > 256 || !pref || typeof pref !== 'object') continue;
        this.prefs.set(serial, pref);
      }
    } catch {
      // Ignore corrupt preference cache; fresh defaults apply per device.
    }
  }

  private savePrefs(): void {
    try {
      mkdirSync(this.options.dataDir, { recursive: true });
      const data: Record<string, SavedWindowPref> = {};
      for (const [serial, pref] of this.prefs) {
        data[serial] = pref;
      }
      const temp = `${this.prefsPath}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
      renameSync(temp, this.prefsPath);
    } catch {
      // Persistence failure should never interrupt live control.
    }
  }

  private validateSerial(serial: unknown): string {
    if (typeof serial !== 'string' || !serial.trim() || serial.length > 256) {
      throw new Error('Invalid device serial');
    }
    return serial.trim();
  }

  private ensureWindow(serial: string): InternalWindowState {
    let existing = this.windows.get(serial);
    if (existing) return existing;
    const saved = this.prefs.get(serial);
    existing = {
      serial,
      scale: VALID_SCALES.has(saved?.scale as number) ? (saved!.scale as MirrorScale) : 75,
      alwaysOnTop: Boolean(saved?.alwaysOnTop),
      open: false,
      minimized: false,
      ownerId: randomUUID(),
      presentation: saved?.presentation === 'sidebar' ? 'sidebar' : 'floating',
      ratio: 9 / 20,
      chromeHeight: 38,
      bounds: saved?.bounds,
    };
    this.windows.set(serial, existing);
    return existing;
  }

  private publicWindowState(serial: string): InternalWindowState {
    const win = this.ensureWindow(serial);
    return { ...win };
  }

  getState(serial?: string): any {
    const targetSerial = (typeof serial === 'string' && serial.trim()) ? serial.trim() : this.activeSerial;
    const win = targetSerial ? this.ensureWindow(targetSerial) : undefined;
    const windowSummary: Record<string, Partial<HarmonyWindowState>> = {};
    for (const [key, item] of this.windows) {
      windowSummary[key] = {
        serial: item.serial,
        open: item.open,
        minimized: item.minimized,
        scale: item.scale,
        alwaysOnTop: item.alwaysOnTop,
        presentation: item.presentation,
        pendingPresentation: item.pendingPresentation,
        presentationTransition: item.presentationTransition,
        presentationFailed: item.presentationFailed,
        ownerId: item.ownerId,
      };
    }
    return {
      serial: win?.serial ?? '',
      scale: win?.scale ?? 75,
      alwaysOnTop: win?.alwaysOnTop ?? false,
      open: win?.open ?? false,
      minimized: win?.minimized ?? false,
      ownerId: win?.ownerId ?? this.defaultOwnerId,
      presentation: win?.presentation ?? 'sidebar',
      pendingPresentation: win?.pendingPresentation,
      presentationTransition: win?.presentationTransition,
      presentationFailed: win?.presentationFailed,
      theme: this.theme,
      frame: win?.frame ?? null,
      nativeWindow: win?.nativeWindow ?? null,
      command: this.command && (!targetSerial || this.commandSerial === targetSerial) ? this.command : null,
      commandSerial: this.commandSerial,
      commandId: this.commandId,
      windows: windowSummary,
    };
  }

  findElectronRuntime(): string | undefined {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh');
    const candidates = [
      this.options.electronPath,
      process.env.DSH_HARMONY_ELECTRON_PATH,
      process.platform === 'win32'
        ? join(home, 'electron/electron.exe')
        : process.platform === 'darwin'
          ? join(home, 'electron/Electron.app/Contents/MacOS/Electron')
          : join(home, 'electron/electron'),
    ];
    return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
  }

  canInvokeDesktop(): boolean {
    return Boolean(this.child?.connected || this.findElectronRuntime());
  }

  async invokeDesktop(method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<any> {
    await this.ensureChildStarted();
    const child = this.child;
    if (!child?.connected) throw new Error('Desktop helper process is unavailable');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingIpc.delete(id);
        reject(new Error(`Desktop IPC request timed out: ${method}`));
      }, timeoutMs);
      this.pendingIpc.set(id, { resolve, reject, timer });
      child.send({ type: 'ipc-request', id, method, params });
    });
  }

  private async ensureChildStarted(): Promise<void> {
    if (this.closing) throw new Error('Mirror is stopping');
    if (this.starting) {
      await this.starting;
      return;
    }
    if (this.child?.connected) return;
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async launch(serial: string, options: { hiddenTransition?: boolean; transition?: string } = {}): Promise<void> {
    await this.ensureChildStarted();
    this.child?.send({
      type: 'open',
      serial,
      state: this.publicWindowState(serial),
      hiddenTransition: Boolean(options.hiddenTransition),
      transition: options.transition,
    });
  }

  private async start(): Promise<void> {
    const runtime = this.findElectronRuntime();
    if (!runtime) {
      throw new Error('Floating mirror requires Electron runtime. Set DSH_HARMONY_ELECTRON_PATH or disable mirror windowing.');
    }
    if (!this.server) {
      let handler: any;
      this.server = createServer((req, res) => {
        const supplied = Buffer.from(String(req.headers['x-harmony-native'] || ''));
        const expected = Buffer.from(this.token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        handler(req, res);
      });
      await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
      const address = this.server.address();
      if (!address || typeof address === 'string') throw new Error('Could not bind mirror bridge');
      this.origin = `http://127.0.0.1:${address.port}`;
      this.options.allowOrigin(this.origin);
      handler = this.options.createHandler(this.origin);
    }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    const child = spawn(runtime, [join(this.options.root, 'native-mirror.cjs')], {
      env,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: false,
    });
    this.child = child;
    let errors = '';
    child.stderr?.on('data', data => {
      errors = (errors + data.toString()).slice(-1500);
    });
    child.on('message', (message: any) => this.handleChildMessage(child, message));
    child.once('exit', () => {
      if (this.child !== child) return;
      this.child = undefined;
      for (const [id, pending] of this.pendingIpc) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Mirror process exited'));
        this.pendingIpc.delete(id);
      }
      for (const [serial, win] of this.windows) {
        if (win.presentation === 'floating' || win.pendingPresentation === 'floating') {
          this.cancelTransition(serial, win.pendingPresentation === 'floating');
          if (win.presentation === 'floating') win.open = false;
        }
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => done(new Error('Mirror window startup timed out')), 10_000);
        const done = (error?: Error) => {
          clearTimeout(timer);
          child.off('message', ready);
          child.off('error', fail);
          child.off('exit', exited);
          if (error) reject(error);
          else resolve();
        };
        const ready = (msg: any) => {
          if (msg?.type === 'ready') done();
          if (msg?.type === 'error') done(new Error(msg.message));
        };
        const fail = (error: Error) => done(error);
        const exited = (code: number | null) => done(new Error(errors.trim() || `Mirror window exited (${code})`));
        child.on('message', ready);
        child.once('error', fail);
        child.once('exit', exited);
        child.send({
          type: 'init',
          origin: this.origin,
          token: this.token,
          dataDir: this.options.dataDir,
          theme: this.theme,
        });
      });
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  private handleChildMessage(child: ChildProcess, message: any): void {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ipc-response' && message.id) {
      const pending = this.pendingIpc.get(String(message.id));
      if (!pending) return;
      this.pendingIpc.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(String(message.error || 'Desktop operation failed')));
      return;
    }
    const serial = typeof message.serial === 'string' ? message.serial : '';
    if (!serial) return;
    const win = this.ensureWindow(serial);
    if (message.type === 'window-bounds' && message.value) {
      win.nativeWindow = message.value;
      win.bounds = message.value.bounds ?? win.bounds;
      win.minimized = Boolean(message.value.minimized);
      win.alwaysOnTop = Boolean(message.value.alwaysOnTop);
      this.updateSavedPref(serial, win);
      return;
    }
    if (message.type === 'closed' && this.child === child) {
      this.cancelTransition(serial, false);
      if (win.presentation === 'floating') win.open = false;
      this.savePrefs();
      return;
    }
    if (message.type === 'close-requested' && this.child === child) {
      void this.handleNativeCloseRequested(serial);
      return;
    }
    if (message.type === 'set-presentation' && ['sidebar', 'floating'].includes(message.value)) {
      void this.action('setPresentation', message.value, { serial }).catch(() => undefined);
      return;
    }
    if (message.type === 'scale' && VALID_SCALES.has(message.value)) {
      void this.action('setScale', message.value, { serial }).catch(() => undefined);
      return;
    }
    if (message.type === 'command' && VALID_COMMANDS.has(message.command)) {
      this.command = message.command;
      this.commandSerial = serial;
      this.commandId++;
      return;
    }
    if (message.type === 'pin') {
      win.alwaysOnTop = Boolean(message.value);
      this.updateSavedPref(serial, win);
      this.savePrefs();
    }
  }

  private async handleNativeCloseRequested(serial: string): Promise<void> {
    const win = this.ensureWindow(serial);
    const recording = this.options.getRecordingState?.(serial);
    if (recording && this.child?.connected) {
      const ours = recording.ownerId === win.ownerId;
      const answer = await this.invokeDesktop('confirmRecording', {
        serial,
        ours,
        title: ours ? '停止录屏并关闭投屏？' : '录屏任务仍在运行',
        detail: ours ? '停止后将保存到媒体库；保存成功后关闭窗口。' : '其他任务的录屏将继续运行，确定关闭投屏窗口？',
      }).catch(() => ({ confirmed: false }));
      if (!answer?.confirmed) return;
      if (ours && this.options.stopRecording) {
        await this.options.stopRecording({
          serial,
          ownerId: win.ownerId,
          recordingId: recording.recordingId,
        }).catch(() => undefined);
      }
    }
    this.cancelTransition(serial, false);
    win.open = false;
    this.updateSavedPref(serial, win);
    this.savePrefs();
    this.child?.send({ type: 'force-close', serial });
  }

  private updateSavedPref(serial: string, win: InternalWindowState): void {
    this.prefs.set(serial, {
      scale: win.scale,
      alwaysOnTop: win.alwaysOnTop,
      bounds: win.bounds,
      presentation: win.presentation,
    });
  }

  private cancelTransition(serial: string, failed: boolean): void {
    const timer = this.transitionTimers.get(serial);
    if (timer) {
      clearTimeout(timer);
      this.transitionTimers.delete(serial);
    }
    const win = this.windows.get(serial);
    if (!win) return;
    const wasPendingFloating = win.pendingPresentation === 'floating';
    win.pendingPresentation = undefined;
    win.presentationTransition = undefined;
    win.presentationFailed = failed ? true : undefined;
    if (failed && wasPendingFloating) {
      this.child?.send({ type: 'hide', serial });
    }
  }

  async action(action: string, value?: any, extra: { serial?: string; confirm?: boolean } = {}): Promise<any> {
    if (this.closing) throw new Error('Mirror is stopping');
    const explicitSerial = typeof extra.serial === 'string' && extra.serial.trim()
      ? extra.serial.trim()
      : (typeof value === 'object' && value && typeof value.serial === 'string' && value.serial.trim())
        ? value.serial.trim()
        : undefined;

    switch (action) {
      case 'open': {
        const target = this.validateSerial(typeof value === 'string' && value.trim() ? value : (explicitSerial || this.activeSerial));
        this.activeSerial = target;
        const win = this.ensureWindow(target);
        this.cancelTransition(target, false);
        win.presentation = 'floating';
        win.open = true;
        this.updateSavedPref(target, win);
        this.savePrefs();
        await this.launch(target, { hiddenTransition: false });
        return this.getState(target);
      }
      case 'close': {
        const target = explicitSerial || this.activeSerial;
        if (!target) return this.getState();
        const win = this.ensureWindow(target);
        const recording = this.options.getRecordingState?.(target);
        if (recording && !extra.confirm) {
          const ours = recording.ownerId === win.ownerId;
          if (win.presentation === 'floating' && this.child?.connected) {
            const answer = await this.invokeDesktop('confirmRecording', {
              serial: target,
              ours,
              title: ours ? '停止录屏并关闭投屏？' : '录屏任务仍在运行',
              detail: ours ? '停止后将保存到媒体库；保存成功后关闭投屏。' : '其他任务的录屏将继续运行，是否关闭投屏？',
            }).catch(() => ({ confirmed: false }));
            if (!answer?.confirmed) return { ...this.getState(target), cancelled: true };
          } else {
            return {
              ...this.getState(target),
              confirmRecording: { recording, ours },
            };
          }
        }
        if (recording && recording.ownerId === win.ownerId && this.options.stopRecording) {
          await this.options.stopRecording({
            serial: target,
            ownerId: win.ownerId,
            recordingId: recording.recordingId,
          });
        }
        this.cancelTransition(target, false);
        win.open = false;
        this.updateSavedPref(target, win);
        this.savePrefs();
        this.child?.send({ type: 'hide', serial: target });
        return this.getState(target);
      }
      case 'selectDevice': {
        const nextSerial = this.validateSerial(value);
        const prevSerial = this.activeSerial;
        const prevWin = prevSerial ? this.windows.get(prevSerial) : undefined;
        this.activeSerial = nextSerial;
        const nextWin = this.ensureWindow(nextSerial);
        if (prevWin?.open && prevWin.presentation === 'sidebar' && prevSerial !== nextSerial) {
          this.cancelTransition(prevSerial, false);
          prevWin.open = false;
          nextWin.open = true;
          nextWin.presentation = 'sidebar';
          this.updateSavedPref(prevSerial, prevWin);
          this.updateSavedPref(nextSerial, nextWin);
          this.savePrefs();
        }
        return this.getState(nextSerial);
      }
      case 'setPresentation': {
        if (!['sidebar', 'floating'].includes(value)) throw new Error('Invalid presentation');
        const target = explicitSerial || this.activeSerial;
        if (!target) {
          this.defaultOwnerId = this.defaultOwnerId || randomUUID();
          return { ...this.getState(), presentation: value };
        }
        const win = this.ensureWindow(target);
        if (!win.open) {
          if (value === 'floating') return this.action('open', target, { serial: target });
          this.cancelTransition(target, false);
          win.presentation = 'sidebar';
          win.open = true;
          this.updateSavedPref(target, win);
          this.savePrefs();
          this.child?.send({ type: 'hide', serial: target });
          return this.getState(target);
        }
        if (win.presentation === value && !win.pendingPresentation) {
          return this.getState(target);
        }
        const transition = randomUUID();
        this.cancelTransition(target, false);
        win.pendingPresentation = value;
        win.presentationTransition = transition;
        win.presentationFailed = false;
        const timer = setTimeout(() => {
          this.cancelTransition(target, true);
        }, this.transitionTimeoutMs);
        this.transitionTimers.set(target, timer);
        if (value === 'floating') {
          await this.launch(target, { hiddenTransition: true, transition });
        }
        return this.getState(target);
      }
      case 'setScale': {
        if (!isValidScale(value)) throw new Error('Invalid scale');
        const target = explicitSerial || this.activeSerial;
        if (!target) return this.getState();
        const win = this.ensureWindow(target);
        win.scale = value as MirrorScale;
        win.bounds = undefined;
        this.updateSavedPref(target, win);
        this.savePrefs();
        if (this.child?.connected) {
          this.child.send({ type: 'state', state: this.publicWindowState(target) });
          this.child.send({ type: 'place', serial: target, preserveWidth: false });
        }
        return this.getState(target);
      }
      case 'setAlwaysOnTop': {
        const target = explicitSerial || this.activeSerial;
        if (!target) return this.getState();
        const win = this.ensureWindow(target);
        win.alwaysOnTop = Boolean(value);
        this.updateSavedPref(target, win);
        this.savePrefs();
        if (this.child?.connected) {
          this.child.send({ type: 'state', state: this.publicWindowState(target) });
        }
        return this.getState(target);
      }
      case 'theme': {
        if (!value || !['light', 'dark'].includes(value.mode)) throw new Error('Invalid theme');
        this.theme = {
          mode: value.mode,
          colors: Object.fromEntries(
            Object.entries(value.colors || {})
              .filter(([k, v]) => /^--[a-z-]+$/.test(k) && typeof v === 'string' && v.length < 150)
              .slice(0, 30),
          ),
        };
        if (this.child?.connected) this.child.send({ type: 'theme', theme: this.theme });
        return this.getState(explicitSerial);
      }
      case 'focus': {
        const target = explicitSerial || this.activeSerial;
        if (target && this.child?.connected) this.child.send({ type: 'focus', serial: target });
        return this.getState(target);
      }
      case 'showMenu': {
        const target = explicitSerial || this.activeSerial;
        if (target && this.child?.connected) this.child.send({ type: 'menu', serial: target });
        return this.getState(target);
      }
      case 'reportFrame': {
        const serial = typeof value?.serial === 'string' ? value.serial.trim() : '';
        if (!serial) return this.getState();
        const win = this.ensureWindow(serial);
        if (
          Number.isFinite(value.width)
          && Number.isFinite(value.height)
          && value.width > 0
          && value.height > 0
          && value.width < 10_000
          && value.height < 10_000
        ) {
          const ratio = value.width / value.height;
          const chromeHeight = Number.isFinite(value.chromeHeight)
            ? Math.max(36, Math.min(300, Math.round(value.chromeHeight)))
            : win.chromeHeight;
          win.frame = { width: Math.round(value.width), height: Math.round(value.height) };
          win.ratio = ratio;
          win.chromeHeight = chromeHeight;
          if (
            win.pendingPresentation
            && win.presentationTransition
            && value.presentation === win.pendingPresentation
            && value.transition === win.presentationTransition
          ) {
            const targetPresentation = win.pendingPresentation;
            this.cancelTransition(serial, false);
            win.presentation = targetPresentation;
            win.open = true;
            this.updateSavedPref(serial, win);
            this.savePrefs();
            if (targetPresentation === 'sidebar') {
              this.child?.send({ type: 'hide', serial });
            } else {
              this.child?.send({ type: 'reveal', serial, ratio, chromeHeight });
            }
          } else if (!win.pendingPresentation && win.presentation === 'floating' && win.open && this.child?.connected) {
            this.child.send({ type: 'frame', serial, ratio, chromeHeight });
          }
        }
        return this.getState(serial);
      }
      default:
        throw new Error('Unknown mirror action');
    }
  }

  async dispose(): Promise<void> {
    this.closing = true;
    for (const timer of this.transitionTimers.values()) clearTimeout(timer);
    this.transitionTimers.clear();
    for (const pending of this.pendingIpc.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Mirror disposed'));
    }
    this.pendingIpc.clear();
    const child = this.child;
    if (child && child.exitCode === null) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 2500);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        if (child.connected) child.send({ type: 'quit' });
        else child.kill();
      });
    }
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise<void>(resolve => this.server!.close(() => resolve()));
    }
    if (this.origin) this.options.removeOrigin(this.origin);
  }
}
