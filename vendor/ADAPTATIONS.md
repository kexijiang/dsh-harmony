# Local Adaptations to Vendored Piora Sources

All files under `vendor/piora/` are synced from Piora (`vendor/provenance.json`). Only the minimal adaptations below are applied automatically by `scripts/piora-adaptations.mjs` during `scripts/build.mjs --piora <path>`, and all changes are kept idempotent so future syncs remain repeatable:

1. **`lib/harmony/transfer-jobs.ts`**: Added `HarmonyTransferJobs.dispose()` so unloading the Cordis plugin aborts active transfers, waits for serial queue tails, clears renewal intervals, and releases job leases before disposing `HarmonyDeviceManager`.
2. **`lib/harmony/database-export-jobs.ts`**: Added `HarmonyDatabaseExportJobs.dispose()` so plugin unload aborts active SQLite export jobs and drains pending file-write tails before closing snapshots.
3. **`lib/harmony/device-files.ts`**: Normalized parsed device paths with `posix.normalize(path)` so root listings return `/data` rather than `//data` while preserving all device metadata.
4. **`app/api/harmony/tree/route.ts`**: Preserved optional `includeScreenshot=1`, snapshot `quality`, and epoch/dimension-validated screenshot `geometry` fields needed by `tests/inspector.test.mjs` and client inspectors.
5. **`lib/harmony/manager/media-stream-controller.ts`**: Preserved `refreshPointerFrame()` freshness check (requesting a keyframe and waiting up to 800ms for a frame <= 750ms old before pointer geometry verification) and `sameShape` geometry retention across identical-dimension SPS/PPS configuration callbacks in `openVideoStream()`. Also typed optional `width`/`height` on `frameCapturedAt`.
6. **`components/workspace/harmony/inspector-model.ts`**: Preserved as a local DSH test/inspector helper file during snapshot pruning.

Runtime shims replacing Piora web-app host APIs live under `src/adapters/`:
- `file-access.ts`, `allowed-roots.ts`: Maps workspace roots plus `allowFileRoot()` log-library roots into DSH plugin execution context via `AsyncLocalStorage`.
- `runtime-home.ts`: Preserves real OS user-home lookup for DevEco/HDC discovery while isolating DSH plugin agent/session/media data under `PIORA_DESKTOP_DATA_DIR` (`%USERPROFILE%\.dsh\harmony`).
- `session-reader.ts`: Bridges DSH Better Sidebar live sessions and disk session metadata to Piora's session log library (`/harmony/sessions` + `ctx.sessions`).
- `analytics-telemetry.ts`: No-op stub for `installAnalyticsModelObserver`.
- `request-security.ts`, `web-auth.ts`, `next-server.ts`, `dynamic.tsx`, `prompt-runs.ts`, `asset-path.ts`, `theme.ts`, `pi-ai.ts`, `pi-sdk.ts`: Host transport, Cordis tool turn fencing, CSP/auth, and DSH theme token adapters.
