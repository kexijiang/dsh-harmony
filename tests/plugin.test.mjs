import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, png } from './harness.mjs';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';

test('compiled plugin: agent operations, HTTP boundary, attachments and cleanup', async t => {
  const h = await harness();
  t.after(() => h.close());
  await t.test('registers a real dsh tool and exposes operation schemas', async () => {
    assert.equal(h.tool.name, 'harmony_control');
    const catalog = JSON.parse((await h.call('help')).content[0].text);
    assert.ok(catalog.operations.length >= 30);
    const help = JSON.parse((await h.call('help', undefined, { topic: 'tap' })).content[0].text);
    assert.ok(help.inputSchema.properties.generation);
  });
  await t.test('validates operation input before device dispatch', async () => {
    await assert.rejects(h.call('tap', { generation: 'old' }), /number/);
    await assert.rejects(h.call('unknown'), /Unknown Harmony/);
    await assert.rejects(h.call('help', undefined, { agent: null }), /owning dsh agent/);
  });
  await t.test('enumerates actual backend devices', async () => {
    assert.match((await h.call('list_devices')).content[0].text, /test-phone/);
    assert.ok(h.calls.includes('list'));
  });
  await t.test('acquires run-scoped lease and converts saved screenshot into dsh image', async () => {
    await h.call('acquire_control', {});
    assert.equal(h.leases.size, 1);
    const result = await h.call('take_screenshot', {});
    assert.equal(result.content[1].type, 'image');
    assert.equal(result.content[1].attachment.attachmentId, 'test-image');
    assert.deepEqual(Buffer.from(h.saved[0].data), png);
    assert.equal(JSON.stringify(result).includes([...h.leases.keys()][0]), false);
  });
  await t.test('serves full workbench and binary frames; public state strips tokens', async () => {
    const panel = await fetch(h.origin + '/harmony/');
    assert.equal(panel.status, 200); assert.match(await panel.text(), /panel.js/);
    assert.match(panel.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    const response = await fetch(h.origin + '/api/harmony/devices');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.state.leases.length, 1);
    assert.equal('token' in data.state.leases[0], false);
    const frame = await fetch(h.origin + '/api/harmony/frame?serial=test-phone');
    assert.deepEqual(Buffer.from(await frame.arrayBuffer()), png);
  });
  await t.test('rejects foreign origin, host, and cross-site requests', async () => {
    for (const headers of [{origin:'https://evil.example'}, {host:'evil.example'}, {'sec-fetch-site':'cross-site'}]) {
      const status = await new Promise((resolve, reject) => { const req = request(h.origin + '/api/harmony/devices', {headers}, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
      assert.equal(status, 403, JSON.stringify(headers));
    }
    assert.equal((await fetch(h.origin + '/api/harmony/no-such-route')).status, 404);
  });
  await t.test('releases control at the dsh turn boundary', async () => {
    await h.emit('agent/turn-stopping', { agent: { id: 'agent-one' } });
    assert.equal(h.leases.size, 0);
    await h.call('acquire_control', {});
    assert.equal(h.leases.size, 1);
  });
  await t.test('cancellation reaches backend and drains owned control', async () => {
    const original = h.manager.listDevices;
    let ready;
    const started = new Promise(resolve => {ready = resolve;});
    h.manager.listDevices = signal => new Promise((_resolve, reject) => {ready(); signal.addEventListener('abort', () => reject(new Error('cancelled')), {once:true});});
    const controller = new AbortController();
    const pending = h.call('list_devices', undefined, {signal:controller.signal});
    await started; controller.abort();
    await assert.rejects(pending, /cancelled/);
    assert.equal(h.leases.size, 0);
    h.manager.listDevices = original;
  });
  await t.test('SQLite worker reads bounded results, refuses writes and enforces run ownership', async () => {
    await mkdir('.verification', {recursive:true});
    const directory = await mkdtemp(resolve('.verification/database-'));
    const path = join(directory,'fixture.db');
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE example (value TEXT); INSERT INTO example VALUES ('fixture-value')"); db.close();
    const opened = await h.call('database',{operation:'open',path});
    const id = JSON.parse(/<database_json>(.*?)<\/database_json>/s.exec(opened.content[0].text)[1]).id;
    assert.match((await h.call('database',{operation:'read',id,table:'example'})).content[0].text,/fixture-value/);
    await assert.rejects(h.call('database',{operation:'read',id,sql:'DELETE FROM example'}), /read-only/);
    await assert.rejects(h.call('database',{operation:'read',id,table:'example'},{agent:{id:'other-agent'}}), /not owned/);
    await h.emit('agent/turn-stopping',{agent:{id:'agent-one'}});
    await assert.rejects(h.call('database',{operation:'read',id,table:'example'}), /not owned/);
  });
  await t.test('local sources outside the configured workspace are rejected', async () => {
    const outside = join(h.dataDir,'outside.db'); await writeFile(outside,Buffer.alloc(128));
    await assert.rejects(h.call('database',{operation:'open',path:outside}), /allowed workspace/);
  });
});

test('real bundled HDC discovery and missing-device failure are observable', async t => {
  const h = await harness({fake:false}); t.after(() => h.close());
  const response = await fetch(h.origin + '/api/harmony/devices');
  assert.equal(response.status, 200);
  const data = await response.json(); assert.ok(Array.isArray(data.devices));
  assert.equal(data.state.runtime.status, 'ready');
  const result = await h.call('list_devices'); assert.equal(result.content[0].type, 'text');
  await assert.rejects(h.call('acquire_control', {serial:'nonexistent-dsh-test-device'}), /DEVICE_NOT_FOUND|DEVICE_OFFLINE/);
});

test('disabling the plugin unregisters both HTTP prefixes before re-enabling', async () => {
  const h = await harness();
  assert.deepEqual(h.routes.map(route => route.path), ['/harmony', '/api/harmony']);
  await h.close();
  assert.equal(h.routes.length, 0);
});

test('real Cordis disposal runs route and device cleanup without a dispose event', async () => {
  const root = new Context(); let owner;
  const fiber = root.plugin({apply(ctx) { owner = ctx; }});
  await fiber.await();
  const h = await harness({owner});
  try {
    await fiber.dispose();
    assert.equal(h.routes.length, 0);
    assert.ok(h.calls.includes('dispose'));
  } finally { await h.close(); }
});

test('cleanup failure still disposes the device manager and restores environment', async () => {
  const previous = process.env.PIORA_WEB_RUNTIME_ROOT;
  const h = await harness();
  globalThis.__pioraHarmonyTransferJobs = {async dispose() {throw new Error('test cleanup failure');}};
  await assert.rejects(h.close(),/cleanup needs attention/);
  assert.ok(h.calls.includes('dispose'));
  assert.equal(process.env.PIORA_WEB_RUNTIME_ROOT,previous);
  assert.equal(globalThis.__pioraHarmonyTransferJobs,undefined);
  h.server.closeAllConnections(); await new Promise(resolve => h.server.close(resolve));
});
