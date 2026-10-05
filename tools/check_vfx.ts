/**
 * VFXB v40 런타임(script/view/vfx.ts) 노드 검사 — 화면 없이 hsmg402 이미터셋을 프레임 단위로 돌려 방출 수·수명·값 이상(NaN)을 본다.
 *   npx tsx tools/check_vfx.ts
 * 기대값은 web/docs/engine/08_effects.md 6.1 표(방출 창·간격 판독식으로 손 계산한 값)다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { type VfxSetsFile, VfxSystem } from '../script/view/vfx';

const root = fileURLToPath(new URL('../assets/hsmg402/effect/sets.json', import.meta.url));
const file = JSON.parse(readFileSync(root, 'utf8')) as VfxSetsFile;

let fail = 0;
const scene = new THREE.Scene();
const sys = new VfxSystem(scene);
sys.file = file;

interface Probe {
  set: string;
  frames: number;
  /** 이미터별 누적 방출 수 기대 */
  emitted: Record<string, number>;
}

/** [방출 판독식] one-time: start 부터 start+duration 전까지 간격 interval+1, 첫 허용 프레임에 바로 */
const PROBES: Probe[] = [
  { set: 'hsmg402_snowball_appear00', frames: 40, emitted: { ring00a: 2, circle00a: 1 } },
  { set: 'hsmg402_snowball_max00', frames: 30, emitted: { ring00a: 2, circle00a: 1, twinkle00_start: 20 } },
  { set: 'hsmg402_snowball_break00', frames: 10, emitted: { snow_solid00: 3 } },
  { set: 'hsmg402_snowball_break01', frames: 10, emitted: { snow_solid00: 35 } },
  { set: 'hsmg402_snowball_break02', frames: 10, emitted: { snow_solid00: 75 } },
  { set: 'hsmg402_snowball_fall00', frames: 30, emitted: { kotai: 50 } },
  { set: 'fx_pc_snow_make00', frames: 15, emitted: { L: 30, R: 30, L_tubu: 10, R_tubu: 10, L_smoke: 1, R_smoke: 1 } },
  { set: 'fx_pc_snow_breath00', frames: 5, emitted: { breath00: 1 } },
];

function count(set: string, frames: number): Map<string, number> {
  const inst = sys.create(set);
  if (!inst) throw new Error(`이미터셋 없음 ${set}`);
  inst.anchor.identity();
  const seen = new Map<string, Set<object>>();
  for (let f = 0; f < frames; f++) {
    sys.update(1);
    for (const e of inst.emitters) {
      const s = seen.get(e.s.name) ?? new Set();
      for (const p of e.particles) {
        s.add(p);
        if (!Number.isFinite(p.p.x + p.p.y + p.p.z + p.v.x + p.v.y + p.v.z)) {
          console.log(`  NaN ${set}/${e.s.name}`);
          fail++;
        }
      }
      seen.set(e.s.name, s);
    }
  }
  inst.kill();
  sys.update(0);
  return new Map([...seen].map(([k, v]) => [k, v.size]));
}

for (const pr of PROBES) {
  const got = count(pr.set, pr.frames);
  for (const [name, want] of Object.entries(pr.emitted)) {
    const g = got.get(name) ?? 0;
    const ok = g === want;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${pr.set}/${name}: 방출 ${g} (기대 ${want})`);
  }
}

/* 무대 상시(INITIALIZE) 600프레임 뒤 입자 수 — 연속 이미터 정상 상태 대략치(기대 범위는 간격·수명 산술) */
{
  const sets = file.triggers.INITIALIZE.sets.map((s) => sys.create(s)!);
  for (let f = 0; f < 600; f++) sys.update(1);
  for (const s of sets) {
    const n = s.emitters.reduce((a, e) => a + e.particles.length + e.children.reduce((b, c) => b + c.particles.length, 0), 0);
    console.log(`     ${s.name}: 600f 뒤 입자 ${n}`);
  }
  const snow = sets.find((s) => s.name === 'hsmg402_map_snow00')!;
  const far = snow.emitters.find((e) => e.s.name === 'snow00_far')!;
  /* snow00_far: 9프레임마다 1개, 수명 1000~2000 → 600f 동안 사라지는 것 없음 → 600/9 올림 = 67 */
  const ok = far.particles.length === 67;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} snow00_far 600f 입자 ${far.particles.length} (기대 67)`);
  for (const s of sets) s.kill();
  sys.update(0);
}

/* Stop: 페이드 아웃 플래그(kotai alphaFadeTime 30)면 30프레임 안에 사라진다 */
{
  const s = sys.create('hsmg402_snowball_fall00')!;
  for (let f = 0; f < 10; f++) sys.update(1);
  s.stop();
  let n = 0;
  while (!s.done && n < 100) {
    sys.update(1);
    n++;
  }
  const ok = s.done && n <= 31;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} fall00 Stop 뒤 ${n}프레임에 끝남 (기대 ≤ 31, alphaFadeTime 30)`);
}

sys.dispose();
console.log(fail ? `실패 ${fail}` : '오류 0');
process.exit(fail ? 1 : 0);
