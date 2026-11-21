import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRuntimeAgentDataDirectory } from "./runtime-home";

export interface DshSessionSummary {
  id: string;
  name?: string;
  title?: string;
  cwd?: string;
  filePath?: string;
  updatedAt?: number;
}

export interface DshSessionHost {
  listSessions?: () => Promise<DshSessionSummary[]> | DshSessionSummary[];
  hasSession?: (sessionId: string) => Promise<boolean> | boolean;
  resolveSessionPath?: (sessionId: string) => Promise<string | null> | string | null;
}

const REGISTRY_KEY = "__dshHarmonySessionRegistry" as const;

interface SessionRegistryState {
  host: DshSessionHost | null;
  clientSessions: Map<string, DshSessionSummary>;
}

function getRegistry(): SessionRegistryState {
  const g = globalThis as Record<string, unknown>;
  if (!g[REGISTRY_KEY] || typeof g[REGISTRY_KEY] !== "object") {
    g[REGISTRY_KEY] = {
      host: null,
      clientSessions: new Map<string, DshSessionSummary>(),
    } satisfies SessionRegistryState;
  }
  return g[REGISTRY_KEY] as SessionRegistryState;
}

function isSafeSessionId(sessionId: string): boolean {
  if (!sessionId || sessionId.length > 256) return false;
  if (sessionId.includes("\0") || sessionId.includes("/") || sessionId.includes("\\") || sessionId.includes("..")) {
    return false;
  }
  return true;
}

function candidateSessionDirectories(): string[] {
  const dirs = new Set<string>();
  dirs.add(path.join(getRuntimeAgentDataDirectory(), "sessions"));
  const home = os.homedir();
  const dshHome = process.env.DSH_HOME?.trim() || path.join(home, ".dsh");
  dirs.add(path.join(dshHome, "sessions"));
  const profilesDir = path.join(dshHome, "profiles");
  if (existsSync(profilesDir)) {
    try {
      for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          dirs.add(path.join(profilesDir, entry.name, "sessions"));
        }
      }
    } catch {
      // Ignore inaccessible profile directories.
    }
  }
  return [...dirs];
}

function scanDiskSessions(): DshSessionSummary[] {
  const out: DshSessionSummary[] = [];
  for (const dir of candidateSessionDirectories()) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const filePath = path.join(dir, entry.name);
        const fallbackId = entry.name.replace(/\.jsonl$/, "");
        let id = fallbackId;
        let name = fallbackId;
        let cwd: string | undefined;
        try {
          const firstLine = readFileSync(filePath, "utf8").split(/\r?\n/, 1)[0]?.trim();
          if (firstLine?.startsWith("{")) {
            const parsed = JSON.parse(firstLine) as { id?: string; name?: string; title?: string; cwd?: string };
            if (typeof parsed.id === "string" && parsed.id) id = parsed.id;
            if (typeof parsed.name === "string" && parsed.name) name = parsed.name;
            else if (typeof parsed.title === "string" && parsed.title) name = parsed.title;
            if (typeof parsed.cwd === "string" && parsed.cwd) cwd = parsed.cwd;
          }
        } catch {
          // Use filename metadata when header parsing fails.
        }
        out.push({ id, name, title: name, cwd, filePath });
      }
    } catch {
      // Ignore unreadable session directories.
    }
  }
  return out;
}

export function configureSessionHost(host: DshSessionHost | null): void {
  getRegistry().host = host;
}

export function syncClientSessions(sessions: DshSessionSummary[]): void {
  const map = getRegistry().clientSessions;
  map.clear();
  for (const item of sessions) {
    if (!item || typeof item.id !== "string" || !isSafeSessionId(item.id)) continue;
    map.set(item.id, {
      id: item.id,
      name: item.name || item.title || item.id,
      title: item.title || item.name || item.id,
      cwd: item.cwd,
      filePath: item.filePath,
      updatedAt: item.updatedAt,
    });
  }
}

export function upsertClientSession(session: DshSessionSummary): void {
  if (!session || typeof session.id !== "string" || !isSafeSessionId(session.id)) return;
  const existing = getRegistry().clientSessions.get(session.id);
  getRegistry().clientSessions.set(session.id, {
    id: session.id,
    name: session.name || session.title || existing?.name || session.id,
    title: session.title || session.name || existing?.title || session.id,
    cwd: session.cwd ?? existing?.cwd,
    filePath: session.filePath ?? existing?.filePath,
    updatedAt: session.updatedAt ?? existing?.updatedAt,
  });
}

export function clearSessionRegistry(): void {
  const reg = getRegistry();
  reg.host = null;
  reg.clientSessions.clear();
}

export async function listAllSessions(): Promise<DshSessionSummary[]> {
  const reg = getRegistry();
  const merged = new Map<string, DshSessionSummary>();
  for (const item of scanDiskSessions()) {
    merged.set(item.id, item);
  }
  if (reg.host?.listSessions) {
    try {
      const hostList = await reg.host.listSessions();
      for (const item of hostList ?? []) {
        if (!item?.id || !isSafeSessionId(item.id)) continue;
        const prev = merged.get(item.id);
        merged.set(item.id, {
          ...prev,
          ...item,
          name: item.name || item.title || prev?.name || item.id,
          title: item.title || item.name || prev?.title || item.id,
        });
      }
    } catch {
      // Continue with local/synced sessions when host listing is unavailable.
    }
  }
  for (const item of reg.clientSessions.values()) {
    const prev = merged.get(item.id);
    merged.set(item.id, {
      ...prev,
      ...item,
      name: item.name || item.title || prev?.name || item.id,
      title: item.title || item.name || prev?.title || item.id,
    });
  }
  return [...merged.values()];
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  if (!isSafeSessionId(sessionId)) return null;
  const reg = getRegistry();
  const clientMatch = reg.clientSessions.get(sessionId);
  if (clientMatch) {
    return clientMatch.filePath || path.join(getRuntimeAgentDataDirectory(), "sessions", `${sessionId}.jsonl`);
  }
  if (reg.host?.resolveSessionPath) {
    try {
      const resolved = await reg.host.resolveSessionPath(sessionId);
      if (resolved) return resolved;
    } catch {
      // Fall through to other resolvers.
    }
  }
  if (reg.host?.hasSession) {
    try {
      if (await reg.host.hasSession(sessionId)) {
        return path.join(getRuntimeAgentDataDirectory(), "sessions", `${sessionId}.jsonl`);
      }
    } catch {
      // Fall through to disk scan.
    }
  }
  for (const dir of candidateSessionDirectories()) {
    const direct = path.join(dir, `${sessionId}.jsonl`);
    if (existsSync(direct)) return direct;
  }
  const disk = scanDiskSessions().find(item => item.id === sessionId);
  return disk?.filePath ?? null;
}
