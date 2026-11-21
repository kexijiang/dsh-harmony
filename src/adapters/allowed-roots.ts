import path from "node:path";

const GLOBAL_KEY = "__dshHarmonyAdditionalAllowedRoots" as const;

export function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function getRootSet(): Set<string> {
  const g = globalThis as Record<string, unknown>;
  if (!(g[GLOBAL_KEY] instanceof Set)) {
    g[GLOBAL_KEY] = new Set<string>();
  }
  return g[GLOBAL_KEY] as Set<string>;
}

export function allowFileRoot(root: string): void {
  const trimmed = root.trim();
  if (!trimmed) return;
  getRootSet().add(path.resolve(trimmed));
}

export function getAdditionalAllowedRoots(): string[] {
  return [...getRootSet()];
}

export function clearAdditionalAllowedRoots(): void {
  getRootSet().clear();
}
