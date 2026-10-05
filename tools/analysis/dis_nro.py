"""NRO 간이 디스어셈블러 (capstone). bl 대상 이름(함수 목록 tsv), adrp+add/ldr 대상의 문자열·f32·GOT import 를 표시.
  .venv/Scripts/python web/tools/analysis/dis_nro.py <nro이름(hsmg402)> <주소|심볼부분> [바이트수]
"""
import csv, os, re, struct, sys
import capstone
sys.path.insert(0, os.path.dirname(__file__))
import nro
from mod_symbols import demangle
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
BASE = 0x7100000000
mod = sys.argv[1]
img = nro.Image(os.path.join(ROOT, "extracted", "romfs", "nro", "NX_Release", mod + ".nro"))
fn = {}
sizes = []
for r in csv.DictReader(open(os.path.join(ROOT, "analysis", "functions", mod + ".nro.tsv"), encoding="utf-8"), delimiter="\t"):
    a = int(r["address"], 16)
    fn[a] = r["name"]
    sizes.append((a, int(r["size"]), r["name"]))
md = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)


def describe(va):
    off = va - BASE
    if off in img.imports:
        return "GOT:" + demangle(img.imports[off])
    if va in fn:
        return fn[va]
    if 0 <= off < len(img.mem) - 4:
        raw = img.mem[off:off + 64]
        end = raw.find(b"\0")
        if end >= 2 and all(32 <= c < 127 for c in raw[:end]):
            return '"' + raw[:end].decode() + '"'
        f = struct.unpack_from("<f", img.mem, off)[0]
        u = struct.unpack_from("<Q", img.mem, off)[0]
        s = f"f32={f:.7g}"
        if u in fn:
            s += " ptr->" + fn[u]
        elif BASE <= u < BASE + len(img.mem):
            s += f" ptr->{u:x}"
        return s
    return ""


def dis(addr, n):
    regs = {}
    for ins in md.disasm(bytes(img.mem[addr - BASE: addr - BASE + n]), addr):
        note = ""
        ops = ins.op_str
        if ins.mnemonic in ("bl", "b") and ops.startswith("#"):
            t = int(ops[1:], 16)
            note = fn.get(t, "")
        elif ins.mnemonic == "adrp":
            rd, imm = ops.split(", #")
            regs[rd] = int(imm, 16)
        elif ins.mnemonic == "add":
            m = re.match(r"(\w+), (\w+), #(0x[0-9a-f]+|\d+)$", ops)
            if m and m.group(2) in regs:
                va = regs[m.group(2)] + int(m.group(3), 0)
                regs[m.group(1)] = va
                note = f"{va:x} " + describe(va)
        elif ins.mnemonic.startswith("ld") or ins.mnemonic.startswith("st"):
            m = re.search(r"\[(\w+)(?:, #(-?0x[0-9a-f]+|-?\d+))?\]", ops)
            if m and m.group(1) in regs and not ops.endswith("!"):
                va = regs[m.group(1)] + int(m.group(2) or "0", 0)
                note = f"[{va:x}] " + describe(va)
        tracked = ins.mnemonic == "adrp" or (ins.mnemonic == "add" and note)
        if not tracked and ops and not ins.mnemonic.startswith("st") and ins.mnemonic not in ("cmp", "fcmp", "tst", "cbz", "cbnz", "tbz", "tbnz", "b", "bl", "blr", "br", "ret", "fccmp", "ccmp"):
            rd = ops.split(",")[0].strip()
            for r in (rd, "x" + rd[1:], "w" + rd[1:]):
                regs.pop(r, None)
        if ins.mnemonic in ("bl", "blr"):
            for r in list(regs):
                if r[1:].isdigit() and int(r[1:]) <= 18:
                    regs.pop(r)
        print(f"{ins.address:x}: {ins.mnemonic:8s} {ops:44s} {note}")


q = sys.argv[2]
if q.startswith("0x") or all(c in "0123456789abcdef" for c in q.lower()):
    a = int(q, 16)
    n = int(sys.argv[3], 0) if len(sys.argv) > 3 else next((s for x, s, _ in sizes if x == a), 0x80)
    print("//", fn.get(a, ""))
    dis(a, n)
else:
    for a, s, name in sizes:
        if q in name:
            print(f"// {a:x} {name} size={s}")
            dis(a, int(sys.argv[3], 0) if len(sys.argv) > 3 else s)
