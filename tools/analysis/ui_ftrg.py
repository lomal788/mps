"""FTRG(.ftrg, BEA 타입 _FXTRIG) 파서 — FX 트리거(사운드·파티클·진동·애니·프로그램 이벤트) 정의.

구조 [판독 main FUN_7101110450 등 + 데이터]:
  헤더 0x00 'FTRG', 0x04 BOM FFFE, 0x06 u16 0x14, 0x08 u32 버전(0x021A0000; 로더는 0x02180000~0x021A0000 허용),
       0x0C u32 파일 크기, 0x10 u32 섹션 수, 0x14 섹션표 {u16 id(0x9000), u16 'EF', u32 오프셋, u32 크기}.
  DATA 섹션(id 0x9000): +8 = 루트 슬롯.
  슬롯 = {u32 종류, s32 오프셋}. 대상 주소 = (슬롯을 가진 객체의 시작) + 오프셋.
    배열 원소는 엔트리 자체가 객체이므로 엔트리 주소 + 오프셋.
  배열 = u32 개수 + {u32 원소 타입 ID(0x91xx), s32 오프셋}×개수.
  객체 = 타입 ID 별 고정 레이아웃(원시 u32/f32 + 슬롯). 레이아웃은 이 도구가 관측으로 만든다(LAYOUTS).
  속성 = {슬롯(0x1F01) 이름, 슬롯(값 종류) 값}. 값 종류 하위 바이트: 1 정수?, 2 f32, 3 문자열, 4 열거(문자열), 9 ?.

사용:
  ui_ftrg.py dump <x.ftrg>...  [--out dir]   객체 트리 JSON
  ui_ftrg.py survey <x.ftrg>...              타입별 레이아웃 관측 통계
  ui_ftrg.py find <키> <x.ftrg>...           트리거 키로 찾기
"""
import json
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path

SLOT_KINDS = {0x0100, 0x1F01, 0x0400, 0x0403, 0x0201, 0x0202, 0x0203, 0x0204, 0x0209, 0x0101, 0x0102,
              0x0103, 0x0104, 0x0301, 0x0401, 0x0402, 0x0404, 0x0405, 0x0409}
STRING_KINDS = {0x1F01, 0x0203, 0x0204}


class Ftrg:
    def __init__(self, b, name=""):
        self.b = b
        self.name = name
        if b[:4] != b"FTRG":
            raise ValueError("not FTRG")
        self.version = struct.unpack_from("<I", b, 8)[0]
        self.size = struct.unpack_from("<I", b, 0xC)[0]
        n = struct.unpack_from("<I", b, 0x10)[0]
        self.sections = []
        for i in range(n):
            sid, tag, off, sz = struct.unpack_from("<HHII", b, 0x14 + i * 12)
            self.sections.append({"id": sid, "tag": tag, "offset": off, "size": sz, "magic": b[off:off + 4].decode("ascii", "replace")})
        d = self.sections[0]
        self.data_off = d["offset"]
        self.data_end = d["offset"] + d["size"]
        self.layout_obs = defaultdict(list)

    def u32(self, o):
        return struct.unpack_from("<I", self.b, o)[0]

    def cstr(self, o):
        e = self.b.index(b"\0", o)
        raw = self.b[o:e]
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            return raw.decode("cp932", "replace")

    def is_slot(self, base, o):
        if o + 8 > self.data_end:
            return False
        k, off = struct.unpack_from("<Ii", self.b, o)
        if k not in SLOT_KINDS:
            return False
        t = base + off
        if not (self.data_off <= t < self.data_end and t > o):
            return False
        if k in STRING_KINDS:
            e = self.b.find(b"\x00", t)
            return e >= 0 and all(c >= 0x20 or c in (9, 10, 13) for c in self.b[t:e])
        if k == 0x0100:
            # 대상은 배열(개수 + 0x91xx 원소 또는 속성 쌍)이어야 한다
            if t + 4 > self.data_end:
                return False
            n = self.u32(t)
            if n == 0:
                return True
            if n > 100000 or t + 12 > self.data_end:
                return False
            k2 = self.u32(t + 4)
            return k2 >> 8 == 0x91 or k2 == 0x1F01
        return True

    def array(self, o, depth):
        n = self.u32(o)
        if n > 100000:
            return {"_bad_array": n}
        out = []
        for i in range(n):
            e = o + 4 + i * 8
            tid, off = struct.unpack_from("<Ii", self.b, e)
            if tid >> 8 == 0x91:
                out.append(self.obj(tid, e + off, depth + 1))
            else:
                out.append({"_elem": hex(tid), "_off": off})
        return out

    def value(self, kind, t, depth):
        if kind in STRING_KINDS:
            return self.cstr(t)
        if kind == 0x0202:
            return round(struct.unpack_from("<f", self.b, t)[0], 6)
        if kind in (0x0201, 0x0209, 0x0101):
            return self.u32(t)
        if kind == 0x0100:
            n = self.u32(t)
            if 0 < n < 10000 and self.u32(t + 4) >> 8 == 0x91:
                return self.array(t, depth)
            if 0 < n < 10000 and self.u32(t + 4) == 0x1F01:
                pr = parse_props(self, t)
                if pr is not None:
                    return {"_props": pr}
            if n == 0:
                return []
            return {"_raw": self.b[t:t + 16].hex()}
        return {"_kind": hex(kind), "_raw": self.b[t:t + 8].hex()}

    def obj(self, tid, base, depth=0):
        """고정부 = 시작부터 가장 앞 대상 주소 전까지. 그 안에서 슬롯/원시값을 가른다."""
        if depth > 12:
            return {"_type": hex(tid), "_depth": True}
        o = base
        targets = []
        fields = []
        limit = self.data_end
        while o + 4 <= limit:
            if self.is_slot(base, o):
                k, off = struct.unpack_from("<Ii", self.b, o)
                targets.append(base + off)
                limit = min(limit, base + off)
                fields.append(("slot", o - base, k, base + off))
                o += 8
            else:
                fields.append(("raw", o - base, self.u32(o)))
                o += 4
        res = {"_type": hex(tid), "_at": hex(base)}
        layout = []
        for f in fields:
            if f[0] == "slot":
                _, rel, k, t = f
                layout.append(f"S{rel:x}:{k:x}")
                res[f"+{rel:02x}"] = self.value(k, t, depth)
            else:
                _, rel, v = f
                layout.append(f"R{rel:x}")
                fv = struct.unpack("<f", struct.pack("<I", v))[0]
                if tid == 0x9100 and rel == 0x50:
                    res["+50"] = f"{v:#010x}"  # 루트 +0x50 = u32 해시 [데이터: 파일마다 다름]
                    continue
                res[f"+{rel:02x}"] = v if v < 0x10000 or v >= 0xFFFF0000 else (round(fv, 6) if 1e-6 < abs(fv) < 1e7 else hex(v))
        self.layout_obs[tid].append(tuple(layout))
        return res

    def root(self):
        o = self.data_off + 8
        k, off = struct.unpack_from("<Ii", self.b, o)
        return self.array(o + off, 0)


def iter_objs(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from iter_objs(v)
    elif isinstance(node, list):
        for v in node:
            yield from iter_objs(v)


def parse_props(f, base):
    """속성 배열 = u32 개수 + {슬롯 이름, 슬롯 값}×개수 (16B 원소, 원소 기준 오프셋)."""
    n = f.u32(base)
    out = {}
    for i in range(n):
        e = base + 4 + i * 16
        k1, o1, k2, o2 = struct.unpack_from("<IiIi", f.b, e)
        if k1 != 0x1F01:
            return None
        name = f.cstr(e + o1)
        out[name] = f.value(k2, e + o2, 0)
    return out


KIND = {0: "SE", 1: "FX", 2: "VB"}


def triggers(tree):
    """루트(0x9100)의 SE(+10)·FX(+18)·VB(+20) 트리거와 애니 프레임 이벤트(+40)를 표로 뽑는다.
    0x9101 레이아웃 [데이터: 1,547개 파일 관측]:
      SE/FX: +00 u32 종류, +14 키, +34 훅(본/로케이터), +3C 경로 접두, +44 속성, +50 자원[0x9105{이름, f32}]
      VB   : +00 u32 종류(2), +10..+2C f32 쌍, +30 키, +50 속성, +5C 자원[0x9105{bnvib 경로, f32}]"""
    root = tree[0]
    rows = []
    for slot in ("+10", "+18", "+20"):
        for t in root.get(slot, []) or []:
            kind = t.get("+00")
            if slot == "+20":
                key, props, res, hook = t.get("+30"), t.get("+50"), t.get("+5c"), ""
            else:
                key, props, res, hook = t.get("+14"), t.get("+44"), t.get("+50"), t.get("+34", "")
            props = props.get("_props", {}) if isinstance(props, dict) else {}
            rows.append({"slot": slot, "kind": KIND.get(kind, kind), "key": key, "hook": hook,
                         "pathPrefix": t.get("+3c", "") if slot != "+20" else "",
                         "resources": [(r.get("+00"), r.get("+08")) for r in (res or []) if isinstance(r, dict)],
                         "group": props.get("ParentGroupPath", ""), "props": props})
    events = []
    for a in root.get("+40", []) or []:
        props = a.get("+28", {})
        props = props.get("_props", {}) if isinstance(props, dict) else {}
        for k in a.get("+1c", []) or []:
            events.append({"motion": a.get("+00"), "anim": a.get("+08"), "key": k.get("+00"), "frame": k.get("+08"),
                           "flags": [k.get("+0c"), k.get("+10"), k.get("+14"), k.get("+18")],
                           "animLength": props.get("AnimationLength")})
    return rows, events


def load(path):
    b = Path(path).read_bytes()
    f = Ftrg(b, str(path))
    return f, f.root()


def scan_props(f):
    """파일 전체에서 속성 배열(개수 + (0x1F01 이름, 값) 쌍)을 찾아 낸다(객체 레이아웃과 무관하게)."""
    b = f.b
    found = []
    o = f.data_off + 8
    while o + 20 <= f.data_end:
        n = struct.unpack_from("<I", b, o)[0]
        if 0 < n < 64:
            k1, o1, k2, o2 = struct.unpack_from("<IiIi", b, o + 4)
            if k1 == 0x1F01 and (k2 & 0xFF00) == 0x0200 and 0 < o1 < 0x10000:
                p = parse_props(f, o)
                if p:
                    found.append((o, p))
                    o += 4 + n * 16
                    continue
        o += 4
    return found


def main():
    cmd = sys.argv[1]
    args = [a for a in sys.argv[2:] if not a.startswith("--")]
    if "--list" in sys.argv:
        lst = Path(sys.argv[sys.argv.index("--list") + 1])
        args = [a for a in args if Path(a) != lst] + [l.strip() for l in lst.read_text().splitlines() if l.strip()]
    out_dir = None
    if "--out" in sys.argv:
        out_dir = Path(sys.argv[sys.argv.index("--out") + 1])
        args = [a for a in args if a != str(out_dir) and Path(a) != out_dir]
    if cmd == "dump":
        for p in args:
            f, tree = load(p)
            d = {"file": p, "version": hex(f.version), "sections": f.sections, "root": tree,
                 "properties": [{"at": hex(o), "props": pr} for o, pr in scan_props(f)]}
            s = json.dumps(d, ensure_ascii=False, indent=1)
            if out_dir:
                out_dir.mkdir(parents=True, exist_ok=True)
                (out_dir / (Path(p).stem + ".json")).write_text(s, encoding="utf-8")
                print(p, len(s))
            else:
                print(s)
    elif cmd == "survey":
        lay = defaultdict(Counter)
        versions = Counter()
        bad = []
        for p in args:
            try:
                f, tree = load(p)
            except Exception as e:  # noqa: BLE001
                bad.append(f"{p}: {e}")
                continue
            versions[hex(f.version)] += 1
            for tid, ls in f.layout_obs.items():
                for l in ls:
                    lay[tid][l] += 1
        print("versions", dict(versions), "bad", len(bad), bad[:5])
        for tid in sorted(lay):
            print(f"type {tid:#x}: {sum(lay[tid].values())} objs, {len(lay[tid])} layouts")
            for l, c in lay[tid].most_common(4):
                print(f"   x{c}: {' '.join(l)[:300]}")
    elif cmd == "collect":
        # collect <정규식> --list 목록 [--out 파일.json]: 키·그룹·자원·모션 이름이 정규식에 맞는 트리거와 애니 이벤트
        import re
        rx = re.compile(args[0], re.I)
        out = {"pattern": args[0], "triggers": [], "animEvents": []}
        for p in args[1:]:
            if not rx.search(Path(p).read_bytes().decode("latin-1")) and not rx.search(Path(p).read_bytes().decode("utf-8", "ignore")):
                continue
            f, tree = load(p)
            rows, events = triggers(tree)
            for r in rows:
                if rx.search(json.dumps([r["key"], r["group"], r["resources"]], ensure_ascii=False)):
                    out["triggers"].append({"file": p, **{k: v for k, v in r.items() if k != "props"},
                                            "props": {k: v for k, v in r["props"].items() if v not in ("", 0.0, "none")}})
            for e in events:
                if rx.search(json.dumps([e["motion"], e["key"]], ensure_ascii=False)):
                    out["animEvents"].append({"file": p, **e})
        s = json.dumps(out, ensure_ascii=False, indent=1)
        if out_dir:
            out_dir.parent.mkdir(parents=True, exist_ok=True)
            out_dir.write_text(s, encoding="utf-8")
        print(f"triggers {len(out['triggers'])} animEvents {len(out['animEvents'])}")
    elif cmd == "find":
        key = args[0]
        for p in args[1:]:
            b = Path(p).read_bytes()
            if key.encode() not in b:
                continue
            f, tree = load(p)
            for o in iter_objs(tree):
                if any(isinstance(v, str) and v == key for v in o.values()):
                    print(p)
                    print(json.dumps(o, ensure_ascii=False, indent=1)[:4000])


if __name__ == "__main__":
    main()
