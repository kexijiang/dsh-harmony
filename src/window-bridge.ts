import { showPioraMessage } from '@piora/components/PioraMessage';
import { applyHostTheme } from './adapters/theme';

const listeners = new Set<(value: any) => void>();
const commandListeners = new Set<(command: string) => void>();
const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const isFloating = query.get('surface') === 'mirror';
const floatingSerial = query.get('serial')?.trim() || '';

let current: any;
let selectedSidebarSerial = '';
let lastCommandId = 0;

function activeSerial(): string {
  return isFloating ? floatingSerial : (selectedSidebarSerial || current?.serial || '');
}

async function request(action?: string, value?: any, extra: { serial?: string; confirm?: boolean } = {}) {
  const serial = extra.serial ?? activeSerial();
  const targetUrl = !action && serial ? `/harmony/window?serial=${encodeURIComponent(serial)}` : '/harmony/window';
  const response = await fetch(
    targetUrl,
    action
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            value,
            ...(serial ? { serial } : {}),
            ...(extra.confirm ? { confirm: true } : {}),
          }),
        }
      : undefined,
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || '无法连接投屏窗口');
  }
  const next = await response.json();
  if (isFloating && next.theme) applyHostTheme(next.theme);
  if (current === undefined) lastCommandId = next.commandId ?? 0;
  current = next;
  listeners.forEach(listener => listener(next));
  if (next.command && next.commandId > lastCommandId) {
    lastCommandId = next.commandId;
    if (!floatingSerial || !next.commandSerial || next.commandSerial === floatingSerial) {
      commandListeners.forEach(listener => listener(next.command));
    }
  }
  return next;
}

export const mirrorBridge = {
  getState: () => request(),
  open: (serial: string) => {
    if (!isFloating) selectedSidebarSerial = serial;
    return request('open', serial, { serial });
  },
  close: async () => {
    const res = await request('close');
    if (res?.confirmRecording) {
      const { recording, ours } = res.confirmRecording;
      const answer = await showPioraMessage({
        title: ours ? '停止录屏并关闭投屏？' : '录屏任务仍在运行',
        message: ours
          ? '停止后将保存到媒体库；保存成功后关闭投屏。'
          : `其他任务正在录制 ${recording?.serial || ''}，确定关闭投屏？`,
        tone: 'confirm',
        actions: ours
          ? [{ id: 'cancel', label: '继续录屏' }, { id: 'confirm', label: '停止并保存', primary: true }]
          : [{ id: 'cancel', label: '取消' }, { id: 'confirm', label: '关闭投屏', primary: true }],
      });
      if (answer !== 'confirm') return false;
      const confirmed = await request('close', undefined, { confirm: true });
      return !confirmed?.cancelled;
    }
    return !res?.cancelled;
  },
  selectDevice: (serial: string) => {
    if (!isFloating) selectedSidebarSerial = serial;
    return request('selectDevice', serial, { serial });
  },
  setPresentation: (value: string) => request('setPresentation', value),
  setScale: (value: number) => request('setScale', value),
  setAlwaysOnTop: (value: boolean) => request('setAlwaysOnTop', value),
  reportFrame: (value: any) => request('reportFrame', value, { serial: value?.serial }),
  showMenu: () => request('showMenu'),
  openWorkbench: async () => {
    await request('setPresentation', 'sidebar');
  },
  focus: () => request('focus'),
  onStateChange(listener: (value: any) => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  onCommand(listener: (command: string) => void) {
    commandListeners.add(listener);
    const timer = setInterval(() => { void request().catch(() => undefined); }, 400);
    return () => {
      commandListeners.delete(listener);
      clearInterval(timer);
    };
  },
};

let lastTheme = '';
export async function syncWindowTheme(theme: any) {
  const serialized = JSON.stringify(theme);
  if (serialized === lastTheme) return;
  await request('theme', theme);
  lastTheme = serialized;
}
