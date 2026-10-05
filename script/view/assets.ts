/**
 * 에셋 읽기 — 게임마다 assets/<게임>/manifest.json 이 입구다(assets/README.md).
 * 같은 경로는 한 번만 읽는다. 진행 표시는 load 단계에서 Progress 로 알린다.
 */
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ASSETS } from '../env';
import { disposeTree, type Seen } from './dispose';

/** (읽은 수, 전체, 지금 항목) */
export type Progress = (n: number, total: number, label: string) => void;

export class Assets {
  private readonly cache = new Map<string, Promise<unknown>>();
  private gltfLoader: GLTFLoader | null = null;
  private readonly subs: Assets[] = [];

  /** dir: ASSETS 기준 게임 폴더(끝에 '/') */
  constructor(readonly dir: string) {}

  url(path: string): string {
    return new URL(`${ASSETS}${this.dir}${path}`, document.baseURI).href;
  }

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    let p = this.cache.get(key) as Promise<T> | undefined;
    if (!p) {
      p = load();
      this.cache.set(key, p);
    }
    return p;
  }

  private async fetchOk(path: string): Promise<Response> {
    const r = await fetch(this.url(path));
    if (!r.ok) throw new Error(`에셋을 읽지 못했다: ${path} (${r.status})`);
    return r;
  }

  json<T>(path: string): Promise<T> {
    return this.once(`json:${path}`, async () => (await this.fetchOk(path)).json() as Promise<T>);
  }

  bytes(path: string): Promise<ArrayBuffer> {
    return this.once(`bin:${path}`, async () => (await this.fetchOk(path)).arrayBuffer());
  }

  gltf(path: string): Promise<GLTF> {
    return this.once(`gltf:${path}`, () => {
      this.gltfLoader ??= new GLTFLoader();
      return this.gltfLoader.loadAsync(this.url(path));
    });
  }

  /** 하위 폴더(공용 캐릭터 등) */
  sub(dir: string): Assets {
    const a = new Assets(dir);
    this.subs.push(a);
    return a;
  }

  /** 읽어 둔 glTF 의 GPU 자원을 풀고 캐시를 비운다(게임 화면 dispose 가 부른다). 아직 읽는 중인 것은 끝난 뒤 푼다 */
  dispose(seen: Seen = new Set()): void {
    for (const [key, p] of this.cache) {
      if (!key.startsWith('gltf:')) continue;
      (p as Promise<GLTF>).then((g) => disposeTree(g.scene, seen)).catch(() => undefined);
    }
    this.cache.clear();
    for (const a of this.subs) a.dispose(seen);
    this.subs.length = 0;
  }
}
