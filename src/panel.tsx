import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SafeHarmonyPanel } from '@piora/components/workspace/HarmonyPanel';
import { I18nProvider } from '@piora/hooks/useI18n';
import './panel.css';
import { mirrorBridge, isFloating, syncWindowTheme } from './window-bridge';
import { applyHostTheme } from './adapters/theme';
import { MirrorWindow } from '@piora/components/workspace/harmony/MirrorWindow';
import { PioraMessageHost } from '@piora/components/PioraMessage';
(window as any).piDesktop = { platform: 'win32', harmonyMirror: mirrorBridge };
function Workbench({ cwd }: { cwd: string }) {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const visibility = () => { if (isFloating) setActive(!document.hidden); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.type !== 'dsh-harmony-context') return;
      if (typeof event.data.active === 'boolean') setActive(event.data.active);
      applyHostTheme(event.data.theme);
      void syncWindowTheme(event.data.theme).catch(console.error);
    };
    window.addEventListener('message', receive);
    document.addEventListener('visibilitychange', visibility);
    if (!isFloating) window.parent.postMessage({type:'dsh-harmony-ready'}, window.location.origin);
    return () => { window.removeEventListener('message', receive); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return <I18nProvider>{isFloating ? <><MirrorWindow active={active} /><PioraMessageHost /></> : <SafeHarmonyPanel active={active} maximized cwd={cwd} />}</I18nProvider>;
}
fetch('/harmony/context').then(r => { if (!r.ok) throw new Error('无法读取插件配置'); return r.json(); }).then(({ cwd }) => {
  createRoot(document.getElementById('root')!).render(<Workbench cwd={cwd} />);
}).catch(error => { document.getElementById('root')!.textContent = String(error); });
