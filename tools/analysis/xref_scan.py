"""main.decomp.bin 에서 ADRP+ADD/LDR 로 특정 주소를 만드는 코드 위치 찾기. 사용: xref_scan.py <bin> <addr_hex>... (오프셋 = 이미지 오프셋)"""
import sys
import numpy as np

def scan(data, targets, text_end=None):
    n = (len(data) if text_end is None else text_end) // 4
    w = np.frombuffer(data[:n * 4], dtype="<u4")
    is_adrp = (w & 0x9F000000) == 0x90000000
    idx = np.nonzero(is_adrp)[0]
    ins = w[idx].astype(np.int64)
    immlo = (ins >> 29) & 3
    immhi = (ins >> 5) & 0x7FFFF
    imm = (immhi << 2) | immlo
    imm = np.where(imm & (1 << 20), imm - (1 << 21), imm)
    page = ((idx * 4) & ~0xFFF) + (imm << 12)
    rd = ins & 31
    out = []
    for t in targets:
        tp = t & ~0xFFF
        for k in np.nonzero(page == tp)[0]:
            i = idx[k]
            r = rd[k]
            for j in range(1, 8):
                if i + j >= n:
                    break
                x = int(w[i + j])
                # ADD imm (64-bit)
                if (x & 0xFF800000) == 0x91000000 and ((x >> 5) & 31) == r:
                    sh = (x >> 22) & 1
                    im = ((x >> 10) & 0xFFF) << (12 * sh)
                    if tp + im == t:
                        out.append((t, i * 4, i * 4 + j * 4))
                    break
                # LDR (unsigned imm) 64-bit / 32-bit
                if (x & 0xFFC00000) in (0xF9400000, 0xB9400000) and ((x >> 5) & 31) == r:
                    scale = 8 if (x & 0xFFC00000) == 0xF9400000 else 4
                    im = ((x >> 10) & 0xFFF) * scale
                    if tp + im == t:
                        out.append((t, i * 4, i * 4 + j * 4))
                    break
    return out

if __name__ == "__main__":
    data = open(sys.argv[1], "rb").read()
    ts = [int(a, 16) for a in sys.argv[2:]]
    for t, a, b in scan(data, ts):
        print(f"target {t:#x}  adrp @{a:#x}  use @{b:#x}")
