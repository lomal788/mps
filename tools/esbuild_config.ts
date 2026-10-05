/**
 * esbuild 공용 설정 — serve.ts(개발)와 build.ts(배포)가 같은 옵션을 쓴다.
 *
 * 경로 규칙(개발·배포 같음):
 *   <root>/index.html          페이지. ./bundle/<엔트리>.js·.css 를 건다
 *   <root>/bundle/             esbuild 출력(엔트리마다 js + import 한 css)
 *   <root>/assets/             변환한 에셋. 코드에서는 `${BASE}assets/…` 로 읽는다(script/env.ts)
 * 개발은 web/ 를 그대로 내주고(bundle/ 만 생성), 배포는 dist/ 에 html·bundle·assets 를 모은다.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions } from "esbuild";

export const WEB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** 페이지 엔트리: 이름 → 스크립트. 이름이 bundle/<이름>.js 가 된다 */
export const ENTRIES: Record<string, string> = {
  main: "script/main.ts",
};

/** 배포 때 dist/ 로 복사할 HTML */
export const PAGES = ["index.html"];

export const DEV_PORT = 51821;

export function options(dev: boolean, outdir: string): BuildOptions {
  return {
    absWorkingDir: WEB,
    entryPoints: Object.entries(ENTRIES).map(([out, src]) => ({
      out,
      in: src,
    })),
    outdir,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: dev ? "inline" : "linked",
    minify: !dev,
    logLevel: "info",
    define: { __DEV__: JSON.stringify(dev) },
  };
}
