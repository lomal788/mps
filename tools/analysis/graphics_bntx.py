"""BNTX 4.1 (Jamboree) parser / deswizzler / PNG exporter / statistics.

usage:
  graphics_bntx.py info  <file.bntx>...              print BRTI fields
  graphics_bntx.py png   <out_dir> <file.bntx>...    mip0 of every array layer -> png (+ <name>.json meta)
  graphics_bntx.py stats <root> <out.json>           statistics over every .bntx under root (headers only)

Own implementation (no BNTX-Extractor dependency):
  - header / NX / BRTI layout per nn::gfx ResTextureInfo (same struct as BNTX-Extractor '4siq2b3H3I5i6I4i3q',
    field names corrected: +0x10 u8 flags, +0x11 u8 storage dim, +0x12 u16 tile mode).
  - Tegra X1 block-linear deswizzle (GOB 64B x 8 rows, block height = 1 << (textureLayout & 7)), numpy vectorized.
  - array layers: layer stride = imageSize / arrayLength (checked), mip0 of every layer.
  - BC1..BC7 decode through Pillow's 'bcn' decoder (BC6H is clamped to 8-bit LDR by Pillow), ASTC through texture2ddecoder.
  - BC6H additionally -> float through imagecodecs (bcdec) -> <name>[_NN].hdr (Radiance RGBE), the HDR source of truth.
  - SNORM (R8, R8G8, BC4/BC5 SNORM) is stored as v*0.5+0.5 in the png.
"""
import json
import os
import struct
import sys

import numpy as np

FORMATS = {
    0x02: ("R8", 1, 1, 1), 0x07: ("R5G6B5", 1, 1, 2), 0x09: ("R8G8", 1, 1, 2), 0x0B: ("R8G8B8A8", 1, 1, 4),
    0x0C: ("B8G8R8A8", 1, 1, 4), 0x0E: ("R10G10B10A2", 1, 1, 4), 0x12: ("R16F?", 1, 1, 2),
    0x1A: ("BC1", 4, 4, 8), 0x1B: ("BC2", 4, 4, 16), 0x1C: ("BC3", 4, 4, 16), 0x1D: ("BC4", 4, 4, 8),
    0x1E: ("BC5", 4, 4, 16), 0x1F: ("BC6H", 4, 4, 16), 0x20: ("BC7", 4, 4, 16),
    0x2D: ("ASTC4x4", 4, 4, 16), 0x2E: ("ASTC5x4", 5, 4, 16), 0x2F: ("ASTC5x5", 5, 5, 16), 0x30: ("ASTC6x5", 6, 5, 16),
    0x31: ("ASTC6x6", 6, 6, 16), 0x32: ("ASTC8x5", 8, 5, 16), 0x33: ("ASTC8x6", 8, 6, 16), 0x34: ("ASTC8x8", 8, 8, 16),
    0x35: ("ASTC10x5", 10, 5, 16), 0x36: ("ASTC10x6", 10, 6, 16), 0x37: ("ASTC10x8", 10, 8, 16), 0x38: ("ASTC10x10", 10, 10, 16),
    0x39: ("ASTC12x10", 12, 10, 16), 0x3A: ("ASTC12x12", 12, 12, 16),
}
TYPES = {1: "UNORM", 2: "SNORM", 3: "UINT", 4: "SINT", 5: "FLOAT", 6: "SRGB", 0xA: "UFLOAT"}
STORAGE = {0: "Undefined", 1: "1D", 2: "2D", 3: "3D"}
DIMS = {0: "1D", 1: "2D", 2: "3D", 3: "Cube", 4: "1DArray", 5: "2DArray", 6: "2DMS", 7: "2DMSArray", 8: "CubeArray"}
COMP = {0: "0", 1: "1", 2: "R", 3: "G", 4: "B", 5: "A"}


def div_up(a, b):
    return (a + b - 1) // b


class Tex:
    pass


def parse(data):
    if data[:4] != b"BNTX":
        raise ValueError("not BNTX")
    if data[0xC:0xE] != b"\xFF\xFE":
        raise ValueError("BOM")
    version = struct.unpack_from("<I", data, 8)[0]
    nx = 0x20
    if data[nx:nx + 4] != b"NX  ":
        raise ValueError("NX")
    count, info_ptr, data_blk, dict_off = struct.unpack_from("<I3q", data, nx + 4)
    texs = []
    for i in range(count):
        p = struct.unpack_from("<q", data, info_ptr + i * 8)[0]
        if data[p:p + 4] != b"BRTI":
            raise ValueError("BRTI")
        t = Tex()
        t.version = version
        t.flags = data[p + 0x10]
        t.dim = data[p + 0x11]
        t.tile_mode, t.swizzle, t.mips = struct.unpack_from("<3H", data, p + 0x12)
        t.samples, t.format, t.access = struct.unpack_from("<3I", data, p + 0x18)
        t.width, t.height, t.depth, t.array, t.layout, t.layout2 = struct.unpack_from("<6i", data, p + 0x24)
        t.reserved = data[p + 0x3C:p + 0x50].hex()
        t.image_size, t.alignment = struct.unpack_from("<2i", data, p + 0x50)
        t.comp = list(data[p + 0x58:p + 0x5C])  # R,G,B,A source selectors
        t.view_dim = data[p + 0x5C]
        name_addr, parent_addr, ptrs_addr = struct.unpack_from("<3q", data, p + 0x60)
        nlen = struct.unpack_from("<H", data, name_addr)[0]
        t.name = data[name_addr + 2:name_addr + 2 + nlen].decode("utf-8")
        base = struct.unpack_from("<q", data, ptrs_addr)[0]
        t.mip_offsets = [struct.unpack_from("<q", data, ptrs_addr + 8 * m)[0] - base for m in range(t.mips)]
        t.data_off = base
        t.raw = data
        fmt = FORMATS.get(t.format >> 8)
        t.fmt_name = (fmt[0] if fmt else "0x%02X" % (t.format >> 8)) + "_" + TYPES.get(t.format & 0xFF, "0x%02X" % (t.format & 0xFF))
        t.block_height_log2 = t.layout & 7
        texs.append(t)
    return texs


def deswizzle(src, width, height, blk_w, blk_h, bpp, block_height_log2, shrink=False):
    """Tegra X1 block-linear -> linear for one surface (one mip of one layer).
    mip0 uses the stored block height as is; smaller mips shrink it (shrink=True)."""
    w = div_up(width, blk_w)
    h = div_up(height, blk_h)
    gob_h = 1 << block_height_log2
    while shrink and gob_h > 1 and div_up(h, 8) <= gob_h // 2:
        gob_h //= 2
    row_bytes = w * bpp
    gobs_x = div_up(row_bytes, 64)
    xs = np.arange(row_bytes, dtype=np.int64)
    ys = np.arange(h, dtype=np.int64)
    X, Y = np.meshgrid(xs, ys)
    gob_addr = (Y // (8 * gob_h)) * 512 * gob_h * gobs_x + (X // 64) * 512 * gob_h + ((Y % (8 * gob_h)) // 8) * 512
    addr = gob_addr + ((X % 64) // 32) * 256 + ((Y % 8) // 2) * 64 + ((X % 32) // 16) * 32 + (Y % 2) * 16 + (X % 16)
    srcb = np.frombuffer(src, dtype=np.uint8)
    need = int(addr.max()) + 1
    if need > len(srcb):
        srcb = np.concatenate([srcb, np.zeros(need - len(srcb), np.uint8)])
    return srcb[addr.ravel()].tobytes(), w, h


def deswizzle_3d(src, width, height, depth, bpp, gob_h_log2, gob_d_log2):
    """3D block-linear (uncompressed formats): block = 1 GOB wide x gob_h GOBs tall x gob_d slices deep.
    Returns slices placed side by side (width*depth x height), the usual 2D strip layout of a 3D LUT."""
    gob_h, gob_d = 1 << gob_h_log2, 1 << gob_d_log2
    row_bytes = width * bpp
    gobs_x = div_up(row_bytes, 64)
    blocks_y = div_up(height, 8 * gob_h)
    block_size = 512 * gob_h * gob_d
    X, Y, Z = np.meshgrid(np.arange(row_bytes, dtype=np.int64), np.arange(height, dtype=np.int64), np.arange(depth, dtype=np.int64), indexing="xy")
    block = ((Z // gob_d) * blocks_y + Y // (8 * gob_h)) * gobs_x + X // 64
    inner = (Z % gob_d) * gob_h * 512 + ((Y % (8 * gob_h)) // 8) * 512
    addr = block * block_size + inner + ((X % 64) // 32) * 256 + ((Y % 8) // 2) * 64 + ((X % 32) // 16) * 32 + (Y % 2) * 16 + (X % 16)
    srcb = np.frombuffer(src, dtype=np.uint8)
    need = int(addr.max()) + 1
    if need > len(srcb):
        srcb = np.concatenate([srcb, np.zeros(need - len(srcb), np.uint8)])
    vol = srcb[addr]  # (height, row_bytes, depth)
    strip = np.concatenate([vol[:, :, z] for z in range(depth)], axis=1)  # (height, row_bytes*depth)
    return strip.tobytes()


def surface_bytes(t, layer, mip):
    fmt = FORMATS[t.format >> 8]
    layer_stride = t.image_size // max(1, t.array)
    start = t.data_off + layer * layer_stride + t.mip_offsets[mip]
    end = t.data_off + layer * layer_stride + (t.mip_offsets[mip + 1] if mip + 1 < t.mips else layer_stride)
    return t.raw[start:end]


def decode_layer(t, layer=0, mip=0):
    from PIL import Image
    name, bw, bh, bpp = FORMATS[t.format >> 8]
    width = max(1, t.width >> mip)
    height = max(1, t.height >> mip)
    if t.depth > 1:
        if bw != 1 or name not in ("R8G8B8A8", "B8G8R8A8"):
            raise NotImplementedError("3D " + name)
        strip = deswizzle_3d(surface_bytes(t, layer, mip), width, height, t.depth, bpp, t.layout & 7, (t.layout >> 4) & 7)
        img = Image.frombytes("RGBA", (width * t.depth, height), strip, "raw", "BGRA" if name == "B8G8R8A8" else "RGBA")
        return img
    lin, wb, hb = deswizzle(surface_bytes(t, layer, mip), width, height, bw, bh, bpp, t.block_height_log2, shrink=mip > 0)
    typ = t.format & 0xFF
    pw, ph = wb * bw, hb * bh
    if name.startswith("ASTC"):
        # texture2ddecoder (pip) decodes ASTC to BGRA8 (LDR). sRGB flag is metadata only.
        import texture2ddecoder
        bgra = texture2ddecoder.decode_astc(lin, pw, ph, bw, bh)
        img = Image.frombytes("RGBA", (pw, ph), bgra, "raw", "BGRA")
    elif name.startswith("BC"):
        n = int(name[2])
        if n == 4:
            img = Image.frombytes("L", (pw, ph), lin, "bcn", (4, "BC4S" if typ == 2 else "BC4"))
        elif n == 5:
            img = Image.frombytes("RGB", (pw, ph), lin, "bcn", (5, "BC5S" if typ == 2 else "BC5"))
        elif n == 6:
            img = Image.frombytes("RGB", (pw, ph), lin, "bcn", (6, "BC6HS" if typ == 2 else "BC6H"))
        else:
            img = Image.frombytes("RGBA", (pw, ph), lin, "bcn", (n, {1: "DXT1", 2: "DXT3", 3: "DXT5"}.get(n, "BC%d" % n)))
        img = img.convert("RGBA")
    elif name == "R8G8B8A8":
        img = Image.frombytes("RGBA", (pw, ph), lin)
    elif name == "B8G8R8A8":
        img = Image.frombytes("RGBA", (pw, ph), lin, "raw", "BGRA")
    elif name == "R8":
        a = np.frombuffer(lin, np.int8 if typ == 2 else np.uint8).reshape(ph, pw)
        if typ == 2:  # SNORM -> 0..255 (v/127 * 0.5 + 0.5)
            a = np.round((np.clip(a.astype(np.float32) / 127, -1, 1) * 0.5 + 0.5) * 255).astype(np.uint8)
        img = Image.fromarray(np.ascontiguousarray(a), "L").convert("RGBA")
    elif name == "R8G8":
        a = np.frombuffer(lin, np.int8 if typ == 2 else np.uint8).reshape(ph, pw, 2)
        if typ == 2:
            a = np.round((np.clip(a.astype(np.float32) / 127, -1, 1) * 0.5 + 0.5) * 255).astype(np.uint8)
        rgba = np.zeros((ph, pw, 4), np.uint8)
        rgba[..., 0] = a[..., 0]
        rgba[..., 1] = a[..., 1]
        rgba[..., 3] = 255
        img = Image.fromarray(rgba, "RGBA")
    elif name == "R5G6B5":
        v = np.frombuffer(lin, "<u2").reshape(ph, pw).astype(np.uint32)
        rgba = np.zeros((ph, pw, 4), np.uint8)
        rgba[..., 0] = ((v & 0x1F) * 255 // 31)
        rgba[..., 1] = (((v >> 5) & 0x3F) * 255 // 63)
        rgba[..., 2] = (((v >> 11) & 0x1F) * 255 // 31)
        rgba[..., 3] = 255
        img = Image.fromarray(rgba, "RGBA")
    else:
        raise NotImplementedError(name)
    return img.crop((0, 0, width, height))


def write_hdr(path, rgb):
    """Radiance RGBE (flat scanlines; three.js RGBELoader/HDRLoader reads them)."""
    rgb = np.maximum(np.asarray(rgb, np.float32), 0)
    h, w = rgb.shape[:2]
    mx = rgb.max(axis=2)
    e = np.zeros((h, w), np.int32)
    m = mx > 1e-32
    mant, ex = np.frexp(mx[m])
    e[m] = ex
    scale = np.zeros((h, w), np.float32)
    scale[m] = mant * 256.0 / mx[m]
    out = np.zeros((h, w, 4), np.uint8)
    for c in range(3):
        out[..., c] = np.clip(np.floor(rgb[..., c] * scale), 0, 255)
    out[..., 3] = np.where(m, e + 128, 0)
    with open(path, "wb") as f:
        f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n" % (h, w))
        f.write(out.tobytes())


def decode_bc6h_float(t, layer=0, mip=0):
    """BC6H -> float32 RGB through imagecodecs (bcdec). Pillow's BC6H path clamps to 8 bit."""
    import imagecodecs
    name, bw, bh, bpp = FORMATS[t.format >> 8]
    width = max(1, t.width >> mip)
    height = max(1, t.height >> mip)
    lin, wb, hb = deswizzle(surface_bytes(t, layer, mip), width, height, bw, bh, bpp, t.block_height_log2, shrink=mip > 0)
    out = imagecodecs.bcn_decode(lin, -6 if (t.format & 0xFF) == 5 else 6, shape=(hb * bh, wb * bw, 3))
    return np.asarray(out, np.float32)[:height, :width]


def apply_comp(img, comp):
    """Apply BRTI channel selectors (what the shader samples)."""
    a = np.asarray(img.convert("RGBA"))
    out = np.empty_like(a)
    for dst in range(4):
        s = comp[dst]
        if s == 0:
            out[..., dst] = 0
        elif s == 1:
            out[..., dst] = 255
        else:
            out[..., dst] = a[..., s - 2]
    from PIL import Image
    return Image.fromarray(out, "RGBA")


def meta(t):
    return {
        "name": t.name, "format": t.fmt_name, "formatRaw": "0x%04X" % t.format, "width": t.width, "height": t.height,
        "depth": t.depth, "array": t.array, "mips": t.mips, "storageDim": STORAGE.get(t.dim, t.dim), "viewDim": DIMS.get(t.view_dim, t.view_dim),
        "flags": t.flags, "tileMode": t.tile_mode, "swizzle": t.swizzle, "samples": t.samples, "access": "0x%X" % t.access,
        "blockHeightLog2": t.block_height_log2, "layout": t.layout, "layout2": t.layout2, "imageSize": t.image_size,
        "alignment": t.alignment, "comp": "".join(COMP.get(c, "?") for c in t.comp), "srgb": (t.format & 0xFF) == 6,
    }


def to_png(t, out_dir, normal_z=True):
    """Write mip0 of each layer. Normal maps (BC5 two-channel, name _nml) get Z rebuilt into B."""
    os.makedirs(out_dir, exist_ok=True)
    m = meta(t)
    files = []
    for layer in range(max(1, t.array)):
        img = apply_comp(decode_layer(t, layer, 0), t.comp)
        if normal_z and (t.format >> 8) == 0x1E and t.name.endswith("_nml"):
            a = np.asarray(img).astype(np.float32)
            x = a[..., 0] / 255 * 2 - 1
            y = a[..., 1] / 255 * 2 - 1
            z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
            b = np.asarray(img).copy()
            b[..., 2] = np.round((z * 0.5 + 0.5) * 255).astype(np.uint8)
            b[..., 3] = 255
            from PIL import Image
            img = Image.fromarray(b, "RGBA")
            m["normalZRebuilt"] = True
        # drop alpha when fully opaque
        a = np.asarray(img)
        if (a[..., 3] == 255).all():
            img = img.convert("RGB")
        fn = t.name + (".png" if t.array <= 1 else "_%02d.png" % layer)
        img.save(os.path.join(out_dir, fn), optimize=False, compress_level=6)
        files.append(fn)
        if (t.format >> 8) == 0x1F:
            try:
                f = decode_bc6h_float(t, layer, 0)
                hn = fn[:-4] + ".hdr"
                write_hdr(os.path.join(out_dir, hn), f)
                m.setdefault("hdrFiles", []).append(hn)
                m["hdrMax"] = max(m.get("hdrMax", 0.0), float(f.max()))
            except ImportError:
                m["hdrError"] = "imagecodecs not installed"
    m["files"] = files
    return m


def cmd_info(paths):
    for p in paths:
        with open(p, "rb") as f:
            data = f.read()
        for t in parse(data):
            print(json.dumps(meta(t), ensure_ascii=False))


def cmd_png(out_dir, paths):
    ok = fail = 0
    for p in paths:
        with open(p, "rb") as f:
            data = f.read()
        for t in parse(data):
            try:
                m = to_png(t, out_dir)
                with open(os.path.join(out_dir, t.name + ".json"), "w", encoding="utf-8") as f:
                    json.dump(m, f, ensure_ascii=False, indent=1)
                ok += 1
            except Exception as e:
                print("FAIL", p, t.name, t.fmt_name, type(e).__name__, e)
                fail += 1
    print("png: ok %d fail %d -> %s" % (ok, fail, out_dir))


def cmd_stats(root, out):
    from collections import Counter
    c = {k: Counter() for k in ("format", "flags", "tileMode", "dim", "viewDim", "array", "mips", "comp", "size",
                                 "layerStrideExact", "blockHeightLog2", "access", "samples", "depth", "suffix->format",
                                 "arrayNames", "flags->dim", "version", "texPerFile", "swizzle")}
    total_bytes = Counter()
    n = 0
    examples = {}
    for dp, dn, fns in os.walk(root):
        for fn in fns:
            if not fn.endswith(".bntx"):
                continue
            p = os.path.join(dp, fn)
            with open(p, "rb") as f:
                head = f.read(0x10000)
                size = os.fstat(f.fileno()).st_size
            try:
                texs = parse(head)
            except Exception:
                with open(p, "rb") as f:
                    texs = parse(f.read())
            c["texPerFile"][len(texs)] += 1
            for t in texs:
                n += 1
                c["version"]["0x%08X" % t.version] += 1
                c["format"][t.fmt_name] += 1
                total_bytes[t.fmt_name] += t.image_size
                c["flags"]["0x%02X" % t.flags] += 1
                c["flags->dim"]["0x%02X %s/%s" % (t.flags, STORAGE.get(t.dim), DIMS.get(t.view_dim))] += 1
                c["tileMode"][t.tile_mode] += 1
                c["swizzle"][t.swizzle] += 1
                c["dim"][STORAGE.get(t.dim, t.dim)] += 1
                c["viewDim"][DIMS.get(t.view_dim, t.view_dim)] += 1
                c["array"][t.array] += 1
                c["mips"][t.mips] += 1
                c["depth"][t.depth] += 1
                c["samples"][t.samples] += 1
                c["access"]["0x%X" % t.access] += 1
                c["blockHeightLog2"][t.block_height_log2] += 1
                c["comp"]["".join(COMP.get(x, "?") for x in t.comp)] += 1
                c["size"]["%dx%d" % (t.width, t.height)] += 1
                c["layerStrideExact"][t.image_size % max(1, t.array) == 0] += 1
                suf = t.name.rsplit("_", 1)[-1] if "_" in t.name else t.name
                c["suffix->format"]["%s %s" % (suf, t.fmt_name)] += 1
                if t.array > 1:
                    c["arrayNames"][suf if "_arr_" not in t.name else "_arr_ " + suf] += 1
                key = "flags 0x%02X" % t.flags
                examples.setdefault(key, os.path.relpath(p, root).replace("\\", "/") + ":" + t.name)
                examples.setdefault("fmt " + t.fmt_name, os.path.relpath(p, root).replace("\\", "/") + ":" + t.name)
                if t.array > 1:
                    examples.setdefault("array %d %s" % (t.array, t.name.rsplit("_", 1)[-1]), os.path.relpath(p, root).replace("\\", "/") + ":" + t.name)
    res = {"textures": n, "bytesByFormat": {k: v for k, v in total_bytes.most_common()}, "examples": examples}
    for k, v in c.items():
        res[k] = {str(a): b for a, b in v.most_common()}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print("stats: %d textures -> %s" % (n, out))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "info":
        cmd_info(sys.argv[2:])
    elif cmd == "png":
        cmd_png(sys.argv[2], sys.argv[3:])
    elif cmd == "stats":
        cmd_stats(sys.argv[2], sys.argv[3])
