import { harness } from '../tests/harness.mjs';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Explicit opt-in: this opens a native window and reads the connected phone's video.
if (!process.argv.includes('--device')) throw new Error('Pass --device to verify a connected phone in the native window.');
const h = await harness({fake:false});
const call = async(action,value) => {
  const response = await fetch(h.origin+'/harmony/window',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,value})});
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
};
const until = async (predicate, label) => {
  for(let i=0;i<30;i++) {
    const state=await fetch(h.origin+'/harmony/window').then(r=>r.json());
    if(predicate(state)) return state;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Native window did not apply: '+label);
};
try {
  const data = await fetch(h.origin+'/api/harmony/devices').then(r=>r.json());
  assert.ok(data.devices?.[0], 'Connect a device first');
  await call('open',data.devices[0].serial);
  let state;
  for (let i=0;i<15;i++) { await new Promise(resolve=>setTimeout(resolve,1000)); state=await fetch(h.origin+'/harmony/window').then(r=>r.json()); if(state.frame) break; }
  assert.ok(state.frame,'The native renderer must receive an actual video frame');
  assert.equal(state.nativeWindow?.visible,true,'The native OS window must be visible on first open');
  assert.equal((await call('setAlwaysOnTop',true)).alwaysOnTop,true);
  await until(s=>s.nativeWindow?.alwaysOnTop===true,'pin');
  const originalHeight=state.nativeWindow.bounds.height;
  assert.equal((await call('setScale',80)).scale,80);
  await until(s=>s.nativeWindow?.bounds.height<originalHeight,'scale');
  await call('setAlwaysOnTop',false);
  await until(s=>s.nativeWindow?.alwaysOnTop===false,'unpin');
  assert.equal((await call('setPresentation','sidebar')).presentation,'sidebar');
  await until(s=>s.nativeWindow?.visible===false,'dock');
  await call('open',data.devices[0].serial);
  await until(s=>s.nativeWindow?.visible===true,'reopen');
  assert.equal((await call('close')).open,false);
  await until(s=>s.nativeWindow?.visible===false,'close');
  await writeFile('.verification/native-mirror.json',JSON.stringify({nativeWindow:true,frame:state.frame,pin:true,scale:true,dock:true,reopen:true,close:true},null,2));
  console.log('Native window: real video frame, pin, scale, dock, reopen and close passed.');
} finally {await h.close();}
