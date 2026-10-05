"""BNVIB(HD 진동 파일) → JSON (웹 Gamepad 진동 근사용).

형식 [데이터: vib.nx.bea 463개 + 다른 아카이브 포함 926개 헤더 관측]:
  u32 메타 크기(4 | 12 | 16), u16 형식(관측 3), u16 샘플링 Hz(관측 200),
  [메타 12/16 이면 u32 loopStart, u32 loopEnd, (16 이면 u32 loopInterval)]  ← 이름은 vibration.msgpack vib_setting 의 loop 필드 [추정]
  u32 데이터 크기, 샘플 = 4바이트 × n.
샘플 바이트 순서는 nn::hid::VibrationValue 순서 {ampLow, freqLow, ampHigh, freqHigh} 로 본다 [추정].
  근거: mg1801_just 는 0번 바이트만 감쇠, mg1801_success 는 2번 바이트만 감쇠 → 0·2번이 진폭, 1·3번이 주파수 코드.
진폭 = 바이트/255 [추정]. 주파수 코드 → Hz 변환식은 [미확정] (원 코드만 남긴다).

사용: ui_bnvib.py <out_dir> <x.bnvib>...
"""
import json
import struct
import sys
from pathlib import Path


def parse(b):
    meta, fmt, rate = struct.unpack_from("<IHH", b, 0)
    d = {"meta": meta, "format": fmt, "rateHz": rate}
    if meta >= 12:
        d["loopStart"], d["loopEnd"] = struct.unpack_from("<II", b, 8)
    if meta >= 16:
        d["loopInterval"] = struct.unpack_from("<I", b, 16)[0]
    size = struct.unpack_from("<I", b, 4 + meta)[0]
    o = 8 + meta
    if o + size != len(b):
        raise ValueError(f"size mismatch {o}+{size} != {len(b)}")
    n = size // 4
    s = [list(b[o + i * 4:o + i * 4 + 4]) for i in range(n)]
    d["samples"] = n
    d["durationSec"] = round(n / rate, 4)
    d["ampLow"] = [round(x[0] / 255, 4) for x in s]
    d["freqLowCode"] = [x[1] for x in s]
    d["ampHigh"] = [round(x[2] / 255, 4) for x in s]
    d["freqHighCode"] = [x[3] for x in s]
    return d


def web_envelope(d, step_ms=50):
    """Gamepad dual-rumble 근사: step_ms 구간마다 {strong=ampLow 평균, weak=ampHigh 평균}."""
    per = max(1, int(d["rateHz"] * step_ms / 1000))
    out = []
    for i in range(0, d["samples"], per):
        lo = d["ampLow"][i:i + per]
        hi = d["ampHigh"][i:i + per]
        out.append({"t": round(i / d["rateHz"], 3), "strong": round(sum(lo) / len(lo), 3), "weak": round(sum(hi) / len(hi), 3)})
    return out


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for p in sys.argv[2:]:
        d = parse(Path(p).read_bytes())
        d["webDualRumble50ms"] = web_envelope(d)
        (out / (Path(p).stem + ".json")).write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        print(Path(p).name, d["samples"], d["durationSec"], "s", "loop" if "loopStart" in d else "")
