import { chromium } from "playwright-core";
import sharp from "sharp";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { harness } from "../tests/harness.mjs";
const h = await harness();
h.manager.subscribe = () => () => {};
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 820, height: 900 },
  locale: "zh-CN",
});
const errors = [],
  writes = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.method() === "POST" && r.url().includes("/api/harmony/"))
    writes.push(r.url());
});
const png = await sharp(
  Buffer.from(
    '<svg width="200" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="400" fill="#f4f5f7"/><rect x="10" y="60" width="180" height="50" rx="8" fill="white"/><text x="25" y="90" fill="#333" font-size="16">Wi-Fi</text></svg>',
  ),
)
  .png()
  .toBuffer();
const geometry = {
  frameWidth: 200,
  frameHeight: 400,
  rotation: 0,
  crop: { left: 0, top: 0, width: 200, height: 400 },
};
const nodes = [
  {
    ref: "root",
    type: "Column",
    bounds: { left: 0, top: 0, right: 200, bottom: 400 },
  },
  {
    ref: "wifi",
    type: "Row",
    parentRef: "root",
    bounds: { left: 10, top: 60, right: 190, bottom: 110 },
    clickable: true,
  },
  {
    ref: "label",
    type: "Text",
    text: "Wi-Fi",
    parentRef: "wifi",
    bounds: { left: 20, top: 70, right: 90, bottom: 100 },
  },
];
const item = (path, kind = "directory") => ({
  path,
  name: path.split("/").at(-1),
  kind,
  mode: "755",
  size: 4096,
  modifiedAt: 1793404800000,
});
await page.route("**/api/harmony/config", (r) =>
  r.fulfill({
    json: { config: {}, storage: {}, diagnostics: {}, candidates: [] },
  }),
);
await page.route("**/api/harmony/tree?*", (r) =>
  r.fulfill({
    json: {
      snapshot: {
        nodes,
        geometry,
        capturedAt: new Date().toISOString(),
        quality: { treeStatus: "valid", scopeComplete: true },
        screenshot: {
          width: 200,
          height: 400,
          dataUrl: "data:image/png;base64," + png.toString("base64"),
        },
      },
    },
  }),
);
await page.route("**/api/harmony/files?*", (r) => {
  const path = new URL(r.request().url()).searchParams.get("path");
  return path === "/system"
    ? r.fulfill({
        status: 403,
        json: { error: "Device directory is inaccessible" },
      })
    : r.fulfill({
        json: {
          files:
            path === "/"
              ? ["/data", "/mnt", "/storage", "/system"].map((p) => item(p))
              : path === "/data"
                ? [item("/data/local")]
                : path === "/data/local"
                  ? [item("/data/local/tmp")]
                  : path === "/data/local/tmp"
                    ? [item("/data/local/tmp/example.txt", "file")]
                    : [],
          truncated: false,
        },
      });
});
await page.route("**/api/harmony/files/text?*", (r) =>
  r.fulfill({ json: { result: { text: "Example file preview" } } }),
);
await mkdir(".verification", { recursive: true });
try {
  await page.goto(h.origin + "/harmony/");
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  for (const p of ["/data", "/data/local", "/data/local/tmp"])
    await page
      .getByRole("button", { name: "展开或折叠 " + p, exact: true })
      .click();
  const row = page.getByRole("row").filter({ hasText: "example.txt" });
  await row.waitFor();
  assert.match(await row.innerText(), /rwxr-xr-x/);
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "预览", exact: true }).click();
  await page.getByText("Example file preview", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭文件操作", exact: true }).click();
  await page
    .getByRole("button", { name: "展开或折叠 /system", exact: true })
    .click();
  await page.getByRole("alert").filter({ hasText: "inaccessible" }).waitFor();
  await page
    .getByRole("button", { name: "展开或折叠 /system", exact: true })
    .click();
  await page.screenshot({ path: "assets/files-light.png" });
  await page.getByRole("button", { name: "更多 ▾", exact: true }).click();
  await page.getByRole("button", { name: "界面结构", exact: true }).click();
  await page.getByRole("button", { name: "获取当前界面", exact: true }).click();
  const svg = page.locator('svg[aria-label="在快照中选择组件"]');
  await svg.waitFor();
  let rect = await svg.boundingBox();
  await svg.click({ position: { x: rect.width * 0.25, y: rect.height * 0.2 } });
  const properties = page.getByRole("region", {
    name: "组件属性",
    exact: true,
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-node-ref="label"]')
        ?.getAttribute("aria-selected") === "true",
  );
  assert.match(await properties.innerText(), /Wi-Fi/);
  await page.getByRole("button", { name: "选择父组件", exact: true }).click();
  assert.equal(
    await page.locator('[data-node-ref="wifi"]').getAttribute("aria-selected"),
    "true",
  );
  await page
    .getByRole("textbox", { name: "搜索组件", exact: true })
    .fill("Wi-Fi");
  assert.equal(await page.getByRole("treeitem").count(), 3);
  await page.screenshot({ path: "assets/inspector-light.png" });
  await page.evaluate(() =>
    window.postMessage(
      { type: "dsh-harmony-context", theme: { mode: "dark" }, active: true },
      location.origin,
    ),
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page.screenshot({ path: "assets/inspector-dark.png" });
  await page.setViewportSize({ width: 400, height: 820 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  rect = await svg.boundingBox();
  assert.ok(Math.abs(rect.width / rect.height - 0.5) < 0.01);
  await page.getByRole("button", { name: "刷新快照", exact: true }).click();
  await page.getByText("点击画面或组件树中的元素", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  for (const name of ["应用", "数据库", "日志", "终端", "自动化", "语音验证"])
    assert.equal(await page.getByRole("tab", { name, exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  await writeFile(
    ".verification/inspector-ui.json",
    JSON.stringify(
      {
        treeSelection: true,
        pointSelection: true,
        parentSelection: true,
        refreshResetsSelection: true,
        fileExpansion: true,
        preview: true,
        permissionError: true,
        themeSync: true,
        narrowLayout: true,
        noPhoneMutations: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Inspector + file explorer: selection, preview, permissions, themes, responsive layout passed.",
  );
} catch (e) {
  await page.screenshot({ path: ".verification/inspector-failure.png" });
  console.error(await page.locator("body").innerText());
  throw e;
} finally {
  await browser.close();
  await h.close();
}
