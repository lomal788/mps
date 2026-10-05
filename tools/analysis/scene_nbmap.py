"""BEEGENTY(.nbmap, BEA 타입 _ENTITY) 엔티티 배치 파서.

구조(LE, 오프셋은 파일 절대값):
  헤더  +0x00 'BEEGENTY' / +0x08 u32 version(0x000C0000) / +0x0C u16 BOM FFFE / +0x0E u8 alignment(3)
        +0x16 u16 첫 블록 오프셋(0x38) / +0x18 u32 _RLT 오프셋 / +0x1C u32 파일 크기
        +0x20 u64 루트 엔티티 포인터 배열 / +0x28 u64 루트 수
  ENTY  +0x00 'ENTY' / +0x04 u32 블록 크기 / +0x08 u64 블록 크기 / +0x10 GUID[16]
        +0x20 u64 이름(문자열 포인터) / +0x28 u64 슬롯 배열 포인터(= ENTY+0x48) / +0x30 u64 / +0x38 u64
        +0x40 u8 슬롯 수, u8 flagA, u8 flagB, u8 flagC / +0x44 u32 / +0x48 u64 슬롯[슬롯 수] → 컴포넌트
  컴포넌트  첫 u32 = 타입 코드
        0 트랜스폼(0x30): u32 0, f32 pos[3], f32 quat[4](x,y,z,w), f32 scale[3], u32 pad
        1 모델(0x90):    u32 1, u32 0, u64 모델 경로, u64 문자열2, f32[] 나머지(의미 미확정)
        2 충돌(0x18):    u32 2, u32 0, u64 .apx 경로, u8[4] 속성, u32 0
        5 (0x20):        u32 5, f32[7] (의미 미확정)
        7 자식(0x18+):   u32 7, u32 0, u64 자식 포인터 배열, u64 자식 수
        8 경로(가변):    u32 8, u32 0, u64 구간 배열, u64 구간 수, 구간 = {u64 점 배열, u64 ?, u64 점 수}
  _STR  문자열 풀: u16 길이 + 바이트 + NUL. 포인터는 길이 필드를 가리킨다.
  _RLT  재배치 표(파서는 쓰지 않는다)

사용: python web/tools/analysis/scene_nbmap.py <nbmap...> [--out <dir>]
      python web/tools/analysis/scene_nbmap.py --all   (extracted/bea 아래 250개 → extracted/converted/scene/nbmap/, 통계 출력)
"""
import argparse
import json
import struct
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "extracted/converted/scene/nbmap"


class Nbmap:
    def __init__(self, b):
        if b[:8] != b"BEEGENTY":
            raise ValueError("not BEEGENTY")
        self.b = b
        self.version = struct.unpack_from("<I", b, 8)[0]
        self.rlt, self.size = struct.unpack_from("<II", b, 0x18)
        self.seen = {}

    def u32(self, o):
        return struct.unpack_from("<I", self.b, o)[0]

    def u64(self, o):
        return struct.unpack_from("<Q", self.b, o)[0]

    def f32(self, o, n):
        return [round(x, 6) for x in struct.unpack_from("<%df" % n, self.b, o)]

    def s(self, o):
        if o == 0:
            return None
        n = struct.unpack_from("<H", self.b, o)[0]
        return self.b[o + 2:o + 2 + n].decode("utf-8")

    def comp(self, o):
        t = self.u32(o)
        c = {"type": t, "offset": o}
        if t == 0:
            c["kind"] = "transform"
            c["pos"] = self.f32(o + 4, 3)
            c["quat"] = self.f32(o + 0x10, 4)
            c["scale"] = self.f32(o + 0x20, 3)
        elif t == 1:
            c["kind"] = "model"
            c["model"] = self.s(self.u64(o + 8))
            c["str2"] = self.s(self.u64(o + 0x10))
            c["floats"] = self.f32(o + 0x18, 30)
        elif t == 2:
            c["kind"] = "collision"
            c["apx"] = self.s(self.u64(o + 8))
            c["attr"] = list(self.b[o + 0x10:o + 0x14])
        elif t == 5:
            c["kind"] = "type5"
            c["floats"] = self.f32(o + 4, 7)
        elif t == 7:
            c["kind"] = "children"
            p, n = self.u64(o + 8), self.u64(o + 0x10)
            c["children"] = [self.entity(self.u64(p + 8 * i)) for i in range(n)]
        elif t == 8:
            c["kind"] = "path"
            p, n = self.u64(o + 8), self.u64(o + 0x10)
            segs = []
            for i in range(n):
                a, bb, cnt = struct.unpack_from("<QQQ", self.b, p + 0x18 * i)
                segs.append({"points_off": a, "aux_off": bb, "count": cnt})
            c["segments"] = segs
        else:
            c["kind"] = "unknown"
            c["raw"] = self.b[o:o + 0x20].hex()
        return c

    def entity(self, o):
        if o in self.seen:
            return {"ref": o}
        b = self.b
        if b[o:o + 4] != b"ENTY":
            raise ValueError(f"no ENTY @0x{o:x}")
        self.seen[o] = True
        n, fa, fb, fc = b[o + 0x40:o + 0x44]
        e = {
            "offset": o,
            "name": self.s(self.u64(o + 0x20)),
            "guid": b[o + 0x10:o + 0x20].hex(),
            "flags": [fa, fb, fc],
            "h30": [self.u64(o + 0x30), self.u64(o + 0x38)],
            "components": [self.comp(self.u64(o + 0x48 + 8 * i)) for i in range(n)],
        }
        return e

    def parse(self):
        rp, rn = self.u64(0x20), self.u64(0x28)
        return {"version": self.version, "size": self.size, "roots": [self.entity(self.u64(rp + 8 * i)) for i in range(rn)]}


def walk(e, depth=0):
    yield e, depth
    for c in e.get("components", []):
        for ch in c.get("children", []):
            yield from walk(ch, depth + 1)


def summary(doc):
    lines = []
    for r in doc["roots"]:
        for e, d in walk(r):
            if "ref" in e:
                continue
            parts = []
            for c in e["components"]:
                k = c["kind"]
                if k == "transform":
                    parts.append("T pos=%s q=%s s=%s" % (c["pos"], c["quat"], c["scale"]))
                elif k == "model":
                    parts.append("M %s" % c["model"])
                elif k == "collision":
                    parts.append("C %s attr=%s" % (c["apx"], c["attr"]))
                elif k == "children":
                    parts.append("children=%d" % len(c["children"]))
                elif k == "path":
                    parts.append("path segs=%s" % [s["count"] for s in c["segments"]])
                else:
                    parts.append("%s %s" % (k, c.get("floats", c.get("raw"))))
            lines.append("%s%s [%s]" % ("  " * d, e["name"], "; ".join(parts)))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args()
    paths = [Path(p) for p in a.files]
    if a.all:
        paths = sorted((ROOT / "extracted/bea").glob("*/**/*.nbmap"))
    out = Path(a.out) if a.out else OUT
    stats = Counter()
    attrs = Counter()
    flags = Counter()
    for p in paths:
        doc = Nbmap(p.read_bytes()).parse()
        doc["source"] = str(p.relative_to(ROOT / "extracted/bea")).replace("\\", "/") if (ROOT / "extracted/bea") in p.parents else str(p)
        for r in doc["roots"]:
            for e, _ in walk(r):
                if "ref" in e:
                    continue
                stats["entity"] += 1
                flags[tuple(e["flags"])] += 1
                for c in e["components"]:
                    stats[c["kind"]] += 1
                    if c["kind"] == "collision":
                        attrs[tuple(c["attr"])] += 1
        if a.all or a.out:
            out.mkdir(parents=True, exist_ok=True)
            arc = p.parts[len((ROOT / "extracted/bea").parts)] if (ROOT / "extracted/bea") in p.parents else "x"
            stem = arc.replace(".nx.bea", "") + "__" + p.stem
            (out / (stem + ".json")).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
            (out / (stem + ".txt")).write_text(summary(doc) + "\n", encoding="utf-8")
        else:
            print("#", p)
            print(summary(doc))
    if a.all:
        print(len(paths), "files ->", out)
        print("counts", dict(stats))
        print("collision attr", attrs.most_common(20))
        print("entity flags", flags.most_common(20))


if __name__ == "__main__":
    main()
