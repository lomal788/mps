"""PhysX 3.4 (.apx 'SEBD' 0x03040000) TRIANGLE_MESH_BVH33 vertices/triangles - heuristic reader.

Layout observed in mg/hsmg402/data/map/5de38a06....apx (matched 1:1 against hsmg402_col.fmdb):
  mesh object:  ... u32 flags (bit1 = 16-bit indices, PxTriangleMeshFlag::e16_BIT_INDICES) , u32 nbVerts, u32 nbTris
                (the three u32 follow a 0x12345678,0 marker pair; first such triple found after the object base)
  extra data:   RTree pages ..., then vertices f32x3 * nbVerts (16-B aligned), then indices (u16|u32)x3 * nbTris (16-B aligned),
                then u8 per-triangle extra flags.
Vertex array start is found by scanning 16-B aligned offsets for an array whose following index block is valid
(all indices < nbVerts, every vertex used). Multi-mesh files: every (flags,nv,nt) triple is tried in order.

usage: scene_apx34_mesh.py <a.apx> [--obj out.obj] [--json out.json]
       scene_apx34_mesh.py --survey <dir>          (count files where every mesh triple resolves)
"""
import json
import os
import struct
import sys

import numpy as np


def triples(b):
    res = []
    o = 0x20
    while o + 0x18 <= len(b):
        a, z, fl, nv, nt = struct.unpack_from('<5I', b, o)
        if a == 0x12345678 and z == 0 and fl in (0, 1, 2, 3, 4, 6) and 3 <= nv < 1 << 20 and 1 <= nt < 1 << 21 and nt * 3 >= nv - 1:
            res.append((o + 8, fl, nv, nt))
        o += 4
    return res


def find_mesh(b, fl, nv, nt, start=0):
    w = 2 if fl & 2 else 4
    dt = '<u2' if w == 2 else '<u4'
    for o in range((start + 15) // 16 * 16, len(b) - nv * 12, 16):
        ie = (o + nv * 12 + 15) // 16 * 16
        if ie + nt * 3 * w > len(b):
            break
        I = np.frombuffer(b, dtype=dt, count=nt * 3, offset=ie)
        if I.max() >= nv:
            continue
        if len(np.unique(I)) < nv - 1:
            continue
        V = np.frombuffer(b, dtype='<f4', count=nv * 3, offset=o).reshape(-1, 3)
        if not np.all(np.isfinite(V)) or np.abs(V).max() > 1e5:
            continue
        return o, ie, V.astype(float), I.reshape(-1, 3).astype(int)
    return None


def read(path):
    b = open(path, 'rb').read()
    if b[:4] != b'SEBD' or struct.unpack_from('<I', b, 4)[0] != 0x03040000:
        raise ValueError('not PhysX 3.4 SEBD')
    meshes = []
    pos = 0
    for (to, fl, nv, nt) in triples(b):
        r = find_mesh(b, fl, nv, nt, max(pos, to))
        if r is None:
            meshes.append({'countsAt': to, 'flags': fl, 'nbVerts': nv, 'nbTris': nt, 'error': 'not found'})
            continue
        vo, io, V, I = r
        pos = io + nt * 3 * (2 if fl & 2 else 4)
        meshes.append({'countsAt': to, 'flags': fl, 'nbVerts': nv, 'nbTris': nt, 'vertsAt': vo, 'indicesAt': io,
                       'bboxMin': V.min(0).round(4).tolist(), 'bboxMax': V.max(0).round(4).tolist(), 'V': V, 'I': I})
    return meshes


def main():
    a = sys.argv[1:]
    if a and a[0] == '--survey':
        ok = bad = 0
        for dp, dn, fns in os.walk(a[1]):
            for fn in fns:
                if fn.endswith('.apx'):
                    try:
                        ms = read(os.path.join(dp, fn))
                        good = ms and all('error' not in m for m in ms)
                    except Exception:
                        good = False
                    ok += bool(good)
                    bad += not good
        print(json.dumps({'ok': ok, 'notResolved': bad}))
        return
    ms = read(a[0])
    for m in ms:
        print({k: (hex(v) if k.endswith('At') else v) for k, v in m.items() if k not in ('V', 'I')})
    if '--obj' in a:
        with open(a[a.index('--obj') + 1], 'w') as f:
            base = 1
            for m in ms:
                if 'V' not in m:
                    continue
                for v in m['V']:
                    f.write('v %.6f %.6f %.6f\n' % tuple(v))
                for t in m['I']:
                    f.write('f %d %d %d\n' % tuple(t + base))
                base += len(m['V'])
    if '--json' in a:
        with open(a[a.index('--json') + 1], 'w') as f:
            json.dump([{**{k: v for k, v in m.items() if k not in ('V', 'I')},
                        **({'vertices': m['V'].round(5).tolist(), 'triangles': m['I'].tolist()} if 'V' in m else {})} for m in ms], f)


if __name__ == '__main__':
    main()
