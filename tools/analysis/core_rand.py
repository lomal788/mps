"""mps bex 난수 재구현 (main NSO 판독 기준). mpj tools/core_rand.py 를 참고해 mps 판독에 맞게 새로 씀.

근거 (main @주소, 디스어셈블: web/tools/analysis/dis_main.py, 디컴파일: analysis/decomp/main_core.c):
  - 엔진: 전역 libc++ std::mt19937 두 개. sync @0x71015f70d8, async @0x71015f7ac8
      +0x000 u32 mt[624], +0x9C0 u64 index, +0x9C8 u32 seed
  - 정적 초기화 @0x710019c200: 두 엔진 모두 nn::os::GetSystemTick() 하위 32비트로 init_genrand
  - SetSyncRandSeed @0x710019bb40: sync 만 다시 시드(index=0), 이어서 사운드 쪽 FUN_7100466a1c(seed)
  - 분포 (async/sync 코드가 같고 엔진만 다르다):
      Rand/SyncRand            @0x710019b730 / @0x710019bbd0 : u
      RandMod/SyncRandMod      @0x710019b7f0 / @0x710019bc90 : n<2 → 0(소비 없음), uniform_int(0,n-1) @0x710019bfcc
      RandRange/SyncRandRange  @0x710019b840 / @0x710019bce0 : lo=min,hi=max(부호 없음), hi-lo<2 → lo(소비 없음), uniform_int(lo,hi-1)
      RandF/SyncRandF          @0x710019b890 / @0x710019bd30 : f32(u)*2^-32 + 0
      RandModF/SyncRandModF    @0x710019b960 / @0x710019be00 : x<=0 → 0(소비 없음), f32(f32(u)*2^-32 * x) + 0
      RandRangeF/SyncRandRangeF@0x710019ba40 / @0x710019bee0 : lo=min,hi=max(f32 비교 gt), f32(lo + f32(f32(hi-lo) * f32(u)*2^-32))
  - mpj 와 다른 점: sync 분포가 (u*n)>>32 가 아니라 uniform_int, ModF/RangeF 가 fmadd(단일 반올림)가 아니라 곱·합 따로 반올림.

사용:  .venv/Scripts/python web/tools/analysis/core_rand.py                → numpy MT19937 대조 + 시험 벡터 출력
       .venv/Scripts/python web/tools/analysis/core_rand.py --json F      → 시험 벡터 JSON 저장
"""
from __future__ import annotations

import json
import struct
import sys

M32 = 0xFFFFFFFF


def f32(x: float) -> float:
    return struct.unpack('<f', struct.pack('<f', x))[0]


def f32_bits(x: float) -> int:
    return struct.unpack('<I', struct.pack('<f', x))[0]


def ucvtf(u: int) -> float:
    return f32(float(u))


class MT19937:
    N, M = 624, 397

    def __init__(self, seed: int):
        self.seed(seed)

    def seed(self, s: int) -> None:
        s &= M32
        mt = [0] * self.N
        mt[0] = s
        for i in range(1, self.N):
            mt[i] = (0x6C078965 * (mt[i - 1] ^ (mt[i - 1] >> 30)) + i) & M32
        self.mt, self.i, self.seed_value = mt, 0, s

    def next_u32(self) -> int:
        mt, i = self.mt, self.i
        j = (i + 1) % self.N
        k = (i + self.M) % self.N
        y = (mt[i] & 0x80000000) | (mt[j] & 0x7FFFFFFE)
        v = mt[k] ^ (y >> 1) ^ (0x9908B0DF if (mt[j] & 1) else 0)
        mt[i] = v
        self.i = j
        z = v ^ (v >> 11)
        z ^= (z << 7) & 0x9D2C5680
        z ^= (z << 15) & 0xEFC60000
        z ^= z >> 18
        return z & M32


def uniform_int(e: MT19937, a: int, b: int) -> int:
    """@0x710019bfcc: libc++ uniform_int_distribution<u32>(a,b)."""
    if (b - a) & M32 == 0:
        return a
    r = (b - a + 1) & M32
    if r == 0:
        return e.next_u32()
    w = r.bit_length() - 1 + (0 if (r & (r - 1)) == 0 else 1)
    mask = M32 >> (32 - w) if w > 0 else 0
    while True:
        u = e.next_u32() & mask
        if u < r:
            return (a + u) & M32


class BexRand:
    """async/sync 공통 분포. 엔진만 다르다."""

    def __init__(self, seed: int):
        self.e = MT19937(seed)

    def set_seed(self, s: int) -> None:
        self.e.seed(s)

    def rand(self) -> int:
        return self.e.next_u32()

    def rand_mod(self, n: int) -> int:
        n &= M32
        return 0 if n < 2 else uniform_int(self.e, 0, n - 1)

    def rand_range(self, a: int, b: int) -> int:
        a &= M32; b &= M32
        lo, hi = (b, a) if a > b else (a, b)
        return lo if hi - lo < 2 else uniform_int(self.e, lo, hi - 1)

    def rand_f(self) -> float:
        return f32(ucvtf(self.e.next_u32()) * 2.0 ** -32 + 0.0)

    def rand_mod_f(self, x: float) -> float:
        x = f32(x)
        if not (x > 0.0):
            return 0.0
        s1 = f32(ucvtf(self.e.next_u32()) * 2.0 ** -32)
        return f32(f32(s1 * x) + 0.0)

    def rand_range_f(self, a: float, b: float) -> float:
        a, b = f32(a), f32(b)
        lo, hi = (b, a) if a > b else (a, b)
        d = f32(hi - lo)
        s2 = f32(ucvtf(self.e.next_u32()) * 2.0 ** -32)
        return f32(f32(d * s2) + lo)


def vectors(seed: int = 12345):
    out = {"seed": seed}
    r = BexRand(seed); out["rand"] = [r.rand() for _ in range(8)]
    r = BexRand(seed); out["rand_mod_6"] = [r.rand_mod(6) for _ in range(16)]
    r = BexRand(seed); out["rand_range_3_10"] = [r.rand_range(3, 10) for _ in range(16)]
    r = BexRand(seed); out["rand_f_bits"] = [hex(f32_bits(r.rand_f())) for _ in range(8)]
    r = BexRand(seed); out["rand_mod_f_2.5_bits"] = [hex(f32_bits(r.rand_mod_f(2.5))) for _ in range(8)]
    r = BexRand(seed); out["rand_range_f_-1_1_bits"] = [hex(f32_bits(r.rand_range_f(-1.0, 1.0))) for _ in range(8)]
    r = BexRand(seed); out["edge_rand_mod_1_consumes"] = (r.rand_mod(1), r.e.i)
    return out


def main():
    import numpy as np
    seed = 12345
    ref = np.random.RandomState(seed)
    mine = MT19937(seed)
    a = [mine.next_u32() for _ in range(1000)]
    b = [int(x) for x in ref.randint(0, 2 ** 32, size=1000, dtype=np.uint64)]
    ok = a == b
    print("numpy MT19937 1000개 일치:", ok)
    v = vectors(seed)
    v["numpy_match_1000"] = ok
    if len(sys.argv) > 2 and sys.argv[1] == "--json":
        json.dump(v, open(sys.argv[2], "w"), indent=1)
    print(json.dumps(v, indent=1))


if __name__ == "__main__":
    main()
