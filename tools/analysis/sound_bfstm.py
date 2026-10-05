"""BFSTM(스트림 사운드) 헤더·루프·리전 읽기와 vgmstream 디코드, 점프 설정(msgpack) 읽기.

사용:
  python web/tools/analysis/sound_bfstm.py info <bfstm>                  헤더·루프·리전 JSON
  python web/tools/analysis/sound_bfstm.py decode <bfstm> <out.wav>       vgmstream 으로 루프 무시 1회 디코드
  python web/tools/analysis/sound_bfstm.py jump <라벨>                     audio/jump_setting/conv/<라벨>.msgpack 내용

구조 [데이터: 표본 SM_BGM_MG1801_DH, SM_BGM_MG0101_JMP, SM_AMB_MG1801_MG_RESULT]
  헤더 0x40(또는 0x60): 'FSTM', BOM, headerSize, version 0x00060400, fileSize, nBlocks, 블록 참조(INFO 0x4000, SEEK 0x4001, DATA 0x4002, REGN 0x4003)
  INFO 본문 +0x00 ref(0x4100 StreamInfo) → u8 encoding, u8 loop, u8 channels, u8 regionCount, u32 sampleRate, u32 loopStart, u32 frameCount(=loopEnd),
        u32 blockCount, blockSize, blockSamples, lastBlockSize, lastBlockSamples, lastBlockPadded, seekSize, seekInterval,
        ref sampleData, u16 regionInfoSize, pad, ref regionData, u32 originalLoopStart, u32 originalLoopEnd, u32 crc
  REGN 본문 + regionData offset: 엔트리 regionInfoSize(0x100) 바이트 = u32 start, u32 end, 채널별 DSP 문맥(u16 ps, s16 yn1, s16 yn2)×16, u32 사용(1), … , +0xC0 이름 char[0x40]
"""
from __future__ import annotations

import json
import struct
import subprocess
import sys
from pathlib import Path

import msgpack

ROOT = Path(__file__).resolve().parents[3]
VGM = ROOT / 'tools/vgmstream/vgmstream-cli.exe'
JUMP_DIR = ROOT / 'extracted/bea/audio.nx.bea/audio/jump_setting/conv'
ENC = {0: 'pcm8', 1: 'pcm16', 2: 'dsp_adpcm', 3: 'ima_adpcm'}


def info(path):
    b = Path(path).read_bytes()
    assert b[:4] == b'FSTM', b[:4]
    ver = struct.unpack_from('<I', b, 8)[0]
    nblk = struct.unpack_from('<H', b, 0x10)[0]
    blocks = {}
    for i in range(nblk):
        t, _, off, size = struct.unpack_from('<HHiI', b, 0x14 + 12 * i)
        blocks[t] = (off, size)
    ioff = blocks[0x4000][0]
    base = ioff + 8
    _t, _p, so = struct.unpack_from('<HHi', b, base)
    p = base + so
    enc, loop, nch, nreg = b[p], b[p + 1], b[p + 2], b[p + 3]
    rate, ls, n = struct.unpack_from('<III', b, p + 4)
    (blocks_n, bsize, bsamp, lbsize, lbsamp, lbpad, seeksz, seekint) = struct.unpack_from('<8I', b, p + 16)
    q = p + 48 + 8
    reg_size = struct.unpack_from('<H', b, q)[0]
    _rt, _rp, roff = struct.unpack_from('<HHi', b, q + 4)
    orig_ls, orig_le = struct.unpack_from('<II', b, q + 12)
    out = {'file': Path(path).name, 'version': hex(ver), 'encoding': ENC.get(enc, enc), 'loop': bool(loop),
           'channels': nch, 'sampleRate': rate, 'loopStart': ls, 'frames': n, 'seconds': n / rate,
           'loopStartSec': ls / rate, 'loopEndSec': n / rate,
           'originalLoopStart': orig_ls, 'originalLoopEnd': orig_le,
           'blockSamples': bsamp, 'regionCount': nreg, 'regions': []}
    if nreg and 0x4003 in blocks and roff != -1:
        rb = blocks[0x4003][0] + 8 + roff
        for i in range(nreg):
            e = rb + reg_size * i
            st, en = struct.unpack_from('<II', b, e)
            used = struct.unpack_from('<I', b, e + 0x68)[0]
            name = b[e + 0xC0: e + 0x100].split(b'\0')[0].decode('ascii', 'replace')
            out['regions'].append({'name': name, 'start': st, 'end': en, 'startSec': st / rate,
                                   'endSec': en / rate, 'flag68': used})
    return out


def decode(path, out_wav):
    Path(out_wav).parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run([str(VGM), '-i', '-o', str(out_wav), str(path)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return out_wav


def jump(label):
    p = JUMP_DIR / f'{label}.msgpack'
    if not p.exists():
        return None
    d = msgpack.unpackb(p.read_bytes(), raw=False, strict_map_key=False)
    rows = d.get(label, [])
    out = []
    for r in rows:
        params = [r[f'param{i}'] for i in range(1, 19) if r.get(f'param{i}', '') != '']
        out.append({'key': r['key'], 'label': r['label'], 'params': params})
    return {'paramCount': d.get('system', {}).get('ParamCount'), 'rows': out}


def main(argv):
    if argv[:1] == ['info']:
        print(json.dumps(info(argv[1]), ensure_ascii=False, indent=1))
    elif argv[:1] == ['decode']:
        print(decode(argv[1], argv[2]))
    elif argv[:1] == ['jump']:
        print(json.dumps(jump(argv[1]), ensure_ascii=False, indent=1))
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
