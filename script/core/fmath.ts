/**
 * f32 수학 — 원본(AArch64)은 float 연산이 많다. 원본이 float 에 저장하는 값은 저장할 때마다 F() 로 자른다.
 * 계산 중간을 double 로 둘지 f32 로 자를지는 함수마다 판독해서 정한다(DESIGN 3절). 이 파일은 그 도구만 둔다.
 */

export const F = Math.fround;

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x: F(x), y: F(y), z: F(z) });

export const setV3 = (o: V3, x: number, y: number, z: number): V3 => {
  o.x = F(x);
  o.y = F(y);
  o.z = F(z);
  return o;
};

export const copyV3 = (o: V3, a: V3): V3 => setV3(o, a.x, a.y, a.z);

/** a + b·s (f32 로 한 번 자른다) */
export const addScaledV3 = (o: V3, a: V3, b: V3, s: number): V3 => setV3(o, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** a + (b - a)·t */
export const lerpF = (a: number, b: number, t: number): number => F(a + (b - a) * t);

/** C 의 (int)float 변환(0 쪽 절삭) */
export const toInt = (v: number): number => Math.trunc(v) | 0;

export const DEG2RAD = F(0.017453292);

/** u32 비트 → f32 값(원본 상수를 비트 그대로 옮길 때) */
export const f32FromBits = (u: number): number => new Float32Array(new Uint32Array([u >>> 0]).buffer)[0];

/* ───────────── mps(AArch64 NEON·sdk) 도우미 — docs/minigame/hsmg402.md 6.14·9.9, web/tools/analysis/hsmg402_calc.py·hsmg402_player_calc.py ───────────── */

/** f32 → u32 비트 */
export const f32Bits = (x: number): number => new Uint32Array(new Float32Array([x]).buffer)[0];

/** 4성분 벡터(NEON q 레지스터 한 개, 레인 순서 x, y, z, w) */
export interface V4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v4 = (x = 0, y = 0, z = 0, w = 0): V4 => ({ x: F(x), y: F(y), z: F(z), w: F(w) });

export const v4of = (a: V3, w = 0): V4 => ({ x: a.x, y: a.y, z: a.z, w: F(w) });

/** 융합 곱합 a·b + c (fmla/fmadd, 한 번 반올림. f32 곱은 f64 에서 정확하다) */
export const fma = (a: number, b: number, c: number): number => F(a * b + c);

/** AArch64 FRSQRTE 의 RecipSqrtEstimate(FEAT_RPRES 없음) */
function recipSqrtEstimate(a: number): number {
  if (a < 256) a = a * 2 + 1;
  else {
    a = (a >> 1) << 1;
    a = (a + 1) * 2;
  }
  let b = 512;
  while (a * (b + 1) * (b + 1) < 2 ** 28) b++;
  return (b + 1) >> 1;
}

/** frsqrte(f32) — 8비트 추정. 원본 정규화의 첫 단계(web/tools/analysis/hsmg402_calc.py frsqrte) */
export function frsqrte(x: number): number {
  x = F(x);
  if (x === 0) return Infinity;
  if (x < 0 || Number.isNaN(x)) return NaN;
  if (x === Infinity) return 0;
  const u = f32Bits(x);
  let exp = (u >>> 23) & 0xff;
  let frac = u & 0x7fffff;
  if (exp === 0) {
    while (!(frac & 0x400000)) {
      frac <<= 1;
      exp -= 1;
    }
    frac = (frac << 1) & 0x7fffff;
  }
  // fraction<51:0> = frac << 29. 짝수 지수: (1<<8) | frac64>>44 = (1<<8) | frac>>15, 홀수: (1<<7) | frac>>16
  const scaled = (exp & 1) === 0 ? (1 << 8) | (frac >>> 15) : (1 << 7) | (frac >>> 16);
  const est = recipSqrtEstimate(scaled);
  const rexp = Math.floor((380 - exp) / 2);
  return f32FromBits((((rexp & 0xff) << 23) | ((est & 0xff) << 15)) >>> 0);
}

/** frsqrts(a, b) = (3 − a·b)/2, 한 번 반올림 */
export const frsqrts = (a: number, b: number): number => F((3 - a * b) / 2);

/** 원본 역길이 순서: e=frsqrte(sq); t=e·sq; e·=frsqrts(e,t); t=sq·e; e·=frsqrts(e,t) */
export function neonInvLen(sq: number): number {
  let e = frsqrte(sq);
  let t = F(e * sq);
  e = F(e * frsqrts(e, t));
  t = F(sq * e);
  e = F(e * frsqrts(e, t));
  return e;
}

/** 길이² = fmul v,v → ext #8 → fadd .2s → faddp : (x²+z²)+(y²+w²) */
export const laneSq = (v: V4): number => F(F(F(v.x * v.x) + F(v.z * v.z)) + F(F(v.y * v.y) + F(v.w * v.w)));

/** 내적, laneSq 와 같은 더하기 순서 */
export const dot4 = (a: V4, b: V4): number => F(F(F(a.x * b.x) + F(a.z * b.z)) + F(F(a.y * b.y) + F(a.w * b.w)));

/** 정규화(frsqrte + frsqrts×2), 길이 0 이면 0 벡터 */
export function normalize4(v: V4): V4 {
  const sq = laneSq(v);
  if (sq === 0) return { x: 0, y: 0, z: 0, w: 0 };
  const k = neonInvLen(sq);
  return { x: F(v.x * k), y: F(v.y * k), z: F(v.z * k), w: F(v.w * k) };
}

/** 성분별 a + b(f32) */
export const add4 = (a: V4, b: V4): V4 => ({ x: F(a.x + b.x), y: F(a.y + b.y), z: F(a.z + b.z), w: F(a.w + b.w) });
/** 성분별 a − b(f32) */
export const sub4 = (a: V4, b: V4): V4 => ({ x: F(a.x - b.x), y: F(a.y - b.y), z: F(a.z - b.z), w: F(a.w - b.w) });
/** 성분별 a·s(f32) */
export const scale4 = (a: V4, s: number): V4 => ({ x: F(a.x * s), y: F(a.y * s), z: F(a.z * s), w: F(a.w * s) });
/** 분리 곱합 a·s + b (fmul 뒤 fadd, 두 번 반올림) */
export const mulAdd4 = (a: V4, s: number, b: V4): V4 => ({
  x: F(F(a.x * s) + b.x),
  y: F(F(a.y * s) + b.y),
  z: F(F(a.z * s) + b.z),
  w: F(F(a.w * s) + b.w),
});

/** 외적(tbl + fmls): (u.y v.z − u.z v.y, u.z v.x − u.x v.z, u.x v.y − u.y v.x, 0), 뺄셈은 융합 */
export const cross4 = (u: V4, v: V4): V4 => ({
  x: fma(-u.z, v.y, F(u.y * v.z)),
  y: fma(-u.x, v.z, F(u.z * v.x)),
  z: fma(-u.y, v.x, F(u.x * v.y)),
  w: 0,
});

/** acosf — libm 대신 f64 acos 를 f32 로(1 ulp 차이 가능, 9.7). 인자는 [−1, 1] 로 자른다 */
export const acosf = (x: number): number => F(Math.acos(F(x > 1 ? 1 : x < -1 ? -1 : x)));

/** 57.29578(0x42652EE1) / 0.017453292(0x3C8EFA35) */
export const RAD2DEG = F(57.29578);

/** sdk nn::util::detail::SinCoefficients @0xab263c / CosCoefficients @0xab2650 (S0..S4, C0..C4) */
const SIN_C = [0x32d46a65, 0x36391b32, 0x39500fbd, 0x3c088896, 0x3e2aaaab].map(f32FromBits);
const COS_C = [0x348cb96f, 0x37cfc9cf, 0x3ab60a5d, 0x3d2aaaa8, 0x3f000000].map(f32FromBits);
const F1D2PI = f32FromBits(0x3e22f983);
const FPID2 = f32FromBits(0x3fc90fdb);
const FPI = f32FromBits(0x40490fdb);
const F2PI = f32FromBits(0x40c90fdb);

/**
 * sdk 벡터 sin/cos 다항식(fmla/fmls 융합) — hsmg402 SetDamage @0x710000a358~0x710000a47c 인라인.
 * n = trunc(a/(2π) ± 0.5), x = a − n·2π(융합), ±π/2 밖이면 접고 cos 부호를 뒤집는다. 반환 [sin, cos]
 */
export function nnSinCos(a: number): [number, number] {
  a = F(a);
  let t = F(a * F1D2PI);
  t = F(t + (t >= 0 ? 0.5 : -0.5));
  const n = F(Math.trunc(t));
  let x = fma(-n, F2PI, a);
  let flip = false;
  if (x > FPID2) {
    x = F(FPI - x);
    flip = true;
  }
  if (x < -FPID2) {
    x = F(-FPI - x);
    flip = true;
  }
  const x2 = F(x * x);
  let v6 = fma(-x2, SIN_C[0], SIN_C[1]);
  let v7 = fma(x2, v6, -SIN_C[2]);
  v6 = fma(x2, v7, SIN_C[3]);
  v7 = fma(x2, v6, -SIN_C[4]);
  v6 = fma(x2, v7, 1);
  const s = F(x * v6);
  let w7 = fma(-x2, COS_C[0], COS_C[1]);
  let w6 = fma(x2, w7, -COS_C[2]);
  const w16 = fma(x2, w6, COS_C[3]);
  w6 = fma(x2, w16, -COS_C[4]);
  let c = fma(x2, w6, 1);
  c = F(c * (flip ? -1 : 1));
  return [s, c];
}
