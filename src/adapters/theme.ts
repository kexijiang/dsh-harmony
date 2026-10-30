import { useSyncExternalStore } from 'react';
const listeners = new Set<() => void>();
export type Theme = 'light' | 'dark';
export type ThemePayload = { mode: Theme; colors?: Record<string, string> };
const allowed = new Set(['--bg','--bg-panel','--bg-hover','--bg-selected','--border','--text','--text-muted','--text-dim','--accent']);
export function applyHostTheme(value: ThemePayload) {
  if (!value || !['light','dark'].includes(value.mode)) return;
  document.documentElement.dataset.theme = value.mode;
  document.documentElement.style.colorScheme = value.mode;
  for (const key of allowed) {
    const color = value.colors?.[key];
    if (color && CSS.supports('color', color)) document.documentElement.style.setProperty(key, color);
    else document.documentElement.style.removeProperty(key);
  }
  listeners.forEach(fn => fn());
}
export const isDarkTheme = (theme: string) => theme === 'dark';
export function useTheme() {
  const theme = useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', () => 'light');
  return { theme, isDark: theme === 'dark', themes: [] };
}
