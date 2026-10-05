"""extracted/bea 전체 목록 → analysis/asset_inventory.tsv (아카이브·경로·확장자·크기·매직16B) + 요약 출력"""
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BEA = ROOT / "extracted/bea"
OUT = ROOT / "analysis/asset_inventory.tsv"


def entropy(b):
    if not b:
        return 0.0
    c = Counter(b)
    n = len(b)
    return -sum(v / n * math.log2(v / n) for v in c.values())


def main():
    rows = []
    for arc in sorted(BEA.iterdir()):
        if not arc.is_dir():
            continue
        for p in arc.rglob("*"):
            if not p.is_file():
                continue
            rel = p.relative_to(arc).as_posix()
            name = p.name
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if ext == "__file__":
                ext = name[:-9].rsplit(".", 1)[-1].lower()
            size = p.stat().st_size
            with p.open("rb") as f:
                head = f.read(4096)
            rows.append((arc.name, rel, ext, size, head[:16].hex(), round(entropy(head), 2)))
    with OUT.open("w", encoding="utf-8") as f:
        f.write("archive\tpath\text\tsize\tmagic16\tentropy4k\n")
        for r in rows:
            f.write("\t".join(map(str, r)) + "\n")
    by_ext = defaultdict(lambda: [0, 0, Counter()])
    for a, rel, ext, size, mg, ent in rows:
        e = by_ext[ext]
        e[0] += 1
        e[1] += size
        e[2][bytes.fromhex(mg)[:4]] += 1
    print(len(rows), "files")
    for ext, (n, s, mags) in sorted(by_ext.items(), key=lambda kv: -kv[1][0]):
        top = ", ".join(f"{k!r}x{v}" for k, v in mags.most_common(3))
        print(f"{ext}\t{n}\t{s}\t{top}")


if __name__ == "__main__":
    main()
