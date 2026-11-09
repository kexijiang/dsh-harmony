import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { resolve, join, dirname, relative, extname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const sourceArg = process.argv.indexOf('--piora');
const source = sourceArg >= 0 ? resolve(process.argv[sourceArg + 1]) : join(root, 'vendor/piora');
const snapshot = join(root, 'vendor/piora');
const dist = join(root, 'dist');
await mkdir(dist, { recursive: true });
await copyFile(join(root, 'src/native-mirror.cjs'), join(dist, 'native-mirror.cjs'));
const imports = [], entries = [];
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await scan(path);
    else if (item.name === 'route.ts') {
      const name = `route${entries.length}`;
      const rel = relative(source, path).replaceAll('\\', '/');
      imports.push(`import * as ${name} from '@piora/${rel}';`);
      entries.push(`${JSON.stringify('/' + rel.replace('/route.ts', '').replace('app/', ''))}: ${name}`);
    }
  }
}
await scan(join(source, 'app/api/harmony'));
await writeFile(join(root, 'src/routes.generated.ts'), `${imports.join('\n')}\nexport const routes = {${entries.join(',\n')}};\n`);
const shims = {
  'lib/file-access': 'file-access.ts', 'lib/prompt-run-registry': 'prompt-runs.ts',
  'lib/request-security': 'request-security.ts', 'lib/web-auth': 'web-auth.ts',
  'lib/harmony/runtime/asset-path': 'asset-path.ts',
  'hooks/useTheme': 'theme.ts',
};
const visited = new Set();
const require = createRequire(import.meta.url);
function resolveSource(path) {
  for (const suffix of ['', '.ts', '.tsx', '.js', '.json', '/index.ts', '/index.tsx']) if (existsSync(path + suffix) && statSync(path + suffix).isFile()) return path + suffix;
}
const sourcePlugin = { name: 'piora-source', setup(build) {
  build.onResolve({filter:/^dsh:mirror-worker$/},()=>({path:join(root,'src/mirror-worker.ts')}));
  build.onResolve({ filter: /^(next\/|@earendil-works\/pi-)/ }, args => {
    const map = { 'next/server': 'next-server.ts', 'next/dynamic': 'dynamic.tsx', '@earendil-works/pi-ai': 'pi-ai.ts', '@earendil-works/pi-coding-agent': 'pi-sdk.ts' };
    if (map[args.path]) return { path: join(root, 'src/adapters', map[args.path]) };
  });
  build.onResolve({ filter: /.*/ }, args => {
    if (args.pluginData?.workspaceDependency) return;
    const isSource = args.importer.startsWith(source) && !args.importer.replaceAll('\\', '/').includes('/node_modules/');
    if (isSource && !args.path.startsWith('.') && !args.path.startsWith('@/') && !args.path.startsWith('@piora/') && !args.path.startsWith('node:')) {
      return build.resolve(args.path, { resolveDir: root, kind: args.kind, pluginData: { workspaceDependency: true } });
    }
    let path;
    if (args.path.startsWith('@piora/')) path = join(source, args.path.slice(7));
    else if (args.path.startsWith('@/')) path = join(source, args.path.slice(2));
    else if (isSource && args.path.startsWith('.')) path = resolve(dirname(args.importer), args.path);
    if (!path) return;
    const rel = relative(source, path).replaceAll('\\', '/').replace(/\.(tsx?|js)$/, '');
    if (shims[rel]) return { path: join(root, 'src/adapters', shims[rel]) };
    return { path: resolveSource(path) || path };
  });
  build.onLoad({ filter: /\.(tsx?|css|js|json)$/ }, async args => {
    if (!args.path.startsWith(source) || args.path.replaceAll('\\', '/').includes('/node_modules/')) return;
    visited.add(relative(source, args.path).replaceAll('\\', '/'));
    let contents = await readFile(args.path, 'utf8');
    if (relative(source,args.path).replaceAll('\\','/') === 'lib/harmony/runtime/worker-client.ts') contents = contents.replace('serialization: "advanced"','serialization: "json"');
    if (relative(source,args.path).replaceAll('\\','/') === 'hooks/useHarmonyMirror.ts') contents = "import { createMirrorWorker } from 'dsh:mirror-worker';\n" + contents.replace('new Worker(new URL("../lib/harmony/mirror/video.worker.ts", import.meta.url), { type: "module", name: "piora-harmony-mirror" })', 'createMirrorWorker()');
    const loader = args.path.endsWith('.module.css') ? 'local-css' : extname(args.path).slice(1);
    return { contents, loader, resolveDir: dirname(args.path) };
  });
} };
const base = { bundle: true, logLevel: 'warning', plugins: [sourcePlugin], nodePaths: [join(root, 'node_modules')], target: 'es2022', jsx: 'automatic', legalComments: 'eof' };
await build({ ...base, entryPoints: [join(root, 'src/index.ts')], outfile: join(dist, 'index.js'), platform: 'node', format: 'esm', packages: 'external', banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
await build({ ...base, entryPoints: [join(source, 'lib/harmony/runtime/worker-entry.ts')], outfile: join(dist, '.harmony-worker/harmony/runtime/worker-entry.js'), platform: 'node', format: 'esm', packages: 'external' });
const videoWorker=await build({ ...base, entryPoints: [join(source, 'lib/harmony/mirror/video.worker.ts')], platform:'browser', format:'esm', minify:true, write:false });
await writeFile(join(dist,'video.worker.js'),videoWorker.outputFiles[0].text);
await build({ ...base, entryPoints: [join(root, 'src/panel.tsx')], outfile: join(dist, 'panel.js'), platform: 'browser', format: 'esm', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.woff2': 'dataurl', '.svg': 'dataurl' } });

const client = await build({ entryPoints: [join(root, 'src/client.tsx')], bundle: true, platform: 'browser', format: 'cjs', external: ['react', 'react/jsx-runtime'], jsx: 'automatic', write: false });
await writeFile(join(dist, 'client.js'), `window.__ModuleLoader__.load({id:'dsh-plugin-harmony',factory:(require)=>{const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
await writeFile(join(dist, 'panel.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>鸿蒙设备 · dsh</title><link rel="stylesheet" href="/harmony/panel.css"></head><body><div id="root"></div><script type="module" src="/harmony/panel.js"></script></body></html>');
async function copy(sourceFile, destination) { await mkdir(dirname(destination), { recursive: true }); if (existsSync(destination) && (await readFile(sourceFile)).equals(await readFile(destination))) return; await copyFile(sourceFile, destination); }
for (const file of ['sqlite-inspector.cjs', 'sqlite-error-location.cjs', 'PioraHapSigner.java', 'deveco-password.mjs']) {
  const rel = 'lib/harmony/runtime/' + file; visited.add(rel); await copy(join(source, rel), join(dist, rel));
}
// The native video libraries are packaged resources, not resolved through node_modules layout.
const hypium = dirname(require.resolve('hypium-driver/package.json'));
const resources = join(hypium, 'build/lib/resource');
for (const file of await readdir(resources)) if (/^libscrcpy_server-.*\.so$/.test(file)) await copy(join(resources, file), join(dist, 'resources/hypium', file));
async function copyTree(from, to) {
  for (const item of await readdir(from, { withFileTypes: true })) {
    if (item.name.startsWith('.') || ['node_modules', 'build', 'oh_modules'].includes(item.name)) continue;
    if (item.isDirectory()) await copyTree(join(from, item.name), join(to, item.name));
    else { const path = join(from, item.name); visited.add(relative(source, path).replaceAll('\\', '/')); await copy(path, join(to, item.name)); }
  }
}
await copyTree(join(source, 'third_party/harmony-tools/windows-x64'), join(dist, 'resources/tools/windows-x64'));
await copyTree(join(source, 'third_party/harmony-mirror'), join(dist, 'resources/signing-project'));
const acoustic = 'lib/harmony/audio/acoustic-provider.ps1';
visited.add(acoustic); await copy(join(source, acoustic), join(dist, acoustic));
if (source !== snapshot) {
  for (const rel of visited) await copy(join(source, rel), join(snapshot, rel));
  await copy(join(source, 'LICENSE'), join(root, 'LICENSE'));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  await writeFile(join(root, 'vendor/provenance.json'), JSON.stringify({ source: 'Piora', revision, importedAt: new Date().toISOString(), files: [...visited].sort() }, null, 2));
}
console.log(`Built dsh-plugin-harmony; ${entries.length} API routes, ${visited.size} Piora source files.`);
