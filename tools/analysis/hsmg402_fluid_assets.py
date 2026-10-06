"""hsmg402 눈 자국(유체 높이장) 웹 자료 → web/assets/hsmg402/fluid/ (다른 에셋 스크립트가 지우지 않는 폴더).
  .venv/Scripts/python web/tools/analysis/hsmg402_fluid_assets.py

내보내는 것
  - fluid.json: hsmg402_fluid.fmdb 재질 fld_fluid 파라미터 [데이터], 캐릭터별 붓 재질(*fluid_m) → 붓 텍스처 png·utilityParameter1.x
  - <pcNN>_foot_hgt.png / <pcNN>_body_hgt.png: 캐릭터 붓 높이 텍스처(BC4_SNORM). png 값 t = (v + 1) / 2 (v = 원본 SNORM −1..1)
    BC4 SNORM 은 직접 디코드한다 — Pillow 'BC4S' 는 부호 끝점 보간이 틀리다(끝점 (−127, 127) 보간 2 → −128, 맞는 값 −76)
판독 근거: web/docs/minigame/hsmg402.md 7.5, web/docs/engine/03_graphics.md 유체 절
"""
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import graphics_bntx as bntx  # noqa: E402

DST = os.path.join(ROOT, 'web', 'assets', 'hsmg402', 'fluid')
BEA = os.path.join(ROOT, 'extracted', 'bea')
FLUID_DUMP = os.path.join(ROOT, 'extracted', 'converted', 'hsmg402', 'graphics', 'meta', 'hsmg402_fluid.dump.json')
CHARA = os.path.join(ROOT, 'web', 'assets', 'chara')


def bc4_snorm(lin: bytes, bw: int, bh: int) -> np.ndarray:
    """선형 BC4 SNORM 블록 → float32 (bh*4, bw*4), 값 −1..1"""
    blk = np.frombuffer(lin, np.uint8).reshape(bh * bw, 8)
    r0 = np.maximum(blk[:, 0].view(np.int8).astype(np.float32) / 127.0, -1.0)
    r1 = np.maximum(blk[:, 1].view(np.int8).astype(np.float32) / 127.0, -1.0)
    bits = np.zeros(len(blk), np.uint64)
    for k in range(6):
        bits |= blk[:, 2 + k].astype(np.uint64) << np.uint64(8 * k)
    eight = r0 > r1
    pal = np.zeros((len(blk), 8), np.float32)
    pal[:, 0] = r0
    pal[:, 1] = r1
    for i in range(1, 7):
        pal[:, 1 + i] = np.where(eight, ((7 - i) * r0 + i * r1) / 7.0, 0)
    for i in range(1, 5):
        pal[:, 1 + i] = np.where(eight, pal[:, 1 + i], ((5 - i) * r0 + i * r1) / 5.0)
    pal[:, 6] = np.where(eight, pal[:, 6], -1.0)
    pal[:, 7] = np.where(eight, pal[:, 7], 1.0)
    out = np.zeros((len(blk), 16), np.float32)
    for p in range(16):
        idx = ((bits >> np.uint64(3 * p)) & np.uint64(7)).astype(np.int64)
        out[:, p] = pal[np.arange(len(blk)), idx]
    img = out.reshape(bh, bw, 4, 4).transpose(0, 2, 1, 3).reshape(bh * 4, bw * 4)
    return img


def decode_snorm_tex(t) -> np.ndarray:
    name, bw, bh, bpp = bntx.FORMATS[t.format >> 8]
    if name != 'BC4' or (t.format & 0xFF) != 2:
        raise ValueError(f'{t.name}: BC4_SNORM 아님 ({t.fmt_name})')
    lin, wb, hb = bntx.deswizzle(bntx.surface_bytes(t, 0, 0), t.width, t.height, bw, bh, bpp, t.block_height_log2)
    return bc4_snorm(lin, wb, hb)[: t.height, : t.width]


def glb_json(path: str) -> dict:
    d = open(path, 'rb').read()
    n = struct.unpack_from('<I', d, 12)[0]
    return json.loads(d[20:20 + n])


def main() -> None:
    os.makedirs(DST, exist_ok=True)
    dump = json.load(open(FLUID_DUMP, encoding='utf-8'))
    mat = dump[0]['models'][0]['materials'][0]
    params = {k: v['value'] for k, v in mat['params'].items()}
    index = json.load(open(os.path.join(CHARA, 'index.json'), encoding='utf-8'))
    brushes: dict = {}
    for ck, ent in index.items():
        key = ent['key']
        g = glb_json(os.path.join(CHARA, ent['glb']))
        bpath = os.path.join(BEA, f'chara~pc~{key}.nx.bea', 'chara', 'pc', key, 'model', 'textures_chara', 'pc', f'{key}.bntx')
        texs = {t.name: t for t in bntx.parse(open(bpath, 'rb').read())}
        mats = {}
        for m in g['materials']:
            f = m.get('extras', {}).get('fres', {})
            if f.get('shader', {}).get('archive') != 'forward_plus_fluid':
                continue
            sa = f['shader'].get('samplerAssign', {})
            smp = sa.get('utilitySampler0', 'utilitySampler0')
            tname = next((s['texture'] for s in f.get('samplers', []) if s['sampler'] == smp), None)
            if not tname or tname not in texs:
                print('붓 텍스처 없음', key, m['name'], tname)
                continue
            v = decode_snorm_tex(texs[tname])
            png = f'{tname}.png'
            Image.fromarray(np.round((v + 1.0) * 127.5).clip(0, 255).astype(np.uint8), 'L').save(os.path.join(DST, png))
            u1 = f.get('params', {}).get('utilityParameter1', {}).get('value', [1, 1, 1, 1])
            hs = f.get('params', {}).get('heightScale', {}).get('value')
            mats[m['name']] = {'tex': png, 'u1x': u1[0], 'heightScale': hs, 'min': float(v.min()), 'max': float(v.max()), 'center': float(v[v.shape[0] // 2, v.shape[1] // 2])}
        brushes[ck] = mats
        print(ck, {k: (x['tex'], x['u1x'], round(x['min'], 3), round(x['center'], 3)) for k, x in mats.items()})
    out = {
        'source': 'web/tools/analysis/hsmg402_fluid_assets.py (hsmg402_fluid.fmdb fld_fluid, chara BNTX BC4_SNORM)',
        'params': params,
        'clear': 'tex/hsmg402_fld_clear.png',
        'snowballBrush': 'tex/hsmg402_fluid0_hgt.png',
        'brushes': brushes,
    }
    json.dump(out, open(os.path.join(DST, 'fluid.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('fluid.json', DST)


if __name__ == '__main__':
    main()
