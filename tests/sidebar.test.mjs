import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('client registers a disposable Better Sidebar tab, without a standalone launcher', async () => {
  let factory;
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(entry) { factory = entry.factory; } } },
  });
  const client = factory(createRequire(import.meta.url));
  assert.deepEqual(Array.from(client.inject), ['betterSidebar']);
  const registrations = new Map();
  const effects = [];
  client.apply({
    betterSidebar: { registerTab(tab) {
      assert.equal(registrations.has(tab.id), false);
      registrations.set(tab.id, tab);
      return () => registrations.delete(tab.id);
    } },
    effect(fn) { effects.push(fn()); },
  });
  const tab = registrations.get('harmony-device');
  assert.equal(tab.single, true);
  assert.equal(tab.title, '鸿蒙设备');
  const html = renderToStaticMarkup(React.createElement(tab.component, {visible: true}));
  assert.match(html, /<iframe[^>]+src="\/harmony\/"/);
  assert.doesNotMatch(html, /role="dialog"|<button|position:fixed/);
  effects.forEach(dispose => dispose());
  assert.equal(registrations.size, 0);
});
