"""Jamboree 폰트: FFNT(v4.1, NX 비트맵 글리프 시트) 읽기·글리프 시트 PNG·문자열 렌더 시험, BFOTF 복호화.

FFNT: FINF → TGLP(셀 크기, 시트 = 내장 BNTX 배열 텍스처), CWDH(글리프 인덱스별 left/glyphWidth/charWidth), CMAP(코드 → 글리프 인덱스).
필드 정의 기준: Switch-Toolbox Font/BXFNT (tools/oss/ref_ui/BXFNT) + 데이터 대조.
BFOTF: u32 매직 + u32 크기, 이후 u32 단위 XOR (키는 매직별, BFTTFutil/Switch-Toolbox 기준).

사용:
  ui_font.py info <x.ffnt>
  ui_font.py sheets <x.ffnt> <out_dir>                 시트 PNG
  ui_font.py text <x.ffnt> <out.png> <문자열> [scale]  글리프 배치 렌더(웹 캔버스 재현 시험)
  ui_font.py export <x.ffnt> <out_dir>                 웹용 시트 PNG + 메트릭 JSON
  ui_font.py otf <x.bfotf> <out.otf>                   복호화
"""
import json
import struct
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools" / "oss" / "BNTX-Extractor"))
import bntx_to_dds  # noqa: E402,F401
import bntx_extract  # noqa: E402
import swizzle  # noqa: E402
import texture2ddecoder as t2d  # noqa: E402

BFOTF_KEYS = {0x1A879BD9: 2785117442, 0x1E1AF836: 1231165446, 0xC1DE68F3: 2364726489}


def parse_ffnt(b):
    if b[:4] != b"FFNT":
        raise ValueError("not FFNT")
    bom, hsize, ver, fsize, nblk = struct.unpack_from("<HHIIH", b, 4)
    f = {"version": f"{ver >> 24}.{ver >> 16 & 0xFF}.{ver >> 8 & 0xFF}", "blocks": nblk, "file_size": fsize}
    o = hsize
    assert b[o:o + 4] == b"FINF"
    (typ, h, w, asc, lf, alt, dl, dg, dc, enc, tglp, cwdh, cmap) = struct.unpack_from("<BBBBHHBBBBIII", b, o + 8)
    f["finf"] = {"type": typ, "height": h, "width": w, "ascent": asc, "lineFeed": lf, "alterCharIndex": alt,
                 "defaultWidth": [dl, dg, dc], "encoding": enc}
    t = tglp - 8
    cw, ch, nsheet, maxw, ssize, base, fmt, rows, cols, sw, sh, soff = struct.unpack_from("<BBBBIHHHHHHI", b, t + 8)
    f["tglp"] = {"cellW": cw, "cellH": ch, "sheets": nsheet, "maxCharW": maxw, "sheetSize": ssize, "baseline": base,
                 "format": fmt, "cellsPerRow": rows, "cellsPerCol": cols, "sheetW": sw, "sheetH": sh, "sheetOffset": soff}
    f["_sheet_blob"] = (soff, ssize * nsheet)
    widths = {}
    p = cwdh - 8
    nseg = 0
    while p >= 0:
        assert b[p:p + 4] == b"CWDH", hex(p)
        s, e, nxt = struct.unpack_from("<HHI", b, p + 8)
        for i in range(s, e + 1):
            q = p + 16 + (i - s) * 3
            widths[i] = struct.unpack_from("<bBB", b, q)
        nseg += 1
        p = nxt - 8 if nxt else -1
    f["cwdhSegments"] = nseg
    cmapd = {}
    p = cmap - 8
    nmap = Counter_ = {}
    while p >= 0:
        assert b[p:p + 4] == b"CMAP", hex(p)
        cb, ce, meth, _pad, nxt = struct.unpack_from("<IIHHI", b, p + 8)
        q = p + 24
        Counter_[meth] = Counter_.get(meth, 0) + 1
        if meth == 0:
            off = struct.unpack_from("<H", b, q)[0]
            for c in range(cb, ce + 1):
                cmapd[c] = c - cb + off
        elif meth == 1:
            for i, c in enumerate(range(cb, ce + 1)):
                v = struct.unpack_from("<h", b, q + i * 2)[0]
                if v != -1:
                    cmapd[c] = v
        elif meth == 2:
            n = struct.unpack_from("<H", b, q)[0]
            for i in range(n):
                c, v = struct.unpack_from("<Ih", b, q + 4 + i * 8)
                if v != -1:
                    cmapd[c] = v
        p = nxt - 8 if nxt else -1
    f["cmapMethods"] = {["direct", "table", "scan"][k]: v for k, v in nmap.items()}
    f["chars"] = len(cmapd)
    f["glyphs"] = len(widths)
    return f, cmapd, widths


def decode_sheets(b, f):
    off, size = f["_sheet_blob"]
    bn = b[off:off + size]
    nx = bntx_extract.NXHeader("<")
    nx.data(bn, 0x20)
    p = struct.unpack_from("<q", bn, nx.infoPtrAddr)[0]
    info = bntx_extract.BRTIInfo("<")
    info.data(bn, p)
    fmt = info.format_ >> 8
    bw, bh = bntx_extract.blk_dims.get(fmt, (1, 1))
    bpp = bntx_extract.bpps[fmt]
    data_addr = struct.unpack_from("<q", bn, info.ptrsAddr)[0]
    layers = info.numFaces
    layer_size = info.imageSize // layers
    w, h = info.width, info.height
    need = bntx_extract.DIV_ROUND_UP(w, bw) * bntx_extract.DIV_ROUND_UP(h, bh) * bpp
    out = []
    for i in range(layers):
        raw = bn[data_addr + i * layer_size:data_addr + (i + 1) * layer_size]
        lin = swizzle.deswizzle(w, h, bw, bh, bpp, info.tileMode, info.alignment, info.sizeRange, raw)[:need]
        if fmt == 0x1D:
            px = t2d.decode_bc4(lin, w, h)
            img = Image.frombytes("RGBA", (w, h), px, "raw", "BGRA").split()[0]  # R = 커버리지
        elif fmt == 0x1E:
            px = t2d.decode_bc5(lin, w, h)
            img = Image.frombytes("RGBA", (w, h), px, "raw", "BGRA")
        elif fmt == 0x0B:
            img = Image.frombytes("RGBA", (w, h), lin)
        elif fmt == 0x20:  # [mps] BC7 (컬러 폰트 hsfont_mario 등, 0x2006 = BC7_SRGB)
            px = t2d.decode_bc7(lin, w, h)
            img = Image.frombytes("RGBA", (w, h), px, "raw", "BGRA")
        else:
            raise ValueError(f"sheet format {hex(info.format_)}")
        # 시트는 상하 반전으로 저장된다(글리프 0 이 맨 아래 행, 뒤집힌 모양) [데이터: 시트 PNG 육안 확인]
        out.append(img.transpose(Image.FLIP_TOP_BOTTOM))
    return out, {"bntxFormat": hex(info.format_), "layers": layers, "w": w, "h": h,
                 "compSel": hex(info.compSel)}


def glyph_cell(f, idx):
    t = f["tglp"]
    per_sheet = t["cellsPerRow"] * t["cellsPerCol"]
    sheet = idx // per_sheet
    r = idx % per_sheet
    cx, cy = r % t["cellsPerRow"], r // t["cellsPerRow"]
    # 셀 간격 = 셀 + 1px 테두리 (데이터로 확인: sheetW 1024 / cellsPerRow)
    px = cx * (t["cellW"] + 1) + 1
    py = cy * (t["cellH"] + 1) + 1
    return sheet, px, py


def render_text(b, s, scale=1.0, color=(255, 255, 255)):
    f, cmap, widths = parse_ffnt(b)
    sheets, _ = decode_sheets(b, f)
    t = f["tglp"]
    fi = f["finf"]
    x = 0
    lines = s.split("\n")
    W = int(max(sum(widths.get(cmap.get(ord(c), fi["alterCharIndex"]), (0, 0, fi["width"]))[2] for c in ln) for ln in lines) * scale) + 8
    H = int(fi["lineFeed"] * len(lines) * scale) + 8
    img = Image.new("RGBA", (W, H), (30, 30, 40, 255))
    y = 4
    for ln in lines:
        x = 4
        for c in ln:
            gi = cmap.get(ord(c), fi["alterCharIndex"])
            left, gw, cw = widths.get(gi, tuple(fi["defaultWidth"]))
            sh, px, py = glyph_cell(f, gi)
            cell = sheets[sh].crop((px, py, px + gw, py + t["cellH"]))
            if scale != 1.0:
                cell = cell.resize((max(1, int(gw * scale)), max(1, int(t["cellH"] * scale))), Image.BILINEAR)
            layer = Image.new("RGBA", cell.size, color + (0,))
            layer.putalpha(cell)
            img.alpha_composite(layer, (int(x + left * scale), int(y)))
            x += cw * scale
        y += fi["lineFeed"] * scale
    return img


def decrypt_bfotf(b):
    magic = struct.unpack_from("<I", b, 0)[0]  # 매직은 LE 로 비교, 본문 XOR 은 BE u32 (데이터로 확인: 크기 일치)
    key = BFOTF_KEYS[magic]
    size = struct.unpack_from(">I", b, 4)[0] ^ key
    out = bytearray(len(b) - 8)
    for p in range(8, len(b) - 3, 4):
        struct.pack_into(">I", out, p - 8, struct.unpack_from(">I", b, p)[0] ^ key)
    return bytes(out[:size]), size


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "info":
        b = Path(sys.argv[2]).read_bytes()
        f, cmap, widths = parse_ffnt(b)
        _, si = decode_sheets(b, f) if len(sys.argv) > 3 else (None, None)
        f.pop("_sheet_blob")
        print(json.dumps(f, ensure_ascii=False))
        if si:
            print(si)
    elif cmd == "sheets":
        b = Path(sys.argv[2]).read_bytes()
        f, _, _ = parse_ffnt(b)
        out = Path(sys.argv[3])
        out.mkdir(parents=True, exist_ok=True)
        sheets, si = decode_sheets(b, f)
        for i, s in enumerate(sheets):
            s.save(out / f"{Path(sys.argv[2]).stem}_sheet{i}.png")
        print(si)
    elif cmd == "text":
        b = Path(sys.argv[2]).read_bytes()
        img = render_text(b, sys.argv[4], float(sys.argv[5]) if len(sys.argv) > 5 else 1.0)
        Path(sys.argv[3]).parent.mkdir(parents=True, exist_ok=True)
        img.save(sys.argv[3])
        print(img.size)
    elif cmd == "export":
        # 웹용: 시트 PNG(알파=커버리지) + 메트릭 JSON {finf, tglp, cmap{코드:글리프}, widths{글리프:[left,glyphW,charW]}}
        b = Path(sys.argv[2]).read_bytes()
        out = Path(sys.argv[3])
        out.mkdir(parents=True, exist_ok=True)
        f, cmap, widths = parse_ffnt(b)
        sheets, si = decode_sheets(b, f)
        stem = Path(sys.argv[2]).stem
        for i, sh in enumerate(sheets):
            sh.save(out / f"{stem}_{i}.png")
        f.pop("_sheet_blob")
        meta = {"font": stem, **f, "sheetFiles": [f"{stem}_{i}.png" for i in range(len(sheets))],
                "cellPitch": [f["tglp"]["cellW"] + 1, f["tglp"]["cellH"] + 1], "cellOrigin": [1, 1],
                "cmap": {str(k): v for k, v in sorted(cmap.items())}, "widths": {str(k): list(v) for k, v in sorted(widths.items())}}
        (out / f"{stem}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        print(stem, len(sheets), "sheets", len(cmap), "chars")
    elif cmd == "otf":
        data, size = decrypt_bfotf(Path(sys.argv[2]).read_bytes())
        Path(sys.argv[3]).parent.mkdir(parents=True, exist_ok=True)
        Path(sys.argv[3]).write_bytes(data)
        print(size, data[:4])
