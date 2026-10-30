import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
// Optional integration check for an authenticated test profile with Better Sidebar.
const origin = process.argv[2];
if (!origin) throw new Error('Pass the authenticated URL of a disposable DSH test profile with Better Sidebar enabled.');
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin);
  await page.getByRole('button',{name:'打开右侧边栏',exact:true}).click();
  await page.getByRole('button',{name:'鸿蒙设备',exact:true}).click();
  const panel = page.frameLocator('iframe[title="鸿蒙设备"]');
  await panel.getByRole('tab',{name:'设备信息',exact:true}).click();
  await panel.getByRole('button',{name:'设备设置',exact:true}).last().click();
  await panel.getByRole('textbox',{name:'HDC 路径',exact:true}).waitFor();
  if (await page.getByRole('dialog',{name:'鸿蒙设备工作台',exact:true}).count()) throw new Error('Unexpected standalone dialog');
  await page.screenshot({path:'.verification/dsh-better-sidebar.png',fullPage:true});
  await writeFile('.verification/dsh-ui.json',JSON.stringify({errors,checks:['Better Sidebar tab','device settings','no standalone dialog']},null,2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
