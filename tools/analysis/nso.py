"""NSO(NSO0) 압축 해제 — 세 세그먼트(.text/.rodata/.data)를 메모리 배치대로 펼친 평면 이미지와 동적 심볼 수를 낸다.

  .venv/Scripts/python web/tools/analysis/nso.py extracted/exefs/main extracted/exefs/main.decomp.bin
"""
import struct
import sys

import lz4.block


def load(path):
    d = open(path, "rb").read()
    if d[:4] != b"NSO0":
        raise ValueError("not NSO0")
    flags = struct.unpack_from("<I", d, 0xC)[0]
    segs = []
    for i in range(3):
        foff, moff, msize = struct.unpack_from("<III", d, 0x10 + i * 0x10)
        csize = struct.unpack_from("<I", d, 0x60 + i * 4)[0]
        raw = d[foff:foff + csize]
        data = lz4.block.decompress(raw, uncompressed_size=msize) if flags >> i & 1 else raw[:msize]
        segs.append((moff, data))
    bss = struct.unpack_from("<I", d, 0x3C)[0]
    end = max(m + len(x) for m, x in segs) + bss
    img = bytearray(end)
    for m, x in segs:
        img[m:m + len(x)] = x
    return img, segs, bss


def main():
    img, segs, bss = load(sys.argv[1])
    for i, (m, x) in enumerate(segs):
        print(f"seg{i} mem=0x{m:X} size=0x{len(x):X}")
    print(f"bss=0x{bss:X} image=0x{len(img):X}")
    if len(sys.argv) > 2:
        open(sys.argv[2], "wb").write(img)
        print("wrote", sys.argv[2])


if __name__ == "__main__":
    main()
