"""MPAT(.mpat, 매직 'tapm') 파서. 모션 쌍 표.

헤더(LE): +0 'tapm' / +4 u32 version / +8 u64 entryTableOffset / +0x10 u64 count /
+0x18 i64 table2Offset(-1 = 없음) / +0x20 u64 table2Count / +0x28 문자열 풀(NUL 종결) / entryTableOffset부터 0x30 B 항목 × count.
항목(두 표 공통): +0 u64 fromNameOff(파일 절대, -1 = 이름 없음 → None) / +8 u64 toNameOff / +0x10 u32 a / +0x14 i32 b / +0x18 f32 c / +0x1C u32 d / +0x20 i64 / +0x28 i64 e
필드 a~e 의 의미는 미확정이다.
사용: python web/tools/analysis/scene_mpat.py <mpat...>  (인자 없으면 bq.nx.bea chara/mpat 전부 → extracted/converted/scene/mpat.json)
"""
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def cstr(b, o):
    if o == 0xFFFFFFFFFFFFFFFF:
        return None
    e = b.index(0, o)
    return b[o:e].decode("utf-8")


def parse_mpbs(b):
    """[mps] Superstars 'mpbs' 판. +4 u32 hdrEnd(0x24) / +8 u32 len(이름) / +0xC 이름 "AnimTransitTable_1.0.0" /
    hdrEnd: u32 tableOff, u32 count / 문자열 풀 / tableOff 부터 16 B 항목 {u32 fromOff, u32 toOff, u32 a, u32 b}
    (오프셋 = 파일 절대, 0 = 이름 없음). a·b 의미 미확정(관측 a 0~0x5a, b 0/8/15)."""
    hdr_end, nlen = struct.unpack_from("<II", b, 4)
    name = b[12:12 + nlen].decode("ascii")
    toff, cnt = struct.unpack_from("<II", b, hdr_end)
    ents = []
    for i in range(cnt):
        fo, to, a, bb = struct.unpack_from("<IIII", b, toff + i * 16)
        ents.append({"from": cstr(b, fo) if fo else None, "to": cstr(b, to) if to else None, "a": a, "b": bb})
    return {"magic": "mpbs", "name": name, "count": cnt, "size": len(b), "tail": len(b) - (toff + cnt * 16), "entries": ents}


def parse(b):
    if b[:4] == b"mpbs":
        return parse_mpbs(b)
    if b[:4] != b"tapm":
        raise ValueError("not tapm")
    ver, toff, cnt, h18, h20 = struct.unpack_from("<IQQqQ", b, 4)
    def table(off, n):
        out = []
        for i in range(n):
            fo, to, a, bb, c, d, x, e = struct.unpack_from("<QQIifIqq", b, off + i * 0x30)
            out.append({"from": cstr(b, fo), "to": cstr(b, to), "a": a, "b": bb, "c": c, "d": d, "x": x, "e": e})
        return out

    ents = table(toff, cnt)
    ents2 = table(h18, h20) if h18 != -1 else []
    end = max(toff + cnt * 0x30, h18 + h20 * 0x30 if h18 != -1 else 0)
    return {"version": ver, "count": cnt, "table2_off": h18, "table2_count": h20, "size": len(b), "tail": len(b) - end, "entries": ents, "entries2": ents2}


def main():
    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        paths = sorted((ROOT / "extracted/bea/bq.nx.bea/chara/mpat").glob("*.mpat"))
        out = {p.name: parse(p.read_bytes()) for p in paths}
        dst = ROOT / "extracted/converted/scene/mpat.json"
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print(len(out), "files ->", dst)
        return
    for p in paths:
        print(p, json.dumps(parse(p.read_bytes()), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
