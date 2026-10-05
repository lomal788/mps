/**
 * 개발 서버 — esbuild watch + serve. web/ 전체를 정적으로 내주고 bundle/ 만 다시 만든다.
 * 고치면 다시 빌드하고, 페이지는 /esbuild 변경 알림을 받아 새로 고친다(script/main.ts 의 __DEV__ 블록).
 *
 *   npm run dev                  http://localhost:51821/
 *   npx tsx tools/serve.ts --port 5190
 */
import path from "node:path";
import { context } from "esbuild";
import { DEV_PORT, WEB, options } from "./esbuild_config";

function argValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const port = Number(argValue("--port") ?? DEV_PORT);
const ctx = await context(options(true, path.join(WEB, "bundle")));
await ctx.watch();
const { hosts, port: realPort } = await ctx.serve({ servedir: WEB, port });
console.log(
  `개발 서버: http://localhost:${realPort}/ (네트워크: ${hosts.join(", ")})`,
);
