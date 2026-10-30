import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { harness } from '../tests/harness.mjs';
const originArg = process.argv.find(arg => arg.startsWith('http'));
const h = originArg ? null : await harness({fake:false});
const origin = originArg || h.origin;
await mkdir('.verification', {recursive:true});
const browser = await chromium.launch({channel:'msedge', headless:true});
const page = await browser.newPage({viewport:{width:420,height:900},locale:'zh-CN'});
const errors = [], failures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {if (response.status() >= 400) failures.push({url:response.url(),status:response.status()});});
try {
  await page.goto(origin + '/harmony/');
  await page.getByRole('heading', {name:'设备投屏',exact:true}).waitFor();
  await page.locator('summary').click();
  await page.getByRole('button', {name:/刷新/}).first().waitFor({timeout:10000});
  await page.getByRole('button', {name:/刷新/}).first().click();
  await page.getByRole('button', {name:'设备设置',exact:true}).first().click();
  await page.getByRole('textbox', {name:'HDC 路径',exact:true}).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Workbench overflows the sidebar width');
  await page.screenshot({path:'.verification/harmony-panel.png',fullPage:true});
  console.log((await page.locator('body').innerText()).slice(0,3000));
  const report = {origin, errors, failures};
  await writeFile('.verification/ui.json', JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if (errors.length || failures.length) process.exitCode = 1;
} catch (error) {
  console.log('UI failure:', String(error), 'Errors:', errors, 'HTTP:', failures);
  console.log((await page.locator('body').innerText()).slice(0,3000));
  await page.screenshot({path:'.verification/harmony-panel-failed.png',fullPage:true});
  process.exitCode = 1;
} finally {await browser.close(); await h?.close();}
