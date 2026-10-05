/**
 * mps(Bezel) 재질 → three.js 재질 변환 (게임 비의존 — 나중에 web/script/view 로 옮길 수 있게 게임 이름을 모른다).
 * 규칙과 근거: web/docs/engine/03_graphics.md (판독: web/tools/analysis/bfsha_dump·web/tools/analysis/sass_dis.py·web/tools/analysis/mat_uvmap.py, analysis/mat/).
 *
 * 입력
 *   - glb 재질 extras.fres(원본 재질의 셰이더 아카이브·옵션·renderInfo·파라미터·샘플러) — GLTFLoader 가 material.userData.fres 로 둔다
 *   - 재질 자료 material.json(web/tools/analysis/hsmg402_mat_assets.py): 샘플러별 UV 번호·texsrt 번호(원본 VS/FS 판독), glb 밖 텍스처(라이트맵·그래프 입력)
 *
 * 원본에서 읽은 것 [판독] → three
 *   - 기본색 = _a0 텍스처 × blendColor(rgba). forward_plus_simple 은 조명 없이 그대로 출력  → map, color = blendColor.rgb, opacity = blendColor.a
 *   - 샘플러 UV: 셰이더 입력 _uK(= glb TEXCOORD_K, 변환기가 attribAssign 반영)와 Material.texsrtK(2×3 행렬, VS 에서 곱함)
 *     → texture.channel = K, texture.matrix = texsrt 행렬. 어떤 샘플러가 어느 K·어느 texsrt 를 쓰는지는 프로그램마다 다르다(규칙 표)
 *   - 노멀 = _n0.rg × bumpScale, z = sqrt(1−x²−y²)  → normalScale = bumpScale
 *   - use_roughness_value / use_metallic_value = 1 → 텍스처 대신 roughness / metallic 상수
 *   - forward_plus_map: directional_light_off = 1 이면 평행광 루프가 없다(조명 = 라이트맵 + IBL), 라이트맵 _l0(TEXCOORD_1)
 *     확산 = albedo·(1−metallic)·lm.rgb·lightMapScale·lightmap_color_scale → lightMap, lightMapIntensity = π·lightMapScale·lightmap_color_scale
 *     (three 확산 = 조도·albedo/π 라서 π 를 곱한다). 발광 = _e0.rgb × emissionScale 을 마지막에 더함 → emissiveMap
 *   - IBL: 확산 IBL × irradianceColorScale, 반사 IBL × radianceColorScale (bg·ice·절벽은 irradianceColorScale 0)
 *   - 셰이더 그래프(main_fragment_shader_graph 해시)별 식 — RECIPES 주석
 *   - 평행광 세기는 조명 쪽(lighting.ts)이 π·max(color) 로 둔다. 직접 식을 짜는 곳(림)은 ÷π 해서 원본 광색을 쓴다
 * 추정·근사
 *   - texsrt 행렬 = nn::g3d Maya 모드 식(texSrtMatrix). u 쪽(−tx 를 배율 안에서 뺌)은 눈꺼풀 셀 이동 데이터와 맞음 [데이터], v 쪽 부호·회전 부호 [추정]
 *   - renderInfo state_type 0 불투명 / 1 컷아웃(punchThroughThresholdColor) / 2 알파 섞기 / 3 더하기 [추정: 쓰는 재질 상관 — DK 털·속눈썹·구름·부서짐·오로라·하늘띠]
 *   - face_cull_type 0 뒷면 컬링 / 1 앞면 컬링 / 2 양면 [추정: 데이터 상관]
 *   - 디테일 맵(_r1/_n1·_r3/_n3)·클리어코트·구름 그림자·라이트그리드·국소 IBL(재질 큐브)·물·유체 높이장·VAT·정점 셰이더 그래프는 옮기지 않는다
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export interface FresSampler {
  sampler: string;
  texture: string;
  png?: string;
  slots?: string[];
}

export interface FresMat {
  name?: string;
  shader?: {
    archive?: string;
    model?: string;
    options?: Record<string, string>;
    samplerAssign?: Record<string, string>;
    attribAssign?: Record<string, string>;
  };
  renderInfo?: Record<string, number[]>;
  params?: Record<string, { type: string; value: unknown }>;
  samplers?: FresSampler[];
}

export function fresOf(m: THREE.Material): FresMat {
  return ((m.userData as { fres?: FresMat }).fres ?? {}) as FresMat;
}

/** 원본 TexSrt(모드 Maya) */
export interface TexSrt {
  sx: number;
  sy: number;
  r: number;
  tx: number;
  ty: number;
}

const ID_SRT: TexSrt = { sx: 1, sy: 1, r: 0, tx: 0, ty: 0 };

export function texSrtOf(f: FresMat, k: number): TexSrt {
  const v = f.params?.[`texsrt${k}`]?.value as
    | { Scaling?: { X: number; Y: number }; Rotation?: number; Translation?: { X: number; Y: number } }
    | undefined;
  if (!v) return { ...ID_SRT };
  return { sx: v.Scaling?.X ?? 1, sy: v.Scaling?.Y ?? 1, r: v.Rotation ?? 0, tx: v.Translation?.X ?? 0, ty: v.Translation?.Y ?? 0 };
}

/**
 * TexSrt → UV 행렬. 셰이더는 u′ = M0·u + M2·v + M4, v′ = M1·u + M3·v + M5 로 쓴다 [판독: VS].
 * 행렬 값은 nn::g3d Maya 모드 식 [추정, u 쪽은 데이터로 확인]:
 *   u′ = sx·(c·u + s·v + (−0.5c − 0.5s + 0.5) − tx)
 *   v′ = sy·(−s·u + c·v + (0.5s − 0.5c + 0.5) + ty) + 1 − sy
 */
export function texSrtMatrix(t: TexSrt, out = new THREE.Matrix3()): THREE.Matrix3 {
  const c = Math.cos(t.r);
  const s = Math.sin(t.r);
  return out.set(
    t.sx * c, t.sx * s, t.sx * (-0.5 * c - 0.5 * s + 0.5 - t.tx),
    -t.sy * s, t.sy * c, t.sy * (0.5 * s - 0.5 * c + 0.5 + t.ty) + 1 - t.sy,
    0, 0, 1,
  );
}

function num(f: FresMat, k: string, d: number): number {
  const v = f.params?.[k]?.value;
  return typeof v === 'number' ? v : d;
}

function vec4(f: FresMat, k: string, d: number[]): number[] {
  const v = f.params?.[k]?.value;
  return Array.isArray(v) ? (v as number[]) : d;
}

/** material.json 한 샘플러 규칙 */
export interface SamplerRule {
  uv: number;
  srt: number | null;
  tex: string | null;
}

export interface MaterialData {
  env: { lightmap_color_scale: number };
  textures: Record<string, { file: string; hdr: boolean; srgb: boolean }>;
  rules: Record<string, Record<string, SamplerRule>>;
}

/** 셰이더 그래프 해시 → 식(판독한 것만). 표에 없는 그래프는 일반 PBR 규칙으로 근사한다 */
const RECIPES: Record<string, 'cloud' | 'snow' | 'aurora' | 'cliff'> = {
  /* hsmg402 구름 cloud_mt [판독 FS 전체]: 조명 없음. rgb = _e0(uv3·srt3).rgb·emissionScale,
     a = _a0(uv0·srt0).a · blendColor.a · util0(uv1·srt1).a · util0(uv2·srt2).a */
  '2978185753': 'cloud',
  /* hsmg402 지면 fld_snow(_fluid)_mt, 눈덩이 fld_snow(_fluid)_mt [판독 일부]: PBR(_a0×blendColor, _n0) 에 더해
     평행광 확산 = util2 램프(fld_dif, u = N·L·0.5+0.5), 림 = rimLightColor·광색·pow(1−N·V, rimPower)·rimlightColorScale,
     마지막에 출력 rgb × util0(u = 정점색 a, v = 0) — 메시에 정점색이 없어 a = 1 로 읽는다 [추정: 미바인드 속성 = (0,0,0,1)] */
  '746197195': 'snow',
  '4268919678': 'snow',
  /* hsmg402 오로라 aurora*_mt [판독 일부]: 기본 = sat(_a0.rgb·정점색.rgb·blendColor.rgb·utilityColor0.rgb) 를 util0(grad00, uv1·srt1) 로
     color dodge, a = _a0.a·정점색.a·blendColor.a·util2(mask, uv0·srt2).r. 뒤의 overlay·_e0·IBL 합성과 정점 그래프(노이즈 변위)는 옮기지 않았다 [근사] */
  '474410661': 'aurora',
  /* hsmg402 절벽 fld_cliff_mt [판독 일부]: util0(cliff_lmp)·util2(cliff_gi)·util1(cliff_ao) 가 uv2(srt 없음). lmp 와 gi 를 섞는 계수는 미판독 → lmp 만 라이트맵으로 [근사] */
  '2263802738': 'cliff',
};

/** 재질 하나의 애니·상태 조종(재질 애니 fmab 가 부른다) */
export class MpsMaterialCtl {
  /** texsrt 번호 → 그 행렬을 쓰는 텍스처들 */
  readonly srtTex = new Map<number, THREE.Texture[]>();
  readonly srt: TexSrt[] = [];
  /** 셰이더에 직접 넘기는 texsrt 행렬(그래프 레시피용) */
  readonly srtUniforms: { value: THREE.Matrix3 }[] = [];
  readonly blend = new THREE.Vector4(1, 1, 1, 1);
  readonly blendUniform = { value: this.blend };
  readonly ownTextures: THREE.Texture[] = [];

  constructor(
    readonly material: THREE.Material,
    readonly fres: FresMat,
  ) {
    for (let k = 0; k < 4; k++) {
      this.srt.push(texSrtOf(fres, k));
      this.srtUniforms.push({ value: texSrtMatrix(this.srt[k]) });
    }
  }

  private refreshSrt(k: number): void {
    texSrtMatrix(this.srt[k], this.srtUniforms[k].value);
    for (const t of this.srtTex.get(k) ?? []) t.matrix.copy(this.srtUniforms[k].value);
  }

  /** 재질 애니 한 성분(fmab 오프셋 그대로: texsrtK 0x4 sx 0x8 sy 0xC r 0x10 tx 0x14 ty, blendColor 0x0~0xC) */
  setAnim(param: string, off: string, v: number): void {
    const o = parseInt(off, 16);
    const m = /^texsrt(\d)$/.exec(param);
    if (m) {
      const k = +m[1];
      const s = this.srt[k];
      if (!s) return;
      if (o === 0x4) s.sx = v;
      else if (o === 0x8) s.sy = v;
      else if (o === 0xc) s.r = v;
      else if (o === 0x10) s.tx = v;
      else if (o === 0x14) s.ty = v;
      else return;
      this.refreshSrt(k);
      return;
    }
    if (param === 'blendColor') {
      const i = o / 4;
      if (i === 3) {
        this.blend.w = v;
        this.material.opacity = v;
        if (v < 1) this.material.transparent = true;
      } else if (i >= 0 && i < 3) {
        this.blend.setComponent(i, v);
        const c = (this.material as THREE.MeshStandardMaterial).color;
        if (c) c.setRGB(this.blend.x, this.blend.y, this.blend.z, THREE.LinearSRGBColorSpace);
      }
    }
  }

  dispose(): void {
    this.material.dispose();
    for (const t of this.ownTextures) t.dispose();
  }
}

export function ctlOf(m: THREE.Material): MpsMaterialCtl | null {
  return ((m.userData as { mps?: MpsMaterialCtl }).mps ?? null) as MpsMaterialCtl | null;
}

const UV_ATTR = ['uv', 'uv1', 'uv2', 'uv3'];

/** 그래프 레시피가 직접 읽는 텍스처 하나 */
interface Extra {
  tex: THREE.Texture;
  uv: number;
  /** texsrt 번호(null = 변환 없음) */
  srt: number | null;
}

const NO_DIRECT = (() => {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const head = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  if (!src.includes(head)) throw new Error('three lights_fragment_begin 형식이 바뀌었다(material.ts)');
  return src.replace(head, '#if 0');
})();

const IBL_SCALED = (() => {
  let src = THREE.ShaderChunk.lights_fragment_maps;
  const a = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
  const b = 'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );';
  if (!src.includes(a) || !src.includes(b)) throw new Error('three lights_fragment_maps 형식이 바뀌었다(material.ts)');
  src = src.replace(a, 'iblIrradiance += mpsIrrScale * getIBLIrradiance( geometryNormal );');
  return src.replace(b, 'radiance += mpsRadScale * getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );');
})();

const RAMP_DIRECT = (() => {
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  const a = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
  if (!src.includes(a)) throw new Error('three lights_physical_pars_fragment 형식이 바뀌었다(material.ts)');
  return src.replace(
    a,
    'reflectedLight.directDiffuse += texture2D( mpsRamp, vec2( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5, 0.5 ) ).rgb * directLight.color * BRDF_Lambert( material.diffuseColor );',
  );
})();

/** 재질 자료(material.json)와 glb 밖 텍스처. 화면이 하나 만들어 load 한다 */
export class FresLibrary {
  data: MaterialData | null = null;
  private readonly tex = new Map<string, THREE.Texture>();

  constructor(private readonly url: (path: string) => string) {}

  async load(fetchJson: (path: string) => Promise<unknown>, path = 'material/material.json'): Promise<void> {
    this.data = (await fetchJson(path)) as MaterialData;
    const hdr = new HDRLoader();
    const png = new THREE.TextureLoader();
    await Promise.all(
      Object.entries(this.data.textures).map(async ([name, e]) => {
        try {
          const t = e.hdr ? await hdr.loadAsync(this.url(e.file)) : await png.loadAsync(this.url(e.file));
          t.flipY = false;
          t.colorSpace = e.srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.needsUpdate = true;
          this.tex.set(name, t);
        } catch (err) {
          console.warn('재질 텍스처를 읽지 못했다', name, err);
        }
      }),
    );
  }

  texture(name: string | null | undefined): THREE.Texture | null {
    return name ? (this.tex.get(name) ?? null) : null;
  }

  dispose(): void {
    for (const t of this.tex.values()) t.dispose();
    this.tex.clear();
  }

  /**
   * src(glb 재질) → three 재질. null = 그리지 않음(render_color 0, 유체 붓 셰이더).
   * key = 규칙 표 열쇠의 앞부분(glb 파일 이름에서 확장자 뺀 것, 예 hsmg402_bg, pc01_mario).
   * 결과 재질의 userData.mps 에 MpsMaterialCtl(재질 애니용), userData.fres 에 원본 정보가 있다.
   */
  convert(src: THREE.Material, key: string): THREE.Material | null {
    const f = fresOf(src);
    const ri = f.renderInfo ?? {};
    const opt = f.shader?.options ?? {};
    const archive = f.shader?.archive ?? '';
    if (ri.render_color?.[0] === 0) return null;
    if (archive === 'forward_plus_fluid') return null;
    const rules = this.data?.rules[`${key}:${src.name}`] ?? {};
    const recipe = RECIPES[opt.main_fragment_shader_graph ?? ''];
    const sa = f.shader?.samplerAssign ?? {};
    const texName = (shaderSampler: string): string | null => {
      const ms = sa[shaderSampler] ?? shaderSampler;
      return f.samplers?.find((s) => s.sampler === ms)?.texture ?? null;
    };
    const blend = vec4(f, 'blendColor', [1, 1, 1, 1]);
    const std = src as THREE.MeshStandardMaterial;
    const unlit = archive === 'forward_plus_simple' || opt.global_lighting === '0' || recipe === 'cloud' || recipe === 'aurora';

    let m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    if (unlit) m = new THREE.MeshBasicMaterial({ map: std.map ?? null });
    else m = std.clone();
    m.name = src.name;
    m.color.setRGB(blend[0], blend[1], blend[2], THREE.LinearSRGBColorSpace);
    m.opacity = blend[3];
    const ctl = new MpsMaterialCtl(m, f);
    ctl.blend.set(blend[0], blend[1], blend[2], blend[3]);

    /* 슬롯 텍스처의 UV 번호·texsrt (규칙 표) */
    const bind = (slot: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'emissiveMap' | 'lightMap', sampler: string, tex?: THREE.Texture | null): void => {
      const mm = m as unknown as Record<string, THREE.Texture | null>;
      const t0 = tex !== undefined ? tex : mm[slot];
      if (!t0) return;
      const r = rules[sampler];
      const t = t0.clone();
      ctl.ownTextures.push(t);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.channel = r ? r.uv : 0;
      t.matrixAutoUpdate = false;
      if (r && r.srt !== null) {
        t.matrix.copy(ctl.srtUniforms[r.srt].value);
        const list = ctl.srtTex.get(r.srt) ?? [];
        list.push(t);
        ctl.srtTex.set(r.srt, list);
      } else t.matrix.identity();
      t.needsUpdate = true;
      mm[slot] = t;
    };
    bind('map', '_a0');

    const extras: Extra[] = [];
    const extra = (name: string | null, r: SamplerRule | undefined, fallback: { uv: number; srt: number | null }): number => {
      /* _a0 처럼 glb 에 이미 붙은 텍스처는 그것을 쓴다 */
      const t = this.texture(name) ?? (name && name === texName('_a0') ? (std.map ?? null) : null);
      if (!t) return -1;
      extras.push({ tex: t, uv: r ? r.uv : fallback.uv, srt: r ? r.srt : fallback.srt });
      return extras.length - 1;
    };
    const defines: Record<string, string> = {};
    const uniforms: Record<string, THREE.IUniform> = { mpsBlend: ctl.blendUniform };
    let frag = '';

    if (m instanceof THREE.MeshStandardMaterial) {
      const bump = num(f, 'bumpScale', 1);
      m.normalScale.multiplyScalar(bump);
      bind('normalMap', '_n0');
      bind('roughnessMap', '_r0');
      bind('metalnessMap', '_r0');
      if (opt.use_roughness_value === '1') {
        m.roughnessMap = null;
        m.roughness = num(f, 'roughness', 1);
      }
      if (opt.use_metallic_value === '1') {
        m.metalnessMap = null;
        m.metalness = num(f, 'metallic', 0);
      }
      /* 발광 _e0 × emissionScale (forward_plus_map 판독) */
      if (opt.use_emission === '1' && !recipe) {
        const en = texName('_e0');
        const e = en && en === texName('_a0') ? (std.map ?? null) : this.texture(en);
        if (e) {
          bind('emissiveMap', '_e0', e);
          m.emissive.setRGB(1, 1, 1);
          m.emissiveIntensity = num(f, 'emissionScale', 1);
        }
      }
      /* 라이트맵 */
      const lmScale = this.data?.env.lightmap_color_scale ?? 1;
      if (archive === 'forward_plus_map' && opt.use_lightmap === '1') {
        const lm = this.texture(texName('_l0'));
        if (lm) {
          bind('lightMap', '_l0', lm);
          if (!rules._l0 && m.lightMap) m.lightMap.channel = 1;
          m.lightMapIntensity = Math.PI * num(f, 'lightMapScale', 1) * lmScale;
        }
      }
      if (recipe === 'cliff') {
        const lm = this.texture(texName('utilitySampler0'));
        if (lm) {
          bind('lightMap', 'utilitySampler0', lm);
          m.lightMapIntensity = Math.PI * lmScale;
        }
      }
      if (opt.directional_light_off === '1') defines.MPS_NO_DIRECT = '';
      /* IBL 배율 */
      uniforms.mpsIrrScale = { value: num(f, 'irradianceColorScale', 1) };
      uniforms.mpsRadScale = { value: num(f, 'radianceColorScale', 1) };
      defines.MPS_IBL_SCALE = '';
      /* 림 라이트 */
      if (opt.rim_lighting === '1') {
        const rc = vec4(f, 'rimLightColor', [1, 1, 1, 1]);
        uniforms.mpsRimColor = { value: new THREE.Color().setRGB(rc[0], rc[1], rc[2], THREE.LinearSRGBColorSpace) };
        uniforms.mpsRimPower = { value: num(f, 'rimPower', 1) };
        uniforms.mpsRimScale = { value: num(f, 'rimlightColorScale', 1) };
        defines.MPS_RIM = '';
      }
      if (recipe === 'snow') {
        const ramp = this.texture(texName('utilitySampler2'));
        if (ramp) {
          uniforms.mpsRamp = { value: ramp };
          defines.MPS_RAMP = '';
        }
        const tint = this.texture(texName('utilitySampler0'));
        if (tint) {
          uniforms.mpsTint = { value: tint };
          defines.MPS_TINT = '';
        }
      }
    } else if (recipe === 'cloud') {
      const a = extra(texName('_a0'), rules._a0, { uv: 0, srt: 0 });
      const m1 = extra(texName('utilitySampler0'), rules.utilitySampler0, { uv: 1, srt: 1 });
      const m2 = extra(texName('utilitySampler0'), rules['utilitySampler0#2'], { uv: 2, srt: 2 });
      const e = extra(texName('_e0'), rules._e0, { uv: 3, srt: 3 });
      uniforms.mpsEmission = { value: num(f, 'emissionScale', 1) };
      if (a >= 0 && m1 >= 0 && m2 >= 0 && e >= 0)
        frag = `diffuseColor = vec4( mpsTex${e}().rgb * mpsEmission, mpsTex${a}().a * mpsBlend.a * mpsTex${m1}().a * mpsTex${m2}().a );`;
    } else if (recipe === 'aurora') {
      const a = extra(texName('_a0'), rules._a0, { uv: 0, srt: 0 });
      const g = extra(texName('utilitySampler0'), rules.utilitySampler0, { uv: 1, srt: 1 });
      const k = extra(texName('utilitySampler2'), rules.utilitySampler2, { uv: 0, srt: 2 });
      const uc = vec4(f, 'utilityColor0', [1, 1, 1, 1]);
      uniforms.mpsUtil0 = { value: new THREE.Vector3(uc[0], uc[1], uc[2]) };
      defines.MPS_VCOLOR = '';
      if (a >= 0 && g >= 0 && k >= 0)
        frag = `{
  vec4 a0 = mpsTex${a}();
  vec3 base = clamp( a0.rgb * vMpsColor.rgb * mpsBlend.rgb * clamp( mpsUtil0, 0.0, 1.0 ), 0.0, 1.0 );
  vec3 grad = clamp( mpsTex${g}().rgb, 0.0, 1.0 );
  vec3 dodge = mix( min( grad / max( 1.0 - base, 1e-4 ), vec3( 1.0 ) ), vec3( 1.0 ), step( vec3( 1.0 ), base ) );
  diffuseColor = vec4( dodge, a0.a * vMpsColor.a * mpsBlend.a * mpsTex${k}().r );
}`;
    }

    /* 섞기·컬링 */
    const st = ri.state_type?.[0] ?? 0;
    if (st === 1) {
      m.alphaTest = num(f, 'punchThroughThresholdColor', 0.5);
    } else if (st === 2 || st === 3) {
      m.transparent = true;
      m.depthWrite = false;
      if (st === 3) m.blending = THREE.AdditiveBlending;
    }
    const cull = ri.face_cull_type?.[0] ?? 0;
    m.side = cull === 2 ? THREE.DoubleSide : cull === 1 ? THREE.BackSide : THREE.FrontSide;
    m.fog = opt.use_fog === '1';
    if (m instanceof THREE.MeshBasicMaterial) m.color.setRGB(blend[0], blend[1], blend[2], THREE.LinearSRGBColorSpace);

    patch(m, ctl, extras, frag, defines, uniforms);
    m.userData.fres = f;
    m.userData.mps = ctl;
    return m;
  }
}

function patch(
  m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial,
  ctl: MpsMaterialCtl,
  extras: Extra[],
  frag: string,
  defines: Record<string, string>,
  uniforms: Record<string, THREE.IUniform>,
): void {
  const keyParts = [Object.keys(defines).sort().join(','), extras.map((e) => `${e.uv}:${e.srt}`).join(','), frag];
  if (!keyParts[0] && !extras.length && !frag) return;
  extras.forEach((e, i) => {
    uniforms[`mpsT${i}`] = { value: e.tex };
    uniforms[`mpsM${i}`] = e.srt === null ? { value: new THREE.Matrix3() } : ctl.srtUniforms[e.srt];
  });
  m.customProgramCacheKey = () => `mps|${keyParts.join('|')}`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.defines = { ...(sh.defines ?? {}), ...defines };
    let vdecl = '';
    let vbody = '';
    let fdecl = 'uniform vec4 mpsBlend;\n';
    for (let i = 1; i < 4; i++) if (extras.some((e) => e.uv === i)) vdecl += `#ifndef USE_UV${i}\nattribute vec2 ${UV_ATTR[i]};\n#endif\n`;
    extras.forEach((e, i) => {
      vdecl += `uniform mat3 mpsM${i};\nvarying vec2 vMpsUv${i};\n`;
      vbody += `vMpsUv${i} = ( mpsM${i} * vec3( ${UV_ATTR[e.uv]}, 1.0 ) ).xy;\n`;
      fdecl += `uniform sampler2D mpsT${i};\nvarying vec2 vMpsUv${i};\nvec4 mpsTex${i}() { return texture2D( mpsT${i}, vMpsUv${i} ); }\n`;
    });
    if ('MPS_VCOLOR' in defines) {
      vdecl += 'attribute vec4 _c0;\nvarying vec4 vMpsColor;\n';
      vbody += 'vMpsColor = _c0;\n';
      fdecl += 'varying vec4 vMpsColor;\n';
    }
    if ('MPS_IBL_SCALE' in defines) fdecl += 'uniform float mpsIrrScale;\nuniform float mpsRadScale;\n';
    if ('MPS_RIM' in defines) fdecl += 'uniform vec3 mpsRimColor;\nuniform float mpsRimPower;\nuniform float mpsRimScale;\n';
    if ('MPS_RAMP' in defines) fdecl += 'uniform sampler2D mpsRamp;\n';
    if ('MPS_TINT' in defines) fdecl += 'uniform sampler2D mpsTint;\n';
    if ('mpsEmission' in uniforms) fdecl += 'uniform float mpsEmission;\n';
    if ('mpsUtil0' in uniforms) fdecl += 'uniform vec3 mpsUtil0;\n';
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${vdecl}`).replace('#include <uv_vertex>', `#include <uv_vertex>\n${vbody}`);
    let fs = sh.fragmentShader.replace('#include <common>', `#include <common>\n${fdecl}`);
    if (frag) fs = fs.replace('#include <map_fragment>', frag);
    if ('MPS_NO_DIRECT' in defines) fs = fs.replace('#include <lights_fragment_begin>', NO_DIRECT);
    if ('MPS_IBL_SCALE' in defines) fs = fs.replace('#include <lights_fragment_maps>', IBL_SCALED);
    if ('MPS_RAMP' in defines) fs = fs.replace('#include <lights_physical_pars_fragment>', RAMP_DIRECT);
    let tail = '';
    if ('MPS_RIM' in defines)
      tail += `{
  float mpsNv = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );
  vec3 mpsLc = vec3( 1.0 );
  #if NUM_DIR_LIGHTS > 0
    mpsLc = directionalLights[ 0 ].color * RECIPROCAL_PI; /* 조명 담당이 평행광 세기에 π 를 곱해 둔 것(07_camera_lighting.md)을 되돌려 원본 광색으로 */
  #endif
  outgoingLight += mpsRimColor * mpsLc * pow( max( mpsNv, 1e-4 ), mpsRimPower ) * mpsRimScale;
}\n`;
    if ('MPS_TINT' in defines) tail += 'outgoingLight *= texture2D( mpsTint, vec2( 1.0, 0.0 ) ).rgb;\n';
    if (tail) fs = fs.replace('#include <opaque_fragment>', `${tail}#include <opaque_fragment>`);
    sh.fragmentShader = fs;
  };
  m.needsUpdate = true;
}

/** 지금 화면이 쓰는 재질 자료(무대가 load 에서 정한다). 없으면 convertFres 가 null 규칙으로 근사한다 */
let active: FresLibrary | null = null;
const fallback = new FresLibrary((p) => p);

export function setActiveFresLibrary(lib: FresLibrary | null): void {
  active = lib;
}

export function convertFres(src: THREE.Material, key: string): THREE.Material | null {
  return (active ?? fallback).convert(src, key);
}

/** glb 경로·이름 → 규칙 표 열쇠(확장자 뺀 파일 이름) */
export function fresKey(file: string): string {
  return file.split('/').pop()!.replace(/\.glb$/, '');
}
