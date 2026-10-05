/**
 * nn::vfx2 이미터셋 런타임 (mps VFXB v40) — 원본 이미터 수치(assets/<게임>/effect/sets.json, web/tools/analysis/effect_vfxb.py v40 배치)로 입자를 낸다.
 * 근거와 확정 수준은 web/docs/engine/08_effects.md(4.3 필드 표, 6 계산식). 요약:
 *
 * [판독: main nn::vfx2, analysis/decomp/vfx40_*.c]
 *   - 방출 창: 시작 = start(+0x87C), one-time 은 start+duration(+0x884) 전까지(한 번도 안 냈으면 한 번은 낸다). 자식은 부모 입자 수명 × timing%(+0x880)
 *   - 방출 간격: 타이머·간격 초기값 = interval(+0x890)+1 → 첫 허용 프레임에 바로 낸다. 낸 뒤 간격 = interval+1+floor(u·intervalRandom)
 *     간격마다 rate(+0x888)·(100 − rateRandom(+0x88C)·u)/100 누적(분할 볼륨이면 rateRandom 없음), 첫 방출은 최소 1개, 정수부만큼 만든다
 *     분할 볼륨(CircleDiv·SphereDiv·SphereDiv64·LineDiv 이고 primEmitType(+0x8FC)=0)이면 한 번에 × 분할 수(+0x908/+0x910)
 *   - 입자 초기값: 속도 = 볼륨 법선·allDirection + 지정 방향·designatedDirScale, × (1 − u·velRandom/100), + 단위 랜덤 ⊙ diffusion
 *     크기 = 기본 × (1 − u·scaleRandom/100)(X·Y 랜덤이 같으면 한 난수), 운동량 = 1 + m − 2m·u, 수명 = L·(1 − floor(u·lifeRandom)/100)
 *     위치 += 단위 랜덤 × positionRandom(+0x898), 무한 수명(+0x930)이면 2.68e8 프레임
 *   - CPU 입자 갱신(FUN_71009fe0e0): pos += vel·운동량, vel ×= airRes^dt(+0xC0), vel += 중력(emission +0x8A0 방향 × +0x89C)·dt
 *     랜덤 필드 FRND: 축마다 위치 += amp·(N(x1) − N(x0)), N(x)=Σ A_i·sin(x/P_i), x = (나이 + u_c·I)·2π/I (I = 간격 +0x10)
 *     스핀 필드 FSPN: 위치를 축(0 X,1 Y,2 Z) 둘레로 speed·운동량 만큼 매 프레임 돌린다
 *   - 색·알파 키(FUN_71009febb0·FUN_71009fc110): 타입 0 상수, 2 = 키 보간(첫 키 앞은 첫 값, 끝 키 뒤는 끝 값, 보간 0 선형·1 계단), 3 = 키 중 무작위 하나
 *     루프(+0x960~)면 t = fmod(rate·u·loopRandom + 나이, rate)/rate
 *   - 정지(Stop): isFadeEmit(+0x7D8)이면 방출 중단. 페이드 아웃 플래그(+0x7DB/+0x7DC)면 alphaFadeTime(+0x7E8) 동안 1→0 뒤 이미터 삭제
 *   - 난수: 이미터마다 LCG x = x·0x41C64E6D + 0x3039, u = x·2⁻³²
 * [추정] (GPU 셰이더라 미판독): 크기 키 보간, 회전 = 초기 + 속도·나이, 흔들림(Fluctuation) 사인 곱, 텍스처 패턴(4 = 무작위 칸),
 *   빌보드 사각형 한 변 = 크기(±0.5), 이미터셋 행렬의 배율은 위치·속도에만(입자 크기에는 안 곱함), 색 = 텍스처 × color0 × colorScale,
 *   GPU 이미터(calcType 1·2)도 CPU 식과 같다고 봄, 볼륨 모양 표본(원·구·상자의 각도 기준), EA** 이미터 애니는 EAET(이동)만.
 * [근사]: 두 번째 이후 텍스처·커스텀 셰이더(CSDP)·소프트 파티클·빌보드 0 이외 종류·자식 이미터 상속 플래그는 쓰지 않는다.
 */
import * as THREE from 'three';

// ---------------------------------------------------------------- sets.json 형식 (web/tools/analysis/effect_vfxb.py summarize + summarize_v40)
type Key = [number, number, number, number];

export interface EmitterSummary {
  name: string;
  calcType: number;
  followType: number;
  emission: { isOneTime: boolean; start: number; timing: number; duration: number; rate: number; rateRandom: number; interval: number; intervalRandom: number; positionRandom: number; isWorldGravity: boolean };
  shape: {
    volumeType: number;
    sweepStart: number;
    sweepLongitude: number;
    sweepLatitude: number;
    caliberRatio: number;
    volumeRadiusX: number;
    volumeRadiusY: number;
    volumeRadiusZ: number;
    volumeFormScaleX: number;
    volumeFormScaleY: number;
    volumeFormScaleZ: number;
    numDivideCircle: number;
    lineLength: number;
    lineCenter: number;
  };
  shape2: { arcType: number; sweepStartRandom: number; isVolumeLatitudeEnabled: number; primEmitType: number; numDivideLine: number };
  emitterTRS: { transX: number; transY: number; transZ: number; rotateX: number; rotateY: number; rotateZ: number; scaleX: number; scaleY: number; scaleZ: number };
  emitterColor0: number[];
  life: number;
  lifeRandom: number;
  infiniteLife: boolean;
  billboardType: number;
  momentumRandom: number;
  velocity: {
    allDirection: number;
    designatedDirScale: number;
    designatedDirX: number;
    designatedDirY: number;
    designatedDirZ: number;
    diffusionDirAngle: number;
    diffusionX: number;
    diffusionY: number;
    diffusionZ: number;
    velRandom: number;
  };
  gravity: { emissionGravityScale: number; emissionGravityDir: number[] };
  airRes: number;
  rotateInit: number[];
  rotateInitRand: number[];
  rotateAdd: number[];
  rotateAddRand: number[];
  rotateFlags: { isRotateZ: number; rotRevRandZ: boolean };
  color: {
    types: number[];
    color0: number[];
    alpha0: number;
    colorScale: number;
    color0Keys: Key[];
    alpha0Keys: Key[];
  };
  scale: { base: number[]; random: number[]; keys: Key[] };
  render: { blendType: number; isDepthTest: boolean; isAlphaTest: boolean; alphaThreshold: number };
  combiner: { color0Interp?: number; alpha0Interp?: number; scaleInterp?: number };
  samplers: { slot: number; texture: string; wrapU: number; wrapV: number; file: string }[];
  texUv: { slot: number; repeat: number }[];
  texPatternV40: { type: number; num: number; frequency: number; numRandom: number; table: number[]; div: number[] }[];
  fade: { isFadeEmit: number; isAlphaFadeIn: number; isScaleFadeIn: number; isAlphaFadeOut: number; isScaleFadeOut: number; alphaFadeTime: number; fadeInTime: number };
  loop: { loopColor0: boolean; loopAlpha0: boolean; scaleLoop: boolean; loopRandomColor0: boolean; loopRandomAlpha0: boolean; scaleLoopRandom: boolean; color0LoopRate: number; alpha0LoopRate: number; scaleLoopRate: number };
  fluctuation: { isApplyAlpha?: number; isApplyScale?: number; amplitudeX?: number; amplitudeY?: number; cycleX?: number; cycleY?: number; phaseRndX?: number; phaseRndY?: number; phaseInitX?: number; phaseInitY?: number };
}

export interface Subsection {
  magic: string;
  /* FRND */
  mode?: number;
  customTable?: number;
  airMode?: number;
  amp?: number[];
  interval?: number;
  amps?: number[];
  periods?: number[];
  /* FSPN */
  speed?: number;
  axis?: number;
  /* EA** */
  enable?: number;
  loop?: number;
  keys?: Key[];
}

export interface EmitterDef {
  summary: EmitterSummary;
  subsections: Subsection[];
  children: EmitterDef[];
}

export interface VfxSetsFile {
  triggers: Record<string, { target: string; sets: string[]; params: number[] }>;
  textures: Record<string, { srgb: boolean; format: string }>;
  sets: Record<string, { source: string; emitters: EmitterDef[] }>;
}

// ---------------------------------------------------------------- 수학
/** 키 보간 FUN_71009fc110 [판독]: 키 하나면 그 값, 첫 키 시각 앞이면 첫 값, 끝 키 시각 이상이면 끝 값, 사이는 mode 0 선형·1 계단 */
function keyEval(keys: Key[], t: number, mode: number, out: number[]): number[] {
  const n = keys.length;
  if (n === 0) return out;
  if (n === 1 || t < keys[0][3]) {
    out[0] = keys[0][0];
    out[1] = keys[0][1];
    out[2] = keys[0][2];
    return out;
  }
  const last = keys[n - 1];
  if (last[3] <= t) {
    out[0] = last[0];
    out[1] = last[1];
    out[2] = last[2];
    return out;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a[3] && t < b[3]) {
      if (mode === 1) {
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
      } else {
        const f = (t - a[3]) / (b[3] - a[3]);
        out[0] = a[0] + (b[0] - a[0]) * f;
        out[1] = a[1] + (b[1] - a[1]) * f;
        out[2] = a[2] + (b[2] - a[2]) * f;
      }
      return out;
    }
  }
  return out;
}

/** 랜덤 필드 노이즈 FUN_7100a01400 [판독]: Σ A_i·sin(x / P_i), 기본 A = 4,3,2,1.5, P = 0.6,0.42,0.23,0.15 */
const NOISE_A = [4, 3, 2, 1.5];
const NOISE_P = [0.6, 0.42, 0.23, 0.15];
function noise(x: number, amps: number[], periods: number[]): number {
  let s = 0;
  for (let i = 0; i < 4; i++) s += amps[i] * Math.sin(x / periods[i]);
  return s;
}

/** 이미터 LCG [판독] */
class Lcg {
  constructor(private x: number) {}
  u(): number {
    const r = this.x >>> 0;
    this.x = (Math.imul(this.x, 0x41c64e6d) + 0x3039) >>> 0;
    return r / 4294967296;
  }
  /** (u32 × n) >> 32 — 원본이 정수 퍼센트·간격 랜덤에 쓰는 꼴 */
  int(n: number): number {
    return Math.floor(this.u() * n);
  }
}

let seedCounter = 0x1234567;

// ---------------------------------------------------------------- 입자
interface EmitState {
  timer: number;
  step: number;
  accum: number;
  emitted: boolean;
}

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  sx: number;
  sy: number;
  rot: number;
  rotV: number;
  mom: number;
  cell: number;
  colorKey: number;
  rnd: number;
  flucPhaseX: number;
  flucPhaseY: number;
  noisePhase: [number, number, number];
  /** 태어날 때 이미터 월드 행렬(followType 1·2) */
  birth: THREE.Matrix4;
  /** 자식 이미터 방출 상태(부모 입자마다) */
  child?: (EmitState & { time: number })[];
  world: THREE.Vector3;
}

const BLEND: Record<number, Partial<THREE.MaterialParameters>> = {
  /* 0 일반 알파, 1 가산, 2 감산, 3 곱, 4 스크린 — EffectLibrary 열거 순서 [추정: mpj 08 4.4 와 같음] */
  0: { blending: THREE.NormalBlending },
  1: { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor },
  2: { blending: THREE.CustomBlending, blendEquation: THREE.ReverseSubtractEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor },
  3: { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.OneMinusSrcAlphaFactor },
  4: { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneMinusDstColorFactor, blendDst: THREE.OneFactor },
};

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec3 iSize;
attribute vec4 iUv;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float s = sin(iSize.z);
  float c = cos(iSize.z);
  vec2 q = position.xy * iSize.xy;
  mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  gl_Position = projectionMatrix * mv;
  vUv = iUv.xy + (position.xy + 0.5) * iUv.zw;
  vColor = iColor;
}`;
const FRAG = /* glsl */ `
uniform sampler2D map;
uniform float alphaRef;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 c = texture2D(map, vUv) * vColor;
  if (c.a <= alphaRef) discard;
  gl_FragColor = c;
  #include <colorspace_fragment>
}`;

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const keyOut = [0, 0, 0];
const MAX_PARTICLES = 6000;

/** 이미터 하나(자식 포함)의 런타임 */
class EmitterInst {
  readonly s: EmitterSummary;
  readonly particles: Particle[] = [];
  readonly children: EmitterInst[];
  private readonly rng: Lcg;
  time = 0;
  /** 방출 상태(타이머·간격·누적·한 번이라도 냈는지) */
  private readonly st: EmitState;
  stopped = false;
  private fadeOut = 1;
  private fadeIn: number;
  dead = false;
  private readonly frnd: Subsection | undefined;
  private readonly fspn: Subsection | undefined;
  private readonly eaet: Subsection | undefined;
  readonly world = new THREE.Matrix4();
  private readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private cap = 0;
  private aPos!: THREE.InstancedBufferAttribute;
  private aColor!: THREE.InstancedBufferAttribute;
  private aSize!: THREE.InstancedBufferAttribute;
  private aUv!: THREE.InstancedBufferAttribute;
  private readonly divided: boolean;
  private readonly pat: EmitterSummary['texPatternV40'][number] | undefined;
  private readonly repeat: [number, number];

  constructor(
    readonly def: EmitterDef,
    sys: VfxSystem,
    readonly parent: EmitterInst | null,
  ) {
    this.s = def.summary;
    this.rng = new Lcg((seedCounter = (Math.imul(seedCounter, 0x41c64e6d) + 0x3039) >>> 0));
    this.st = { timer: this.s.emission.interval + 1, step: this.s.emission.interval + 1, accum: 0, emitted: false };
    this.fadeIn = this.s.fade.isAlphaFadeIn || this.s.fade.isScaleFadeIn ? 0 : 1;
    this.frnd = def.subsections.find((x) => x.magic === 'FRND');
    this.fspn = def.subsections.find((x) => x.magic === 'FSPN');
    this.eaet = def.subsections.find((x) => x.magic === 'EAET' && x.enable);
    const vt = this.s.shape.volumeType;
    /* FUN_71009e9530 [판독]: 볼륨 2·5·6·13 이고 primEmitType 0 */
    this.divided = [2, 5, 6, 13].includes(vt) && this.s.shape2.primEmitType === 0;
    this.pat = this.s.texPatternV40?.[0]?.type ? this.s.texPatternV40[0] : undefined;
    const rep = this.s.texUv?.[0]?.repeat ?? 0;
    this.repeat = [rep === 1 || rep === 3 ? 2 : 1, rep === 2 || rep === 3 ? 2 : 1];
    this.children = def.children.map((c) => new EmitterInst(c, sys, this));
    this.geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.grow(64);
    this.mesh = new THREE.Mesh(this.geo, sys.material(this.s, this.repeat));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = `vfx:${this.s.name}`;
    sys.group.add(this.mesh);
  }

  private grow(n: number): void {
    let cap = Math.max(64, this.cap);
    while (cap < n) cap *= 2;
    if (cap === this.cap) return;
    this.cap = cap;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iColor', this.aColor);
    this.geo.setAttribute('iSize', this.aSize);
    this.geo.setAttribute('iUv', this.aUv);
  }

  /** 이미터 로컬 행렬 E = T·R·S (EmitterInfo trans/rotate/scale, EAET 가 있으면 이동을 키로 대체) [추정: XYZ 오일러] */
  private localMatrix(out: THREE.Matrix4): THREE.Matrix4 {
    const t = this.s.emitterTRS;
    let tx = t.transX;
    let ty = t.transY;
    let tz = t.transZ;
    if (this.eaet?.keys?.length) {
      keyEval(this.eaet.keys, this.time, 0, keyOut);
      [tx, ty, tz] = keyOut;
    }
    tmpE.set(t.rotateX, t.rotateY, t.rotateZ, 'XYZ');
    tmpQ.setFromEuler(tmpE);
    return out.compose(tmpV.set(tx, ty, tz), tmpQ, tmpV2.set(t.scaleX, t.scaleY, t.scaleZ));
  }

  /** 한 프레임(dt 1) — 원본 갱신 순서: 기존 입자 진행 → 방출 → 시간 +1 */
  tick(anchor: THREE.Matrix4): void {
    if (this.dead) return;
    this.world.multiplyMatrices(anchor, this.localMatrix(tmpM));
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += 1;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      this.move(p);
    }
    const f = this.s.fade;
    if (this.fadeIn < 1) this.fadeIn = f.fadeInTime < 1 ? 1 : Math.min(1, this.fadeIn + 1 / f.fadeInTime);
    if (this.stopped && (f.isAlphaFadeOut || f.isScaleFadeOut)) {
      this.fadeOut = f.alphaFadeTime < 1 ? 0 : this.fadeOut - 1 / f.alphaFadeTime;
      if (this.fadeOut <= 1.1920929e-7) {
        this.kill();
        return;
      }
    }
    if (!this.parent) this.emitWindow();
    for (const c of this.children) c.tickChild(this);
    this.time += 1;
  }

  private emitWindow(): void {
    const e = this.s.emission;
    if (this.stopped && this.s.fade.isFadeEmit) return;
    if (this.time < e.start) return;
    if (e.isOneTime && this.time >= e.start + e.duration && this.st.emitted) return;
    this.interval(e.isOneTime ? e.start + e.duration - (this.time + 1) : 1, (k) => this.spawn(k, null), this.st);
  }

  /**
   * 방출 간격 FUN_71009f5788 [판독]. cap = 이번 프레임에 타이머에 더할 시간(one-time 은 창 끝을 넘지 않게).
   * 상태(timer·step·accum·emitted)는 st 에 둔다(자식은 부모 입자마다 따로).
   */
  private interval(cap: number, emit: (k: number) => void, st: EmitState): number {
    const e = this.s.emission;
    let made = 0;
    if (st.timer >= st.step) {
      const n = Math.floor(st.timer / st.step);
      const rem = st.timer - n * st.step;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += (e.rate * (100 - (this.divided ? 0 : e.rateRandom) * this.rng.u())) / 100;
      if (!st.emitted && sum <= 1) sum = 1;
      st.accum += sum;
      const k = Math.floor(st.accum);
      if (k > 0) {
        emit(k);
        made = k;
        st.accum -= k;
        st.emitted = true;
        st.step = e.interval + 1 + this.rng.int(e.intervalRandom);
      }
      st.timer = rem;
    }
    st.timer += Math.min(1, Math.max(0, cap));
    return made;
  }

  /** 자식 이미터: 부모 입자마다 시작 = 부모 수명 × timing%, 부모 입자가 살아 있는 동안 방출 [판독: 창 계산][추정: 자식 입자는 월드에 남는다] */
  private tickChild(parent: EmitterInst): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += 1;
      if (p.age >= p.life) this.particles.splice(i, 1);
      else this.move(p);
    }
    const e = this.s.emission;
    const idx = parent.children.indexOf(this);
    for (const pp of parent.particles) {
      pp.child ??= parent.children.map(() => ({ timer: e.interval + 1, step: e.interval + 1, accum: 0, emitted: false, time: 0 }));
      const st = pp.child[idx];
      const start = (pp.life * e.timing) / 100;
      if (st.time >= start && !(parent.stopped && this.s.fade.isFadeEmit)) {
        if (!e.isOneTime || st.time < start + e.duration || !st.emitted) {
          this.interval(e.isOneTime ? start + e.duration - (st.time + 1) : 1, (k) => this.spawn(k, pp, parent), st);
        }
      }
      st.time += 1;
    }
    if (parent.dead && this.particles.length === 0) this.dead = true;
  }

  /** CPU 입자 갱신 FUN_71009fe0e0 [판독] */
  private move(p: Particle): void {
    const s = this.s;
    p.p.addScaledVector(p.v, p.mom);
    if (s.airRes !== 1) p.v.multiplyScalar(s.airRes);
    const g = s.gravity;
    if (g.emissionGravityScale > 0) {
      p.v.x += g.emissionGravityDir[0] * g.emissionGravityScale;
      p.v.y += g.emissionGravityDir[1] * g.emissionGravityScale;
      p.v.z += g.emissionGravityDir[2] * g.emissionGravityScale;
    }
    const fr = this.frnd;
    if (fr?.amp) {
      const I = fr.interval || 1;
      const k = (Math.PI * 2) / I;
      const amps = fr.customTable ? fr.amps ?? NOISE_A : NOISE_A;
      const per = fr.customTable ? fr.periods ?? NOISE_P : NOISE_P;
      let t = p.age - 1;
      if (fr.airMode && s.airRes !== 1) t = (1 - Math.pow(s.airRes, t)) / (1 - s.airRes);
      for (let c = 0; c < 3; c++) {
        const x0 = (t + p.noisePhase[c] * I) * k;
        const d = (noise(x0 + k, amps, per) - noise(x0, amps, per)) * fr.amp[c];
        if (c === 0) p.p.x += d;
        else if (c === 1) p.p.y += d;
        else p.p.z += d;
      }
    }
    const sp = this.fspn;
    if (sp?.speed) {
      const a = sp.speed * p.mom;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const { x, y, z } = p.p;
      if (sp.axis === 0) p.p.set(x, ca * y - sa * z, ca * z + sa * y);
      else if (sp.axis === 1) p.p.set(ca * x + sa * z, y, ca * z - sa * x);
      else p.p.set(ca * x - sa * y, ca * y + sa * x, z);
    }
  }

  /** 볼륨 표본(이미터 로컬) — 모양은 이름 순서 열거(mpj 08 4.4), 각도 기준은 [추정] */
  private shape(i: number, pos: THREE.Vector3, nrm: THREE.Vector3): void {
    const sh = this.s.shape;
    const r = this.rng;
    const rx = sh.volumeRadiusX * sh.volumeFormScaleX;
    const ry = sh.volumeRadiusY * sh.volumeFormScaleY;
    const rz = sh.volumeRadiusZ * sh.volumeFormScaleZ;
    const start = this.s.shape2.sweepStartRandom ? r.u() * Math.PI * 2 : sh.sweepStart;
    const div = Math.max(1, sh.numDivideCircle);
    const arc = sh.sweepLongitude;
    const full = arc >= Math.PI * 2 - 1e-4;
    const angle = (): number => start + r.u() * arc;
    const sphereDir = (): void => {
      const th = angle();
      const cy = 1 - 2 * r.u();
      const sy = Math.sqrt(Math.max(0, 1 - cy * cy));
      nrm.set(sy * Math.sin(th), cy, sy * Math.cos(th));
    };
    switch (sh.volumeType) {
      case 0:
        pos.set(0, 0, 0);
        nrm.set(r.u() * 2 - 1, r.u() * 2 - 1, r.u() * 2 - 1);
        if (nrm.lengthSq() > 1e-8) nrm.normalize();
        return;
      case 1:
      case 2:
      case 3: {
        let th: number;
        if (sh.volumeType === 2) {
          const idx = this.divided ? i % div : r.int(div);
          th = start + (arc * idx) / (full ? div : Math.max(1, div - 1));
        } else th = angle();
        let rr = 1;
        if (sh.volumeType === 3) {
          const c = Math.min(1, Math.max(0, sh.caliberRatio));
          rr = Math.sqrt((1 - c) * (1 - c) + r.u() * (1 - (1 - c) * (1 - c)));
        }
        nrm.set(Math.sin(th), 0, Math.cos(th));
        pos.set(nrm.x * rx * rr, 0, nrm.z * rz * rr);
        return;
      }
      case 4:
      case 5:
      case 6:
      case 7: {
        sphereDir();
        let rr = 1;
        if (sh.volumeType === 7) {
          const c = Math.min(1, Math.max(0, sh.caliberRatio));
          const in3 = (1 - c) ** 3;
          rr = Math.cbrt(in3 + r.u() * (1 - in3));
        }
        pos.set(nrm.x * rx * rr, nrm.y * ry * rr, nrm.z * rz * rr);
        return;
      }
      case 8:
      case 9: {
        const th = angle();
        const rr = sh.volumeType === 9 ? Math.sqrt(r.u()) : 1;
        nrm.set(Math.sin(th), 0, Math.cos(th));
        pos.set(nrm.x * rx * rr, (r.u() * 2 - 1) * ry, nrm.z * rz * rr);
        return;
      }
      case 10:
      case 11:
      case 14: {
        pos.set((r.u() * 2 - 1) * rx, sh.volumeType === 14 ? 0 : (r.u() * 2 - 1) * ry, (r.u() * 2 - 1) * rz);
        if (sh.volumeType !== 11) {
          /* 겉면: 한 축을 ±반경에 붙인다 */
          const ax = r.int(sh.volumeType === 14 ? 2 : 3);
          const sg = r.u() < 0.5 ? -1 : 1;
          if (ax === 0) pos.x = sg * rx;
          else if (ax === 1 && sh.volumeType !== 14) pos.y = sg * ry;
          else pos.z = sg * rz;
        }
        nrm.copy(pos);
        if (nrm.lengthSq() > 1e-8) nrm.normalize();
        return;
      }
      case 12:
      case 13: {
        const n = Math.max(1, this.s.shape2.numDivideLine);
        const f = sh.volumeType === 13 ? (n > 1 ? (this.divided ? i % n : r.int(n)) / (n - 1) : 0.5) : r.u();
        pos.set(sh.lineCenter + (f - 0.5) * sh.lineLength, 0, 0);
        nrm.set(0, 0, 0);
        return;
      }
      default:
        pos.set(0, 0, 0);
        nrm.set(0, 0, 0);
    }
  }

  /** 입자 k 개(분할 볼륨이면 × 분할 수) 만들기 — 초기값 FUN_71009f82a4 [판독] */
  private spawn(k: number, parentP: Particle | null, parent?: EmitterInst): void {
    const s = this.s;
    const r = this.rng;
    const sh = s.shape;
    const per = this.divided ? (sh.volumeType === 13 ? Math.max(1, this.s.shape2.numDivideLine) : Math.max(1, sh.numDivideCircle)) : 1;
    const total = k * per;
    if (this.particles.length + total > MAX_PARTICLES) return;
    let birth: THREE.Matrix4;
    if (parentP && parent) {
      /* 자식: 부모 입자 월드 위치에서, 부모 이미터의 회전·배율로 [추정] */
      birth = new THREE.Matrix4().copy(parent.world).setPosition(parent.worldPos(parentP, tmpV2));
    } else birth = this.world.clone();
    for (let i = 0; i < total; i++) {
      const pos = new THREE.Vector3();
      const nrm = new THREE.Vector3();
      this.shape(i, pos, nrm);
      if (s.emission.positionRandom) {
        tmpV.set(r.u() * 2 - 1, r.u() * 2 - 1, r.u() * 2 - 1);
        if (tmpV.lengthSq() > 1e-8) tmpV.normalize();
        pos.addScaledVector(tmpV, s.emission.positionRandom);
      }
      const ve = s.velocity;
      const vel = nrm.clone().multiplyScalar(ve.allDirection);
      tmpV.set(ve.designatedDirX, ve.designatedDirY, ve.designatedDirZ);
      if (tmpV.lengthSq() > 1e-8) tmpV.normalize();
      if (ve.diffusionDirAngle) {
        /* 지정 방향 둘레 원뿔(각도 도 단위, 1 − angle/90 을 코사인 하한으로) [판독 일부][추정: 분포] */
        const cmin = 1 - ve.diffusionDirAngle / 90;
        const cz = cmin + (1 - cmin) * r.u();
        const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
        const ph = r.u() * Math.PI * 2;
        tmpV2.set(sz * Math.cos(ph), sz * Math.sin(ph), cz);
        tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpV);
        tmpV2.applyQuaternion(tmpQ);
        vel.addScaledVector(tmpV2, ve.designatedDirScale);
      } else vel.addScaledVector(tmpV, ve.designatedDirScale);
      vel.multiplyScalar(1 - (r.u() * ve.velRandom) / 100);
      if (ve.diffusionX || ve.diffusionY || ve.diffusionZ) {
        tmpV.set(r.u() * 2 - 1, r.u() * 2 - 1, r.u() * 2 - 1);
        if (tmpV.lengthSq() > 1e-8) tmpV.normalize();
        vel.x += tmpV.x * ve.diffusionX;
        vel.y += tmpV.y * ve.diffusionY;
        vel.z += tmpV.z * ve.diffusionZ;
      }
      const sc = s.scale;
      let sx: number;
      let sy: number;
      if (sc.random[0] === sc.random[1]) {
        const f = 1 - (r.u() * sc.random[0]) / 100;
        sx = sc.base[0] * f;
        sy = sc.base[1] * f;
      } else {
        sx = sc.base[0] * (1 - (r.u() * sc.random[0]) / 100);
        sy = sc.base[1] * (1 - (r.u() * sc.random[1]) / 100);
      }
      const m = s.momentumRandom;
      const mom = m + 1 - 2 * m * r.u();
      const life = s.infiniteLife ? 2.6843546e8 : s.life * (1 - r.int(s.lifeRandom) / 100);
      const rz = s.rotateFlags?.isRotateZ ? 1 : 0;
      const sign = s.rotateFlags?.rotRevRandZ && r.u() < 0.5 ? -1 : 1;
      const rot = rz ? s.rotateInit[2] + r.u() * s.rotateInitRand[2] : 0;
      const rotV = rz ? sign * (s.rotateAdd[2] + r.u() * s.rotateAddRand[2]) : 0;
      let cell = 0;
      const pat = this.pat;
      if (pat && pat.type === 4) cell = pat.table[r.int(Math.max(1, pat.numRandom))] ?? 0;
      const nKeys = s.color.color0Keys.length;
      const fl = s.fluctuation ?? {};
      this.particles.push({
        p: pos,
        v: vel,
        age: 0,
        life: Math.max(1, life),
        sx,
        sy,
        rot,
        rotV,
        mom,
        cell,
        colorKey: nKeys ? r.int(nKeys) : 0,
        rnd: r.u(),
        flucPhaseX: fl.phaseRndX ? r.u() : fl.phaseInitX ?? 0,
        flucPhaseY: fl.phaseRndY ? r.u() : fl.phaseInitY ?? 0,
        noisePhase: [r.u(), r.u(), r.u()],
        birth,
        world: new THREE.Vector3(),
      });
    }
  }

  stop(): void {
    this.stopped = true;
    for (const c of this.children) c.stopped = true;
  }

  kill(): void {
    this.dead = true;
    this.particles.length = 0;
    for (const c of this.children) c.kill();
  }

  /** 방출이 다 끝났고 입자도 없으면 참 */
  get finished(): boolean {
    if (this.dead) return true;
    const e = this.s.emission;
    const emitDone = this.stopped || (e.isOneTime && this.time >= e.start + e.duration && this.st.emitted);
    return emitDone && this.particles.length === 0 && this.children.every((c) => c.particles.length === 0);
  }

  /** 입자 월드 위치 — followType 0 = 이미터 행렬 그대로, 1 = 태어난 행렬, 2 = 태어난 회전·배율 + 지금 위치 [판독: 0x7D3 분기][추정: 뜻]. 자식은 태어난 행렬 */
  worldPos(p: Particle, out: THREE.Vector3): THREE.Vector3 {
    const follow = this.s.followType;
    if (follow === 0 && !this.parent) return out.copy(p.p).applyMatrix4(this.world);
    out.copy(p.p).applyMatrix4(p.birth);
    if (follow === 2 && !this.parent) {
      out.x += this.world.elements[12] - p.birth.elements[12];
      out.y += this.world.elements[13] - p.birth.elements[13];
      out.z += this.world.elements[14] - p.birth.elements[14];
    }
    return out;
  }

  /** 그리기 값 기록(입자 월드 위치·색·크기·UV) */
  write(): void {
    const s = this.s;
    const n = this.particles.length;
    this.grow(n);
    const pos = this.aPos.array as Float32Array;
    const col = this.aColor.array as Float32Array;
    const siz = this.aSize.array as Float32Array;
    const uvs = this.aUv.array as Float32Array;
    const c = s.color;
    const types = c.types;
    const ec = s.emitterColor0;
    const comb = s.combiner ?? {};
    const lp = s.loop;
    const fl = s.fluctuation ?? {};
    const fade = s.fade;
    const aFade = (fade.isAlphaFadeOut ? this.fadeOut : 1) * (fade.isAlphaFadeIn ? this.fadeIn : 1);
    const sFade = (fade.isScaleFadeOut ? this.fadeOut : 1) * (fade.isScaleFadeIn ? this.fadeIn : 1);
    const pat = this.pat;
    const divU = pat?.div?.[0] || 1;
    const divV = pat?.div?.[1] || 1;
    const [repU, repV] = this.repeat;
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      this.worldPos(p, p.world);
      pos[i * 3] = p.world.x;
      pos[i * 3 + 1] = p.world.y;
      pos[i * 3 + 2] = p.world.z;
      const t = p.age / p.life;
      /* 색 0 */
      let cr = c.color0[0];
      let cg = c.color0[1];
      let cb = c.color0[2];
      if (types[0] === 3 && c.color0Keys.length) {
        const k = c.color0Keys[p.colorKey];
        cr = k[0];
        cg = k[1];
        cb = k[2];
      } else if (types[0] === 2 && c.color0Keys.length) {
        const tt = lp?.loopColor0 && lp.color0LoopRate > 0 ? ((lp.color0LoopRate * p.rnd * (lp.loopRandomColor0 ? 1 : 0) + p.age) % lp.color0LoopRate) / lp.color0LoopRate : t;
        keyEval(c.color0Keys, tt, comb.color0Interp ?? 0, keyOut);
        [cr, cg, cb] = keyOut;
      }
      let a = c.alpha0;
      if (types[1] === 2 && c.alpha0Keys.length) {
        const tt = lp?.loopAlpha0 && lp.alpha0LoopRate > 0 ? ((lp.alpha0LoopRate * p.rnd * (lp.loopRandomAlpha0 ? 1 : 0) + p.age) % lp.alpha0LoopRate) / lp.alpha0LoopRate : t;
        a = keyEval(c.alpha0Keys, tt, comb.alpha0Interp ?? 0, keyOut)[0];
      }
      /* 흔들림 [추정: 1 − amp·(0.5 − 0.5·cos 2π(나이/주기 + 위상))] */
      if (fl.isApplyAlpha && fl.cycleX) a *= 1 - (fl.amplitudeX ?? 0) * (0.5 - 0.5 * Math.cos(Math.PI * 2 * (p.age / fl.cycleX + p.flucPhaseX)));
      let fs = 1;
      if (fl.isApplyScale && fl.cycleY) fs = 1 - (fl.amplitudeY ?? 0) * (0.5 - 0.5 * Math.cos(Math.PI * 2 * (p.age / fl.cycleY + p.flucPhaseY)));
      const cs = c.colorScale;
      col[i * 4] = cr * cs * ec[0];
      col[i * 4 + 1] = cg * cs * ec[1];
      col[i * 4 + 2] = cb * cs * ec[2];
      col[i * 4 + 3] = Math.max(0, a * ec[3] * aFade);
      /* 크기 키 [추정: 기본 크기에 곱] */
      let kx = 1;
      let ky = 1;
      if (s.scale.keys.length) {
        const tt = lp?.scaleLoop && lp.scaleLoopRate > 0 ? ((lp.scaleLoopRate * p.rnd * (lp.scaleLoopRandom ? 1 : 0) + p.age) % lp.scaleLoopRate) / lp.scaleLoopRate : t;
        keyEval(s.scale.keys, tt, comb.scaleInterp ?? 0, keyOut);
        kx = keyOut[0];
        ky = keyOut[1];
      }
      siz[i * 3] = p.sx * kx * fs * sFade;
      siz[i * 3 + 1] = p.sy * ky * fs * sFade;
      siz[i * 3 + 2] = p.rot + p.rotV * p.age;
      /* UV: 패턴 칸(위 줄부터) × 반복 [추정] */
      const cu = p.cell % divU;
      const cv = Math.floor(p.cell / divU) % divV;
      uvs[i * 4] = cu / divU;
      uvs[i * 4 + 1] = 1 - (cv + 1) / divV;
      uvs[i * 4 + 2] = repU / divU;
      uvs[i * 4 + 3] = repV / divV;
    }
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aUv.needsUpdate = true;
    this.mesh.visible = n > 0;
    for (const ch of this.children) ch.write();
  }

  dispose(): void {
    for (const c of this.children) c.dispose();
    this.mesh.removeFromParent();
    this.geo.dispose();
  }
}

/** 이미터셋 인스턴스(bex::Effect 하나) */
export class VfxSetInstance {
  readonly emitters: EmitterInst[];
  /** 붙은 곳의 월드 행렬(FX 트리거 대상 노드·모델). 주인이 매 프레임 갱신한다 */
  readonly anchor = new THREE.Matrix4();
  done = false;

  constructor(
    readonly name: string,
    defs: EmitterDef[],
    sys: VfxSystem,
  ) {
    this.emitters = defs.map((d) => new EmitterInst(d, sys, null));
  }

  tick(): void {
    for (const e of this.emitters) e.tick(this.anchor);
    if (this.emitters.every((e) => e.finished)) this.done = true;
  }

  stop(): void {
    for (const e of this.emitters) e.stop();
  }

  kill(): void {
    for (const e of this.emitters) e.kill();
    this.done = true;
  }

  write(): void {
    for (const e of this.emitters) e.write();
  }

  dispose(): void {
    for (const e of this.emitters) e.dispose();
  }
}

/** 이미터셋 정의·텍스처·재질을 들고 인스턴스를 돌린다 */
export class VfxSystem {
  readonly group = new THREE.Group();
  private readonly tex = new Map<string, THREE.Texture>();
  private readonly mats = new Map<string, THREE.ShaderMaterial>();
  private readonly live: VfxSetInstance[] = [];
  file: VfxSetsFile | null = null;

  constructor(scene: THREE.Scene) {
    this.group.name = 'vfx';
    scene.add(this.group);
  }

  /** texFiles: 텍스처 키("hsmg402/hsmg402_ring00") → URL */
  async load(file: VfxSetsFile, texUrls: Record<string, string>): Promise<void> {
    this.file = file;
    const loader = new THREE.TextureLoader();
    await Promise.all(
      Object.entries(texUrls).map(async ([k, url]) => {
        const t = await loader.loadAsync(url);
        /* BNTX 형식이 *_SRGB 인 것만 sRGB(마스크 R8·BC4 는 선형) [데이터] */
        t.colorSpace = file.textures[k]?.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        this.tex.set(k, t);
      }),
    );
  }

  /** 렌더 상태 + 텍스처마다 재질 하나 */
  material(s: EmitterSummary, repeat: [number, number]): THREE.ShaderMaterial {
    const smp = s.samplers[0];
    const key = `${smp?.file}|${s.render.blendType}|${s.render.isDepthTest}|${s.render.isAlphaTest ? s.render.alphaThreshold : -1}|${smp?.wrapU}${smp?.wrapV}|${repeat}`;
    let m = this.mats.get(key);
    if (m) return m;
    let t = smp ? this.tex.get(smp.file) ?? null : null;
    if (t && smp) {
      /* 샘플러 랩: 0 Mirror, 1 Repeat, 2 Clamp, 3 MirrorOnce(→ Clamp 근사) [데이터: mpj 08 4.4] */
      const wrap = (w: number): THREE.Wrapping => (w === 0 ? THREE.MirroredRepeatWrapping : w === 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping);
      if (t.wrapS !== wrap(smp.wrapU) || t.wrapT !== wrap(smp.wrapV)) {
        t = t.clone();
        t.wrapS = wrap(smp.wrapU);
        t.wrapT = wrap(smp.wrapV);
        t.needsUpdate = true;
      }
    }
    m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { map: { value: t }, alphaRef: { value: s.render.isAlphaTest ? Math.max(0, s.render.alphaThreshold) : -1 } },
      transparent: true,
      depthWrite: false,
      depthTest: s.render.isDepthTest,
      fog: false,
      ...(BLEND[s.render.blendType] ?? BLEND[0]),
    });
    this.mats.set(key, m);
    return m;
  }

  create(setName: string): VfxSetInstance | null {
    const def = this.file?.sets[setName];
    if (!def) return null;
    const inst = new VfxSetInstance(setName, def.emitters, this);
    this.live.push(inst);
    return inst;
  }

  /** frames 프레임 진행(60fps 1프레임 단위) 후 그리기 값 기록 */
  update(frames: number): void {
    for (let f = 0; f < frames; f++) {
      for (const s of this.live) if (!s.done) s.tick();
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      if (s.done) {
        s.dispose();
        this.live.splice(i, 1);
      } else s.write();
    }
  }

  get liveCount(): number {
    return this.live.length;
  }

  dispose(): void {
    for (const s of this.live) s.dispose();
    this.live.length = 0;
    for (const m of this.mats.values()) {
      const t = m.uniforms.map.value as THREE.Texture | null;
      if (t && ![...this.tex.values()].includes(t)) t.dispose();
      m.dispose();
    }
    for (const t of this.tex.values()) t.dispose();
    this.mats.clear();
    this.tex.clear();
    this.group.clear();
    this.group.removeFromParent();
  }
}
