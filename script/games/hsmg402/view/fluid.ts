/**
 * hsmg402 눈 자국 — 유체 높이장(hsmg402_fluid.fmdb 재질 fld_fluid, bex NdRenderPassModelFluid). 화면 전용(로직 무관).
 * 판독 근거: web/docs/minigame/hsmg402.md 7.5, web/docs/engine/03_graphics.md 유체 절, analysis/decomp/fluid_*.c, analysis/mat/sass.
 *
 * 원본 그대로 [판독·데이터]:
 *   - 높이장 512², 월드 19×19, 중심 (0,0,0): u = (x − (px − 9.5))/19, v = (z − (pz − 9.5))/19 (Env+0x3f0~0x3fc, main 0x7100421374)
 *   - 매 프레임 순서(FUN_71003ee4d0): 붓 그리기(두 타깃 ONE·ONE 더하기) → add 패스(h += 0.00015, 블렌드 0xf) → clear 텍스처와 Min(블렌드 0xd, add > 0)
 *     → 노멀 패스(fluid_normal). 첫 프레임만 fld_clear 를 그대로 복사(fluid_clear_enable 0, texture_clear 1). 일시정지(Engine+0x210)면 건너뜀
 *   - 눈덩이 붓(snowball_fluid 메시, fld_snow_fluid_mt 그래프): h += −fluid0_hgt(x − mx + 0.5, 0.5 − (z − mz))·sat(10·|Δ모델 위치|)·M160
 *   - 캐릭터 붓(*fluid_m, 메시 = 발 판·몸 원판, UV0): w = NDinput_0 위치(x 몸·y 왼발·z 오른발),
 *     h += hgt(uv)·w·(w ≥ 1.01 ? 1 : sat(10·|Δ모델 위치|)·utilityParameter0.x)·utilityParameter1.x·M160 — hgt 는 BC4_SNORM(발 중심 −0.79, 몸 −0.32)
 *     utilityParameter0 = FluidMaterialParamChange: 시작 (0,…), 착지(단계 0, y ≤ 0) 뒤 (1,…)
 *   - 노멀 = normalize(B·S·Sobel_u(h), 8·A·B, A·S·Sobel_v(h)), A = B = 19/512, S = 깊이 0.3 (fluid_normal 3×3 모음)
 *   - 지면 fld_snow_fluid_mt: y += h·0.3(정점), N = normalize(N_면 + N_유체), 최종 × fld_sg_alb(−h, 0) — material.ts MPS_FLUID
 * 추정·근사:
 *   - M160(모델 유체 높이 배율) = 1 [추정: GetModelFluidHeightMapScale 기본 반환 1, hsmg402 는 설정 호출 없음]
 *   - 높이장 형식 미판독 → float + [−1, 1] 자르기 [추정: SNORM]. 홈이 −0.65 아래로 파이면 아래 지면 snow(y 0)가 바닥이 된다
 *   - 웹 렌더 1회에 지난 로직 프레임 n 개를 묶는다: 붓 n·sat(10·d/n), add n·0.00015
 *   - fld_clear 행 0(png 위) = z −9.5 [추정: 복사 패스가 텍셀 그대로]. 붓 셰이더의 속도 타깃(simulation 0 이라 안 씀)은 생략
 *   - 그림자 맵: 깊이 전용 변형(shader_type 1, p385)도 같은 변위 [판독] → material.ts mpsFluidDepthMaterial(앞면 캐스터 [추정])
 *   - SetSystemScaleVec((2,1,2)) 는 Actor 배율(damageActor)에 곱해지는 값 — 시작 때 발 붓은 utilityParameter0 = 0 이라 영향 없음, 웹은 무시
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Assets } from '../../../view/assets';
import type { BallView, Hsmg402State } from '../state';
import { mpsFluidEnv } from './material';

export interface FluidParams {
  fluid_world_width: number;
  fluid_world_height: number;
  fluid_texture_width: number;
  fluid_texture_height: number;
  fluid_world_position: number[];
  fluid_heightmap_add_value: number;
}

interface BrushInfo {
  tex: string;
  u1x: number;
}

interface FluidJson {
  params: FluidParams;
  clear: string;
  snowballBrush: string;
  brushes: Record<string, Record<string, BrushInfo>>;
}

/** 캐릭터 붓 재질 → NDinput_0 위치 성분 [판독: body = M170(x), L = M174(y), R = M178(z)] */
export const BRUSH_AXIS: Record<string, 'x' | 'y' | 'z'> = { bodyfluid_m: 'x', L_footfluid_m: 'y', R_footfluid_m: 'z' };
/** 캐릭터 붓 셰이더의 비교 상수 c1[0x0] [판독: 프로그램 상수 1.01] */
export const W_FULL = 1.01;
/** 모델 유체 높이 배율 M160 [추정] */
export const M160 = 1;
export const NORMAL_EDGE = 1;

/** Env+0x3f0~0x3fc: (원점 x, 원점 z, 1/폭, 1/깊이폭) [판독: main 0x7100421374] */
export function fluidRect(p: FluidParams): [number, number, number, number] {
  const w = p.fluid_world_width;
  const d = (w * p.fluid_texture_height) / p.fluid_texture_width;
  const pos = p.fluid_world_position;
  return [pos[0] - w * 0.5, pos[2] - d * 0.5, 1 / w, 1 / d];
}

/** Env+0x408/0x40c: 텍셀 하나의 월드 크기 A·B */
export function fluidTexel(p: FluidParams): [number, number] {
  const w = p.fluid_world_width;
  const d = (w * p.fluid_texture_height) / p.fluid_texture_width;
  return [w / p.fluid_texture_width, d / p.fluid_texture_height];
}

const sat = (x: number): number => Math.min(Math.max(x, 0), 1);
const clamp1 = (x: number): number => Math.min(Math.max(x, -1), 1);

/** 눈덩이 붓 한 화소(n 프레임 묶음). t = fluid0_hgt 선형값, d = n 프레임 동안 모델 이동 거리 */
export function snowballBrush(t: number, d: number, n: number, m160 = M160): number {
  return clamp1(-t * sat((10 * d) / n) * m160) * n;
}

/** 캐릭터 붓 한 화소(n 프레임 묶음). v = hgt SNORM 값, w = NDinput_0 성분, u0 = utilityParameter0.x, u1x = utilityParameter1.x */
export function charaBrush(v: number, w: number, d: number, u0: number, u1x: number, n: number, m160 = M160): number {
  const h = v * w;
  const k = h * sat((10 * d) / n);
  const r = (h - k * u0) * (w >= W_FULL ? 1 : 0) + k * u0;
  return clamp1(r * u1x * m160) * n;
}

/** 붓 다음: add 패스 + clear 와 Min [판독: 블렌드 0xf → 0xd], [−1, 1] 자르기 [추정] */
export function recover(h: number, brush: number, add: number, clear: number): number {
  return clamp1(Math.min(h + brush + add, clear));
}

/** fluid_normal: h[j+1][i+1] = 텍셀 (i, j) 이웃(i = u, j = v 방향 −1..1) [판독: HFMA2 기호 풀이] */
export function sobelNormal(h: number[][], s: number, a: number, b: number): [number, number, number] {
  const g = (i: number, j: number): number => h[j + 1][i + 1];
  const nx = b * s * (g(-1, -1) + 2 * g(-1, 0) + g(-1, 1) - (g(1, -1) + 2 * g(1, 0) + g(1, 1)));
  const ny = 8 * a * b;
  const nz = a * s * (g(-1, -1) + 2 * g(0, -1) + g(1, -1) - (g(-1, 1) + 2 * g(0, 1) + g(1, 1)));
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

const FS_HEAD = 'precision highp float;\nprecision highp sampler2D;\n';

const QUAD_VS = `${FS_HEAD}in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

export const INIT_FS = `${FS_HEAD}in vec2 vUv;
uniform sampler2D uClear;
out vec4 fragColor;
void main() {
  fragColor = vec4( clamp( texture( uClear, vUv ).r, -1.0, 1.0 ), 0.0, 0.0, 1.0 );
}`;

export const UPDATE_FS = `${FS_HEAD}in vec2 vUv;
uniform sampler2D uHeight;
uniform sampler2D uBrush;
uniform sampler2D uClear;
uniform float uAdd;
out vec4 fragColor;
void main() {
  float h = texture( uHeight, vUv ).r + texture( uBrush, vUv ).r + uAdd;
  fragColor = vec4( clamp( min( h, texture( uClear, vUv ).r ), -1.0, 1.0 ), 0.0, 0.0, 1.0 );
}`;

export const NORMAL_FS = `${FS_HEAD}in vec2 vUv;
uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uDepth;
uniform vec2 uWorldTexel;
out vec4 fragColor;
float hAt( float i, float j ) { return texture( uHeight, vUv + vec2( i, j ) * uTexel ).r; }
void main() {
  float a = uWorldTexel.x;
  float b = uWorldTexel.y;
  float nx = b * uDepth * ( hAt( -1.0, -1.0 ) + 2.0 * hAt( -1.0, 0.0 ) + hAt( -1.0, 1.0 ) - ( hAt( 1.0, -1.0 ) + 2.0 * hAt( 1.0, 0.0 ) + hAt( 1.0, 1.0 ) ) );
  float nz = a * uDepth * ( hAt( -1.0, -1.0 ) + 2.0 * hAt( 0.0, -1.0 ) + hAt( 1.0, -1.0 ) - ( hAt( -1.0, 1.0 ) + 2.0 * hAt( 0.0, 1.0 ) + hAt( 1.0, 1.0 ) ) );
  fragColor = vec4( normalize( vec3( nx, 8.0 * a * b, nz ) ), 1.0 );
}`;

const BRUSH_VS = `${FS_HEAD}in vec3 position;
in vec2 uv;
uniform mat4 modelMatrix;
uniform vec4 uRect;
out vec3 vWorld;
out vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vWorld = w.xyz;
  vUv = uv;
  gl_Position = vec4( ( w.xz - uRect.xy ) * uRect.zw * 2.0 - 1.0, 0.0, 1.0 );
}`;

export const SNOWBALL_FS = `${FS_HEAD}in vec3 vWorld;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec3 uCenter;
uniform float uGain;
uniform float uN;
out vec4 fragColor;
void main() {
  float t = texture( uTex, vec2( vWorld.x - uCenter.x + 0.5, 0.5 - ( vWorld.z - uCenter.z ) ) ).r;
  fragColor = vec4( clamp( -t * uGain, -1.0, 1.0 ) * uN, 0.0, 0.0, 0.0 );
}`;

export const CHARA_FS = `${FS_HEAD}in vec3 vWorld;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uW;
uniform float uS;
uniform float uU0;
uniform float uU1;
uniform float uM160;
uniform float uN;
out vec4 fragColor;
void main() {
  float h = ( texture( uTex, vUv ).r * 2.0 - 1.0 ) * uW;
  float k = h * uS;
  float r = ( h - k * uU0 ) * step( ${W_FULL.toFixed(2)}, uW ) + k * uU0;
  fragColor = vec4( clamp( r * uU1 * uM160, -1.0, 1.0 ) * uN, 0.0, 0.0, 0.0 );
}`;

function rawMat(fs: string, uniforms: Record<string, THREE.IUniform>, vs = QUAD_VS): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vs, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
}

function brushMat(fs: string, uniforms: Record<string, THREE.IUniform>, side: THREE.Side): THREE.RawShaderMaterial {
  const m = rawMat(fs, uniforms, BRUSH_VS);
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneFactor;
  m.blendEquation = THREE.AddEquation;
  m.side = side;
  return m;
}

interface BallBrush {
  mesh: THREE.Mesh;
  mat: THREE.RawShaderMaterial;
  prev: THREE.Vector3 | null;
}

interface CharaBrush {
  src: THREE.Object3D;
  proxy: THREE.Mesh;
  mat: THREE.RawShaderMaterial;
  axis: 'x' | 'y' | 'z';
}

interface CharaSet {
  root: THREE.Object3D;
  input: THREE.Object3D | null;
  brushes: CharaBrush[];
  prev: THREE.Vector3 | null;
  u0: number;
}

/** 캐릭터 인스턴스(character.ts CharacterActor 중 필요한 것만) */
export interface FluidActor {
  readonly root: THREE.Object3D;
  readonly tpl: { readonly key: string };
}

export class SnowFluid {
  params: FluidParams | null = null;
  private data: FluidJson | null = null;
  private rect: [number, number, number, number] = [-9.5, -9.5, 1 / 19, 1 / 19];
  private heights: THREE.WebGLRenderTarget[] = [];
  private cur = 0;
  private brushRT: THREE.WebGLRenderTarget | null = null;
  private normalRT: THREE.WebGLRenderTarget | null = null;
  private clearTex: THREE.Texture | null = null;
  private ballTex: THREE.Texture | null = null;
  private readonly charaTex = new Map<string, THREE.Texture>();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadScene = new THREE.Scene();
  private readonly brushScene = new THREE.Scene();
  private quad: THREE.Mesh | null = null;
  private initMat: THREE.RawShaderMaterial | null = null;
  private updateMat: THREE.RawShaderMaterial | null = null;
  private normalMat: THREE.RawShaderMaterial | null = null;
  private ballGeo: THREE.BufferGeometry | null = null;
  private readonly ballLocal = new THREE.Matrix4();
  private readonly balls: BallBrush[] = [];
  private readonly charas = new Map<FluidActor, CharaSet>();
  private readonly ownMats: THREE.Material[] = [];
  private lastFrame = -1;
  private started = false;

  async load(assets: Assets, gl: THREE.WebGLRenderer): Promise<void> {
    this.data = await assets.json<FluidJson>('fluid/fluid.json');
    const p = this.data.params;
    this.params = p;
    this.rect = fluidRect(p);
    const tl = new THREE.TextureLoader();
    const load = async (path: string, srgb: boolean, mip: boolean): Promise<THREE.Texture> => {
      const t = await tl.loadAsync(assets.url(path));
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = mip;
      t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    this.clearTex = await load(this.data.clear, true, false);
    this.ballTex = await load(this.data.snowballBrush, true, true);
    for (const mats of Object.values(this.data.brushes))
      for (const b of Object.values(mats)) if (!this.charaTex.has(b.tex)) this.charaTex.set(b.tex, await load(`fluid/${b.tex}`, false, true));

    const floatOk = gl.extensions.has('EXT_color_buffer_float');
    const linear = floatOk && gl.extensions.has('OES_texture_float_linear');
    const w = p.fluid_texture_width;
    const h = p.fluid_texture_height;
    const rt = (type: THREE.TextureDataType, filter: THREE.MagnificationTextureFilter): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(w, h, { type, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false, generateMipmaps: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    const ht = floatOk ? THREE.FloatType : THREE.HalfFloatType;
    const hf = floatOk && !linear ? THREE.NearestFilter : THREE.LinearFilter;
    this.heights = [rt(ht, hf), rt(ht, hf)];
    this.brushRT = rt(THREE.HalfFloatType, THREE.NearestFilter);
    this.normalRT = rt(THREE.HalfFloatType, THREE.LinearFilter);

    const [a, b] = fluidTexel(p);
    this.initMat = rawMat(INIT_FS, { uClear: { value: this.clearTex } });
    this.updateMat = rawMat(UPDATE_FS, { uHeight: { value: null }, uBrush: { value: this.brushRT.texture }, uClear: { value: this.clearTex }, uAdd: { value: 0 } });
    this.normalMat = rawMat(NORMAL_FS, { uHeight: { value: null }, uTexel: { value: new THREE.Vector2(NORMAL_EDGE / w, NORMAL_EDGE / h) }, uDepth: { value: p.fluid_world_height }, uWorldTexel: { value: new THREE.Vector2(a, b) } });
    this.ownMats.push(this.initMat, this.updateMat, this.normalMat);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(tri, this.initMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    mpsFluidEnv.height.value = this.heights[0].texture;
    mpsFluidEnv.normal.value = this.normalRT.texture;
    mpsFluidEnv.rect.value.set(...this.rect);
    mpsFluidEnv.depth.value = p.fluid_world_height;
  }

  /** 눈덩이 모델(hsmg402_snowball.glb)의 snowball_fluid 메시를 붓으로 */
  setBallModel(g: GLTF): void {
    g.scene.updateMatrixWorld(true);
    let src: THREE.Mesh | null = null;
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!src && m.isMesh && (m.material as THREE.Material).name === 'fld_snow_fluid_mt') src = m;
    });
    if (!src || !this.ballTex) return;
    const mesh = src as THREE.Mesh;
    this.ballGeo = mesh.geometry;
    this.ballLocal.copy(mesh.matrixWorld);
  }

  private ballBrush(i: number): BallBrush | null {
    if (!this.ballGeo || !this.ballTex) return null;
    let b = this.balls[i];
    if (!b) {
      /* face_cull_type 1(앞면 컬링) — 볼록한 구의 한쪽 반구만 그려 실루엣을 한 번 덮는다 */
      const mat = brushMat(SNOWBALL_FS, { uRect: { value: new THREE.Vector4(...this.rect) }, uTex: { value: this.ballTex }, uCenter: { value: new THREE.Vector3() }, uGain: { value: 0 }, uN: { value: 1 } }, THREE.FrontSide);
      const mesh = new THREE.Mesh(this.ballGeo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.brushScene.add(mesh);
      this.ownMats.push(mat);
      b = { mesh, mat, prev: null };
      this.balls[i] = b;
    }
    return b;
  }

  private charaSet(a: FluidActor): CharaSet | null {
    let s = this.charas.get(a);
    if (s) return s;
    const info = this.data?.brushes[a.tpl.key];
    if (!info) return null;
    s = { root: a.root, input: a.root.getObjectByName('NDinput_0') ?? null, brushes: [], prev: null, u0: 0 };
    a.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      const b = info[name];
      const axis = BRUSH_AXIS[name];
      const tex = b ? this.charaTex.get(b.tex) : undefined;
      if (!b || !axis || !tex) return;
      const mat = brushMat(CHARA_FS, { uRect: { value: new THREE.Vector4(...this.rect) }, uTex: { value: tex }, uW: { value: 0 }, uS: { value: 0 }, uU0: { value: 0 }, uU1: { value: b.u1x }, uM160: { value: M160 }, uN: { value: 1 } }, THREE.DoubleSide);
      const proxy = new THREE.Mesh(m.geometry, mat);
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      this.brushScene.add(proxy);
      this.ownMats.push(mat);
      s!.brushes.push({ src: m, proxy, mat, axis });
    });
    this.charas.set(a, s);
    return s;
  }

  private pass(gl: THREE.WebGLRenderer, mat: THREE.Material, target: THREE.WebGLRenderTarget): void {
    this.quad!.material = mat;
    gl.setRenderTarget(target);
    gl.render(this.quadScene, this.cam);
  }

  /** 로직 프레임이 나아간 만큼 높이장을 갱신한다(화면 render 마다, 무대 그리기 전) */
  update(gl: THREE.WebGLRenderer, state: Hsmg402State, actors: readonly (FluidActor | null)[]): void {
    const p = this.params;
    if (!p || !this.brushRT || !this.normalRT || !this.updateMat || !this.normalMat || !this.initMat) return;
    const prevTarget = gl.getRenderTarget();
    const prevAuto = gl.autoClear;
    const prevColor = gl.getClearColor(new THREE.Color());
    const prevAlpha = gl.getClearAlpha();
    gl.autoClear = false;
    if (!this.started) {
      this.pass(gl, this.initMat, this.heights[this.cur]);
      this.started = true;
      this.lastFrame = state.frame;
    }
    const n = Math.min(Math.max(state.frame - this.lastFrame, 0), 60);
    if (n > 0) {
      this.lastFrame = state.frame;
      this.drawBrushes(gl, state, actors, n);
      const src = this.heights[this.cur];
      const dst = this.heights[1 - this.cur];
      this.updateMat.uniforms.uHeight.value = src.texture;
      this.updateMat.uniforms.uAdd.value = p.fluid_heightmap_add_value * n;
      this.pass(gl, this.updateMat, dst);
      this.cur = 1 - this.cur;
    }
    this.normalMat.uniforms.uHeight.value = this.heights[this.cur].texture;
    this.pass(gl, this.normalMat, this.normalRT);
    mpsFluidEnv.height.value = this.heights[this.cur].texture;
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(prevColor, prevAlpha);
    gl.autoClear = prevAuto;
  }

  private drawBrushes(gl: THREE.WebGLRenderer, state: Hsmg402State, actors: readonly (FluidActor | null)[], n: number): void {
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    state.balls.forEach((bv: BallView | null, i) => {
      const live = !!bv && bv.state !== -1 && bv.visible;
      const b = live || this.balls[i] ? this.ballBrush(i) : null;
      if (!b) return;
      b.mesh.visible = live;
      if (!live || !bv) {
        b.prev = null;
        return;
      }
      pos.set(bv.pos.x, bv.pos.y, bv.pos.z);
      const d = b.prev ? pos.distanceTo(b.prev) : 0;
      b.prev = (b.prev ?? new THREE.Vector3()).copy(pos);
      q.set(bv.rot.x, bv.rot.y, bv.rot.z, bv.rot.w);
      scl.setScalar(bv.scale);
      b.mesh.matrix.compose(pos, q, scl).multiply(this.ballLocal);
      b.mesh.matrixWorld.copy(b.mesh.matrix);
      b.mat.uniforms.uCenter.value.copy(pos);
      b.mat.uniforms.uGain.value = sat((10 * d) / n) * M160;
      b.mat.uniforms.uN.value = n;
    });
    actors.forEach((a, i) => {
      const s = a ? this.charaSet(a) : null;
      if (!s) return;
      const pv = state.players[i];
      /* FluidMaterialParamChange: OnSyncSetup (0,1,1,1), 단계 0 에서 y ≤ 0 이면 (1,1,1,1) [판독 3.3·3.4] */
      if (pv && s.u0 === 0 && (pv.pos.y <= 0 || state.stage > 0)) s.u0 = 1;
      s.root.updateMatrixWorld(true);
      s.root.getWorldPosition(pos);
      const d = s.prev ? pos.distanceTo(s.prev) : 0;
      s.prev = (s.prev ?? new THREE.Vector3()).copy(pos);
      const w = s.input ? s.input.position : null;
      for (const b of s.brushes) {
        b.proxy.matrixWorld.copy(b.src.matrixWorld);
        b.proxy.matrix.copy(b.src.matrixWorld);
        b.mat.uniforms.uW.value = w ? w[b.axis] : 0;
        b.mat.uniforms.uS.value = sat((10 * d) / n);
        b.mat.uniforms.uU0.value = s.u0;
        b.mat.uniforms.uN.value = n;
      }
    });
    gl.setRenderTarget(this.brushRT);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, false, false);
    gl.render(this.brushScene, this.cam);
  }

  dispose(): void {
    if (mpsFluidEnv.height.value && this.heights.some((h) => h.texture === mpsFluidEnv.height.value)) mpsFluidEnv.height.value = null;
    if (this.normalRT && mpsFluidEnv.normal.value === this.normalRT.texture) mpsFluidEnv.normal.value = null;
    for (const h of this.heights) h.dispose();
    this.heights = [];
    this.brushRT?.dispose();
    this.brushRT = null;
    this.normalRT?.dispose();
    this.normalRT = null;
    for (const m of this.ownMats) m.dispose();
    this.ownMats.length = 0;
    this.quad?.geometry.dispose();
    this.quad = null;
    this.clearTex?.dispose();
    this.ballTex?.dispose();
    for (const t of this.charaTex.values()) t.dispose();
    this.charaTex.clear();
    this.brushScene.clear();
    this.quadScene.clear();
    this.balls.length = 0;
    this.charas.clear();
    this.params = null;
  }
}
