"""NRO vtable 덤프 — 각 칸이 가리키는 함수 이름(자기 심볼 또는 main import)을 낸다.
  .venv/Scripts/python web/tools/analysis/nro_vtable.py <nro> <vtable 심볼부분|주소> [칸수]
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import nro
from mod_symbols import demangle
BASE = 0x7100000000
path, q = sys.argv[1], sys.argv[2]
img = nro.Image(path)
byaddr = {}
for n, (v, s) in img.syms.items():
    byaddr.setdefault(BASE + v, demangle(n))
if q.startswith("0x"):
    va = int(q, 16); size = int(sys.argv[3]) * 8 if len(sys.argv) > 3 else 0x200
else:
    k = [n for n in img.syms if q in demangle(n) and demangle(n).startswith("vtable for")]
    k.sort(key=len)
    va = BASE + img.syms[k[0]][0]; size = img.syms[k[0]][1]
    print("//", demangle(k[0]), hex(va), size)
for i in range(0, size, 8):
    off = va - BASE + i
    if off in img.imports:
        name = "IMPORT " + demangle(img.imports[off])
    else:
        p = img.u64(va + i)
        name = byaddr.get(p, hex(p))
    print(f"+0x{i:03x} (vt+0x{i-0x10:03x})  {name}")
