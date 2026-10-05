/**
 * hsmg402 포스트 — env fmdb post_mt 값 [데이터] + 원본 ndrender 후처리 셰이더(posteffect_amalgam0·posteffect_bloom_v4_*.bnsh, Maxwell SASS)와
 * main 의 유니폼·변형 선택 코드 판독 [판독]. 근거·식 전체는 web/docs/engine/07_camera_lighting.md(mps 판) 5절.
 *
 * 원본 체인(posteffect_filter_order 1 + 블룸 켬) [판독 main @0x7100404a00~0x7100404bc0]:
 *   장면(HDR) → 블룸 v4(bloom_filter_type 2: first → down_1..4 → up_3..0) → 합성 패스(amalgam 변형 = 189·U + 27·(tonemap_type+1) + 18,
 *   U = 1 + lut_filter_enable + 3·silhouette_enable): 장면 + 블룸 → 노출 → 톤맵 → LUT → 비네트 → LDR → 마지막 패스(변형 2): FXAA → 화면
 *   - 노출: x = c·exposure + exposure_offset (offset 은 더하기, 2^offset 아님) [UBO c[0xd0]·c[0xd4] ← post+0x10·+0x14]
 *   - 톤맵 타입 5 = 유리식 곡선(아래 hsTone, 상수는 셰이더 상수 풀 그대로) → sat → × tonemap_output_scale
 *   - LUT: g = t^(1/2.2) 로 16³ LUT(sRGB 형식, 하드웨어 복호 → 선형)를 그대로 조회, lut_blend(0..1) = 둘째 LUT(color_lut1) 섞는 비율 → 0 = 첫 LUT 100%
 *   - 비네트: out·(1 − vignette·|(ndc.x·vignette_aspect, ndc.y)|) (선형 값에 곱, 자르지 않음)
 *   - 블룸 first: L = (0.2125, 0.7154, 0.0721)·c, b = max(0, c·(L·scale·exposure − scale·threshold)) [UBO c[0xe4]·c[0xe8], filter_order 1 이면 노출 곱]
 *     down: 13탭(가운데 4×0.125, 0.0625 십자 4, 0.03125 모서리 4 + 가운데 0.125), up_3·up_2: 4탭 평균을 지금 단과 2/3 섞음,
 *     up_1: 한 탭 2/3, up_0: 한 탭 7/9 → 합성에서 장면에 더한다(별도 배율 없음)
 *   - FXAA(fxaa_filter_type 1): 상대 문턱 = fxaa_threshold·0.7152, 절대 문턱 0.0833 [UBO c[0x17c], 상수 풀]
 * 근사 [근사]:
 *   - 블룸 first 해상도(절반), up 4탭 간격(아랫단 1텍셀), first 의 min(c·k, 둘째 텍스처 + 0.5) 상한은 미판독이라 뺐다.
 *   - FXAA 는 three FXAAShader(원본 FXAA 3.11 계열과 탐색 단계가 다르다)에 문턱만 원본 값으로.
 *   - 마지막 렌더 타깃이 sRGB 라고 보고 LUT 결과(선형)를 sRGB 로 다시 부호화해 LDR 에 쓴다 [추정].
 *   - 톤맵은 SASS 로 읽은 타입 0(max(x,0))·3(x/(1+x))·5(유리식)만 구현하고 1(ACES 근사 상수)·2(Hable 상수)·4(GT 상수)는 상수만 봤으므로
 *     5 식으로 둔다. lut_filter_enable 0 이면 LUT 없이 t 를 그대로 쓴다(그 변형은 미판독).
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Assets } from '../../../view/assets';
import type { PostRenderer } from '../../../view/renderer';

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** 블룸 first [posteffect_bloom_v4_first.bnsh] */
const BLOOM_FIRST = /* glsl */ `
uniform sampler2D tSrc;
uniform float kScale;
uniform float kSub;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2125, 0.7154, 0.0721));
  float k = l * kScale - kSub;
  gl_FragColor = vec4(max(c * k, vec3(0.0)), 1.0);
}`;

/** 13탭 다운샘플 [posteffect_bloom_v4_down_*.bnsh] */
const BLOOM_DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 texel;
varying vec2 vUv;
vec3 s(float x, float y) { return texture2D(tSrc, vUv + texel * vec2(x, y)).rgb; }
void main() {
  vec3 c = (s(0.0, -2.0) + s(-2.0, 0.0) + s(2.0, 0.0) + s(0.0, 2.0)) * 0.0625
         + (s(-2.0, -2.0) + s(2.0, -2.0) + s(-2.0, 2.0) + s(2.0, 2.0)) * 0.03125
         + (s(-1.0, -1.0) + s(1.0, -1.0) + s(-1.0, 1.0) + s(1.0, 1.0) + s(0.0, 0.0)) * 0.125;
  gl_FragColor = vec4(c, 1.0);
}`;

/** 업샘플 섞기 [posteffect_bloom_v4_up_*.bnsh] — taps 4 = 4탭 평균, 1 = 한 탭 */
const BLOOM_UP = /* glsl */ `
uniform sampler2D tCur;
uniform sampler2D tLow;
uniform vec2 texel;
uniform float k;
uniform float taps;
varying vec2 vUv;
void main() {
  vec3 cur = texture2D(tCur, vUv).rgb;
  vec3 low;
  if (taps > 1.5) {
    low = (texture2D(tLow, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tLow, vUv + texel * vec2(1.0, -1.0)).rgb
         + texture2D(tLow, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tLow, vUv + texel * vec2(1.0, 1.0)).rgb) * 0.25;
  } else {
    low = texture2D(tLow, vUv).rgb;
  }
  gl_FragColor = vec4(cur + (low - cur) * k, 1.0);
}`;

/** 합성(블룸 더하기·노출·톤맵 5·LUT·비네트) [posteffect_amalgam0.bnsh 변형 558] */
const COMBINE = /* glsl */ `
precision highp sampler3D;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler3D tLut;
uniform float useBloom;
uniform float useLut;
uniform float exposure;
uniform float exposureOffset;
uniform float outScale;
uniform float toneType;
uniform float vignette;
uniform float vignetteAspect;
varying vec2 vUv;
vec3 hsTone(vec3 x) {
  vec3 num = x * (x * (x * (3.835061073 * x - 0.7351529002) + 0.1352372020) + 0.03166370839);
  vec3 den = x * (x * (x * (3.921293020 * x - 1.517683983) + 1.862025976) - 0.3955189884) + 0.07032027096;
  return clamp(num / den, 0.0, 1.0);
}
vec3 toSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  if (useBloom > 0.5) c += texture2D(tBloom, vUv).rgb;
  vec3 x = c * exposure + exposureOffset;
  vec3 t = toneType < 0.5 ? max(x, vec3(0.0)) : toneType > 2.5 && toneType < 3.5 ? x / (x + 1.0) : hsTone(x);
  t *= outScale;
  vec3 lin = t;
  if (useLut > 0.5) {
    vec3 g = exp2(log2(max(abs(t), vec3(1e-8))) * 0.4545454383);
    lin = texture(tLut, g).rgb;
  }
  vec2 ndc = vUv * 2.0 - 1.0;
  float r = sqrt(ndc.x * vignetteAspect * ndc.x * vignetteAspect + ndc.y * ndc.y);
  lin -= lin * (r * vignette);
  gl_FragColor = vec4(toSrgb(lin), 1.0);
}`;

/** FXAA 끔일 때 그대로 옮기기 */
const COPY = /* glsl */ `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`;

function quadMat(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, glslVersion: null });
}

function hdrTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
}

/** 16³ LUT png(256×16, 가로로 z 조각 16장) → Data3DTexture(sRGB) [데이터 hsmg402_lut R8G8B8A8_SRGB] */
export async function loadLut3D(assets: Assets, path: string): Promise<THREE.Data3DTexture> {
  const img = await new THREE.ImageLoader().loadAsync(assets.url(path));
  const n = img.height;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d 캔버스 없음');
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, img.width, img.height).data;
  const data = new Uint8Array(n * n * n * 4);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const s = (y * img.width + z * n + x) * 4;
        const d = ((z * n + y) * n + x) * 4;
        data[d] = src[s];
        data[d + 1] = src[s + 1];
        data[d + 2] = src[s + 2];
        data[d + 3] = 255;
      }
  const t = new THREE.Data3DTexture(data, n, n, n);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class PostChain implements PostRenderer {
  private readonly size = new THREE.Vector2(-1, -1);
  private readonly hdr: THREE.WebGLRenderTarget;
  private readonly ldr: THREE.WebGLRenderTarget;
  /** 블룸 내림 단 b0..b4 · 올림 단 u0..u3 */
  private readonly down: THREE.WebGLRenderTarget[] = [];
  private readonly up: THREE.WebGLRenderTarget[] = [];
  private readonly bloomOn: boolean;
  private readonly firstMat: THREE.ShaderMaterial;
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly combineMat: THREE.ShaderMaterial;
  private readonly fxaaMat: THREE.ShaderMaterial;
  private readonly fxaaOn: boolean;
  private readonly quad = new FullScreenQuad();
  private readonly dummyLut: THREE.Data3DTexture;
  private lut: THREE.Data3DTexture | null = null;
  private readonly saved: { toneMapping: THREE.ToneMapping; exposure: number; shadow: boolean; shadowType: THREE.ShadowMapType };

  constructor(
    private readonly gl: THREE.WebGLRenderer,
    private readonly p: Record<string, number>,
  ) {
    this.hdr = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
    this.ldr = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.bloomOn = !!p.bloom_enable;
    for (let i = 0; i < 5; i++) this.down.push(hdrTarget());
    for (let i = 0; i < 4; i++) this.up.push(hdrTarget());
    const exposure = p.exposure ?? 1;
    const scale = p.bloom_scale ?? 1;
    const order1 = (p.posteffect_filter_order ?? 0) === 1;
    this.firstMat = quadMat(BLOOM_FIRST, {
      tSrc: { value: null },
      kScale: { value: order1 ? scale * exposure : scale },
      kSub: { value: scale * (p.bloom_threshold ?? 0.7) },
    });
    this.downMat = quadMat(BLOOM_DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
    this.upMat = quadMat(BLOOM_UP, { tCur: { value: null }, tLow: { value: null }, texel: { value: new THREE.Vector2() }, k: { value: 0 }, taps: { value: 1 } });
    this.dummyLut = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1);
    this.dummyLut.needsUpdate = true;
    this.combineMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMBINE,
      glslVersion: null,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        tLut: { value: this.dummyLut },
        useBloom: { value: this.bloomOn ? 1 : 0 },
        useLut: { value: 0 },
        exposure: { value: exposure },
        exposureOffset: { value: p.exposure_offset ?? 0 },
        outScale: { value: p.tonemap_output_scale ?? 1 },
        toneType: { value: p.tonemap_type ?? 5 },
        vignette: { value: p.vignette ?? 0 },
        vignetteAspect: { value: p.vignette_aspect ?? 1 },
      },
    });
    const rel = (p.fxaa_threshold ?? 0.125) * ((p.fxaa_filter_type ?? 1) === 1 ? 0.7152 : 1);
    const fx = FXAAShader.fragmentShader
      .replace(/float _RelativeThreshold = [0-9.]+;/, `float _RelativeThreshold = ${rel.toFixed(5)};`)
      .replace(/float _ContrastThreshold = [0-9.]+;/, 'float _ContrastThreshold = 0.0833;');
    this.fxaaOn = !!p.fxaa_enable;
    this.fxaaMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
      vertexShader: FXAAShader.vertexShader,
      fragmentShader: this.fxaaOn ? fx : COPY,
      depthTest: false,
      depthWrite: false,
    });
    this.saved = { toneMapping: gl.toneMapping, exposure: gl.toneMappingExposure, shadow: gl.shadowMap.enabled, shadowType: gl.shadowMap.type };
    gl.toneMapping = THREE.NoToneMapping;
    gl.toneMappingExposure = 1;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  /** 색 보정 LUT(lut_filter_enable 1 일 때만 쓴다) */
  setLut(tex: THREE.Data3DTexture | null): void {
    this.lut = tex;
    const on = !!tex && !!this.p.lut_filter_enable;
    this.combineMat.uniforms.tLut.value = on ? tex : this.dummyLut;
    this.combineMat.uniforms.useLut.value = on ? 1 : 0;
  }

  private resize(): void {
    const s = this.gl.getDrawingBufferSize(new THREE.Vector2());
    if (s.equals(this.size)) return;
    this.size.copy(s);
    this.hdr.setSize(s.x, s.y);
    this.ldr.setSize(s.x, s.y);
    let w = Math.max(1, Math.ceil(s.x / 2));
    let h = Math.max(1, Math.ceil(s.y / 2));
    for (let i = 0; i < 5; i++) {
      this.down[i].setSize(w, h);
      if (i < 4) this.up[i].setSize(w, h);
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
    }
    this.fxaaMat.uniforms.resolution.value.set(1 / s.x, 1 / s.y);
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.gl.setRenderTarget(target);
    this.quad.render(this.gl);
  }

  private bloom(): THREE.Texture {
    const d = this.down;
    const u = this.up;
    this.firstMat.uniforms.tSrc.value = this.hdr.texture;
    this.pass(this.firstMat, d[0]);
    for (let i = 1; i < 5; i++) {
      this.downMat.uniforms.tSrc.value = d[i - 1].texture;
      this.downMat.uniforms.texel.value.set(1 / d[i - 1].width, 1 / d[i - 1].height);
      this.pass(this.downMat, d[i]);
    }
    /* up_3(4탭 2/3) → up_2(4탭 2/3) → up_1(한 탭 2/3) → up_0(한 탭 7/9) */
    const um = this.upMat.uniforms;
    for (let i = 3; i >= 0; i--) {
      const low = i === 3 ? d[4] : u[i + 1];
      um.tCur.value = d[i].texture;
      um.tLow.value = low.texture;
      um.texel.value.set(1 / low.width, 1 / low.height);
      um.taps.value = i >= 2 ? 4 : 1;
      um.k.value = i === 0 ? 7 / 9 : 2 / 3;
      this.pass(this.upMat, u[i]);
    }
    return u[0].texture;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const gl = this.gl;
    this.resize();
    gl.setRenderTarget(this.hdr);
    gl.clear();
    gl.render(scene, camera);
    const cu = this.combineMat.uniforms;
    cu.tScene.value = this.hdr.texture;
    cu.tBloom.value = this.bloomOn ? this.bloom() : null;
    this.pass(this.combineMat, this.ldr);
    this.fxaaMat.uniforms.tDiffuse.value = this.ldr.texture;
    this.pass(this.fxaaMat, null);
  }

  dispose(): void {
    this.gl.toneMapping = this.saved.toneMapping;
    this.gl.toneMappingExposure = this.saved.exposure;
    this.gl.shadowMap.enabled = this.saved.shadow;
    this.gl.shadowMap.type = this.saved.shadowType;
    this.hdr.dispose();
    this.ldr.dispose();
    for (const t of [...this.down, ...this.up]) t.dispose();
    for (const m of [this.firstMat, this.downMat, this.upMat, this.combineMat, this.fxaaMat]) m.dispose();
    this.quad.dispose();
    this.dummyLut.dispose();
    this.lut?.dispose();
  }
}
