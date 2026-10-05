""".nkn 복호 — AES-128-CBC, 키·IV 는 main 이미지 상수(값은 출력하지 않는다).

근거: main @0x12d1dc (경로 끝 3글자 → "nkn" 교체 → 파일 읽기 → CbcDecryptor<AesDecryptor<16>>
       초기화(키 @rodata 0x117af09, 16B) + IV(@0x11427be, 16B) → Update(@0x12e148) 반복 → @0x12d674 로 CSV 파싱).
평문 = CSV 텍스트 + NUL 1바이트 + PKCS#7 패딩.

사용:
  nkn.py dec <in.nkn> [out]          파일 하나
  nkn.py all [--out DIR]              extracted/bea 전체 → extracted/nkn/<아카이브>/<경로>.csv + analysis/nkn_catalog.tsv
  nkn.py <in_dir> <out_dir>           (structure 담당 최초 판의 호출 형식 — all 과 같음, in_dir 는 extracted/bea)

주의: 이 파일은 [structure] 가 먼저 만든 web/tools/analysis/nkn.py 를 [assets] 가 모르고 덮어쓴 판이다(2026-10-05).
      출력 규칙(.nkn → .csv, 아카이브 폴더 유지)과 호출 형식은 최초 판과 맞췄다.
"""
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT = Path(__file__).resolve().parents[3]
MAIN = ROOT / "extracted/exefs/main.decomp.bin"
KEY_OFF = 0x117AF09
IV_OFF = 0x11427BE


def _kiv():
    d = MAIN.read_bytes()
    return d[KEY_OFF:KEY_OFF + 16], d[IV_OFF:IV_OFF + 16]


_K = None


def decrypt(raw):
    """→ (평문 bytes(NUL·패딩 제거), 상태 문자열)"""
    global _K
    if _K is None:
        _K = _kiv()
    if len(raw) % 16:
        return None, "size%16"
    k, iv = _K
    dec = Cipher(algorithms.AES(k), modes.CBC(iv)).decryptor()
    pt = dec.update(raw) + dec.finalize()
    pad = pt[-1]
    status = "ok"
    if not (1 <= pad <= 16 and pt[-pad:] == bytes([pad]) * pad):
        status = "badpad"
        body = pt
    else:
        body = pt[:-pad]
    if body.endswith(b"\0"):
        body = body[:-1]
    else:
        status += "+noNUL"
    return body, status


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    if a[0] == "dec":
        body, st = decrypt(Path(a[1]).read_bytes())
        if len(a) > 2:
            Path(a[2]).write_bytes(body)
        else:
            sys.stdout.buffer.write(body)
        print("\n#", st, file=sys.stderr)
        return
    if a[0] != "all" and len(a) == 2 and Path(a[0]).is_dir():
        a = ["all", "--out", a[1], "--in", a[0]]
    if a[0] == "all":
        out = ROOT / "extracted/nkn"
        if "--out" in a:
            out = Path(a[a.index("--out") + 1])
        src = ROOT / "extracted/bea"
        if "--in" in a:
            src = Path(a[a.index("--in") + 1])
        from collections import Counter
        st_count = Counter()
        rows = []
        for p in sorted(src.rglob("*.nkn")):
            rel = p.relative_to(src)
            body, st = decrypt(p.read_bytes())
            st_count[st] += 1
            if body is None:
                rows.append(f"{rel.as_posix()}\t{p.stat().st_size}\t{st}\t\t")
                continue
            o = out / rel.with_suffix(".csv")
            o.parent.mkdir(parents=True, exist_ok=True)
            o.write_bytes(body)
            try:
                txt = body.decode("utf-8")
                enc = "utf8"
            except UnicodeDecodeError:
                txt = ""
                enc = "binary"
            lines = txt.count("\n")
            rows.append(f"{rel.as_posix()}\t{p.stat().st_size}\t{st}\t{enc}\t{lines}")
        (ROOT / "analysis/nkn_catalog.tsv").write_text(
            "path\tsize\tstatus\tencoding\tlines\n" + "\n".join(rows) + "\n", encoding="utf-8")
        print(len(rows), "files", dict(st_count))


if __name__ == "__main__":
    main()
