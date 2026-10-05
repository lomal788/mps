import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "tools", "oss", "BNTX-Extractor"))
import bntx_extract

_orig = bntx_extract.BRTIInfo.data


def _data(self, data, pos):
    _orig(self, data, pos)
    self.flags_raw = self.tileMode
    self.tileMode &= 1


bntx_extract.BRTIInfo.data = _data

if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path, "rb") as f:
            inb = f.read()
        textures = bntx_extract.readBNTX(inb)
        cwd = os.getcwd()
        os.chdir(os.path.dirname(os.path.abspath(path)))
        try:
            bntx_extract.saveTextures(textures)
        finally:
            os.chdir(cwd)
