"""main.decomp.bin 디스어셈블: dis.py <bin> <start_hex> <count>"""
import sys
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
d = open(sys.argv[1], "rb").read()
a = int(sys.argv[2], 16); n = int(sys.argv[3])
md = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
for i in md.disasm(d[a:a + n * 4], a):
    print(f"{i.address:#9x}: {i.mnemonic:8s} {i.op_str}")
