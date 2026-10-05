/**
 * 배포 빌드 — dist/ 에 HTML·bundle·assets 를 모은다. 상대 경로만 쓰므로 dist/ 를 어느 경로에 올려도 된다.
 *
 *   npm run build                (tsc --noEmit 뒤 이 스크립트)
 */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { PAGES, WEB, options } from './esbuild_config';

const DIST = path.join(WEB, 'dist');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
await build(options(false, path.join(DIST, 'bundle')));
for (const page of PAGES) fs.copyFileSync(path.join(WEB, page), path.join(DIST, page));
const assets = path.join(WEB, 'assets');
if (fs.existsSync(assets)) fs.cpSync(assets, path.join(DIST, 'assets'), { recursive: true });
console.log(`배포 빌드 완료: ${DIST}`);
