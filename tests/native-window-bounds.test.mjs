import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyMirrorBounds,
  MIRROR_TITLE_HEIGHT,
  mirrorBounds,
  mirrorResizeBounds,
  updateMirrorAspectRatio,
} from '../.verification/harmony-window-bounds.mjs';
import { NativeMirror } from '../.verification/native-mirror.mjs';

test('mirrorBounds and mirrorResizeBounds compute DPI-safe proportional bounds across scales', async () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const s25 = mirrorBounds(workArea, 9 / 20, 25);
  const s50 = mirrorBounds(workArea, 9 / 20, 50);
  const s75 = mirrorBounds(workArea, 9 / 20, 75);
  const s100 = mirrorBounds(workArea, 9 / 20, 100);
  assert.ok(s25.height < s50.height && s50.height < s75.height && s75.height < s100.height);
  assert.ok(s100.height <= workArea.height);

  const current = { x: 200, y: 100, width: 362, height: 800 + MIRROR_TITLE_HEIGHT + 2 };
  const resizedLeft = mirrorResizeBounds(current, { x: 110, y: 100, width: 452, height: 838 }, 9 / 20, MIRROR_TITLE_HEIGHT + 2, 'left');
  assert.equal(resizedLeft.x + resizedLeft.width, current.x + current.width);
  const resizedBottom = mirrorResizeBounds(current, { x: 200, y: 100, width: 362, height: 638 }, 9 / 20, MIRROR_TITLE_HEIGHT + 2, 'bottom');
  assert.equal(resizedBottom.height, 638);
  assert.equal(resizedBottom.width, Math.round((638 - (MIRROR_TITLE_HEIGHT + 2)) * (9 / 20)) + 2);

  let fake = { x: 100, y: 100, width: 300, height: 600 };
  let ratioSet;
  const applied = await updateMirrorAspectRatio(
    {
      getBounds: () => ({ ...fake }),
      setBounds: b => { fake = { x: b.x, y: b.y, width: b.width - 1, height: b.height }; },
      setAspectRatio: (ratio, extra) => { ratioSet = { ratio, extra }; },
    },
    9 / 20,
    MIRROR_TITLE_HEIGHT + 2,
    { x: 100, y: 100, width: 362, height: 838 },
  );
  assert.equal(ratioSet.ratio, process.platform === 'win32' ? 0 : 9 / 20);
  const settled = await applyMirrorBounds(
    {
      getBounds: () => ({ ...fake }),
      setBounds: b => { fake = { ...b }; },
    },
    applied,
  );
  assert.deepEqual(settled, applied);
});

test('NativeMirror isolates multi-device windows, persists preferences, enforces transition timeout and recording close guard', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mirror-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  let recordingActive = true;
  const stopped = [];
  const common = {
    root: dir,
    dataDir: dir,
    transitionTimeoutMs: 60,
    createHandler: () => () => {},
    allowOrigin: () => {},
    removeOrigin: () => {},
    getRecordingState: serial => serial === 'dev-1' && recordingActive
      ? { recordingId: 'rec-1', serial: 'dev-1', ownerId: '', startedAt: new Date().toISOString() }
      : undefined,
    stopRecording: async opts => {
      stopped.push(opts);
      recordingActive = false;
    },
  };

  const mirror = new NativeMirror(common);
  t.after(() => mirror.dispose());

  // Initialize two devices with independent presentations/scales.
  await mirror.action('selectDevice', 'dev-1');
  await mirror.action('setPresentation', 'sidebar', { serial: 'dev-1' });
  await mirror.action('setScale', 50, { serial: 'dev-1' });
  await mirror.action('setAlwaysOnTop', true, { serial: 'dev-1' });

  await mirror.action('selectDevice', 'dev-2');
  await mirror.action('setPresentation', 'sidebar', { serial: 'dev-2' });
  await mirror.action('setScale', 100, { serial: 'dev-2' });

  const state1 = mirror.getState('dev-1');
  const state2 = mirror.getState('dev-2');
  assert.equal(state1.scale, 50);
  assert.equal(state1.alwaysOnTop, true);
  assert.equal(state2.scale, 100);
  assert.equal(state2.alwaysOnTop, false);
  assert.ok(existsSync(join(dir, 'harmony-mirror-windows.json')));

  const savedJson = JSON.parse(await readFile(join(dir, 'harmony-mirror-windows.json'), 'utf8'));
  assert.equal(savedJson['dev-1'].scale, 50);
  assert.equal(savedJson['dev-2'].scale, 100);

  // Recreate NativeMirror from persisted harmony-mirror-windows.json.
  const restored = new NativeMirror(common);
  t.after(() => restored.dispose());
  assert.equal(restored.getState('dev-1').scale, 50);
  assert.equal(restored.getState('dev-1').alwaysOnTop, true);
  assert.equal(restored.getState('dev-2').scale, 100);

  // Transition timeout sets presentationFailed=true when destination never reports first frame.
  await mirror.action('setPresentation', 'sidebar', { serial: 'dev-1' });
  const pending = mirror.action('setPresentation', 'floating', { serial: 'dev-1' }).catch(() => null);
  if (pending === null) {
    // Expected when Electron is not present in unit tests; verify explicit timeout path with sidebar->sidebar/mock transition:
  }
  const directTimeoutMirror = new NativeMirror({ ...common, transitionTimeoutMs: 40 });
  t.after(() => directTimeoutMirror.dispose());
  await directTimeoutMirror.action('selectDevice', 'dev-3');
  await directTimeoutMirror.action('setPresentation', 'sidebar', { serial: 'dev-3' });
  // Simulate an open floating state switching to sidebar and acknowledging via reportFrame:
  const s3 = directTimeoutMirror.ensureWindow('dev-3');
  s3.presentation = 'floating';
  s3.open = true;
  const handoff = await directTimeoutMirror.action('setPresentation', 'sidebar', { serial: 'dev-3' });
  assert.equal(handoff.pendingPresentation, 'sidebar');
  assert.ok(handoff.presentationTransition);
  const completed = await directTimeoutMirror.action('reportFrame', {
    serial: 'dev-3',
    width: 720,
    height: 1600,
    chromeHeight: 44,
    presentation: 'sidebar',
    transition: handoff.presentationTransition,
  });
  assert.equal(completed.presentation, 'sidebar');
  assert.equal(completed.pendingPresentation, undefined);
  assert.equal(completed.frame.width, 720);

  // Timeout failure test when floating->sidebar never receives reportFrame within 40ms:
  s3.presentation = 'floating';
  await directTimeoutMirror.action('setPresentation', 'sidebar', { serial: 'dev-3' });
  await new Promise(r => setTimeout(r, 90));
  const timedOut = directTimeoutMirror.getState('dev-3');
  assert.equal(timedOut.presentation, 'floating');
  assert.equal(timedOut.pendingPresentation, undefined);
  assert.equal(timedOut.presentationFailed, true);

  // Recording confirmation guard when closing dev-1 in sidebar mode.
  const win1 = mirror.getState('dev-1');
  common.getRecordingState = serial => serial === 'dev-1' && recordingActive
    ? { recordingId: 'rec-1', serial: 'dev-1', ownerId: win1.ownerId, startedAt: new Date().toISOString() }
    : undefined;
  const unconfirmed = await mirror.action('close', undefined, { serial: 'dev-1' });
  assert.ok(unconfirmed.confirmRecording);
  assert.equal(unconfirmed.confirmRecording.ours, true);
  assert.equal(unconfirmed.open, true);

  const confirmed = await mirror.action('close', undefined, { serial: 'dev-1', confirm: true });
  assert.equal(confirmed.open, false);
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].recordingId, 'rec-1');
});
