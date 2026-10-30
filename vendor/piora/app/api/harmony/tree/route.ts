import { getHarmonyDeviceManager } from "@/lib/harmony";
import { harmonyErrorResponse, noStoreJson, requireHarmonyAccess, requiredQuery } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const includeScreenshot = url.searchParams.get("includeScreenshot") === "1";
    const manager = getHarmonyDeviceManager();
    const snapshot = await manager.snapshot({
      serial: requiredQuery(request, "serial"),
      leaseToken: url.searchParams.get("leaseToken")?.trim() || undefined,
      includeTree: true,
      includeScreenshot,
      signal: request.signal,
    });
    const candidate = includeScreenshot && snapshot.screenshot
      ? await manager.getFrameGeometry(snapshot.serial, "screenshot", request.signal).catch(() => undefined) : undefined;
    const geometry = candidate && candidate.deviceEpoch === snapshot.generation
      && candidate.frameWidth === snapshot.screenshot?.width && candidate.frameHeight === snapshot.screenshot?.height
      ? candidate : undefined;
    return noStoreJson({ snapshot: {
      serial: snapshot.serial,
      generation: snapshot.generation,
      revision: snapshot.revision,
      capturedAt: snapshot.capturedAt,
      tree: snapshot.tree,
      nodes: snapshot.nodes,
      quality: snapshot.quality,
      geometry,
      ...(includeScreenshot && snapshot.screenshot ? { screenshot: {
        width: snapshot.screenshot.width, height: snapshot.screenshot.height,
        dataUrl: `data:${snapshot.screenshot.mimeType};base64,${snapshot.screenshot.data.toString("base64")}`,
      } } : {}),
    } });
  } catch (error) {
    return harmonyErrorResponse(error);
  }
}
