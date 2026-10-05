"""MSBP(MsgPrjBn, LibMessageStudio 프로젝트) → 제어 태그·색·속성·스타일 표.

bq.msbp 섹션(v4): CLR1 색, CLB1 색 이름, ATI2/ALB1/ALI2 속성, TGG2 태그 그룹, TAG2 태그, TGP2 태그 파라미터,
TGL2 파라미터 목록 항목, SYL3 스타일, SLB1 스타일 이름, CTI1 원본 파일 목록.
msbt 의 제어 태그 [group:tag:params] 를 이름·파라미터 형식으로 풀어 쓰는 데 쓴다.
style.mstl(로캘별): u32 개수 + 0x40B 레코드 — SYL3 와 같은 순서 [데이터: 개수 일치].

사용:
  ui_msbp.py <bq.msbp> <out.json> [style.mstl] [msbt json 폴더(태그 사용 통계)]
"""
import json
import struct
import sys
from collections import Counter
from pathlib import Path

PTYPE = {0: "u8", 1: "u16", 2: "u32", 3: "s8", 4: "s16", 5: "s32", 6: "f32", 7: "f64?", 8: "string", 9: "list"}
PSIZE = {0: 1, 1: 2, 2: 4, 3: 1, 4: 2, 5: 4, 6: 4, 9: 1}


def sections(b):
    n = struct.unpack_from("<H", b, 0xE)[0]
    o = 0x20
    for _ in range(n):
        mg = b[o:o + 4].decode()
        sz = struct.unpack_from("<I", b, o + 4)[0]
        yield mg, o + 0x10, sz
        o += 0x10 + (sz + 15 & ~15)


def cstr(b, o):
    e = b.index(b"\0", o)
    return b[o:e].decode("utf-8")


def hash_labels(b, o):
    """LMS 해시 표: u32 버킷 수, (u32 개수, u32 오프셋)×버킷, 항목 = u8 길이 + 이름 + u32 인덱스."""
    nb = struct.unpack_from("<I", b, o)[0]
    out = {}
    for i in range(nb):
        cnt, off = struct.unpack_from("<II", b, o + 4 + i * 8)
        p = o + off
        for _ in range(cnt):
            ln = b[p]
            name = b[p + 1:p + 1 + ln].decode("utf-8")
            idx = struct.unpack_from("<I", b, p + 1 + ln)[0]
            out[idx] = name
            p += 1 + ln + 4
    return [out.get(i) for i in range(max(out) + 1)] if out else []


def offs16(b, o):
    """u16 개수, u16 패딩, u32 오프셋[] (섹션 데이터 기준)."""
    n = struct.unpack_from("<H", b, o)[0]
    return list(struct.unpack_from(f"<{n}I", b, o + 4))


def parse(b):
    if b[:8] != b"MsgPrjBn":
        raise ValueError("not MSBP")
    s = {mg: (o, sz) for mg, o, sz in sections(b)}
    out = {"version": b[0xD]}
    o, _ = s["CLR1"]
    n = struct.unpack_from("<I", b, o)[0]
    cols = ["#" + b[o + 4 + i * 4:o + 8 + i * 4].hex() for i in range(n)]
    names = hash_labels(b, s["CLB1"][0])
    out["colors"] = [{"index": i, "name": names[i] if i < len(names) else None, "rgba": c} for i, c in enumerate(cols)]

    # 속성
    o, _ = s["ATI2"]
    n = struct.unpack_from("<I", b, o)[0]
    ati = [struct.unpack_from("<BBHI", b, o + 4 + i * 8) for i in range(n)]
    anames = hash_labels(b, s["ALB1"][0])
    lo, _ = s["ALI2"]
    nl = struct.unpack_from("<I", b, lo)[0]
    lists = []
    for i in range(nl):
        lp = lo + struct.unpack_from("<I", b, lo + 4 + i * 4)[0]
        ni = struct.unpack_from("<I", b, lp)[0]
        lists.append([cstr(b, lp + x) for x in struct.unpack_from(f"<{ni}I", b, lp + 4)])
    out["attributes"] = []
    for i, (typ, pad, li, off) in enumerate(ati):
        a = {"index": i, "name": anames[i] if i < len(anames) else None, "type": PTYPE.get(typ, typ), "offset": off}
        if typ == 9:
            a["items"] = lists[li]
        out["attributes"].append(a)

    # 태그
    go, _ = s["TGG2"]
    to, _ = s["TAG2"]
    po, _ = s["TGP2"]
    io, _ = s["TGL2"]
    items = [cstr(b, io + x) for x in offs16(b, io)]
    params = []
    for x in offs16(b, po):
        p = po + x
        typ = b[p]
        if typ == 9:
            n = struct.unpack_from("<H", b, p + 2)[0]
            idx = struct.unpack_from(f"<{n}H", b, p + 4)
            params.append({"type": "list", "items": [items[i] for i in idx], "name": cstr(b, p + 4 + n * 2)})
        else:
            params.append({"type": PTYPE.get(typ, typ), "name": cstr(b, p + 1)})
    tags = []
    for x in offs16(b, to):
        p = to + x
        n = struct.unpack_from("<H", b, p)[0]
        idx = struct.unpack_from(f"<{n}H", b, p + 2)
        tags.append({"name": cstr(b, p + 2 + n * 2), "params": [params[i] for i in idx]})
    groups = []
    for x in offs16(b, go):
        p = go + x
        gid, n = struct.unpack_from("<HH", b, p)
        idx = struct.unpack_from(f"<{n}H", b, p + 4)
        g = {"id": gid, "name": cstr(b, p + 4 + n * 2), "tags": []}
        for t_local, ti in enumerate(idx):
            t = dict(tags[ti])
            t["tag"] = t_local
            t["globalIndex"] = ti
            t["paramBytes"] = param_bytes(t["params"])
            g["tags"].append(t)
        groups.append(g)
    out["tagGroups"] = groups

    # 스타일
    o, _ = s["SYL3"]
    n = struct.unpack_from("<I", b, o)[0]
    snames = hash_labels(b, s["SLB1"][0])
    styles = []
    for i in range(n):
        w, lines, font, color = struct.unpack_from("<iiii", b, o + 4 + i * 16)
        styles.append({"index": i, "name": snames[i] if i < len(snames) else None, "regionWidth": w,
                       "lineNum": lines, "fontIndex": font, "baseColorIndex": color})
    out["styles"] = styles
    o, _ = s["CTI1"]
    n = struct.unpack_from("<I", b, o)[0]
    out["sourceFiles"] = [cstr(b, o + x) for x in struct.unpack_from(f"<{n}I", b, o + 4)]
    return out


def param_bytes(ps):
    t = 0
    for p in ps:
        if p["type"] == "string":
            return None
        t += PSIZE.get({v: k for k, v in PTYPE.items()}.get(p["type"], -1), 0) if p["type"] != "list" else 1
    return t


def parse_mstl(b):
    n = struct.unpack_from("<I", b, 0)[0]
    if 4 + n * 0x40 != len(b):
        raise ValueError(f"mstl size mismatch {n}")
    out = []
    for i in range(n):
        r = b[4 + i * 0x40:4 + (i + 1) * 0x40]
        u = struct.unpack_from("<16I", r)
        f = struct.unpack_from("<16f", r)
        out.append({"u32": list(u), "rgba@0x08": "#" + r[8:12].hex(), "f32@0x18": round(f[6], 4), "f32@0x1C": round(f[7], 4),
                    "f32@0x20": round(f[8], 4), "f32@0x24": round(f[9], 4), "f32@0x38": round(f[14], 4)})
    return out


def usage(msg_dir, groups):
    """msbt JSON 의 [g:t:hex] 사용 횟수와 예시."""
    import re
    cnt = Counter()
    ex = {}
    rx = re.compile(r"\[(\d+):(\d+)(?::([0-9a-f]+))?\]")
    for p in Path(msg_dir).glob("*.json"):
        d = json.loads(p.read_text(encoding="utf-8"))
        for k, v in d.items():
            for m in rx.finditer(v):
                key = (int(m.group(1)), int(m.group(2)))
                cnt[key] += 1
                ex.setdefault(key, []).append(f"{p.stem}:{k} {m.group(0)}") if len(ex.get(key, [])) < 3 else None
    return cnt, ex


def decode_params(tag, hexs):
    raw = bytes.fromhex(hexs or "")
    out = []
    p = 0
    for prm in tag["params"]:
        t = prm["type"]
        if p >= len(raw) or (t not in ("string", "list") and p + PSIZE[{v: k for k, v in PTYPE.items()}[t]] > len(raw)):
            out.append((prm["name"], "<생략>"))
            continue
        if t == "string":
            n = struct.unpack_from("<H", raw, p)[0]
            out.append((prm["name"], raw[p + 2:p + 2 + n].decode("utf-16-le", "replace")))
            p += 2 + n
            continue
        if t == "list":
            v = raw[p]
            out.append((prm["name"], prm["items"][v] if v < len(prm["items"]) else v))
            p += 1
            continue
        fmt = {"u8": "B", "u16": "H", "u32": "I", "s8": "b", "s16": "h", "s32": "i", "f32": "f"}[t]
        v = struct.unpack_from("<" + fmt, raw, p)[0]
        out.append((prm["name"], v))
        p += struct.calcsize(fmt)
    return out


if __name__ == "__main__":
    b = Path(sys.argv[1]).read_bytes()
    d = parse(b)
    if len(sys.argv) > 3 and sys.argv[3] != "-":
        st = parse_mstl(Path(sys.argv[3]).read_bytes())
        d["mstl_count"] = len(st)
        d["mstl_sample"] = st[:8]
        d["mstl_matches_syl3"] = len(st) == len(d["styles"])
    if len(sys.argv) > 4:
        cnt, ex = usage(sys.argv[4], d["tagGroups"])
        gmap = {g["id"]: g for g in d["tagGroups"]}
        rows = []
        for (g, t), c in sorted(cnt.items()):
            grp = gmap.get(g)
            tag = grp["tags"][t] if grp and t < len(grp["tags"]) else None
            dec = []
            for e in ex[(g, t)]:
                h = e.split(":")[-1].rstrip("]") if e.count(":") >= 3 else ""
                try:
                    dec.append(decode_params(tag, h) if tag else None)
                except Exception as err:  # noqa: BLE001
                    dec.append(f"ERR {err}")
            rows.append({"group": g, "tag": t, "groupName": grp and grp["name"], "tagName": tag and tag["name"],
                         "count": c, "examples": ex[(g, t)], "decoded": dec})
        d["usage"] = rows
    Path(sys.argv[2]).parent.mkdir(parents=True, exist_ok=True)
    Path(sys.argv[2]).write_text(json.dumps(d, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    for g in d["tagGroups"]:
        print(f"group {g['id']} {g['name']}")
        for t in g["tags"]:
            ps = ", ".join(f"{p['name']}:{p['type']}" + (f"{p['items']}" if p['type'] == 'list' else '') for p in t["params"])
            print(f"  [{g['id']}:{t['tag']}] {t['name']}({ps}) bytes={t['paramBytes']}")
    print("colors", [(c["index"], c["name"], c["rgba"]) for c in d["colors"]])
    print("attributes", [(a["name"], a["type"], a.get("items")) for a in d["attributes"]])
    print("styles", len(d["styles"]), d["styles"][:3])
    print("sourceFiles", len(d["sourceFiles"]), d["sourceFiles"][:5])
    if "usage" in d:
        for r in d["usage"]:
            print(f"use [{r['group']}:{r['tag']}] {r['groupName']}.{r['tagName']} x{r['count']} {r['examples'][:1]} -> {r['decoded'][:1]}")
