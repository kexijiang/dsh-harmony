import { realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getAdditionalAllowedRoots } from './allowed-roots';
const rootsContext = new AsyncLocalStorage<Set<string>>();
let workspace = process.cwd();
export function setWorkspace(path: string) { workspace = realpathSync(path); }
export function withWorkspace<T>(path: string | undefined, fn: () => T): T {
  return rootsContext.run(new Set([realpathSync(path || workspace)]), fn);
}
export const normalizeSlashes = (path: string) => path.replaceAll('\\', '/');
export const getAllowedFileRoots = async () => {
  const base = rootsContext.getStore() ?? new Set([workspace]);
  const extra = getAdditionalAllowedRoots();
  if (!extra.length) return base;
  const merged = new Set(base);
  for (const root of extra) merged.add(root);
  return merged;
};
export function isFilePathAllowed(target: string, roots: Set<string>) {
  if (!isAbsolute(target)) return false;
  return [...roots].some(root => { const rel = relative(resolve(root), resolve(target)); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); });
}
export function isExistingFilePathAllowed(target: string, roots: Set<string>) {
  try {
    const resolvedRoots = new Set<string>();
    for (const root of roots) {
      try { resolvedRoots.add(realpathSync(root)); } catch { /* Ignore uncreated optional roots. */ }
    }
    return resolvedRoots.size > 0 && isFilePathAllowed(realpathSync(target), resolvedRoots);
  } catch { return false; }
}
