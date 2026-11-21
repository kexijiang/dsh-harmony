import { join } from 'node:path';
import {
  applyMirrorBounds,
  MIRROR_TITLE_HEIGHT,
  mirrorBounds,
  mirrorResizeBounds,
  updateMirrorAspectRatio,
} from '@piora/desktop/src/harmony-window-bounds';
import type { MirrorScale } from '@piora/desktop/src/harmony-window-types';

const electron = require('electron') as typeof import('electron');
const { app, BrowserWindow, Menu, clipboard, dialog, nativeImage, nativeTheme, screen, session, shell } = electron;

interface WindowRecordState {
  serial: string;
  scale: MirrorScale;
  alwaysOnTop: boolean;
  open: boolean;
  minimized: boolean;
  presentation: 'floating' | 'sidebar';
  pendingPresentation?: 'floating' | 'sidebar';
  presentationTransition?: string;
  bounds?: { x?: number; y?: number; width?: number; height?: number };
}

interface ManagedWindow {
  serial: string;
  window: import('electron').BrowserWindow;
  ratio: number;
  chromeHeight: number;
  appliedBounds?: Electron.Rectangle;
  placing: boolean;
  pendingPlace: 'preserve' | 'fit' | null;
  pendingPosition?: { x?: number; y?: number; width?: number; height?: number };
  forceClose: boolean;
}

let origin = '';
let token = '';
let ownedSession: Electron.Session | null = null;
let theme: { mode: 'light' | 'dark' } = { mode: 'light' };
let quitting = false;
const windows = new Map<string, ManagedWindow>();
const states = new Map<string, WindowRecordState>();

function send(payload: unknown): void {
  if (typeof process.send === 'function') process.send(payload);
}

function reportBounds(entry: ManagedWindow): void {
  if (entry.window.isDestroyed()) return;
  const bounds = entry.window.getBounds();
  send({
    type: 'window-bounds',
    serial: entry.serial,
    value: {
      visible: entry.window.isVisible(),
      bounds,
      minimized: entry.window.isMinimized(),
      alwaysOnTop: entry.window.isAlwaysOnTop(),
    },
  });
}

async function placeWindow(entry: ManagedWindow, saved?: WindowRecordState['bounds'], preserveWidth = false): Promise<void> {
  if (entry.window.isDestroyed()) return;
  if (entry.placing) {
    entry.pendingPlace = entry.pendingPlace === 'fit' || !preserveWidth ? 'fit' : 'preserve';
    if (saved) entry.pendingPosition = saved;
    return;
  }
  entry.placing = true;
  try {
    const state = states.get(entry.serial);
    const current = entry.window.getBounds();
    const position = saved ?? (preserveWidth ? entry.appliedBounds : undefined) ?? current;
    const display = screen.getDisplayNearestPoint({
      x: position.x ?? current.x,
      y: position.y ?? current.y,
    });
    const ratio = Number.isFinite(entry.ratio) && entry.ratio > 0 ? entry.ratio : 9 / 20;
    const chromeHeight = Math.max(36, Math.min(300, entry.chromeHeight || MIRROR_TITLE_HEIGHT + 2));
    const width = position.width ?? current.width;
    const base = preserveWidth
      ? {
          x: position.x ?? current.x,
          y: position.y ?? current.y,
          width,
          height: Math.round((width - 2) / ratio) + chromeHeight,
        }
      : mirrorBounds(display.workArea, ratio, state?.scale ?? 75, position, chromeHeight);
    if (!preserveWidth && saved?.height && Number.isFinite(saved.height) && saved.height >= 120) {
      base.height = Math.min(Math.max(Math.round(saved.height), chromeHeight + 100), display.workArea.height);
      base.width = Math.min(Math.round((base.height - chromeHeight) * ratio) + 2, display.workArea.width);
    }
    const target: Electron.Rectangle = {
      x: Math.max(display.workArea.x, Math.min(base.x, display.workArea.x + display.workArea.width - base.width)),
      y: Math.max(display.workArea.y, Math.min(base.y, display.workArea.y + display.workArea.height - base.height)),
      width: Math.max(240, base.width),
      height: Math.max(chromeHeight + 100, base.height),
    };
    const next = await updateMirrorAspectRatio(
      {
        getBounds: () => entry.window.getBounds(),
        setBounds: (bounds, animate) => entry.window.setBounds(bounds, animate),
        setAspectRatio: (nextRatio, extra) => entry.window.setAspectRatio(nextRatio, extra),
      },
      ratio,
      chromeHeight,
      target,
    );
    entry.appliedBounds = await applyMirrorBounds(
      {
        getBounds: () => entry.window.getBounds(),
        setBounds: (bounds, animate) => entry.window.setBounds(bounds, animate),
      },
      next,
    );
    reportBounds(entry);
  } finally {
    entry.placing = false;
    const queued = entry.pendingPlace;
    const nextPos = entry.pendingPosition;
    entry.pendingPlace = null;
    entry.pendingPosition = undefined;
    if (queued) {
      await placeWindow(entry, nextPos, queued === 'preserve');
    }
  }
}

function showContextMenu(entry: ManagedWindow): void {
  const state = states.get(entry.serial);
  if (!state || entry.window.isDestroyed()) return;
  Menu.buildFromTemplate([
    { label: '在侧栏显示', click: () => send({ type: 'set-presentation', serial: entry.serial, value: 'sidebar' }) },
    { label: '截图', click: () => send({ type: 'command', serial: entry.serial, command: 'screenshot' }) },
    { label: '录屏', click: () => send({ type: 'command', serial: entry.serial, command: 'record' }) },
    { label: '重连画面', click: () => send({ type: 'command', serial: entry.serial, command: 'reconnect' }) },
    { type: 'separator' },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: !!state.alwaysOnTop,
      click: item => {
        if (!entry.window.isDestroyed()) {
          entry.window.setAlwaysOnTop(item.checked, 'floating');
        }
        send({ type: 'pin', serial: entry.serial, value: item.checked });
      },
    },
    {
      label: '缩放',
      submenu: ([25, 50, 75, 100] as const).map(scale => ({
        label: `${scale}%`,
        type: 'radio' as const,
        checked: state.scale === scale,
        click: () => send({ type: 'scale', serial: entry.serial, value: scale }),
      })),
    },
    { type: 'separator' },
    { label: '关闭投屏', click: () => entry.window.close() },
  ]).popup({ window: entry.window });
}

function ensureSession(): Electron.Session {
  if (ownedSession) return ownedSession;
  ownedSession = session.fromPartition(`dsh-harmony:${Math.random().toString(36).slice(2)}`, { cache: false });
  ownedSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ownedSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'x-harmony-native': token } });
  });
  return ownedSession;
}

function createOrGetWindow(serial: string, options: { show: boolean }): ManagedWindow {
  const existing = windows.get(serial);
  if (existing && !existing.window.isDestroyed()) {
    return existing;
  }
  const state = states.get(serial);
  const cascadeIndex = [...windows.values()].filter(item => !item.window.isDestroyed()).length;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const defaultArea = display.workArea;
  const saved = state?.bounds;
  const initialBounds = mirrorBounds(
    defaultArea,
    9 / 20,
    state?.scale ?? 75,
    saved ?? { x: defaultArea.x + defaultArea.width - 420 - cascadeIndex * 32, y: defaultArea.y + 40 + cascadeIndex * 24 },
    MIRROR_TITLE_HEIGHT + 2,
  );
  const browserWindow = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: 240,
    minHeight: 320,
    frame: false,
    show: options.show,
    title: `鸿蒙投屏 · ${serial}`,
    backgroundColor: theme.mode === 'dark' ? '#17181b' : '#ffffff',
    webPreferences: {
      session: ensureSession(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  const entry: ManagedWindow = {
    serial,
    window: browserWindow,
    ratio: 9 / 20,
    chromeHeight: MIRROR_TITLE_HEIGHT + 2,
    placing: false,
    pendingPlace: null,
    forceClose: false,
  };
  windows.set(serial, entry);

  browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  browserWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(`${origin}/harmony/`)) event.preventDefault();
  });
  browserWindow.on('will-resize', (event, newBounds, details) => {
    event.preventDefault();
    const current = browserWindow.getBounds();
    const edge = (details as { edge?: string })?.edge ?? 'bottom-right';
    const adjusted = mirrorResizeBounds(current, newBounds, entry.ratio, entry.chromeHeight, edge);
    const displayForWin = screen.getDisplayNearestPoint({ x: adjusted.x, y: adjusted.y }).workArea;
    adjusted.x = Math.max(displayForWin.x, Math.min(adjusted.x, displayForWin.x + displayForWin.width - adjusted.width));
    adjusted.y = Math.max(displayForWin.y, Math.min(adjusted.y, displayForWin.y + displayForWin.height - adjusted.height));
    browserWindow.setBounds(adjusted, false);
    entry.appliedBounds = adjusted;
  });
  for (const ev of ['move', 'resize', 'show', 'hide', 'minimize', 'restore', 'always-on-top-changed'] as const) {
    browserWindow.on(ev as any, () => reportBounds(entry));
  }
  browserWindow.on('close', event => {
    if (quitting || entry.forceClose) return;
    event.preventDefault();
    send({ type: 'close-requested', serial: entry.serial });
  });
  browserWindow.on('closed', () => {
    windows.delete(entry.serial);
    send({ type: 'closed', serial: entry.serial });
  });
  void browserWindow.loadURL(`${origin}/harmony/?surface=mirror&serial=${encodeURIComponent(serial)}`);
  return entry;
}

async function handleIpcRequest(id: string, method: string, params: any): Promise<unknown> {
  switch (method) {
    case 'selectDirectory': {
      const parent = [...windows.values()].find(item => !item.window.isDestroyed() && item.window.isVisible())?.window;
      const res = parent
        ? await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      return { path: res.canceled ? null : (res.filePaths[0] ?? null) };
    }
    case 'selectRuntimePath': {
      const parent = [...windows.values()].find(item => !item.window.isDestroyed() && item.window.isVisible())?.window;
      if (params?.kind === 'sdk') {
        const res = parent
          ? await dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] })
          : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
        return { path: res.canceled ? null : (res.filePaths[0] ?? null) };
      }
      const kind = params?.kind === 'python' ? 'python' : 'hdc';
      const filters = process.platform === 'win32'
        ? [{ name: kind === 'hdc' ? 'HDC Executable' : 'Python Executable', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }]
        : [{ name: 'All Files', extensions: ['*'] }];
      const res = parent
        ? await dialog.showOpenDialog(parent, { properties: ['openFile'], filters })
        : await dialog.showOpenDialog({ properties: ['openFile'], filters });
      return { path: res.canceled ? null : (res.filePaths[0] ?? null) };
    }
    case 'clipboardWriteImage': {
      const img = nativeImage.createFromBuffer(Buffer.from(String(params?.base64 || ''), 'base64'));
      if (img.isEmpty()) throw new Error('Invalid screenshot image');
      clipboard.writeImage(img);
      return { ok: true };
    }
    case 'clipboardWriteFile': {
      const target = String(params?.path || '');
      if (process.platform === 'win32') {
        clipboard.writeBuffer('FileNameW', Buffer.from(`${target}\0`, 'utf16le'));
      } else {
        clipboard.writeText(target);
      }
      return { ok: true };
    }
    case 'revealPath': {
      shell.showItemInFolder(String(params?.path || ''));
      return { ok: true };
    }
    case 'openPath': {
      const errorMessage = await shell.openPath(String(params?.path || ''));
      if (errorMessage) throw new Error(errorMessage);
      return { ok: true };
    }
    case 'confirmRecording': {
      const entry = params?.serial ? windows.get(params.serial) : undefined;
      const parent = entry && !entry.window.isDestroyed() ? entry.window : undefined;
      const detail = String(params?.detail || '停止后将保存到媒体库。');
      const title = String(params?.title || '停止录屏并关闭投屏？');
      const buttons = params?.ours ? ['继续录屏', '停止并保存'] : ['取消', '关闭投屏'];
      const options: Electron.MessageBoxOptions = {
        type: 'question',
        title,
        message: title,
        detail,
        buttons,
        defaultId: 1,
        cancelId: 0,
      };
      const result = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      return { confirmed: result.response === 1 };
    }
    default:
      throw new Error(`Unknown desktop IPC method: ${method}`);
  }
}

app.whenReady().then(() => {
  screen.on('display-metrics-changed', () => {
    for (const entry of windows.values()) {
      if (!entry.window.isDestroyed() && entry.window.isVisible()) {
        void placeWindow(entry, undefined, true);
      }
    }
  });
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });

  process.on('message', (message: any) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'init') {
      origin = message.origin;
      token = message.token;
      if (message.dataDir) app.setPath('userData', join(message.dataDir, 'electron'));
      if (message.theme?.mode) {
        theme = message.theme;
        nativeTheme.themeSource = theme.mode;
      }
      send({ type: 'ready' });
      return;
    }
    if (message.type === 'theme' && message.theme?.mode) {
      const changed = theme.mode !== message.theme.mode;
      theme = message.theme;
      if (changed) nativeTheme.themeSource = theme.mode;
      const bg = theme.mode === 'dark' ? '#17181b' : '#ffffff';
      for (const entry of windows.values()) {
        if (!entry.window.isDestroyed()) entry.window.setBackgroundColor(bg);
      }
      return;
    }
    if (message.type === 'state' && message.state?.serial) {
      const next: WindowRecordState = message.state;
      states.set(next.serial, next);
      const entry = windows.get(next.serial);
      if (entry && !entry.window.isDestroyed()) {
        if (entry.window.isAlwaysOnTop() !== !!next.alwaysOnTop) {
          entry.window.setAlwaysOnTop(!!next.alwaysOnTop, 'floating');
        }
      }
      return;
    }
    if (message.type === 'open' && message.serial) {
      if (message.state) states.set(message.serial, message.state);
      const hidden = Boolean(message.hiddenTransition);
      const entry = createOrGetWindow(message.serial, { show: !hidden });
      if (!hidden) {
        if (entry.window.isMinimized()) entry.window.restore();
        entry.window.show();
        entry.window.focus();
      }
      return;
    }
    if (message.type === 'reveal' && message.serial) {
      const entry = windows.get(message.serial);
      if (entry && !entry.window.isDestroyed()) {
        if (Number.isFinite(message.ratio) && message.ratio > 0) entry.ratio = message.ratio;
        if (Number.isFinite(message.chromeHeight) && message.chromeHeight > 0) entry.chromeHeight = message.chromeHeight;
        if (entry.window.isMinimized()) entry.window.restore();
        entry.window.show();
        entry.window.focus();
        void placeWindow(entry, states.get(message.serial)?.bounds, false);
      }
      return;
    }
    if (message.type === 'frame' && message.serial) {
      const entry = windows.get(message.serial);
      if (entry && !entry.window.isDestroyed()) {
        const nextRatio = Number.isFinite(message.ratio) && message.ratio > 0 ? message.ratio : entry.ratio;
        const nextChrome = Number.isFinite(message.chromeHeight) && message.chromeHeight > 0 ? message.chromeHeight : entry.chromeHeight;
        if (Math.abs(nextRatio - entry.ratio) > 0.002 || Math.abs(nextChrome - entry.chromeHeight) > 1) {
          entry.ratio = nextRatio;
          entry.chromeHeight = nextChrome;
          void placeWindow(entry, undefined, true);
        }
      }
      return;
    }
    if (message.type === 'place' && message.serial) {
      const entry = windows.get(message.serial);
      if (entry && !entry.window.isDestroyed()) {
        void placeWindow(entry, message.bounds, Boolean(message.preserveWidth));
      }
      return;
    }
    if (message.type === 'focus' && message.serial) {
      const entry = windows.get(message.serial);
      if (entry && !entry.window.isDestroyed()) {
        if (entry.window.isMinimized()) entry.window.restore();
        entry.window.show();
        entry.window.focus();
      }
      return;
    }
    if (message.type === 'hide' && message.serial) {
      const entry = windows.get(message.serial);
      if (entry && !entry.window.isDestroyed()) entry.window.hide();
      return;
    }
    if (message.type === 'force-close' && message.serial) {
      const entry = windows.get(message.serial);
      if (entry && !entry.window.isDestroyed()) {
        entry.forceClose = true;
        entry.window.close();
      }
      return;
    }
    if (message.type === 'menu' && message.serial) {
      const entry = windows.get(message.serial);
      if (entry) showContextMenu(entry);
      return;
    }
    if (message.type === 'ipc-request' && message.id) {
      void handleIpcRequest(String(message.id), String(message.method), message.params).then(
        result => send({ type: 'ipc-response', id: message.id, ok: true, result }),
        error => send({ type: 'ipc-response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      return;
    }
    if (message.type === 'quit') {
      quitting = true;
      for (const entry of windows.values()) {
        if (!entry.window.isDestroyed()) {
          entry.forceClose = true;
          entry.window.destroy();
        }
      }
      app.quit();
    }
  });
});
