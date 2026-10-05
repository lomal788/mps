/**
 * 원본 레이아웃(nn::ui2d BFLYT/BFLAN v9) 최소 재생기 — 페인 트리·애니 트랙·재질·FFNT/OTF 글자를 1920×1080 기준 좌표로 그린다.
 * 데이터는 web/tools/analysis/ui_lyt.py 파서 출력(tools/mg1801_web_ui.py 가 ui.json 으로 묶음)을 그대로 쓴다. 규칙 출처는 docs/engine/05_ui_input.md 3절.
 *
 * 그리기: 자체 three.js WebGLRenderer(화면 밖 캔버스)에 사각형 메시로 그린 뒤 HUD 2D 캔버스에 drawImage 한다(3D 렌더러와 상태를 섞지 않는다).
 * 좌표: 레이아웃 원점 = 화면 가운데, y 위가 +. M(pane) = M(parent)·T(부모 원점점)·T(translate)·Rz·S (05 3.3).
 *
 * 원본과 같게 둔 것: 페인 변환·원점·부모 원점, 알파 전파(influencedAlpha), 애니 트랙(FLPA·FLVC·FLVI·FLMC·FLTS·FLTP, 에르미트·계단),
 *   애니가 끝나면 마지막 값 유지(ui2d 처럼 페인 값을 덮어쓰고 되돌리지 않음), 텍스처 랩(clamp·repeat·mirror)·UV 4점·정점색 4점.
 * 근사(원본 셰이더·컴바이너 미판독):
 *   - 재질 색 = black + (white − black) × 텍스처(채널마다), × 정점색 × 누적 알파 [추정: ui2d 기본 컴바이너]. 감마 공간에서 섞는다.
 *   - TEV 단계가 있는 재질(텍스처 2장)은 두 텍스처를 곱한다 [근사].
 *   - 텍스처 SRT = nw4r CalcTextureMtx 꼴(가운데 0.5 기준 회전·배율 + 이동) [추정].
 *   - 창(wnd1)은 windowFlags bit0(한 재질로 전부)일 때 프레임 재질 텍스처를 모서리(뒤집기)·변(clamp 늘림)·내용(clamp)으로 9칸 그린다 [근사].
 *   - 글자: 비트맵(FFNT) 배율 = fontSize / (FINF 폭, 높이) [추정: nn::font SetFontSize 규칙], 기준선 = 줄 위 + ascent, 글자 색 =
 *     black→white 를 커버리지로 보간, 위·아래 색 그라데이션은 글자마다. OTF 는 기준 크기(bfcpx)와 hhea 높이로 배율 [추정].
 *     한 줄만, 자동 축소·글자별 변환·그림자(txtFlags) 없음.
 *   - 부품(prt1): layoutFile 레이아웃을 자식 인스턴스로 만들어 그 페인 자리에 그린다(부품 루트를 부품 페인 가운데에 붙인다). 페인 애니를 부품 페인에
 *     걸면 부품 레이아웃 자신의 애니(<부품>_<태그>)를 재생한다 [추정: ui2d 부품 애니 규칙]. 속성 덮어쓰기(properties)는 다루지 않는다.
 *   - 마스크(페인 시스템 데이터 형식 3, tools/mg1801_web_ui.py pane_masks): 마스크 텍스처 알파를 SRT·랩대로 곱한다 [추정: ui2d 마스크 합성].
 *   - FLCT·FLIM·사용자 데이터 애니, 정렬(ali1)·스크롤(scr1) 페인은 다루지 않는다.
 */
import * as THREE from 'three';
import { SCREEN_H, SCREEN_W } from './renderer';

export type Rgba = [number, number, number, number];

export interface LytTexMap {
  tex: string;
  wrapU: string;
  wrapV: string;
  minFilter: string;
  magFilter: string;
}

export interface LytSrt {
  t: [number, number];
  r: number;
  s: [number, number];
}

export interface LytMaterial {
  name: string;
  black: string;
  white: string;
  texMaps: LytTexMap[];
  texSrt: LytSrt[];
  tev: { color: number; alpha: number }[];
}

export interface LytPane {
  type: string;
  name: string;
  visible: boolean;
  influencedAlpha: boolean;
  origin: [string, string];
  parentOrigin: [string, string];
  alpha: number;
  translate: [number, number, number];
  rotate: [number, number, number];
  scale: [number, number];
  size: [number, number];
  children: LytPane[];
  vtxColors?: string[];
  material?: string;
  uvs?: number[][];
  font?: string;
  fontSize?: [number, number];
  charSpace?: number;
  colorTop?: string;
  colorBottom?: string;
  textAlign?: { x: string; y: string };
  userData?: Record<string, unknown>;
  frameSize?: { l: number; r: number; t: number; b: number };
  windowFlags?: number;
  content?: { vtxColors: string[]; material: string; uvs: number[][] };
  frames?: { material: string; flip: number }[];
  /** 부품(prt1) 레이아웃 이름 */
  layoutFile?: string;
  /** 마스크 텍스처(페인 시스템 데이터) */
  mask?: { tex: string; wrapU: string; wrapV: string; srt: LytSrt };
}

export interface Lyt {
  textures: string[];
  fonts: string[];
  materials: LytMaterial[];
  layout: { size: [number, number]; name: string };
  root: LytPane;
}

export interface LanTrack {
  index: number;
  target: number;
  curve: string;
  keys: number[][];
}

export interface Lan {
  tag: { name: string; start: number; end: number };
  frameSize: number;
  loop: boolean;
  textures: string[];
  entries: { name: string; target: string; tags: { tag: string; tracks: LanTrack[] }[] }[];
}

/** 비트맵 글자 아틀라스(tools/mg1801_web_ui.py build_atlas) */
export interface LytFontAtlas {
  fonts: string[];
  main: string;
  height: number;
  width: number;
  ascent: number;
  lineFeed: number;
  file: string;
  /** color = 컬러 글리프(BC7 시트, 셀 RGBA 그대로) — 커버리지 섞기 대신 텍스처 색을 그대로 쓴다 */
  glyphs: Record<string, { x: number; y: number; w: number; h: number; left: number; adv: number; baseline: number; font: string; color?: boolean }>;
}

export interface LytTelopFont {
  file: string;
  family: string;
  baseSize: number;
  unitsPerEm: number;
  ascent: number;
  descent: number;
}

const hex = (s: string): Rgba => [1, 3, 5, 7].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgba;

/** 표준 3차 에르미트(기울기 × 구간 길이). 같은 프레임 키 두 개 = 불연속 [05 3.7] */
function hermite(keys: number[][], f: number): number {
  if (f <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (f >= last[0]) return last[1];
  for (let i = 0; i + 1 < keys.length; i++) {
    const [t0, v0, s0 = 0] = keys[i];
    const [t1, v1, s1 = 0] = keys[i + 1];
    if (f < t0 || f > t1) continue;
    const d = t1 - t0;
    if (d === 0) return v1;
    const t = (f - t0) / d;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * d * s0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * d * s1;
  }
  return last[1];
}

function stepKey(keys: number[][], f: number): number {
  let v = keys[0][1];
  for (const k of keys) if (k[0] <= f) v = k[1];
  return v;
}

export function evalTrack(tr: LanTrack, f: number): number {
  return tr.curve === 'hermite' ? hermite(tr.keys, f) : stepKey(tr.keys, f);
}

/** 애니 하나의 재생 상태. 프레임은 태그 시작 기준(0..frameSize), 키도 같은 기준이다 [데이터: bflan 키 범위] */
export class AnimPlayer {
  frame = 0;
  /** 프레임당 진행량(원본 SetAnimationSpeed / PlayRate) */
  speed = 1;

  constructor(
    readonly lan: Lan,
    /** 페인 애니(PlayPaneAnimation)면 그 페인 하위 이름만 */
    readonly only: Set<string> | null,
  ) {}

  get ended(): boolean {
    return !this.lan.loop && this.frame >= this.lan.frameSize;
  }

  advance(frames: number): void {
    const n = this.lan.frameSize;
    this.frame += frames * this.speed;
    if (this.lan.loop) {
      if (n > 0) this.frame = ((this.frame % n) + n) % n;
    } else if (this.frame > n) this.frame = n;
  }
}

class PaneState {
  t: number[];
  r: number[];
  s: number[];
  size: number[];
  alpha: number;
  visible: boolean;
  /** 정점색 TL, TR, BL, BR. 글자 페인은 0 = 위 색, 2 = 아래 색, 창은 내용 정점색 */
  vtx: Rgba[];
  children: PaneState[] = [];

  constructor(readonly src: LytPane) {
    this.t = [...src.translate];
    this.r = [...src.rotate];
    this.s = [...src.scale];
    this.size = [...src.size];
    this.alpha = src.alpha;
    this.visible = src.visible;
    const c = src.type === 'txt1' ? [src.colorTop!, src.colorTop!, src.colorBottom!, src.colorBottom!] : src.type === 'wnd1' ? src.content!.vtxColors : (src.vtxColors ?? ['#ffffffff', '#ffffffff', '#ffffffff', '#ffffffff']);
    this.vtx = c.map(hex);
  }
}

class MatState {
  black: Rgba;
  white: Rgba;
  srt: LytSrt[];
  tex: string[];

  constructor(readonly src: LytMaterial) {
    this.black = hex(src.black);
    this.white = hex(src.white);
    this.srt = src.texSrt.map((s) => ({ t: [...s.t] as [number, number], r: s.r, s: [...s.s] as [number, number] }));
    this.tex = src.texMaps.map((m) => m.tex);
  }
}

/** 부품 레이아웃 찾기(이름 → 레이아웃·애니) */
export type LytPartsResolver = (layoutFile: string) => { lyt: Lyt; anims: Record<string, Lan> } | null;

type Mat3 = [number, number, number, number, number, number];

/** 레이아웃 하나의 실행 인스턴스(원본 CaComUiBase/ComUi 하나에 해당) */
export class LayoutInstance {
  readonly panes = new Map<string, PaneState>();
  readonly mats = new Map<string, MatState>();
  readonly root: PaneState;
  /** 레이아웃 표시(원본 ComGuiLayout+0x136 / SetVisible) */
  visible = false;
  /** 엔티티 이동(레이아웃 좌표, 원본 Entity::SetTranslation) */
  pos = { x: 0, y: 0 };
  /** 그리는 순서(같은 묶음 안에서 큰 값이 위) */
  order = 0;
  main: AnimPlayer | null = null;
  readonly paneAnims = new Map<string, AnimPlayer>();
  readonly texts = new Map<string, string>();
  /** 부품 페인 이름 → 부품 레이아웃 인스턴스 */
  readonly parts = new Map<string, LayoutInstance>();

  constructor(
    readonly lyt: Lyt,
    readonly anims: Record<string, Lan>,
    resolve?: LytPartsResolver,
  ) {
    for (const m of lyt.materials) this.mats.set(m.name, new MatState(m));
    const build = (p: LytPane): PaneState => {
      const s = new PaneState(p);
      this.panes.set(p.name, s);
      s.children = p.children.map(build);
      const sub = p.type === 'prt1' && p.layoutFile && resolve ? resolve(p.layoutFile) : null;
      if (sub) {
        const part = new LayoutInstance(sub.lyt, sub.anims, resolve);
        part.visible = true;
        this.parts.set(p.name, part);
      }
      return s;
    };
    this.root = build(lyt.root);
  }

  /** 부품 페인의 부품 인스턴스('a/b' 면 부품 안의 부품) */
  part(path: string): LayoutInstance | null {
    let cur: LayoutInstance | null = this;
    for (const n of path.split('/')) cur = cur?.parts.get(n) ?? null;
    return cur;
  }

  /**
   * 원본 nn::bezel::ComGuiLayout::GetPaneGlobalPosition — 페인 원점의 레이아웃 좌표(가운데 원점, y 위 +).
   * 지금 애니 값이 반영된 페인 변환을 루트부터 곱한다.
   */
  paneGlobalPos(name: string): { x: number; y: number } | null {
    const walk = (p: PaneState, parentM: Mat3, parent: PaneState | null): { x: number; y: number } | null => {
      const [ax, ay] = anchorOf(parent, p.src);
      const m = mul(mul(parentM, tr(ax, ay)), localOf(p));
      if (p.src.name === name) return { x: m[2], y: m[5] };
      for (const c of p.children) {
        const r = walk(c, m, p);
        if (r) return r;
      }
      return null;
    };
    return walk(this.root, tr(0, 0), null);
  }

  /** 페인 애니(부품 페인이면 부품의 레이아웃 애니) 프레임을 바꾸고 값을 바로 쓴다(원본 SetPaneAnimationFrame) */
  setPaneFrame(pane: string, frame: number): void {
    const part = this.parts.get(pane);
    const a = part ? part.main : this.paneAnims.get(pane);
    if (!a) return;
    a.frame = frame;
    if (part) part.apply(a);
    else this.apply(a);
  }

  /** 레이아웃 전체 애니 프레임(원본 SetAnimationFrame) */
  setFrame(frame: number): void {
    if (!this.main) return;
    this.main.frame = frame;
    this.apply(this.main);
  }

  /** 원본 CaComUiBase::PlayAnimation(태그) — 레이아웃 전체 애니를 바꾼다 */
  play(tag: string, speed = 1, frame = 0): AnimPlayer {
    const lan = this.anims[tag];
    if (!lan) throw new Error(`애니 없음 ${this.lyt.layout.name}_${tag}`);
    this.main = new AnimPlayer(lan, null);
    this.main.speed = speed;
    this.main.frame = frame;
    this.apply(this.main);
    return this.main;
  }

  /** 원본 CaComUiBase::PlayPaneAnimation(페인, 태그) — 그 페인 하위에만 건다. 부품 페인이면 부품 레이아웃의 그 애니 */
  playPane(pane: string, tag: string, speed = 1): AnimPlayer {
    const part = this.parts.get(pane);
    if (part) return part.play(tag, speed);
    const lan = this.anims[tag];
    const root = this.panes.get(pane);
    if (!lan || !root) throw new Error(`페인 애니 없음 ${pane} ${tag}`);
    const only = new Set<string>();
    const walk = (p: PaneState): void => {
      only.add(p.src.name);
      if (p.src.material) only.add(p.src.material);
      p.children.forEach(walk);
    };
    walk(root);
    const a = new AnimPlayer(lan, only);
    a.speed = speed;
    this.paneAnims.set(pane, a);
    this.apply(a);
    return a;
  }

  setPaneVisible(name: string, v: boolean): void {
    const p = this.panes.get(name);
    if (p) p.visible = v;
  }

  /** frames 만큼 진행하고 트랙 값을 페인·재질에 쓴다 */
  update(frames: number): void {
    if (this.main) {
      this.main.advance(frames);
      this.apply(this.main);
    }
    for (const a of this.paneAnims.values()) {
      a.advance(frames);
      this.apply(a);
    }
    for (const p of this.parts.values()) p.update(frames);
  }

  private apply(a: AnimPlayer): void {
    const f = a.frame;
    for (const e of a.lan.entries) {
      if (a.only && !a.only.has(e.name)) continue;
      if (e.target === 'pane') {
        const p = this.panes.get(e.name);
        if (!p) continue;
        for (const tag of e.tags) {
          for (const tr of tag.tracks) {
            const v = evalTrack(tr, f);
            const k = tr.target;
            if (tag.tag === 'FLPA') {
              if (k < 3) p.t[k] = v;
              else if (k < 6) p.r[k - 3] = v;
              else if (k < 8) p.s[k - 6] = v;
              else if (k < 10) p.size[k - 8] = v;
            } else if (tag.tag === 'FLVC') {
              const c = Math.max(0, Math.min(255, v));
              if (k === 16) p.alpha = c;
              else if (k < 16) p.vtx[k >> 2][k & 3] = c;
            } else if (tag.tag === 'FLVI') p.visible = Math.round(v) !== 0;
          }
        }
      } else if (e.target === 'material') {
        const m = this.mats.get(e.name);
        if (!m) continue;
        for (const tag of e.tags) {
          for (const tr of tag.tracks) {
            const v = evalTrack(tr, f);
            const k = tr.target;
            if (tag.tag === 'FLMC') {
              const c = Math.max(0, Math.min(255, v));
              if (k < 4) m.black[k] = c;
              else if (k < 8) m.white[k - 4] = c;
            } else if (tag.tag === 'FLTS') {
              const s = m.srt[tr.index];
              if (!s) continue;
              if (k < 2) s.t[k] = v;
              else if (k === 2) s.r = v;
              else if (k < 5) s.s[k - 3] = v;
            } else if (tag.tag === 'FLTP') {
              const name = a.lan.textures[Math.round(v)];
              if (name !== undefined && tr.index < m.tex.length) m.tex[tr.index] = name;
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 그리기

const mul = (a: Mat3, b: Mat3): Mat3 => [
  a[0] * b[0] + a[1] * b[3],
  a[0] * b[1] + a[1] * b[4],
  a[0] * b[2] + a[1] * b[5] + a[2],
  a[3] * b[0] + a[4] * b[3],
  a[3] * b[1] + a[4] * b[4],
  a[3] * b[2] + a[4] * b[5] + a[5],
];
const tr = (x: number, y: number): Mat3 => [1, 0, x, 0, 1, y];
const xf = (m: Mat3, x: number, y: number): [number, number] => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
/** 페인 자신의 변환 T(translate)·Rz·S */
function localOf(p: PaneState): Mat3 {
  const rz = (p.r[2] * Math.PI) / 180;
  const c = Math.cos(rz);
  const s = Math.sin(rz);
  return [c * p.s[0], -s * p.s[1], p.t[0], s * p.s[0], c * p.s[1], p.t[1]];
}

/** 원점에 따른 사각형(left, bottom, right, top), y 위가 + [05 3.3] */
function rectOf(origin: [string, string], w: number, h: number): [number, number, number, number] {
  const x0 = origin[0] === 'left' ? 0 : origin[0] === 'right' ? -w : -w / 2;
  const y1 = origin[1] === 'top' ? 0 : origin[1] === 'bottom' ? h : h / 2;
  return [x0, y1 - h, x0 + w, y1];
}

function anchorOf(parent: PaneState | null, child: LytPane): [number, number] {
  if (!parent) return [0, 0];
  const [l, b, r, t] = rectOf(parent.src.origin, parent.size[0], parent.size[1]);
  const [px, py] = child.parentOrigin;
  return [px === 'left' ? l : px === 'right' ? r : (l + r) / 2, py === 'top' ? t : py === 'bottom' ? b : (b + t) / 2];
}

const VERT = `
attribute vec4 vcol;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vUv = uv;
  vCol = vcol;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform sampler2D map0;
uniform sampler2D map1;
uniform int texCount;
uniform int alphaMix;
uniform vec4 black;
uniform vec4 white;
uniform mat3 srt0;
uniform mat3 srt1;
uniform float alpha;
uniform sampler2D maskMap;
uniform int maskOn;
uniform mat3 srtMask;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = vec4(1.0);
  if (texCount > 0) t = texture2D(map0, (srt0 * vec3(vUv, 1.0)).xy);
  if (texCount > 1) t *= texture2D(map1, (srt1 * vec3(vUv, 1.0)).xy);
  vec4 c = alphaMix == 1 ? mix(black, white, t.a) : mix(black, white, t);
  c *= vCol;
  if (maskOn == 1) c.a *= texture2D(maskMap, (srtMask * vec3(vUv, 1.0)).xy).a;
  c.a *= alpha;
  gl_FragColor = vec4(c.rgb * c.a, c.a);
}`;

interface Quad {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  pos: Float32Array;
  uv: Float32Array;
  col: Float32Array;
}

const WRAP: Record<string, THREE.Wrapping> = {
  clamp: THREE.ClampToEdgeWrapping,
  repeat: THREE.RepeatWrapping,
  mirror: THREE.MirroredRepeatWrapping,
};

/** nw4r CalcTextureMtx 꼴 [추정]: uv' = R·S·(uv − 0.5) + 0.5 + t */
function srtMat(s: LytSrt | undefined): THREE.Matrix3 {
  const m = new THREE.Matrix3();
  if (!s) return m;
  const r = (s.r * Math.PI) / 180;
  const c = Math.cos(r);
  const n = Math.sin(r);
  const a0 = c * s.s[0];
  const a1 = -n * s.s[1];
  const b0 = n * s.s[0];
  const b1 = c * s.s[1];
  m.set(a0, a1, s.t[0] + 0.5 - 0.5 * a0 - 0.5 * a1, b0, b1, s.t[1] + 0.5 - 0.5 * b0 - 0.5 * b1, 0, 0, 1);
  return m;
}

export interface LytResources {
  /** 텍스처 이름 → 그림 */
  images: Map<string, TexImageSource>;
  /** fcpx 패밀리 → 아틀라스 메트릭·그림 */
  fonts: Map<string, { meta: LytFontAtlas; image: TexImageSource }>;
  telop: LytTelopFont | null;
}

type TexImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** 레이아웃 그리기(화면 밖 WebGL → HUD 2D 캔버스) */
export class LytRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-SCREEN_W / 2, SCREEN_W / 2, SCREEN_H / 2, -SCREEN_H / 2, -1, 1);
  private readonly quads: Quad[] = [];
  private used = 0;
  private readonly texCache = new Map<string, THREE.Texture>();
  private readonly telopCache = new Map<string, { tex: THREE.Texture; w: number; h: number; asc: number }>();
  private readonly white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);

  /** WebGL 문맥은 페이지에 하나만 만들어 게임을 다시 시작해도 늘지 않게 한다 */
  private static shared: THREE.WebGLRenderer | null = null;

  constructor(readonly res: LytResources) {
    if (!LytRenderer.shared) {
      const gl = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), alpha: true, premultipliedAlpha: true, antialias: true });
      gl.outputColorSpace = THREE.LinearSRGBColorSpace;
      gl.setPixelRatio(1);
      gl.setSize(SCREEN_W, SCREEN_H, false);
      gl.setClearColor(0x000000, 0);
      LytRenderer.shared = gl;
    }
    this.gl = LytRenderer.shared;
    this.canvas = this.gl.domElement;
    this.white.needsUpdate = true;
  }

  private texture(name: string, wrapU = 'clamp', wrapV = 'clamp'): THREE.Texture {
    const key = `${name}|${wrapU}|${wrapV}`;
    let t = this.texCache.get(key);
    if (t) return t;
    const img = this.res.images.get(name);
    if (!img) return this.white;
    t = new THREE.Texture(img);
    t.flipY = false;
    t.wrapS = WRAP[wrapU] ?? THREE.ClampToEdgeWrapping;
    t.wrapT = WRAP[wrapV] ?? THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    this.texCache.set(key, t);
    return t;
  }

  private quad(): Quad {
    let q = this.quads[this.used];
    if (!q) {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(12);
      const uv = new Float32Array(8);
      const col = new Float32Array(16);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('vcol', new THREE.BufferAttribute(col, 4));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      const m = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          map0: { value: this.white },
          map1: { value: this.white },
          texCount: { value: 0 },
          alphaMix: { value: 0 },
          black: { value: new THREE.Vector4() },
          white: { value: new THREE.Vector4(1, 1, 1, 1) },
          srt0: { value: new THREE.Matrix3() },
          srt1: { value: new THREE.Matrix3() },
          alpha: { value: 1 },
          maskMap: { value: this.white },
          maskOn: { value: 0 },
          srtMask: { value: new THREE.Matrix3() },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      q = { mesh, pos, uv, col };
      this.quads.push(q);
    }
    q.mesh.visible = true;
    q.mesh.renderOrder = this.used;
    this.used++;
    return q;
  }

  /** 사각형 하나: 네 점(TL, TR, BL, BR)·UV·정점색 */
  private emit(corners: [number, number][], uvs: number[], vtx: Rgba[], mat: MatState | null, alpha: number, alphaMix: boolean, tex0?: THREE.Texture, mask?: LytPane['mask']): void {
    const q = this.quad();
    for (let i = 0; i < 4; i++) {
      q.pos[i * 3] = corners[i][0];
      q.pos[i * 3 + 1] = corners[i][1];
      q.pos[i * 3 + 2] = 0;
      q.uv[i * 2] = uvs[i * 2];
      q.uv[i * 2 + 1] = uvs[i * 2 + 1];
      for (let k = 0; k < 4; k++) q.col[i * 4 + k] = vtx[i][k] / 255;
    }
    const g = q.mesh.geometry;
    for (const a of ['position', 'uv', 'vcol']) (g.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;
    const u = q.mesh.material.uniforms;
    const black = mat?.black ?? [0, 0, 0, 0];
    const white = mat?.white ?? [255, 255, 255, 255];
    (u.black.value as THREE.Vector4).set(black[0] / 255, black[1] / 255, black[2] / 255, black[3] / 255);
    (u.white.value as THREE.Vector4).set(white[0] / 255, white[1] / 255, white[2] / 255, white[3] / 255);
    u.alpha.value = alpha / 255;
    u.alphaMix.value = alphaMix ? 1 : 0;
    u.maskOn.value = mask ? 1 : 0;
    if (mask) {
      u.maskMap.value = this.texture(mask.tex, mask.wrapU, mask.wrapV);
      u.srtMask.value = srtMat(mask.srt);
    }
    if (tex0) {
      u.texCount.value = 1;
      u.map0.value = tex0;
      (u.srt0.value as THREE.Matrix3).identity();
    } else if (mat && mat.tex.length) {
      const maps = mat.src.texMaps;
      u.texCount.value = Math.min(2, mat.tex.length);
      u.map0.value = this.texture(mat.tex[0], maps[0].wrapU, maps[0].wrapV);
      u.srt0.value = srtMat(mat.srt[0]);
      if (mat.tex.length > 1) {
        u.map1.value = this.texture(mat.tex[1], maps[1].wrapU, maps[1].wrapV);
        u.srt1.value = srtMat(mat.srt[1]);
      }
    } else u.texCount.value = 0;
  }

  /** 프레임 시작: 지난 프레임 사각형을 모두 숨긴다 */
  begin(): void {
    for (let i = 0; i < this.used; i++) this.quads[i].mesh.visible = false;
    this.used = 0;
  }

  draw(inst: LayoutInstance): void {
    if (!inst.visible) return;
    this.pane(inst, inst.root, tr(inst.pos.x, inst.pos.y), null, 255);
  }

  /** 그려서 ctx 에 겹친다 */
  end(ctx: CanvasRenderingContext2D): void {
    for (let i = this.used; i < this.quads.length; i++) this.quads[i].mesh.visible = false;
    if (this.used === 0) return;
    this.gl.render(this.scene, this.camera);
    ctx.drawImage(this.canvas, 0, 0, SCREEN_W, SCREEN_H);
  }

  private pane(inst: LayoutInstance, p: PaneState, parentM: Mat3, parent: PaneState | null, alpha: number): void {
    if (!p.visible) return;
    const [ax, ay] = anchorOf(parent, p.src);
    const m = mul(mul(parentM, tr(ax, ay)), localOf(p));
    const my = (alpha * p.alpha) / 255;
    const rect = rectOf(p.src.origin, p.size[0], p.size[1]);
    if (p.src.type === 'pic1') this.picture(inst, p, m, rect, my);
    else if (p.src.type === 'wnd1') this.window(inst, p, m, rect, my);
    else if (p.src.type === 'txt1') this.text(inst, p, m, rect, my);
    const childAlpha = p.src.influencedAlpha ? my : alpha;
    if (p.src.type === 'prt1') {
      const part = inst.parts.get(p.src.name);
      if (part?.visible) this.pane(part, part.root, m, p, childAlpha);
    }
    for (const ch of p.children) this.pane(inst, ch, m, p, childAlpha);
  }

  private corners(m: Mat3, l: number, b: number, r: number, t: number): [number, number][] {
    return [xf(m, l, t), xf(m, r, t), xf(m, l, b), xf(m, r, b)];
  }

  private picture(inst: LayoutInstance, p: PaneState, m: Mat3, [l, b, r, t]: number[], alpha: number): void {
    const mat = inst.mats.get(p.src.material ?? '') ?? null;
    const uv = p.src.uvs?.[0] ?? [0, 0, 1, 0, 0, 1, 1, 1];
    this.emit(this.corners(m, l, b, r, t), uv, p.vtx, mat, alpha, false, undefined, p.src.mask);
  }

  /** 창: windowFlags bit0 이면 프레임 재질 하나로 9칸 [근사], 아니면 내용만 */
  private window(inst: LayoutInstance, p: PaneState, m: Mat3, [l, b, r, t]: number[], alpha: number): void {
    const src = p.src;
    const fs = src.frameSize!;
    const frameMat = src.frames?.[0] ? inst.mats.get(src.frames[0].material) ?? null : null;
    const oneMat = ((src.windowFlags ?? 0) & 1) !== 0 && frameMat;
    if (!oneMat || !frameMat) {
      this.emit(this.corners(m, l, b, r, t), src.content!.uvs[0] ?? [0, 0, 1, 0, 0, 1, 1, 1], p.vtx, inst.mats.get(src.content!.material) ?? null, alpha, false);
      return;
    }
    const img = this.res.images.get(frameMat.tex[0]);
    const tw = img ? img.width : fs.l;
    const th = img ? img.height : fs.t;
    const xs = [l, l + fs.l, r - fs.r, r];
    const ys = [t, t - fs.t, b + fs.b, b];
    // 모서리 텍스처(LT)를 오른쪽·아래 모서리에서는 뒤집어 쓰고, 변·내용은 clamp 로 텍스처 안쪽 끝 텍셀을 늘린다
    const uCol = [
      [0, fs.l / tw],
      [1, 1],
      [fs.r / tw, 0],
    ];
    const vRow = [
      [0, fs.t / th],
      [1, 1],
      [fs.b / th, 0],
    ];
    for (let iy = 0; iy < 3; iy++) {
      for (let ix = 0; ix < 3; ix++) {
        const [uL, uR] = uCol[ix];
        const [vT, vB] = vRow[iy];
        const corners: [number, number][] = [
          xf(m, xs[ix], ys[iy]),
          xf(m, xs[ix + 1], ys[iy]),
          xf(m, xs[ix], ys[iy + 1]),
          xf(m, xs[ix + 1], ys[iy + 1]),
        ];
        this.emit(corners, [uL, vT, uR, vT, uL, vB, uR, vB], p.vtx, frameMat, alpha, false);
      }
    }
  }

  private text(inst: LayoutInstance, p: PaneState, m: Mat3, [l, b, r, t]: number[], alpha: number): void {
    const str = inst.texts.get(p.src.name) ?? '';
    if (!str) return;
    const fam = (p.src.font ?? '').replace(/\.fcpx$/, '');
    const mat = inst.mats.get(p.src.material ?? '') ?? null;
    const fs = p.src.fontSize!;
    const align = p.src.textAlign ?? { x: 'center', y: 'center' };
    const top = p.vtx[0];
    const bottom = p.vtx[2];
    const place = (lineW: number, lineH: number): [number, number] => {
      const x = align.x === 'left' ? l : align.x === 'right' ? r - lineW : (l + r) / 2 - lineW / 2;
      const y = align.y === 'top' ? t : align.y === 'bottom' ? b + lineH : (b + t) / 2 + lineH / 2;
      return [x, y];
    };
    if (fam === 'bqfont_telop' && this.res.telop) {
      const tf = this.res.telop;
      const sx = fs[0] / tf.baseSize;
      const sy = fs[1] / ((tf.baseSize * (tf.ascent - tf.descent)) / tf.unitsPerEm);
      const img = this.telopImage(str, tf, sx / sy, fs[1]);
      if (!img) return;
      const [x0, yTop] = place(img.w, img.h);
      this.emit(this.corners(m, x0, yTop - img.h, x0 + img.w, yTop), [0, 0, 1, 0, 0, 1, 1, 1], [top, top, bottom, bottom], mat, alpha, true, img.tex);
      return;
    }
    const f = this.res.fonts.get(fam);
    if (!f) return;
    const meta = f.meta;
    const sx = fs[0] / meta.width;
    const sy = fs[1] / meta.height;
    const cs = p.src.charSpace ?? 0;
    const chars = [...str];
    let lineW = 0;
    chars.forEach((ch, i) => {
      lineW += (meta.glyphs[ch]?.adv ?? meta.width) * sx + (i > 0 ? cs : 0);
    });
    const lineH = meta.height * sy;
    let [pen, yTop] = place(lineW, lineH);
    const tex = this.texture(`font:${fam}`);
    const iw = f.image.width;
    const ih = f.image.height;
    for (const ch of chars) {
      const g = meta.glyphs[ch];
      if (g) {
        const gx = pen + g.left * sx;
        const gt = yTop - (meta.ascent - g.baseline) * sy;
        const u0 = g.x / iw;
        const u1 = (g.x + g.w) / iw;
        const v0 = g.y / ih;
        const v1 = (g.y + g.h) / ih;
        this.emit(this.corners(m, gx, gt - g.h * sy, gx + g.w * sx, gt), [u0, v0, u1, v0, u0, v1, u1, v1], [top, top, bottom, bottom], mat, alpha, !g.color, tex);
      }
      pen += (g?.adv ?? meta.width) * sx + cs;
    }
  }

  /** OTF 글자를 캔버스에 래스터라이즈한다(문자열·배율마다 한 번) */
  private telopImage(str: string, tf: LytTelopFont, ratio: number, px: number): { tex: THREE.Texture; w: number; h: number; asc: number } | null {
    const key = `${str}|${ratio}|${px}`;
    let e = this.telopCache.get(key);
    if (e) return e;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const font = `${px}px "${tf.family}"`;
    ctx.font = font;
    const w = ctx.measureText(str).width * ratio;
    const h = (px * (tf.ascent - tf.descent)) / tf.unitsPerEm;
    const asc = (px * tf.ascent) / tf.unitsPerEm;
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    ctx.font = font;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    ctx.setTransform(ratio, 0, 0, 1, 0, 0);
    ctx.fillText(str, 0, asc);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = false;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    e = { tex, w: c.width, h: c.height, asc };
    this.telopCache.set(key, e);
    return e;
  }

  /** 글자 아틀라스는 'font:<패밀리>' 이름으로 텍스처 표에 넣는다 */
  registerFontImages(): void {
    for (const [fam, f] of this.res.fonts) this.res.images.set(`font:${fam}`, f.image);
  }

  dispose(): void {
    for (const q of this.quads) {
      q.mesh.geometry.dispose();
      q.mesh.material.dispose();
    }
    for (const t of this.texCache.values()) t.dispose();
    for (const t of this.telopCache.values()) t.tex.dispose();
    this.white.dispose();
  }
}
