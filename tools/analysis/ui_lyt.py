"""Jamboree UI 레이아웃(.lyt) 파서.

.lyt = SARC(ui_sarc.py) 안에 nn::ui2d 바이너리가 든 묶음이다.
  blyt/*.bflyt  레이아웃 (FLYT v9.0)
  anim/*.bflan  애니메이션 (FLAN v9.0)
  timg/__Combined.bntx  텍스처 전부
  fcpx/*.bfcpx  복합 폰트 정의 (FCPX)
필드 정의 기준: Switch-Toolbox Layout/CAFE (tools/oss/ref_ui) + 데이터 대조.
파서는 섹션마다 읽은 바이트 수가 섹션 크기와 맞는지 확인하고 어긋나면 `_check` 에 남긴다.

사용:
  ui_lyt.py dump <file.lyt> <out_dir>      SARC 안의 bflyt/bflan/bfcpx/bntx → JSON (+ 요약)
  ui_lyt.py survey <file.lyt>...            섹션·태그 통계, 파서 검증 결과만 출력
"""
import json
import struct
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import ui_sarc  # noqa: E402

ORIGIN_X = ["center", "left", "right", "?3"]
ORIGIN_Y = ["center", "top", "bottom", "?3"]
WRAP = ["clamp", "repeat", "mirror", "?3"]
FILTER = ["near", "linear", "?2", "?3"]


def cstr(b, o, n=None):
    if n is None:
        e = b.index(b"\0", o)
        return b[o:e].decode("utf-8", "replace")
    raw = b[o:o + n]
    e = raw.find(b"\0")
    return (raw if e < 0 else raw[:e]).decode("utf-8", "replace")


def rgba(b, o):
    return "#" + b[o:o + 4].hex()


def f32s(b, o, n):
    return [round(v, 6) for v in struct.unpack_from(f"<{n}f", b, o)]


class Checks(list):
    def expect(self, what, got, want):
        if got != want:
            self.append(f"{what}: got {got:#x} want {want:#x}")


# ---------------------------------------------------------------- BFLYT

def read_header(b, magic):
    if b[:4] != magic:
        raise ValueError(f"not {magic}")
    bom, hsize, ver, fsize, nsec = struct.unpack_from("<HHIIH", b, 4)
    return {"version": f"{ver >> 24}.{ver >> 16 & 0xFF}.{ver >> 8 & 0xFF}.{ver & 0xFF}", "ver": ver,
            "header_size": hsize, "file_size": fsize, "sections": nsec}


def read_strtab(b, o):
    n = struct.unpack_from("<H", b, o)[0]
    base = o + 4
    offs = struct.unpack_from(f"<{n}I", b, base)
    return [cstr(b, base + x) for x in offs]


def read_material(b, o, textures, chk, name_hint):
    p = o
    m = {"name": cstr(b, p, 0x1C)}
    p += 0x1C
    flags, unk, black, white = struct.unpack_from("<II4s4s", b, p)
    p += 16
    m["flags"] = f"{flags:#x}"
    m["unk_after_flags"] = f"{unk:#010x}"
    m["black"] = "#" + black.hex()
    m["white"] = "#" + white.hex()
    n_tex = flags & 3
    n_mtx = flags >> 2 & 3
    n_gen = flags >> 4 & 3
    n_tev = flags >> 6 & 7
    has_ac = flags >> 9 & 1
    has_blend = flags >> 10 & 1
    tex_only = flags >> 11 & 1
    has_blogic = flags >> 12 & 1
    has_ind = flags >> 14 & 1
    n_proj = flags >> 15 & 3
    has_fs = flags >> 17 & 1
    alpha_interp = flags >> 18 & 1
    has_detail = flags >> 19 & 1
    known = 0xFFEFF
    if flags & ~known:
        m["flags_unknown_bits"] = f"{flags & ~known:#x}"
    m["useTextureOnly"] = bool(tex_only)
    m["alphaInterpolation"] = bool(alpha_interp)
    tms = []
    for _ in range(n_tex):
        idx, f1, f2 = struct.unpack_from("<hBB", b, p)
        p += 4
        tms.append({"tex": textures[idx] if 0 <= idx < len(textures) else idx,
                    "wrapU": WRAP[f1 & 3], "wrapV": WRAP[f2 & 3],
                    "minFilter": FILTER[f1 >> 2 & 3], "magFilter": FILTER[f2 >> 2 & 3]})
    m["texMaps"] = tms
    srts = []
    for _ in range(n_mtx):
        tx, ty, r, sx, sy = struct.unpack_from("<5f", b, p)
        p += 20
        srts.append({"t": [tx, ty], "r": r, "s": [sx, sy]})
    m["texSrt"] = srts
    gens = []
    for _ in range(n_gen):
        gens.append({"matrix": b[p], "source": b[p + 1], "rest": b[p + 2:p + 16].hex()})
        p += 16
    m["texCoordGen"] = gens
    tevs = []
    for _ in range(n_tev):
        tevs.append({"color": b[p], "alpha": b[p + 1]})
        p += 4
    m["tev"] = tevs
    if has_ac:
        func, ref = struct.unpack_from("<B3xf", b, p)
        m["alphaCompare"] = {"func": func, "ref": ref}
        p += 8
    if has_blend:
        m["blend"] = {"op": b[p], "src": b[p + 1], "dst": b[p + 2], "logic": b[p + 3]}
        p += 4
    if has_blogic:
        m["blendLogic"] = {"op": b[p], "src": b[p + 1], "dst": b[p + 2], "logic": b[p + 3]}
        p += 4
    if has_ind:
        m["indirect"] = f32s(b, p, 3)
        p += 12
    projs = []
    for _ in range(n_proj):
        projs.append({"pos": f32s(b, p, 2), "scale": f32s(b, p + 8, 2), "flags": struct.unpack_from("<I", b, p + 16)[0]})
        p += 20
    if projs:
        m["projTexGen"] = projs
    if has_fs:
        m["fontShadow"] = {"black": rgba(b, p), "white": rgba(b, p + 4)}
        p += 8
    if has_detail:
        # bit19: 상세 컴바이너 [추정] — 머리 0x1C(정보 u32 + 상수색 5개 + u32) + 단계마다 0x10 (관측 1건, tev 1)
        info = struct.unpack_from("<I", b, p)[0]
        consts = [rgba(b, p + 4 + i * 4) for i in range(5)]
        stages = [b[p + 0x1C + i * 16:p + 0x1C + i * 16 + 16].hex() for i in range(n_tev)]
        m["detailedCombiner"] = {"info": info, "constColors": consts, "tail": b[p + 0x18:p + 0x1C].hex(), "stages": stages}
        p += 0x1C + 0x10 * n_tev
    m["_size"] = p - o
    return m


def read_pane(b, o):
    """pan1 공통 0x4C 바이트 (섹션 헤더 8 뒤)."""
    fl, org, alpha, mag = b[o], b[o + 1], b[o + 2], b[o + 3]
    name = cstr(b, o + 4, 0x18)
    udi = cstr(b, o + 0x1C, 8)
    t = f32s(b, o + 0x24, 3)
    r = f32s(b, o + 0x30, 3)
    s = f32s(b, o + 0x3C, 2)
    w, h = f32s(b, o + 0x44, 2)
    main, par = org % 16, org // 16
    d = {"name": name, "visible": bool(fl & 1), "influencedAlpha": bool(fl & 2), "locationAdjust": bool(fl & 4),
         "flags": fl, "origin": [ORIGIN_X[main % 4], ORIGIN_Y[main // 4 % 4]],
         "parentOrigin": [ORIGIN_X[par % 4], ORIGIN_Y[par // 4 % 4]],
         "alpha": alpha, "magFlags": mag, "translate": t, "rotate": r, "scale": s, "size": [w, h]}
    if udi:
        d["userDataInfo"] = udi
    return d


def read_uvs(b, p, n):
    uvs = []
    for _ in range(n):
        uvs.append(f32s(b, p, 8))
        p += 32
    return uvs, p


def read_pic(b, sec, chk, mats):
    d = read_pane(b, sec + 8)
    p = sec + 8 + 0x4C
    d["vtxColors"] = [rgba(b, p + i * 4) for i in range(4)]
    p += 16
    mi, nuv, fl = struct.unpack_from("<HBB", b, p)
    p += 4
    d["material"] = mats[mi]["name"] if mi < len(mats) else mi
    d["materialIndex"] = mi
    d["picFlags"] = fl
    d["uvs"], p = read_uvs(b, p, nuv)
    return d, p


def read_txt(b, sec, chk, mats, fonts):
    d = read_pane(b, sec + 8)
    p = sec + 8 + 0x4C
    (tlen, tmax, mi, fi, talign, lalign, fl, unk3, italic, toff) = struct.unpack_from("<HHHHBBBBfI", b, p)
    p += 0x14
    d["textLen"] = tlen
    d["textMax"] = tmax
    d["material"] = mats[mi]["name"] if mi < len(mats) else mi
    d["font"] = fonts[fi] if fi < len(fonts) else fi
    d["textAlign"] = {"x": ORIGIN_X[talign % 4], "y": ORIGIN_Y[talign // 4 % 4]}
    d["lineAlign"] = lalign
    d["txtFlags"] = fl
    d["shadow"] = bool(fl & 1)
    d["restrictLen"] = bool(fl & 2)
    d["perCharTransform"] = bool(fl & 0x10)
    d["unk3"] = unk3
    d["italic"] = round(italic, 6)
    d["colorTop"] = rgba(b, p)
    d["colorBottom"] = rgba(b, p + 4)
    p += 8
    d["fontSize"] = f32s(b, p, 2)
    d["charSpace"], d["lineSpace"] = f32s(b, p + 8, 2)
    noff = struct.unpack_from("<I", b, p + 16)[0]
    p += 20
    d["shadowXY"] = f32s(b, p, 2)
    d["shadowSize"] = f32s(b, p + 8, 2)
    d["shadowTop"] = rgba(b, p + 16)
    d["shadowBottom"] = rgba(b, p + 20)
    d["shadowItalic"] = round(struct.unpack_from("<f", b, p + 24)[0], 6)
    pcoff = struct.unpack_from("<I", b, p + 28)[0]
    d["unk_v8"] = round(struct.unpack_from("<f", b, p + 32)[0], 6)
    p += 36
    end = p
    if toff:
        q = sec + toff
        chars = []
        while q + 1 < len(b):
            c = struct.unpack_from("<H", b, q)[0]
            if c == 0:
                break
            chars.append(c)
            q += 2
        d["text"] = "".join(chr(c) for c in chars)
        end = max(end, q + 2)
    if noff:
        d["textBoxName"] = cstr(b, sec + noff)
        end = max(end, sec + noff + len(d["textBoxName"].encode()) + 1)
    if pcoff:
        d["perCharTransformOffset"] = pcoff
    return d, None  # 가변 길이: 섹션 크기로 넘긴다


def read_wnd(b, sec, chk, mats):
    d = read_pane(b, sec + 8)
    p = sec + 8 + 0x4C
    st = struct.unpack_from("<4H", b, p)
    fe = struct.unpack_from("<4H", b, p + 8)
    nfr, wfl = b[p + 16], b[p + 17]
    coff, ftab = struct.unpack_from("<II", b, p + 20)
    d["inflation"] = {"l": st[0], "r": st[1], "t": st[2], "b": st[3]}
    d["frameSize"] = {"l": fe[0], "r": fe[1], "t": fe[2], "b": fe[3]}
    d["windowFlags"] = wfl
    q = sec + coff
    content = {"vtxColors": [rgba(b, q + i * 4) for i in range(4)]}
    mi, nuv = struct.unpack_from("<HB", b, q + 16)
    content["material"] = mats[mi]["name"] if mi < len(mats) else mi
    content["uvs"], _ = read_uvs(b, q + 20, nuv)
    d["content"] = content
    frames = []
    if nfr:
        offs = struct.unpack_from(f"<{nfr}I", b, sec + ftab)
        for fo in offs:
            mi, flip = struct.unpack_from("<HB", b, sec + fo)
            frames.append({"material": mats[mi]["name"] if mi < len(mats) else mi, "flip": flip})
    d["frames"] = frames
    return d, None


def read_prt(b, sec, chk, ver, mats, fonts, textures):
    d = read_pane(b, sec + 8)
    p = sec + 8 + 0x4C
    nprop, mx, my = struct.unpack_from("<Iff", b, p)
    p += 12
    d["magnify"] = [round(mx, 6), round(my, 6)]
    props = []
    for _ in range(nprop):
        pr = {"name": cstr(b, p, 0x18), "usage": b[p + 0x18], "basicUsage": b[p + 0x19], "materialUsage": b[p + 0x1A]}
        poff, unk, pinfo = struct.unpack_from("<III", b, p + 0x1C)
        if poff:
            mg = b[sec + poff:sec + poff + 4].decode("ascii", "replace")
            pr["override"] = mg
            if mg in ("pic1", "txt1", "wnd1"):
                sub = read_section_pane(b, sec + poff, chk, ver, mats, fonts, textures)
                pr["overrideData"] = sub
        if unk:
            pr["userDataOffset"] = unk
            if b[sec + unk:sec + unk + 4] == b"usd1":
                pr["userData"] = read_usd(b, sec + unk)
        if pinfo:
            pr["paneInfoOffset"] = pinfo
        props.append(pr)
        p += 0x28
    d["properties"] = props
    d["layoutFile"] = cstr(b, p)
    return d, None


def read_usd(b, sec):
    n = struct.unpack_from("<H", b, sec + 8)[0]
    out = {}
    for i in range(n):
        e = sec + 12 + i * 12
        noff, doff, dlen, typ, unk = struct.unpack_from("<IIHBB", b, e)
        name = cstr(b, e + noff) if noff else f"#{i}"
        if typ == 0:
            v = cstr(b, e + doff, dlen) if dlen else cstr(b, e + doff)
        elif typ == 1:
            v = list(struct.unpack_from(f"<{dlen}i", b, e + doff))
        elif typ == 2:
            v = f32s(b, e + doff, dlen)
        else:
            v = {"type": typ, "len": dlen, "raw": b[e + doff:e + doff + 16].hex()}
        out[name] = v
    return out


def read_section_pane(b, sec, chk, ver, mats, fonts, textures):
    mg = b[sec:sec + 4]
    if mg == b"pan1" or mg == b"bnd1":
        d = read_pane(b, sec + 8)
    elif mg == b"pic1":
        d, _ = read_pic(b, sec, chk, mats)
    elif mg == b"txt1":
        d, _ = read_txt(b, sec, chk, mats, fonts)
    elif mg == b"wnd1":
        d, _ = read_wnd(b, sec, chk, mats)
    elif mg == b"prt1":
        d, _ = read_prt(b, sec, chk, ver, mats, fonts, textures)
    elif mg in (b"ali1", b"scr1"):
        d = read_pane(b, sec + 8)
        size = struct.unpack_from("<I", b, sec + 4)[0]
        d["extra"] = b[sec + 8 + 0x4C:sec + size].hex()
    else:
        raise ValueError(mg)
    d = {"type": mg.decode(), **d}
    return d


def parse_bflyt(b):
    hdr = read_header(b, b"FLYT")
    chk = Checks()
    out = {"header": hdr, "textures": [], "fonts": [], "materials": [], "sectionOrder": []}
    o = hdr["header_size"]
    stack = []
    root = None
    last = None
    gstack = []
    groot = None
    glast = None
    for _ in range(hdr["sections"]):
        mg = b[o:o + 4]
        size = struct.unpack_from("<I", b, o + 4)[0]
        name = mg.decode("ascii", "replace")
        out["sectionOrder"].append(name)
        if mg == b"lyt1":
            out["layout"] = {"drawFromCenter": bool(b[o + 8]), "size": f32s(b, o + 12, 2),
                             "maxPartsSize": f32s(b, o + 20, 2), "name": cstr(b, o + 28)}
        elif mg == b"txl1":
            out["textures"] = read_strtab(b, o + 8)
        elif mg == b"fnl1":
            out["fonts"] = read_strtab(b, o + 8)
        elif mg == b"mat1":
            n = struct.unpack_from("<H", b, o + 8)[0]
            offs = list(struct.unpack_from(f"<{n}I", b, o + 12))
            bounds = offs[1:] + [size]
            for i, mo in enumerate(offs):
                m = read_material(b, o + mo, out["textures"], chk, None)
                span = bounds[i] - mo
                if m["_size"] != span:
                    chk.append(f"mat {m['name']}: parsed {m['_size']:#x} span {span:#x}")
                out["materials"].append(m)
        elif mg in (b"pan1", b"pic1", b"txt1", b"wnd1", b"bnd1", b"prt1", b"ali1", b"scr1"):
            node = read_section_pane(b, o, chk, hdr["ver"], out["materials"], out["fonts"], out["textures"])
            node["children"] = []
            if mg == b"pic1":
                end = o + 8 + 0x4C + 20 + len(node["uvs"]) * 32
                chk.expect(f"pic1 {node['name']} size", end - o, size)
            if stack:
                stack[-1]["children"].append(node)
            elif root is None:
                root = node
            else:
                chk.append(f"second root pane {node['name']}")
            last = node
        elif mg == b"pas1":
            stack.append(last)
        elif mg == b"pae1":
            stack.pop()
        elif mg == b"grp1":
            gname = cstr(b, o + 8, 34)
            n = struct.unpack_from("<H", b, o + 8 + 34)[0]
            panes = [cstr(b, o + 8 + 36 + i * 24, 24) for i in range(n)]
            chk.expect(f"grp1 {gname} size", 8 + 36 + n * 24, size)
            g = {"name": gname, "panes": panes, "children": []}
            if gstack:
                gstack[-1]["children"].append(g)
            elif groot is None:
                groot = g
            glast = g
        elif mg == b"grs1":
            gstack.append(glast)
        elif mg == b"gre1":
            gstack.pop()
        elif mg == b"usd1":
            ud = read_usd(b, o)
            if last is not None and root is not None:
                last["userData"] = ud
            else:
                out["layoutUserData"] = ud
        elif mg == b"cnt1":
            out.setdefault("controls", []).append(read_cnt(b, o, size))
        elif mg == b"ctl1":
            out.setdefault("ctl1", []).extend(read_ctl(b, o, size))
        else:
            out.setdefault("unknownSections", []).append({"magic": name, "size": size, "head": b[o + 8:o + 40].hex()})
        o += size
    chk.expect("end offset", o, hdr["file_size"])
    out["root"] = root
    out["groups"] = groot
    out["_check"] = list(chk)
    return out


def read_cnt(b, sec, size):
    """cnt1 컨트롤: 코드가 쓰는 '기능 이름' → 페인/애니 이름 표. [데이터 대조로 구조 확정, 공개 도구에 없음]
    +08 userName 오프셋, +0C 기능 페인 이름 표(24B×n), +10 u16 페인 수, +12 u16 애니 수,
    +14 페인 파라미터 이름 오프셋 표, +18 애니 파라미터 이름 오프셋 표, +1C 컨트롤 이름(인라인)."""
    user_off, pane_tbl, npane, nanim, ppar_tbl, apar_tbl = struct.unpack_from("<IIHHII", b, sec + 8)
    d = {"name": cstr(b, sec + 0x1C), "userName": cstr(b, sec + user_off)}
    panes = [cstr(b, sec + pane_tbl + i * 24, 24) for i in range(npane)]
    anims_tbl = sec + pane_tbl + npane * 24
    anims = []
    if nanim:
        offs = struct.unpack_from(f"<{nanim}I", b, anims_tbl)
        anims = [cstr(b, anims_tbl + x) for x in offs]
    pn = []
    if npane and ppar_tbl:
        offs = struct.unpack_from(f"<{npane}I", b, sec + ppar_tbl)
        pn = [cstr(b, sec + ppar_tbl + x) for x in offs]
    an = []
    if nanim and apar_tbl < size:
        offs = struct.unpack_from(f"<{nanim}I", b, sec + apar_tbl)
        an = [cstr(b, sec + apar_tbl + x) for x in offs]
    d["panes"] = {k: v for k, v in zip(pn, panes)} if pn else panes
    d["anims"] = {k: v for k, v in zip(an, anims)} if an else anims
    return d


def read_ctl(b, sec, size):
    """ctl1: (페인 A, 페인 B) 쌍 목록 [구조 데이터 확인, 의미 미확정]. 항목 0x30B:
    u32 nameA, u32 nameB (섹션 기준), 0 ×0x18, u8[8] 플래그(관측 01 0b 00 01 01 00 00 00), u32 0, f32 값."""
    n = struct.unpack_from("<I", b, sec + 8)[0]
    out = []
    for i in range(n):
        e = sec + 12 + i * 0x30
        a, bb = struct.unpack_from("<II", b, e)
        out.append({"a": cstr(b, sec + a), "b": cstr(b, sec + bb), "flags": b[e + 0x20:e + 0x28].hex(),
                    "value": round(struct.unpack_from("<f", b, e + 0x2C)[0], 6), "pad": b[e + 8:e + 0x20].hex().strip("0")})
    return out


# ---------------------------------------------------------------- BFLAN

CURVE = {0: "const", 1: "step", 2: "hermite"}


def parse_bflan(b):
    hdr = read_header(b, b"FLAN")
    chk = Checks()
    out = {"header": hdr}
    o = hdr["header_size"]
    for _ in range(hdr["sections"]):
        mg = b[o:o + 4]
        size = struct.unpack_from("<I", b, o + 4)[0]
        if mg == b"pat1":
            order, ngrp, name_off, grp_off, unk, start, end, child = struct.unpack_from("<HHIIIhhB", b, o + 8)
            out["tag"] = {"order": order, "name": cstr(b, o + name_off),
                          "groups": [cstr(b, o + grp_off + i * 28, 28) for i in range(ngrp)],
                          "start": start, "end": end, "childBinding": bool(child), "unk_v8": unk}
        elif mg == b"pai1":
            fsize, loop, ntex, nent, etab = struct.unpack_from("<HBxHHI", b, o + 8)
            out["frameSize"] = fsize
            out["loop"] = bool(loop)
            tb = o + 20
            toffs = struct.unpack_from(f"<{ntex}I", b, tb)
            out["textures"] = [cstr(b, tb + x) for x in toffs]
            eoffs = struct.unpack_from(f"<{nent}I", b, o + etab)
            ents = []
            for eo in eoffs:
                e = o + eo
                en = {"name": cstr(b, e, 28)}
                ntag, target = b[e + 28], b[e + 29]
                en["target"] = {0: "pane", 1: "material", 2: "user"}.get(target, target)
                toffs2 = struct.unpack_from(f"<{ntag}I", b, e + 32)
                tags = []
                for to in toffs2:
                    t = e + to
                    if target == 2:
                        t += 4
                    tag = {"tag": b[t:t + 4].decode("ascii", "replace")}
                    nk = b[t + 4]
                    koffs = struct.unpack_from(f"<{nk}I", b, t + 8)
                    tracks = []
                    for ko in koffs:
                        k = t + ko
                        idx, tgt, ctype = b[k], b[k + 1], b[k + 2]
                        nkey, kofs = struct.unpack_from("<HxxI", b, k + 4)
                        keys = []
                        q = k + kofs
                        for _ in range(nkey):
                            if ctype == 2:
                                keys.append(f32s(b, q, 3))
                                q += 12
                            elif ctype == 1:
                                fr, v = struct.unpack_from("<fH", b, q)
                                keys.append([round(fr, 6), v])
                                q += 8
                            else:
                                keys.append(f32s(b, q, 2))
                                q += 8
                        tracks.append({"index": idx, "target": tgt, "curve": CURVE.get(ctype, ctype), "keys": keys})
                    tag["tracks"] = tracks
                    tags.append(tag)
                en["tags"] = tags
                ents.append(en)
            out["entries"] = ents
        else:
            out.setdefault("unknownSections", []).append(mg.decode("ascii", "replace"))
        o += size
    chk.expect("end offset", o, hdr["file_size"])
    out["_check"] = list(chk)
    return out


# ---------------------------------------------------------------- FCPX / BNTX

def parse_bfcpx(b):
    """복합 폰트: 이름 목록만 뽑는다(구조는 cpx 앞부분 판독 미완)."""
    hdr = read_header(b, b"FCPX")
    names = []
    i = 0
    while True:
        j = b.find(b".bffnt", i)
        if j < 0:
            break
        k = j
        while k > 0 and 32 <= b[k - 1] < 127:
            k -= 1
        names.append(b[k:j + 6].decode())
        i = j + 6
    return {"header": hdr, "fonts": names, "raw": b[hdr["header_size"]:].hex()}


def list_bntx(b):
    """[mps] BNTX-Extractor 대신 자체 web/tools/analysis/graphics_bntx.py 사용 (mps 에는 oss/BNTX-Extractor 를 복사하지 않음)"""
    import graphics_bntx
    return [{"name": t.name, "w": t.width, "h": t.height, "format": graphics_bntx.meta(t)["format"],
             "mips": t.mips, "array": t.array} for t in graphics_bntx.parse(b)]


def list_bntx_mpj(b):
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools" / "oss" / "BNTX-Extractor"))
    import bntx_extract
    nx = bntx_extract.NXHeader("<")
    nx.data(b, 0x20)
    fmts = getattr(bntx_extract, "formats", {})
    out = []
    for i in range(nx.count):
        p = struct.unpack_from("<q", b, nx.infoPtrAddr + i * 8)[0]
        info = bntx_extract.BRTIInfo("<")
        info.data(b, p)
        n = struct.unpack_from("<H", b, info.nameAddr)[0]
        out.append({"name": b[info.nameAddr + 2:info.nameAddr + 2 + n].decode(), "w": info.width, "h": info.height,
                    "format": fmts.get(info.format_, hex(info.format_)), "mips": info.numMips,
                    "faces": info.numFaces})
    return out


# ---------------------------------------------------------------- 묶음

def tree_lines(node, depth=0, out=None):
    if out is None:
        out = []
    if node is None:
        return out
    extra = ""
    if node["type"] == "pic1":
        extra = f" mat={node['material']}"
    elif node["type"] == "txt1":
        extra = f" font={node['font']} text={node.get('text', '')!r}"
    elif node["type"] == "prt1":
        extra = f" parts={node['layoutFile']}"
    elif node["type"] == "wnd1":
        extra = f" mat={node['content']['material']}"
    t = node["translate"]
    out.append(f"{'  ' * depth}{node['type']} {node['name']} "
               f"pos=({t[0]:g},{t[1]:g}) size=({node['size'][0]:g},{node['size'][1]:g}) "
               f"origin={node['origin'][0][0]}{node['origin'][1][0]}/{node['parentOrigin'][0][0]}{node['parentOrigin'][1][0]}"
               f"{'' if node['visible'] else ' hidden'}{extra}")
    for c in node["children"]:
        tree_lines(c, depth + 1, out)
    return out


def dump(path, out_dir):
    files = ui_sarc.read_files(path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = {"source": str(path), "files": {}, "checks": {}}
    for name, data in sorted(files.items()):
        kind = data[:4]
        try:
            if kind == b"FLYT":
                d = parse_bflyt(data)
                (out_dir / (Path(name).stem + ".bflyt.json")).write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
                (out_dir / (Path(name).stem + ".tree.txt")).write_text("\n".join(tree_lines(d["root"])), encoding="utf-8")
                summary["files"][name] = {"panes": count_panes(d["root"]), "materials": len(d["materials"]),
                                          "textures": d["textures"], "fonts": d["fonts"]}
            elif kind == b"FLAN":
                d = parse_bflan(data)
                (out_dir / (Path(name).stem + ".bflan.json")).write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
                summary["files"][name] = {"frames": [d["tag"]["start"], d["tag"]["end"]] if "tag" in d else [0, d.get("frameSize")],
                                          "pat1": "tag" in d, "loop": d.get("loop"),
                                          "entries": len(d.get("entries", []))}
            elif kind == b"FCPX":
                d = parse_bfcpx(data)
                summary["files"][name] = {"fonts": d["fonts"]}
            elif kind == b"BNTX":
                d = list_bntx(data)
                summary["files"][name] = {"textures": d}
                import graphics_bntx  # [mps] 레이아웃 텍스처도 png 로 (timg/)
                for t in graphics_bntx.parse(data):
                    graphics_bntx.to_png(t, str(out_dir / "timg"))
                d = {}
            else:
                d = {}
                summary["files"][name] = {"magic": kind.hex()}
            if d and isinstance(d, dict) and d.get("_check"):
                summary["checks"][name] = d["_check"]
        except Exception as e:  # noqa: BLE001
            summary["checks"][name] = [f"EXC {type(e).__name__}: {e}"]
    (out_dir / "_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    return summary


def count_panes(n):
    if n is None:
        return 0
    return 1 + sum(count_panes(c) for c in n["children"])


def survey(paths):
    secs = Counter()
    pane_types = Counter()
    tags = Counter()
    bad = []
    nfly = nfla = 0
    ver = Counter()
    for path in paths:
        try:
            files = ui_sarc.read_files(path)
        except Exception as e:  # noqa: BLE001
            bad.append(f"{path}: {e}")
            continue
        for name, data in files.items():
            try:
                if data[:4] == b"FLYT":
                    nfly += 1
                    d = parse_bflyt(data)
                    ver[d["header"]["version"]] += 1
                    secs.update(d["sectionOrder"])
                    stack = [d["root"]]
                    while stack:
                        n = stack.pop()
                        if n is None:
                            continue
                        pane_types[n["type"]] += 1
                        stack.extend(n["children"])
                    if d["_check"]:
                        bad.append(f"{path}:{name}: {d['_check'][:3]}")
                elif data[:4] == b"FLAN":
                    nfla += 1
                    d = parse_bflan(data)
                    for e in d.get("entries", []):
                        for t in e["tags"]:
                            tags[t["tag"]] += 1
                    if d["_check"]:
                        bad.append(f"{path}:{name}: {d['_check'][:3]}")
            except Exception as e:  # noqa: BLE001
                bad.append(f"{path}:{name}: EXC {type(e).__name__}: {e}")
    print(f"bflyt {nfly} bflan {nfla} versions {dict(ver)}")
    print("sections", dict(secs))
    print("panes", dict(pane_types))
    print("anim tags", dict(tags))
    print(f"problems {len(bad)}")
    for x in bad[:40]:
        print("  ", x)


if __name__ == "__main__":
    if sys.argv[1] == "dump":
        s = dump(sys.argv[2], sys.argv[3])
        print(json.dumps(s["checks"], ensure_ascii=False, indent=1))
        print(len(s["files"]), "files")
    elif sys.argv[1] == "survey":
        survey(sys.argv[2:])
