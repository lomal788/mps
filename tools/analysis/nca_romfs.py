import argparse
import bisect
import hashlib
import os
import struct
import sys
from pathlib import Path

import lz4.block
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def load_keys(path):
    keys = {}
    for line in open(path, encoding="utf-8"):
        if "=" in line:
            k, v = line.split("=", 1)
            keys[k.strip()] = bytes.fromhex(v.strip())
    return keys


def xts_decrypt_header(raw, header_key):
    out = bytearray()
    for sector in range(len(raw) // 0x200):
        tweak = sector.to_bytes(16, "big")
        dec = Cipher(algorithms.AES(header_key), modes.XTS(tweak)).decryptor()
        out += dec.update(raw[sector * 0x200:(sector + 1) * 0x200]) + dec.finalize()
    return bytes(out)


class Nca:
    def __init__(self, path, header_key, content_key, base=0):
        self.f = open(path, "rb")
        self.base = base
        self.f.seek(base)
        self.hdr = xts_decrypt_header(self.f.read(0xC00), header_key)
        if self.hdr[0x200:0x204] != b"NCA3":
            raise SystemExit("header decrypt failed")
        self.content_key = content_key
        self.sections = []
        for i in range(4):
            start, end = struct.unpack_from("<II", self.hdr, 0x240 + i * 0x10)
            if start == end == 0:
                continue
            fs = self.hdr[0x400 + i * 0x200:0x600 + i * 0x200]
            self.sections.append({
                "index": i,
                "offset": start * 0x200,
                "size": (end - start) * 0x200,
                "fs_type": fs[2],
                "hash_type": fs[3],
                "enc_type": fs[4],
                "fs": fs,
                "ctr_hi": fs[0x140:0x148][::-1],
            })

    def read(self, sec, off, size):
        abs_off = sec["offset"] + off
        aligned = abs_off & ~0xF
        pad = abs_off - aligned
        self.f.seek(self.base + aligned)
        data = self.f.read(size + pad + 0xF & ~0xF if (size + pad) % 16 else size + pad)
        if sec["enc_type"] == 3:
            ctr = sec["ctr_hi"] + (aligned >> 4).to_bytes(8, "big")
            dec = Cipher(algorithms.AES(self.content_key), modes.CTR(ctr)).decryptor()
            data = dec.update(data) + dec.finalize()
        elif sec["enc_type"] != 1:
            raise SystemExit(f"unsupported enc_type {sec['enc_type']}")
        return data[pad:pad + size]


def ivfc_levels(sec):
    fs = sec["fs"]
    magic, ver, master_size, nlevels = struct.unpack_from("<4sIII", fs, 0x8)
    assert magic == b"IVFC", magic
    levels = []
    for i in range(nlevels - 1):
        off, size, bs_log2 = struct.unpack_from("<QQI", fs, 0x18 + i * 0x18)
        levels.append((off, size, 1 << bs_log2))
    master = fs[0x8 + 0xC0:0x8 + 0xC0 + master_size]
    return levels, master


def verify_ivfc(nca, sec, chunk=64 << 20):
    levels, master = ivfc_levels(sec)
    bad = []
    prev_hashes = None
    for li, (off, size, bs) in enumerate(levels):
        expect = master if li == 0 else None
        nblocks = (size + bs - 1) // bs
        level_bad = 0
        pos = 0
        print(f"  level {li}: off=0x{off:x} size=0x{size:x} bs=0x{bs:x} blocks={nblocks}", flush=True)
        level_data = bytearray() if li < len(levels) - 1 else None
        while pos < size:
            n = min(chunk, size - pos)
            data = nca.read(sec, off + pos, n)
            if level_data is not None:
                level_data += data
            for b in range(0, n, bs):
                blk = data[b:b + bs]
                if len(blk) < bs:
                    blk = blk + b"\0" * (bs - len(blk))
                h = hashlib.sha256(blk).digest()
                bi = (pos + b) // bs
                ref = expect if li == 0 else prev_hashes[bi * 32:bi * 32 + 32]
                if h != ref:
                    level_bad += 1
                    if len(bad) < 50:
                        bad.append((li, bi, off + pos + b))
            pos += n
            if li == len(levels) - 1 and (pos // chunk) % 16 == 0:
                print(f"    {pos / size * 100:5.1f}%  bad={level_bad}", flush=True)
        print(f"  level {li}: bad blocks = {level_bad}", flush=True)
        prev_hashes = bytes(level_data) if level_data is not None else None
    return bad


class RomfsView:
    def __init__(self, nca, sec):
        self.nca = nca
        self.sec = sec
        levels, _ = ivfc_levels(sec)
        self.data_off = levels[-1][0]
        fs = sec["fs"]
        t_off, t_size = struct.unpack_from("<QQ", fs, 0x178)
        self.entries = None
        if t_size:
            magic, ver, count = struct.unpack_from("<4sIi", fs, 0x188)
            assert magic == b"BKTR", magic
            table = self.phys(t_off, t_size)
            l1_count = struct.unpack_from("<i", table, 4)[0]
            ents = []
            for node in range(l1_count):
                base = 0x4000 * (1 + node)
                n = struct.unpack_from("<i", table, base + 4)[0]
                for e in range(n):
                    vo, po, ctype, clevel, _, psize = struct.unpack_from("<qqBbHI", table, base + 0x10 + e * 0x18)
                    ents.append((vo, po, ctype, clevel, psize))
            assert len(ents) == count, (len(ents), count)
            self.end = struct.unpack_from("<q", table, 8)[0]
            self.entries = ents
            self.starts = [e[0] for e in ents]
        self.cache = (None, None)

    def phys(self, off, size):
        return self.nca.read(self.sec, self.data_off + off, size)

    def chunk(self, i):
        if self.cache[0] == i:
            return self.cache[1]
        vo, po, ctype, clevel, psize = self.entries[i]
        vend = self.entries[i + 1][0] if i + 1 < len(self.entries) else self.end
        vsize = vend - vo
        if ctype == 3:
            data = lz4.block.decompress(self.phys(po, psize), uncompressed_size=vsize)
        elif ctype == 1:
            data = b"\0" * vsize
        else:
            raise ValueError(f"chunk type {ctype}")
        self.cache = (i, data)
        return data

    def read(self, off, size):
        if self.entries is None:
            return self.phys(off, size)
        out = bytearray()
        while size > 0:
            i = bisect.bisect_right(self.starts, off) - 1
            vo, po, ctype, clevel, psize = self.entries[i]
            vend = self.entries[i + 1][0] if i + 1 < len(self.entries) else self.end
            n = min(size, vend - off)
            if ctype == 0:
                out += self.phys(po + (off - vo), n)
            else:
                out += self.chunk(i)[off - vo:off - vo + n]
            off += n
            size -= n
        return bytes(out)


def romfs_walk(view):
    data_off = 0
    hdr = view.read(0, 0x50)
    (hsize, dh_off, dh_size, dm_off, dm_size, fh_off, fh_size, fm_off, fm_size, fdata_off) = struct.unpack("<10Q", hdr)
    dmeta = view.read(dm_off, dm_size)
    fmeta = view.read(fm_off, fm_size)

    def dname(o):
        n = struct.unpack_from("<I", dmeta, o + 0x14)[0]
        return dmeta[o + 0x18:o + 0x18 + n].decode("utf-8")

    def fname(o):
        n = struct.unpack_from("<I", fmeta, o + 0x1C)[0]
        return fmeta[o + 0x20:o + 0x20 + n].decode("utf-8")

    NONE = 0xFFFFFFFF
    out = []
    stack = [(0, "")]
    while stack:
        do, path = stack.pop()
        _, _, child_dir, child_file = struct.unpack_from("<IIII", dmeta, do)
        fo = child_file
        while fo != NONE:
            _, sib, off, size = struct.unpack_from("<IIQQ", fmeta, fo)
            out.append((f"{path}/{fname(fo)}", data_off + fdata_off + off, size))
            fo = sib
        co = child_dir
        while co != NONE:
            sib = struct.unpack_from("<I", dmeta, co + 4)[0]
            stack.append((co, f"{path}/{dname(co)}"))
            co = sib
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("nca")
    ap.add_argument("--keys", required=True)
    ap.add_argument("--content-key", required=True)
    ap.add_argument("--base", type=lambda s: int(s, 0), default=0)
    ap.add_argument("cmd", choices=["info", "verify", "list", "extract"])
    ap.add_argument("--out")
    a = ap.parse_args()
    keys = load_keys(a.keys)
    nca = Nca(a.nca, keys["header_key"], bytes.fromhex(a.content_key), a.base)
    romfs = [s for s in nca.sections if s["hash_type"] == 3]
    if a.cmd == "info":
        for s in nca.sections:
            print({k: (hex(v) if isinstance(v, int) else v.hex()) for k, v in s.items() if k != "fs"})
        for s in romfs:
            levels, master = ivfc_levels(s)
            for i, l in enumerate(levels):
                print(f"  ivfc {i}: off=0x{l[0]:x} size=0x{l[1]:x} bs=0x{l[2]:x}")
            print("  master", master.hex())
        return
    sec = romfs[0]
    if a.cmd == "verify":
        bad = verify_ivfc(nca, sec)
        for b in bad:
            print("  BAD level", b[0], "block", b[1], "section_off", hex(b[2]))
        return
    view = RomfsView(nca, sec)
    files = romfs_walk(view)
    if a.cmd == "list":
        for p, off, size in sorted(files):
            print(f"{size:12d}  {p}")
        print(len(files), "files", sum(f[2] for f in files), "bytes", file=sys.stderr)
        return
    out = Path(a.out)
    for i, (p, off, size) in enumerate(sorted(files)):
        dst = out / p.lstrip("/")
        dst.parent.mkdir(parents=True, exist_ok=True)
        with open(dst, "wb") as w:
            pos = 0
            while pos < size:
                n = min(64 << 20, size - pos)
                w.write(view.read(off + pos, n))
                pos += n
        if i % 500 == 0:
            print(f"{i}/{len(files)} {p}", flush=True)
    print("done", len(files))


if __name__ == "__main__":
    main()
