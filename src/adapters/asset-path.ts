import { join } from 'node:path';
export function harmonyRuntimeAsset(...parts: string[]) {
  const root = process.env.PIORA_WEB_RUNTIME_ROOT!;
  if (parts[0] === 'node_modules' && parts[1] === 'hypium-driver') return join(root, 'resources/hypium');
  return join(root, ...parts);
}
