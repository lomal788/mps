import path from 'node:path';
import { chromium } from 'playwright-core';
import { WEB, findChromium, startServer } from '../../tools/browser';
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
page.on('requestfailed', (r) => errs.push('reqfail ' + r.url()));
await page.goto(server.url + '?game=hsmg402&auto=1&fast=1&mute=1&seed=7&com=1111');
await page.waitForFunction(() => ['running', 'error'].includes((window as any).__mpj?.stage), null, { timeout: 300000 });
console.log('stage', await page.evaluate(() => (window as any).__mpj.stage), await page.evaluate(() => (window as any).__mpj.error));
for (const f of [60, 200, 700, 1500, 2600]) {
  await page.evaluate((n) => (window as any).__mpj.hold(n), f);
  await page.waitForFunction((n) => (window as any).__mpj.frame >= n || ['done', 'error'].includes((window as any).__mpj.stage), f, { timeout: 900000 });
  await page.waitForTimeout(1200);
  const box = await page.locator('canvas.jw-gl').boundingBox();
  await page.screenshot({ path: path.join(WEB, 'test', 'out', `hsmg402_f${f}.png`), clip: box! });
  console.log('shot', f, await page.evaluate(() => [(window as any).__mpj.frame, (window as any).__mpj.stage]));
}
console.log('errors', errs.slice(0, 15));
await browser.close(); await server.close();
