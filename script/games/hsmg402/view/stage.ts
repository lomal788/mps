/**
 * hsmg402 무대 — 변환 glb(web/tools/analysis/hsmg402_web_assets.py → assets/hsmg402/model) 를 그리고 조명·안개·IBL·재질 애니를 근사한다.
 *
 * 원본 그대로 쓰는 것 [데이터]:
 *   - 모델·뼈 애니(bg·ice_far·ice_mid 239f, aurora 960f 루프), 텍스처 그림(glb 이미지 = 원본 BNTX 디코드 png)
 *   - 재질 애니 fmab: aurora·sky texsrt 이동(5760f 루프), aurora blendColor.a, snowball_break blendColor.a(50f 1회) — 굽힌 프레임 배열을 프레임대로
 * 근사·미확정 [근사]:
 *   - 재질: material.ts(FresLibrary — 원본 셰이더 판독 규칙, web/docs/engine/03_graphics.md)가 glb extras.fres 와 assets/hsmg402/material/material.json 으로
 *     three 재질을 만든다. 재질 애니(fmab)는 texsrt0~3 전 성분·blendColor 를 재질 조종(MpsMaterialCtl.setAnim)에 그대로 넘긴다.
 *     ocean flowmap_time(물)은 쓰지 않는다.
 *   - 평행광·그림자·IBL(HDR 큐브)·안개는 lighting.ts(StageLighting)가 원본 판독대로 건다 — 판독·근사 목록은 그 파일 머리 주석.
 *     캐릭터는 chara_rad 를 envMap 으로(character.ts). 눈덩이 자체 IBL 은 확산 irr(snowball_irr)만 쓰고 반사 rad 는 장면 큐브로 대신한다.
 *   - 물 반사(ice_rev, render_reflection·반사 뒤집기 y −33)는 그리지 않는다(생략).
 *   - 눈 자국 높이장(hsmg402_fluid: 512², 19×19, 깊이 0.3)은 fluid.ts(SnowFluid)가 원본 판독 식으로 굴리고, 지면 fld_snow_fluid_mt 가
 *     material.ts MPS_FLUID 로 읽는다(정점 변위·노멀·최종 곱). 재질 변환 전에 높이장을 만들어야 지면 재질에 훅이 걸린다(docs/minigame/hsmg402.md 7.5).
 *     그림자 맵에도 같은 변위·앞면을 쓴다(customDepthMaterial = 재질 userData.mpsDepth) — 홈 벽이 홈 바닥에 그늘을 드리운다 [판독 p385 + 추정 컬링].
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../../../view/assets';
import { SnowFluid } from './fluid';
import { type LightingEnv, StageLighting } from './lighting';
import { convertFres, ctlOf, FresLibrary, fresKey, fresOf, setActiveFresLibrary } from './material';

export interface ModelInfo {
  file: string;
  clips: Record<string, { frames: number; loop: boolean | null; kind: string }>;
}

export interface EnvInfo extends LightingEnv {
  post: Record<string, number>;
  lut?: string;
}

export interface Manifest {
  models: Record<string, ModelInfo>;
  anims: Record<string, string>;
  env: EnvInfo;
  effects: { textures: Record<string, string>; fxTriggers: Record<string, string[]>; seTriggers: Record<string, string[]> };
}

type ParamValue = number | number[];
/** fmab JSON(graphics_bfres2gltf anim) 한 재질 애니 */
interface MatAnimJson {
  materialAnims: { name: string; frames: number; loop: boolean; materials: Record<string, { params: Record<string, Record<string, ParamValue>> }> }[];
}

export interface MatAnim {
  frames: number;
  loop: boolean;
  /** 재질 이름 → 파라미터 → 성분 오프셋 → 값 */
  mats: Record<string, Record<string, Record<string, ParamValue>>>;
}

export function paramAt(v: ParamValue | undefined, f: number): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v;
  const n = v.length - 1;
  const x = Math.min(Math.max(f, 0), n);
  const i = Math.floor(x);
  const k = x - i;
  return i >= n ? v[n] : v[i] * (1 - k) + v[i + 1] * k;
}

/** 원본 재질 정보로 three 재질을 만든다(material.ts). key = glb 이름(규칙 표 열쇠). null = 그리지 않음 */
export function convertMaterial(src: THREE.Material, key = ''): THREE.Material | null {
  return convertFres(src, key);
}

/** glb 하나의 인스턴스(재질 변환·재질 애니·뼈 애니) */
export class ModelInst {
  readonly root: THREE.Object3D;
  readonly mats = new Map<string, THREE.Material[]>();
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private clipFrames = 0;
  private clipLoop = true;
  readonly ownMaterials: THREE.Material[] = [];
  readonly ownTextures: THREE.Texture[] = [];

  constructor(gltf: GLTF, info: ModelInfo | undefined, opts: { castShadow?: boolean } = {}) {
    this.root = cloneSkinned(gltf.scene);
    const converted = new Map<THREE.Material, THREE.Material | null>();
    const hide: THREE.Object3D[] = [];
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.Material;
      let m = converted.get(src);
      if (m === undefined) {
        m = convertMaterial(src, info ? fresKey(info.file) : '');
        converted.set(src, m);
        if (m) {
          this.ownMaterials.push(m);
          const list = this.mats.get(m.name) ?? [];
          list.push(m);
          this.mats.set(m.name, list);
        }
      }
      if (!m) {
        hide.push(mesh);
        return;
      }
      mesh.material = m;
      const ri = fresOf(m).renderInfo ?? {};
      const opt = fresOf(m).shader?.options ?? {};
      mesh.castShadow = (opts.castShadow ?? true) && ri.cast_shadow?.[0] === 1;
      mesh.receiveShadow = opt.receive_shadow === '1';
      const depth = m.userData.mpsDepth as THREE.Material | undefined;
      if (depth && mesh.castShadow) mesh.customDepthMaterial = depth;
      mesh.frustumCulled = false;
    });
    for (const h of hide) h.visible = false;
    const clipName = info ? Object.keys(info.clips)[0] : undefined;
    const clip = clipName ? gltf.animations.find((a) => a.name === clipName) : undefined;
    if (clip && info) {
      this.mixer = new THREE.AnimationMixer(this.root);
      this.action = this.mixer.clipAction(clip);
      this.action.play();
      this.clipFrames = info.clips[clipName!].frames;
      this.clipLoop = info.clips[clipName!].loop !== false;
    }
  }

  /** 뼈 애니를 원본 프레임 f 로(루프면 감는다) */
  setSkelFrame(f: number): void {
    if (!this.mixer || !this.action) return;
    const n = this.clipFrames;
    const x = this.clipLoop ? ((f % n) + n) % n : Math.min(Math.max(f, 0), n);
    this.action.time = x / 60;
    this.mixer.update(0);
  }

  /** 재질 애니(texsrt0~3 성분, blendColor)를 프레임 f 로 — 값은 재질 조종(material.ts)이 셰이더 행렬·색에 건다 */
  applyMatAnim(a: MatAnim, f: number): void {
    const x = a.loop ? ((f % a.frames) + a.frames) % a.frames : Math.min(Math.max(f, 0), a.frames);
    for (const [name, params] of Object.entries(a.mats)) {
      const list = this.mats.get(name);
      if (!list) continue;
      for (const m of list) {
        const ctl = ctlOf(m);
        if (!ctl) continue;
        for (const [param, chans] of Object.entries(params))
          for (const [off, v] of Object.entries(chans)) {
            if (off === '0x00' && param.startsWith('texsrt')) continue;
            const val = paramAt(v, x);
            if (val !== undefined) ctl.setAnim(param, off, val);
          }
      }
    }
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    for (const m of this.ownMaterials) {
      (m.userData.mpsDepth as THREE.Material | undefined)?.dispose();
      (ctlOf(m) ?? m).dispose();
    }
    for (const t of this.ownTextures) t.dispose();
  }
}

export async function loadMatAnim(assets: Assets, path: string): Promise<MatAnim | null> {
  try {
    const d = await assets.json<MatAnimJson>(path);
    const a = d.materialAnims[0];
    if (!a) return null;
    const mats: MatAnim['mats'] = {};
    for (const [k, v] of Object.entries(a.materials)) mats[k] = v.params;
    return { frames: a.frames, loop: a.loop, mats };
  } catch (e) {
    console.warn('재질 애니를 읽지 못했다', path, e);
    return null;
  }
}

/** 6면 png → CubeTexture */
export function loadCube(assets: Assets, faces: string[]): Promise<THREE.CubeTexture> {
  return new THREE.CubeTextureLoader().loadAsync(faces.map((f) => assets.url(f))).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

const STAGE_LOOP = ['hsmg402_sky', 'hsmg402_bg', 'hsmg402_ice_far', 'hsmg402_ice_mid', 'hsmg402_ice_fix', 'hsmg402_aurora', 'hsmg402_fld', 'hsmg402_fld_cliff'];
/** 무대 모델 → 재질 애니 파일 */
const STAGE_MATANIM: Record<string, string> = { hsmg402_aurora: 'hsmg402_aurora.fmab', hsmg402_sky: 'hsmg402_sky.fmab' };

export class Stage {
  readonly models: ModelInst[] = [];
  private readonly matAnims = new Map<ModelInst, MatAnim>();
  /** 평행광·그림자·IBL·안개(lighting.ts) */
  readonly lighting: StageLighting;
  /** 재질 규칙·glb 밖 텍스처(material.ts) */
  private matLib: FresLibrary | null = null;
  /** 눈 자국 높이장(fluid.ts) */
  readonly fluid = new SnowFluid();
  charaEnv: THREE.Texture | null = null;
  loaded = false;

  constructor(private readonly scene: THREE.Scene) {
    this.lighting = new StageLighting(scene);
  }

  async load(assets: Assets, man: Manifest, gl: THREE.WebGLRenderer, progress: (n: number, total: number, s: string) => void): Promise<void> {
    await this.lighting.load(assets, man.env, gl);
    this.charaEnv = this.lighting.charaEnv;
    try {
      const lib = new FresLibrary((p) => assets.url(p));
      await lib.load((p) => assets.json(p));
      this.matLib = lib;
      setActiveFresLibrary(lib);
    } catch (e) {
      console.warn('재질 자료(material/material.json)를 읽지 못해 기본 규칙만 쓴다', e);
    }
    try {
      await this.fluid.load(assets, gl);
    } catch (e) {
      console.warn('눈 자국 높이장(fluid/fluid.json)을 만들지 못해 평평한 지면으로 그린다', e);
    }
    let n = 0;
    for (const name of STAGE_LOOP) {
      progress(n++, STAGE_LOOP.length, `model/${name}.glb`);
      const info = man.models[name];
      if (!info) continue;
      try {
        const g = await assets.gltf(info.file);
        const inst = new ModelInst(g, info);
        this.models.push(inst);
        this.scene.add(inst.root);
        const ma = STAGE_MATANIM[name];
        if (ma && man.anims[ma]) {
          const a = await loadMatAnim(assets, man.anims[ma]);
          if (a) this.matAnims.set(inst, a);
        }
        /* 하늘·구름은 그림자를 드리우지 않는다 */
        if (name === 'hsmg402_sky' || name === 'hsmg402_aurora') inst.root.traverse((o) => (o.castShadow = false));
      } catch (e) {
        console.warn('무대 모델을 읽지 못했다', name, e);
      }
    }
    this.loaded = this.models.length > 0;
  }

  /** 프레임 f(장면 시작부터) — 루프 뼈 애니·재질 애니 */
  update(frame: number): void {
    for (const m of this.models) {
      m.setSkelFrame(frame);
      const a = this.matAnims.get(m);
      if (a) m.applyMatAnim(a, frame);
    }
  }

  dispose(): void {
    for (const m of this.models) m.dispose();
    this.models.length = 0;
    this.fluid.dispose();
    this.lighting.dispose();
    setActiveFresLibrary(null);
    this.matLib?.dispose();
    this.matLib = null;
  }
}
