"""BNSH(·BFSHA 안 BNSH) 셰이더 변형의 Maxwell(SM53) 코드를 nvdisasm 으로 디스어셈블한다. 판독 근거: web/docs/engine/07_camera_lighting.md
  .venv/Scripts/python web/tools/analysis/bnsh_sass.py <파일.bnsh|.bfsha> <변형번호> [단계 1=정점 5=픽셀(기본), 프로그램 +8×단계] [--bnsh N(bfsha 안 BNSH 순번, 기본 0)]
  .venv/Scripts/python web/tools/analysis/bnsh_sass.py <파일> --find <정규식> [--max N] [--bnsh N]   (픽셀 단계에서 정규식이 나오는 변형 찾기)
배치 [데이터]: BNSH +0x60 'grsc', grsc+0x1c 변형 수, +0x20 변형 배열(0x40 B: +0x10 프로그램), 프로그램 +8×단계 = 셰이더 정보,
  정보 +0x10 u64 코드 위치, +0x18 u32 코드 길이. 코드 = 0x30 머리 + 0x50 SPH + 명령, 명령 뒤에 상수 풀(c[0x1]) 이 붙는다.
nvdisasm: tools/nvdisasm_12.4/nvdisasm.exe (CUDA 12.4 redist, SM53 원시 바이너리 -b SM53).
"""
import argparse, re, struct, subprocess, sys, tempfile, os

ND = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "tools", "nvdisasm_12.4", "nvdisasm.exe")


def bnsh_of(path, idx):
    d = open(path, "rb").read()
    offs = [m.start() for m in re.finditer(b"BNSH", d)]
    return d[offs[idx]:]


def stage_code(b, k, stage):
    prog = struct.unpack_from("<Q", b, 0xC0 + k * 0x40 + 0x10)[0]
    si = struct.unpack_from("<Q", b, prog + 8 * stage)[0]
    if si == 0:
        return None
    pa, pc = struct.unpack_from("<QI", b, si + 0x10)
    return pa, b[pa + 0x80: pa + pc]


def disasm(code):
    n = len(code) // 8 * 8
    tmp = os.path.join(tempfile.gettempdir(), "bnsh_sass.bin")
    out = ""
    for _ in range(80):
        open(tmp, "wb").write(code[:n])
        r = subprocess.run([ND, "-b", "SM53", tmp], capture_output=True, text=True)
        out = r.stdout + r.stderr
        if "error" not in out:
            break
        m = re.search(r"address 0x([0-9a-f]+)", out)
        n = int(m.group(1), 16) // 0x20 * 0x20 if m else n - 0x20
    pool = code[n:]
    consts = [(i, struct.unpack_from("<f", pool, i)[0]) for i in range(0, len(pool) - 3, 4) if struct.unpack_from("<I", pool, i)[0]]
    return "\n".join(l for l in r.stdout.splitlines() if "NOP" not in l), consts


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("variant", nargs="?", type=int)
    ap.add_argument("stage", nargs="?", type=int, default=5)
    ap.add_argument("--bnsh", type=int, default=0)
    ap.add_argument("--find")
    ap.add_argument("--max", type=int, default=100000)
    a = ap.parse_args(argv)
    b = bnsh_of(a.file, a.bnsh)
    nvar = struct.unpack_from("<I", b, 0x60 + 0x1C)[0]
    if a.find:
        seen = set()
        for k in range(min(nvar, a.max)):
            sc = stage_code(b, k, a.stage)
            if not sc or sc[0] in seen:
                continue
            seen.add(sc[0])
            txt, _ = disasm(sc[1])
            if re.search(a.find, txt):
                print("variant", k, hex(sc[0]))
        return
    sc = stage_code(b, a.variant, a.stage)
    if not sc:
        print("단계 없음")
        return
    txt, consts = disasm(sc[1])
    print(f"// {os.path.basename(a.file)} bnsh#{a.bnsh} 변형 {a.variant}/{nvar} 단계 {a.stage} 코드 {sc[0]:#x}")
    print(txt)
    print("// c[0x1] 상수 풀:", ", ".join(f"[{i:#x}]={v:.7g}" for i, v in consts[:40]))


if __name__ == "__main__":
    main(sys.argv[1:])
