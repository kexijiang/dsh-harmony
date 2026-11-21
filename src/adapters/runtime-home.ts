import os from "node:os";
import path from "node:path";

export type RuntimeHomeEnvironment = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function getRuntimeUserHomeDirectory(env: RuntimeHomeEnvironment = process.env): string {
  const primary = (process.platform === "win32" ? env.USERPROFILE : env.HOME)?.trim();
  const fallback = (env.HOME || env.USERPROFILE)?.trim();
  return path.resolve(primary || fallback || os.homedir());
}

export function getRuntimeHomeDirectory(env: RuntimeHomeEnvironment = process.env): string {
  const configured = env.PIORA_HOME?.trim();
  return configured ? path.resolve(configured) : getRuntimeUserHomeDirectory(env);
}

export function getRuntimeAgentDataDirectory(env: RuntimeHomeEnvironment = process.env): string {
  const configured = env.PI_CODING_AGENT_DIR?.trim() || env.PIORA_AGENT_DIR?.trim();
  if (configured) {
    if (configured === "~") return getRuntimeHomeDirectory(env);
    if (configured.startsWith("~/") || configured.startsWith("~\\")) {
      return path.resolve(getRuntimeHomeDirectory(env), configured.slice(2));
    }
    return path.resolve(configured);
  }
  const desktopData = env.PIORA_DESKTOP_DATA_DIR?.trim();
  if (desktopData) {
    return path.join(path.resolve(desktopData), "agent");
  }
  if (env !== process.env && (env.PIORA_HOME?.trim() || env.HOME?.trim() || env.USERPROFILE?.trim())) {
    return path.join(getRuntimeHomeDirectory(env), ".pi", "agent");
  }
  return path.join(os.homedir(), ".dsh", "harmony", "agent");
}
