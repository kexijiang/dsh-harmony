import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from '../tests/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const asset = name => join(root, 'assets', name);

const h = await harness();
h.manager.subscribe = () => () => {};
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 820, height: 900 }, locale: 'zh-CN' });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/api/harmony/config', r => r.fulfill({
  json: {
    config: { hdcPath: 'C:\\HarmonySDK\\hdc.exe' },
    storage: { screenshotDirectory: 'C:\\Screenshots', recordingDirectory: 'C:\\Recordings' },
    diagnostics: {},
    candidates: [],
  },
}));
await page.route('**/api/harmony/apps*', r => r.fulfill({
  json: { applications: [] },
}));
await page.route('**/api/harmony/logs?*', r => r.fulfill({
  json: { processes: [] },
}));
await page.route('**/api/harmony/logs/events*', r => r.fulfill({
  status: 200,
  contentType: 'text/event-stream; charset=utf-8',
  body: 'event: connected\ndata: {}\n\n',
}));

try {
  await page.goto(h.origin + '/harmony/');
  await page.getByRole('button', { name: '打开投屏', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab').count(), 0, 'Piora shows no legacy tool tabs on device page');
  assert.equal(await page.getByRole('heading', { name: '设备投屏', exact: true }).count(), 0, 'No old landing screen');

  const picker = page.getByRole('combobox', { name: '选择设备', exact: true });
  await picker.click();
  await page.getByRole('option').first().waitFor();
  await page.keyboard.press('Escape');

  for (const width of [820, 480]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }

  await page.setViewportSize({ width: 820, height: 900 });
  await page.getByRole('button', { name: '设备设置', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: '设备设置', exact: true });
  await settings.waitFor();
  await page.getByRole('textbox', { name: 'HDC 路径', exact: true }).waitFor();
  await settings.locator('[data-settings-id="harmony.screenshots"] input').waitFor();
  await settings.locator('[data-settings-id="harmony.recordings"] input').waitFor();
  assert.equal(await page.getByText('手动 Wi-Fi 连接', { exact: true }).isVisible().catch(() => false), false);
  assert.equal(await page.getByText('允许修改保存路径', { exact: true }).isVisible().catch(() => false), false);
  assert.notEqual(await settings.evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: asset('settings-light.png') });

  await page.mouse.click(2, 2);
  await settings.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '设备设置', exact: true }).last().click();
  await settings.waitFor();
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'hidden' });

  // Switch to Log Workbench and verify Realtime + Session Log views.
  await page.getByRole('button', { name: '日志工作台', exact: true }).click();
  await page.getByRole('tab', { name: '实时日志', exact: true }).waitFor();
  await page.getByRole('tab', { name: '会话日志', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('最近使用', { exact: true }).waitFor({ state: 'hidden' }).catch(() => undefined);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: asset('log-workbench-light.png') });

  // Return to Device view for panel screenshots.
  await page.getByRole('button', { name: '设备', exact: true }).click();
  await page.getByRole('button', { name: '打开投屏', exact: true }).waitFor();
  await page.screenshot({ path: asset('panel-light.png') });

  await page.evaluate(() => window.postMessage({ type: 'dsh-harmony-context', theme: { mode: 'dark' }, active: true }, location.origin));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: asset('panel-dark.png') });

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('piora:message', {
    detail: {
      message: {
        title: '连接详情',
        message: '投屏连接详情：文字和按钮应清晰可读。',
        tone: 'info',
        actions: [{ id: 'done', label: '确定', primary: true }],
      },
      resolve: () => {},
    },
  })));
  const dialog = page.getByRole('dialog', { name: '连接详情', exact: true });
  await dialog.waitFor();
  assert.notEqual(await dialog.evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: asset('details-dark.png') });
  assert.deepEqual(errors, []);
  console.log('Piora parity: compact toolbar, picker, responsive layout, storage settings, log workbench, dark theme and opaque details passed.');
} catch (e) {
  console.error(await page.locator('body').innerText());
  throw e;
} finally {
  await browser.close();
  await h.close();
}
