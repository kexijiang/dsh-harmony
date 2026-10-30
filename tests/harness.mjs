import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { apply } from '../dist/index.js';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=', 'base64');
export async function harness({ fake = true, host = '127.0.0.1', owner } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-harmony-test-'));
  const routes = [], events = new Map(), saved = [], calls = [];
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const route = routes.find(route => pathname === route.path || pathname.startsWith(route.path + '/'));
    if (!route) { res.writeHead(404); res.end(); return; }
    void route.handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const devices = [{ serial: 'test-phone', name: '测试鸿蒙设备', state: 'online', generation: 1, capabilities: { screenshot: true, uiTree: true, touch: true } }];
  const leases = new Map();
  const manager = {
    async listDevices(signal) { calls.push('list'); signal?.throwIfAborted(); return devices; },
    getState: () => ({ runtime: { status: 'ready', hdcPath: 'fixture-hdc' }, devices, leases: [...leases.values()], controls: [], snapshots: [] }),
    getConfig: () => ({}), getRecordingState: () => undefined,
    async acquireLease(options) { calls.push('acquire'); const lease = { token: randomUUID(), serial: options.serial, owner: options.owner, expiresAt: new Date(Date.now()+300000).toISOString() }; leases.set(lease.token, lease); return lease; },
    renewLease(token) { if (!leases.has(token)) throw new Error('Lease expired'); return leases.get(token); },
    releaseLease(token) { leases.delete(token); },
    releaseOwner(id) { calls.push('release'); for (const [token, lease] of leases) if (lease.owner.id === id) leases.delete(token); },
    async captureScreenshotArtifact({signal}) { signal?.throwIfAborted(); const path = join(dataDir, 'screen.png'); await writeFile(path, png); return {kind:'screenshot', serial: 'test-phone', path, filename:'screen.png', mimeType:'image/png', size:png.length}; },
    async captureLiveFrame() { return { screenshot: { data: png, mimeType:'image/png' }, generation:1, revision:1 }; },
    async dispose() { calls.push('dispose'); leases.clear(); },
  };
  if (fake) globalThis.__pioraHarmonyDeviceManager = manager;
  let tool;
  const ctx = {
    effect(setup) { if (owner) return owner.effect(setup); const dispose = setup(); ctx.on('dispose', dispose); },
    tools: { register(value) { tool = value; } },
    attachments: { async saveImage(image) { saved.push(image); return { attachmentId: 'test-image', mediaType: image.mediaType, bytes: image.data.length, width: 1, height: 1 }; } },
    on(event, fn) { const values = events.get(event) ?? []; values.push(fn); events.set(event, values); },
    inject(_services, fn) { fn({
      effect: setup => ctx.effect(setup),
      on: (event, fn) => ctx.on(event, fn),
      webServer: { host, port, register(route) {
        if (routes.some(item => item.path === route.path)) throw new Error('Duplicate route');
        routes.push(route);
        return () => { routes.splice(routes.indexOf(route), 1); };
      } },
    }); },
  };
  try { apply(ctx, { cwd: process.cwd(), dataDir }); }
  catch (error) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); throw error; }
  async function emit(event, ...args) { for (const fn of events.get(event) ?? []) await fn(...args); }
  return {
    server, tool, manager, leases, calls, saved, dataDir, routes, origin:`http://127.0.0.1:${port}`,
    call(operation, input, { agent = { id: 'agent-one' }, signal = new AbortController().signal, topic } = {}) { return tool.execute({ operation, ...(input === undefined ? {} : {input}), ...(topic ? {topic} : {}) }, { agent, signal, callId: randomUUID() }); },
    emit,
    async close() { await emit('dispose'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
