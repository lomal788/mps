"""재질별 "샘플러 → (메시 UV 번호, texsrt 번호)" 표를 원본 셰이더 코드에서 뽑는다.

입력: analysis/mat/sass/<tag>.{vs,fs}.txt (web/tools/analysis/sass_dis.py), analysis/mat/prog/match.json, analysis/mat/hsmg402_mats.json
방법(단순 자료흐름, 분기 무시):
  VS  ld a[vN.c] → 셰이더 입력 위치 N(속성 위치표: bfsha attributes) / fmul·ffma·fadd 에 Material.texsrtK 가 끼면 그 값은 "K 변환" /
      st a[vM.c] → 출력 varying M.c 의 출처
  FS  ipa a[vM.c] → 그 varying, mufu rcp/fmul(원근 나눔)은 출처 유지, texs/tex 좌표 레지스터의 출처 = 그 샘플러의 UV
  셰이더 입력 _uK → 메시 UV 는 재질 attribAssign(셰이더 이름 → 메시 이름)으로 바꾼다.
출력: analysis/mat/hsmg402_uvmap.json  { "<glb 파일 이름>:<재질>": { "<샘플러>": {"uv": glb TEXCOORD 번호(= 셰이더 _uK)|null, "srt": K|null, "src": "..."} } }
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
MAT = os.path.join(ROOT, 'analysis', 'mat')


def attr_locs(pack, arch, model):
    d = json.load(open(os.path.join(MAT, 'shpk', pack, arch + '.json'), encoding='utf-8'))
    m = next(x for x in d if x['name'] == model)
    return {a['location']: a['name'] for a in m['attributes']}


def parse_vs(lines, locs):
    reg = {}
    out = {}
    for ln in lines:
        t = ln.split()
        if not t:
            continue
        op = t[0]
        if op == 'ld' and 'a[v' in ln:
            m = re.search(r'\$r(\d+) a\[v(\d+)\.([xyzw])\]', ln)
            if m:
                reg[int(m.group(1))] = {'in': locs.get(int(m.group(2)), f'loc{m.group(2)}'), 'c': m.group(3), 'srt': None}
            continue
        if op == 'st' and 'a[v' in ln:
            m = re.search(r'a\[v(\d+)\.([xyzw])\] \$r(\d+)', ln)
            if m:
                out[f'v{m.group(1)}.{m.group(2)}'] = reg.get(int(m.group(3)))
            continue
        regs = [int(x) for x in re.findall(r'\$r(\d+)', ln)]
        if not regs:
            continue
        dst = regs[0]
        srt = re.search(r'Material\.texsrt(\d)', ln)
        srcs = [reg.get(r) for r in regs[1:] if reg.get(r)]
        if srt and srcs:
            s = srcs[0]
            reg[dst] = {'in': s['in'], 'c': s['c'], 'srt': int(srt.group(1))}
        elif op == 'mov' and len(regs) == 2 and reg.get(regs[1]):
            reg[dst] = reg[regs[1]]
        else:
            reg.pop(dst, None)
    return out


def parse_fs(lines, vary):
    reg = {}
    samp = {}
    for ln in lines:
        t = ln.split()
        if not t:
            continue
        if t[0] in ('$p0', 'not', '$p1', '$p2'):
            continue
        op = t[0]
        if op == 'ipa':
            m = re.search(r'\$r(\d+) a\[(v\d+\.[xyzw])\]', ln)
            if m:
                reg[int(m.group(1))] = vary.get(m.group(2)) and dict(vary[m.group(2)], v=m.group(2))
            continue
        if op in ('texs', 'tex', 'tld', 'tlds', 'tld4', 'tld4s'):
            m = re.search(r'\{([^}]+)\}', ln)
            regs = [int(x) for x in re.findall(r'\$r(\d+)', ln)]
            if m and len(regs) >= 3:
                name = m.group(1)
                if op == 'texs':
                    coords = regs[-2:]
                    dests = regs[:-2]
                else:
                    coords = regs[1:2]
                    dests = regs[:1]
                srcs = [reg.get(r) for r in coords]
                key = name
                k = 1
                while key in samp:
                    k += 1
                    key = f'{name}#{k}'
                if all(srcs) and srcs[0]['in'] == srcs[-1]['in']:
                    samp[key] = {'in': srcs[0]['in'], 'srt': srcs[0]['srt'], 'v': srcs[0]['v']}
                else:
                    samp[key] = None
                mm = re.search(r' (r|g|b|a|rg|ra|ga|ba|rgb|rgba)$', ln.strip())
                ncomp = len(mm.group(1)) if mm else 4
                for i, r in enumerate(dests):
                    reg.pop(r, None)
                    if ncomp >= (4 if (len(dests) == 2 and i == 0) else 2):
                        reg.pop(r + 1, None)
            continue
        regs = [int(x) for x in re.findall(r'\$r(\d+)', ln)]
        if not regs:
            continue
        dst = regs[0]
        if op in ('fmul', 'mov') and len(regs) >= 2 and 'Material' not in ln and 'Buffer' not in ln and 'View' not in ln:
            srcs = [reg.get(r) for r in regs[1:]]
            src = next((s for s in srcs if s), None)
            if src and sum(1 for s in srcs if s) == 1:
                reg[dst] = src
                continue
        reg.pop(dst, None)
    return samp


def main():
    match = json.load(open(os.path.join(MAT, 'prog', 'match.json'), encoding='utf-8'))
    mats = json.load(open(os.path.join(MAT, 'hsmg402_mats.json'), encoding='utf-8'))
    result = {}
    for e, m in zip(match, mats):
        u = e.get('used')
        if not u:
            continue
        tag = u['tag']
        pack, arch, _ = tag.split('__')
        vs = open(os.path.join(MAT, 'sass', tag + '.vs.txt'), encoding='utf-8').read().splitlines()[1:]
        fs = open(os.path.join(MAT, 'sass', tag + '.fs.txt'), encoding='utf-8').read().splitlines()[1:]
        locs = attr_locs(pack, arch, e['model'])
        vary = parse_vs(vs, locs)
        samp = parse_fs(fs, vary)
        assign = m['attribAssign']
        tex = dict(m['samplers'])
        sa = m['samplerAssign']
        ent = {}
        for k, s in samp.items():
            base = k.split('#')[0]
            mat_s = sa.get(base, base)
            if s is None:
                ent[k] = {'uv': None, 'srt': None, 'tex': tex.get(mat_s), 'src': 'computed'}
                continue
            shader_in = s['in']
            mesh = assign.get(shader_in, shader_in)
            # glb TEXCOORD_k 는 변환기(GltfExport.cs)가 attribAssign 을 거쳐 셰이더 입력 _uk 로 이미 맞춰 두었다 → 셰이더 번호를 쓴다
            uvn = int(shader_in[2:]) if re.fullmatch(r'_u\d', shader_in) else None
            ent[k] = {'uv': uvn, 'srt': s['srt'], 'tex': tex.get(mat_s), 'src': f'{shader_in}->{mesh} {s["v"]}'}
        key = f"{os.path.basename(e['file'])[:-4]}:{e['name']}"
        result[key] = ent
    json.dump(result, open(os.path.join(MAT, 'hsmg402_uvmap.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k, v in result.items():
        if k.startswith('pc0') and not k.startswith('pc01') and not k.startswith('pc07'):
            continue
        print(k)
        for s, x in v.items():
            print(f'   {s:18s} uv={x["uv"]} srt={x["srt"]} tex={x["tex"]}  ({x["src"]})')


if __name__ == '__main__':
    main()
