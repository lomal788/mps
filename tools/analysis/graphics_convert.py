"""Graphics conversion pipeline prototype: FRES/BNTX -> glb + png + baked anim json + manifest.

usage: graphics_convert.py <set> [<set> ...]      sets: mps_pc01, mps_hsmg101 (mpj sets mg1801, pc01 kept for reference; paths do not exist in mps)
output: extracted/converted/graphics/<set>/{model/*.glb, tex/*.png|json, anim/*.json, meta/*.json, manifest.json}

Steps per set
  1. every .bntx of the set -> tex/<name>.png (+ <name>.json)          web/tools/analysis/graphics_bntx.py
  2. every model .fmdb -> model/<name>.glb (+ meta/<name>.json)        web/tools/analysis/graphics_bfres2gltf gltf
       skeletal clips (.fskb) and shape clips (.fshb) are baked into the glb
  3. combined metallic-roughness pngs requested by step 2 (G = roughness, B = metallic)
  4. .fvbb / .fmab / .fsnb -> anim/<file>.json (baked per frame)       web/tools/analysis/graphics_bfres2gltf anim
  5. manifest.json
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
EXE = os.path.join(ROOT, "web", "tools", "analysis", "graphics_bfres2gltf", "bin", "Release", "net7.0", "graphics_bfres2gltf.exe")
BEA = os.path.join(ROOT, "extracted", "bea")
OUT = os.path.join(ROOT, "extracted", "converted", "graphics")

sys.path.insert(0, os.path.join(ROOT, "web", "tools", "analysis"))
import graphics_bntx  # noqa: E402


def files_under(d, ext):
    res = []
    for dp, dn, fns in os.walk(d):
        for fn in fns:
            if fn.endswith(ext):
                res.append(os.path.join(dp, fn))
    return sorted(res)


def mg1801():
    base = os.path.join(BEA, "mg~mg1801.nx.bea", "mg", "mg1801")
    models = []
    for f in files_under(os.path.join(base, "model"), ".fmdb"):
        stem = os.path.splitext(os.path.basename(f))[0]
        anims = [p for p in [os.path.join(base, "model", stem + ".fskb")] if os.path.exists(p)]
        models.append({"fmdb": f, "anims": anims, "shapeAnims": []})
    extra_anims = files_under(os.path.join(base, "model"), ".fmab") + files_under(os.path.join(base, "env"), ".fsnb")
    env_models = files_under(os.path.join(base, "env"), ".fmdb")
    return {
        "bea": "mg~mg1801.nx.bea",
        "textures": files_under(base, ".bntx"),
        "models": models,
        "envModels": env_models,
        "anims": extra_anims,
    }


def pc01():
    pc = os.path.join(BEA, "chara~pc01.nx.bea")
    mot = os.path.join(BEA, "chara~pcMot_rhy.nx.bea", "chara", "pc", "pc01_mario", "motion")
    clips = ["pc01_rhy_knife_idle00", "pc01_rhy_knife_swing00"]
    anims = [os.path.join(mot, c + ".fskb") for c in clips]
    shape = [os.path.join(mot, c + ".fshb") for c in clips]
    models = []
    for f in files_under(os.path.join(pc, "chara"), ".fmdb"):
        models.append({"fmdb": f, "anims": anims, "shapeAnims": shape})
    extra = []
    for c in clips:
        for ext in (".fvbb", ".ftsb.fmab"):
            p = os.path.join(mot, c + ext)
            if os.path.exists(p):
                extra.append(p)
    return {
        "bea": "chara~pc01.nx.bea + chara~pcMot_rhy.nx.bea",
        "textures": files_under(pc, ".bntx"),
        "models": models,
        "envModels": [],
        "anims": extra,
    }


def mps_pc01():
    """mps (Superstars): chara~pc~pc01_mario.nx.bea, motions in the same archive (motion/), 4 sample clips"""
    pc = os.path.join(BEA, "chara~pc~pc01_mario.nx.bea", "chara", "pc", "pc01_mario")
    mot = os.path.join(pc, "motion")
    clips = ["pc01_co_idle00", "pc01_co_run00", "pc01_co_win00a", "pc01_co_jump00a"]
    anims = [os.path.join(mot, c + ".fskb") for c in clips]
    shape = [p for p in (os.path.join(mot, c + ".fshb") for c in clips) if os.path.exists(p)]
    models = [{"fmdb": f, "anims": anims, "shapeAnims": shape} for f in files_under(os.path.join(pc, "model"), ".fmdb")]
    extra = [p for c in clips for p in (os.path.join(mot, c + e) for e in (".fvbb", ".ftsb.fmab")) if os.path.exists(p)]
    return {"bea": "chara~pc~pc01_mario.nx.bea", "textures": files_under(pc, ".bntx"), "models": models,
            "envModels": [], "anims": extra}


def mps_hsmg101():
    """mps (Superstars): hsmg101.nx.bea; model/<stem>.fskb or <stem>_*.fskb are attached to <stem>.fmdb"""
    base = os.path.join(BEA, "hsmg101.nx.bea", "mg", "hsmg101")
    fskb = files_under(os.path.join(base, "model"), ".fskb")
    models = []
    for f in files_under(os.path.join(base, "model"), ".fmdb"):
        stem = os.path.splitext(os.path.basename(f))[0]
        anims = [a for a in fskb if os.path.basename(a) == stem + ".fskb" or os.path.basename(a).startswith(stem + "_")]
        models.append({"fmdb": f, "anims": anims, "shapeAnims": []})
    extra = files_under(os.path.join(base, "model"), ".fmab") + files_under(os.path.join(base, "env"), ".fsnb")         + files_under(os.path.join(base, "env"), ".fmab")
    return {"bea": "hsmg101.nx.bea", "textures": files_under(base, ".bntx"), "models": models,
            "envModels": files_under(os.path.join(base, "env"), ".fmdb"), "anims": extra}


def mps_hsmg402():
    """mps (Superstars): hsmg402.nx.bea (Snowball Summit); same rule as mps_hsmg101 + dbg/*.fmdb; output extracted/converted/hsmg402/graphics"""
    base = os.path.join(BEA, "hsmg402.nx.bea", "mg", "hsmg402")
    fskb = files_under(os.path.join(base, "model"), ".fskb")
    models = []
    fmdbs = files_under(os.path.join(base, "model"), ".fmdb") + files_under(os.path.join(base, "dbg"), ".fmdb")
    stems = {os.path.splitext(os.path.basename(f))[0] for f in fmdbs}
    for f in fmdbs:
        stem = os.path.splitext(os.path.basename(f))[0]
        anims = [a for a in fskb if os.path.basename(a) == stem + ".fskb" or (os.path.basename(a).startswith(stem + "_")
                 and os.path.splitext(os.path.basename(a))[0] not in stems)]
        models.append({"fmdb": f, "anims": anims, "shapeAnims": []})
    extra = files_under(os.path.join(base, "model"), ".fmab") + files_under(os.path.join(base, "env"), ".fsnb")         + files_under(os.path.join(base, "env"), ".fmab")
    return {"bea": "hsmg402.nx.bea", "textures": files_under(base, ".bntx"), "models": models,
            "envModels": files_under(os.path.join(base, "env"), ".fmdb"), "anims": extra,
            "out": os.path.join(ROOT, "extracted", "converted", "hsmg402", "graphics")}


HSMG402_PCS = ["pc01_mario", "pc02_luigi", "pc03_peach", "pc04_daisy", "pc05_wario", "pc06_waluigi", "pc07_yoshi",
               "pc11_rosetta", "pc12_dk", "pc13_catherine"]
HSMG402_CLIPS = ["co_idle00", "co_walk00", "sb_make00", "sb_idle00", "sb_idle01", "sb_walk00", "sb_walk01", "sb_push00",
                 "co_wriggle00", "co_damage02", "co_damage03", "co_win01a", "co_win01b"]


def mps_pc_hsmg402(key):
    """mps 플레이어블 1명 + hsmg402 가 쓰는 클립 13개(docs/minigame/hsmg402.md 7.8). 출력 extracted/converted/graphics/hsmg402_<pcNN>"""
    def spec():
        pc = os.path.join(BEA, "chara~pc~%s.nx.bea" % key, "chara", "pc", key)
        mot = os.path.join(pc, "motion")
        pre = key.split("_")[0]
        clips = ["%s_%s" % (pre, c) for c in HSMG402_CLIPS]
        anims = [os.path.join(mot, c + ".fskb") for c in clips]
        shape = [p for p in (os.path.join(mot, c + ".fshb") for c in clips) if os.path.exists(p)]
        models = [{"fmdb": f, "anims": anims, "shapeAnims": shape} for f in files_under(os.path.join(pc, "model"), ".fmdb")]
        extra = [p for c in clips for p in (os.path.join(mot, c + e) for e in (".fvbb", ".ftsb.fmab")) if os.path.exists(p)]
        return {"bea": "chara~pc~%s.nx.bea" % key, "textures": files_under(pc, ".bntx"), "models": models,
                "envModels": [], "anims": extra, "out": os.path.join(OUT, "hsmg402_" + pre)}
    return spec


SETS = {"mg1801": mg1801, "pc01": pc01, "mps_pc01": mps_pc01, "mps_hsmg101": mps_hsmg101, "mps_hsmg402": mps_hsmg402}
for _k in HSMG402_PCS:
    SETS["mps_%s_hsmg402" % _k.split("_")[0]] = mps_pc_hsmg402(_k)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout, r.stderr)
        raise SystemExit("failed: " + " ".join(cmd))
    return r.stdout.strip()


def combine_mr(tex_dir, item):
    out = os.path.join(tex_dir, item["out"])
    if os.path.exists(out):
        return
    srcs = [os.path.join(tex_dir, item[k]) if item.get(k) else None for k in ("roughness", "metallic")]
    imgs = [Image.open(p).convert("RGB") if p and os.path.exists(p) else None for p in srcs]
    size = next(i.size for i in imgs if i is not None)
    rgb = np.zeros((size[1], size[0], 3), np.uint8)
    rgb[..., 0] = 255
    rough = imgs[0].resize(size) if imgs[0] is not None else None
    metal = imgs[1].resize(size) if imgs[1] is not None else None
    rgb[..., 1] = np.asarray(rough)[..., 0] if rough is not None else 255
    rgb[..., 2] = np.asarray(metal)[..., 0] if metal is not None else 255
    Image.fromarray(rgb, "RGB").save(out)


def convert(name):
    spec = SETS[name]()
    out = spec.get("out") or os.path.join(OUT, name)
    tex_dir = os.path.join(out, "tex")
    for d in ("model", "tex", "anim", "meta"):
        os.makedirs(os.path.join(out, d), exist_ok=True)

    # 1. textures
    tex_meta = {}
    for p in spec["textures"]:
        with open(p, "rb") as f:
            data = f.read()
        for t in graphics_bntx.parse(data):
            try:
                m = graphics_bntx.to_png(t, tex_dir)
            except NotImplementedError as e:
                m = graphics_bntx.meta(t)
                m["error"] = "not decoded: %s" % e
                m["files"] = []
            with open(os.path.join(tex_dir, t.name + ".json"), "w", encoding="utf-8") as f:
                json.dump(m, f, ensure_ascii=False, indent=1)
            tex_meta[t.name] = m
    print("%s: textures %d" % (name, len(tex_meta)))

    # 2. models
    manifest_models = {}
    for m in spec["models"]:
        stem = os.path.splitext(os.path.basename(m["fmdb"]))[0]
        glb = os.path.join(out, "model", stem + ".glb")
        meta = os.path.join(out, "meta", stem + ".json")
        cmd = [EXE, "gltf", m["fmdb"], glb, "--texdir", tex_dir, "--texuri", "../tex/", "--meta", meta]
        for a in m["anims"]:
            cmd += ["--anim", a]
        for a in m["shapeAnims"]:
            cmd += ["--shapeanim", a]
        print(" ", run(cmd))
        with open(meta, encoding="utf-8") as f:
            mj = json.load(f)
        for c in mj["combine"]:
            combine_mr(tex_dir, c)
        manifest_models[stem] = {
            "url": "model/%s.glb" % stem,
            "source": os.path.relpath(m["fmdb"], BEA).replace("\\", "/"),
            "bytes": os.path.getsize(glb),
            "bones": mj["bones"],
            "vertices": mj["vertexCount"],
            "triangles": mj["triangleCount"],
            "meshes": [x["node"] for x in mj["meshes"]],
            "clips": {c["name"]: {"frames": c["frames"], "loop": c.get("loop"), "kind": c["kind"]} for c in mj["clips"]
                      if c["kind"] != "shape" or c.get("channels", 0) > 0},
            "images": mj["images"],
            "missingTextures": mj["missingTextures"],
            "bindCheck": mj["bindCheck"],
        }

    # 3. env (parameter-container) models: metadata only
    env = {}
    for p in spec["envModels"]:
        stem = os.path.splitext(os.path.basename(p))[0]
        dst = os.path.join(out, "meta", stem + ".dump.json")
        run([EXE, "dump", dst, p])
        env[stem] = "meta/%s.dump.json" % stem

    # 4. non-skeletal anims
    anims = {}
    for p in spec["anims"]:
        fn = os.path.basename(p)
        dst = os.path.join(out, "anim", fn + ".json")
        run([EXE, "anim", p, dst])
        anims[fn] = "anim/%s.json" % fn

    manifest = {
        "set": name,
        "source": spec["bea"],
        "generator": "tools/graphics_convert.py (graphics_bntx.py + graphics_bfres2gltf)",
        "units": "FRES units, Y up, right-handed (same as three.js); time = frame / 60",
        "models": manifest_models,
        "envModels": env,
        "anims": anims,
        "textures": {k: {"files": v.get("files", []), "format": v["format"], "w": v["width"], "h": v["height"],
                          "array": v["array"], "viewDim": v["viewDim"], "srgb": v["srgb"], "comp": v["comp"],
                          **({"error": v["error"]} if "error" in v else {})} for k, v in sorted(tex_meta.items())},
    }
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print("%s: manifest -> %s" % (name, os.path.join(out, "manifest.json")))


if __name__ == "__main__":
    for s in sys.argv[1:]:
        convert(s)
