"""미니게임 NRO 105개의 장면 vtable 칸별 구현 여부 표.
  .venv/Scripts/python web/tools/analysis/mg_scene_overrides.py → analysis/modules/mg_scene_overrides.tsv
"""
import csv, glob, os, sys, collections
sys.path.insert(0, os.path.dirname(__file__))
import nro
from mod_symbols import demangle
BASE = 0x7100000000
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
rows = []; slotname = {}; cnt = collections.Counter()
mods = sorted(glob.glob(os.path.join(ROOT, "extracted/romfs/nro/NX_Release/*.nro")))
table = {}
for p in mods:
    mod = os.path.basename(p)[:-4]
    img = nro.Image(p)
    byaddr = {}
    for n, (v, s) in img.syms.items():
        byaddr.setdefault(BASE + v, demangle(n))
    vt = [n for n in img.syms if demangle(n).startswith("vtable for ") and demangle(n).split("::")[-1].startswith("Scene") and demangle(n).count("::") == 1]
    if not vt: continue
    v, size = img.syms[vt[0]]
    va = BASE + v; ent = []
    for i in range(0x10, size, 8):
        off = va - BASE + i
        if off in img.imports: name = "I:" + demangle(img.imports[off])
        else: name = byaddr.get(img.u64(va + i), hex(img.u64(va + i)))
        ent.append(name)
        if name.startswith("0xffff"): break
    table[mod] = ent
with open(os.path.join(ROOT, "analysis/modules/scene_vtables.tsv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f, delimiter="\t", lineterminator="\n")
    n = max(len(e) for e in table.values())
    w.writerow(["module"] + [f"vt+0x{8*i:03x}" for i in range(n)])
    for m, e in table.items(): w.writerow([m] + e)
# 미니게임: 칸별 재정의 수
mg = {m: e for m, e in table.items() if m.startswith("hsmg")}
base = table["hsmg101"]
def short(s): return s.replace("I:", "").split("(")[0]
with open(os.path.join(ROOT, "analysis/modules/mg_scene_overrides.tsv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f, delimiter="\t", lineterminator="\n")
    w.writerow(["slot", "base_name", "overridden_by_count", "examples"])
    for i in range(len(base)):
        bn = short(base[i]).split("::")[-1]
        ov = [m for m, e in mg.items() if i < len(e) and (e[i].startswith(m + "::") or e[i].startswith("non-virtual thunk for " + m))]
        w.writerow([f"vt+0x{8*i:03x}", bn, len(ov), " ".join(ov[:8])])
        print(f"vt+0x{8*i:03x}\t{bn}\t{len(ov)}")
