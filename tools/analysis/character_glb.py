"""캐릭터 glb: 캐릭터 모델 1개 + 모션 여러 개(.fskb·.fshb·.ftsb.fmab·.fvbb)를 한 glb + 모션 표(motions.json)로 묶는다.

usage: python web/tools/analysis/character_glb.py <key> [motion ...]
  key    = pcNN (characterlist PlayerCharacterData) | npcNNN (NPCCharacterData, 그 번호의 첫 레코드 = 기본 모델)
  motion = 접두 없는 원본 모션 이름 (rhy_knife_idle00, co_idle00, fcl_blink00 ...).
  기본(인자 없음) = pc01 rhy_knife_idle00 rhy_knife_swing00 co_idle00 fcl_blink00
output: extracted/converted/character/<key>/
  <model>.glb   모델 + 클립. 클립 이름 = 원본 모션 이름(접두 "pcNN_"/"npcNNN_" 제거, ComActorMotion::SetPrefix 규칙과 같음)
                스켈레탈 = <이름>, 셰이프(fshb, morph weights) = <이름>_shape
                animations[i].extras = {source, archive, frames, loop, fps, nameHash(FNV-1a 64)}
  tex/*.png     BNTX -> png (web/tools/analysis/graphics_bntx.py, 원본 그대로)
  motions.json  모션별 {frames, loop, archive, nameHash, files{fskb,fshb,ftsb,fvbb}, blink{확장자: 파일}, vis, mat}
                vis = fvbb 베이크(뼈 → [[프레임, 0/1], ...] 값이 바뀌는 프레임만), mat = ftsb.fmab 베이크(재질 → 파라미터 → 성분 → 값|프레임별 값)
                blink = 모션 파일 user data "blink"(main FUN_71000321e0 등 4개: 같은 폴더의 이 파일을 AnimationNodeBundle 의
                두 번째 자식으로 묶어 함께 재생) [판독 main FUN_7100034aa0]. 묶인 파일도 같은 표에 "fcl_blink00" 등으로 들어간다.
  meta.json     변환기 메타 + 클립 표

변환 자체는 그래픽 담당 변환기 web/tools/analysis/graphics_bfres2gltf(gltf·anim·dump 명령)를 그대로 호출한다. 이 스크립트는
(1) 모션 파일 위치를 chara~pcMot_* / 캐릭터 아카이브에서 찾고 (2) 결과 glb 의 클립 이름·extras 를 고치고 (3) 비스켈레탈 애니를 표로 모은다.
"""
import json
import os
import re
import struct
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(ROOT, "web", "tools", "analysis"))
import graphics_bntx  # noqa: E402
from graphics_convert import EXE, combine_mr, run  # noqa: E402

BEA = os.path.join(ROOT, "extracted", "bea")
OUT = os.path.join(ROOT, "extracted", "converted", "character")
CHARLIST = os.path.join(BEA, "bq.nx.bea", "common", "data", "characterlist.json")
DEFAULT = ["rhy_knife_idle00", "rhy_knife_swing00", "co_idle00", "fcl_blink00"]
EXTS = ("fskb", "fshb", "ftsb.fmab", "fvbb")


def fnv1a64(s):
    h = 0xCBF29CE484222325
    for b in s.encode():
        h = ((h ^ b) * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return h


def character(key):
    """key → (PlayerCharacterID 또는 NonPlayerCharacterID, 레코드, 'pc'|'npc')"""
    data = json.load(open(CHARLIST, encoding="utf-8-sig"))
    kind = "npc" if key.startswith("npc") else "pc"
    table = data["NPCCharacterData" if kind == "npc" else "PlayerCharacterData"]
    num = int(key[len(kind):])
    idx, cd = next((i, c) for i, c in enumerate(table) if c["Number"] == num)
    return idx, cd, kind


def motion_dirs(cd, kind):
    """모션 파일을 찾는 (아카이브 키, 폴더) 목록. 캐릭터 자기 아카이브 먼저, 그다음 chara~pcMot_*(pc만)"""
    base_dir = cd["base directory"]
    own = "chara~%s.nx.bea" % cd["archive"].split("/")[-1]
    dirs = [(own[len("chara~"):-len(".nx.bea")], os.path.join(BEA, own, base_dir, "motion"))]
    if kind == "pc":
        for name in sorted(os.listdir(BEA)):
            if name.startswith("chara~pcMot_"):
                dirs.append((name[len("chara~pcMot_"):-len(".nx.bea")], os.path.join(BEA, name, base_dir, "motion")))
    return dirs


def find_file(dirs, fname):
    for key, d in dirs:
        p = os.path.join(d, fname)
        if os.path.exists(p):
            return key, p
    return None, None


def blink_ref(path):
    """모션 파일의 user data "blink" 값(같은 폴더의 파일 이름) 또는 None.
    변환기 dump 는 fvbb·fshb 의 user data 를 내지 않아서(BfresLibrary FVIS·FSHA 경로) FRES 문자열 풀에서 직접 찾는다:
    키 문자열 "blink" 와 값 "<접두>_fcl_*.<같은 확장자>" 가 둘 다 있어야 한다. fskb·ftsb 는 dump 의 userData 와 결과가 같다 [실행]"""
    b = open(path, "rb").read()
    if b"\x00blink\x00" not in b:
        return None
    ext = os.path.basename(path).split(".", 1)[1]
    m = re.search(rb"([A-Za-z0-9]+_fcl_[A-Za-z0-9_]+\." + re.escape(ext.encode()) + rb")\x00", b)
    return m.group(1).decode() if m else None


def bake(path):
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "a.json")
        run([EXE, "anim", path, out])
        return json.load(open(out, encoding="utf-8"))


def vis_table(js):
    """fvbb 베이크 → {뼈: [[프레임, 값], ...]} (변화 없는 뼈도 첫 값은 남긴다: 모션이 기본 표시를 정한다)"""
    a = js["boneVisibility"][0]
    return {"frames": a["frames"], "bones": a["bones"]}


def mat_table(js):
    a = js["materialAnims"][0]
    out = {}
    for mn, m in a["materials"].items():
        if m.get("params"):
            out[mn] = m["params"]
    return {"frames": a["frames"], "materials": out, "patterns": {mn: m["patterns"] for mn, m in a["materials"].items() if m.get("patterns")}}


def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<III", b, 0)
    assert magic == 0x46546C67 and ver == 2
    jl, jt = struct.unpack_from("<II", b, 12)
    assert jt == 0x4E4F534A
    js = json.loads(b[20:20 + jl].decode("utf-8"))
    rest = b[20 + jl:]
    return js, rest


def write_glb(path, js, rest):
    j = json.dumps(js, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    j += b" " * ((4 - len(j) % 4) % 4)
    total = 12 + 8 + len(j) + len(rest)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(j), 0x4E4F534A))
        f.write(j)
        f.write(rest)


def main():
    key = sys.argv[1] if len(sys.argv) > 1 else "pc01"
    motions = sys.argv[2:] or DEFAULT
    idx, cd, kind = character(key)
    base_dir = cd["base directory"]                       # chara/pc/pc01_mario
    prefix_dir = base_dir.split("/")[-1].split("_")[0]    # pc01 / npc002 (motion filename prefix 와 같다)
    arc = os.path.join(BEA, "chara~%s.nx.bea" % cd["archive"].split("/")[-1])
    fmdb = os.path.join(arc, base_dir, cd["fmdb m1"])
    stem = os.path.splitext(os.path.basename(fmdb))[0]
    dirs = motion_dirs(cd, kind)

    out = os.path.join(OUT, key)
    tex = os.path.join(out, "tex")
    os.makedirs(tex, exist_ok=True)

    for dp, _, fns in os.walk(arc):
        for fn in fns:
            if fn.endswith(".bntx"):
                for t in graphics_bntx.parse(open(os.path.join(dp, fn), "rb").read()):
                    try:
                        tm = graphics_bntx.to_png(t, tex)
                    except NotImplementedError as e:
                        print("  texture not decoded:", t.name, e)
                        tm = graphics_bntx.meta(t)
                        tm["error"] = "not decoded: %s" % e
                        tm["files"] = []
                    with open(os.path.join(tex, t.name + ".json"), "w", encoding="utf-8") as f:
                        json.dump(tm, f, ensure_ascii=False, indent=1)

    # 모션 → 파일. 각 모션 파일의 user data "blink" 가 가리키는 파일도 같은 표로 넣는다
    table = {}
    queue = list(motions)
    while queue:
        m = queue.pop(0)
        if m in table:
            continue
        files, arcs, blink = {}, {}, {}
        for ext in EXTS:
            k, p = find_file(dirs, "%s_%s.%s" % (prefix_dir, m, ext))
            if p:
                files[ext] = p
                arcs[ext] = k
                bf = blink_ref(p)
                if bf:
                    blink[ext] = bf
                    bname = bf[len(prefix_dir) + 1:].split(".")[0]
                    if bname not in queue and bname not in table:
                        queue.append(bname)
        if not files:
            raise SystemExit("motion not found: %s %s" % (key, m))
        table[m] = {"files": files, "archives": arcs, "blink": blink}

    glb = os.path.join(out, stem + ".glb")
    meta = os.path.join(out, "meta.json")
    cmd = [EXE, "gltf", fmdb, glb, "--texdir", tex, "--texuri", "tex/", "--meta", meta]
    for m, t in table.items():
        if "fskb" in t["files"]:
            cmd += ["--anim", t["files"]["fskb"]]
        if "fshb" in t["files"]:
            cmd += ["--shapeanim", t["files"]["fshb"]]
    print(run(cmd))
    mj = json.load(open(meta, encoding="utf-8"))
    for c in mj.get("combine", []):
        combine_mr(tex, c)

    js, rest = read_glb(glb)
    prefix = prefix_dir + "_"
    clips = []
    src_to_motion = {}
    for m, t in table.items():
        for ext, p in t["files"].items():
            src_to_motion[os.path.basename(p)] = (m, ext, t["archives"][ext])
    for a in js.get("animations", []):
        ex = a.setdefault("extras", {})
        name = a["name"][len(prefix):] if a["name"].startswith(prefix) else a["name"]
        a["name"] = name
        m, ext, akey = src_to_motion.get(ex.get("source"), (None, None, None))
        ex["archive"] = ("chara~pcMot_%s.nx.bea" % akey if akey and akey != prefix_dir else "chara~%s.nx.bea" % akey) if akey else None
        ex["nameHash"] = "0x%016x" % fnv1a64(m or name)
        clips.append({"name": name, "frames": ex.get("frames"), "loop": ex.get("loop"),
                      "duration": (ex.get("frames") or 0) / 60.0, "archive": ex["archive"],
                      "nameHash": ex["nameHash"], "missingBones": ex.get("missingBones")})
    write_glb(glb, js, rest)

    motions_out = {}
    for m, t in table.items():
        e = {"nameHash": "0x%016x" % fnv1a64(m), "files": {ext: os.path.relpath(p, BEA).replace("\\", "/") for ext, p in t["files"].items()},
             "blink": {ext: f[len(prefix):].split(".")[0] for ext, f in t["blink"].items()}}
        fr = next((c for c in clips if c["name"] == m), None)
        if fr:
            e["frames"], e["loop"] = fr["frames"], fr["loop"]
        sh = next((c for c in clips if c["name"] == m + "_shape"), None)
        if sh:
            e["shapeFrames"] = sh["frames"]
        if "fvbb" in t["files"]:
            e["vis"] = vis_table(bake(t["files"]["fvbb"]))
        if "ftsb.fmab" in t["files"]:
            e["mat"] = mat_table(bake(t["files"]["ftsb.fmab"]))
        motions_out[m] = e
    json.dump(motions_out, open(os.path.join(out, "motions.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    mj["character"] = {("PlayerCharacterID" if kind == "pc" else "NonPlayerCharacterID"): idx, "Number": cd["Number"],
                       "charaname": cd["charaname"], "textLabel": cd["text label"], "archive": os.path.basename(arc),
                       "model": cd["fmdb m1"], "motionPrefix": cd["motion filename prefix[p]"]}
    mj["clipTable"] = clips
    mj["glbBytes"] = os.path.getsize(glb)
    json.dump(mj, open(meta, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("%s: %s %d bytes, clips %s, blink %s" % (key, glb, mj["glbBytes"], [(c["name"], c["frames"], c["loop"]) for c in clips],
                                                   {m: t["blink"] for m, t in table.items() if t["blink"]}))


if __name__ == "__main__":
    main()
