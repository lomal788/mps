/**
 * 난수 — mps bex 난수 [판독: docs/engine/01_core.md 8절, 재구현 web/tools/analysis/core_rand.py, 시험 벡터 analysis/core/rand_vectors.json].
 * 전역 libc++ std::mt19937 두 개: sync @0x71015f70d8, async @0x71015f7ac8. **sync·async 분포 식이 같다**(엔진만 다르다).
 * - RandMod/Range: libc++ uniform_int_distribution(기각 표본, @0x710019bfcc). n<2·폭<2 는 소비 없음
 * - RandF: f32(u)·2⁻³², RandModF: f32(f32(u)·2⁻³²·x)(x≤0 → 0, 소비 없음), RandRangeF: f32(lo + f32((hi−lo)·f32(u)·2⁻³²)) — 곱·합 따로 반올림(fmadd 아님)
 * mpj(잼버리) BexRandModule 의 sync (u·n)>>32 와 다르다. mpj 판을 쓰면 안 된다.
 *
 * 시드: 원본은 부팅 때 둘 다 GetSystemTick 하위 32비트, 오프라인 장면에서는 **다시 시드하지 않는다**(직전 장면 상태가 이어짐).
 * 웹은 GameSetup.seed 로 두 엔진을 시드한다(골든 대조용 시드 주입, 웹 결정).
 */

const M32 = 0xffffffff;
const TWO_M32 = 2 ** -32;

export class MT19937 {
  private readonly mt = new Uint32Array(624);
  private i = 0;
  /** 출력 횟수(대조용) */
  calls = 0;

  constructor(seed: number) {
    this.seed(seed);
  }

  /** init_genrand, index = 0 */
  seed(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let k = 1; k < 624; k++) {
      const prev = mt[k - 1] ^ (mt[k - 1] >>> 30);
      mt[k] = (Math.imul(0x6c078965, prev) + k) >>> 0;
    }
    this.i = 0;
    this.calls = 0;
  }

  /** 한 칸씩 twist(libc++ 방식, 출력은 표준과 같다) */
  nextU32(): number {
    const mt = this.mt;
    const i = this.i;
    const j = (i + 1) % 624;
    const k = (i + 397) % 624;
    const y = (mt[i] & 0x80000000) | (mt[j] & 0x7ffffffe);
    const v = (mt[k] ^ (y >>> 1) ^ (mt[j] & 1 ? 0x9908b0df : 0)) >>> 0;
    mt[i] = v;
    this.i = j;
    let z = v ^ (v >>> 11);
    z ^= (z << 7) & 0x9d2c5680;
    z ^= (z << 15) & 0xefc60000;
    z ^= z >>> 18;
    this.calls++;
    return z >>> 0;
  }
}

/** libc++ uniform_int_distribution<u32>(a, b) @0x710019bfcc — 비트 마스크 기각 표본 */
function uniformInt(e: MT19937, a: number, b: number): number {
  a >>>= 0;
  b >>>= 0;
  if (((b - a) >>> 0) === 0) return a;
  const r = (b - a + 1) >>> 0;
  if (r === 0) return e.nextU32();
  const bits = 32 - Math.clz32(r);
  const w = bits - 1 + ((r & (r - 1)) === 0 ? 0 : 1);
  const mask = w >= 32 ? M32 : w > 0 ? (2 ** w - 1) >>> 0 : 0;
  for (;;) {
    const u = (e.nextU32() & mask) >>> 0;
    if (u < r) return (a + u) >>> 0;
  }
}

/** f32(u)·2⁻³² — ucvtf(가까운 짝수) 뒤 지수 조정(정확) */
const unitF = (u: number): number => Math.fround(Math.fround(u) * TWO_M32);

/** mps bex 분포 한 벌(엔진 하나). sync 와 async 가 같은 식이다 */
export class BexRand {
  readonly e: MT19937;

  constructor(seed: number) {
    this.e = new MT19937(seed);
  }

  /** 원본 SetSyncRandSeed(sync) — index 0 으로 다시 시드 */
  setSeed(s: number): void {
    this.e.seed(s >>> 0);
  }

  /** Rand/SyncRand @0x710019b730 / @0x710019bbd0 */
  rand(): number {
    return this.e.nextU32();
  }

  /** RandMod/SyncRandMod @0x710019b7f0 / @0x710019bc90 — [0, n), n<2 → 0(소비 없음) */
  mod(n: number): number {
    n >>>= 0;
    return n < 2 ? 0 : uniformInt(this.e, 0, n - 1);
  }

  /** RandRange/SyncRandRange @0x710019b840 / @0x710019bce0 — lo=min, hi=max(부호 없음), [lo, hi). hi−lo<2 → lo(소비 없음) */
  range(a: number, b: number): number {
    a >>>= 0;
    b >>>= 0;
    const lo = a > b ? b : a;
    const hi = a > b ? a : b;
    return hi - lo < 2 ? lo : uniformInt(this.e, lo, hi - 1);
  }

  /** RandF/SyncRandF @0x710019b890 / @0x710019bd30 — f32(u)·2⁻³² + 0 (u ≥ 0xFFFFFF80 이면 1.0) */
  f(): number {
    return Math.fround(unitF(this.e.nextU32()) + 0);
  }

  /** RandModF/SyncRandModF @0x710019b960 / @0x710019be00 — x≤0 → 0(소비 없음) */
  modF(x: number): number {
    x = Math.fround(x);
    if (!(x > 0)) return 0;
    const s1 = unitF(this.e.nextU32());
    return Math.fround(Math.fround(s1 * x) + 0);
  }

  /** RandRangeF/SyncRandRangeF @0x710019ba40 / @0x710019bee0 — lo/hi 는 f32 비교(gt)로 정렬, 곱·합 따로 반올림 */
  rangeF(a: number, b: number): number {
    a = Math.fround(a);
    b = Math.fround(b);
    const lo = a > b ? b : a;
    const hi = a > b ? a : b;
    const d = Math.fround(hi - lo);
    const s2 = unitF(this.e.nextU32());
    return Math.fround(Math.fround(d * s2) + lo);
  }
}

/** sync·async 두 엔진(원본 전역 둘) */
export class MpsRand {
  readonly sync: BexRand;
  readonly async: BexRand;

  constructor(syncSeed: number, asyncSeed = syncSeed) {
    this.sync = new BexRand(syncSeed);
    this.async = new BexRand(asyncSeed);
  }

  /** 원본 SetSyncRandSeed(온라인 SyncBegin·리플레이 미니게임만 부른다) */
  setSyncRandSeed(s: number): void {
    this.sync.setSeed(s);
  }

  /** 지금까지 뽑은 u32 수(대조용) */
  get calls(): number {
    return this.sync.e.calls + this.async.e.calls;
  }
}
