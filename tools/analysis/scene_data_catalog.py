"""BEA 안 데이터 파일(.json/.csv/.msgpack) 카탈로그.

출력: extracted/converted/scene/data_catalog.tsv
  archive / path / kind(파일 이름 규칙으로 묶은 종류) / size / top(최상위 키 또는 CSV 머리줄) / shape(첫 배열 길이 등)
사용: python web/tools/analysis/scene_data_catalog.py [--summary]
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BEA = ROOT / "extracted/bea"
OUT = ROOT / "extracted/converted/scene/data_catalog.tsv"


def kind_of(path):
    name = Path(path).name
    k = re.sub(r"\d+", "#", name)
    k = re.sub(r"^(mg|bd|kb|ca|rc|pp|mf|mgm|menu|extra)#", r"\1#", k)
    return k


def describe_json(b):
    try:
        d = json.loads(b.decode("utf-8-sig"))
    except Exception as e:
        return "PARSE_ERROR", str(e)[:60]
    if isinstance(d, dict):
        keys = list(d)
        shape = []
        for k in keys[:6]:
            v = d[k]
            if isinstance(v, list):
                shape.append("%s[%d]" % (k, len(v)))
            elif isinstance(v, dict):
                shape.append("%s{%d}" % (k, len(v)))
        return ",".join(keys[:12]) + (",…" if len(keys) > 12 else ""), " ".join(shape)
    if isinstance(d, list):
        first = d[0] if d else None
        return "[list]", "len=%d first=%s" % (len(d), ",".join(list(first)[:8]) if isinstance(first, dict) else type(first).__name__)
    return type(d).__name__, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--summary", action="store_true")
    a = ap.parse_args()
    rows = []
    for arc in sorted(BEA.iterdir()):
        for p in sorted(arc.rglob("*")):
            if p.suffix not in (".json", ".csv", ".msgpack") or not p.is_file():
                continue
            rel = p.relative_to(arc).as_posix()
            b = p.read_bytes()
            if p.suffix == ".json":
                top, shape = describe_json(b)
            elif p.suffix == ".csv":
                lines = b.decode("utf-8-sig", "replace").splitlines()
                hdr = next((l for l in lines if l and not l.startswith("#")), "")
                top, shape = hdr[:120].replace("\t", " "), "lines=%d" % len(lines)
            else:
                top, shape = "", ""
            rows.append((arc.name.replace(".nx.bea", ""), rel, kind_of(rel), len(b), top, shape))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("archive\tpath\tkind\tsize\ttop\tshape\n")
        for r in rows:
            f.write("\t".join(str(x).replace("\t", " ") for x in r) + "\n")
    print(len(rows), "files ->", OUT)
    if a.summary:
        c = Counter((Path(r[1]).suffix, r[2]) for r in rows)
        arcs = defaultdict(set)
        for r in rows:
            arcs[(Path(r[1]).suffix, r[2])].add(r[0])
        for (ext, k), n in sorted(c.items(), key=lambda x: (-x[1], x[0])):
            print("%-9s %4d %-50s %s" % (ext, n, k, ",".join(sorted(arcs[(ext, k)]))[:90]))


if __name__ == "__main__":
    main()
