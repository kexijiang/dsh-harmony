import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fork } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const pkg = process.argv[2] || join(homedir(),'.dsh/profiles/desktop/node_modules/dsh-plugin-harmony');
const require = createRequire(join(pkg,'package.json'));
const pty = require('node-pty');
const terminal = pty.spawn(process.env.ComSpec || 'cmd.exe',['/d','/c','echo DSH_HARMONY_PTY_OK'], {cols:80,rows:24,cwd:process.cwd(),env:process.env,useConptyDll:true});
let output=''; terminal.onData(data=>{output+=data;});
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{terminal.kill();reject(new Error('PTY timeout'));},5000);terminal.onExit(({exitCode})=>{clearTimeout(timer); if(exitCode!==0)reject(new Error('PTY exited '+exitCode));else resolve();});});
assert.match(output,/DSH_HARMONY_PTY_OK/);
const dir=await mkdtemp(join(tmpdir(),'dsh-harmony-installed-'));
const path=join(dir,'test.db'); const db=new DatabaseSync(path);db.exec('CREATE TABLE test (value TEXT)');db.close();
const sqlite=new Worker(join(pkg,'dist/lib/harmony/runtime/sqlite-inspector.cjs'),{workerData:{path,offset:0}});
const result=await new Promise((resolve,reject)=>{sqlite.once('message',resolve);sqlite.once('error',reject);});
await sqlite.terminate();assert.deepEqual(result.tables,['test']);
const worker=fork(join(pkg,'dist/.harmony-worker/harmony/runtime/worker-entry.js'),[],{env:{...process.env,PIORA_HARMONY_WORKER_EPOCH:'test-epoch',PIORA_HARMONY_WORKER_SERIAL:'test-serial',PIORA_HARMONY_WORKER_HDC:join(pkg,'dist/resources/tools/windows-x64/hdc.exe')},stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
let stderr='';worker.stderr.on('data',data=>{stderr+=data;});
try {
  const reply=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Worker timeout '+stderr)),5000);worker.once('message',value=>{clearTimeout(timer);resolve(value);});worker.once('error',error=>{clearTimeout(timer);reject(error);});worker.send({id:1,protocol:-1});});
  assert.ok(reply.error); // Invalid IPC never reaches a device.
} finally {worker.disconnect();}
await writeFile('.verification/installed-runtime.json',JSON.stringify({package:pkg,version:require('./package.json').version,pty:true,sqlite:true,hypiumIPC:true},null,2));
console.log('Installed package: PTY, SQLite and Hypium IPC passed.');
// node-pty's Windows ConPTY helper retains a MessagePort after the short-lived
// test shell exits. This standalone smoke process has no remaining work.
terminal.kill();
process.exit(0);
