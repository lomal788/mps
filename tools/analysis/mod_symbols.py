"""모듈 간 심볼 관계 — main/sdk/subsdk(NSO)와 NRO 126개의 동적 심볼(정의/미정의)을 읽어
누가 무엇을 export/import 하는지 표로 낸다.

  .venv/Scripts/python web/tools/analysis/mod_symbols.py      → analysis/modules/*.tsv, 요약 출력
"""
import collections
import csv
import glob
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
import nso  # noqa: E402
from itanium_demangler import parse as dm_parse  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUT = os.path.join(ROOT, "analysis", "modules")


def demangle(n):
    if not n.startswith("_Z"):
        return n
    try:
        r = dm_parse(n)
        return str(r) if r is not None else n
    except Exception:
        return n


def dynsyms(mem):
    mod0 = struct.unpack_from("<I", mem, 4)[0]
    dyn = mod0 + struct.unpack_from("<i", mem, mod0 + 4)[0]
    tags = {}
    off = dyn
    while True:
        tag, val = struct.unpack_from("<qQ", mem, off)
        off += 16
        if tag == 0:
            break
        tags.setdefault(tag, val)
    strtab, symtab = tags[5], tags[6]
    out = []
    i = 0
    while symtab + i * 24 < strtab:
        no, info, other, shndx, value, size = struct.unpack_from("<IBBHQQ", mem, symtab + i * 24)
        e = mem.index(0, strtab + no)
        name = mem[strtab + no:e].decode("utf-8", "replace")
        if name:
            out.append((name, info, shndx, value, size))
        i += 1
    return out


def nro_mem(path):
    d = open(path, "rb").read()
    size = struct.unpack_from("<I", d, 0x18)[0]
    return bytes(d[:size])


PREFIXES = ("vtable for ", "typeinfo for ", "typeinfo name for ", "guard variable for ",
            "non-virtual thunk for ", "virtual thunk for ", "vtt for ", "non-virtual thunk to ", "virtual thunk to ")


def strip_prefix(s):
    for p in PREFIXES:
        if s.startswith(p):
            s = s[len(p):]
    s = s.split("(")[0]
    depth = 0
    for i, c in enumerate(s):
        if c == "<":
            depth += 1
        elif c == ">":
            depth -= 1
        elif depth == 0 and c == " ":
            return s[i + 1:]          # 템플릿 함수의 반환형 제거
        elif depth == 0 and s[i:i + 2] == "::":
            break
    return s


def ns_of(dem):
    s = dem
    # 반환형 없는 형태 기준: 맨 앞 이름의 첫 네임스페이스
    s = strip_prefix(s)
    depth = 0
    for i, c in enumerate(s):
        if c == "<":
            depth += 1
        elif c == ">":
            depth -= 1
        elif depth == 0 and s[i:i + 2] == "::":
            return s[:i]
    return "(global)"


def cls_of(dem):
    s = dem
    for p in ("vtable for ", "typeinfo for ", "typeinfo name for ", "vtt for "):
        if s.startswith(p):
            return s[len(p):]
    s = strip_prefix(s)
    parts, depth, cur = [], 0, ""
    i = 0
    while i < len(s):
        c = s[i]
        if c == "<":
            depth += 1
        elif c == ">":
            depth -= 1
        if depth == 0 and s[i:i + 2] == "::":
            parts.append(cur)
            cur = ""
            i += 2
            continue
        cur += c
        i += 1
    return "::".join(parts) if parts else ""


def main():
    os.makedirs(OUT, exist_ok=True)
    nsos = {}
    for m in ("main", "sdk", "subsdk0", "subsdk1"):
        img, segs, bss = nso.load(os.path.join(ROOT, "extracted", "exefs", m))
        nsos[m] = dynsyms(img)
    defined = {}
    for m, syms in nsos.items():
        for name, info, shndx, value, size in syms:
            if shndx:
                defined.setdefault(name, m)
    with open(os.path.join(OUT, "main_exports.tsv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(["address", "size", "type", "namespace", "class", "demangled", "mangled"])
        for name, info, shndx, value, size in sorted(nsos["main"], key=lambda r: r[3]):
            if not shndx:
                continue
            d = demangle(name)
            w.writerow([f"0x{0x7100000000 + value:x}", size, info & 0xF, ns_of(d), cls_of(d), d, name])
    nros = sorted(glob.glob(os.path.join(ROOT, "extracted", "romfs", "nro", "NX_Release", "*.nro")))
    imp_rows = []
    per_mod = {}
    for p in nros:
        mod = os.path.basename(p)[:-4]
        syms = dynsyms(nro_mem(p))
        own = {n for n, i, sh, v, s in syms if sh}
        und = [n for n, i, sh, v, s in syms if not sh]
        c = collections.Counter()
        for n in und:
            prov = defined.get(n, "?")
            d = demangle(n)
            imp_rows.append((mod, prov, ns_of(d), cls_of(d), d, n))
            c[prov] += 1
        per_mod[mod] = (len(own), len(und), c)
    with open(os.path.join(OUT, "nro_imports.tsv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(["module", "provider", "namespace", "class", "demangled", "mangled"])
        w.writerows(imp_rows)
    with open(os.path.join(OUT, "nro_import_summary.tsv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(["module", "defined", "undefined", "from_main", "from_sdk", "from_subsdk0", "from_subsdk1", "unresolved"])
        for m, (a, b, c) in per_mod.items():
            w.writerow([m, a, b, c["main"], c["sdk"], c["subsdk0"], c["subsdk1"], c["?"]])
    # 요약
    for m, syms in nsos.items():
        dc = sum(1 for s in syms if s[2])
        print(m, "defined", dc, "undefined", len(syms) - dc)
    print("NRO import rows", len(imp_rows))


if __name__ == "__main__":
    main()
