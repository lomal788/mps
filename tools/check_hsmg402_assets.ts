/**
 * hsmg402 웹 에셋 노드 검사 — assets/hsmg402·assets/chara 의 glb 를 three GLTFLoader 로 파싱(텍스처는 빈 텍스처)하고,
 * manifest·ui.json·chara index 가 가리키는 파일이 모두 있는지 본다.
 *   cd F:/dev/mps/web && npx tsx tools/check_hsmg402_assets.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const A = path.join(ROOT, 'assets');
const errors: string[] = [];
let checkedFiles = 0;

const stub = () => ({ name: 'stub_textures', loadTexture: () => Promise.resolve(new THREE.Texture()) });

function parse(buf: Buffer): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  const loader = new GLTFLoader();
  loader.register(stub as never);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((ok, bad) => loader.parse(ab as ArrayBuffer, '', ok as never, bad));
}

function exists(rel: string, base = A): void {
  checkedFiles++;
  if (!fs.existsSync(path.join(base, rel))) errors.push(`없음: ${rel}`);
}

function glbImages(file: string): string[] {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + n).toString('utf8')) as { images?: { uri?: string }[] };
  return (j.images ?? []).map((i) => i.uri ?? '');
}

async function checkGlb(file: string, expectClips: string[]): Promise<string> {
  try {
    const g = await parse(fs.readFileSync(file));
    let meshes = 0;
    g.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    for (const uri of glbImages(file)) {
      checkedFiles++;
      if (!fs.existsSync(path.resolve(path.dirname(file), uri))) errors.push(`${path.relative(A, file)}: 이미지 없음 ${uri}`);
    }
    for (const c of expectClips) if (!g.animations.some((a) => a.name === c)) errors.push(`${path.relative(A, file)}: 클립 없음 ${c}`);
    return `${path.relative(A, file)} meshes ${meshes} clips ${g.animations.length}`;
  } catch (e) {
    errors.push(`${path.relative(A, file)}: 파싱 실패 ${(e as Error).message}`);
    return `${path.relative(A, file)} 실패`;
  }
}

const G = path.join(A, 'hsmg402');
const man = JSON.parse(fs.readFileSync(path.join(G, 'manifest.json'), 'utf8'));
const lines: string[] = [];
for (const [name, m] of Object.entries<{ file: string; clips: Record<string, unknown> }>(man.models)) {
  lines.push(await checkGlb(path.join(G, m.file), Object.keys(m.clips)));
  void name;
}
for (const f of Object.values<string>(man.anims)) {
  exists(f, G);
  JSON.parse(fs.readFileSync(path.join(G, f), 'utf8'));
}
for (const faces of Object.values<string[]>(man.env.cubes)) for (const f of faces) exists(f, G);
for (const f of Object.values<string>(man.effects.textures)) exists(f, G);
let seqWaves = 0;
for (const [label, s] of Object.entries<{ kind: string; file?: string; seq?: { waves: { file: string }[]; data: string } }>(man.sounds)) {
  if (s.kind === 'stream') exists(s.file!, G);
  else {
    for (const w of s.seq!.waves) {
      exists(w.file, G);
      seqWaves++;
    }
    if (!s.seq!.data) errors.push(`${label}: 시퀀스 데이터 없음`);
  }
}
for (const v of man.voiceLabels as string[]) if (!man.sounds[v]) errors.push(`보이스·발소리 라벨 소리 없음 ${v}`);
const ui = JSON.parse(fs.readFileSync(path.join(G, man.ui), 'utf8'));
for (const f of Object.values<string>(ui.textures)) exists(f, G);
for (const f of Object.values<{ file: string }>(ui.fonts)) exists(f.file, G);
for (const n of ['sys_guide_02', 'sys_timer_00', 'sys_tlp_start', 'sys_tlp_finish', 'sys_tlp_win_00', 'sys_tlp_win_01', 'sys_tlp_draw_00'])
  if (!ui.layouts[n]) errors.push(`레이아웃 없음 ${n}`);
const C = path.join(A, 'chara');
const index = JSON.parse(fs.readFileSync(path.join(C, 'index.json'), 'utf8'));
for (const [k, e] of Object.entries<{ glb: string; motions: string; eyeTex: string | null }>(index)) {
  const mj = JSON.parse(fs.readFileSync(path.join(C, e.motions), 'utf8'));
  const clips = Object.values<{ clip: string }>(mj.motions).map((m) => m.clip);
  lines.push(await checkGlb(path.join(C, e.glb), clips));
  if (e.eyeTex) exists(e.eyeTex, C);
  for (const m of Object.values<{ events?: { out: { kind: string; label?: string }[] }[] }>(mj.motions))
    for (const ev of m.events ?? []) for (const o of ev.out) if (o.kind === 'se' && !man.sounds[o.label!] && !man.substitute[o.label!]) errors.push(`${k}: 모션 SE 소리 없음 ${o.label}`);
}
const size = (d: string): number =>
  fs.readdirSync(d, { withFileTypes: true }).reduce((a, x) => a + (x.isDirectory() ? size(path.join(d, x.name)) : fs.statSync(path.join(d, x.name)).size), 0);
console.log(lines.join('\n'));
console.log(`소리 ${Object.keys(man.sounds).length}개(시퀀스 파형 ${seqWaves}), 파일 확인 ${checkedFiles}`);
console.log(`용량 hsmg402 ${(size(G) / 1e6).toFixed(2)} MB, chara ${(size(C) / 1e6).toFixed(2)} MB`);
console.log(errors.length ? `오류 ${errors.length}\n${errors.join('\n')}` : '오류 0');
process.exitCode = errors.length ? 1 : 0;
