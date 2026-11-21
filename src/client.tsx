import { useEffect, useRef } from 'react';

export const inject = ['betterSidebar'];
const tokens = {
  '--bg': 'bg-base',
  '--bg-panel': 'bg-surface',
  '--bg-hover': 'bg-subtle',
  '--bg-selected': 'bg-active',
  '--border': 'border-subtle',
  '--text': 'text-primary',
  '--text-muted': 'text-secondary',
  '--text-dim': 'text-tertiary',
  '--accent': 'text-accent',
};

interface SessionScopeProp {
  sessionId?: string;
  cwd?: string;
  repoRoot?: string;
}

function normalizeHostLocale(value: unknown): 'zh-CN' | 'en' | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.trim().toLowerCase();
  if (!lower) return undefined;
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('zh')) return 'zh-CN';
  return undefined;
}

function snapshotSessions(ctx: any): Array<{ id: string; name: string; title: string; cwd?: string }> {
  const byId = ctx?.sessions?.list?.getSnapshot?.()?.byId;
  if (!byId || typeof byId !== 'object') return [];
  const items: Array<{ id: string; name: string; title: string; cwd?: string }> = [];
  for (const entry of Object.values(byId) as any[]) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    const title = String(entry.displayTitle || entry.title || entry.name || entry.id);
    items.push({
      id: entry.id,
      name: title,
      title,
      ...(typeof entry.cwd === 'string' && entry.cwd ? { cwd: entry.cwd } : {}),
    });
    if (items.length >= 2000) break;
  }
  return items;
}

export function apply(ctx: any) {
  function HarmonyTab({ active, scope }: { active: boolean; scope?: SessionScopeProp }) {
    const frame = useRef<HTMLIFrameElement>(null);
    const activeRef = useRef(active);
    const scopeRef = useRef(scope);
    activeRef.current = active;
    scopeRef.current = scope;

    const postContext = () => {
      const target = frame.current?.contentWindow;
      if (!target) return;
      const visible = activeRef.current && typeof document !== 'undefined' && !document.hidden;
      const css = getComputedStyle(document.documentElement);
      const colors = Object.fromEntries(
        Object.entries(tokens)
          .map(([key, token]) => [key, css.getPropertyValue(`--dsw-alias-${token}`).trim()])
          .filter(([, value]) => value),
      );
      const mode = document.body.hasAttribute('data-ds-dark-theme')
        || document.documentElement.classList.contains('dark')
        || css.colorScheme === 'dark'
        ? 'dark'
        : 'light';
      const currentScope = scopeRef.current;
      const sessionId = typeof currentScope?.sessionId === 'string' ? currentScope.sessionId : '';
      const cwd = typeof currentScope?.cwd === 'string' && currentScope.cwd
        ? currentScope.cwd
        : (typeof currentScope?.repoRoot === 'string' ? currentScope.repoRoot : '');
      const locale = normalizeHostLocale(ctx?.locale?.getSnapshot?.()?.active);
      const sessions = snapshotSessions(ctx);
      target.postMessage(
        {
          type: 'dsh-harmony-context',
          active: visible,
          theme: { mode, colors },
          sessionId,
          cwd,
          ...(locale ? { locale } : {}),
          sessions,
        },
        window.location.origin,
      );
    };

    useEffect(() => {
      postContext();
      const observer = new MutationObserver(postContext);
      observer.observe(document.documentElement, { attributes: true });
      observer.observe(document.body, { attributes: true });
      const unsubscribeLocale = typeof ctx?.locale?.subscribe === 'function' ? ctx.locale.subscribe(postContext) : undefined;
      const unsubscribeSessions = typeof ctx?.sessions?.list?.subscribe === 'function' ? ctx.sessions.list.subscribe(postContext) : undefined;

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'dsh-harmony-ready') {
          postContext();
          return;
        }
        if (data.type === 'dsh-harmony-draft') {
          const id = data.id;
          const prompt = typeof data.prompt === 'string' ? data.prompt : '';
          const requestedSessionId = typeof data.sessionId === 'string' && data.sessionId.trim()
            ? data.sessionId.trim()
            : scopeRef.current?.sessionId?.trim();
          const ack = (ok: boolean, reason?: string) => {
            frame.current?.contentWindow?.postMessage(
              { type: 'dsh-harmony-draft-ack', id, ok, ...(reason ? { reason } : {}) },
              window.location.origin,
            );
          };
          if (!prompt.trim() || !requestedSessionId) {
            ack(false, 'no-session');
            return;
          }
          try {
            const actx = ctx?.sessions?.scope?.(requestedSessionId);
            const input = actx ? ctx?.get?.('conversation')?.input?.for?.(actx) : undefined;
            if (!input || typeof input.setDraft !== 'function') {
              ack(false, 'input-unavailable');
              return;
            }
            const snap = input.state?.getSnapshot?.();
            if (snap?.phase && snap.phase !== 'plain') {
              ack(false, 'input-busy');
              return;
            }
            const current = typeof snap?.draft === 'string' ? snap.draft : '';
            const nextDraft = current.trim() ? `${current.trimEnd()}\n\n${prompt}` : prompt;
            input.setDraft(nextDraft);
            input.focus?.();
            ack(true);
          } catch (error) {
            ack(false, error instanceof Error ? error.message : String(error));
          }
        }
      };

      document.addEventListener('visibilitychange', postContext);
      window.addEventListener('message', onMessage);
      return () => {
        observer.disconnect();
        if (typeof unsubscribeLocale === 'function') unsubscribeLocale();
        if (typeof unsubscribeSessions === 'function') unsubscribeSessions();
        document.removeEventListener('visibilitychange', postContext);
        window.removeEventListener('message', onMessage);
      };
    }, [active, scope?.sessionId, scope?.cwd, scope?.repoRoot]);

    return (
      <iframe
        ref={frame}
        onLoad={postContext}
        title="鸿蒙设备"
        src="/harmony/"
        style={{ display: 'block', width: '100%', height: '100%', minWidth: 0, minHeight: 0, flex: 1, border: 0 }}
      />
    );
  }

  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: 'harmony-device',
    title: '鸿蒙设备',
    description: '连接、投屏、分析日志和操作鸿蒙设备',
    single: true,
    icon: (size: number) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="6" y="2" width="12" height="20" rx="2.5" />
        <path d="M10 5h4M10 19h4" />
      </svg>
    ),
    component: HarmonyTab,
  }));
}
