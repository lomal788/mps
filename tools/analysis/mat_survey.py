"""glb extras.fres 재질 조사 — hsmg402 무대·눈덩이·캐릭터(web/assets) 재질 옵션·샘플러·renderInfo 표.
사용: python web/tools/analysis/mat_survey.py  →  analysis/mat/hsmg402_mats.json, analysis/mat/hsmg402_options.tsv
"""
import json, struct, glob, os, collections
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
def load(p):
    b = open(p, 'rb').read()
    n = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + n])
files = sorted(glob.glob(f'{ROOT}/web/assets/hsmg402/model/*.glb')) + sorted(glob.glob(f'{ROOT}/web/assets/chara/*/model/*.glb'))
out = []
for p in files:
    g = load(p)
    used = collections.Counter()
    for me in g.get('meshes', []):
        for pr in me['primitives']:
            if 'material' in pr: used[pr['material']] += 1
    for i, m in enumerate(g.get('materials', [])):
        f = (m.get('extras') or {}).get('fres') or {}
        sh = f.get('shader') or {}
        out.append({
            'file': os.path.relpath(p, ROOT).replace(os.sep, '/'),
            'name': m.get('name'), 'prims': used[i],
            'archive': sh.get('archive'), 'model': sh.get('model'),
            'options': sh.get('options') or {},
            'samplerAssign': sh.get('samplerAssign') or {},
            'attribAssign': sh.get('attribAssign') or {},
            'samplers': [(s['sampler'], s['texture']) for s in f.get('samplers', [])],
            'renderInfo': {k: v for k, v in (f.get('renderInfo') or {}).items()},
            'params': {k: v.get('value') for k, v in (f.get('params') or {}).items()},
            'gltf': {k: m[k] for k in m if k not in ('extras', 'name')},
        })
os.makedirs(f'{ROOT}/analysis/mat', exist_ok=True)
json.dump(out, open(f'{ROOT}/analysis/mat/hsmg402_mats.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
keys = sorted({k for o in out for k in o['options']})
with open(f'{ROOT}/analysis/mat/hsmg402_options.tsv', 'w', encoding='utf-8') as w:
    w.write('option\t' + '\t'.join(f"{os.path.basename(o['file'])[:-4]}:{o['name']}" for o in out) + '\n')
    w.write('archive\t' + '\t'.join(str(o['archive']) for o in out) + '\n')
    for k in keys:
        w.write(k + '\t' + '\t'.join(o['options'].get(k, '') for o in out) + '\n')
print(len(files), 'files', len(out), 'materials', len(keys), 'option keys')
