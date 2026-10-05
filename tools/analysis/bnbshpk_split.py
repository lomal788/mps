"""BEZSHAPK(.bnbshpk, 장면·캐릭터별 셰이더 팩) → 안의 FSHA 들을 따로 저장.
헤더: 'BEZSHAPK' u32 ver(0x00010000) BOM ... +0x28 u64 개수, +0x30 u64[개수] FSHA 오프셋 (끝 = 파일 끝).
FSHA 이름은 FSHA 헤더 +0x10 의 이름 문자열 오프셋(u32, 파일 기준, 앞 u16 길이)에서 읽는다.
사용: python web/tools/analysis/bnbshpk_split.py <x.bnbshpk> <outdir>
"""
import struct, sys, os
def split(path, outdir):
    b = open(path, 'rb').read()
    assert b[:8] == b'BEZSHAPK'
    n = struct.unpack_from('<Q', b, 0x28)[0]
    offs = list(struct.unpack_from(f'<{n}Q', b, 0x30)) + [len(b)]
    os.makedirs(outdir, exist_ok=True)
    out = []
    for i in range(n):
        d = b[offs[i]:offs[i + 1]]
        assert d[:4] == b'FSHA'
        no = struct.unpack_from('<I', d, 0x10)[0]
        ln = struct.unpack_from('<H', d, no - 2)[0] if no >= 2 else 0
        name = d[no:no + ln].decode('ascii', 'replace') if 0 < ln < 200 else f'fsha{i}'
        fn = os.path.join(outdir, f'{name}.bfsha')
        open(fn, 'wb').write(d)
        out.append((i, hex(offs[i]), len(d), name))
    return out
if __name__ == '__main__':
    for r in split(sys.argv[1], sys.argv[2]): print(*r)
