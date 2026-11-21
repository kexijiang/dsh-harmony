import { execFile, spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { copyHarmonyMedia } from '@piora/desktop/src/harmony-media-clipboard';
import { resolveHarmonyStorage } from '@piora/lib/harmony/artifacts';
import { readHarmonyConfig } from '@piora/lib/harmony/runtime';
import { allowFileRoot } from './adapters/allowed-roots';
import { getAllowedFileRoots, isExistingFilePathAllowed } from './adapters/file-access';
import { getRuntimeAgentDataDirectory } from './adapters/runtime-home';
import type { NativeMirror } from './native-mirror';

const execFileAsync = promisify(execFile);

const BLOCKED_OPEN_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.ps1', '.psm1', '.psd1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.scr', '.hta',
  '.lnk', '.pif', '.reg', '.sh', '.bash', '.zsh', '.command', '.app',
]);

async function runPowerShellSta(script: string, options: { stdin?: string; env?: Record<string, string> } = {}): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Desktop operation requires Electron on this platform');
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: options.env ? { ...process.env, ...options.env } : process.env,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', rejectPromise);
    child.once('close', code => {
      if (code === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(stderr.trim() || `PowerShell exited with status ${code}`));
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

async function resolveAllowedRoots(): Promise<Set<string>> {
  const storage = resolveHarmonyStorage(readHarmonyConfig());
  const roots = new Set<string>(await getAllowedFileRoots());
  roots.add(storage.screenshotDirectory);
  roots.add(storage.recordingDirectory);
  roots.add(getRuntimeAgentDataDirectory());
  const desktopData = process.env.PIORA_DESKTOP_DATA_DIR?.trim();
  if (desktopData) roots.add(resolve(desktopData));
  return roots;
}

async function validateAllowedExistingPath(targetPath: unknown, requireRegularFile: boolean): Promise<string> {
  if (typeof targetPath !== 'string' || !targetPath || targetPath.length > 32_768 || targetPath.includes('\0') || !isAbsolute(targetPath)) {
    throw new Error('Invalid local path');
  }
  const resolved = resolve(targetPath);
  const info = await lstat(resolved).catch(() => null);
  if (!info || info.isSymbolicLink()) throw new Error('Target path does not exist or is a symbolic link');
  if (requireRegularFile && !info.isFile()) throw new Error('Target path must be a regular file');
  const canonical = await realpath(resolved);
  const roots = await resolveAllowedRoots();
  if (!isExistingFilePathAllowed(canonical, roots)) {
    throw new Error('Target path is outside allowed workspaces and Harmony storage directories');
  }
  return canonical;
}

export async function revealDesktopPath(targetPath: unknown, mirror?: NativeMirror): Promise<boolean> {
  const canonical = await validateAllowedExistingPath(targetPath, false);
  if (mirror?.canInvokeDesktop()) {
    await mirror.invokeDesktop('revealPath', { path: canonical });
    return true;
  }
  if (process.platform === 'win32') {
    await execFileAsync('explorer.exe', [`/select,${canonical}`]).catch(error => {
      // explorer.exe often returns exit code 1 even after opening the Explorer window cleanly.
      if (typeof error?.code === 'number' && error.code === 1) return;
      throw error;
    });
    return true;
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-R', canonical]);
    return true;
  }
  await execFileAsync('xdg-open', [resolve(canonical, '..')]);
  return true;
}

export async function openDesktopPath(targetPath: unknown, mirror?: NativeMirror): Promise<boolean> {
  const canonical = await validateAllowedExistingPath(targetPath, true);
  if (BLOCKED_OPEN_EXTENSIONS.has(extname(canonical).toLowerCase())) {
    throw new Error('Executable file types cannot be opened directly');
  }
  if (mirror?.canInvokeDesktop()) {
    await mirror.invokeDesktop('openPath', { path: canonical });
    return true;
  }
  if (process.platform === 'win32') {
    await execFileAsync('rundll32.exe', ['url.dll,FileProtocolHandler', canonical]);
    return true;
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', [canonical]);
    return true;
  }
  await execFileAsync('xdg-open', [canonical]);
  return true;
}

export async function copyDesktopHarmonyMedia(value: unknown, mirror?: NativeMirror): Promise<boolean> {
  const storage = resolveHarmonyStorage(readHarmonyConfig());
  await copyHarmonyMedia(value, storage, {
    writeImage: async png => {
      if (mirror?.canInvokeDesktop()) {
        await mirror.invokeDesktop('clipboardWriteImage', { base64: png.toString('base64') });
        return;
      }
      await runPowerShellSta(
        'Add-Type -AssemblyName System.Windows.Forms, System.Drawing; ' +
        '$raw = [Console]::In.ReadToEnd().Trim(); ' +
        '$bytes = [Convert]::FromBase64String($raw); ' +
        '$stream = [System.IO.MemoryStream]::new($bytes); ' +
        'try { $img = [System.Drawing.Image]::FromStream($stream); try { [System.Windows.Forms.Clipboard]::SetImage($img) } finally { $img.Dispose() } } finally { $stream.Dispose() }',
        { stdin: png.toString('base64') },
      );
    },
    writeFile: async filePath => {
      if (mirror?.canInvokeDesktop()) {
        await mirror.invokeDesktop('clipboardWriteFile', { path: filePath });
        return;
      }
      await runPowerShellSta(
        'Add-Type -AssemblyName System.Windows.Forms; ' +
        '$list = [System.Collections.Specialized.StringCollection]::new(); ' +
        '[void]$list.Add($env:PIORA_CLIP_PATH); ' +
        '[System.Windows.Forms.Clipboard]::SetFileDropList($list)',
        { env: { PIORA_CLIP_PATH: filePath } },
      );
    },
  });
  return true;
}

export async function selectDesktopDirectory(mirror?: NativeMirror): Promise<string | null> {
  if (process.env.PIORA_HARMONY_TEST_DISABLE_DIALOG === '1') return null;
  let selected: string | null = null;
  if (mirror?.canInvokeDesktop()) {
    const result = await mirror.invokeDesktop('selectDirectory', {});
    selected = typeof result?.path === 'string' && result.path ? result.path : null;
  } else if (process.platform === 'win32') {
    const output = await runPowerShellSta(
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '$dialog = [System.Windows.Forms.FolderBrowserDialog]::new(); ' +
      '$dialog.UseDescriptionForTitle = $true; ' +
      '$dialog.Description = "Select directory"; ' +
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
    ).catch(() => '');
    selected = output || null;
  }
  if (selected && isAbsolute(selected)) {
    allowFileRoot(selected);
    return selected;
  }
  return null;
}

export async function selectDesktopHarmonyRuntimePath(kind: unknown, mirror?: NativeMirror): Promise<string | null> {
  if (kind === 'sdk') return selectDesktopDirectory(mirror);
  if (kind !== 'hdc' && kind !== 'python') throw new Error('Invalid runtime kind');
  if (process.env.PIORA_HARMONY_TEST_DISABLE_DIALOG === '1') return null;
  let selected: string | null = null;
  if (mirror?.canInvokeDesktop()) {
    const result = await mirror.invokeDesktop('selectRuntimePath', { kind });
    selected = typeof result?.path === 'string' && result.path ? result.path : null;
  } else if (process.platform === 'win32') {
    const filter = kind === 'hdc'
      ? 'hdc (hdc.exe;hdc)|hdc.exe;hdc|All Files (*.*)|*.*'
      : 'Python (python.exe;python3.exe)|python.exe;python3.exe|All Files (*.*)|*.*';
    const output = await runPowerShellSta(
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '$dialog = [System.Windows.Forms.OpenFileDialog]::new(); ' +
      '$dialog.Filter = $env:PIORA_FILE_FILTER; ' +
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }',
      { env: { PIORA_FILE_FILTER: filter } },
    ).catch(() => '');
    selected = output || null;
  }
  return selected && isAbsolute(selected) ? selected : null;
}

export async function handleDesktopAction(
  body: { action?: unknown; value?: unknown },
  mirror?: NativeMirror,
): Promise<Record<string, unknown>> {
  switch (body?.action) {
    case 'copyHarmonyMedia':
      return { ok: await copyDesktopHarmonyMedia(body.value, mirror) };
    case 'revealPath':
      return { ok: await revealDesktopPath(body.value, mirror) };
    case 'openPath':
      return { ok: await openDesktopPath(body.value, mirror) };
    case 'selectDirectory':
      return { path: await selectDesktopDirectory(mirror) };
    case 'selectHarmonyRuntimePath':
      return { path: await selectDesktopHarmonyRuntimePath(body.value, mirror) };
    default:
      throw new Error('Unknown desktop bridge action');
  }
}
