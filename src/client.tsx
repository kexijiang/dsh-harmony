import React, { useEffect, useRef } from 'react';

export const inject = ['betterSidebar'];

/** Better Sidebar owns tab selection, closing and layout. */
function HarmonyTab({ visible = true }: { visible?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const syncVisibility = () => {
    const css = getComputedStyle(document.body);
    const tokens: Record<string, string> = { '--bg':'bg-base', '--bg-panel':'bg-layer-1', '--bg-hover':'interactive-bg-hover', '--bg-selected':'interactive-bg-active', '--border':'border-l2', '--text':'label-primary', '--text-muted':'label-secondary', '--text-dim':'label-tertiary', '--accent':'brand-primary' };
    const colors = Object.fromEntries(Object.entries(tokens).map(([key, token]) => [key, css.getPropertyValue(`--dsw-alias-${token}`).trim()]).filter(([, value]) => value));
    const mode = document.body.hasAttribute('data-ds-dark-theme') || document.documentElement.classList.contains('dark') || css.colorScheme === 'dark' ? 'dark' : 'light';
    frame.current?.contentWindow?.postMessage({ type: 'dsh-harmony-context', active: visible, theme: { mode, colors } }, window.location.origin);
  };
  useEffect(() => {
    syncVisibility();
    const observer = new MutationObserver(syncVisibility);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    const ready = (event: MessageEvent) => { if (event.source === frame.current?.contentWindow && event.origin === window.location.origin && event.data?.type === 'dsh-harmony-ready') syncVisibility(); };
    window.addEventListener('message', ready);
    return () => { observer.disconnect(); window.removeEventListener('message', ready); };
  }, [visible]);
  return <iframe ref={frame} onLoad={syncVisibility} title="鸿蒙设备" src="/harmony/" style={{ display: 'block', width: '100%', height: '100%', minWidth: 0, minHeight: 0, flex: 1, border: 0 }} />;
}

export function apply(ctx: any) {
  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: 'harmony-device',
    title: '鸿蒙设备',
    description: '连接、投屏和操作鸿蒙设备',
    order: 35,
    single: true,
    icon: (size: number) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M10 5h4M10 19h4" /></svg>,
    component: HarmonyTab,
  }));
}
