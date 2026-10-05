import argparse
import struct
import sys
from pathlib import Path

import zstandard

_zstd = zstandard.ZstdDecompressor()


def _str(buf, off):
    if off == 0:
        return None
    n = struct.unpack_from("<H", buf, off)[0]
    return buf[off + 2:off + 2 + n].decode("utf-8")


def parse(buf):
    if buf[:4] != b"SCNE":
        raise ValueError("not SCNE")
    version = struct.unpack_from("<I", buf, 8)[0]
    major2 = version >> 16 & 0xFF
    file_count, ref_count = struct.unpack_from("<II", buf, 0x20)
    if major2 >= 5:
        asset_off, info_off, dict_off, name_off, comp_off, ref_off = struct.unpack_from("<6Q", buf, 0x28)
    else:
        # 구버전(VersionMajor2 < 5, 마리오파티 슈퍼스타즈 0x00010100): FileInfo, Dict, unk, Name 만 있다 (BEA-Library-Editor BevelEngineArchive.cs)
        info_off, dict_off, _unk, name_off = struct.unpack_from("<4Q", buf, 0x28)
        comp_off, ref_off = 0, 0
    arc = {
        "version": version,
        "name": _str(buf, name_off),
        "compression": _str(buf, comp_off),
        "refs": [_str(buf, struct.unpack_from("<Q", buf, ref_off + i * 8)[0]) for i in range(ref_count)] if ref_off else [],
        "files": [],
    }
    for i in range(file_count):
        a = struct.unpack_from("<Q", buf, info_off + i * 8)[0]
        if buf[a:a + 4] != b"ASST":
            raise ValueError(f"bad ASST @0x{a:x}")
        unk, unk2, fsize, usize = struct.unpack_from("<HHII", buf, a + 0x10)
        id1 = id2 = 0
        if major2 >= 6:
            ftype = buf[a + 0x1C:a + 0x24].rstrip(b"\0").decode("ascii", "replace")
            unk3, id1, id2, foff, fname = struct.unpack_from("<IQQqQ", buf, a + 0x24)
        elif major2 == 5:
            ftype = buf[a + 0x1C:a + 0x24].rstrip(b"\0").decode("ascii", "replace")
            unk3, foff, fname = struct.unpack_from("<IqQ", buf, a + 0x24)
        else:
            ftype = ""
            unk3, foff, fname = struct.unpack_from("<IqQ", buf, a + 0x1C)
        arc["files"].append({
            "name": _str(buf, fname),
            "type": ftype,
            "flags": (unk, unk2),
            "unk3": unk3,
            "id": (id1, id2),
            "offset": foff,
            "size": fsize,
            "usize": usize,
        })
    return arc


def file_data(buf, f):
    raw = buf[f["offset"]:f["offset"] + f["size"]]
    if f["size"] != f["usize"] or raw[:4] == b"\x28\xb5\x2f\xfd":
        return _zstd.decompress(raw, max_output_size=max(f["usize"], 1))
    return raw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "extract"])
    ap.add_argument("bea", nargs="+")
    ap.add_argument("--out")
    a = ap.parse_args()
    for p in a.bea:
        buf = Path(p).read_bytes()
        arc = parse(buf)
        if a.cmd == "list":
            print(f"# {p} name={arc['name']} ver=0x{arc['version']:08x} comp={arc['compression']} files={len(arc['files'])} refs={arc['refs']}")
            for f in arc["files"]:
                print(f"{f['usize']:10d} {f['size']:10d} {f['type']:8s} {f['name']}")
            continue
        root = Path(a.out) / Path(p).name
        dirs = {n.rsplit("/", 1)[0] for n in (x["name"] for x in arc["files"]) if "/" in n}
        dirs = {d for x in dirs for d in ("/".join(x.split("/")[:k]) for k in range(1, x.count("/") + 2))}
        for f in arc["files"]:
            dst = root / f["name"]
            if f["name"] in dirs:
                # 같은 아카이브에 이 이름을 폴더로 쓰는 항목이 있다(예: hs_system/layout.lyt 묶음과 layout.lyt/*.lyt) — 파일 쪽에 접미를 붙인다
                dst = root / (f["name"] + ".__file__")
                print(f"name collides with directory, saved as {dst.name}: {p}:{f['name']}", file=sys.stderr)
            dst.parent.mkdir(parents=True, exist_ok=True)
            data = file_data(buf, f)
            if len(data) != f["usize"]:
                print(f"size mismatch {p}:{f['name']} {len(data)} != {f['usize']}", file=sys.stderr)
            dst.write_bytes(data)
        print(f"{p}: {len(arc['files'])} files", flush=True)


if __name__ == "__main__":
    main()
