import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { harness } from '../tests/harness.mjs';
const h = await harness();
h.manager.listDevices = async () => [];
h.manager.subscribe = () => () => {};
h.manager.getState = () => ({runtime:{status:'ready',hdcPath:'C:\\HarmonySDK\\hdc.exe'},devices:[],leases:[],controls:[],snapshots:[]});
const browser = await chromium.launch({channel:'msedge', headless:true});
const page = await browser.newPage({viewport:{width:480,height:820},locale:'zh-CN'});
const errors = [], failures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {if (response.status() >= 400) failures.push(response.url());});
await mkdir('assets', {recursive:true});
await mkdir('.verification', {recursive:true});
// Public screenshots use fixture data only, never the user's phone or filesystem paths.
await page.route('**/api/harmony/config', route => route.fulfill({json:{config:{hdcPath:'C:\\HarmonySDK\\hdc.exe'}, storage:{screenshotDirectory:'C:\\Harmony\\Screenshots',recordingDirectory:'C:\\Harmony\\Recordings'},diagnostics:{},candidates:[]}}));
try {
  await page.goto(h.origin + '/harmony/');
  await page.getByRole('tab',{name:'投屏',exact:true}).waitFor();
  await page.getByRole('heading',{name:'设备投屏',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'连接一台鸿蒙设备',exact:true}).count(),0);
  await page.screenshot({path:'assets/panel-light.png'});
  await page.getByRole('tab',{name:'设备信息',exact:true}).click();
  await page.getByRole('heading',{name:'连接一台鸿蒙设备',exact:true}).waitFor();
  await page.getByRole('button',{name:'设备设置',exact:true}).last().click();
  await page.getByRole('textbox',{name:'HDC 路径',exact:true}).waitFor();
  assert.notEqual(await page.locator('.harmony-settings-sheet').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  await page.screenshot({path:'assets/settings-light.png'});
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.getByRole('tab',{name:'投屏',exact:true}).click();
  await page.evaluate(() => window.postMessage({type:'dsh-harmony-context',theme:{mode:'dark'},active:true},location.origin));
  await page.waitForFunction(()=>document.documentElement.dataset.theme === 'dark');
  await page.screenshot({path:'assets/panel-dark.png'});
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('piora:message',{detail:{message:{title:'连接详情',message:'窗口采用 DSH 当前主题。\n详情不会与投屏画面混在一起。',tone:'info',actions:[{id:'done',label:'确定',primary:true}]},resolve:()=>{}}})));
  const dialog = page.getByRole('dialog',{name:'连接详情',exact:true});
  await dialog.waitFor();
  assert.notEqual(await dialog.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  await page.screenshot({path:'assets/details-dark.png'});
  assert.deepEqual(errors,[]); assert.deepEqual(failures,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
  await writeFile('.verification/redesign.json',JSON.stringify({errors,failures,light:true,dark:true,opaqueDialogs:true,settingsDrawer:true,separateDeviceInfo:true},null,2));
  console.log('Redesign: light/dark, opaque dialogs, settings drawer and separate pages passed.');
} catch (error) {
  await page.screenshot({path:'.verification/redesign-failure.png'});
  console.error(JSON.stringify({errors,failures,text:await page.locator('body').innerText()}));
  throw error;
} finally {await browser.close();await h.close();}
