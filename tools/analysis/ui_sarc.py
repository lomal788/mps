"""SARC (Nintendo archive) reader — Jamboree .lyt 는 SARC 이다.

사용:
  ui_sarc.py list <file.lyt>
  ui_sarc.py extract <file.lyt> <out_dir>
"""
import struct
import sys
from pathlib import Path


def name_hash(name: str, key: int) -> int:
    h = 0
    for c in name.encode("utf-8"):
        h = (h * key + (c if c < 0x80 else c - 0x100)) & 0xFFFFFFFF
    return h


def parse(buf: bytes):
    if buf[:4] != b"SARC":
        raise ValueError("not SARC")
    hdr_len, bom = struct.unpack_from("<HH", buf, 4)
    if bom != 0xFEFF:
        raise ValueError("big-endian SARC not supported")
    file_size, data_off, version = struct.unpack_from("<IIH", buf, 8)
    o = hdr_len
    if buf[o:o + 4] != b"SFAT":
        raise ValueError("no SFAT")
    sfat_len, count, key = struct.unpack_from("<HHI", buf, o + 4)
    nodes = []
    for i in range(count):
        h, attr, start, end = struct.unpack_from("<IIII", buf, o + sfat_len + i * 16)
        nodes.append((h, attr, start, end))
    o = o + sfat_len + count * 16
    if buf[o:o + 4] != b"SFNT":
        raise ValueError("no SFNT")
    sfnt_len = struct.unpack_from("<H", buf, o + 4)[0]
    names_base = o + sfnt_len
    files = []
    for h, attr, start, end in nodes:
        name = None
        if attr >> 24 == 1:
            p = names_base + (attr & 0xFFFFFF) * 4
            q = buf.index(b"\0", p)
            name = buf[p:q].decode("utf-8")
            if name_hash(name, key) != h:
                raise ValueError(f"hash mismatch {name}")
        files.append({
            "name": name,
            "hash": h,
            "offset": data_off + start,
            "size": end - start,
        })
    return {"version": version, "hash_key": key, "data_offset": data_off, "file_size": file_size, "files": files}


def read_files(path):
    buf = Path(path).read_bytes()
    arc = parse(buf)
    return {f["name"] or f"{f['hash']:08x}": buf[f["offset"]:f["offset"] + f["size"]] for f in arc["files"]}


if __name__ == "__main__":
    cmd, path = sys.argv[1], sys.argv[2]
    buf = Path(path).read_bytes()
    arc = parse(buf)
    if cmd == "list":
        print(f"SARC v0x{arc['version']:04x} key=0x{arc['hash_key']:x} files={len(arc['files'])}")
        for f in arc["files"]:
            print(f"{f['size']:>9} {buf[f['offset']:f['offset'] + 4]!r:12} {f['name']}")
    elif cmd == "extract":
        out = Path(sys.argv[3])
        for f in arc["files"]:
            d = out / (f["name"] or f"{f['hash']:08x}.bin")
            d.parent.mkdir(parents=True, exist_ok=True)
            d.write_bytes(buf[f["offset"]:f["offset"] + f["size"]])
        print(out, len(arc["files"]))
