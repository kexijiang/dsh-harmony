import { applyHostTheme } from './adapters/theme';
const listeners = new Set<(value: any) => void>();
const commands = new Set<(value: any) => void>();
let current: any;
let lastCommand = 0;
let pending = false;
export const isFloating = new URLSearchParams(location.search).get('surface') === 'mirror';
async function request(action?: string, value?: any) {
  const response = await fetch('/harmony/window', action ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,value})} : undefined);
  if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.error?.message || '无法连接投屏窗口'); }
  const next = await response.json();
  if (isFloating) applyHostTheme(next.theme);
  if (current === undefined) lastCommand = next.commandId;
  if (isFloating && next.commandId > lastCommand) { lastCommand = next.commandId; commands.forEach(fn => fn(next.command)); }
  if (JSON.stringify(next) !== JSON.stringify(current)) {current = next; listeners.forEach(fn => fn(next));}
  return next;
}
export const mirrorBridge = {
  getState: () => request(),
  open: (serial: string) => request('open', serial),
  close: async () => {await request('close'); return true;},
  selectDevice: (serial: string) => request('selectDevice', serial),
  setPresentation: (value: string) => request('setPresentation', value),
  setScale: (value: number) => request('setScale', value),
  setAlwaysOnTop: (value: boolean) => request('setAlwaysOnTop', value),
  reportFrame: (value: any) => request('reportFrame', value),
  showMenu: () => request('showMenu'),
  focus: () => request('focus'),
  openWorkbench: async () => {},
  onStateChange: (fn: any) => {listeners.add(fn); return () => listeners.delete(fn);},
  onCommand: (fn: any) => {commands.add(fn); return () => commands.delete(fn);},
};
let lastTheme = '';
export async function syncWindowTheme(theme: any) {
  const serialized = JSON.stringify(theme);
  if (serialized === lastTheme) return;
  await request('theme', theme);
  lastTheme = serialized;
}
const timer = setInterval(async () => { if (pending || document.visibilityState === 'hidden') return; pending = true; try {await request();} catch {} finally {pending = false;} }, 800);
window.addEventListener('pagehide', () => clearInterval(timer), {once:true});
