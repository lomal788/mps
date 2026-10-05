"""캐릭터 모션 아카이브 색인: chara~pcMot_<key>.nx.bea 85개 -> 모션 이름표.

usage: python web/tools/analysis/character_motion_index.py
output: extracted/converted/character/motion_index.json

- 모션 이름 = 파일 이름에서 "pcNN_" 접두와 확장자를 뺀 것(원본 ComActorMotion 이 SetPrefix("motion/pcNN_") 뒤에 붙여 찾는 이름).
- kinds = 그 모션 이름으로 있는 파일 종류(fskb 뼈, fvbb 뼈 표시, fshb 셰이프, ftsb.fmab 텍스처 패턴, fcmb.fmab 색, fclb.fmab ...).
- frames/loop = .fskb 의 FrameCount·Loop 플래그 (web/tools/analysis/bfres_probe = BfresLibrary). 캐릭터마다 다르면 byChar 에 적는다.
- pcMotionArcList.json(bq.nx.bea common/data) 의 장면 -> 키 목록도 함께 싣는다.
"""
import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
BEA = os.path.join(ROOT, "extracted", "bea")
PROBE = os.path.join(ROOT, "web", "tools", "analysis", "bfres_probe", "bin", "Release", "net7.0", "bfres_probe.exe")
OUT = os.path.join(ROOT, "extracted", "converted", "character", "motion_index.json")
ARCLIST = os.path.join(BEA, "bq.nx.bea", "common", "data", "pcMotionArcList.json")

KIND_RE = re.compile(r"^(pc\d\d)_(.+?)\.(fskb|fvbb|fshb|ftsb\.fmab|fcmb\.fmab|fclb\.fmab|fmab)$")
SKEL_RE = re.compile(r"^\s+skel (\S+): frames=(\d+) bones=(\d+) loop=(\w+)")


def probe(paths):
    out = {}
    r = subprocess.run([PROBE] + paths, capture_output=True, text=True, encoding="utf-8")
    cur = None
    for line in r.stdout.splitlines():
        if not line.startswith(" "):
            cur = line.split(":", 1)[0]
            if "FAIL" in line:
                out[cur] = {"error": line.split(":", 1)[1].strip()}
            continue
        m = SKEL_RE.match(line)
        if m and cur:
            out[cur] = {"frames": int(m.group(2)), "bones": int(m.group(3)), "loop": m.group(4) == "True"}
    return out


def main():
    archives = {}
    fskb = []
    for name in sorted(os.listdir(BEA)):
        if not name.startswith("chara~pcMot_"):
            continue
        key = name[len("chara~pcMot_"):-len(".nx.bea")]
        base = os.path.join(BEA, name, "chara", "pc")
        motions = {}
        chars = sorted(os.listdir(base)) if os.path.isdir(base) else []
        for ch in chars:
            mdir = os.path.join(base, ch, "motion")
            if not os.path.isdir(mdir):
                continue
            for fn in sorted(os.listdir(mdir)):
                m = KIND_RE.match(fn)
                if not m:
                    motions.setdefault("?unparsed", []).append(fn)
                    continue
                mot = motions.setdefault(m.group(2), {"kinds": set(), "chars": set()})
                mot["kinds"].add(m.group(3))
                mot["chars"].add(m.group(1))
                if m.group(3) == "fskb":
                    fskb.append((key, m.group(2), m.group(1), os.path.join(mdir, fn)))
        archives[key] = {"chars": chars, "motions": motions}

    batches = [fskb[i:i + 120] for i in range(0, len(fskb), 120)]
    info = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for res in ex.map(lambda b: probe([p for _, _, _, p in b]), batches):
            info.update(res)

    for key, mot, pc, path in fskb:
        fi = info.get(os.path.basename(path), {"error": "no probe output"})
        archives[key]["motions"][mot].setdefault("_skel", {})[pc] = fi

    total = 0
    for key, a in archives.items():
        for mot, m in list(a["motions"].items()):
            if mot == "?unparsed":
                continue
            total += 1
            skel = m.pop("_skel", {})
            m["kinds"] = sorted(m["kinds"])
            m["chars"] = sorted(m["chars"])
            vals = {(v.get("frames"), v.get("loop")) for v in skel.values()}
            if len(vals) == 1:
                f, lp = vals.pop()
                m["frames"], m["loop"] = f, lp
            elif vals:
                m["byChar"] = {pc: [v.get("frames"), v.get("loop")] for pc, v in sorted(skel.items())}
            errs = {pc: v["error"] for pc, v in skel.items() if "error" in v}
            if errs:
                m["errors"] = errs

    arclist = json.load(open(ARCLIST, encoding="utf-8-sig"))["PlayerMotArcList"]
    out = {
        "generator": "tools/character_motion_index.py (tools/bfres_probe)",
        "units": "frames at 60 fps (FSKA FrameCount), loop = FSKA loop flag",
        "archiveCount": len(archives),
        "motionNameCount": total,
        "fskbCount": len(fskb),
        "sceneArcList": {e["name"]: e["keyList"] for e in arclist},
        "archives": archives,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{len(archives)} archives, {total} motion names, {len(fskb)} fskb -> {OUT}")


if __name__ == "__main__":
    main()
