function replaceRequired(source, file, marker, target, replacement) {
  const text = source.replaceAll('\r\n', '\n');
  if (text.includes(marker)) return text;
  if (!text.includes(target)) {
    throw new Error(`Missing adaptation anchor in vendor/${file}; check upstream Piora diff before syncing.`);
  }
  return text.replace(target, replacement);
}

export const PRESERVED_VENDOR_FILES = new Set([
  'components/workspace/harmony/inspector-model.ts',
]);

export function applyPioraAdaptation(relPath, rawContents) {
  const rel = relPath.replaceAll('\\', '/');
  switch (rel) {
    case 'lib/harmony/transfer-jobs.ts':
      return replaceRequired(
        rawContents,
        rel,
        'async dispose(): Promise<void>',
        '  private releaseJobLease(id: string): void {',
        `  /** dsh plugin unload must drain transfers before releasing its device manager. */\n` +
        `  async dispose(): Promise<void> {\n` +
        `    for (const controller of this.controllers.values()) controller.abort();\n` +
        `    await Promise.allSettled(this.serialTails.values());\n` +
        `    for (const timer of this.renewalTimers.values()) clearInterval(timer);\n` +
        `    this.renewalTimers.clear();\n` +
        `    for (const id of this.jobLeaseTokens.keys()) this.releaseJobLease(id);\n` +
        `  }\n\n` +
        `  private releaseJobLease(id: string): void {`,
      );
    case 'lib/harmony/database-export-jobs.ts':
      return replaceRequired(
        rawContents,
        rel,
        'async dispose(): Promise<void>',
        '  constructor(private readonly journalPath: string,',
        `  /** dsh plugin unload drains exports before closing their SQLite snapshots. */\n` +
        `  async dispose(): Promise<void> {\n` +
        `    for (const controller of this.controllers.values()) controller.abort();\n` +
        `    await this.tail?.catch(() => undefined);\n` +
        `  }\n\n` +
        `  constructor(private readonly journalPath: string,`,
      );
    case 'lib/harmony/device-files.ts':
      return replaceRequired(
        rawContents,
        rel,
        'path: posix.normalize(path)',
        '    files.push({ path, name, kind, size: Number.isSafeInteger(size) ? size : undefined,',
        '    files.push({ path: posix.normalize(path), name, kind, size: Number.isSafeInteger(size) ? size : undefined,',
      );
    case 'app/api/harmony/tree/route.ts':
      return replaceRequired(
        rawContents,
        rel,
        'includeScreenshot = url.searchParams.get("includeScreenshot") === "1"',
        `    const url = new URL(request.url);\n` +
        `    const snapshot = await getHarmonyDeviceManager().snapshot({\n` +
        `      serial: requiredQuery(request, "serial"),\n` +
        `      leaseToken: url.searchParams.get("leaseToken")?.trim() || undefined,\n` +
        `      includeTree: true,\n` +
        `      includeScreenshot: false,\n` +
        `      signal: request.signal,\n` +
        `    });\n` +
        `    return noStoreJson({ snapshot: {\n` +
        `      serial: snapshot.serial,\n` +
        `      generation: snapshot.generation,\n` +
        `      revision: snapshot.revision,\n` +
        `      capturedAt: snapshot.capturedAt,\n` +
        `      tree: snapshot.tree,\n` +
        `      nodes: snapshot.nodes,\n` +
        `    } });`,
        `    const url = new URL(request.url);\n` +
        `    const includeScreenshot = url.searchParams.get("includeScreenshot") === "1";\n` +
        `    const manager = getHarmonyDeviceManager();\n` +
        `    const snapshot = await manager.snapshot({\n` +
        `      serial: requiredQuery(request, "serial"),\n` +
        `      leaseToken: url.searchParams.get("leaseToken")?.trim() || undefined,\n` +
        `      includeTree: true,\n` +
        `      includeScreenshot,\n` +
        `      signal: request.signal,\n` +
        `    });\n` +
        `    const candidate = includeScreenshot && snapshot.screenshot\n` +
        `      ? await manager.getFrameGeometry(snapshot.serial, "screenshot", request.signal).catch(() => undefined) : undefined;\n` +
        `    const geometry = candidate && candidate.deviceEpoch === snapshot.generation\n` +
        `      && candidate.frameWidth === snapshot.screenshot?.width && candidate.frameHeight === snapshot.screenshot?.height\n` +
        `      ? candidate : undefined;\n` +
        `    return noStoreJson({ snapshot: {\n` +
        `      serial: snapshot.serial,\n` +
        `      generation: snapshot.generation,\n` +
        `      revision: snapshot.revision,\n` +
        `      capturedAt: snapshot.capturedAt,\n` +
        `      tree: snapshot.tree,\n` +
        `      nodes: snapshot.nodes,\n` +
        `      quality: snapshot.quality,\n` +
        `      geometry,\n` +
        `      ...(includeScreenshot && snapshot.screenshot ? { screenshot: {\n` +
        `        width: snapshot.screenshot.width, height: snapshot.screenshot.height,\n` +
        `        dataUrl: \`data:\${snapshot.screenshot.mimeType};base64,\${snapshot.screenshot.data.toString("base64")}\`,\n` +
        `      } } : {}),\n` +
        `    } });`,
      );
    case 'lib/harmony/manager/media-stream-controller.ts': {
      let text = replaceRequired(
        rawContents,
        rel,
        'width?: number; height?: number }>();',
        '  private readonly frameCapturedAt = new Map<string, { capturedAt: number; generation: number }>();',
        '  private readonly frameCapturedAt = new Map<string, { capturedAt: number; generation: number; width?: number; height?: number }>();',
      );
      text = replaceRequired(
        text,
        rel,
        'const sameShape = dimensions?.width === width && dimensions?.height === height;',
        `      this.videoConnectionFrames.delete(tracked);\n` +
        `      dimensions = { width, height };\n` +
        `      this.recordFrameDimensions(options.serial, "video", width, height);\n` +
        `      const remaining = [...(this.videoConnections.get(options.serial) ?? [])]\n` +
        `        .filter(viewer => viewer !== tracked && this.videoConnectionCurrent.get(viewer)?.())\n` +
        `        .map(viewer => this.videoConnectionFrames.get(viewer))\n` +
        `        .filter(observation => observation?.width === width && observation?.height === height)\n` +
        `        .sort((left, right) => right!.capturedAt - left!.capturedAt)[0];\n` +
        `      if (remaining) this.frameCapturedAt.set(\`\${options.serial}:video\`, remaining);`,
        `      this.videoConnectionFrames.delete(tracked);\n` +
        `      const sameShape = dimensions?.width === width && dimensions?.height === height;\n` +
        `      const previousFrame = this.frameCapturedAt.get(\`\${options.serial}:video\`);\n` +
        `      dimensions = { width, height };\n` +
        `      this.recordFrameDimensions(options.serial, "video", width, height);\n` +
        `      const remaining = [...(this.videoConnections.get(options.serial) ?? [])]\n` +
        `        .filter(viewer => viewer !== tracked && this.videoConnectionCurrent.get(viewer)?.())\n` +
        `        .map(viewer => this.videoConnectionFrames.get(viewer))\n` +
        `        .filter(observation => observation?.width === width && observation?.height === height)\n` +
        `        .sort((left, right) => right!.capturedAt - left!.capturedAt)[0];\n` +
        `      if (sameShape && previousFrame?.generation === device.generation && previousFrame.width === width && previousFrame.height === height) {\n` +
        `        this.frameCapturedAt.set(\`\${options.serial}:video\`, previousFrame);\n` +
        `      } else if (remaining) this.frameCapturedAt.set(\`\${options.serial}:video\`, remaining);`,
      );
      text = replaceRequired(
        text,
        rel,
        'private async refreshPointerFrame(',
        `  async getFrameGeometry(serial: string, space: "video" | "screenshot", signal?: AbortSignal): Promise<HarmonyGeometry> {\n` +
        `    const device = await this.host.onlineDevice(serial, signal);\n` +
        `    const backend = this.host.requireBackend();\n` +
        `    if (!backend.displayGeometry) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Native display geometry is unavailable");\n` +
        `    const key = \`\${serial}:\${space}\`;\n` +
        `    const frame = this.frameDimensions.get(key);\n` +
        `    if (!frame) throw new HarmonyError("STALE_SNAPSHOT", "No server-observed frame geometry is available");\n` +
        `    const observation = this.frameCapturedAt.get(key);\n` +
        `    const age = observation ? this.host.now() - observation.capturedAt : Number.NaN;\n` +
        `    if (!observation || observation.generation !== device.generation || !Number.isFinite(age) || age < 0 || age > 5000) {\n` +
        `      throw new HarmonyError("STALE_SNAPSHOT", "The frame is stale; wait for live video or a new screenshot");\n` +
        `    }\n` +
        `    const native = await backend.displayGeometry(serial, signal);`,
        `  private async refreshPointerFrame(serial: string, generation: number, signal?: AbortSignal): Promise<void> {\n` +
        `    if (!this.videoConnections.get(serial)?.size) return;\n` +
        `    const fresh = () => {\n` +
        `      const frame = this.frameCapturedAt.get(\`\${serial}:video\`);\n` +
        `      const age = frame ? this.host.now() - frame.capturedAt : Number.NaN;\n` +
        `      return frame?.generation === generation && Number.isFinite(age) && age >= 0 && age <= 750;\n` +
        `    };\n` +
        `    if (fresh()) return;\n` +
        `    this.requestVideoKeyframe(serial, generation);\n` +
        `    const deadline = performance.now() + 800;\n` +
        `    while (!fresh()) {\n` +
        `      if (signal?.aborted || this.host.getGeneration(serial) !== generation || performance.now() >= deadline) {\n` +
        `        throw new HarmonyError("STALE_SNAPSHOT", "Wait for a fresh live frame before controlling the phone", { details: { dispatchState: "not-sent" } });\n` +
        `      }\n` +
        `      await new Promise(resolve => setTimeout(resolve, 10));\n` +
        `    }\n` +
        `  }\n\n` +
        `  async getFrameGeometry(serial: string, space: "video" | "screenshot", signal?: AbortSignal): Promise<HarmonyGeometry> {\n` +
        `    const device = await this.host.onlineDevice(serial, signal);\n` +
        `    const backend = this.host.requireBackend();\n` +
        `    if (space === "video") await this.refreshPointerFrame(serial, device.generation, signal);\n` +
        `    if (!backend.displayGeometry) throw new HarmonyError("CAPABILITY_UNAVAILABLE", "Native display geometry is unavailable");\n` +
        `    const key = \`\${serial}:\${space}\`;\n` +
        `    const frame = this.frameDimensions.get(key);\n` +
        `    if (!frame) throw new HarmonyError("STALE_SNAPSHOT", "No server-observed frame geometry is available");\n` +
        `    const observation = this.frameCapturedAt.get(key);\n` +
        `    const age = observation ? this.host.now() - observation.capturedAt : Number.NaN;\n` +
        `    if (!observation || observation.generation !== device.generation || !Number.isFinite(age) || age < 0 || age > 5000) {\n` +
        `      throw new HarmonyError("STALE_SNAPSHOT", "The frame is stale; wait for live video or a new screenshot");\n` +
        `    }\n` +
        `    const native = await backend.displayGeometry(serial, signal);\n` +
        `    if (space === "video") await this.refreshPointerFrame(serial, device.generation, signal);`,
      );
      return text;
    }
    default:
      return rawContents;
  }
}
