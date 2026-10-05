/**
 * 실행 환경 상수 — vite 의 import.meta.env 대신 쓴다.
 * __DEV__ 는 esbuild define 으로 들어온다(tools/esbuild_config.ts). 노드(tsx)에서 로직만 돌릴 때는 정의되지 않으므로 typeof 로 확인한다.
 */
declare const __DEV__: boolean | undefined;

/** 개발 서버 빌드인지 */
export const DEV: boolean = typeof __DEV__ !== 'undefined' && __DEV__;

/** 페이지 기준 경로. 개발·배포 모두 상대 경로라 './' 로 고정한다 */
export const BASE = './';

/** 에셋 루트(web/assets 가 페이지 옆 assets/ 로 나간다) */
export const ASSETS = `${BASE}assets/`;
