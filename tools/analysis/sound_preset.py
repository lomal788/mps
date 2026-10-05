"""bex 사운드 세팅 프리셋(audio/settingpreset/sound_settingpreset.bspp) 파서.

사용:
  python web/tools/analysis/sound_preset.py list                    프리셋 이름 목록
  python web/tools/analysis/sound_preset.py show <이름> [...]       프리셋 레코드(라벨 치환 등)를 사람이 읽는 형태로
  python web/tools/analysis/sound_preset.py json <out.json> <이름>...  JSON 으로

형식 [데이터: 표본 해석, 의미는 04_sound.md 2.6 참고]
  헤더: 'BSPP', u32 프리셋 수, u32 표2 수, u32 1, u32 표3 수(실제 항목은 +1), 그다음 표 3개(각 항목 0x28 = 이름 char[0x20], u32 해시, u32 offset)
  데이터 기준 = 표3 끝. 프리셋 = 'BSSP', u32 레코드 수, u32 문자열 수, 레코드(12×u32) × n, 문자열 표(NUL 구분)
  레코드 'U'(0x55): [U, 0, src 문자열 offset, dst offset ×5, 0×4] — 라벨 치환으로 판단(dst 5칸의 뜻은 미확정)
"""
from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parents[3] / 'extracted/bea/audio.nx.bea/audio/settingpreset/sound_settingpreset.bspp'


def load(path=PATH):
    b = Path(path).read_bytes()
    assert b[:4] == b'BSPP'
    n1, n2, _one, _n3 = struct.unpack_from('<4I', b, 4)
    p = 0x18

    def table(n):
        nonlocal p
        out = []
        for _ in range(n):
            name = b[p:p + 0x20].split(b'\0')[0].decode('ascii')
            h, off = struct.unpack_from('<II', b, p + 0x20)
            out.append({'name': name, 'hash': h, 'offset': off})
            p += 0x28
        return out

    presets = table(n1)
    archives = table(n2)
    spaces = []
    while re.fullmatch(rb'[a-z0-9_]+\x00*', b[p:p + 0x20]):
        spaces.extend(table(1))
    base = p
    offs = sorted({e['offset'] for e in presets} | {len(b) - base})
    for e in presets:
        e['size'] = offs[offs.index(e['offset']) + 1] - e['offset']
    return b, base, presets, archives, spaces


def parse_block(b, p):
    assert b[p:p + 4] == b'BSSP', b[p:p + 4]
    nrec, nstr = struct.unpack_from('<II', b, p + 4)
    q = p + 12
    recs = []
    for _ in range(nrec):
        recs.append(struct.unpack_from('<12I', b, q))
        q += 48
    strbase = q
    strings = {}
    for _ in range(nstr):
        e = b.index(b'\0', q)
        strings[q - strbase] = b[q:e].decode('ascii', 'replace')
        q = e + 1
    out = []
    for r in recs:
        t = chr(r[0]) if 32 <= r[0] < 127 else hex(r[0])
        d = {'type': t, 'raw': list(r)}
        if t == 'U':
            d['src'] = strings.get(r[2], r[2])
            d['dst'] = [strings.get(x, x) for x in r[3:8]]
        else:
            d['f32'] = [round(struct.unpack('<f', struct.pack('<I', x))[0], 6) for x in r[1:]]
            d['strs'] = {str(i): strings[x] for i, x in enumerate(r[1:5], 1) if x in strings and (x != 0 or i == 1)}
        out.append(d)
    return {'records': out, 'strings': list(strings.values()), 'end': q}


def preset(name):
    b, base, presets, _, _ = load()
    e = next(x for x in presets if x['name'] == name)
    p = base + e['offset']
    end = p + e['size']
    blocks = []
    while p < end and b[p:p + 4] == b'BSSP':
        blk = parse_block(b, p)
        blocks.append(blk)
        p = blk['end']
        while p < end and b[p:p + 4] != b'BSSP':
            p += 1
    return {'name': name, 'offset': e['offset'], 'size': e['size'], 'blocks': blocks}


def main(argv):
    if argv[:1] == ['list']:
        _, _, presets, archives, spaces = load()
        print(len(presets), 'presets;', len(archives), 'archive names;', len(spaces), 'space names')
        print(' '.join(sorted(x['name'] for x in presets)))
    elif argv[:1] == ['show']:
        for n in argv[1:]:
            pr = preset(n)
            print('=====', n, pr['size'])
            for bi, blk in enumerate(pr['blocks']):
                for r in blk['records']:
                    if r['type'] == 'U':
                        print(f'  [{bi}] U {r["src"]} -> {r["dst"]}')
                    else:
                        print(f'  [{bi}] {r["type"]} raw={[hex(x) for x in r["raw"][1:]]} f32={r["f32"]} strs={r["strs"]}')
    elif argv[:1] == ['json']:
        out = {n: preset(n) for n in argv[2:]}
        Path(argv[1]).parent.mkdir(parents=True, exist_ok=True)
        Path(argv[1]).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
        print(argv[1])
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
