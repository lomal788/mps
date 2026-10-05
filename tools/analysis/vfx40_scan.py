"""main 에서 VFXB v40 EmitterData 오프셋을 즉치로 읽는 명령 찾기 (capstone, 함수 목록 analysis/functions/main.nso.tsv).

  .venv/Scripts/python web/tools/analysis/vfx40_scan.py <off:kind,...> [lo_hex hi_hex] [--min N]
     kind: b = ldrb/ldrsb w, h = ldrh/ldrsh, w = ldr w/ldrsw, x = ldr x, s = ldr s(f32), q = ldr q / ldp, * = 아무 ld

출력: 서로 다른 오프셋을 많이 읽는 함수부터. sp 기준 접근은 뺀다.
여러 필드를 함께 맞는 폭으로 읽는 함수가 EmitterData(ResEmitter) 를 읽는 vfx 코드다.
"""
import os, re, sys, collections
import capstone
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
BASE = 0x7100000000
img = open(os.path.join(ROOT, "extracted", "exefs", "main.decomp.bin"), "rb").read()
funcs = []
for line in open(os.path.join(ROOT, "analysis", "functions", "main.nso.tsv"), encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    try:
        funcs.append((int(p[0], 16), int(p[1]), p[2]))
    except (ValueError, IndexError):
        pass
funcs.sort()
md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
args = [a for a in sys.argv[1:] if not a.startswith("--")]
mn = int(sys.argv[sys.argv.index("--min") + 1]) if "--min" in sys.argv else 2
if "--min" in sys.argv:
    args.remove(sys.argv[sys.argv.index("--min") + 1])
want = {}
for t in args[0].split(","):
    o, k = t.split(":") if ":" in t else (t, "*")
    want[int(o, 16)] = k
lo = int(args[1], 16) if len(args) > 1 else 0
hi = int(args[2], 16) if len(args) > 2 else 1 << 64
pat = re.compile(r"^(\w+), \[(\w+), #(0x[0-9a-f]+)\]")


def ok(kind, mnem, reg):
    if kind == "*":
        return mnem.startswith("ld")
    if kind == "b":
        return mnem in ("ldrb", "ldrsb", "ldurb")
    if kind == "h":
        return mnem in ("ldrh", "ldrsh")
    if kind == "w":
        return (mnem == "ldr" and reg.startswith("w")) or mnem == "ldrsw"
    if kind == "x":
        return mnem == "ldr" and reg.startswith("x")
    if kind == "s":
        return mnem == "ldr" and reg.startswith("s")
    if kind == "q":
        return mnem == "ldr" and reg.startswith("q")
    return False


hits = collections.defaultdict(list)
for a, sz, name in funcs:
    if not (lo <= a < hi) or sz <= 0:
        continue
    for ins in md.disasm(img[a - BASE:a - BASE + sz], a):
        m = pat.search(ins.op_str)
        if not m or m.group(2) == "sp":
            continue
        o = int(m.group(3), 16)
        if o in want and ok(want[o], ins.mnemonic, m.group(1)):
            hits[(a, name)].append((o, f"{ins.address:x}: {ins.mnemonic} {ins.op_str}"))
rows = sorted(hits.items(), key=lambda kv: -len({o for o, _ in kv[1]}))
for (a, name), lst in rows:
    ks = sorted({o for o, _ in lst})
    if len(ks) < mn:
        continue
    print(f"{a:x} {name} distinct={len(ks)} {[hex(k) for k in ks]}")
    for _, s in lst[:16]:
        print("   ", s)
