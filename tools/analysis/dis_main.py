"""main 평면 이미지 간이 디스어셈블러 (capstone). 동적 심볼 이름으로 bl/adrp 대상 표시.
  .venv/Scripts/python web/tools/analysis/dis_main.py <주소|심볼부분> [바이트수]
"""
import csv, os, sys
import capstone
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
BASE = 0x7100000000
img = open(os.path.join(ROOT, "extracted", "exefs", "main.decomp.bin"), "rb").read()
syms = {}
sizes = {}
for r in csv.DictReader(open(os.path.join(ROOT, "analysis", "modules", "main_exports.tsv"), encoding="utf-8"), delimiter="\t"):
    a = int(r["address"], 16)
    syms.setdefault(a, r["demangled"]); sizes[r["demangled"]] = (a, int(r["size"]))
md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
def dis(addr, n):
    for ins in md.disasm(img[addr - BASE: addr - BASE + n], addr):
        note = ""
        if ins.mnemonic in ("bl", "b") and ins.op_str.startswith("#"):
            t = int(ins.op_str[1:], 16); note = syms.get(t, "")
        print(f"{ins.address:x}: {ins.mnemonic:8s} {ins.op_str:40s} {note}")
q = sys.argv[1]
if q.startswith("0x") or all(c in "0123456789abcdef" for c in q.lower()):
    a = int(q, 16); n = int(sys.argv[2], 0) if len(sys.argv) > 2 else 0x80
    print("//", syms.get(a, "")); dis(a, n)
else:
    for name, (a, s) in sizes.items():
        if q in name:
            print(f"// {a:x} {name} size={s}"); dis(a, int(sys.argv[2], 0) if len(sys.argv) > 2 else s)
