import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SafeHarmonyPanel } from '@piora/components/workspace/HarmonyPanel';
import { I18nProvider, useI18n, type Locale } from '@piora/hooks/useI18n';
import './panel.css';
import { mirrorBridge, isFloating, syncWindowTheme } from './window-bridge';
import { applyHostTheme } from './adapters/theme';
import { MirrorWindow } from '@piora/components/workspace/harmony/MirrorWindow';
import { PioraMessageHost, showPioraMessage } from '@piora/components/PioraMessage';

async function callDesktopBridge(action: string, value?: unknown): Promise<any> {
  const response = await fetch('/harmony/desktop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, value }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new Error(err?.error?.message || `Desktop action failed: ${action}`);
  }
  return response.json();
}

(window as any).piDesktop = {
  platform: typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
    ? 'darwin'
    : typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux')
      ? 'linux'
      : 'win32',
  harmonyMirror: mirrorBridge,
  revealPath: async (path: string) => Boolean((await callDesktopBridge('revealPath', path))?.ok),
  openPath: async (path: string) => Boolean((await callDesktopBridge('openPath', path))?.ok),
  selectDirectory: async () => (await callDesktopBridge('selectDirectory'))?.path ?? null,
  selectHarmonyRuntimePath: async (kind: 'sdk' | 'hdc' | 'python') => (await callDesktopBridge('selectHarmonyRuntimePath', kind))?.path ?? null,
  clipboard: {
    copyHarmonyMedia: async (value: { kind: 'screenshot' | 'recording'; path: string }) => {
      await callDesktopBridge('copyHarmonyMedia', value);
    },
  },
};

const floatingSerial = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('serial')?.trim() || ''
  : '';

function LocaleSync({ hostLocale }: { hostLocale?: Locale }) {
  const { locale, setLocale } = useI18n();
  useEffect(() => {
    if (hostLocale && hostLocale !== locale) {
      setLocale(hostLocale);
    }
  }, [hostLocale, locale, setLocale]);
  return null;
}

function Workbench({ initialCwd }: { initialCwd: string }) {
  const [active, setActive] = useState(isFloating || typeof document === 'undefined' ? true : !document.hidden);
  const [sessionId, setSessionId] = useState<string>('');
  const [cwd, setCwd] = useState<string>(initialCwd);
  const [hostLocale, setHostLocale] = useState<Locale | undefined>(undefined);
  const lastSessionsJson = useRef('');
  const pendingDrafts = useRef(new Map<string, (result: { ok: boolean; reason?: string }) => void>());

  useEffect(() => {
    const syncVisibility = () => {
      if (isFloating || document.hidden) setActive(!document.hidden);
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'dsh-harmony-draft-ack' && typeof data.id === 'string') {
        const resolver = pendingDrafts.current.get(data.id);
        if (resolver) {
          pendingDrafts.current.delete(data.id);
          resolver({ ok: Boolean(data.ok), reason: typeof data.reason === 'string' ? data.reason : undefined });
        }
        return;
      }
      if (data.type !== 'dsh-harmony-context') return;
      setActive(Boolean(data.active) && !document.hidden);
      if (data.theme) {
        applyHostTheme(data.theme);
        void syncWindowTheme(data.theme).catch(console.error);
      }
      if (typeof data.sessionId === 'string') {
        setSessionId(data.sessionId);
      }
      if (typeof data.cwd === 'string' && data.cwd) {
        setCwd(data.cwd);
      }
      if (data.locale === 'zh-CN' || data.locale === 'en') {
        setHostLocale(data.locale);
      }
      if (Array.isArray(data.sessions) || (typeof data.sessionId === 'string' && data.sessionId)) {
        const payload = {
          sessions: Array.isArray(data.sessions) ? data.sessions : undefined,
          activeSession: typeof data.sessionId === 'string' && data.sessionId
            ? { id: data.sessionId, ...(typeof data.cwd === 'string' && data.cwd ? { cwd: data.cwd } : {}) }
            : undefined,
        };
        const serialized = JSON.stringify(payload);
        if (serialized !== lastSessionsJson.current) {
          lastSessionsJson.current = serialized;
          void fetch('/harmony/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: serialized,
          }).catch(() => {
            lastSessionsJson.current = '';
          });
        }
      }
    };
    window.addEventListener('message', receive);
    document.addEventListener('visibilitychange', syncVisibility);
    if (!isFloating) window.parent.postMessage({ type: 'dsh-harmony-ready' }, window.location.origin);
    return () => {
      window.removeEventListener('message', receive);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);

  const handleGuideAgent = useCallback((prompt?: string) => {
    const text = typeof prompt === 'string' ? prompt.trim() : '';
    if (!text) return;
    if (window.parent && window.parent !== window) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const resultPromise = new Promise<{ ok: boolean; reason?: string }>(resolve => {
        const timer = setTimeout(() => {
          pendingDrafts.current.delete(id);
          resolve({ ok: false, reason: 'timeout' });
        }, 1500);
        pendingDrafts.current.set(id, outcome => {
          clearTimeout(timer);
          resolve(outcome);
        });
      });
      window.parent.postMessage({ type: 'dsh-harmony-draft', id, sessionId, prompt: text }, window.location.origin);
      void resultPromise.then(async outcome => {
        if (outcome.ok) return;
        await navigator.clipboard?.writeText(text).catch(() => undefined);
        const chinese = (hostLocale ?? document.documentElement.lang) !== 'en';
        await showPioraMessage({
          title: chinese ? '已复制到剪贴板' : 'Copied prompt to clipboard',
          message: outcome.reason === 'input-busy'
            ? (chinese ? '当前会话输入框正忙，未能覆盖草稿，已为你复制日志分析提示词。' : 'Composer is busy; copied the prompt to the clipboard instead.')
            : (chinese ? '未能直接写入会话输入框，已为你复制日志分析提示词到剪贴板。' : 'Could not access the active session composer; copied the prompt to the clipboard.'),
          tone: 'info',
          presentation: 'notice',
          durationMs: 3600,
          actions: [{ id: 'ok', label: chinese ? '确定' : 'OK', primary: true }],
        });
      });
      return;
    }
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }, [hostLocale, sessionId]);

  return (
    <I18nProvider>
      <LocaleSync hostLocale={hostLocale} />
      {isFloating ? (
        <>
          <MirrorWindow active={active} serial={floatingSerial || undefined} />
          <PioraMessageHost />
        </>
      ) : (
        <SafeHarmonyPanel
          active={active}
          maximized
          cwd={cwd}
          sessionId={sessionId || undefined}
          onGuideAgent={handleGuideAgent}
        />
      )}
    </I18nProvider>
  );
}

fetch('/harmony/context')
  .then(r => r.json())
  .then(({ cwd }) => {
    createRoot(document.getElementById('root')!).render(<Workbench initialCwd={cwd || ''} />);
  })
  .catch(error => {
    document.getElementById('root')!.textContent = String(error);
  });
