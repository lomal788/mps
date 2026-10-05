/**
 * hsmg402 이펙트 — 원본 이미터 수치(VFXB v40)로 돌린다. 런타임은 view/vfx.ts(엔진층), 여기는 FX 트리거 → 이미터셋 → 붙는 곳 연결만.
 * 근거: web/docs/engine/08_effects.md, web/docs/minigame/hsmg402.md 7.6. 자료: assets/hsmg402/effect/sets.json(web/tools/analysis/hsmg402_web_assets.py).
 *
 * 트리거 → 이미터셋·대상 노드 [데이터: ftrg +14·+34·+50]
 *   INITIALIZE(field, 무대 원점)   hsmg402_map_field00·map_snow00(눈보라 13)·map_star00(별 3)·map_star01(유성 + 자식 꼬리)
 *   SNOWBALL_*(hsmg402_snowball 모델) appear00·max00·move0N·throw0N·fall00, BREAK0N 은 hsmg402_snowball_break 모델 — 둘 다 공 중심·공 크기 배율
 *   SNOW_MAKE00·SNOW_BREATH00(NDcha_pos = 캐릭터 발밑 원점 노드, 캐릭터 방향 포함), SNOW_FALL00(attach_body) — hs_system 공용 fx_pc_snow_*
 * 원본 그대로: 트리거 _Stop 은 이미터셋 Stop(방출 중단·페이드 아웃 플래그면 사라짐), 한 번짜리는 다 끝나면 스스로 지운다.
 * [추정] 이미터셋 행렬 = 대상 노드 월드 행렬(공은 위치 + 균일 배율 b.scale, 회전 없음 — 굴림 회전은 모델 안쪽 노드라고 봄).
 *   근거: move 트레일 이미터 위치 y = −1.0 이 공 배율을 받아야 늘 지면(공 중심 1.1·s − 1.0·s ≈ 0.1·s)에 닿는다 [산술].
 * [미확정] 트리거 +78~+90 칸(MOVE00 만 +88~+90 = 10.0)의 뜻 — 쓰지 않는다.
 * 원본 텍스처 그림은 바꾸지 않는다(BNTX 디코드 png 그대로, sRGB/선형만 형식대로).
 */
import * as THREE from 'three';
import type { V3 } from '../../../core/fmath';
import type { Assets } from '../../../view/assets';
import { type VfxSetInstance, type VfxSetsFile, VfxSystem } from '../../../view/vfx';

export interface EffectsManifest {
  textures: Record<string, string>;
  fxTriggers: Record<string, string[]>;
  sets?: string;
}

/** 붙는 곳: 매 프레임 월드 행렬을 돌려준다(null 이면 마지막 값 유지) */
export type Anchor = () => THREE.Matrix4 | null;

interface Live {
  sets: VfxSetInstance[];
  anchor: Anchor;
}

const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

/** 위치 + 균일 배율(+ Y 회전) 행렬 */
export function poseMatrix(out: THREE.Matrix4, pos: V3, scale = 1, yaw = 0): THREE.Matrix4 {
  tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
  return out.compose(tmpP.set(pos.x, pos.y, pos.z), tmpQ, tmpS.setScalar(scale));
}

export class Effects {
  private readonly sys: VfxSystem;
  private file: VfxSetsFile | null = null;
  private fxTriggers: Record<string, string[]> = {};
  private readonly live = new Map<string, Live>();
  private oneShot = 0;
  private lastFrame = -1;
  loaded = false;

  constructor(scene: THREE.Scene) {
    this.sys = new VfxSystem(scene);
  }

  async load(assets: Assets, man: EffectsManifest): Promise<void> {
    if (!man.sets) throw new Error('manifest.effects.sets 없음 — web/tools/analysis/hsmg402_web_assets.py --only-effects 로 다시 만들 것');
    const file = await assets.json<VfxSetsFile>(man.sets);
    const urls: Record<string, string> = {};
    for (const [k, f] of Object.entries(man.textures)) urls[k] = assets.url(f);
    await this.sys.load(file, urls);
    this.file = file;
    this.fxTriggers = man.fxTriggers;
    this.loaded = true;
  }

  /** 트리거 이름(SNOWBALL_MOVE01 등) 또는 이미터셋 이름 → 이미터셋 목록 */
  private setsOf(name: string): string[] {
    const t = this.file?.triggers[name];
    if (t) return t.sets;
    const f = this.fxTriggers[name];
    if (f) return f.map((x) => x.replace(/\.eset$/, ''));
    return this.file?.sets[name] ? [name] : [];
  }

  /** 트리거의 대상 노드 이름(ftrg +34) */
  target(name: string): string | null {
    return this.file?.triggers[name]?.target ?? null;
  }

  /** INITIALIZE(field) — 무대 상시 [판독: 문자열 INITIALIZE] */
  startField(): void {
    if (!this.loaded || this.live.has('field')) return;
    const m = new THREE.Matrix4();
    this.play('field', 'INITIALIZE', () => m);
  }

  /** key 로 재생(같은 key 가 살아 있으면 먼저 Stop) */
  play(key: string, name: string, anchor: Anchor): void {
    if (!this.loaded) return;
    this.stop(key);
    const sets: VfxSetInstance[] = [];
    for (const s of this.setsOf(name)) {
      const inst = this.sys.create(s);
      if (!inst) continue;
      const m = anchor();
      if (m) inst.anchor.copy(m);
      sets.push(inst);
    }
    if (sets.length) this.live.set(key, { sets, anchor });
  }

  /** _Stop — 방출을 멈추고 남은 입자는 원본 규칙대로 끝까지(페이드 아웃 플래그면 사라짐) */
  stop(key: string): void {
    const l = this.live.get(key);
    if (!l) return;
    for (const s of l.sets) s.stop();
    this.live.delete(key);
    this.live.set(`${key}#stopped${this.oneShot++}`, l);
  }

  /** 한 번 재생(주인이 따로 멈추지 않는 것) */
  spawn(name: string, at: V3 | Anchor): void {
    const anchor: Anchor = typeof at === 'function' ? at : ((m) => () => m)(poseMatrix(new THREE.Matrix4(), at));
    this.play(`once${this.oneShot++}`, name, anchor);
  }

  /** frame = 로직 프레임(60fps). 지난 호출 이후 지난 프레임 수만큼 원본 1프레임 단위로 진행 */
  update(_dt: number, frame: number): void {
    if (!this.loaded) return;
    const steps = this.lastFrame < 0 ? 1 : Math.max(0, Math.min(10, frame - this.lastFrame));
    this.lastFrame = frame;
    for (const [key, l] of this.live) {
      const m = l.anchor();
      if (m) for (const s of l.sets) s.anchor.copy(m);
      if (l.sets.every((s) => s.done)) this.live.delete(key);
    }
    this.sys.update(steps);
  }

  /** 디버그: 살아 있는 이미터셋 수 */
  get count(): number {
    return this.sys.liveCount;
  }

  dispose(): void {
    this.live.clear();
    this.sys.dispose();
  }
}
