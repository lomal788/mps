import json
import struct
import sys
from pathlib import Path


def parse(buf):
    if buf[:8] != b"MsgStdBn":
        raise ValueError("not MSBT")
    bom = buf[8:10]
    e = "<" if bom == b"\xff\xfe" else ">"
    enc = {0: "utf-8", 1: "utf-16-le" if e == "<" else "utf-16-be"}[buf[0xC]]
    nsec = struct.unpack_from(e + "H", buf, 0xE)[0]
    off = 0x20
    labels = {}
    texts = []
    for _ in range(nsec):
        magic = buf[off:off + 4]
        size = struct.unpack_from(e + "I", buf, off + 4)[0]
        body = off + 0x10
        if magic == b"LBL1":
            n = struct.unpack_from(e + "I", buf, body)[0]
            for i in range(n):
                cnt, loff = struct.unpack_from(e + "II", buf, body + 4 + i * 8)
                p = body + loff
                for _ in range(cnt):
                    ln = buf[p]
                    name = buf[p + 1:p + 1 + ln].decode("ascii")
                    idx = struct.unpack_from(e + "I", buf, p + 1 + ln)[0]
                    labels[idx] = name
                    p += 1 + ln + 4
        elif magic == b"TXT2":
            n = struct.unpack_from(e + "I", buf, body)[0]
            offs = [struct.unpack_from(e + "I", buf, body + 4 + i * 4)[0] for i in range(n)] + [size]
            for i in range(n):
                raw = buf[body + offs[i]:body + offs[i + 1]]
                texts.append(decode_text(raw, enc, e))
        off = body + (size + 0xF & ~0xF)
    return {labels.get(i, f"#{i}"): t for i, t in enumerate(texts)}


def decode_text(raw, enc, e):
    if not enc.startswith("utf-16"):
        return raw.decode(enc, "replace").rstrip("\0")
    out = []
    i = 0
    while i + 1 < len(raw):
        c = struct.unpack_from(e + "H", raw, i)[0]
        i += 2
        if c == 0:
            break
        if c == 0x0E:
            group, tag, plen = struct.unpack_from(e + "HHH", raw, i)
            params = raw[i + 6:i + 6 + plen]
            i += 6 + plen
            out.append(f"[{group}:{tag}{':' + params.hex() if params else ''}]")
        elif c == 0x0F:
            group, tag = struct.unpack_from(e + "HH", raw, i)
            i += 4
            out.append(f"[/{group}:{tag}]")
        else:
            out.append(chr(c))
    return "".join(out)


if __name__ == "__main__":
    out_dir = Path(sys.argv[1])
    for p in sys.argv[2:]:
        d = parse(Path(p).read_bytes())
        dst = out_dir / (Path(p).stem + ".json")
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        print(p, len(d))
