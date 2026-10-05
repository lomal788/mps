import struct
import sys

BASE = 0x7100000000

DT_NULL, DT_STRTAB, DT_SYMTAB, DT_RELA, DT_RELASZ, DT_STRSZ = 0, 5, 6, 7, 8, 10
R_AARCH64_RELATIVE = 0x403
R_AARCH64_GLOB_DAT = 0x401
R_AARCH64_ABS64 = 0x101


class Image:
    def __init__(self, path):
        data = open(path, "rb").read()
        if data[0x10:0x14] == b"NRO0":
            size = struct.unpack_from("<I", data, 0x18)[0]
            bss = struct.unpack_from("<I", data, 0x38)[0]
            self.mem = bytearray(data[:size]) + bytearray(bss)
        else:
            raise ValueError("NRO only")
        mod0 = struct.unpack_from("<I", self.mem, 4)[0]
        dyn = mod0 + struct.unpack_from("<i", self.mem, mod0 + 4)[0]
        tags = {}
        off = dyn
        while True:
            tag, val = struct.unpack_from("<qQ", self.mem, off)
            off += 16
            if tag == DT_NULL:
                break
            tags[tag] = val
        self.strtab = tags[DT_STRTAB]
        self.symtab = tags[DT_SYMTAB]
        self.syms = {}
        self.sym_by_index = []
        i = 0
        while self.symtab + i * 24 < self.strtab:
            name_off, info, other, shndx, value, size = struct.unpack_from("<IBBHQQ", self.mem, self.symtab + i * 24)
            name = self.cstr(self.strtab + name_off)
            self.sym_by_index.append((name, value, size, shndx))
            if name and shndx:
                self.syms[name] = (value, size)
            i += 1
        self.imports = {}
        rela, relasz = tags.get(DT_RELA, 0), tags.get(DT_RELASZ, 0)
        for r in range(rela, rela + relasz, 24):
            roff, rinfo, addend = struct.unpack_from("<QQq", self.mem, r)
            rtype, rsym = rinfo & 0xFFFFFFFF, rinfo >> 32
            if rtype == R_AARCH64_RELATIVE:
                struct.pack_into("<Q", self.mem, roff, BASE + addend)
            elif rtype in (R_AARCH64_GLOB_DAT, R_AARCH64_ABS64):
                name, value, size, shndx = self.sym_by_index[rsym]
                if shndx:
                    struct.pack_into("<Q", self.mem, roff, BASE + value + (addend if rtype == R_AARCH64_ABS64 else 0))
                else:
                    self.imports[roff] = name

    def cstr(self, off):
        end = self.mem.index(0, off)
        return self.mem[off:end].decode("utf-8", "replace")

    def addr(self, va):
        return va - BASE if va >= BASE else va

    def u32(self, va):
        return struct.unpack_from("<I", self.mem, self.addr(va))[0]

    def i32(self, va):
        return struct.unpack_from("<i", self.mem, self.addr(va))[0]

    def u64(self, va):
        return struct.unpack_from("<Q", self.mem, self.addr(va))[0]

    def f32(self, va):
        return struct.unpack_from("<f", self.mem, self.addr(va))[0]

    def string(self, va):
        return self.cstr(self.addr(va))

    def find(self, part):
        return {k: v for k, v in self.syms.items() if part in k}


if __name__ == "__main__":
    img = Image(sys.argv[1])
    for part in sys.argv[2:]:
        for name, (value, size) in sorted(img.find(part).items()):
            print(f"0x{BASE + value:x} size={size} {name}")
