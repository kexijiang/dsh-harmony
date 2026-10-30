import { harness } from '../tests/harness.mjs';
const h = await harness({ fake: process.argv.includes('--fixture') });
console.log(h.origin + '/harmony/');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => void h.close().then(() => process.exit(0)));
