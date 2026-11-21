import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import JSZip from 'jszip';
import { harness } from './harness.mjs';

const require = createRequire(import.meta.url);

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: response.status, json, headers: response.headers };
}

async function uploadLogFile(origin, sessionId, name, bytes) {
  const begin = await postJson(`${origin}/api/harmony/log-library/begin?sessionId=${encodeURIComponent(sessionId)}`, {
    name,
    size: bytes.byteLength,
    sourceKind: 'import',
  });
  assert.equal(begin.status, 200, JSON.stringify(begin.json));
  const uploadId = begin.json.id;
  assert.ok(uploadId);

  const chunkRes = await fetch(
    `${origin}/api/harmony/log-library/chunk?sessionId=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(uploadId)}&index=0`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    },
  );
  assert.equal(chunkRes.status, 200);

  const finish = await postJson(`${origin}/api/harmony/log-library/finish?sessionId=${encodeURIComponent(sessionId)}`, {
    id: uploadId,
  });
  assert.equal(finish.status, 200, JSON.stringify(finish.json));

  // If package import continues asynchronously, wait briefly until list or importStatus settles.
  if (finish.json?.pending) {
    for (let i = 0; i < 60; i++) {
      const statusRes = await fetch(`${origin}/api/harmony/log-library/import-status?sessionId=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(uploadId)}`);
      if (statusRes.status !== 200) break;
      const st = await statusRes.json();
      if (st?.phase === '已完成' || st?.done || st?.file?.id) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  return finish.json;
}

test('session log workbench end-to-end: chunked upload, gzip, zip worker indexing, cross-file regex search, search history, export and disposal', { timeout: 60000 }, async t => {
  const { path7z } = require('7z-bin');
  assert.ok(existsSync(path7z), '7z-bin binary must be bundled without install scripts');
  assert.match(execFileSync(path7z, [], { encoding: 'utf8' }), /7-Zip/);

  const h = await harness();
  t.after(() => h.close());

  const sessionId = 'log-wb-session-1';
  const syncRes = await postJson(`${h.origin}/harmony/sessions`, {
    sessions: [{ id: sessionId, name: 'Harmony Debug', cwd: process.cwd() }],
    activeSession: { id: sessionId, cwd: process.cwd() },
  });
  assert.equal(syncRes.status, 200);

  // 1. Upload plain HILOG text file
  const rawLog = Buffer.from([
    '05-10 12:00:00.100  1234  5678 I C01700/AppLaunch: cold start begin',
    '05-10 12:00:00.250  1234  5678 E C02900/FaultLogger: NullPointerException in PaymentAbility',
    '05-10 12:00:00.300  1234  5678 W C01700/NetworkKit: slow frame 184ms',
  ].join('\n'), 'utf8');
  const uploaded = await uploadLogFile(h.origin, sessionId, 'device-crash.log', rawLog);
  const plainFileId = uploaded.id;
  assert.ok(plainFileId);

  // 2. Upload gzip log file
  const gzLog = gzipSync(Buffer.from([
    '05-10 12:01:00.010  2222  3333 I C01400/AudioPolicy: stream active',
    '05-10 12:01:01.020  2222  3333 E C02900/FaultLogger: AudioTimeout after PaymentAbility callback',
  ].join('\n'), 'utf8'));
  const gzUploaded = await uploadLogFile(h.origin, sessionId, 'audio-trace.log.gz', gzLog);
  assert.ok(gzUploaded.id);

  // 3. Upload ZIP archive via yauzl + worker thread
  const zip = new JSZip();
  zip.file('nested/hilog_app.txt', '05-10 12:02:00.000  9999  9999 E C02900/ZipBundle: PaymentAbility archive marker\n');
  const zipBytes = await zip.generateAsync({ type: 'nodebuffer' });
  const zipUploaded = await uploadLogFile(h.origin, sessionId, 'bundle-logs.zip', zipBytes);
  assert.ok(zipUploaded);

  // Wait up to 5s until all uploaded logs appear in list
  let listed;
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${h.origin}/api/harmony/log-library/list?sessionId=${encodeURIComponent(sessionId)}&offset=0&limit=50`);
    assert.equal(res.status, 200);
    listed = await res.json();
    if ((listed.files?.length ?? 0) >= 3) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const files = listed.files ?? [];
  assert.ok(files.some(f => f.name.includes('device-crash')), JSON.stringify(files));
  assert.ok(files.some(f => f.name.includes('audio-trace')), JSON.stringify(files));
  assert.ok(files.some(f => f.name.includes('hilog_app')), JSON.stringify(files));

  // 4. Read parsed lines via worker thread
  const logsRes = await fetch(`${h.origin}/api/harmony/log-library/logs?sessionId=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(plainFileId)}&offset=0&limit=50`);
  assert.equal(logsRes.status, 200);
  const logsJson = await logsRes.json();
  assert.equal(logsJson.entries.length, 3, JSON.stringify(logsJson));
  assert.match(logsJson.entries[1].message, /PaymentAbility/);

  // 5. Cross-file text and regex search across plain, gz, and zip entries
  const searchRes = await fetch(`${h.origin}/api/harmony/log-library/search?sessionId=${encodeURIComponent(sessionId)}&query=PaymentAbility&mode=normal`);
  assert.equal(searchRes.status, 200);
  const searchJson = await searchRes.json();
  assert.ok(searchJson.totalHits >= 3 && searchJson.matchedFiles >= 3 && searchJson.entries.length >= 3, JSON.stringify(searchJson));

  const regexRes = await fetch(`${h.origin}/api/harmony/log-library/search?sessionId=${encodeURIComponent(sessionId)}&query=${encodeURIComponent('FaultLogger.*PaymentAbility|ZipBundle')}&mode=regex`);
  assert.equal(regexRes.status, 200);
  const regexJson = await regexRes.json();
  assert.ok(regexJson.totalHits >= 3 && regexJson.entries.length >= 3, JSON.stringify(regexJson));

  // 6. Analysis / favorites summary
  const analysisRes = await postJson(`${h.origin}/api/harmony/log-library/analysis?sessionId=${encodeURIComponent(sessionId)}`, {
    id: plainFileId,
  });
  assert.equal(analysisRes.status, 200);

  // 7. Search history persistence API
  const histPost = await postJson(`${h.origin}/api/harmony/logs/search-history`, {
    kind: 'find',
    action: 'record',
    query: 'PaymentAbility',
    regex: false,
    caseSensitive: true,
  });
  assert.equal(histPost.status, 200, JSON.stringify(histPost.json));
  const histGet = await fetch(`${h.origin}/api/harmony/logs/search-history`);
  assert.equal(histGet.status, 200);
  const histJson = await histGet.json();
  assert.ok(histJson.history.find.some(item => item.query === 'PaymentAbility'));

  // 8. Source and NDJSON filtered export streaming
  const sourceRes = await fetch(`${h.origin}/api/harmony/log-library/source?sessionId=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(plainFileId)}`);
  assert.equal(sourceRes.status, 200);
  assert.match(await sourceRes.text(), /cold start begin/);

  const exportRes = await fetch(`${h.origin}/api/harmony/log-library/export?sessionId=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(plainFileId)}&level=error`);
  assert.equal(exportRes.status, 200);
  const exportText = await exportRes.text();
  assert.match(exportText, /NullPointerException/);
  assert.doesNotMatch(exportText, /cold start begin/);

  // 9. Direct delete permanently
  const delRes = await postJson(`${h.origin}/api/harmony/log-library/delete-permanently?sessionId=${encodeURIComponent(sessionId)}`, {
    ids: [plainFileId],
  });
  assert.equal(delRes.status, 200);

  await h.close();
  assert.equal(globalThis.__pioraLogLibrary, undefined);
});
