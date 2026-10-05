"""hsmg402(데굴데굴 눈덩이) 웹 에셋 — 변환 결과(extracted/converted/…)에서 화면이 쓰는 것만 web/assets 로 옮기고 manifest 를 만든다.

  F:/dev/mps/.venv/Scripts/python web/tools/analysis/hsmg402_web_assets.py [--skip-chara] [--skip-sound] [--skip-ui] [--only-effects] [--only-env]

먼저 할 것(변환): web/tools/analysis/graphics_convert.py mps_hsmg402, mps_pcNN_hsmg402 ×10 (docs/minigame/hsmg402.md 9.8, analysis/notes/hsmg402_assets.md 15절).

만드는 것
  web/assets/hsmg402/manifest.json   입구(아래 키)
    models    무대·눈덩이 glb(이름 → {file, clips}). glb 이미지 uri 는 ../tex/*.png 그대로(변환기 출력 배치 유지)
    anims     카메라(fsnb)·재질 애니(fmab) JSON 경로
    env       평행광·안개·IBL 배율·포스트·유체 값(env/dir_light/fluid fmdb 덤프 그대로) + IBL 큐브 면 png·hdr + 색 보정 LUT png
    effects   이펙트 이미터셋(effect/sets.json: VFXB v40 이미터 수치, effect_vfxb.py) + 쓰는 텍스처(hsmg402·hs_system) + FX/SE 트리거 표
    sounds    라벨 → 재생 자료. 'seq' = FSEQ 원본 명령·뱅크·파형(web/script/view/seq.ts 실시간), 'stream' = BFSTM 디코드 wav
    substitute 사운드 프리셋 hsmg402 의 'b' 레코드(라벨 치환), listener3d = ']' 레코드 [추정: 3D 리스너, mpj 'P' 레코드와 비슷한 배치]
    bgm       BGM 라벨·리전(INTRO→MAIN 반복, audio/jump_setting CSV)
    ui        ui/ui.json(레이아웃·애니·텍스처·글자 아틀라스·문구·진동)
  web/assets/chara/index.json + pcNN/{model,tex}/ + pcNN/motions.json   플레이어블 10명 공용 캐릭터
    motions.json: 클립 13개의 프레임·루프, 눈 재질 애니(ftsb: eye_m texsrt0~2 이동), 뼈 표시(fvbb, 바뀌는 칸만), 모션 이벤트(ftrg +40, 원본 프레임)

원본 이미지·소리 픽셀/샘플은 바꾸지 않는다(복사·디코드만). 글자 아틀라스는 원본 FFNT 셀을 그대로 옮겨 붙인다.
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import re
import shutil
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "web" / "tools" / "analysis"))
import sound_bfstm  # noqa: E402
import sound_preset  # noqa: E402
import ui_bnvib  # noqa: E402
import ui_font  # noqa: E402
import ui_ftrg  # noqa: E402
import ui_lyt  # noqa: E402
import ui_render  # noqa: E402
import ui_sarc  # noqa: E402
from sound_fsar import Fsar  # noqa: E402
from sound_seq import SoundSet, disasm, parse_fseq, write_wav  # noqa: E402

EX = ROOT / "extracted"
BEA = EX / "bea"
CONV = EX / "converted"
SRC = CONV / "hsmg402"
WEB = ROOT / "web" / "assets"
DST = WEB / "hsmg402"
CHARA = WEB / "chara"

# 화면이 그리는 모델(코드가 싣는 모델 중 render_color 1 인 것) [데이터: NRO 문자열 + glb 재질 renderInfo]
# 뺀 것: fld_mask·ice_rev(render_color 0, 마스크·반사 전용), pos_*(뼈 표, 로직이 값으로 씀), col·dbg/height_clear(코드 미참조)
STAGE_MODELS = ["hsmg402_sky", "hsmg402_bg", "hsmg402_ice_far", "hsmg402_ice_mid", "hsmg402_ice_fix", "hsmg402_aurora",
                "hsmg402_fld", "hsmg402_fld_cliff", "hsmg402_snowball", "hsmg402_snowball_break"]
ANIMS = ["hsmg402_cam.fsnb", "hsmg402_cam_op.fsnb", "hsmg402_aurora.fmab", "hsmg402_bg.fmab", "hsmg402_sky.fmab",
         "hsmg402_snowball_break.fmab"]
# 눈 자국 근사용(유체 초기 텍스처·붓), IBL 큐브(env_mt 순서 rad, irr, chara_rad, chara_irr)
EXTRA_TEX = ["hsmg402_fld_clear.png", "hsmg402_fluid0_hgt.png"]
CUBES = ["hsmg402_rad", "hsmg402_irr", "hsmg402_chara_rad", "hsmg402_chara_irr"]
# 색 보정 3D LUT 16³(R8G8B8A8_SRGB, png 256×16 = z 조각 16장 가로) — post_mt color_lut [데이터]
ENV_LUT = "hsmg402_lut.png"

PCS = ["pc01_mario", "pc02_luigi", "pc03_peach", "pc04_daisy", "pc05_wario", "pc06_waluigi", "pc07_yoshi",
       "pc11_rosetta", "pc12_dk", "pc13_catherine"]
CLIPS = ["co_idle00", "co_walk00", "sb_make00", "sb_idle00", "sb_idle01", "sb_walk00", "sb_walk01", "sb_push00",
         "co_wriggle00", "co_damage02", "co_damage03", "co_win01a", "co_win01b"]

SE_ARC = BEA / "sound~subarc_hsmg402.nx.bea/audio/sounddata/subarc_hsmg402/subarc_hsmg402.fsst"
AMB_ARC = BEA / "sound~subarc_amb_blzard_1.nx.bea/audio/sounddata/subarc_amb_blzard_1/subarc_amb_blzard_1.fsst"
MAIN_FSPJ = BEA / "Resident.nx.bea/_Resident/AddonAudioProject.fspj"
SE_LABELS = ["SQ_SE_HSMG402_YKD_APP", "SQ_SE_HSMG402_YKD_MOV", "SQ_SE_HSMG402_YKD_MAX", "SQ_SE_HSMG402_YKD_MAX_SHN",
             "SQ_SE_HSMG402_YKD_FIR", "SQ_SE_HSMG402_YKD_FIR_MOV", "SQ_SE_HSMG402_YKD_HIT_YKD", "SQ_SE_HSMG402_YKD_HIT_PC",
             "SQ_SE_HSMG402_YKD_FAL", "SQ_SE_HSMG402_SB_MAKE00"]
BGM_LABEL = "SM_BGM_HSMG103_402_702_810_JMP"
# 프리셋 'b' 치환으로 나오는 결과 징글(SM_JIN_MG_WIN → _MP03, LOSE·DRAW → DRAW_MP03)
JINGLES = ["SM_JIN_MG_WIN_MP03", "SM_JIN_MG_DRAW_MP03"]

LYT_ARC = BEA / "hs_system.nx.bea/hs_system/layout.lyt.__file__"
# (sarc 경로 접두, 레이아웃, 애니 태그)
LAYOUTS = [
    ("blyt", "anim", "sys_guide_02", ["in", "normal", "out"]),
    ("blyt", "anim", "sys_timer_00", ["in", "normal", "out", "countdown"]),
    ("sys_tlp.lyt/blyt", "sys_tlp.lyt/anim", "sys_tlp_start", ["in", "normal", "out"]),
    ("sys_tlp.lyt/blyt", "sys_tlp.lyt/anim", "sys_tlp_finish", ["in", "normal", "out"]),
    ("sys_tlp.lyt/blyt", "sys_tlp.lyt/anim", "sys_tlp_win_00", ["in", "normal", "out"]),
    ("sys_tlp.lyt/blyt", "sys_tlp.lyt/anim", "sys_tlp_win_01", ["in", "normal", "out"]),
    ("sys_tlp.lyt/blyt", "sys_tlp.lyt/anim", "sys_tlp_draw_00", ["in", "normal", "out"]),
]
FONT_HOLDER = BEA / "font_holder_kr.nx.bea/fonts_kr/holder_layout.lyt"
FONT_DIRS = [BEA / "Parts_kr.lyt.nx.bea/Parts.lyt/Font", BEA / "Parts.lyt.nx.bea/Parts.lyt/Font"]
MSG_DIR = EX / "message" / "KRko"
TEXT_LABELS = ["hsmg402_MGctrlGuide", "hsmg_tlp_start", "hsmg_tlp_finish", "hsmg_tlp_go", "hsmg_tlp_win", "hsmg_tlp_wins",
               "hsmg_tlp_draw"] + [f"im_{p.split('_')[0]}_name" for p in PCS]
# 패밀리(fcpx) → 그 글자로 그릴 라벨(+ 추가 글자)
FONT_USE = {
    "hsfont_middle": (["hsmg402_MGctrlGuide"] + [f"im_{p.split('_')[0]}_name" for p in PCS], ""),
    "hsfont_mario": (["hsmg_tlp_start", "hsmg_tlp_finish", "hsmg_tlp_go", "hsmg_tlp_win", "hsmg_tlp_wins", "hsmg_tlp_draw"], "0123456789"),
    "hsfont_mario_out": (["hsmg_tlp_start", "hsmg_tlp_finish", "hsmg_tlp_go", "hsmg_tlp_win", "hsmg_tlp_wins", "hsmg_tlp_draw"], "0123456789"),
}
VIB_DIR = BEA / "hs_system.nx.bea/hs_system/vib"
VIB_DEFINE = EX / "nkn/hs_system.nx.bea/hs_system/data/vib_define.csv"


def size_of(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def glb_json(p: Path) -> dict:
    b = p.read_bytes()
    n = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20 + n])


def copy_glb(src: Path, dst_model: Path, tex_src: Path, dst_tex: Path) -> list[str]:
    """glb 와 그것이 가리키는 ../tex/*.png 를 복사한다(바이트 그대로)."""
    dst_model.mkdir(parents=True, exist_ok=True)
    dst_tex.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst_model / src.name)
    imgs = []
    for im in glb_json(src).get("images", []):
        uri = im.get("uri", "")
        assert uri.startswith("../tex/"), uri
        name = uri[len("../tex/"):]
        if not (dst_tex / name).exists():
            shutil.copyfile(tex_src / name, dst_tex / name)
        imgs.append(name)
    return imgs


# ---------------------------------------------------------------- 무대·이펙트
def find_param(dump, mat_name, key):
    for m in dump[0]["models"][0]["materials"]:
        if m["name"] == mat_name and key in m.get("params", {}):
            return m["params"][key]["value"]
    return None


def build_stage() -> dict:
    g = SRC / "graphics"
    man = json.loads((g / "manifest.json").read_text(encoding="utf-8"))
    models = {}
    for name in STAGE_MODELS:
        imgs = copy_glb(g / "model" / f"{name}.glb", DST / "model", g / "tex", DST / "tex")
        m = man["models"][name]
        models[name] = {"file": f"model/{name}.glb", "clips": m["clips"], "images": imgs, "meshes": m["meshes"]}
    for t in EXTRA_TEX:
        shutil.copyfile(g / "tex" / t, DST / "tex" / t)
    (DST / "anim").mkdir(parents=True, exist_ok=True)
    anims = {}
    for a in ANIMS:
        shutil.copyfile(g / "anim" / f"{a}.json", DST / "anim" / f"{a}.json")
        anims[a] = f"anim/{a}.json"
    return {"models": models, "anims": anims, "env": build_env()}


def find_render_info(dump, mat_name, key):
    for m in dump[0]["models"][0]["materials"]:
        if m["name"] == mat_name and key in (m.get("renderInfo") or {}):
            return m["renderInfo"][key][0]
    return None


def build_env() -> dict:
    """env/dir_light/fluid fmdb 값 그대로 + IBL 큐브 면(png·hdr) + 색 보정 LUT. 뜻은 web/docs/engine/07_camera_lighting.md"""
    g = SRC / "graphics"
    (DST / "tex").mkdir(parents=True, exist_ok=True)
    cubes, cubes_hdr = {}, {}
    for c in CUBES:
        faces, hdrs = [], []
        for i in range(6):
            for ext, lst in (("png", faces), ("hdr", hdrs)):
                fn = f"{c}_{i:02d}.{ext}"
                shutil.copyfile(g / "tex" / fn, DST / "tex" / fn)
                lst.append(f"tex/{fn}")
        cubes[c] = faces
        cubes_hdr[c] = hdrs
    shutil.copyfile(g / "tex" / ENV_LUT, DST / "tex" / ENV_LUT)
    light = json.loads((g / "meta/hsmg402_dir_light00.dump.json").read_text(encoding="utf-8"))
    env = json.loads((g / "meta/hsmg402_env.dump.json").read_text(encoding="utf-8"))
    fluid = json.loads((g / "meta/hsmg402_fluid.dump.json").read_text(encoding="utf-8"))
    light_keys = ["color", "lightRotation", "lightPosition", "lightPositionEnable", "shadowBias", "shadowNormalBias",
                  "shadowOrthographyLeft", "shadowOrthographyRight", "shadowOrthographyTop", "shadowOrthographyBottom",
                  "shadowOrthographyNear", "shadowOrthographyFar", "shadowAutoCameraEnable", "shadowParamEnable", "shadowmapSize"]
    ibl_keys = ["common_radiance_scale", "common_irradiance_scale", "char_radiance_scale", "char_irradiance_scale", "ibl_rotate_y"]
    post_keys = ["enable", "bloom_enable", "bloom_threshold", "bloom_scale", "fxaa_enable", "fxaa_threshold", "lut_filter_enable",
                 "lut_blend", "vignette", "vignette_aspect", "exposure", "exposure_offset", "tonemap_output_scale"]
    post_ri = ["tonemap_type", "bloom_filter_type", "fxaa_filter_type", "posteffect_filter_order", "posteffect_filter_timing"]
    fluid_keys = ["fluid_render_enable", "fluid_simulation_enable", "fluid_texture_width", "fluid_texture_height",
                  "fluid_world_width", "fluid_world_height", "fluid_world_position", "fluid_heightmap_add_value"]
    post = {k: find_param(env, "post_mt", k) for k in post_keys}
    post.update({k: find_render_info(env, "post_mt", k) for k in post_ri})
    return {
        "note": "값은 env/dir_light/fluid fmdb 재질 파라미터 그대로 [데이터]. 뜻은 web/docs/engine/07_camera_lighting.md [판독]",
        "light": {k: find_param(light, "light_mt", k) for k in light_keys},
        "fog": {k: find_param(env, "env_mt", k) for k in ("fog_enable", "fog_cubemap_enable", "fog_param", "fog_color")},
        "ibl": {k: find_param(env, "env_mt", k) for k in ibl_keys},
        "post": post,
        "fluid": {k: next((find_param(fluid, m["name"], k) for m in fluid[0]["models"][0]["materials"]
                           if find_param(fluid, m["name"], k) is not None), None) for k in fluid_keys},
        "cubes": cubes,
        "cubesHdr": cubes_hdr,
        "lut": f"tex/{ENV_LUT}",
    }


def ftrg_triggers(path: Path) -> list[dict]:
    d = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for o in ui_ftrg.iter_objs(d):
        if o.get("_type") == "0x9101" and isinstance(o.get("+14"), str):
            out.append({"name": o["+14"], "stop": o.get("+10") == 1, "target": o.get("+34"),
                        "res": [p.get("+00").split("/")[-1] for p in o.get("+50", []) if isinstance(p, dict)]})
    return out


# 이펙트 원본(VFXB v40) — web/docs/engine/08_effects.md. 이미터셋 이름 → 파일
EFFECT_FILES = {
    "hsmg402": BEA / "hsmg402.nx.bea/mg/hsmg402/effect/effect.xml",
    "hs_system": BEA / "hs_system.nx.bea/hs_system/effect/effect.xml",
}
# 텍스처 png 는 effect_vfxb.py dump --png 결과(원본 BNTX 디코드, 픽셀 수정 없음)
EFFECT_TEX = {"hsmg402": SRC / "effect" / "tex", "hs_system": CONV / "effect" / "hs_system" / "tex"}
# 캐릭터 공용 이펙트(fx_pc_base.ftrg, hs_system/effect) 중 hsmg402 가 쓰는 키
CHARA_FX_KEYS = ["SNOW_MAKE00", "SNOW_BREATH00", "SNOW_FALL00"]


def trig_objs(tree) -> list[dict]:
    """FX 트리거 객체 0x9101: 이름(+14), _Stop(+10), 대상 노드(+34), 이펙트 파일(+3c), 이미터셋(+50 0x9105 +00), 배율 칸(+78~+90, 뜻 미확정)."""
    out = []
    for o in ui_ftrg.iter_objs(tree):
        if o.get("_type") == "0x9101" and isinstance(o.get("+14"), str):
            out.append({"name": o["+14"], "stop": o.get("+10") == 1, "target": o.get("+34"), "file": o.get("+3c"),
                        "sets": [str(x.get("+00")).split("/")[-1].removesuffix(".eset") for x in o.get("+50", []) if isinstance(x, dict)],
                        "params": [o.get(f"+{k:x}") for k in range(0x78, 0x94, 4)]})
    return out


def web_subsection(sub: dict) -> dict:
    """하위 섹션을 웹이 쓰는 꼴로. FRND·FSPN 배치는 main FUN_7100a00900·FUN_71009fced8 판독(08_effects.md 4.6)."""
    m = sub["magic"]
    if m == "FRND" and "u32" in sub:
        u, f = sub["u32"], sub["f32"]
        return {"magic": m, "mode": u[0] & 0xFF, "customTable": (u[0] >> 8) & 0xFF, "airMode": (u[0] >> 16) & 0xFF,
                "amp": f[1:4], "interval": u[4], "amps": f[7:11], "periods": f[11:15], "animKeys": u[15]}
    if m == "FSPN" and "u32" in sub:
        u, f = sub["u32"], sub["f32"]
        return {"magic": m, "speed": f[0], "axis": u[1], "diffusionVel": f[2], "animEnabled": u[3]}
    if m.startswith("EA"):
        return {k: sub[k] for k in ("magic", "enable", "loop", "randomStart", "loopCount", "keys") if k in sub}
    return {"magic": m}


def web_emitter(ej: dict, src: str) -> dict:
    s = dict(ej["summary"])
    s["samplers"] = [dict(x, file=f"{src}/{x['texture']}") for x in s["samplers"]]
    return {"summary": s, "subsections": [web_subsection(x) for x in ej["subsections"]],
            "children": [web_emitter(c, src) for c in ej["children"]]}


def build_effects() -> dict:
    import effect_vfxb  # noqa: E402  (web/tools/analysis/effect_vfxb.py, v40 EmitterData 배치)
    dst = DST / "effect"
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True, exist_ok=True)
    # 트리거: 무대·눈덩이(장면 ftrg) + 캐릭터 공용(base ftrg)
    fx, se, info = {}, {}, {}
    for f in ["fx_hsmg402_fld", "fx_hsmg402_snowball", "fx_hsmg402_snowball_break"]:
        for t in ftrg_triggers(SRC / "ftrg" / f"{f}.txt"):
            fx.setdefault(t["name"], []).extend(t["res"])
        for t in trig_objs(json.loads((SRC / "ftrg" / f"{f}.txt").read_text(encoding="utf-8"))):
            if not t["stop"]:
                info.setdefault(t["name"], {"target": t["target"], "sets": [], "params": t["params"]})["sets"] += t["sets"]
    for t in ftrg_triggers(SRC / "ftrg" / "se_hsmg402_snowball.txt"):
        se.setdefault(t["name"], []).extend(t["res"])
    _f, base = ui_ftrg.load(BEA / "hs_system.nx.bea/chara/pc/ftrgBase/ftrg/fx_pc_base.ftrg")
    for t in trig_objs(base):
        if t["name"] in CHARA_FX_KEYS and not t["stop"]:
            info.setdefault(t["name"], {"target": t["target"], "sets": [], "params": t["params"]})["sets"] += t["sets"]
    want = {"hsmg402": set(), "hs_system": set()}
    for name, t in info.items():
        for st in t["sets"]:
            want["hs_system" if st.startswith("fx_pc_") else "hsmg402"].add(st)
    sets, used_tex = {}, set()
    for src, path in EFFECT_FILES.items():
        v = effect_vfxb.Vfxb(str(path))
        for e in v.esets:
            name = v.eset_name(e)
            if name not in want[src]:
                continue
            ems = [web_emitter(effect_vfxb.emitter_json(v, em), src) for em in e.children]
            sets[name] = {"source": src, "emitters": ems}

            def walk(lst):
                for x in lst:
                    for smp in x["summary"]["samplers"]:
                        used_tex.add((src, smp["texture"]))
                    walk(x["children"])
            walk(ems)
        missing = want[src] - set(sets)
        if missing:
            raise SystemExit(f"이미터셋 없음 {src}: {sorted(missing)}")
    tex, tex_info = {}, {}
    for src, name in sorted(used_tex):
        (dst / src).mkdir(exist_ok=True)
        shutil.copyfile(EFFECT_TEX[src] / f"{name}.png", dst / src / f"{name}.png")
        tex[f"{src}/{name}"] = f"effect/{src}/{name}.png"
        meta = json.loads((EFFECT_TEX[src] / f"{name}.json").read_text(encoding="utf-8"))
        # BNTX 형식이 *_SRGB 면 화면에서 sRGB 로 푼다. UNORM(R8·BC4 마스크, comp RRRR 등)은 선형 그대로 [데이터]
        tex_info[f"{src}/{name}"] = {"format": meta["format"], "comp": meta.get("comp"), "srgb": meta["format"].endswith("_SRGB"),
                                     "size": [meta["width"], meta["height"]]}
    (dst / "sets.json").write_text(json.dumps({"tool": "tools/hsmg402_web_assets.py build_effects (effect_vfxb.py v40)",
                                               "triggers": info, "textures": tex_info, "sets": sets},
                                              ensure_ascii=False, separators=(",", ":")),
                                   encoding="utf-8")
    return {"textures": tex, "fxTriggers": fx, "seTriggers": se, "sets": "effect/sets.json"}


# ---------------------------------------------------------------- 소리
def player_of(fs, s):
    pl = fs.players[int(s["player"].split(":")[1])] if s.get("player") else None
    return pl and {"name": pl["name"], "max": pl["playableSoundMax"]}


def sound3d_of(s):
    d = s.get("sound3d")
    if not d:
        return None
    return {"flags": int(d["flags"], 16), "decayRatio": d["decayRatio"], "decayCurve": d["decayCurve"], "dopplerFactor": d["dopplerFactor"]}


def used_prgs(fseq, start):
    prgs, banks, any_prg, any_bank = set(), set(), False, False
    for c in disasm(fseq["data"], start):
        if c["name"] == "prg":
            if isinstance(c["value"], int):
                prgs.add(c["value"])
            else:
                any_prg = True
        elif c["name"] == "bank_select":
            if isinstance(c["value"], int):
                banks.add(c["value"])
            else:
                any_bank = True
    return (None if any_prg else prgs), (None if any_bank else banks | {0})


def export_seq(fs, sset, tag, s, out_dir, wave_files, wave_index):
    """웹 실시간 시퀀서(seq.ts)용 자료 — mpj tools/mg1801_web_assets.py export_seq 와 같은 형식(FSEQ DATA·시작·쓰는 뱅크 영역·파형)."""
    fseq = parse_fseq(fs.file_bytes(s["fileId"]))
    start = s["sequence"]["startOffset"]
    prgs, bank_sel = used_prgs(fseq, start)
    waves, local = [], {}
    banks = []
    for bi, bref in enumerate(s["sequence"]["banks"]):
        if bank_sel is not None and bi not in bank_sel:
            banks.append(None)
            continue
        bk = sset.bank(int(bref.split(":")[1]))
        insts = []
        for pi, inst in enumerate(bk["instruments"]):
            if inst is None or (prgs is not None and pi not in prgs):
                insts.append(None)
                continue
            keys = []
            for kmax, vels in inst:
                vv = []
                for vmax, r in vels:
                    war_item, widx = bk["waveIds"][r["waveIdIndex"]]
                    key = (tag, war_item, widx)
                    if key not in local:
                        w = sset.wave(war_item, widx)
                        name = f"{tag}_war{war_item & 0xFFFFFF}_{widx:03d}.wav"
                        if name not in wave_files:
                            arr = np.stack(w["channels"], axis=1).astype(np.float32) / 32768.0
                            write_wav(out_dir / name, arr, rate=w["sampleRate"])
                            wave_files.add(name)
                        local[key] = len(waves)
                        waves.append({"file": f"sound/wave/{name}", "rate": w["sampleRate"], "frames": w["frames"],
                                      "loop": w["loop"], "loopStart": w["loopStart"], "channels": len(w["channels"])})
                    vv.append({"velMax": vmax, "wave": local[key], "originalKey": r["originalKey"], "volume": r["volume"],
                               "pan": r["pan"], "pitch": r["pitch"], "adshr": r["adshr"]})
                keys.append({"keyMax": kmax, "vels": vv})
            insts.append(keys)
        banks.append({"instruments": insts})
    return {"volume": s["volume"], "data": base64.b64encode(bytes(fseq["data"])).decode("ascii"), "start": start,
            "banks": banks, "waves": waves}


def preset_records():
    subst, listeners = {}, []
    for blk in sound_preset.preset("hsmg402")["blocks"]:
        for rec in blk["records"]:
            if rec["type"] == "b":
                strs = rec.get("strs", {})
                if strs.get("2") and strs.get("3"):
                    subst[strs["2"]] = strs["3"]
            elif rec["type"] == "]":
                raw, f = rec["raw"], rec["f32"]
                # 배치 [추정]: raw[2] 리스너 번호(raw = rec[0..11], f = rec[1..11]), f[2..5] 오프셋 4칸, f[6] interiorSize, f[7] maxVolumeDistance, f[8] unitDistance,
                # f[9]·f[10] 필터 값 — mpj 'P' 레코드(04_sound.md 6.7)와 뒤 다섯 칸이 같은 순서라고 본다
                listeners.append({"index": raw[2], "offset": f[2:6], "interiorSize": f[6], "maxVolumeDistance": f[7],
                                  "unitDistance": f[8], "unitBiquadFilterValue": f[9], "maxBiquadFilterValue": f[10]})
    return subst, listeners


def bgm_info() -> dict:
    src = EX / "romfs/stream" / f"{BGM_LABEL}.dspadpcm.bfstm"
    inf = sound_bfstm.info(src)
    regions = {r["name"]: {"startSec": round(r["startSec"], 6), "endSec": round(r["endSec"], 6)} for r in inf["regions"]}
    jump = []
    p = EX / "nkn/audio.nx.bea/audio/jump_setting" / f"{BGM_LABEL}.csv"
    for row in csv.reader(p.read_text(encoding="utf-8").splitlines()):
        if row and row[0]:
            jump.append([c for c in row if c != ""])
    return {"inf": inf, "regions": regions, "jump": jump}


def build_sound(chara_voice_labels: set[str]) -> dict:
    out = DST / "sound"
    if out.exists():
        shutil.rmtree(out)
    (out / "wave").mkdir(parents=True)
    (out / "stream").mkdir(parents=True)
    sounds = {}
    wave_files: set[str] = set()
    se = Fsar(SE_ARC)
    amb = Fsar(AMB_ARC)
    main = Fsar(MAIN_FSPJ)
    sets = {"se": SoundSet(se), "amb": SoundSet(amb), "main": SoundSet(main)}
    jobs = [(lb, se, "se", "hsmg402", "se") for lb in SE_LABELS] + [("SQ_AMB_BLZARD_1", amb, "amb", "amb_blzard_1", "se")]
    jobs += [(lb, main, "main", "main", "voice" if lb.startswith("SQ_VOI") else "se") for lb in sorted(chara_voice_labels) if lb not in SE_LABELS]
    for label, fs, setk, tag, bus in jobs:
        try:
            s = fs.find(label)
        except Exception:  # noqa: BLE001
            s = None
        if not s or s.get("type") != "sequence":
            print("  소리 없음/시퀀스 아님", label)
            continue
        try:
            seq = export_seq(fs, sets[setk], tag, s, out / "wave", wave_files, {})
        except Exception as e:  # noqa: BLE001
            print("  시퀀스 내보내기 실패", label, e)
            continue
        sounds[label] = {"kind": "seq", "bus": bus, "player": player_of(fs, s), "playerPriority": s.get("playerPriority", 64),
                         "sound3d": sound3d_of(s), "seq": seq}
    # BGM·징글(스트림)
    b = bgm_info()
    for label in [BGM_LABEL] + JINGLES:
        src = EX / "romfs/stream" / f"{label}.dspadpcm.bfstm"
        inf = b["inf"] if label == BGM_LABEL else sound_bfstm.info(src)
        sound_bfstm.decode(src, out / "stream" / f"{label}.wav")
        s = main.find(label)
        tracks = (s.get("stream") or {}).get("tracks") or [{"volume": 127}]
        sounds[label] = {"kind": "stream", "bus": "bgm", "file": f"sound/stream/{label}.wav", "volume": s["volume"],
                         "gain": round(s["volume"] / 127.0 * tracks[0]["volume"] / 127.0, 6), "durationSec": round(inf["seconds"], 6),
                         "loop": ({"startSec": inf["loopStartSec"], "endSec": inf["loopEndSec"]} if inf["loop"] else None)}
    subst, listeners = preset_records()
    return {
        "sounds": sounds,
        "substitute": subst,
        "listener3d": {"note": "[추정] 프리셋 hsmg402 ']' 레코드를 mpj 'P' 레코드처럼 읽은 값. 기본값은 mpj bex 기본 리스너",
                       "preset": listeners,
                       "default": {"interiorSize": 10.0, "maxVolumeDistance": 20.0, "unitDistance": 50.0}},
        "bgm": {"label": BGM_LABEL, "regions": b["regions"], "jump": b["jump"],
                "setting": {"mg_bgm_play_position": "scene_start", "mg_bgm_intro_skip": "REG_SEQ_MAIN",
                            "mg_bgm_stop_fade": "FADE_TIME_02(;default 행)", "result_jingle_play_position": "telop(;default 행)"}},
    }


# ---------------------------------------------------------------- 캐릭터
def walk_triggers(path: Path) -> dict[str, list[dict]]:
    """base ftrg: 키 → [{kind, res(마지막 경로 이름), ground(se_ground 분기)}]."""
    _f, tree = ui_ftrg.load(path)
    rows, _ev = ui_ftrg.triggers(tree)
    out: dict[str, list[dict]] = {}
    raw = {}
    for o in ui_ftrg.iter_objs(tree):
        if o.get("_type") == "0x9101":
            key = o.get("+14") if isinstance(o.get("+14"), str) else o.get("+30")
            if isinstance(key, str):
                raw.setdefault(key, []).append(o)
    for r in rows:
        if not r["key"]:
            continue
        grounds = []
        for o in raw.get(r["key"], []):
            for x in o.get("+68", []) or []:
                if isinstance(x, dict) and x.get("+00") == "se_ground":
                    grounds.append(True)
        out.setdefault(r["key"], []).append({"kind": r["kind"], "res": [str(x[0]).split("/")[-1] for x in r["resources"] if x[0]],
                                             "ground": bool(grounds)})
    return out


def anim_events(path: Path) -> list[dict]:
    """루트 +40 = 모션별 0x9106{+00 모션, +08 애니 경로, +14 [0x9107{+00 키, +08 프레임, +0c 플래그}], +20 속성}
    [데이터: mps FTRG 0x0216 — ui_ftrg.triggers 의 mpj 배치(+1c 이벤트)와 달라 여기서 직접 읽는다]"""
    _f, tree = ui_ftrg.load(path)
    out = []
    for a in tree[0].get("+40", []) or []:
        if not isinstance(a, dict) or a.get("_type") != "0x9106":
            continue
        for k in a.get("+14", []) or []:
            if isinstance(k, dict) and k.get("_type") == "0x9107":
                out.append({"motion": a.get("+00"), "key": k.get("+00"), "frame": k.get("+08"), "flags": k.get("+0c")})
    return out


# 모션 이벤트 중 이 게임에서 울리는 것 [추정: 조건으로 고름 — 지면 snow(프리셋 j/i), 물·웅덩이·젖음(_WAT/_PUD/_WET) 아님,
# 보드 관중(VO_CHEER_*) 아님, 얼음 판(_ICE)·VO_PC_MUTE·먼지(DOWN_*)·WALK00 이펙트 뺌]
KEEP_KEYS = {"SE_PC_WALK", "SE_PC_RUN", "SE_PC_SML_WALK", "SE_PC_SML_RUN", "SE_PC_SML_JUMP", "SE_PC_SML_LAND",
             "SE_PLY_CO_DAMAGE02", "SE_PLY_CO_DAMAGE03", "SE_PLY_CO_WRIGGLE00", "SNOW_MAKE00", "SNOW_BREATH00",
             "VO_HSMG402_MAKE_SB", "VO_PC_ACTION", "VO_PC_DMG_NR", "VO_PC_DONE", "VO_PC_WRIGGLE00",
             "VB_HSMG402_SNOWBALL_SHOT", "VB_CO_DMG_02_03"}
SUBST: dict[str, str] = {}


def resolve_chara_label(res: str, pcnum: str, names: set[str], ground: bool) -> str | None:
    """base 트리거 자원의 PC01 을 캐릭터 번호로 [추정: fspj 에 PC01~13 라벨이 다 있음]. se_ground 분기 트리거는 지면별 자원이
    여럿이라 지면 'snow'(프리셋 hsmg402 j/i 레코드) 판 _SNOW 만 고른다 [추정]. 프리셋 'b' 치환을 건다. MFA_VOLUME0(볼륨 0 자리표시)는
    치환이 없으면 울리지 않는다 [데이터: 이름·프리셋]."""
    lab = res.replace("PC01", pcnum)
    if ground and not lab.endswith("_SNOW"):
        return None
    lab = SUBST.get(lab, lab)
    if "MFA_VOLUME0" in lab:
        return None
    m = re.search(r"HSMG\d{3}", lab)
    if m and m.group(0) != "HSMG402":
        return None  # 다른 미니게임 전용 변형(예 HSMG443_FALL) [추정: 이름]
    return lab if lab in names else None


def build_chara(main_names: set[str], vib_ok: set[str]) -> set[str]:
    if CHARA.exists():
        shutil.rmtree(CHARA)
    CHARA.mkdir(parents=True)
    base_dir = BEA / "hs_system.nx.bea/chara/pc/ftrgBase/ftrg"
    base = {}
    for k in ("fx", "se", "vo", "vb"):
        for key, lst in walk_triggers(base_dir / f"{k}_pc_base.ftrg").items():
            base.setdefault(key, []).extend(lst)
    msgs = load_messages()
    index = {}
    voice_labels: set[str] = set()
    for key in PCS:
        pc = key.split("_")[0]
        pcnum = pc.upper()
        conv = CONV / "graphics" / f"hsmg402_{pc}"
        man = json.loads((conv / "manifest.json").read_text(encoding="utf-8"))
        dst = CHARA / pc
        model_name = next(iter(man["models"]))
        imgs = copy_glb(conv / "model" / f"{model_name}.glb", dst / "model", conv / "tex", dst / "tex")
        eye = f"{pc}_eye_alb.png"
        if (conv / "tex" / eye).exists():
            shutil.copyfile(conv / "tex" / eye, dst / "tex" / eye)
        else:
            eye = None
        clips = man["models"][model_name]["clips"]
        motions = {}
        for c in CLIPS:
            full = f"{pc}_{c}"
            ci = clips.get(full)
            if not ci:
                print("  클립 없음", full)
                continue
            m = {"clip": full, "frames": ci["frames"], "loop": ci["loop"]}
            fa = conv / "anim" / f"{full}.ftsb.fmab.json"
            if fa.exists():
                d = json.loads(fa.read_text(encoding="utf-8"))
                for ma in d.get("materialAnims", []):
                    em = ma["materials"].get("eye_m")
                    if em:
                        m["eye"] = {"frames": ma["frames"], "loop": ma["loop"],
                                    "params": {pn: {k: v for k, v in comps.items() if k != "0x00"} for pn, comps in em["params"].items()}}
            fv = conv / "anim" / f"{full}.fvbb.json"
            if fv.exists():
                d = json.loads(fv.read_text(encoding="utf-8"))
                vis = {}
                for bv in d.get("boneVisibility", []):
                    for bone, steps in bv["bones"].items():
                        if any(v == 0 for _, v in steps):
                            vis[bone] = steps
                if vis:
                    m["vis"] = vis
            motions[c] = m
        # 모션 이벤트(캐릭터 ftrg 4개의 +40) → base 트리거로 라벨 해석
        ftrg_dir = BEA / f"chara~pc~{key}.nx.bea/chara/pc/{key}/ftrg"
        for k in ("fx", "se", "vo", "vb"):
            for e in anim_events(ftrg_dir / f"{k}_{key}.ftrg"):
                mname = str(e["motion"] or "")
                short = mname[len(pc) + 1:] if mname.startswith(pc + "_") else None
                if short not in motions or e["key"] not in KEEP_KEYS:
                    continue
                ev = {"frame": e["frame"], "key": e["key"], "file": k}
                outs = []
                for t in base.get(e["key"], []):
                    for res in t["res"]:
                        if t["kind"] == "FX":
                            outs.append({"kind": "fx", "name": res})
                        elif t["kind"] == "VB":
                            if res in vib_ok:
                                outs.append({"kind": "vib", "name": res})
                        else:
                            lab = resolve_chara_label(res, pcnum, main_names, t["ground"])
                            if lab:
                                outs.append({"kind": "se", "label": lab})
                                voice_labels.add(lab)
                ev["out"] = outs
                motions[short].setdefault("events", []).append(ev)
        for m in motions.values():
            if "events" in m:
                m["events"].sort(key=lambda x: x["frame"])
        # 코드가 직접 부르는 트리거(VO_HSMG402_CMP_SB / VO_HSMG402_FALL) [판독 NRO 문자열]
        code = {}
        for k in ("VO_HSMG402_CMP_SB", "VO_HSMG402_FALL"):
            outs = []
            for t in base.get(k, []):
                for res in t["res"]:
                    lab = resolve_chara_label(res, pcnum, main_names, t["ground"])
                    if lab:
                        outs.append({"kind": "se", "label": lab})
                        voice_labels.add(lab)
            code[k] = outs
        (dst / "motions.json").write_text(json.dumps({"motions": motions, "code": code}, ensure_ascii=False, separators=(",", ":")),
                                          encoding="utf-8")
        index[pc] = {"key": key, "name": msgs.get(f"im_{pc}_name", key), "glb": f"{pc}/model/{model_name}.glb",
                     "motions": f"{pc}/motions.json", "eyeTex": f"{pc}/tex/{eye}" if eye else None, "images": imgs}
        print(" chara", pc, len(motions), "clips", sum(len(m.get("events", [])) for m in motions.values()), "events")
    (CHARA / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    return voice_labels


# ---------------------------------------------------------------- UI
def load_messages() -> dict:
    out = {}
    for p in sorted(MSG_DIR.glob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            out.update(d)
    return out


def clean_layout(d):
    d = dict(d)
    for k in ("header", "sectionOrder", "_check"):
        d.pop(k, None)
    for m in d["materials"]:
        m.pop("_size", None)
    return d


def clean_anim(d):
    d = dict(d)
    d.pop("header", None)
    d.pop("_check", None)
    return d


def font_file(name: str) -> Path:
    for d in FONT_DIRS:
        p = d / name
        if p.exists():
            return p
    raise FileNotFoundError(name)


def build_atlas(family, fonts, text, out_png):
    """fcpx 순서대로 글자를 가진 첫 폰트의 셀을 쓴다 [추정: 복합 폰트 대체 순서 = 목록 순서, mpj 와 같음].
    커버리지 폰트(BC4)는 RGB 흰색 + 알파 = 커버리지, 컬러 폰트(BC7)는 셀 RGBA 그대로 — 글리프마다 color 표지."""
    loaded = []
    for fn in fonts:
        b = font_file(fn).read_bytes()
        f, cmap, widths = ui_font.parse_ffnt(b)
        sheets, meta = ui_font.decode_sheets(b, f)
        loaded.append((Path(fn).stem, f, cmap, widths, sheets, meta))
    main = next((x for x in loaded if "extension" not in x[0]), loaded[0])
    chars = sorted(set(text) - {"\n", "\r"})
    cw = max(x[1]["tglp"]["cellW"] for x in loaded)
    ch = max(x[1]["tglp"]["cellH"] for x in loaded)
    cols = 8
    rows = max(1, (len(chars) + cols - 1) // cols)
    px_, py_ = cw + 2, ch + 2
    atlas = Image.new("RGBA", (cols * px_, rows * py_), (255, 255, 255, 0))
    glyphs = {}
    for i, c in enumerate(chars):
        for stem, f, cmap, widths, sheets, meta in loaded:
            gi = cmap.get(ord(c))
            if gi is None:
                continue
            left, gw, adv = widths.get(gi, tuple(f["finf"]["defaultWidth"]))
            sh, px, py = ui_font.glyph_cell(f, gi)
            t = f["tglp"]
            cell = sheets[sh].crop((px, py, px + t["cellW"], py + t["cellH"]))
            color = cell.mode == "RGBA"
            if not color:
                cell = Image.merge("RGBA", [Image.new("L", cell.size, 255)] * 3 + [cell.convert("L")])
            ax, ay = (i % cols) * px_ + 1, (i // cols) * py_ + 1
            atlas.paste(cell, (ax, ay))
            glyphs[c] = {"x": ax, "y": ay, "w": gw, "h": t["cellH"], "left": left, "adv": adv, "baseline": t["baseline"],
                         "font": stem, **({"color": True} if color else {})}
            break
        else:
            print(f"  {family}: 글자 없음 {c!r} (U+{ord(c):04X})")
    atlas.save(out_png, optimize=True)
    fi = main[1]["finf"]
    return {"fonts": [x[0] for x in loaded], "main": main[0], "height": fi["height"], "width": fi["width"], "ascent": fi["ascent"],
            "lineFeed": fi["lineFeed"], "file": f"ui/font/{family}.png", "glyphs": glyphs}


def build_ui() -> dict:
    out = DST / "ui"
    if out.exists():
        shutil.rmtree(out)
    (out / "tex").mkdir(parents=True)
    (out / "font").mkdir(parents=True)
    files = ui_sarc.read_files(str(LYT_ARC))
    lt = ui_render.LazyTextures()
    for fn, data in files.items():
        if data[:4] == b"BNTX":
            lt.add_bntx(data)
    layouts, anims, textures = {}, {}, {}
    for bdir, adir, name, tags in LAYOUTS:
        lay = ui_lyt.parse_bflyt(files[f"{bdir}/{name}.bflyt"])
        assert not lay["_check"], (name, lay["_check"])
        layouts[name] = clean_layout(lay)
        anims[name] = {}
        texnames = set(lay["textures"])
        for t in tags:
            an = ui_lyt.parse_bflan(files[f"{adir}/{name}_{t}.bflan"])
            anims[name][t] = clean_anim(an)
            texnames |= set(an.get("textures", []))
        for tn in sorted(texnames):
            if tn in textures:
                continue
            img = lt.get(tn)
            if img is None:
                print(f"  {name}: 텍스처 없음 {tn} (런타임 생성으로 보임)")
                continue
            fn = "ui/tex/" + tn.replace("^", "_") + ".png"
            img.save(DST / fn, optimize=True)
            textures[tn] = fn
        print(" ui", name, tags, len(texnames), "tex")
    msgs = load_messages()
    texts = {k: msgs[k] for k in TEXT_LABELS if k in msgs}
    holder = ui_sarc.read_files(str(FONT_HOLDER))
    fonts = {}
    tag = re.compile(r"\[\d+:\d+(?::[0-9a-f]*)?\]")
    for fam, (labels, extra) in FONT_USE.items():
        cpx = ui_lyt.parse_bfcpx(holder[f"fcpx/{fam}.bfcpx"])["fonts"]
        text = tag.sub("", "".join(texts.get(k, "") for k in labels)) + extra
        fonts[fam] = build_atlas(fam, cpx, text, DST / f"ui/font/{fam}.png")
        print(" font", fam, fonts[fam]["fonts"], len(fonts[fam]["glyphs"]), "glyphs")
    return {"layouts": layouts, "anims": anims, "textures": textures, "fonts": fonts, "texts": texts}


def build_vib() -> tuple[dict, set[str]]:
    defs = {}
    for row in csv.DictReader(VIB_DEFINE.read_text(encoding="utf-8").splitlines()):
        defs[row["label"]] = row
    vib = {}
    for label in ["bv_vib_hsmg402_snowball_shot", "bv_vib_co_dmg_02_03"]:
        df = defs[label]
        d = ui_bnvib.parse((VIB_DIR / f"{df['play_name']}.bnvib").read_bytes())
        vib[label] = {"bnvib": df["play_name"], "gainMaster": float(df["Gain_Master"]), "gainLow": float(df["Gain_Low"]),
                      "gainHigh": float(df["Gain_High"]), "priority": int(df["priority"] or 0),
                      "envelope": ui_bnvib.web_envelope(d)}
    return vib, set(vib)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-chara", action="store_true")
    ap.add_argument("--skip-sound", action="store_true")
    ap.add_argument("--skip-ui", action="store_true")
    ap.add_argument("--only-effects", action="store_true", help="이펙트(effect/·manifest.effects)만 다시 만든다")
    ap.add_argument("--only-env", action="store_true", help="조명·환경·후처리(manifest.env·IBL 큐브·LUT)만 다시 만든다")
    a = ap.parse_args(argv)
    if a.only_env:
        man = json.loads((DST / "manifest.json").read_text(encoding="utf-8"))
        man["env"] = build_env()
        (DST / "manifest.json").write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
        print("env", len(man["env"]["cubes"]), "cubes", man["env"]["lut"])
        return
    if a.only_effects:
        man = json.loads((DST / "manifest.json").read_text(encoding="utf-8"))
        man["effects"] = build_effects()
        (DST / "manifest.json").write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
        print("effects", f"{size_of(DST / 'effect') / 1e6:.2f} MB", len(man["effects"]["textures"]), "textures")
        return
    prev = json.loads((DST / "manifest.json").read_text(encoding="utf-8")) if (DST / "manifest.json").exists() else {}
    for d in ("model", "tex", "anim", "effect"):
        if (DST / d).exists():
            shutil.rmtree(DST / d)
    DST.mkdir(parents=True, exist_ok=True)
    manifest = {"game": "hsmg402", "source": "tools/hsmg402_web_assets.py (변환: tools/graphics_convert.py mps_hsmg402·mps_pcNN_hsmg402)"}
    manifest.update(build_stage())
    manifest["effects"] = build_effects()
    vib, vib_ok = build_vib()
    manifest["vib"] = vib
    SUBST.update(preset_records()[0])
    main_fs = Fsar(MAIN_FSPJ)
    main_names = {s["name"] for s in main_fs.sounds} | set(SE_LABELS)
    if a.skip_chara:
        voice_labels = set(prev.get("voiceLabels", []))
    else:
        voice_labels = build_chara(main_names, vib_ok)
    manifest["voiceLabels"] = sorted(voice_labels)
    manifest["chara"] = "../chara/index.json"
    if a.skip_sound and prev:
        for k in ("sounds", "substitute", "listener3d", "bgm"):
            manifest[k] = prev.get(k)
    else:
        manifest.update(build_sound(voice_labels))
    if a.skip_ui and (DST / "ui/ui.json").exists():
        pass
    else:
        ui = build_ui()
        (DST / "ui/ui.json").write_text(json.dumps(ui, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    manifest["ui"] = "ui/ui.json"
    (DST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    sizes = {d.name: size_of(d) for d in DST.iterdir() if d.is_dir()}
    total = size_of(DST)
    print("hsmg402", {k: f"{v / 1e6:.2f} MB" for k, v in sizes.items()}, f"합계 {total / 1e6:.2f} MB")
    print("chara", f"{size_of(CHARA) / 1e6:.2f} MB", "전체", f"{(total + size_of(CHARA)) / 1e6:.2f} MB")


if __name__ == "__main__":
    main(sys.argv[1:])
