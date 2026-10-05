"""glb node tree dump: local TRS + world position + world euler(XYZ deg) per node.
usage: glb_nodes.py <a.glb> [...]   (prints text; --json for JSON)"""
import json, struct, sys, math
import numpy as np


def load(p):
    b = open(p, 'rb').read()
    n = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + n])


def q2m(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])


def local(n):
    if 'matrix' in n:
        return np.array(n['matrix']).reshape(4, 4).T
    m = np.eye(4)
    r = q2m(n.get('rotation', [0, 0, 0, 1]))
    s = n.get('scale', [1, 1, 1])
    m[:3, :3] = r * np.array(s)[None, :]
    m[:3, 3] = n.get('translation', [0, 0, 0])
    return m


def euler_xyz(R):
    # R = Rz*Ry*Rx (intrinsic XYZ as FRES EulerXYZ)
    sy = -R[2, 0]
    sy = max(-1, min(1, sy))
    y = math.asin(sy)
    if abs(sy) < 0.99999:
        x = math.atan2(R[2, 1], R[2, 2]); z = math.atan2(R[1, 0], R[0, 0])
    else:
        x = math.atan2(-R[1, 2], R[1, 1]); z = 0
    return [math.degrees(v) for v in (x, y, z)]


def walk(g):
    nodes = g['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    out = []
    def rec(i, M, d):
        n = nodes[i]
        W = M @ local(n)
        S = np.linalg.norm(W[:3, :3], axis=0)
        R = W[:3, :3] / np.where(S == 0, 1, S)
        out.append({'name': n.get('name', '#%d' % i), 'depth': d, 'local_t': n.get('translation'), 'local_r': n.get('rotation'),
                    'local_s': n.get('scale'), 'world_pos': [round(float(v), 4) for v in W[:3, 3]],
                    'world_euler_xyz_deg': [round(v, 3) for v in euler_xyz(R)], 'world_scale': [round(float(v), 4) for v in S],
                    'mesh': n.get('mesh')})
        for c in n.get('children', []):
            rec(c, W, d + 1)
    roots = g['scenes'][g.get('scene', 0)]['nodes']
    for r in roots:
        rec(r, np.eye(4), 0)
    return out


if __name__ == '__main__':
    js = '--json' in sys.argv
    res = {}
    for p in [a for a in sys.argv[1:] if not a.startswith('--')]:
        res[p] = walk(load(p))
        if not js:
            print('#', p)
            for r in res[p]:
                print('  ' * r['depth'] + r['name'], 'pos', r['world_pos'], 'rotXYZ', r['world_euler_xyz_deg'], 's', r['world_scale'], '' if r['mesh'] is None else 'mesh')
    if js:
        print(json.dumps(res, indent=1, ensure_ascii=False))
