import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DECOMP = ROOT / "analysis" / "decomp"
OUT = DECOMP / "INDEX.tsv"

HEAD = re.compile(r"^// ==== ([0-9a-fA-F]+) (.+?)(?: \(depth \d+\))?\s*$")


def main():
    rows = []
    for f in sorted(DECOMP.glob("*.c")):
        with open(f, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                m = HEAD.match(line)
                if m:
                    rows.append((m.group(1).lower(), m.group(2), f.name))
    rows.sort()
    with open(OUT, "w", encoding="utf-8") as w:
        w.write("address\tname\tfile\n")
        for r in rows:
            w.write("\t".join(r) + "\n")
    print(f"{len(rows)} entries -> {OUT}")
    for q in sys.argv[1:]:
        for a, n, f in rows:
            if q.lower() in n.lower() or q.lower() == a:
                print(f"{a}\t{n}\t{f}")


if __name__ == "__main__":
    main()
