import { realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
const rootsContext = new AsyncLocalStorage<Set<string>>();
let workspace = process.cwd();
export function setWorkspace(path: string) { workspace = realpathSync(path); }
export function withWorkspace<T>(path: string | undefined, fn: () => T): T {
  return rootsContext.run(new Set([realpathSync(path || workspace)]), fn);
}
export const normalizeSlashes = (path: string) => path.replaceAll('\\', '/');
export const getAllowedFileRoots = async () => rootsContext.getStore() ?? new Set([workspace]);
export function isFilePathAllowed(target: string, roots: Set<string>) {
  if (!isAbsolute(target)) return false;
  return [...roots].some(root => { const rel = relative(resolve(root), resolve(target)); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); });
}
export function isExistingFilePathAllowed(target: string, roots: Set<string>) {
  try { return isFilePathAllowed(realpathSync(target), new Set([...roots].map(root => realpathSync(root)))); } catch { return false; }
}
