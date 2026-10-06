"""hsmg402 웹 재질 자료 — web/assets/hsmg402/material/ (web/tools/analysis/hsmg402_web_assets.py 가 지우는 폴더 밖이라 따로 둔다).

만드는 것
  material/material.json
    rules    "<glb 이름>:<재질>" → { 셰이더 샘플러: {uv: glb TEXCOORD 번호, srt: texsrt 번호|null, tex: 원본 텍스처} }
             (web/tools/analysis/mat_uvmap.py 결과에서 좌표가 정점 UV 로 이어지는 샘플만. 원본 셰이더 VS/FS 판독 — web/docs/engine/03_graphics.md)
    textures 원본 텍스처 이름 → {file, hdr, srgb}  (glb 에 없는 것: 라이트맵·셰이더 그래프 입력)
    env      lightmap_color_scale (env.fmdb env_mt)
  material/tex/*.png|*.hdr  — extracted/converted/hsmg402/graphics/tex 원본 디코드 그대로(BC6H 는 .hdr)
사용: .venv/Scripts/python web/tools/analysis/hsmg402_mat_assets.py   (먼저 web/tools/analysis/mat_survey.py → bfsha_dump match → sass_dis.py --all → mat_uvmap.py)
"""
import json, os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'extracted', 'converted', 'hsmg402', 'graphics')
DST = os.path.join(ROOT, 'web', 'assets', 'hsmg402', 'material')

# 화면이 쓰는 glb 밖 텍스처(재질 규칙이 참조하는 것만)
EXTRA = [
    'hsmg402_base_lmp',      # forward_plus_map _l0 라이트맵(bg·ice·tree)
    'hsmg402_cliff_lmp',     # 절벽 그래프 utilitySampler0
    'hsmg402_cloud_mask',    # 구름 그래프 utilitySampler0 (두 번)
    'hsmg402_aurora_grad02', # 구름 그래프 _e0
    'hsmg402_aurora_grad00', # 오로라 그래프 utilitySampler0
    'hsmg402_aurora_grad01', # 오로라 그래프 _e0 (overlay 합성·알파 ×(1 + e.r))
    'hsmg402_aurora_mask',   # 오로라 그래프 utilitySampler2
    'hsmg402_fld_dif',       # 눈 그래프 utilitySampler2 (확산 램프)
    'hsmg402_fld_sg_alb',    # 눈 그래프 utilitySampler0 (최종 곱, 지면)
    'hsmg402_snowball_alb',  # 눈 그래프 utilitySampler0 (최종 곱, 눈덩이)
]
# 재질 국소 IBL 큐브(BC6H 6면 .hdr, 원본 면 순서 +X −X +Y −Y +Z −Z) — 눈덩이 irradianceIbl
CUBES = [
    'hsmg402_snowball_irr',
]


def main():
    uvmap = json.load(open(os.path.join(ROOT, 'analysis', 'mat', 'hsmg402_uvmap.json'), encoding='utf-8'))
    rules = {}
    for key, ent in uvmap.items():
        r = {s: {'uv': v['uv'], 'srt': v['srt'], 'tex': v['tex']} for s, v in ent.items() if v['uv'] is not None}
        if r:
            rules[key] = r
    if os.path.exists(DST):
        shutil.rmtree(DST)
    os.makedirs(os.path.join(DST, 'tex'))
    textures = {}
    for name in EXTRA:
        meta = json.load(open(os.path.join(SRC, 'tex', name + '.json'), encoding='utf-8'))
        fmt = meta['format']
        hdr = fmt.startswith('BC6H')
        ext = '.hdr' if hdr else '.png'
        shutil.copyfile(os.path.join(SRC, 'tex', name + ext), os.path.join(DST, 'tex', name + ext))
        textures[name] = {'file': f'material/tex/{name}{ext}', 'hdr': hdr, 'srgb': fmt.endswith('_SRGB'), 'format': fmt}
    for name in CUBES:
        meta = json.load(open(os.path.join(SRC, 'tex', name + '.json'), encoding='utf-8'))
        files = []
        for f in meta['hdrFiles']:
            shutil.copyfile(os.path.join(SRC, 'tex', f), os.path.join(DST, 'tex', f))
            files.append(f'material/tex/{f}')
        textures[name] = {'file': files[0], 'hdr': True, 'srgb': False, 'format': meta['format'], 'cube': files}
    env = json.load(open(os.path.join(SRC, 'meta', 'hsmg402_env.dump.json'), encoding='utf-8'))
    params = env[0]['models'][0]['materials'][0]['params']
    out = {
        'source': 'tools/hsmg402_mat_assets.py (원본 셰이더 판독: tools/bfsha_dump·sass_dis.py·mat_uvmap.py, web/docs/engine/03_graphics.md)',
        'env': {'lightmap_color_scale': params['lightmap_color_scale']['value']},
        'textures': textures,
        'rules': rules,
    }
    json.dump(out, open(os.path.join(DST, 'material.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    size = sum(os.path.getsize(os.path.join(DST, 'tex', f)) for f in os.listdir(os.path.join(DST, 'tex')))
    print(len(rules), 'rules', len(textures), 'textures', f'{size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
