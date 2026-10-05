/**
 * 스모크 시험 — 헤드리스 크로미움으로 페이지를 열어 콘솔 오류가 없는지 보고 스크린샷을 남긴다(test/out/smoke/).
 * 게임이 있으면 ?auto=1&fast=… 으로 각 게임을 끝까지 돌려 결과가 나오는지도 본다.
 *
 *   npm run smoke
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { GAMES } from '../script/games';
import { WEB, findChromium, startServer } from './browser';

const OUT = path.join(WEB, 'test', 'out', 'smoke');
fs.mkdirSync(OUT, { recursive: true });

const server = await startServer(5199);
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
try {
  const targets: { name: string; query: string }[] = [{ name: 'index', query: '' }, ...GAMES.map((g) => ({ name: g.id, query: `?game=${g.id}&auto=1&fast=60&mute=1` }))];
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(server.url + t.query);
    await page.waitForFunction(() => 'navigator' in window && (window as unknown as { __mpj?: unknown }).__mpj !== undefined, null, { timeout: 15000 });
    if (t.query) {
      await page.waitForFunction(() => ['done', 'error'].includes((window as unknown as { __mpj: { stage: string } }).__mpj.stage), null, { timeout: 300000 });
    }
    const stage = await page.evaluate(() => (window as unknown as { __mpj: { stage: string } }).__mpj.stage);
    await page.screenshot({ path: path.join(OUT, `${t.name}.png`) });
    const ok = errors.length === 0 && stage !== 'error';
    if (!ok) bad++;
    console.log(`${ok ? '통과' : '실패'} ${t.name} (stage=${stage})${errors.length ? `\n  ${errors.join('\n  ')}` : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exitCode = bad ? 1 : 0;
