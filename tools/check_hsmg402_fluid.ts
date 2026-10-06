/**
 * hsmg402 눈 자국(유체 높이장) 노드 검사 — 원본 판독값과 웹 식(view/fluid.ts·material.ts MPS_FLUID)을 수치로 대조한다.
 *   cd F:/dev/mps/web && npx tsx tools/check_hsmg402_fluid.ts
 * 대조 방법
 *   1. 원본 셰이더 기계어 디스어셈블(analysis/mat/sass)을 작은 에뮬레이터로 그대로 돌린다:
 *      눈덩이 붓 FS(hsmg402 forward_plus_fluid p6), 캐릭터 붓 FS(pc01 p0 왼발·p6 오른발·p12 몸), 지면 VS(hsmg402 forward_plus_custom p384),
 *      엔진 fluid_normal FS(system_boot bnsh, nvdisasm 반정밀도 HFMA2). 같은 입력으로 fluid.ts 의 JS 식과 비교
 *   2. main 판독값: Env+0x3f0~0x40c 계산(0x7100421374 — 원점 = 위치 − 폭·0.5, 배율 1/폭, 텍셀 = 폭/512), 블렌드 표(0xd/0xe/0xf, 붓 패스)를
 *      디컴파일·기계어에서 다시 읽어 Min/Max/Add 확인
 *   3. fluid.json 파라미터 = fmdb 덤프, 붓 텍스처가 음수(파기)인지, 셰이더 문자열의 uniform·in·out 선언, 지면 재질 훅 치환·선언
 * WebGL 컴파일·화면 확인은 하지 않는다(헤드리스 1회에서).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CHARA_FS,
  INIT_FS,
  NORMAL_FS,
  SNOWBALL_FS,
  UPDATE_FS,
  W_FULL,
  charaBrush,
  type FluidParams,
  fluidRect,
  fluidTexel,
  recover,
  snowballBrush,
  sobelNormal,
} from '../script/games/hsmg402/view/fluid';
import { FresLibrary, type MaterialData, mpsFluidEnv, mpsSceneEnv } from '../script/games/hsmg402/view/material';

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ROOT = path.resolve(WEB, '..');
const SASS = path.join(ROOT, 'analysis', 'mat', 'sass');
const errors: string[] = [];
const out: string[] = [];
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
function expect(ok: boolean, msg: string): void {
  if (!ok) errors.push(msg);
}

/* 결정적 난수 */
let seed = 12345;
const rnd = (): number => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed / 4294967296;
};
const f32 = Math.fround;
const bits = (h: string): number => {
  const b = new DataView(new ArrayBuffer(4));
  b.setUint32(0, parseInt(h, 16));
  return b.getFloat32(0);
};

/* ---------- 1. envydis 형식(sass_dis.py) 에뮬레이터 ---------- */
interface EmuEnv {
  cb: (name: string) => number;
  attr: Record<string, number>;
  tex: (sampler: string, u: number, v: number) => number[];
}
function emuEnvy(text: string, env: EmuEnv): { r: number[]; st: Record<string, number>; texUv: Record<string, [number, number]> } {
  const r = new Array<number>(64).fill(0);
  const st: Record<string, number> = {};
  const texUv: Record<string, [number, number]> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('0000')) continue;
    const tok = line.split(/\s+/);
    const op = tok[0];
    const flags = new Set<string>();
    let i = 1;
    while (i < tok.length && /^(ftz|sat|nodep|pass|b32|b|lz|bf|ge|and|rcp|rsq)$/.test(tok[i])) flags.add(tok[i++]);
    const rest = tok.slice(i);
    const reg = (t: string): number => +t.slice(2);
    const val = (ts: string[], k: { i: number }): number => {
      let neg = false;
      if (ts[k.i] === 'neg') {
        neg = true;
        k.i++;
      }
      const t = ts[k.i++];
      let v: number;
      if (t.startsWith('$r')) v = r[reg(t)];
      else if (/^0x[0-9a-f]+$/.test(t)) v = bits(t);
      else if (t.startsWith('a[')) v = env.attr[t.slice(2, -1)] ?? 0;
      else v = env.cb(t);
      return neg ? -v : v;
    };
    const k = { i: 0 };
    const sat = (x: number): number => (flags.has('sat') ? Math.min(Math.max(x, 0), 1) : x);
    switch (op) {
      case 'mov':
      case 'mov32i': {
        const d = reg(rest[0]);
        k.i = 1;
        r[d] = val(rest, k);
        break;
      }
      case 'ld':
        r[reg(rest[0])] = env.attr[rest[1].slice(2, -1)] ?? 0;
        break;
      case 'st':
        st[rest[0].slice(2, -1)] = r[reg(rest[1])];
        break;
      case 'iadd': {
        k.i = 1;
        const a = val(rest, k);
        const b = val(rest, k);
        r[reg(rest[0])] = a + b;
        break;
      }
      case 'fmul': {
        k.i = 1;
        const a = val(rest, k);
        const b = val(rest, k);
        r[reg(rest[0])] = sat(f32(a * b));
        break;
      }
      case 'fadd': {
        k.i = 1;
        const a = val(rest, k);
        const b = val(rest, k);
        r[reg(rest[0])] = sat(f32(a + b));
        break;
      }
      case 'ffma': {
        k.i = 1;
        const a = val(rest, k);
        const b = val(rest, k);
        const c = val(rest, k);
        r[reg(rest[0])] = sat(f32(a * b + c));
        break;
      }
      case 'mufu': {
        const x = r[reg(rest[1])];
        r[reg(rest[0])] = flags.has('rcp') ? 1 / x : 1 / Math.sqrt(x);
        break;
      }
      case 'ipa': {
        const a = env.attr[rest[1].slice(2, -1)] ?? 0;
        r[reg(rest[0])] = flags.has('pass') ? a : a * r[reg(rest[2])];
        break;
      }
      case 'fset': {
        k.i = 1;
        const a = val(rest, k);
        const b = val(rest, k);
        r[reg(rest[0])] = a >= b ? 1 : 0;
        break;
      }
      case 'texs': {
        /* texs [0x0|D1] D0 U V {샘플러} t2d 성분 */
        const d1 = rest[0];
        const d0 = reg(rest[1]);
        const u = r[reg(rest[2])];
        const v = r[reg(rest[3])];
        const smp = rest[4].replace(/[{}]/g, '');
        const n = rest[6].length;
        const c = env.tex(smp, u, v);
        texUv[smp] = [u, v];
        r[d0] = c[0];
        if (n > 1) r[d0 + 1] = c[1];
        if (n > 2 && d1.startsWith('$r')) r[reg(d1)] = c[2];
        break;
      }
      case 'tex': {
        /* tex b lz D U H {0x0} t2d 마스크 */
        const d = reg(rest[0]);
        const u = r[reg(rest[1])];
        const v = r[reg(rest[1]) + 1];
        const c = env.tex('bindless', u, v);
        texUv.bindless = [u, v];
        r[d] = c[0];
        break;
      }
      case 'exit':
        return { r, st, texUv };
      default:
        if (op !== 'depbar') throw new Error(`모르는 명령 ${line}`);
    }
  }
  return { r, st, texUv };
}

/* ---------- 2. nvdisasm 반정밀도(HFMA2) 에뮬레이터 — fluid_normal ---------- */
interface HReg {
  f?: number;
  lo?: number;
  hi?: number;
}
function emuNormal(text: string, c8: Record<number, number>, gather: (u: number, v: number, mask: number) => number[], u0: number, v0: number): number[] {
  const R: HReg[] = Array.from({ length: 32 }, () => ({}));
  const cv = (t: string): number => {
    const m = /c\[0x8\]\[(0x[0-9a-f]+)\]/.exec(t)!;
    return c8[parseInt(m[1], 16)];
  };
  const opnd = (t: string): [number, number] => {
    let neg = false;
    let s = t.replace('.reuse', '');
    if (s.startsWith('-')) {
      neg = true;
      s = s.slice(1);
    }
    let v: [number, number];
    if (s.startsWith('c[')) {
      const x = cv(s);
      v = [x, x];
    } else {
      const [name, sel] = s.split('.');
      const reg = R[+name.slice(1)];
      if (sel === 'F32') v = [reg.f!, reg.f!];
      else if (sel === 'H0_H0') v = [reg.lo!, reg.lo!];
      else if (sel === 'H1_H1') v = [reg.hi!, reg.hi!];
      else if (reg.lo === undefined) v = [reg.f!, reg.f!];
      else v = [reg.lo!, reg.hi!];
    }
    return neg ? [-v[0], -v[1]] : v;
  };
  const f = (n: number): number => R[n].f!;
  for (const raw of text.split('\n')) {
    const m = /\*\/\s+\{?\s*([A-Z0-9._]+)\s*(.*?)\s*[;}]/.exec(raw);
    if (!m) continue;
    const op = m[1];
    const args = m[2].split(',').map((s) => s.trim());
    const base = op.split('.')[0];
    const reg = (t: string): number => +t.replace('.reuse', '').slice(1);
    if (base === 'EXIT') break;
    if (base === 'MOV32I') R[reg(args[0])] = { f: bits(args[1]) };
    else if (base === 'MOV') R[reg(args[0])] = { f: args[1].startsWith('c[') ? cv(args[1]) : args[1] === 'RZ' ? 0 : f(reg(args[1])) };
    else if (base === 'IPA') R[reg(args[0])] = { f: args[1] === 'a[0x80]' ? u0 : v0 };
    else if (base === 'FFMA') {
      const a = opnd(args[1])[0];
      const b = opnd(args[2])[0];
      const c = opnd(args[3])[0];
      R[reg(args[0])] = { f: f32(a * b + c) };
    } else if (base === 'TLD4') {
      const d = reg(args[0]);
      const u = f(reg(args[1]));
      const v = f(reg(args[1]) + 1);
      const mask = parseInt(args[5], 16);
      gather(u, v, mask).forEach((x, k) => (R[d + k] = { f: x }));
    } else if (base === 'MUFU') R[reg(args[0])] = { f: 1 / Math.sqrt(f(reg(args[1]))) };
    else if (base === 'HMUL2' || base === 'HFMA2' || base === 'HADD2') {
      const mods = op.split('.').slice(1);
      const d = reg(args[0]);
      const s = args.slice(1).map(opnd);
      const res: [number, number] =
        base === 'HMUL2' ? [s[0][0] * s[1][0], s[0][1] * s[1][1]] : base === 'HFMA2' ? [s[0][0] * s[1][0] + s[2][0], s[0][1] * s[1][1] + s[2][1]] : [s[0][0] + s[1][0], s[0][1] + s[1][1]];
      if (mods.includes('F32')) R[d] = { f: res[0] };
      else {
        const cur = { lo: R[d].lo, hi: R[d].hi };
        if (mods.includes('MRG_H0')) cur.lo = res[0];
        else if (mods.includes('MRG_H1')) cur.hi = res[1];
        else [cur.lo, cur.hi] = res;
        R[d] = cur;
      }
    } else if (base !== 'DEPBAR' && base !== 'BRA') throw new Error(`모르는 명령 ${raw}`);
  }
  return [f(0), f(1), f(2)];
}

/* ---------- 데이터 ---------- */
const fluidJson = JSON.parse(fs.readFileSync(path.join(WEB, 'assets', 'hsmg402', 'fluid', 'fluid.json'), 'utf8')) as {
  params: FluidParams & Record<string, unknown>;
  brushes: Record<string, Record<string, { tex: string; u1x: number; min: number; center: number }>>;
};
const P = fluidJson.params;
const dump = JSON.parse(fs.readFileSync(path.join(ROOT, 'extracted', 'converted', 'hsmg402', 'graphics', 'meta', 'hsmg402_fluid.dump.json'), 'utf8'));
const dumpParams = dump[0].models[0].materials[0].params as Record<string, { value: unknown }>;
for (const [k, v] of Object.entries(dumpParams)) expect(JSON.stringify(P[k as keyof typeof P]) === JSON.stringify(v.value), `fluid.json ${k} 가 fmdb 덤프와 다름`);
out.push(`fmdb fld_fluid: ${Object.entries(dumpParams).map(([k, v]) => `${k.replace('fluid_', '')}=${JSON.stringify(v.value)}`).join(' ')}`);

/* main 0x7100421374: s8 = 폭, s9 = 폭·H/W, s10 = 0.5, s11 = 1.0 [판독] */
const W = P.fluid_world_width;
const D = (W * P.fluid_texture_height) / P.fluid_texture_width;
const env3f0 = [P.fluid_world_position[0] - W * 0.5, P.fluid_world_position[2] - D * 0.5, 1 / W, 1 / D];
const env408 = [W / P.fluid_texture_width, D / P.fluid_texture_height];
const rect = fluidRect(P);
const texel = fluidTexel(P);
rect.forEach((x, i) => expect(near(x, env3f0[i], 1e-9), `fluidRect[${i}] ${x} ≠ Env ${env3f0[i]}`));
texel.forEach((x, i) => expect(near(x, env408[i], 1e-9), `fluidTexel[${i}] ${x} ≠ Env ${env408[i]}`));
out.push(`월드→UV: Env+0x3f0 = (${env3f0.map((x) => +x.toFixed(6)).join(', ')}), +0x400 깊이 ${P.fluid_world_height}, +0x408 텍셀 (${env408.map((x) => +x.toFixed(6)).join(', ')}) — fluid.ts 일치`);

/* ---------- 눈덩이 붓 FS ---------- */
{
  const text = fs.readFileSync(path.join(SASS, 'hsmg402__forward_plus_fluid__p6.fs.txt'), 'utf8');
  const tf = (u: number, v: number): number => Math.max(0, 1 - 2 * Math.hypot(u - 0.5, v - 0.5)) ** 2;
  let maxErr = 0;
  for (let n = 0; n < 2000; n++) {
    const cx = (rnd() - 0.5) * 16;
    const cz = (rnd() - 0.5) * 16;
    const wx = cx + (rnd() - 0.5) * 1.2;
    const wz = cz + (rnd() - 0.5) * 1.2;
    const d = rnd() * 0.15;
    const mp: Record<number, number> = { 0x0: cx, 0x4: rnd(), 0x8: cz, 0x8c: d, 0x160: 1 };
    const e = emuEnvy(text, {
      cb: (t) => {
        const m = /^ModelParamBuffer\[(0x[0-9a-f]+)\]$/.exec(t);
        if (m) return mp[parseInt(m[1], 16)] ?? 0;
        throw new Error(`눈덩이 붓: 상수 ${t}`);
      },
      attr: { 'pos.w': 1, 'v0.x': wx, 'v0.z': wz },
      tex: (_s, u, v) => [tf(u, v), 0, 0, 0],
    });
    const web = snowballBrush(tf(wx - cx + 0.5, 0.5 - (wz - cz)), d, 1, 1);
    maxErr = Math.max(maxErr, Math.abs(e.r[0] - web));
    const [eu, ev] = e.texUv.utilitySampler0;
    expect(near(eu, wx - cx + 0.5, 1e-5) && near(ev, 0.5 - (wz - cz), 1e-5), '눈덩이 붓 UV 식이 원본과 다름');
    expect([1, 2, 3, 4, 5, 6, 7].every((k) => e.r[k] === 0), '눈덩이 붓: 높이 외 출력이 0 이 아님');
  }
  expect(maxErr < 1e-5, `눈덩이 붓 식 오차 ${maxErr}`);
  expect(SNOWBALL_FS.includes('vWorld.x - uCenter.x + 0.5') && SNOWBALL_FS.includes('0.5 - ( vWorld.z - uCenter.z )'), 'SNOWBALL_FS UV 식이 원본과 다름');
  out.push(`눈덩이 붓 FS(원본 p6 에뮬) vs fluid.ts: 2000 표본 최대 오차 ${maxErr.toExponential(2)} — h += −fluid0_hgt(x−mx+0.5, 0.5−(z−mz))·sat(10·d)·M160`);
}

/* ---------- 캐릭터 붓 FS (c1[0x0] = 프로그램 제어 섹션 끝 상수) ---------- */
{
  const progs: [string, number][] = [
    ['pc01_mario__forward_plus_fluid__p0', 0x174],
    ['pc01_mario__forward_plus_fluid__p6', 0x178],
    ['pc01_mario__forward_plus_fluid__p12', 0x170],
  ];
  for (const [prog, wOff] of progs) {
    const text = fs.readFileSync(path.join(SASS, `${prog}.fs.txt`), 'utf8');
    const ctl = fs.readFileSync(path.join(ROOT, 'analysis', 'mat', 'prog', `${prog}.fs1.bin`));
    const c1 = ctl.readFloatLE(0x400);
    expect(near(c1, W_FULL, 1e-6), `${prog} c1[0x0] ${c1} ≠ W_FULL ${W_FULL}`);
    let maxErr = 0;
    for (let n = 0; n < 3000; n++) {
      const w = [0, 1, 1, 3, 2, rnd() * 3][n % 6];
      const d = rnd() * 0.15;
      const u0 = n % 4 === 0 ? 0 : 1;
      const u1x = [0.5, 0.35][n % 2];
      const tv = -rnd() * 0.81;
      const mp: Record<number, number> = { 0x8c: d, 0x160: 1, 0x164: 1, [wOff]: w };
      const mat: Record<string, number> = { 'Material.utilityParameter0': u0, 'Material.utilityParameter1': u1x, 'Material.utilityParameter1+0x4': 1 };
      const e = emuEnvy(text, {
        cb: (t) => {
          const m = /^ModelParamBuffer\[(0x[0-9a-f]+)\]$/.exec(t);
          if (m) return mp[parseInt(m[1], 16)] ?? 0;
          if (t === 'c1[0x0]') return c1;
          if (t in mat) return mat[t];
          throw new Error(`캐릭터 붓: 상수 ${t}`);
        },
        attr: { 'pos.w': 1, 'v4.x': rnd(), 'v4.y': rnd(), 'v1.x': 0, 'v1.y': 1, 'v1.z': 0, 'v2.x': 1, 'v2.y': 0, 'v2.z': 0, 'v2.w': 1 },
        tex: (s) => (s === 'utilitySampler0' ? [tv, 0, 0, 0] : [0.1, 0.2, 0, 0]),
      });
      const web = charaBrush(tv, w, d, u0, u1x, 1, 1);
      maxErr = Math.max(maxErr, Math.abs(e.r[0] - web));
    }
    expect(maxErr < 1e-5, `${prog} 캐릭터 붓 식 오차 ${maxErr}`);
    out.push(`캐릭터 붓 FS ${prog.split('__').pop()}(가중치 M[0x${wOff.toString(16)}]) vs fluid.ts: 3000 표본 최대 오차 ${maxErr.toExponential(2)}, c1[0x0] = ${c1.toFixed(3)}`);
  }
  expect(CHARA_FS.includes(`step( ${W_FULL.toFixed(2)}, uW )`), 'CHARA_FS 비교 상수가 W_FULL 과 다름');
}

/* ---------- 지면 VS p384: 변위·UV·v6.w ---------- */
{
  const text = fs.readFileSync(path.join(SASS, 'hsmg402__forward_plus_custom__p384.vs.txt'), 'utf8');
  const T = [-6.160173, -1.7290286, 5.1217318];
  const hf = (u: number, v: number): number => 0.6 * Math.sin(u * 7.1) * Math.cos(v * 5.3) - 0.2;
  let maxErr = 0;
  for (let n = 0; n < 500; n++) {
    const lp = [(rnd() - 0.5) * 18 + 6, 1.925, (rnd() - 0.5) * 18 - 5];
    const shape: Record<number, number> = { 0x0: 1, 0x4: 0, 0x8: 0, 0xc: T[0], 0x10: 0, 0x14: 1, 0x18: 0, 0x1c: T[1], 0x20: 0, 0x24: 0, 0x28: 1, 0x2c: T[2] };
    const envb: Record<number, number> = { 0x3f0: env3f0[0], 0x3f4: env3f0[1], 0x3f8: env3f0[2], 0x3fc: env3f0[3], 0x400: P.fluid_world_height, 0x538: 7 };
    const e = emuEnvy(text, {
      cb: (t) => {
        let m = /^Shape\[(0x[0-9a-f]+)\]$/.exec(t);
        if (m) return shape[parseInt(m[1], 16)] ?? 0;
        m = /^EnvironmentParamBuffer\[(0x[0-9a-f]+)\]$/.exec(t);
        if (m) return envb[parseInt(m[1], 16)] ?? 0;
        m = /^ModelParamBuffer\[(0x[0-9a-f]+)\]$/.exec(t);
        if (m) return parseInt(m[1], 16) === 0x128 ? 1 : 0;
        if (t.startsWith('View[')) return 0.5;
        if (t.startsWith('Material.')) return t.startsWith('Material.texsrt1') ? 1 : 0;
        throw new Error(`지면 VS: 상수 ${t}`);
      },
      attr: { 'v0.x': lp[0], 'v0.y': lp[1], 'v0.z': lp[2], 'v1.x': 0, 'v1.y': 1, 'v1.z': 0, 'v2.x': 1, 'v2.y': 0, 'v2.z': 0, 'v2.w': 1, 'v10.x': 0, 'v10.y': 0, 'v11.x': 0, 'v11.y': 0 },
      tex: (_s, u, v) => [hf(u, v), 0, 0, 0],
    });
    const wx = lp[0] + T[0];
    const wy = lp[1] + T[1];
    const wz = lp[2] + T[2];
    const u = (wx - rect[0]) * rect[2];
    const v = (wz - rect[1]) * rect[3];
    const h = hf(u, v);
    maxErr = Math.max(maxErr, Math.abs(e.st['v0.y'] - (wy + h * P.fluid_world_height)), Math.abs(e.st['v6.w'] + h), Math.abs(e.texUv.bindless[0] - u), Math.abs(e.texUv.bindless[1] - v));
  }
  expect(maxErr < 1e-4, `지면 VS 변위·UV 오차 ${maxErr}`);
  out.push(`지면 VS p384(원본 에뮬) vs material.ts MPS_FLUID 식: 500 표본 최대 오차 ${maxErr.toExponential(2)} — uv = (월드 xz − 원점)/19, y += h·${P.fluid_world_height}, v6.w = −h`);
  const fsText = fs.readFileSync(path.join(SASS, 'hsmg402__forward_plus_custom__p384.fs.txt'), 'utf8');
  expect(/ipa \$r20 a\[v6\.w\][\s\S]*mov \$r21 0x0 0xf[\s\S]*texs nodep \$r26 \$r20 \$r20 \$r21 \{utilitySampler0\}/.test(fsText), '지면 FS: fld_sg_alb 좌표가 (v6.w, 0) 이 아님');
  expect(/fadd ftz \$r10 \$r10 \$r4\s+fadd ftz \$r20 \$r20 \$r5[\s\S]{0,80}?fadd ftz \$r24 \$r24 \$r6/.test(fsText), '지면 FS: N + N_유체 합이 보이지 않음');
}

/* ---------- 지면 깊이 전용 변형 p385(shader_type 1): 그림자 맵에도 변위 ---------- */
{
  const text = fs.readFileSync(path.join(SASS, 'hsmg402__forward_plus_custom__p385.vs.txt'), 'utf8');
  const fsText = fs.readFileSync(path.join(SASS, 'hsmg402__forward_plus_custom__p385.fs.txt'), 'utf8');
  const T = [2.5, -1.7290286, -3.25];
  const hf = (u: number, v: number): number => 0.9 * Math.sin(u * 9.3) * Math.cos(v * 4.1) - 0.3;
  const view: Record<number, number> = { 0x70: 1, 0x84: 1, 0x98: 1, 0xac: 1 };
  let maxErr = 0;
  for (let n = 0; n < 500; n++) {
    const lp = [(rnd() - 0.5) * 18 - 2, 1.925, (rnd() - 0.5) * 18 + 3];
    const shape: Record<number, number> = { 0x0: 1, 0x4: 0, 0x8: 0, 0xc: T[0], 0x10: 0, 0x14: 1, 0x18: 0, 0x1c: T[1], 0x20: 0, 0x24: 0, 0x28: 1, 0x2c: T[2] };
    const envb: Record<number, number> = { 0x3f0: env3f0[0], 0x3f4: env3f0[1], 0x3f8: env3f0[2], 0x3fc: env3f0[3], 0x400: P.fluid_world_height, 0x538: 7 };
    const e = emuEnvy(text, {
      cb: (t) => {
        let m = /^Shape\[(0x[0-9a-f]+)\]$/.exec(t);
        if (m) return shape[parseInt(m[1], 16)] ?? 0;
        m = /^EnvironmentParamBuffer\[(0x[0-9a-f]+)\]$/.exec(t);
        if (m) return envb[parseInt(m[1], 16)] ?? 0;
        m = /^ModelParamBuffer\[(0x[0-9a-f]+)\]$/.exec(t);
        if (m) return parseInt(m[1], 16) === 0x128 ? 1 : 0;
        m = /^View\[(0x[0-9a-f]+)\]$/.exec(t);
        if (m) return view[parseInt(m[1], 16)] ?? 0;
        if (t === 'Material.backgraoundMode' || t === 'Material.normalDirectionOffsetScale') return 0;
        throw new Error(`깊이 VS: 상수 ${t}`);
      },
      attr: { 'v0.x': lp[0], 'v0.y': lp[1], 'v0.z': lp[2], 'v1.x': 0, 'v1.y': 1, 'v1.z': 0 },
      tex: (_s, u, v) => [hf(u, v), 0, 0, 0],
    });
    const wx = lp[0] + T[0];
    const wz = lp[2] + T[2];
    const h = hf((wx - rect[0]) * rect[2], (wz - rect[1]) * rect[3]);
    maxErr = Math.max(maxErr, Math.abs(e.st['pos.x'] - wx), Math.abs(e.st['pos.y'] - (lp[1] + T[1] + h * P.fluid_world_height)), Math.abs(e.st['pos.z'] - wz), Math.abs(e.st['pos.w'] - 1));
  }
  expect(maxErr < 1e-4, `깊이 VS p385 변위 오차 ${maxErr}`);
  expect(!/\{|tex/.test(fsText.split('\n').slice(1).join('\n')), '깊이 FS p385 가 텍스처를 읽음(깊이 전용 아님)');
  out.push(`지면 깊이 전용 VS p385(shader_type 1, 원본 에뮬) vs material.ts mpsFluidDepthMaterial(FLUID_VERTEX): 500 표본 최대 오차 ${maxErr.toExponential(2)} — 그림자 맵도 y += h·${P.fluid_world_height}, FS 는 상수 출력`);
}

/* ---------- 엔진 fluid_normal (반정밀도) ---------- */
{
  const text = fs.readFileSync(path.join(SASS, 'system_boot__fluid_normal.fs.sass'), 'utf8');
  const N = P.fluid_texture_width;
  const H = (i: number, j: number): number => 0.5 * Math.sin(i * 0.37) + 0.3 * Math.cos(j * 0.21 + i * 0.05) - 0.1;
  /* TLD4 성분 순서 x=(i0,j1) y=(i1,j1) z=(i1,j0) w=(i0,j0), 마스크 비트 = 성분 [추정: GL gather 순서] */
  const gather = (u: number, v: number, mask: number): number[] => {
    const i0 = Math.floor(u * N - 0.5);
    const j0 = Math.floor(v * N - 0.5);
    const comp = [H(i0, j0 + 1), H(i0 + 1, j0 + 1), H(i0 + 1, j0), H(i0, j0)];
    return comp.filter((_, k) => mask & (1 << k));
  };
  const c8 = { 0x400: P.fluid_world_height, 0x408: texel[0], 0x40c: texel[1], 0x428: 1 / N, 0x42c: 1 / N, 0x538: 0 };
  let maxErr = 0;
  for (let n = 0; n < 300; n++) {
    const i = 1 + Math.floor(rnd() * (N - 2));
    const j = 1 + Math.floor(rnd() * (N - 2));
    const raw = emuNormal(text, c8, gather, (i + 0.5) / N, (j + 0.5) / N);
    const l = Math.hypot(...raw);
    const g = [-1, 0, 1].map((dj) => [-1, 0, 1].map((di) => H(i + di, j + dj)));
    const web = sobelNormal(g, P.fluid_world_height, texel[0], texel[1]);
    maxErr = Math.max(maxErr, ...raw.map((x, k) => Math.abs(x / l - web[k])));
  }
  expect(maxErr < 1e-4, `fluid_normal 오차 ${maxErr}`);
  expect(NORMAL_FS.includes('8.0 * a * b'), 'NORMAL_FS y 성분 식이 다름');
  out.push(`엔진 fluid_normal(원본 에뮬, 9 텍셀 모음) vs fluid.ts sobelNormal: 300 표본 최대 오차 ${maxErr.toExponential(2)} — n = normalize(B·S·Sobel_u, 8AB, A·S·Sobel_v)`);
}

/* ---------- 블렌드: 표 0xd/0xe/0xf(디컴파일) + 붓 패스(기계어) ---------- */
{
  const FUNC = ['Add', 'Subtract', 'ReverseSubtract', 'Min', 'Max'];
  const dec = fs.readFileSync(path.join(ROOT, 'analysis', 'decomp', 'fluid_blendtab.c'), 'utf8');
  const caseFunc = (c: string): string => {
    const m = new RegExp(`case ${c}:[\\s\\S]*?CONCAT41\\((0x[0-9a-f]+)`).exec(dec);
    if (!m) return '?';
    const x = parseInt(m[1], 16);
    const src = x & 0xff;
    const dst = (x >> 8) & 0xff;
    return `${src === 1 ? 'One' : src}·${dst === 1 ? 'One' : dst}·${FUNC[(x >> 16) & 0xff]}`;
  };
  const t = { '0xd': caseFunc('0xd'), '0xe': caseFunc('0xe'), '0xf': caseFunc('0xf') };
  expect(t['0xd'] === 'One·One·Min' && t['0xe'] === 'One·One·Max' && t['0xf'] === 'One·One·Add', `블렌드 표 ${JSON.stringify(t)}`);
  const main = fs.readFileSync(path.join(ROOT, 'extracted', 'exefs', 'main.decomp.bin'));
  const ins = (a: number): number => main.readUInt32LE(a - 0x7100000000);
  const movz = ins(0x71003ec310);
  const movk = ins(0x71003ec314);
  const imm = (((movz >> 5) & 0xffff) | (((movk >> 5) & 0xffff) << (16 * ((movk >> 21) & 3)))) >>> 0;
  const b = [imm & 0xff, (imm >> 8) & 0xff, (imm >> 16) & 0xff, (imm >> 24) & 0xff];
  expect(b[0] === 1 && b[1] === 1 && b[2] === 0 && b[3] === 1, `붓 패스 블렌드 바이트 ${b}`);
  out.push(`블렌드 [판독]: add 패스 0xf = ${t['0xf']}, 복원 0xd = ${t['0xd']}(add > 0), 0xe = ${t['0xe']}; 붓 패스 두 타깃 src ${b[0]} dst ${b[1]} func ${FUNC[b[2]]}`);
  /* recover = min(h + 붓 + add, clear) */
  let bad = 0;
  for (let n = 0; n < 1000; n++) {
    const h = rnd() * 2 - 1;
    const br = -rnd();
    const c = rnd();
    const add = P.fluid_heightmap_add_value;
    const want = Math.min(Math.max(Math.min(h + br + add, c), -1), 1);
    if (Math.abs(recover(h, br, add, c) - want) > 1e-12) bad++;
  }
  expect(bad === 0, `recover 불일치 ${bad}`);
  expect(UPDATE_FS.includes('min( h, texture( uClear, vUv ).r )') && INIT_FS.includes('texture( uClear, vUv ).r'), 'UPDATE_FS/INIT_FS 식이 다름');
}

/* ---------- 붓 텍스처 ---------- */
{
  for (const [ck, mats] of Object.entries(fluidJson.brushes)) {
    expect(Object.keys(mats).length === 3, `${ck} 붓 재질 수 ${Object.keys(mats).length}`);
    for (const [mn, b] of Object.entries(mats)) {
      expect(fs.existsSync(path.join(WEB, 'assets', 'hsmg402', 'fluid', b.tex)), `${ck} ${mn} 텍스처 없음`);
      expect(b.center < 0 && b.min < 0, `${ck} ${mn} 붓이 파지 않음(center ${b.center})`);
    }
  }
  const b = fluidJson.brushes.pc01;
  out.push(`캐릭터 붓 10명: 발 중심 ${b.L_footfluid_m.center.toFixed(3)}(최소 ${b.L_footfluid_m.min.toFixed(3)}), 몸 중심 ${b.bodyfluid_m.center.toFixed(3)}, utilityParameter1.x ${[...new Set(Object.values(fluidJson.brushes).map((m) => m.bodyfluid_m.u1x))].join('/')}`);
}

/* ---------- 셰이더 문자열 선언 ---------- */
{
  const BRUSH_OUT = ['vWorld', 'vUv'];
  const check = (name: string, src: string, ins: string[]): void => {
    const used = new Set(src.match(/\b[uv][A-Z]\w*/g) ?? []);
    for (const u of used) {
      const decl = new RegExp(String.raw`\b(uniform\s+\w+|in\s+\w+|out\s+\w+)\s+${u}\b`);
      if (!decl.test(src)) errors.push(`${name} 선언 없음 ${u}`);
      if (/\bin\s+\w+\s+v[A-Z]/.test(src) && u.startsWith('v') && !ins.includes(u)) errors.push(`${name} 정점 출력 없음 ${u}`);
    }
  };
  check('INIT_FS', INIT_FS, ['vUv']);
  check('UPDATE_FS', UPDATE_FS, ['vUv']);
  check('NORMAL_FS', NORMAL_FS, ['vUv']);
  check('SNOWBALL_FS', SNOWBALL_FS, BRUSH_OUT);
  check('CHARA_FS', CHARA_FS, BRUSH_OUT);
}

/* ---------- 지면 재질 훅(material.ts MPS_FLUID) ---------- */
{
  const stub = () => ({ name: 'stub_textures', loadTexture: () => Promise.resolve(new THREE.Texture()) });
  const buf = fs.readFileSync(path.join(WEB, 'assets', 'hsmg402', 'model', 'hsmg402_fld.glb'));
  const loader = new GLTFLoader();
  loader.register(stub as never);
  const g = await new Promise<{ scene: THREE.Object3D }>((ok, bad) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '', ok as never, bad));
  const data = JSON.parse(fs.readFileSync(path.join(WEB, 'assets', 'hsmg402', 'material', 'material.json'), 'utf8')) as MaterialData;
  mpsSceneEnv.irradiance.value = new THREE.CubeTexture();
  mpsFluidEnv.height.value = new THREE.Texture();
  mpsFluidEnv.normal.value = new THREE.Texture();
  const lib = new FresLibrary((p) => p);
  lib.data = data;
  (lib as unknown as { tex: Map<string, THREE.Texture> }).tex = new Map(Object.keys(data.textures).map((k) => [k, new THREE.Texture()]));
  const seen = new Set<string>();
  g.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.Material;
    if (seen.has(src.name)) return;
    seen.add(src.name);
    const m = lib.convert(src, 'hsmg402_fld');
    if (!m) return;
    const sh = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, defines: {} as Record<string, string> };
    m.onBeforeCompile(sh as never, null as never);
    const on = 'MPS_FLUID' in sh.defines;
    expect(on === (src.name === 'fld_snow_fluid_mt'), `${src.name} MPS_FLUID ${on}`);
    if (on) {
      expect(sh.vertexShader.includes('transformed += inverse( mat3( modelMatrix ) ) * vec3( 0.0, vMpsFluidH * mpsFluidDepth, 0.0 );'), '지면 VS 변위 치환 실패');
      expect(sh.vertexShader.indexOf('vMpsFluidH = textureLod') > sh.vertexShader.indexOf('#include <begin_vertex>'), '지면 VS 변위 위치가 begin_vertex 뒤가 아님');
      expect(sh.fragmentShader.includes('normalize( texture2D( mpsFluidNormal, vMpsFluidUv ).xyz )'), '지면 FS 노멀 치환 실패');
      expect(sh.fragmentShader.includes('texture2D( mpsTint, vec2( -vMpsFluidH, 0.0 ) )'), '지면 FS 최종 곱 u = −h 치환 실패');
      for (const k of ['mpsFluidHeight', 'mpsFluidNormal', 'mpsFluidRect', 'mpsFluidDepth']) expect(k in sh.uniforms, `지면 uniform 없음 ${k}`);
      expect(m.shadowSide === m.side && m.side === THREE.FrontSide, `지면 shadowSide ${m.shadowSide} ≠ 재질 면 ${m.side}`);
      const dm = m.userData.mpsDepth as THREE.MeshDepthMaterial | undefined;
      expect(!!dm && dm.depthPacking === THREE.RGBADepthPacking, '지면 그림자 깊이 재질 없음/깊이 패킹 다름');
      if (dm) {
        const dsh = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader, defines: {} as Record<string, string> };
        dm.onBeforeCompile(dsh as never, null as never);
        expect(dsh.vertexShader.indexOf('vMpsFluidH = textureLod') > dsh.vertexShader.indexOf('#include <begin_vertex>'), '깊이 VS 변위가 begin_vertex 뒤가 아님');
        expect(dsh.vertexShader.indexOf('vMpsFluidH = textureLod') < dsh.vertexShader.indexOf('#include <project_vertex>'), '깊이 VS 변위가 project_vertex 앞이 아님');
        for (const k of ['mpsFluidHeight', 'mpsFluidRect', 'mpsFluidDepth']) expect(dsh.uniforms[k] === (mpsFluidEnv as unknown as Record<string, THREE.IUniform>)[k.replace('mpsFluid', '').toLowerCase()], `깊이 uniform ${k} 이 mpsFluidEnv 와 다름`);
        for (const name of new Set(dsh.vertexShader.match(/\bv?[mM]ps[A-Z]\w*/g) ?? [])) {
          const decl = new RegExp(String.raw`\b((uniform|varying|attribute)\s+\w+|vec4|float)\s+${name}\b`);
          if (!decl.test(dsh.vertexShader)) errors.push(`깊이 vs 선언 없음 ${name}`);
        }
        expect(!/[mM]ps[A-Z]/.test(dsh.fragmentShader), '깊이 FS 에 mps 식별자가 들어감');
        expect(dm.customProgramCacheKey() !== new THREE.MeshDepthMaterial().customProgramCacheKey(), '깊이 재질 프로그램 캐시 키가 기본과 같음');
      }
      for (const [stage, s] of [['vs', sh.vertexShader], ['fs', sh.fragmentShader]] as const) {
        for (const name of new Set(s.match(/\bv?[mM]ps[A-Z]\w*/g) ?? [])) {
          const decl = new RegExp(String.raw`\b(uniform|varying|attribute|const|float|vec2|vec3|vec4|mat3|sampler2D|samplerCube)\s+(highp\s+|mediump\s+)?${name}\b`);
          if (!decl.test(s)) errors.push(`지면 ${stage} 선언 없음 ${name}`);
        }
      }
    }
  });
  out.push(`지면 재질 훅: fld_snow_fluid_mt 만 MPS_FLUID(정점 변위·노멀 합·최종 곱 u=−h) + 그림자 깊이 재질(같은 변위, shadowSide = 앞면), 선언 검사 포함`);
}

/* ---------- 참고 계산: 공 한 번 지나간 홈 깊이·복원 시간 ---------- */
{
  /* 공(배율 1) 이 초속 2.0(프레임 0.0333)으로 중심선 위를 지나간다 — fluid0_hgt 는 선형 반경 그라데이션 근사 */
  const step = 2.0 / 60;
  let h = 0.2;
  for (let x = -1; x <= 1; x += step) {
    const r = Math.abs(x);
    const t = r < 0.5 ? (1 - 2 * r) ** 2.2 : 0;
    h = recover(h, snowballBrush(t, step, 1), P.fluid_heightmap_add_value, 0.2);
  }
  const back = (0.2 - h) / P.fluid_heightmap_add_value / 60;
  out.push(`참고: clear 0.2 위를 공이 초속 2 로 한 번 지나가면 h = ${h.toFixed(3)} (y ${(0.196 + h * P.fluid_world_height).toFixed(3)} m, 바닥 snow y 0) → 0.2 로 돌아오는 데 ${back.toFixed(0)} 초 [재구현 계산]`);
}

console.log(out.join('\n'));
console.log(errors.length ? `오류 ${errors.length}\n${errors.join('\n')}` : '오류 0');
process.exitCode = errors.length ? 1 : 0;
