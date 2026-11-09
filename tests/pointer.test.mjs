import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './harness.mjs';

test('bundled pointer route forwards phases and rejects malformed or foreign input', async t => {
  const h = await harness();
  t.after(() => h.close());
  const calls = [], gestureId = 'a'.repeat(32);
  h.manager.beginManualPointer = async value => { calls.push(value); return { gestureId }; };
  h.manager.updateManualPointer = async value => { calls.push(value); };
  const send = (body, headers = {}) => fetch(h.origin + '/api/harmony/pointer', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const base = { serial: 'test-phone', leaseToken: 'fixture-lease', geometryId: 'frame-1', generation: 1, x: 30, y: 40 };
  const down = await send({ ...base, phase: 'down' });
  assert.equal(down.status, 200);
  assert.equal((await down.json()).gestureId, gestureId);
  assert.equal((await send({ ...base, gestureId, phase: 'move', x: 50 })).status, 200);
  assert.deepEqual(await (await send({ ...base, gestureId, phase: 'up' })).json(), { released: true });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].coordinateSpace, 'frame');
  assert.equal(calls[1].x, 50);
  assert.equal(calls[2].phase, 'up');
  assert.equal((await send({ ...base, phase: 'down', x: -1 })).status, 400);
  assert.equal((await send({ ...base, phase: 'up', gestureId: 'bad' })).status, 400);
  assert.equal((await send({ ...base, phase: 'down' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal(calls.length, 3);
});
