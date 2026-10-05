/**
 * hsmg402 캐릭터 — 공용 캐릭터 에셋(assets/chara, web/tools/analysis/hsmg402_web_assets.py: graphics_convert.py mps_pcNN_hsmg402 결과).
 * 로직 state 의 motion(원본 클립 이름, pcNN_ 뺀 것)·motionFrame(원본 프레임)을 그대로 샘플한다(mixer 시간을 직접 맞춘다, 60fps).
 *
 * 원본 그대로 [데이터]:
 *   - 클립 13개(co_idle00·co_walk00·sb_*·co_wriggle00·co_damage02/03·co_win01a/b)의 뼈 애니, motionNext(co_win01a 끝 → co_win01b)
 *   - 뼈 표시 애니(fvbb): 표시 0 구간이 있는 뼈 이름 = 메시 노드 접두(예 요시 facial_00__body_m__mesh)를 그 프레임 값으로 보이기/숨기기
 *   - 눈꺼풀 텍스처 이동(ftsb eye_m texsrt0 이동 0/−2/−4/−6): 눈꺼풀 알베도(가로 = 세로 8배, 2칸 = 한 상태)에서 u′ = (u − tx)·(세로/가로)
 *     [데이터: eye 메시 UV0 범위 0~2 = 셀 2칸, 텍스처 2048×256]
 * 근사 [근사]:
 *   - 재질: material.ts 규칙(glb 텍스처 슬롯 + UV 번호·texsrt + use_*_value·bumpScale·IBL 배율·컬링·섞기) + chara_rad IBL(envMap).
 *     캐릭터 셰이더 그래프의 피부·옷 식(곡률 cvt + 3D LUT 산란, utilitySampler0/1)은 옮기지 않았다 — web/docs/engine/03_graphics.md.
 *     forward_plus_fluid 메시(발·몸 유체 붓)는 숨긴다.
 *   - 눈동자: 눈꺼풀 알베도 알파 0 인 곳(흰자 칸 [데이터: 알파]) = 흰자(utilityColor0) + 눈 알베도(eye_alb, TEXCOORD_1)를 알파로 겹친다. 눈 좌표 =
 *     uv1 − (texsrt1 이동) / uv2(= uv1 자료) − (texsrt2 이동) 중 [0,1] 안에 드는 것 [판독: pc01 eye_m 홍채 두 장 = TEXCOORD_1·srt1, TEXCOORD_2·srt2. v 부호는 Maya 식이면 +ty — 미확정]. 흰자 색 = utilityColor0 [판독].
 *   - 눈 재질 애니 프레임은 화면이 센 "그 모션을 시작한 뒤 프레임"(ftsb 자기 길이로 감음) — 대기 클립 120f 와 ftsb 380f 처럼 길이가 달라서다 [추정].
 *   - 모션 전이 블렌드(chara_pc_anim_transit.mpat)는 하지 않는다(바로 바뀜).
 *   - 피격 깜빡임(blink > 0): 2프레임마다 보이기/숨기기 [근사: 원본 주기 미판독].
 *   - SetSystemScaleVec((2,1,2))·FluidMaterialParamChange·footMaterialOff 는 표현 의미가 미확정이라 그리지 않는다.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Assets } from '../../../view/assets';
import type { PlayerView } from '../state';
import { ctlOf, fresOf } from './material';
import { convertMaterial, paramAt } from './stage';

type ParamValue = number | number[];

export interface MotionEvent {
  frame: number;
  key: string;
  out: ({ kind: 'se'; label: string } | { kind: 'fx'; name: string } | { kind: 'vib'; name: string })[];
}

export interface MotionInfo {
  clip: string;
  frames: number;
  loop: boolean | null;
  eye?: { frames: number; loop: boolean; params: Record<string, Record<string, ParamValue>> };
  vis?: Record<string, [number, number][]>;
  events?: MotionEvent[];
}

export interface CharaIndexEntry {
  key: string;
  name: string;
  glb: string;
  motions: string;
  eyeTex: string | null;
}

interface MotionsJson {
  motions: Record<string, MotionInfo>;
  code: Record<string, { kind: 'se'; label: string }[]>;
}

export class CharacterTemplate {
  private constructor(
    readonly key: string,
    readonly info: CharaIndexEntry,
    readonly gltf: GLTF,
    readonly motions: Record<string, MotionInfo>,
    readonly code: MotionsJson['code'],
    readonly eye: THREE.Texture | null,
  ) {}

  static async load(chara: Assets, key: string, info: CharaIndexEntry): Promise<CharacterTemplate> {
    const [gltf, mj] = await Promise.all([chara.gltf(info.glb), chara.json<MotionsJson>(info.motions)]);
    let eye: THREE.Texture | null = null;
    if (info.eyeTex) {
      try {
        eye = await new THREE.TextureLoader().loadAsync(chara.url(info.eyeTex));
        eye.colorSpace = THREE.SRGBColorSpace;
        eye.flipY = false;
        eye.wrapS = eye.wrapT = THREE.ClampToEdgeWrapping;
      } catch (e) {
        console.warn('눈 텍스처를 읽지 못했다', key, e);
      }
    }
    return new CharacterTemplate(key, info, gltf, mj.motions, mj.code ?? {}, eye);
  }

  dispose(): void {
    this.eye?.dispose();
  }
}

function step(steps: [number, number][], f: number): boolean {
  let v = steps[0][1];
  for (const [fr, val] of steps) {
    if (fr > f) break;
    v = val;
  }
  return v !== 0;
}

const wrap = (f: number, n: number): number => (n > 0 ? ((f % n) + n) % n : 0);

interface EyeUniforms {
  eyeMap: { value: THREE.Texture | null };
  eyeOff0: { value: THREE.Vector2 };
  eyeOff1: { value: THREE.Vector2 };
  eyeOn: { value: number };
  /** 흰자 색 = 재질 utilityColor0 [판독: pc01 eye_m FS — 눈 = mix(utilityColor0, 홍채, 홍채 a), 결과 = mix(눈, 눈꺼풀, 눈꺼풀 a)] */
  eyeWhite: { value: THREE.Vector3 };
}

function eyeMaterial(src: THREE.MeshStandardMaterial, u: EyeUniforms): THREE.MeshStandardMaterial {
  const m = src;
  const prevKey = m.customProgramCacheKey.bind(m);
  const prev = m.onBeforeCompile.bind(m);
  m.customProgramCacheKey = () => `mps-hsmg402-eye|${prevKey()}`;
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vEyeUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvEyeUv = uv1;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D eyeMap;
uniform vec2 eyeOff0;
uniform vec2 eyeOff1;
uniform float eyeOn;
uniform vec3 eyeWhite;
varying vec2 vEyeUv;
float eyeIn(vec2 p) { return step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
if (eyeOn > 0.5) {
  vec2 e0 = vEyeUv - eyeOff0;
  vec2 e1 = vEyeUv - eyeOff1;
  vec4 iris = vec4(0.0);
  if (eyeIn(e0) > 0.5) iris = texture2D(eyeMap, e0);
  else if (eyeIn(e1) > 0.5) iris = texture2D(eyeMap, e1);
  vec3 eyeCol = mix(eyeWhite, iris.rgb, iris.a);
  diffuseColor.rgb = diffuse * mix(eyeCol, sampledDiffuseColor.rgb, sampledDiffuseColor.a);
  diffuseColor.a = opacity;
}
#endif`,
      );
  };
  return m;
}

/** 한 플레이어의 캐릭터 인스턴스 */
export class CharacterActor {
  readonly root = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private readonly ownMats: THREE.Material[] = [];
  private readonly ownTex: THREE.Texture[] = [];
  /** 눈꺼풀 맵(알베도·노멀·거칠기) — texsrt0 이동을 건다 */
  private readonly lidMaps: THREE.Texture[] = [];
  private eyeU: EyeUniforms | null = null;
  /** 뼈 표시 대상 메시: 접두 → 메시 */
  private readonly prefixed = new Map<string, THREE.Object3D[]>();
  private motion = '';
  /** 이 모션을 시작한 뒤 화면이 센 스텝 수(눈 재질 애니용) */
  age = 0;

  constructor(readonly tpl: CharacterTemplate, env: THREE.Texture | null) {
    this.model = cloneSkinned(tpl.gltf.scene);
    this.root.add(this.model);
    const conv = new Map<THREE.Material, THREE.Material | null>();
    const hide: THREE.Object3D[] = [];
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.Material;
      let m = conv.get(src);
      if (m === undefined) {
        m = convertMaterial(src, tpl.info.key);
        if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial && env) (m as THREE.MeshStandardMaterial).envMap = env;
        if (m && src.name === 'eye_m') m = this.makeEye(m as THREE.MeshStandardMaterial);
        conv.set(src, m);
        if (m) this.ownMats.push(m);
      }
      if (!m) {
        hide.push(mesh);
        return;
      }
      mesh.material = m;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const pre = mesh.name.split('__')[0];
      const list = this.prefixed.get(pre) ?? [];
      list.push(mesh);
      this.prefixed.set(pre, list);
    });
    for (const h of hide) h.visible = false;
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of tpl.gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
  }

  private makeEye(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
      const t = m[k];
      if (!t) continue;
      const c = t.clone();
      c.wrapS = THREE.RepeatWrapping;
      /* 재질 변환(material.ts)이 texsrt 행렬을 직접 넣어 matrixAutoUpdate 를 껐다 — 눈꺼풀은 아래 pose 가 repeat·offset 으로 움직인다 */
      c.matrixAutoUpdate = true;
      c.needsUpdate = true;
      m[k] = c;
      this.ownTex.push(c);
      this.lidMaps.push(c);
    }
    if (!this.tpl.eye) return m;
    const uc = fresOf(m).params?.utilityColor0?.value as number[] | undefined;
    const u: EyeUniforms = {
      eyeMap: { value: this.tpl.eye },
      eyeOff0: { value: new THREE.Vector2(2, 0) },
      eyeOff1: { value: new THREE.Vector2(0, 0) },
      eyeOn: { value: 1 },
      eyeWhite: { value: uc ? new THREE.Vector3(uc[0], uc[1], uc[2]) : new THREE.Vector3(1, 1, 1) },
    };
    this.eyeU = u;
    return eyeMaterial(m, u);
  }

  hasMotion(name: string): boolean {
    return !!this.tpl.motions[name] && this.actions.has(this.tpl.motions[name].clip);
  }

  /** 지금 그리는 모션과 그 프레임(motionNext 반영) */
  resolve(p: PlayerView): { name: string; frame: number } {
    let name = this.hasMotion(p.motion) ? p.motion : 'co_idle00';
    let f = p.motionFrame;
    const a = this.tpl.motions[name];
    if (a && a.loop === false && p.motionNext && f >= a.frames && this.hasMotion(p.motionNext)) {
      f -= a.frames;
      name = p.motionNext;
    }
    return { name, frame: f };
  }

  /** 스텝마다(눈 애니 나이) */
  step(p: PlayerView): void {
    const { name } = this.resolve(p);
    if (name !== this.motion) {
      this.motion = name;
      this.age = 0;
    } else this.age++;
  }

  pose(p: PlayerView, frame: number): void {
    const { name, frame: f0 } = this.resolve(p);
    const mi = this.tpl.motions[name];
    if (!mi) return;
    const act = this.actions.get(mi.clip);
    if (!act) return;
    if (act !== this.current) {
      this.current?.stop();
      act.play();
      this.current = act;
    }
    const f = mi.loop !== false ? wrap(f0, mi.frames) : Math.min(Math.max(f0, 0), mi.frames);
    act.time = f / 60;
    this.mixer.update(0);
    /* 뼈 표시(fvbb) */
    if (mi.vis) {
      for (const [bone, steps] of Object.entries(mi.vis)) for (const o of this.prefixed.get(bone) ?? []) o.visible = step(steps, f);
    }
    for (const [pre, list] of this.prefixed) if (!mi.vis?.[pre] && pre.startsWith('facial_')) for (const o of list) o.visible = true;
    /* 눈(ftsb) */
    if (mi.eye) {
      const ef = mi.eye.loop ? wrap(this.age * (p.motionSpeed || 1), mi.eye.frames) : Math.min(this.age, mi.eye.frames);
      const tx0 = paramAt(mi.eye.params.texsrt0?.['0x10'], ef) ?? 0;
      for (const t of this.lidMaps) {
        const img = t.image as { width?: number; height?: number } | undefined;
        const r = img?.width && img.height ? img.height / img.width : 1 / 8;
        t.repeat.set(r, 1);
        t.offset.set(-tx0 * r, 0);
      }
      if (this.eyeU) {
        this.eyeU.eyeOff0.value.set(paramAt(mi.eye.params.texsrt1?.['0x10'], ef) ?? 2, paramAt(mi.eye.params.texsrt1?.['0x14'], ef) ?? 0);
        this.eyeU.eyeOff1.value.set(paramAt(mi.eye.params.texsrt2?.['0x10'], ef) ?? 0, paramAt(mi.eye.params.texsrt2?.['0x14'], ef) ?? 0);
      }
    }
    /* 피격 깜빡임 [근사] */
    this.model.visible = !(p.blink > 0 && Math.floor(frame / 2) % 2 === 1);
    this.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.root.rotation.set(0, p.yaw, 0);
  }

  /** 모션 이벤트(ftrg) — 직전 스텝 프레임 prev 다음부터 cur 까지 지나간 것 */
  eventsBetween(name: string, prev: number, cur: number): MotionEvent[] {
    const mi = this.tpl.motions[name];
    if (!mi?.events) return [];
    const n = mi.frames;
    const out: MotionEvent[] = [];
    const inRange = (a: number, b: number): void => {
      for (const e of mi.events!) if (e.frame > a && e.frame <= b) out.push(e);
    };
    if (mi.loop !== false && n > 0) {
      if (cur - prev >= n) {
        inRange(-1, n);
        return out;
      }
      const a = prev < 0 ? -1 : wrap(prev, n);
      const b = wrap(cur, n);
      if (b >= a) inRange(a, b);
      else {
        inRange(a, n);
        inRange(-1, b);
      }
      return out;
    }
    inRange(prev, cur);
    return out;
  }

  /** 머리 위치(SE·FX 근사 위치) */
  headPos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.root.position.x, this.root.position.y + 1.0, this.root.position.z);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const m of this.ownMats) (ctlOf(m) ?? m).dispose();
    for (const t of this.ownTex) t.dispose();
    this.root.removeFromParent();
  }
}
