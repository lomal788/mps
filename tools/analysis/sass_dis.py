"""Maxwell(Tegra X1) 셰이더 코드 디스어셈블 + 이름 주석.
envydis(envytools gm107, tools/envydis_build/envydis.exe, zig cc 로 빌드)로 풀고, bfsha 리플렉션(web/tools/analysis/bfsha_dump)으로
  cN[off]  → 유니폼 블록 이름.필드 (N = 블록 위치 + 3, 오프셋은 bfsha 의 offset−1)
  texs/tex/tld 핸들 h → 샘플러 (h = 8 + 2×샘플러 위치)
  a[0x80+16i+4c] → 입출력 슬롯 i.c,  a[0x7c] → 위치 w
를 붙인다(위치 규칙은 sky_mt·aurora 등에서 핸들 0x8 = 위치 0, Material 위치 9 = c12 로 맞춰 확인).

사용: python web/tools/analysis/sass_dis.py <tag> [fs|vs]     (tag = analysis/mat/prog/match.json 의 used.tag)
      python web/tools/analysis/sass_dis.py --all              → analysis/mat/sass/<tag>.<fs|vs>.txt 전부
"""
import json, os, re, struct, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ENVYDIS = os.path.join(ROOT, 'tools', 'envydis_build', 'envydis.exe')
PROG = os.path.join(ROOT, 'analysis', 'mat', 'prog')
SHPK = os.path.join(ROOT, 'analysis', 'mat', 'shpk')
OUT = os.path.join(ROOT, 'analysis', 'mat', 'sass')
ANSI = re.compile(r'\x1b\[[0-9;]*m')


def load_match():
    return json.load(open(os.path.join(PROG, 'match.json'), encoding='utf-8'))


def model_info(pack, arch, model):
    d = json.load(open(os.path.join(SHPK, pack, arch + '.json'), encoding='utf-8'))
    return next(m for m in d if m['name'] == model)


def disasm(path):
    b = open(path, 'rb').read()
    code = b[0x80:]
    words = struct.unpack_from(f'<{len(code) // 4}I', code)
    txt = ' '.join(f'0x{x:08x}' for x in words).encode()
    # 바이너리(-i) 입력은 Windows 표준입력 텍스트 모드에서 0x1A 에서 끊기므로 32비트 단어 hex 텍스트(-w)로 넘긴다
    r = subprocess.run([ENVYDIS, '-m', 'gm107', '-n', '-q', '-w'], input=txt, capture_output=True)
    lines = []
    for ln in r.stdout.decode('ascii', 'replace').splitlines():
        ln = ANSI.sub('', ln).strip()
        if not ln or ln.startswith('sched'):
            continue
        lines.append(ln)
        if re.match(r'^(exit|kil)\b', ln) and False:
            break
    # 끝: 자기 자신으로 가는 bra 루프 뒤는 패딩
    out = []
    for ln in lines:
        if re.match(r'^[0-9a-f]{8}:$', ln):
            out.append(ln)
            continue
        prev = [x for x in out if not re.match(r'^[0-9a-f]{8}:$', x)]
        if ln.startswith('bra ') and prev and prev[-1].startswith('exit') and out[-1] == ln.split()[-1][2:].rjust(8, '0') + ':':
            out.pop()
            break
        out.append(ln)
    return out


def annotate(lines, info, used, stage):
    blocks = {b['name']: b for b in info['uniformBlocks']}
    loc_key = 'f' if stage == 'fs' else 'v'
    cmap = {}
    for b in used['blocks']:
        loc = b[loc_key]
        if loc >= 0:
            blk = blocks[b['name']]
            fields = sorted(((u['offset'] - 1, u['name']) for u in blk['uniforms']), key=lambda x: x[0])
            cmap[loc + 3] = (b['name'], fields)
    smap = {}
    for s in used['samplers']:
        loc = s[loc_key]
        if loc >= 0:
            smap[8 + 2 * loc] = s["name"]

    def cname(m):
        n = int(m.group(1)); off = int(m.group(2), 16)
        if n not in cmap:
            return m.group(0)
        bn, fields = cmap[n]
        best = None
        for fo, fn in fields:
            if fo <= off:
                best = (fo, fn)
        if best is None:
            return f'{bn}[{off:#x}]'
        d = off - best[0]
        return f'{bn}.{best[1]}' + (f'+{d:#x}' if d else '')

    def aname(m):
        off = int(m.group(1), 16)
        if off == 0x7c:
            return 'a[pos.w]'
        if off == 0x70:
            return 'a[pos.x]'
        if off == 0x74:
            return 'a[pos.y]'
        if off == 0x78:
            return 'a[pos.z]'
        if 0x80 <= off < 0x280:
            i = (off - 0x80) // 16; c = 'xyzw'[(off - 0x80) % 16 // 4]
            return f'a[v{i}.{c}]'
        return m.group(0)

    out = []
    for ln in lines:
        s = re.sub(r'c(\d+)\[(0x[0-9a-f]+)\]', cname, ln)
        s = re.sub(r'a\[(0x[0-9a-f]+)\]', aname, s)
        if re.match(r'^(texs|tex|tld|tlds|tld4|tld4s|txq|tmml|txd)\b', s):
            def hname(m):
                h = int(m.group(1), 16)
                return f'{{{smap.get(h, hex(h))}}}'
            s = re.sub(r' (0x[0-9a-f]+) (t1d|t2d|t3d|tcube|a2d|a1d|lz|ll|lb|lba|dc|aoffi|ndv)', lambda m: ' ' + hname(m) + ' ' + m.group(2), s, count=1)
        out.append(s)
    return out


def run(tag, stage, entry):
    pack, arch, _ = tag.split('__')
    info = model_info(pack, arch, entry['model'])
    lines = disasm(os.path.join(PROG, f'{tag}.{stage}1.bin'))
    return annotate(lines, info, entry['used'], stage)


def main():
    match = load_match()
    by_tag = {}
    for e in match:
        if e.get('used'):
            by_tag.setdefault(e['used']['tag'], e)
    if sys.argv[1] == '--all':
        os.makedirs(OUT, exist_ok=True)
        for tag, e in by_tag.items():
            for st in ('fs', 'vs'):
                txt = run(tag, st, e)
                head = f'// {tag} {st}  재질 예: {e["file"]} {e["name"]}\n'
                open(os.path.join(OUT, f'{tag}.{st}.txt'), 'w', encoding='utf-8').write(head + '\n'.join(txt) + '\n')
        print(len(by_tag), 'programs')
        return
    tag = sys.argv[1]; st = sys.argv[2] if len(sys.argv) > 2 else 'fs'
    print('\n'.join(run(tag, st, by_tag[tag])))


if __name__ == '__main__':
    main()
