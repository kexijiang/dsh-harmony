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

test('client forwards session context and safely writes drafts only when composer phase is plain', async () => {
  let factory;
  const postedToIframe = [];
  const winListeners = new Map();
  const docListeners = new Map();
  let draftState = { draft: 'existing', phase: 'plain' };
  let writtenDraft = '';
  let focused = 0;

  const iframeWindow = {
    postMessage(payload, targetOrigin) {
      postedToIframe.push({ payload, targetOrigin });
    },
  };

  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }

  const fakeWindow = {
    location: { origin: 'http://127.0.0.1:30141' },
    addEventListener(type, fn) {
      const set = winListeners.get(type) ?? new Set();
      set.add(fn);
      winListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
  };
  const fakeDoc = {
    hidden: false,
    documentElement: {},
    body: { hasAttribute: () => false },
    documentElementClasses: { contains: () => false },
    addEventListener(type, fn) {
      const set = docListeners.get(type) ?? new Set();
      set.add(fn);
      docListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    },
  };
  fakeDoc.documentElement.classList = { contains: () => false };

  let mountedCleanups = [];
  const reactStub = {
    useRef(initial) {
      return { current: initial === null ? { contentWindow: iframeWindow } : initial };
    },
    useEffect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') mountedCleanups.push(cleanup);
    },
  };
  const jsxStub = (type, props) => ({ type, props });

  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window: {
      ...fakeWindow,
      __ModuleLoader__: { load(entry) { factory = entry.factory; } },
    },
    document: fakeDoc,
    getComputedStyle: () => ({ colorScheme: 'light', getPropertyValue: () => '' }),
    MutationObserver: FakeMutationObserver,
  });
  const baseRequire = createRequire(import.meta.url);
  const customRequire = id => {
    if (id === 'react') return reactStub;
    if (id === 'react/jsx-runtime') return { jsx: jsxStub, jsxs: jsxStub, Fragment: 'Fragment' };
    return baseRequire(id);
  };
  const client = factory(customRequire);

  let tab;
  const effects = [];
  client.apply({
    betterSidebar: { registerTab(t) { tab = t; return () => {}; } },
    effect(fn) { effects.push(fn()); },
    locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} },
    sessions: {
      list: { getSnapshot: () => ({ byId: { 's-1': { id: 's-1', displayTitle: 'Demo', cwd: 'F:\\Work' } } }), subscribe: () => () => {} },
      scope(id) { return { scopeSessionId: id }; },
    },
    get(name) {
      if (name !== 'conversation') return undefined;
      return {
        input: {
          for(actx) {
            assert.equal(actx.scopeSessionId, 's-1');
            return {
              state: { getSnapshot: () => draftState },
              setDraft(text) { writtenDraft = text; },
              focus() { focused++; },
            };
          },
        },
      };
    },
  });

  tab.component({ active: true, scope: { sessionId: 's-1', cwd: 'F:\\Work' } });
  assert.ok(postedToIframe.some(m =>
    m.targetOrigin === 'http://127.0.0.1:30141'
    && m.payload.type === 'dsh-harmony-context'
    && m.payload.sessionId === 's-1'
    && m.payload.locale === 'zh-CN'
    && m.payload.sessions.length === 1,
  ));

  const listeners = [...(winListeners.get('message') ?? [])];
  // Foreign origin is ignored.
  for (const fn of listeners) {
    fn({ origin: 'http://evil.example', source: iframeWindow, data: { type: 'dsh-harmony-draft', id: '0', sessionId: 's-1', prompt: 'x' } });
  }
  assert.equal(writtenDraft, '');

  // Plain phase appends cleanly and acknowledges.
  for (const fn of listeners) {
    fn({ origin: 'http://127.0.0.1:30141', source: iframeWindow, data: { type: 'dsh-harmony-draft', id: '1', sessionId: 's-1', prompt: 'analyze crash' } });
  }
  assert.equal(writtenDraft, 'existing\n\nanalyze crash');
  assert.equal(focused, 1);
  assert.ok(postedToIframe.some(m => m.payload.type === 'dsh-harmony-draft-ack' && m.payload.id === '1' && m.payload.ok === true));

  // Non-plain phase rejects without overwriting draft.
  draftState = { draft: 'claimed-draft', phase: 'claimed' };
  for (const fn of listeners) {
    fn({ origin: 'http://127.0.0.1:30141', source: iframeWindow, data: { type: 'dsh-harmony-draft', id: '2', sessionId: 's-1', prompt: 'overwrite' } });
  }
  assert.equal(writtenDraft, 'existing\n\nanalyze crash');
  assert.ok(postedToIframe.some(m => m.payload.type === 'dsh-harmony-draft-ack' && m.payload.id === '2' && m.payload.ok === false && m.payload.reason === 'input-busy'));

  mountedCleanups.forEach(fn => fn());
  effects.forEach(fn => fn());
});
