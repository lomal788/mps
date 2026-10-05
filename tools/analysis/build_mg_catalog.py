"""analysis/minigame_catalog.tsv 보강 — 기존 열(code·nro_size·defined_syms·name_ko·name_en) 유지, 열 추가.

입력:
  extracted/nkn/hs_system.nx.bea/hs_system/data/hs_mglist.csv   (main hs::MGList 로더 0x46980 이 읽는 표)
  extracted/nkn/system.nx.bea/system/data/bex_scenelist.csv      (장면 → 아카이브)
  extracted/nkn/hs_system.nx.bea/hs_system/data/hs_house_musiclist.csv (BGM)
  extracted/message/KRko/hsmg_inst.json, hsmg_item.json
열 의미는 web/docs/analysis/03_game_structure.md 3절.
"""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
NKN = ROOT / "extracted/nkn"
MSG = ROOT / "extracted/message/KRko"
CAT = ROOT / "analysis/minigame_catalog.tsv"

TYPE_KO = {0: "4인 대전", 1: "2 vs 2", 2: "1 vs 3", 3: "2 vs 2 스포츠", 4: "대전 퍼즐", 5: "듀얼(1 vs 1)", 6: "아이템"}
PLAYERS = {0: "1:1:1:1", 1: "2:2", 2: "1:3", 3: "2:2", 4: "개인", 5: "1:1", 6: "1인"}
PACKS = ["노멀", "패밀리", "액션", "N64", "GC", "테크닉"]


def pua(s):
    s = s.replace("\r\n", " ").replace("\n", " ")
    s = re.sub(r"\[\d+:\d+:[0-9a-f]+\]", "", s)
    return re.sub(r"[-]", lambda m: "{%04X}" % ord(m.group()), s).strip()


def main():
    old = list(csv.DictReader(open(CAT, encoding="utf-8"), delimiter="\t"))
    base_cols = ["code", "nro_size", "defined_syms", "name_ko", "name_en"]
    rows = list(csv.reader(open(NKN / "hs_system.nx.bea/hs_system/data/hs_mglist.csv", encoding="utf-8")))[1:]
    ml = {}
    for i, r in enumerate(rows):
        if not r or not r[0]:
            continue
        ml[r[0]] = (i, r)

    scenes = {}
    for r in csv.reader(open(NKN / "system.nx.bea/system/data/bex_scenelist.csv", encoding="utf-8")):
        if len(r) > 5 and r[0].startswith("hsmg"):
            scenes[r[0]] = [a for a in r[4].split("|") if a and a != r[0]]

    bgm = {}
    for r in csv.reader(open(NKN / "hs_system.nx.bea/hs_system/data/hs_house_musiclist.csv", encoding="utf-8")):
        if len(r) > 6 and r[3] == "MINIGAME":
            for n in re.findall(r"\d{3}", r[6]):
                bgm.setdefault("hsmg" + n, []).append(r[6])

    inst = json.load(open(MSG / "hsmg_inst.json", encoding="utf-8"))
    item = json.load(open(MSG / "hsmg_item.json", encoding="utf-8"))

    def ctrl(code):
        out = []
        for grp, label in (("0", ""), ("1", "1명쪽:"), ("3", "3명쪽:")):
            parts = [pua(inst[k]) for k in sorted(inst) if k.startswith("inst_%s_ctrl%s" % (code, grp)) and re.fullmatch(r"inst_%s_ctrl%s\d" % (code, grp), k)]
            if parts:
                out.append(label + " / ".join(parts))
        if not out:
            parts = [pua(item[k]) for k in sorted(item) if k.startswith("%s_pop_ctrl" % code)]
            if parts:
                out.append(" / ".join(parts))
        return " | ".join(out)

    def rule(code):
        ks = ["inst_%s_rule" % code, "inst_%s_rule2" % code]
        t = " // ".join(pua(inst[k]) for k in ks if k in inst)
        if not t:
            t = " // ".join(pua(item[k]) for k in sorted(item) if k.startswith("%s_tlp_smallRule" % code))
        return t

    add_cols = ["mg_id", "type", "category", "players", "coin_mg", "koopa_mg", "order_shuffle", "flag_b6",
                "packs", "era_pack", "name_jp", "rule_ko", "ctrl_ko", "scene_archives", "bgm"]
    out = []
    for o in old:
        code = o["code"]
        i, r = ml[code]
        t = int(r[1])
        f = [int(x or 0) for x in r[3:16]]
        packs = [PACKS[k] for k in range(6) if f[7 + k]]
        n64, gc = f[10], f[11]
        origin = "N64" if n64 and not gc else "GC" if gc and not n64 else ("판별불가(전팩)" if n64 and gc else "—")
        rec = {c: o[c] for c in base_cols}
        rec.update({
            "mg_id": i,
            "type": t,
            "category": TYPE_KO[t] + ("·코인" if f[5] else "") + ("·쿠파" if f[6] else ""),
            "players": PLAYERS[t],
            "coin_mg": f[5],
            "koopa_mg": f[6],
            "order_shuffle": f[3],
            "flag_b6": f[4],
            "packs": ",".join(packs),
            "era_pack": origin,
            "name_jp": r[16] if len(r) > 16 else "",
            "rule_ko": rule(code),
            "ctrl_ko": ctrl(code),
            "scene_archives": "|".join(scenes.get(code, [])),
            "bgm": "|".join(bgm.get(code, [])),
        })
        out.append(rec)
    with open(CAT, "w", encoding="utf-8", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=base_cols + add_cols, delimiter="\t", lineterminator="\n")
        w.writeheader()
        w.writerows(out)
    print("rows", len(out))


if __name__ == "__main__":
    main()
