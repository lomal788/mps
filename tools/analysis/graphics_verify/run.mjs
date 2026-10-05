// Bundle a TS entry with esbuild (taken from web/node_modules, nothing installed here) and run it in node.
// usage: node web/tools/analysis/graphics_verify/run.mjs <entry.ts> [args...]
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const webModules = process.env.WEB_MODULES || path.resolve(here, '../../../node_modules'); // [mps] mps 에는 web/node_modules 가 없어 mpj 것을 읽기 전용으로 쓴다(WEB_MODULES)
const require = createRequire(path.join(webModules, 'x.js'));
const esbuild = require('esbuild');
const entry = path.resolve(process.argv[2]);
const out = path.join(here, 'out', path.basename(entry).replace(/\.ts$/, '.mjs'));
await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, nodePaths: [webModules], logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
process.argv.splice(2, 1);
await import(pathToFileURL(out).href);
