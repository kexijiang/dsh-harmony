import { randomUUID } from 'node:crypto';
type Identity = { sessionId: string; runId: string; toolCallId?: string };
const runs = new Map<string, Identity & { cleanups: Set<() => any> }>();
const finishing = new Map<string, Promise<void>>();
export async function ensureRun(sessionId: string) {
  await finishing.get(sessionId);
  if (!runs.has(sessionId)) runs.set(sessionId, { sessionId, runId: randomUUID(), cleanups: new Set() });
}
export function requirePromptToolIdentity(sessionId: string, toolCallId: string) {
  const run = runs.get(sessionId);
  if (!run || !toolCallId) throw new Error('Harmony operation has no active dsh agent run.');
  return { sessionId, runId: run.runId, toolCallId };
}
export function registerPromptRunCleanup(identity: Identity, cleanup: () => any) {
  const run = runs.get(identity.sessionId);
  if (!run || run.runId !== identity.runId) throw new Error('The agent run has ended.');
  run.cleanups.add(cleanup);
}
export function finishRun(sessionId: string): Promise<void> {
  if (finishing.has(sessionId)) return finishing.get(sessionId)!;
  const run = runs.get(sessionId); runs.delete(sessionId);
  const promise = (async () => {
    const results = await Promise.allSettled([...run?.cleanups ?? []].map(fn => Promise.resolve().then(fn)));
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(r => (r as PromiseRejectedResult).reason), 'Harmony cleanup failed');
  })().finally(() => finishing.delete(sessionId));
  finishing.set(sessionId, promise); return promise;
}
export async function finishAllRuns() { await Promise.all([...new Set([...runs.keys(), ...finishing.keys()])].map(finishRun)); }
