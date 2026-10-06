"""hsmg402 공용 흐름(main) 시작·종료·결과 소리 → web/assets/hsmg402/sound_sys/(sys.json + wave/ + voice/).

원본 근거 [판독: analysis/decomp/sound_mgflow7.c·sound_telop2.c·sound_telop3.c·sound_stop.c, 문서 web/docs/minigame/hsmg402.md 7.7.1]
  - 시작·끝 텔롭 = main hs::SceneMiniGameBase::SetupGame 이 만드는 UIMGTelop type 0(START)·type 2(FINISH)(장면 +0x340/+0x360 시퀀스 칸).
    결과 텔롭 = hsmg402 GameMgr 의 type 5(승자)·6(무승부).
  - UIMGTelop::Create 는 표 0x71014ab280(type × 0x30: +0 레이아웃, +8 SE 라벨, +0x10 음성 라벨, +0x18 메시지, +0x20 애니, +0x28 inout 플래그)에서
    SE(+0x90)·음성(+0x98)을 고르고 Start() 가 bex::Sound::Play 로 둘 다 낸다. type 5 는 SE 칸을 SetPlayers 가 WINNER(1명 이하)/WINNERS(2명 이상)로 바꾼다.
  - 로캘 음성: 코드 라벨 WD_VOI_LOC_SYS_* + '_' + 프리셋 global 'v' 레코드 접미(koKR → subarc_sysvoi_kokr, KOKR) [데이터: 아카이브 라벨 이름].
  - 호루라기 SQ_SE_SYS_WHISTLE: MGSound FUN_710004d528(n) 이 mgsound_setting whistle_entry_type == n 일 때.
  - 결과 징글은 메인 manifest(hsmg402_web_assets.py JINGLES)에 이미 있다 — 여기서는 설정 값만 기록.

  .venv/Scripts/python web/tools/analysis/hsmg402_sys_sound_assets.py
"""
from __future__ import annotations

import csv
import json
import struct
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "web" / "tools" / "analysis"))
import sound_preset  # noqa: E402
from hsmg402_web_assets import export_seq, player_of, sound3d_of  # noqa: E402
from sound_fsar import Fsar  # noqa: E402
from sound_seq import SoundSet  # noqa: E402

EX = ROOT / "extracted"
BEA = EX / "bea"
MAIN_BIN = EX / "exefs" / "main.decomp.bin"
MAIN_FSPJ = BEA / "Resident.nx.bea/_Resident/AddonAudioProject.fspj"
MGSOUND_CSV = EX / "nkn/audio.nx.bea/audio/data/mgsound_setting.csv"
DST = ROOT / "web" / "assets" / "hsmg402" / "sound_sys"
BASE = 0x7100000000
TELOP_TABLE = 0x71014AB280
TELOP_TYPES = 13
LOCALE = "koKR"
# 이 게임 흐름에서 실제로 Start() 되는 텔롭 type(0 START·2 FINISH: 기반 SetupGame, 5·6: hsmg402 GameMgr)
USED_TYPES = [0, 2, 5, 6]
# type 5 의 SE 칸 치환(UIMGTelop::Create case 5, SetPlayers @0x71000d4990/0x71000d49a0)
WINNER_LABELS = ["WD_VOI_LOC_SYS_WINNER", "WD_VOI_LOC_SYS_WINNERS"]
SEQ_LABELS = ["SQ_SE_TLP_START", "SQ_SE_TLP_FINISH", "SQ_SE_SYS_WHISTLE"]


class MainImage:
    """main.decomp.bin(nso.py 평면 이미지) + R_AARCH64_RELATIVE 재배치."""

    def __init__(self, path: Path):
        self.mem = bytearray(path.read_bytes())
        mod0 = struct.unpack_from("<I", self.mem, 4)[0]
        assert self.mem[mod0:mod0 + 4] == b"MOD0"
        dyn = mod0 + struct.unpack_from("<i", self.mem, mod0 + 4)[0]
        tags, off = {}, dyn
        while True:
            tag, val = struct.unpack_from("<qQ", self.mem, off)
            off += 16
            if tag == 0:
                break
            tags.setdefault(tag, val)
        rela, relasz = tags[7], tags[8]
        for r in range(rela, rela + relasz, 24):
            roff, rinfo, addend = struct.unpack_from("<QQq", self.mem, r)
            if rinfo & 0xFFFFFFFF == 0x403:
                struct.pack_into("<Q", self.mem, roff, BASE + addend)

    def u64(self, va: int) -> int:
        return struct.unpack_from("<Q", self.mem, va - BASE)[0]

    def cstr(self, va: int) -> str | None:
        if va == 0:
            return None
        o = va - BASE
        return self.mem[o:self.mem.index(0, o)].decode("utf-8")


def telop_table(img: MainImage) -> list[dict]:
    out = []
    for t in range(TELOP_TYPES):
        p = TELOP_TABLE + t * 0x30
        out.append({"type": t, "layout": img.cstr(img.u64(p)), "se": img.cstr(img.u64(p + 8)), "voice": img.cstr(img.u64(p + 0x10)),
                    "message": img.cstr(img.u64(p + 0x18)), "anim": img.cstr(img.u64(p + 0x20)), "inout": img.u64(p + 0x28) & 0xFF})
    return out


def mgsound_setting(mg: str) -> dict:
    rows = list(csv.reader(MGSOUND_CSV.read_text(encoding="utf-8").splitlines()))
    default = next(r for r in rows if r and r[0] == ";default")
    header = next(r for r in rows if r and r[0] == ";id")
    row = next(r for r in rows if r and r[0] == mg)
    res = {}
    for i, name in enumerate(header):
        if i < 2:
            continue
        v = row[i] if i < len(row) else ""
        d = default[i] if i < len(default) else ""
        res[name] = {"value": v if v != "" else d, "fromDefault": v == "" and d != ""}
    return res


def voice_locale() -> dict:
    for blk in sound_preset.preset("global")["blocks"]:
        for rec in blk["records"]:
            s = rec.get("strs", {})
            if rec["type"] == "v" and s.get("2") == LOCALE:
                return {"locale": LOCALE, "archive": s["3"], "suffix": s["4"]}
    raise SystemExit(f"global 프리셋에 {LOCALE} 'v' 레코드 없음")


def fwsd_note(fws: bytes, index: int):
    """FWSD index 번째 웨이브 사운드 → (웨이브 아카이브 item, 파형 번호, 정보). 형식을 assert 로 확인한다 [데이터: subarc_sysvoi_kokr 18개]."""
    assert fws[:4] == b"FWSD", fws[:4]
    info = struct.unpack_from("<I", fws, 0x18)[0] + 8
    assert fws[info - 8:info - 4] == b"INFO", fws[info - 8:info - 4]
    t1, o1, t2, o2 = struct.unpack_from("<HxxiHxxi", fws, info)
    assert (t1, t2) == (0x0100, 0x0101), (hex(t1), hex(t2))
    wid, wst = info + o1, info + o2
    t, o = struct.unpack_from("<Hxxi", fws, wst + 4 + 8 * index)
    assert t == 0x4900, hex(t)
    ws = wst + o
    ti, oi, tt, _ot, tn, on = struct.unpack_from("<HxxiHxxiHxxi", fws, ws)
    assert (ti, tt, tn) == (0x4901, 0x0101, 0x0101), (hex(ti), hex(tt), hex(tn))
    flags = struct.unpack_from("<I", fws, ws + oi)[0]
    vals, q = {}, ws + oi + 4
    for bit in range(32):
        if flags >> bit & 1:
            vals[bit] = fws[q:q + 4]
            q += 4
    pitch = struct.unpack("<f", vals[1])[0] if 1 in vals else 1.0
    nl = ws + on
    assert struct.unpack_from("<I", fws, nl)[0] == 1
    t, o = struct.unpack_from("<Hxxi", fws, nl + 4)
    assert t == 0x4902, hex(t)
    widx, nflags = struct.unpack_from("<II", fws, nl + o)
    assert nflags == 0, hex(nflags)
    war_item, wave_index = struct.unpack_from("<II", fws, wid + 4 + 8 * widx)
    return war_item, wave_index, {"pitch": pitch, "infoFlags": hex(flags)}


def export_voice(fs: Fsar, sset: SoundSet, code_label: str, loc: dict) -> dict:
    target = f"{code_label}_{loc['suffix']}"
    s = fs.find(target)
    assert s and s["type"] == "wave", (target, s and s["type"])
    war_item, wave_index, winfo = fwsd_note(fs.file_bytes(s["fileId"]), s["wave"]["index"])
    assert winfo["pitch"] == 1.0, winfo
    w = sset.wave(war_item, wave_index)
    pcm = np.stack(w["channels"], axis=1).astype("<i2")
    name = f"{target}.wav"
    with wave.open(str(DST / "voice" / name), "wb") as wf:
        wf.setnchannels(pcm.shape[1])
        wf.setsampwidth(2)
        wf.setframerate(w["sampleRate"])
        wf.writeframes(pcm.tobytes())
    return {"kind": "stream", "bus": "voice", "file": f"sound_sys/voice/{name}", "target": target, "archive": loc["archive"],
            "volume": s["volume"], "gain": round(s["volume"] / 127.0, 6), "durationSec": round(w["frames"] / w["sampleRate"], 6),
            "sampleRate": w["sampleRate"], "frames": w["frames"], "channels": pcm.shape[1],
            "peak": round(float(np.abs(pcm).max()) / 32768.0, 4), "player": player_of(fs, s),
            "playerPriority": s.get("playerPriority", 64), "loop": None}


def main() -> None:
    for sub in ("wave", "voice"):
        (DST / sub).mkdir(parents=True, exist_ok=True)
    img = MainImage(MAIN_BIN)
    table = telop_table(img)
    loc = voice_locale()
    setting = mgsound_setting("hsmg402")
    main_fs = Fsar(MAIN_FSPJ)
    main_set = SoundSet(main_fs)
    sounds: dict = {}
    wave_files: set[str] = set()
    for label in SEQ_LABELS:
        s = main_fs.find(label)
        assert s and s["type"] == "sequence", label
        seq = export_seq(main_fs, main_set, "sys", s, DST / "wave", wave_files, {})
        for w in seq["waves"]:
            w["file"] = w["file"].replace("sound/wave/", "sound_sys/wave/")
        sounds[label] = {"kind": "seq", "bus": "se", "player": player_of(main_fs, s), "playerPriority": s.get("playerPriority", 64),
                         "sound3d": sound3d_of(s), "seq": seq}
    vfs = Fsar(BEA / f"sound~{loc['archive']}.nx.bea/audio/sounddata/{loc['archive']}/{loc['archive']}.fsst")
    vset = SoundSet(vfs)
    voice_labels = sorted({table[t]["voice"] for t in USED_TYPES if table[t]["voice"]} | set(WINNER_LABELS))
    for label in voice_labels:
        sounds[label] = export_voice(vfs, vset, label, loc)
    telop = {}
    for t in USED_TYPES:
        e = dict(table[t])
        # Create: 빈 문자열은 ""(재생 안 함). type 5 는 SE 칸 = WINNER(SetPlayers 가 인원으로 다시 고름)
        se_slot = "WD_VOI_LOC_SYS_WINNER" if t == 5 else (e["se"] or "")
        e["slot90"] = se_slot
        e["slot98"] = e["voice"] or ""
        # Create: +0xa4 idle 시간(normal 유지 초) — type 0 = 0.5, type 2 = 1.0, 그 밖은 −1(Out 을 부를 때까지 유지)
        e["idleSec"] = 0.5 if t == 0 and not e["inout"] else 1.0 if t == 2 and not e["inout"] else -1.0
        # Start(): type 5·6 은 MGSound FUN_710004cf78(1, type) → 결과 징글(SM_JIN_MG_WIN / SM_JIN_MG_DRAW, FUN_710004d150)
        e["jingle"] = {5: "SM_JIN_MG_WIN", 6: "SM_JIN_MG_DRAW"}.get(t)
        telop[str(t)] = e
    out = {
        "note": "web/tools/analysis/hsmg402_sys_sound_assets.py — 공용 흐름 텔롭·호루라기 소리(원본 디코드 그대로)",
        "sounds": sounds,
        "telop": telop,
        "telopTable": table,
        "voiceLocale": loc,
        "whistle": {"label": "SQ_SE_SYS_WHISTLE", "entryType": int(setting["whistle_entry_type"]["value"] or 0)},
        "setting": setting,
    }
    (DST / "sys.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("sounds", len(sounds), "wave files", len(wave_files), "->", DST / "sys.json")
    for k, v in sounds.items():
        if v["kind"] == "stream":
            print(f"  {k} -> {v['target']} {v['durationSec']}s {v['sampleRate']}Hz ch{v['channels']} vol {v['volume']} peak {v['peak']}")
        else:
            print(f"  {k} seq vol {v['seq']['volume']} waves {len(v['seq']['waves'])} player {v['player']}")


if __name__ == "__main__":
    main()
