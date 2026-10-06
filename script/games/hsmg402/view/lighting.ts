/**
 * hsmg402 조명·환경 — 평행광(dir_light00)·그림자·IBL(env_mt)·안개를 원본 판독대로 건다. 근거는 web/docs/engine/07_camera_lighting.md(mps 판).
 *
 * 원본대로 [판독]:
 *   - 평행광 방향: lightPositionEnable 1 이면 lightRotation (x°, y°) 로 행 R = [(cy,0,−sy), (sx·sy, cx, sx·cy), (cx·sy, −sx, cx·cy)] 을 만들고
 *     빛 객체의 Z 축(행 2)을 −R 행 2 로 둔다 → L(면→광원) = (−cx·sy, sx, −cx·cy). (30, −25) → (0.366, 0.5, −0.785)
 *     [main @0x710032e690~0x710032e898, @0x7100331464, SetDirection @0x71003aab24]. 위치는 lightPosition (4.1, 5, −11.5).
 *     IBL rad 큐브의 가장 밝은 점(해)이 이 방향과 7.9° 안이다 [데이터 대조].
 *   - 그림자: 정사영 l −17 r 15 t 12 b −8 n 1 f 30, 빛 행렬(위치 lightPosition, Z = L, X = 세계 X 를 L 에 수직으로 뺀 것, Y = L×X)
 *     — |L.y| ≥ 0.01 일 때 기준축 (1,0,0) [@0x71003aab98]. three 는 shadow.camera.up = Y 로 같은 축을 만든다.
 *   - IBL 큐브 조회 방향 = (x, y, −z) [forward_plus_char·simple 셰이더 SASS: 조회 전 z 부호 반전]. three CubeTexture 조회 (−x, y, z) 와는
 *     Y 축 180° 차이라 면을 [−X, +X, 회전180(+Y), 회전180(−Y), −Z, +Z] 로 바꿔 굽는다. 배율 common/char_*_scale 1, ibl_rotate_y 0.
 *   - 안개(fog_cubemap_enable 1 = 모드 2) [forward_plus_simple SASS + main @0x710041fcd4~0x710041fd4c]:
 *       d = |월드 위치 − 카메라 위치|, T = sat( sat( (end − d)/(end − start)·fog_param.z ) + (1 − fog_color.a) ),
 *       색 = mix( irr 큐브(dir=(x,y,−z), lod 7−7T), 표면, T ). (60, 1000, 0.95) → 안개 양 1−T 는 d=10.53 에서 0, d=1000 에서 1 인 직선.
 * 근사 [근사]:
 *   - 직접광 세기: 원본 확산 = albedo·color·N·L(1/π 없음, color = Env+0x10 = 재질 color 그대로) — 오로라 p128·눈 p384 FS 에서 확인 [판독].
 *     three(albedo/π)를 상쇄하려 intensity = π·max(color), color = color/max 로 둔다(셰이더가 직접 식을 짜는 곳은 ÷π 해서 원본 색을 쓴다).
 *   - IBL: rad 큐브(HDR, BC6H 디코드 .hdr) 를 PMREM 으로 scene.environment(반사, 그리고 눈·오로라 밖 재질의 확산). 원본은 확산에 irr 큐브를 따로 쓴다.
 *     irr 큐브는 material.ts mpsSceneEnv 로 넘겨 눈 그래프·오로라 그래프가 원본처럼 직접 읽는다(평행광 원본 색·L 도 같이).
 *     캐릭터는 chara_rad 를 charaEnv 로(재질 쪽에서 envMap 으로 건다).
 *   - 안개: three 청크(fog_vertex/fog_fragment)를 반지름 거리·직선 식으로 바꿔 끼우고(dispose 때 되돌림), 색은 irr 큐브 전체 평균 한 색으로 둔다
 *     (원본은 방향별 큐브 색). 안개 양 상한(fog_color.a < 1 일 때)은 반영하지 않는다(데이터 a = 1).
 *   - 그림자 bias 0.5·normalBias 1 의 단위는 미판독이라 three 값은 눈으로 맞춘 근사, shadowmapSize 0 → 2048.
 */
import * as THREE from 'three';
import type { Assets } from '../../../view/assets';
import { loadMpsHdrCube, mpsSceneEnv } from './material';

export interface LightEnv {
  color: number[];
  lightRotation: number[];
  lightPosition: number[];
  lightPositionEnable?: number;
  shadowBias?: number;
  shadowNormalBias?: number;
  shadowOrthographyLeft?: number;
  shadowOrthographyRight?: number;
  shadowOrthographyTop?: number;
  shadowOrthographyBottom?: number;
  shadowOrthographyNear?: number;
  shadowOrthographyFar?: number;
}

export interface FogEnv {
  fog_enable: number;
  fog_cubemap_enable?: number;
  fog_param: number[];
  fog_color: number[];
}

export interface IblEnv {
  common_radiance_scale?: number;
  common_irradiance_scale?: number;
  char_radiance_scale?: number;
  char_irradiance_scale?: number;
  ibl_rotate_y?: number;
}

export interface LightingEnv {
  light: LightEnv;
  fog: FogEnv;
  ibl?: IblEnv;
  cubes: Record<string, string[]>;
  cubesHdr?: Record<string, string[]>;
}

/** lightRotation(도) → L(면→광원, 단위) [판독] */
export function lightToward(rotDeg: readonly number[]): THREE.Vector3 {
  const ax = (rotDeg[0] * Math.PI) / 180;
  const ay = (rotDeg[1] * Math.PI) / 180;
  return new THREE.Vector3(-Math.cos(ax) * Math.sin(ay), Math.sin(ax), -Math.cos(ax) * Math.cos(ay)).normalize();
}

/** 빛 행렬의 Y 축(그림자 카메라 위쪽) — SetDirection 의 기준축 선택 그대로 [판독 @0x71003aab98] */
export function lightUp(L: THREE.Vector3): THREE.Vector3 {
  if (Math.abs(L.y) >= 0.01) return new THREE.Vector3(0, L.z, -L.y).normalize();
  /* |L.y| < 0.01: 기준축 (0,1,0) 가지 — 이 판에서는 쓰이지 않아 three 기본 위쪽으로 둔다 [미확정] */
  return new THREE.Vector3(0, 1, 0);
}

/** 원본 안개 T 식을 three 직선 안개 near/far 로 [판독 식의 대수 변형] */
export function fogRange(fog: FogEnv): { near: number; far: number } {
  const [start, end, scale] = fog.fog_param;
  const s = scale > 0 ? scale : 1;
  return { near: end - (end - start) / s, far: end };
}

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG

	vFogDepth = length( mvPosition.xyz );

#endif
`;
const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG

	#ifdef FOG_EXP2

		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );

	#else

		float fogFactor = clamp( ( vFogDepth - fogNear ) / ( fogFar - fogNear ), 0.0, 1.0 );

	#endif

	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

#endif
`;

/** 큐브 전체 화소 평균(선형) */
function cubeMean(cube: THREE.CubeTexture): THREE.Color {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const t of cube.images as THREE.DataTexture[]) {
    const d = (t.image as { data: Uint16Array }).data;
    for (let i = 0; i < d.length; i += 4) {
      r += THREE.DataUtils.fromHalfFloat(d[i]);
      g += THREE.DataUtils.fromHalfFloat(d[i + 1]);
      b += THREE.DataUtils.fromHalfFloat(d[i + 2]);
      n++;
    }
  }
  return new THREE.Color().setRGB(r / n, g / n, b / n, THREE.LinearSRGBColorSpace);
}

export class StageLighting {
  readonly light: THREE.DirectionalLight;
  /** L(면→광원) */
  readonly toward = new THREE.Vector3(0, 1, 0);
  charaEnv: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private readonly rts: THREE.WebGLRenderTarget[] = [];
  private readonly cubes: THREE.CubeTexture[] = [];
  private savedChunks: { v: string; f: string } | null = null;

  constructor(private readonly scene: THREE.Scene) {
    this.light = new THREE.DirectionalLight(0xffffff, 1);
    this.light.castShadow = true;
    this.scene.add(this.light, this.light.target);
  }

  async load(assets: Assets, env: LightingEnv, gl: THREE.WebGLRenderer): Promise<void> {
    this.setupLight(env.light);
    this.installFogChunks();
    const ibl = env.ibl ?? {};
    const hdr = env.cubesHdr ?? {};
    let irr: THREE.CubeTexture | null = null;
    try {
      this.pmrem = new THREE.PMREMGenerator(gl);
      if (hdr.hsmg402_rad) {
        const rad = await loadMpsHdrCube(hdr.hsmg402_rad.map((f) => assets.url(f)));
        this.cubes.push(rad);
        const rt = this.pmrem.fromCubemap(rad);
        this.rts.push(rt);
        this.scene.environment = rt.texture;
        this.scene.environmentIntensity = ibl.common_irradiance_scale ?? 1;
        this.scene.environmentRotation.set(0, ((ibl.ibl_rotate_y ?? 0) * Math.PI) / 180, 0);
      }
      if (hdr.hsmg402_chara_rad) {
        const crad = await loadMpsHdrCube(hdr.hsmg402_chara_rad.map((f) => assets.url(f)));
        this.cubes.push(crad);
        const rt = this.pmrem.fromCubemap(crad);
        this.rts.push(rt);
        this.charaEnv = rt.texture;
      }
      if (hdr.hsmg402_irr) {
        irr = await loadMpsHdrCube(hdr.hsmg402_irr.map((f) => assets.url(f)));
        this.cubes.push(irr);
        mpsSceneEnv.irradiance.value = irr;
        mpsSceneEnv.irrScale.value = ibl.common_irradiance_scale ?? 1;
      }
    } catch (e) {
      console.warn('IBL 큐브(hdr)를 읽지 못했다', e);
    }
    this.setupFog(env.fog, irr);
  }

  private setupLight(p: LightEnv): void {
    const c = p.color;
    const k = Math.max(c[0], c[1], c[2], 1e-6);
    this.light.color.setRGB(c[0] / k, c[1] / k, c[2] / k, THREE.LinearSRGBColorSpace);
    this.light.intensity = Math.PI * k;
    const lp = p.lightPosition;
    this.toward.copy(lightToward(p.lightRotation));
    mpsSceneEnv.lightColor.value.set(c[0], c[1], c[2]);
    mpsSceneEnv.lightDir.value.copy(this.toward);
    this.light.position.set(lp[0], lp[1], lp[2]);
    this.light.target.position.set(lp[0], lp[1], lp[2]).sub(this.toward);
    const sc = this.light.shadow.camera;
    sc.left = p.shadowOrthographyLeft ?? -17;
    sc.right = p.shadowOrthographyRight ?? 15;
    sc.top = p.shadowOrthographyTop ?? 12;
    sc.bottom = p.shadowOrthographyBottom ?? -8;
    sc.near = p.shadowOrthographyNear ?? 1;
    sc.far = p.shadowOrthographyFar ?? 30;
    sc.up.copy(lightUp(this.toward));
    sc.updateProjectionMatrix();
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0005;
    this.light.shadow.normalBias = 0.02;
  }

  private installFogChunks(): void {
    if (this.savedChunks) return;
    const sc = THREE.ShaderChunk as Record<string, string>;
    this.savedChunks = { v: sc.fog_vertex, f: sc.fog_fragment };
    sc.fog_vertex = FOG_VERTEX;
    sc.fog_fragment = FOG_FRAGMENT;
  }

  private setupFog(fog: FogEnv, irr: THREE.CubeTexture | null): void {
    if (!fog.fog_enable) return;
    const { near, far } = fogRange(fog);
    const fc = fog.fog_color;
    const color = fog.fog_cubemap_enable && irr ? cubeMean(irr) : new THREE.Color().setRGB(fc[0], fc[1], fc[2], THREE.LinearSRGBColorSpace);
    this.scene.fog = new THREE.Fog(color, near, far);
  }

  dispose(): void {
    if (this.savedChunks) {
      const sc = THREE.ShaderChunk as Record<string, string>;
      sc.fog_vertex = this.savedChunks.v;
      sc.fog_fragment = this.savedChunks.f;
      this.savedChunks = null;
    }
    for (const rt of this.rts) rt.dispose();
    for (const c of this.cubes) c.dispose();
    mpsSceneEnv.irradiance.value = null;
    this.pmrem?.dispose();
    this.light.shadow.dispose();
    this.light.dispose();
  }
}
