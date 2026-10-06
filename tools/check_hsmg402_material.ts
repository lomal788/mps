/**
 * hsmg402 재질 변환 노드 검사 — glb(텍스처는 빈 텍스처) 재질을 material.ts FresLibrary 로 바꿔 보고,
 * onBeforeCompile 이 three 셰이더 원문에 끼워 넣을 자리를 모두 찾았는지(치환 실패 0)와 material.json 텍스처 파일이 있는지 본다.
 * WebGL 컴파일은 하지 않는다(화면 확인은 헤드리스 1회에서).
 *   cd F:/dev/mps/web && npx tsx tools/check_hsmg402_material.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FresLibrary, fresKey, type MaterialData, mpsSceneEnv } from '../script/games/hsmg402/view/material';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const A = path.join(ROOT, 'assets');
const errors: string[] = [];

const stub = () => ({ name: 'stub_textures', loadTexture: () => Promise.resolve(new THREE.Texture()) });
function parse(file: string): Promise<{ scene: THREE.Object3D }> {
  const buf = fs.readFileSync(file);
  const loader = new GLTFLoader();
  loader.register(stub as never);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((ok, bad) => loader.parse(ab as ArrayBuffer, '', ok as never, bad));
}

const data = JSON.parse(fs.readFileSync(path.join(A, 'hsmg402', 'material', 'material.json'), 'utf8')) as MaterialData;
for (const [n, e] of Object.entries(data.textures)) if (!fs.existsSync(path.join(A, 'hsmg402', e.file))) errors.push(`텍스처 없음 ${n} ${e.file}`);

/* 조명 쪽이 채우는 장면 irr 큐브 자리(지면·오로라 레시피가 이것이 있을 때 MPS_IRR·MPS_AURORA_LIT 를 켠다) */
mpsSceneEnv.irradiance.value = new THREE.CubeTexture();
const lib = new FresLibrary((p) => p);
lib.data = data;
/* 텍스처 대신 빈 텍스처 */
(lib as unknown as { tex: Map<string, THREE.Texture> }).tex = new Map(Object.keys(data.textures).map((k) => [k, new THREE.Texture()]));

const files = [
  ...fs.readdirSync(path.join(A, 'hsmg402', 'model')).map((f) => path.join(A, 'hsmg402', 'model', f)),
  ...fs.readdirSync(path.join(A, 'chara')).filter((d) => fs.statSync(path.join(A, 'chara', d)).isDirectory()).flatMap((d) =>
    fs.readdirSync(path.join(A, 'chara', d, 'model')).map((f) => path.join(A, 'chara', d, 'model', f)),
  ),
].filter((f) => f.endsWith('.glb'));

const lines: string[] = [];
let n = 0;
for (const file of files) {
  const g = await parse(file);
  const key = fresKey(file.replace(/\\/g, '/'));
  const seen = new Set<THREE.Material>();
  g.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || seen.has(mesh.material as THREE.Material)) return;
    const src = mesh.material as THREE.Material;
    seen.add(src);
    let m: THREE.Material | null;
    try {
      m = lib.convert(src, key);
    } catch (e) {
      errors.push(`${key}:${src.name} 변환 오류 ${(e as Error).message}`);
      return;
    }
    n++;
    if (!m) {
      lines.push(`${key}:${src.name} 숨김`);
      return;
    }
    const isStd = (m as THREE.MeshStandardMaterial).isMeshStandardMaterial;
    const lib3 = isStd ? THREE.ShaderLib.physical : THREE.ShaderLib.basic;
    const sh = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: lib3.vertexShader, fragmentShader: lib3.fragmentShader, defines: {} as Record<string, string> };
    m.onBeforeCompile(sh as never, null as never);
    const d = Object.keys(sh.defines);
    const vs = sh.vertexShader;
    const fsrc = sh.fragmentShader;
    const want: [boolean, string][] = [
      [d.includes('MPS_NO_DIRECT'), fsrc.includes('#if 0') && !fsrc.includes('#include <lights_fragment_begin>')],
      [d.includes('MPS_IBL_SCALE'), d.includes('MPS_IRR') ? fsrc.includes('textureCube( mpsIrr') && !fsrc.includes('#include <lights_fragment_maps>') : fsrc.includes('mpsIrrScale * getIBLIrradiance')],
      [d.includes('MPS_AURORA_LIT'), fsrc.includes('textureCube( mpsIrr') && vs.includes('vMpsN =')],
      [d.includes('MPS_RAMP'), fsrc.includes('texture2D( mpsRamp')],
      [d.includes('MPS_RIM'), fsrc.includes('mpsRimColor * mpsLc')],
      [d.includes('MPS_TINT'), fsrc.includes('texture2D( mpsTint')],
    ].map(([on, ok]) => [!on || ok, ''] as [boolean, string]);
    if (want.some(([ok]) => !ok)) errors.push(`${key}:${src.name} 셰이더 치환 실패 ${d.join(',')}`);
    /* 끼워 넣은 이름(mps*·vMps*)마다 선언이 있는지 — 선언 누락은 WebGL 컴파일에서만 드러나므로 여기서 본다 */
    for (const [stage, src3] of [['vs', vs], ['fs', fsrc]] as const) {
      const used = new Set(src3.match(/\bv?[mM]ps[A-Z]\w*/g) ?? []);
      for (const name of used) {
        const decl = new RegExp(String.raw`\b(uniform|varying|attribute|const|float|vec2|vec3|vec4|mat3|sampler2D|samplerCube)\s+(highp\s+|mediump\s+)?` + name + String.raw`\b`);
        if (!decl.test(src3)) errors.push(`${key}:${src.name} ${stage} 선언 없음 ${name}`);
      }
    }
    const extras = Object.keys(sh.uniforms).filter((k) => /^mpsT\d$/.test(k)).length;
    if (extras && (!vs.includes('vMpsUv0 =') || !fsrc.includes('mpsTex0()'))) errors.push(`${key}:${src.name} 그래프 텍스처 치환 실패`);
    const tx = (['map', 'normalMap', 'lightMap', 'emissiveMap'] as const)
      .map((k) => (m as unknown as Record<string, THREE.Texture | null>)[k])
      .map((t, i) => (t ? `${['map', 'nrm', 'lm', 'emi'][i]}@uv${t.channel}` : ''))
      .filter(Boolean);
    lines.push(
      `${key}:${src.name} ${isStd ? 'std' : 'basic'} ${m.transparent ? (m.blending === THREE.AdditiveBlending ? 'add' : 'blend') : m.alphaTest ? 'cutout' : 'opaque'} side${m.side} fog${+(m as THREE.MeshBasicMaterial).fog} [${d.join(',')}] extras${extras} ${tx.join(' ')}`,
    );
  });
}
console.log(lines.join('\n'));
console.log(`재질 ${n}개`);
console.log(errors.length ? `오류 ${errors.length}\n${errors.join('\n')}` : '오류 0');
process.exitCode = errors.length ? 1 : 0;
