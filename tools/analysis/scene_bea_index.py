"""Archive/*.bea 헤더 색인: 이름·refs·파일 목록 → extracted/converted/scene/bea_index.json, bea_refs.tsv"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import bea

ROOT = Path(__file__).resolve().parents[3]
ARC = ROOT / "extracted/romfs/Archive"
OUT = ROOT / "extracted/converted/scene"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    rows = []
    for p in sorted(ARC.glob("*.bea")):
        a = bea.parse(p.read_bytes())
        types = Counter(f["type"] or "(blank)" for f in a["files"])
        index[p.name] = {
            "name": a["name"],
            "version": a["version"],
            "refs": a["refs"],
            "file_count": len(a["files"]),
            "types": dict(types),
            "files": [[f["name"], f["type"], f["usize"], f["flags"][0], f["flags"][1], f["unk3"]] for f in a["files"]],
        }
        rows.append(f"{p.name}\t{a['name']}\t{len(a['files'])}\t{len(a['refs'])}\t{';'.join(a['refs'])}")
    (OUT / "bea_index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    (OUT / "bea_refs.tsv").write_text("file\tname\tfiles\tref_count\trefs\n" + "\n".join(rows) + "\n", encoding="utf-8")
    print(len(index), "archives")


if __name__ == "__main__":
    main()
