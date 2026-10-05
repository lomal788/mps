/**
 * 헤드리스 브라우저 도구 공용 — 크로미움 찾기와 시험용 esbuild 서버.
 * 크로미움: 환경 변수 PW_CHROMIUM, 없으면 %LOCALAPPDATA%/ms-playwright/chromium-*\/chrome-win*\/chrome.exe 중 최신.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { context } from 'esbuild';
import { WEB, options } from './esbuild_config';

export { WEB };

export function findChromium(): string {
  const env = process.env.PW_CHROMIUM;
  if (env && fs.existsSync(env)) return env;
  const root = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)) : [];
  dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    for (const sub of ['chrome-win64', 'chrome-win', 'chrome-linux', 'chrome-linux64']) {
      for (const exe of ['chrome.exe', 'chrome']) {
        const p = path.join(root, d, sub, exe);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error('크로미움을 찾지 못했다. PW_CHROMIUM 을 지정하거나 npx playwright install chromium');
}

/** bundle/ 을 한 번 빌드하고 web/ 를 내주는 서버. close() 로 닫는다 */
export async function startServer(port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const ctx = await context({ ...options(true, path.join(WEB, 'bundle')), logLevel: 'warning' });
  await ctx.rebuild();
  const { port: real } = await ctx.serve({ servedir: WEB, port });
  return { url: `http://127.0.0.1:${real}/`, close: () => ctx.dispose() };
}
