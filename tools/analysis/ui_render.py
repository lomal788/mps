"""bflyt 정적 렌더 시험 (해석 검증용, 원본 화면과 대조한 것이 아니다).

ui_lyt.py 가 읽은 페인 트리를 PIL 로 그린다. 좌표계·원점·부모 원점·알파 전파·재질 흑/백 보간·
bflan 한 프레임 적용(FLPA/FLVC/FLVI/FLTP/FLMC)을 웹 재생기와 같은 규칙으로 계산해 보는 것이 목적이다.
텍스트 페인은 "페인=문자열" 인자를 주면 FFNT 글리프로 그리고(가운데 정렬 근사), 없으면 틀만 그린다.

사용:
  ui_render.py <file.lyt> <blyt 이름(확장자 없이)> <out.png> [anim 이름(확장자 없이) frame]... [페인=문자열]...
  ui_render.py textures <file.lyt> <out_dir>      __Combined.bntx → png
"""
import math
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools" / "oss" / "BNTX-Extractor"))
import bntx_to_dds  # noqa: E402,F401  (BRTI +0x10 하위 비트만 타일 모드로 쓰는 패치, web/docs/analysis/01 포맷 메모)
import bntx_extract  # noqa: E402
import swizzle  # noqa: E402
import texture2ddecoder as t2d  # noqa: E402
import ui_lyt  # noqa: E402
import ui_sarc  # noqa: E402


class LazyTextures(dict):
    """이름 → RGBA Image. 처음 쓸 때 디스위즐·디코드한다(큰 BNTX 대비)."""

    def __init__(self):
        super().__init__()
        self.src = {}

    def add_bntx(self, b):
        import io, contextlib
        with contextlib.redirect_stdout(io.StringIO()):
            for tex in bntx_extract.readBNTX(b):
                self.src[tex.name] = tex

    def get(self, name, default=None):
        if name in self:
            return self[name]
        tex = self.src.get(name)
        if tex is None:
            return default
        img = decode_tex(tex)
        self[name] = img
        return img if img is not None else default

    def names(self):
        return list(self.src)


def decode_tex(tex):
    fmt = tex.format >> 8
    if tex.numFaces > 1:
        return None
    bw, bh = bntx_extract.blk_dims.get(fmt, (1, 1))
    bpp = bntx_extract.bpps[fmt]
    size = bntx_extract.DIV_ROUND_UP(tex.width, bw) * bntx_extract.DIV_ROUND_UP(tex.height, bh) * bpp
    raw = swizzle.deswizzle(tex.width, tex.height, bw, bh, bpp, tex.tileMode, tex.alignment, tex.sizeRange, tex.data)[:size]
    w, h = tex.width, tex.height
    if fmt in bntx_extract.ASTC_formats:
        px = t2d.decode_astc(raw, w, h, bw, bh)
    elif fmt == 0x1D:
        px = t2d.decode_bc4(raw, w, h)
    elif fmt == 0x1A:
        px = t2d.decode_bc1(raw, w, h)
    elif fmt == 0x1C:
        px = t2d.decode_bc3(raw, w, h)
    elif fmt == 0x1E:
        px = t2d.decode_bc5(raw, w, h)
    elif fmt == 0x20:
        px = t2d.decode_bc7(raw, w, h)
    elif fmt == 0x0B:
        return apply_compsel(Image.frombytes("RGBA", (w, h), raw), tex.compSel)
    else:
        return None
    return apply_compsel(Image.frombytes("RGBA", (w, h), px, "raw", "BGRA"), tex.compSel)


def apply_compsel(img, compsel):
    # bntx_extract: compSel 은 [A,B,G,R] 순(뒤집힌 값) 0=0 1=1 2=R 3=G 4=B 5=A
    r, g, b, a = img.split()
    src = {2: r, 3: g, 4: b, 5: a}
    zero = Image.new("L", img.size, 0)
    one = Image.new("L", img.size, 255)
    sel = list(reversed(compsel))
    ch = []
    for v in sel:
        ch.append(src.get(v, zero if v == 0 else one))
    return Image.merge("RGBA", ch)


# ---------------------------------------------------------------- 애니

def hermite(keys, f):
    if not keys:
        return None
    if f <= keys[0][0]:
        return keys[0][1]
    if f >= keys[-1][0]:
        return keys[-1][1]
    for k0, k1 in zip(keys, keys[1:]):
        if k0[0] <= f <= k1[0]:
            t0, v0, s0 = k0[0], k0[1], k0[2] if len(k0) > 2 else 0
            t1, v1, s1 = k1[0], k1[1], k1[2] if len(k1) > 2 else 0
            d = t1 - t0
            if d == 0:
                return v1
            t = (f - t0) / d
            h00 = 2 * t ** 3 - 3 * t ** 2 + 1
            h10 = t ** 3 - 2 * t ** 2 + t
            h01 = -2 * t ** 3 + 3 * t ** 2
            h11 = t ** 3 - t ** 2
            return h00 * v0 + h10 * d * s0 + h01 * v1 + h11 * d * s1
    return keys[-1][1]


def step(keys, f):
    v = keys[0][1]
    for k in keys:
        if k[0] <= f:
            v = k[1]
    return v


def apply_anim(lay, anim, frame):
    panes = {}
    stack = [lay["root"]]
    while stack:
        n = stack.pop()
        panes[n["name"]] = n
        stack.extend(n["children"])
    mats = {m["name"]: m for m in lay["materials"]}
    for e in anim.get("entries", []):
        for tag in e["tags"]:
            for tr in tag["tracks"]:
                v = hermite(tr["keys"], frame) if tr["curve"] == "hermite" else step(tr["keys"], frame)
                if v is None:
                    continue
                if e["target"] == "pane" and e["name"] in panes:
                    p = panes[e["name"]]
                    if tag["tag"] == "FLPA":
                        k = tr["target"]
                        if k < 3:
                            p["translate"][k] = v
                        elif k < 6:
                            p["rotate"][k - 3] = v
                        elif k < 8:
                            p["scale"][k - 6] = v
                        elif k < 10:
                            p["size"][k - 8] = v
                    elif tag["tag"] == "FLVC":
                        k = tr["target"]
                        if k == 16:
                            p["alpha"] = max(0, min(255, round(v)))
                        elif k < 16 and "vtxColors" in p:
                            cols = [bytearray.fromhex(c[1:]) for c in p["vtxColors"]]
                            cols[k // 4][k % 4] = max(0, min(255, round(v)))
                            p["vtxColors"] = ["#" + c.hex() for c in cols]
                    elif tag["tag"] == "FLVI":
                        p["visible"] = bool(round(v))
                elif e["target"] == "material" and e["name"] in mats:
                    m = mats[e["name"]]
                    if tag["tag"] == "FLMC":
                        k = tr["target"]
                        key = "black" if k < 4 else "white"
                        if k < 8:
                            c = bytearray.fromhex(m[key][1:])
                            c[k % 4] = max(0, min(255, round(v)))
                            m[key] = "#" + c.hex()
                    elif tag["tag"] == "FLTP":
                        idx = int(round(v))
                        tl = anim.get("textures", [])
                        if m["texMaps"] and 0 <= idx < len(tl):
                            m["texMaps"][tr["index"]]["tex"] = tl[idx]
                    elif tag["tag"] == "FLTS":
                        k = tr["target"]
                        if m["texSrt"]:
                            s = m["texSrt"][tr["index"]]
                            if k < 2:
                                s["t"][k] = v
                            elif k == 2:
                                s["r"] = v
                            elif k < 5:
                                s["s"][k - 3] = v


# ---------------------------------------------------------------- 그리기

def mat3_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def pane_local(p):
    tx, ty = p["translate"][0], p["translate"][1]
    rz = math.radians(p["rotate"][2])
    sx, sy = p["scale"]
    c, s = math.cos(rz), math.sin(rz)
    return [[c * sx, -s * sy, tx], [s * sx, c * sy, ty], [0, 0, 1]]


def rect_of(p):
    w, h = p["size"]
    ox, oy = p["origin"]
    x0 = {"center": -w / 2, "left": 0, "right": -w}.get(ox, -w / 2)
    y1 = {"center": h / 2, "top": 0, "bottom": h}.get(oy, h / 2)
    return x0, y1 - h, x0 + w, y1  # (left, bottom, right, top), y 위가 +


def parent_anchor(parent, child):
    if parent is None:
        return 0.0, 0.0
    l, b, r, t = rect_of(parent)
    px, py = child["parentOrigin"]
    ax = {"center": (l + r) / 2, "left": l, "right": r}.get(px, (l + r) / 2)
    ay = {"center": (b + t) / 2, "top": t, "bottom": b}.get(py, (b + t) / 2)
    return ax, ay


def mul_color(c, k):
    return tuple(int(round(c[i] * k[i] / 255)) for i in range(4))


def hexc(s):
    v = bytes.fromhex(s[1:])
    return tuple(v)


FONT_DIR = Path(__file__).resolve().parents[3] / "extracted" / "bea" / "font~font.nx.bea" / "Parts.lyt" / "Font"


class Renderer:
    fonts = {}

    def text_image(self, p, lay, text, alpha):
        """FFNT 글리프로 텍스트를 그린다. 폰트 = fcpx 의 두 번째 항목(본 폰트) [추정: usen/본/extension 순서]."""
        import ui_font
        name = p["font"]
        stem = name.rsplit(".", 1)[0]
        cpx = self.files.get(f"fcpx/{stem}.bfcpx")
        cands = ui_lyt.parse_bfcpx(cpx)["fonts"] if cpx else [stem + ".bffnt"]
        for c in cands[1:] + cands[:1]:
            fp = FONT_DIR / c.replace(".bffnt", ".ffnt")
            if fp.exists():
                break
        else:
            self.log.append(f"font missing {name}")
            return None
        if fp not in self.fonts:
            b = fp.read_bytes()
            f, cmap, widths = ui_font.parse_ffnt(b)
            sheets, _ = ui_font.decode_sheets(b, f)
            self.fonts[fp] = (f, cmap, widths, sheets)
        f, cmap, widths, sheets = self.fonts[fp]
        fi, tg = f["finf"], f["tglp"]
        scale = p["fontSize"][1] / fi["height"]  # [추정] fontSize = 줄 높이 기준
        W = int(sum(widths.get(cmap.get(ord(c), fi["alterCharIndex"]), (0, 0, fi["width"]))[2] for c in text) * scale) + 2
        H = int(tg["cellH"] * scale) + 2
        cov = Image.new("L", (max(1, W), max(1, H)), 0)
        x = 0.0
        for c in text:
            gi = cmap.get(ord(c), fi["alterCharIndex"])
            left, gw, cw = widths.get(gi, tuple(fi["defaultWidth"]))
            sh, px, py = ui_font.glyph_cell(f, gi)
            cell = sheets[sh].crop((px, py, px + gw, py + tg["cellH"]))
            cell = cell.resize((max(1, int(gw * scale)), max(1, int(tg["cellH"] * scale))), Image.BILINEAR)
            cov.paste(cell, (int(x + left * scale), 0), cell)
            x += cw * scale
        mats = {mm["name"]: mm for mm in lay["materials"]}
        mat = mats.get(p["material"]) if isinstance(p["material"], str) else None
        black = hexc(mat["black"]) if mat else (0, 0, 0, 0)
        white = hexc(mat["white"]) if mat else (255, 255, 255, 255)
        top = hexc(p["colorTop"])
        # 색 = lerp(black, white, 글리프) × 글자색 [추정: ui2d 텍스트 기본 컴바이너]
        chans = []
        for i in range(4):
            lo, hi, k = black[i], white[i], top[i]
            chans.append(cov.point(lambda v, lo=lo, hi=hi, k=k: (lo + (hi - lo) * v // 255) * k // 255))
        img = Image.merge("RGBA", chans)
        a = img.split()[3].point(lambda v: v * alpha // 255)
        img.putalpha(Image.composite(a, Image.new("L", a.size, 0), cov))
        return img

    def __init__(self, files, textures, W=1920, H=1080, texts=None):
        self.texts = texts or {}
        self.files = files
        self.tex = textures
        self.W, self.H = W, H
        self.img = Image.new("RGBA", (W, H), (40, 40, 48, 255))
        self.draw = ImageDraw.Draw(self.img)
        self.log = []

    def to_screen(self, m, x, y):
        X = m[0][0] * x + m[0][1] * y + m[0][2]
        Y = m[1][0] * x + m[1][1] * y + m[1][2]
        return X + self.W / 2, self.H / 2 - Y

    def material_image(self, mat, uvs, w, h, vtx, alpha):
        black = hexc(mat["black"])
        white = hexc(mat["white"])
        if mat["texMaps"]:
            name = mat["texMaps"][0]["tex"]
            t = self.tex.get(name)
            if t is None:
                self.log.append(f"tex missing {name}")
                t = Image.new("RGBA", (4, 4), (255, 0, 255, 255))
            if uvs:
                u = uvs[0]
                us = [u[0], u[2], u[4], u[6]]
                vs = [u[1], u[3], u[5], u[7]]
                tw, th = t.size
                x0, x1 = min(us) * tw, max(us) * tw
                y0, y1 = min(vs) * th, max(vs) * th
                flip_x = u[0] > u[2]
                flip_y = u[1] > u[5]
                if 0 <= x0 and x1 <= tw and 0 <= y0 and y1 <= th:
                    t = t.crop((int(x0), int(y0), int(math.ceil(x1)), int(math.ceil(y1))))
                if flip_x:
                    t = t.transpose(Image.FLIP_LEFT_RIGHT)
                if flip_y:
                    t = t.transpose(Image.FLIP_TOP_BOTTOM)
            t = t.resize((max(1, int(round(w))), max(1, int(round(h)))), Image.BILINEAR)
            # 기본 컴바이너 근사: out = black + (white - black) * tex  [추정: ui2d 기본 TEV]
            chans = []
            for i, ch in enumerate(t.split()):
                lo, hi = black[i], white[i]
                chans.append(ch.point(lambda v, lo=lo, hi=hi: lo + (hi - lo) * v // 255))
            t = Image.merge("RGBA", chans)
        else:
            t = Image.new("RGBA", (max(1, int(round(w))), max(1, int(round(h)))), white)
        # 정점색: 네 귀 평균(근사)
        avg = tuple(sum(c[i] for c in vtx) // 4 for i in range(4))
        if avg != (255, 255, 255, 255) or alpha != 255:
            k = (avg[0], avg[1], avg[2], avg[3] * alpha // 255)
            chans = [ch.point(lambda v, kk=kk: v * kk // 255) for ch, kk in zip(t.split(), k)]
            t = Image.merge("RGBA", chans)
        return t

    def blit(self, m, rect, img):
        l, b, r, t = rect
        corners = [self.to_screen(m, x, y) for x, y in ((l, t), (r, t), (r, b), (l, b))]
        w, h = img.size
        # 화면 → 이미지 역변환 (아핀)
        (x0, y0), (x1, y1), _, (x3, y3) = corners
        ax, ay = (x1 - x0) / w, (y1 - y0) / w
        bx, by = (x3 - x0) / h, (y3 - y0) / h
        det = ax * by - ay * bx
        if abs(det) < 1e-9:
            return
        ia, ib, ic = by / det, -bx / det, (bx * y0 - by * x0) / det
        id_, ie, if_ = -ay / det, ax / det, (ay * x0 - ax * y0) / det
        layer = img.transform((self.W, self.H), Image.AFFINE, (ia, ib, ic, id_, ie, if_), Image.BILINEAR)
        self.img.alpha_composite(layer)

    def pane(self, p, lay, parent_m, parent, alpha):
        if not p["visible"]:
            return
        ax, ay = parent_anchor(parent, p)
        m = mat3_mul(parent_m, [[1, 0, ax], [0, 1, ay], [0, 0, 1]])
        m = mat3_mul(m, pane_local(p))
        my_alpha = alpha * p["alpha"] // 255
        rect = rect_of(p)
        typ = p["type"]
        if typ == "pic1":
            mat = lay["materials"][p["materialIndex"]] if isinstance(p.get("materialIndex"), int) else None
            if mat:
                img = self.material_image(mat, p["uvs"], abs(rect[2] - rect[0]), abs(rect[3] - rect[1]),
                                          [hexc(c) for c in p["vtxColors"]], my_alpha)
                self.blit(m, rect, img)
        elif typ == "wnd1":
            mats = {x["name"]: x for x in lay["materials"]}
            mat = mats.get(p["content"]["material"])
            if mat:
                img = self.material_image(mat, p["content"]["uvs"], abs(rect[2] - rect[0]), abs(rect[3] - rect[1]),
                                          [hexc(c) for c in p["content"]["vtxColors"]], my_alpha)
                self.blit(m, rect, img)
        elif typ == "txt1":
            l, b, r, t = rect
            text = self.texts.get(p["name"], p.get("text", ""))
            img = self.text_image(p, lay, text, my_alpha) if text else None
            if img is not None:
                # 가운데 정렬만 근사(textAlign 이 center 인 페인 기준)
                cx, cy = (l + r) / 2, (b + t) / 2
                w, h = img.size
                self.blit(m, (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), img)
            else:
                pts = [self.to_screen(m, x, y) for x, y in ((l, t), (r, t), (r, b), (l, b), (l, t))]
                self.draw.line(pts, fill=(255, 220, 0, 255), width=2)
        elif typ == "prt1":
            sub = self.files.get(f"blyt/{p['layoutFile']}.bflyt")
            if sub is not None:
                sl = ui_lyt.parse_bflyt(sub)
                self.pane(sl["root"], sl, mat3_mul(m, [[p["magnify"][0], 0, 0], [0, p["magnify"][1], 0], [0, 0, 1]]), None, my_alpha)
            else:
                self.log.append(f"parts missing {p['layoutFile']}")
        child_alpha = my_alpha if p["influencedAlpha"] else alpha
        for c in p["children"]:
            self.pane(c, lay, m, p, child_alpha)


def render(lyt_path, blyt, out_png, anims, texts=None):
    files = ui_sarc.read_files(lyt_path)
    tex = LazyTextures()
    for name, data in files.items():
        if data[:4] == b"BNTX":
            tex.add_bntx(data)
    lay = ui_lyt.parse_bflyt(files[f"blyt/{blyt}.bflyt"])
    for an, fr in anims:
        apply_anim(lay, ui_lyt.parse_bflan(files[f"anim/{an}.bflan"]), fr)
    W, H = (int(v) for v in lay["layout"]["size"])
    r = Renderer(files, tex, W, H, texts)
    r.pane(lay["root"], lay, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], None, 255)
    Path(out_png).parent.mkdir(parents=True, exist_ok=True)
    r.img.save(out_png)
    return r.log


if __name__ == "__main__":
    if sys.argv[1] == "textures":
        files = ui_sarc.read_files(sys.argv[2])
        out = Path(sys.argv[3])
        out.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            if data[:4] == b"BNTX":
                lt = LazyTextures()
                lt.add_bntx(data)
                for tn in lt.names():
                    img = lt.get(tn)
                    if img is None:
                        print(tn, "skip")
                        continue
                    img.save(out / (tn.replace("^", "_") + ".png"))
                    print(tn, img.size)
    else:
        a = [x for x in sys.argv[4:] if "=" not in x]
        texts = dict(x.split("=", 1) for x in sys.argv[4:] if "=" in x)  # 페인이름=문자열
        anims = [(a[i], float(a[i + 1])) for i in range(0, len(a), 2)]
        log = render(sys.argv[1], sys.argv[2], sys.argv[3], anims, texts)
        print("\n".join(sorted(set(log))) or "ok")
