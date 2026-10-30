import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { harness, png } from "./harness.mjs";
const compiled = await build({
  entryPoints: ["vendor/piora/components/workspace/harmony/inspector-model.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { frameBounds, hitNodes, nodeAncestors } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
const geometry = {
  frameWidth: 200,
  frameHeight: 400,
  rotation: 0,
  crop: { left: 0, top: 0, width: 1000, height: 2000 },
};
const nodes = [
  { ref: "root", bounds: { left: 0, top: 0, right: 1000, bottom: 2000 } },
  {
    ref: "button",
    parentRef: "root",
    bounds: { left: 100, top: 200, right: 900, bottom: 400 },
  },
  {
    ref: "text",
    parentRef: "button",
    bounds: { left: 300, top: 250, right: 600, bottom: 350 },
  },
  {
    ref: "hidden",
    parentRef: "text",
    visible: false,
    bounds: { left: 300, top: 250, right: 600, bottom: 350 },
  },
];
test("inspector picks deepest visible component and preserves overlapping parents", () => {
  assert.deepEqual(
    hitNodes(nodes, geometry, 80, 60).map((n) => n.ref),
    ["text", "button", "root"],
  );
  assert.deepEqual(hitNodes(nodes, geometry, 200, 400), []);
  assert.deepEqual(hitNodes(nodes, undefined, 80, 60), []);
});
test("inspector projects rotated/cropped native bounds and rejects empty geometry", () => {
  assert.deepEqual(frameBounds(nodes[1], geometry), {
    left: 20,
    top: 40,
    right: 180,
    bottom: 80,
  });
  assert.deepEqual(
    frameBounds(nodes[1], {
      ...geometry,
      frameWidth: 400,
      frameHeight: 200,
      rotation: 90,
    }),
    { left: 320, top: 20, right: 360, bottom: 180 },
  );
  assert.equal(
    frameBounds(
      { bounds: { left: -100, top: 0, right: -1, bottom: 20 } },
      geometry,
    ),
    null,
  );
  assert.equal(
    frameBounds(nodes[1], {
      ...geometry,
      crop: { left: 0, top: 0, width: 0, height: 10 },
    }),
    null,
  );
  const cycle = [
    { ref: "a", parentRef: "b" },
    { ref: "b", parentRef: "a" },
  ];
  assert.deepEqual(
    nodeAncestors(cycle[0], new Map(cycle.map((n) => [n.ref, n]))).map(
      (n) => n.ref,
    ),
    ["b"],
  );
});
test("tree API includes screenshot and geometry only when requested", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  let requested;
  h.manager.snapshot = async (input) => {
    requested = input;
    return {
      serial: "test-phone",
      generation: 1,
      revision: 2,
      nodes,
      quality: { treeStatus: "valid", scopeComplete: true },
      screenshot: { data: png, mimeType: "image/png", width: 1, height: 1 },
    };
  };
  const snapshotGeometry = {...geometry, deviceEpoch:1, frameWidth:1, frameHeight:1};
  h.manager.getFrameGeometry = async () => snapshotGeometry;
  const basic = await fetch(
    h.origin + "/api/harmony/tree?serial=test-phone",
  ).then((r) => r.json());
  assert.equal(requested.includeScreenshot, false);
  assert.equal(basic.snapshot.screenshot, undefined);
  const full = await fetch(
    h.origin + "/api/harmony/tree?serial=test-phone&includeScreenshot=1",
  ).then((r) => r.json());
  assert.equal(requested.includeScreenshot, true);
  assert.equal(
    full.snapshot.screenshot.dataUrl,
    "data:image/png;base64," + png.toString("base64"),
  );
  assert.deepEqual(full.snapshot.geometry, snapshotGeometry);
  h.manager.getFrameGeometry = async () => ({...snapshotGeometry, deviceEpoch:2});
  const stale = await fetch(h.origin + "/api/harmony/tree?serial=test-phone&includeScreenshot=1").then(r=>r.json());
  assert.equal(stale.snapshot.geometry, undefined);
  assert.equal(full.snapshot.quality.treeStatus, "valid");
});

const fileModule=await build({entryPoints:['vendor/piora/lib/harmony/device-files.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {parseDeviceFileListing}=await import('data:text/javascript;base64,'+Buffer.from(fileModule.outputFiles[0].text).toString('base64'));
test('root directory listing normalizes paths while preserving real metadata',()=>{
 const result=parseDeviceFileListing(Buffer.from('__PIORA_DIR_OK__\x1e//data\x1fdirectory|4096|1793404800|755\x1e'),'/');
 assert.deepEqual(result.files,[{path:'/data',name:'data',kind:'directory',size:4096,modifiedAt:1793404800000,mode:'755'}]);
 assert.throws(()=>parseDeviceFileListing(Buffer.from('__PIORA_DIR_DENIED__\x1e'),'/system'),/inaccessible/);
});
