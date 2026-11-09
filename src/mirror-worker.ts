import { MirrorVideoEngine } from '@piora/lib/harmony/mirror/video-engine';
import type { MirrorWorkerCommand, MirrorWorkerEvent } from '@piora/lib/harmony/mirror/messages';

/** DSH's dsh-app protocol cannot load module Workers and its CSP forbids blob
 * Workers. Use the same native WebCodecs engine in the authenticated renderer;
 * decoding still runs in Chromium's codec threads. No CSP or auth is relaxed. */
export function createMirrorWorker(): Worker {
  let engine: MirrorVideoEngine | undefined;
  const bridge = {
    onmessage: null as null | ((event: MessageEvent<MirrorWorkerEvent>) => void),
    onerror: null as null | ((event: ErrorEvent) => void),
    postMessage(data: MirrorWorkerCommand) {
      if (data.type === 'start') {
        engine?.stop();
        try {
          engine = new MirrorVideoEngine(data.canvas, data.serial, data.generation,
            event => queueMicrotask(() => bridge.onmessage?.({ data:event } as MessageEvent<MirrorWorkerEvent>)));
          engine.start();
        } catch(error) { queueMicrotask(()=>bridge.onmessage?.({data:{type:'state',state:'error',error:String(error)}} as MessageEvent<MirrorWorkerEvent>)); }
      } else if(data.type === 'stop') {engine?.stop();engine=undefined;}
      else if(data.type === 'reconnect') engine?.reconnect();
    },
    terminate() {engine?.stop();engine=undefined;bridge.onmessage=null;},
  };
  return bridge as unknown as Worker;
}
