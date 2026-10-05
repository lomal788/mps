"""FSAR(.fspj 메인 프로젝트 / .fsst 서브 아카이브) 파서 — nn::atk 사운드 아카이브(BFSAR 계열).

사용:
  python web/tools/analysis/sound_fsar.py dump <fsar> [out.json]      아카이브 목록(사운드·뱅크·웨이브 아카이브·그룹·플레이어·파일) JSON
  python web/tools/analysis/sound_fsar.py find <fsar> <라벨 정규식>    라벨 찾기

구조는 docs: web/docs/engine/04_sound.md 2절. 이 모듈은 다른 sound_* 도구가 import 한다.
"""
from __future__ import annotations

import json
import re
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path

ITEM_TYPES = {1: 'sound', 2: 'soundGroup', 3: 'bank', 4: 'player', 5: 'waveArchive', 6: 'group'}
DETAIL_TYPES = {0x2201: 'stream', 0x2202: 'wave', 0x2203: 'sequence'}


def u8(b, o):
    return b[o]


def u16(b, o):
    return struct.unpack_from('<H', b, o)[0]


def u32(b, o):
    return struct.unpack_from('<I', b, o)[0]


def s32(b, o):
    return struct.unpack_from('<i', b, o)[0]


def f32(b, o):
    return struct.unpack_from('<f', b, o)[0]


def ref(b, o):
    """Reference: u16 type, u16 pad, s32 offset. offset == -1(0xFFFFFFFF) 이면 없음."""
    t = u16(b, o)
    off = s32(b, o + 4)
    return t, (None if off == -1 else off)


def sized_ref(b, o):
    t, off = ref(b, o)
    return t, off, u32(b, o + 8)


def ref_table(b, base):
    n = u32(b, base)
    return [ref(b, base + 4 + 8 * i) for i in range(n)]


def sized_ref_table(b, base):
    n = u32(b, base)
    return [sized_ref(b, base + 4 + 12 * i) for i in range(n)]


def u32_table(b, base):
    n = u32(b, base)
    return [u32(b, base + 4 + 4 * i) for i in range(n)]


def item_str(iid):
    if iid is None or iid == 0xFFFFFFFF:
        return None
    return f"{ITEM_TYPES.get(iid >> 24, iid >> 24)}:{iid & 0xFFFFFF}"


def read_flag_values(b, o, bits):
    """u32 플래그 뒤에 켜진 비트 순서대로 u32 값이 이어진다(nn::atk OptionParameter)."""
    flags = u32(b, o)
    vals = {}
    p = o + 4
    for bit in range(32):
        if flags & (1 << bit):
            vals[bit] = u32(b, p)
            p += 4
    return flags, vals


@dataclass
class Fsar:
    path: Path
    data: bytes = b''
    version: int = 0
    sections: dict = field(default_factory=dict)
    strings: list = field(default_factory=list)
    tree: dict = field(default_factory=dict)  # 문자열 → itemId
    sounds: list = field(default_factory=list)
    sound_groups: list = field(default_factory=list)
    banks: list = field(default_factory=list)
    wave_archives: list = field(default_factory=list)
    groups: list = field(default_factory=list)
    players: list = field(default_factory=list)
    files: list = field(default_factory=list)
    player_info: dict = field(default_factory=dict)

    def __post_init__(self):
        self.path = Path(self.path)
        self.data = self.path.read_bytes()
        b = self.data
        assert b[:4] == b'FSAR', b[:4]
        assert u16(b, 4) == 0xFEFF
        self.version = u32(b, 8)
        nsec = u16(b, 0x10)
        for i in range(nsec):
            t, off, size = sized_ref(b, 0x14 + 12 * i)
            self.sections[t] = (off, size)
        if 0x2000 in self.sections:
            self._parse_strg(*self.sections[0x2000])
        self._parse_info(*self.sections[0x2001])

    # ---- STRG
    def _parse_strg(self, off, size):
        b = self.data
        assert b[off:off + 4] == b'STRG'
        base = off + 8
        refs = {}
        for i in range(2):
            t, o = ref(b, base + 8 * i)
            refs[t] = o
        st = base + refs[0x2400]
        for t, o, sz in sized_ref_table(b, st):
            s = b[st + o: st + o + sz].split(b'\0')[0].decode('ascii', 'replace')
            self.strings.append(s)
        tr = base + refs[0x2401]
        _root = u32(b, tr)
        n = u32(b, tr + 4)
        for i in range(n):
            no = tr + 8 + 0x14 * i
            flags = u16(b, no)
            sid = u32(b, no + 12)
            iid = u32(b, no + 16)
            if flags & 1 and sid != 0xFFFFFFFF:
                self.tree[self.strings[sid]] = iid

    def name(self, sid):
        if sid is None or sid == 0xFFFFFFFF or sid >= len(self.strings):
            return None
        return self.strings[sid]

    # ---- INFO
    def _parse_info(self, off, size):
        b = self.data
        assert b[off:off + 4] == b'INFO'
        base = off + 8
        refs = {}
        for i in range(8):
            t, o = ref(b, base + 8 * i)
            refs[t] = o
        self.info_refs = refs

        def table(t):
            tb = base + refs[t]
            return [(tb + o if o is not None else None, tt) for tt, o in ref_table(b, tb)]

        for i, (o, _) in enumerate(table(0x2100)):
            self.sounds.append(self._sound(i, o))
        for i, (o, _) in enumerate(table(0x2104)):
            self.sound_groups.append(self._sound_group(i, o))
        for i, (o, _) in enumerate(table(0x2101)):
            fid = u32(b, o)
            t, wo = ref(b, o + 4)
            wars = u32_table(b, o + wo) if wo is not None else []
            flags, vals = read_flag_values(b, o + 12, 32)
            self.banks.append({'index': i, 'name': self.name(vals.get(0)), 'fileId': fid,
                               'waveArchives': [item_str(x) for x in wars]})
        for i, (o, _) in enumerate(table(0x2103)):
            fid = u32(b, o)
            indiv = u8(b, o + 4)
            flags, vals = read_flag_values(b, o + 8, 32)
            self.wave_archives.append({'index': i, 'name': self.name(vals.get(0)), 'fileId': fid,
                                       'loadIndividual': indiv, 'waveCount': vals.get(1)})
        for i, (o, _) in enumerate(table(0x2105)):
            fid = u32(b, o)
            flags, vals = read_flag_values(b, o + 4, 32)
            self.groups.append({'index': i, 'name': self.name(vals.get(0)), 'fileId': fid})
        for i, (o, _) in enumerate(table(0x2102)):
            mx = u32(b, o)
            flags, vals = read_flag_values(b, o + 4, 32)
            self.players.append({'index': i, 'name': self.name(vals.get(0)), 'playableSoundMax': mx,
                                 'heapSize': vals.get(1)})
        file_section = self.sections.get(0x2002)
        for i, (o, _) in enumerate(table(0x2106)):
            t, lo = ref(b, o)
            ent = {'index': i}
            if t == 0x220C and lo is not None:
                p = o + lo
                ft, foff, fsz = sized_ref(b, p)
                if foff is not None and file_section:
                    ent['internal'] = {'offset': file_section[0] + 8 + foff, 'size': fsz}
                else:
                    ent['internal'] = None
            elif t == 0x220D and lo is not None:
                p = o + lo
                ent['external'] = b[p:p + 256].split(b'\0')[0].decode('ascii', 'replace')
            else:
                ent['type'] = hex(t)
            self.files.append(ent)
        if refs.get(0x220B) is not None:
            o = base + refs[0x220B]
            keys = ['sequenceSoundMax', 'sequenceTrackMax', 'streamSoundMax', 'streamTrackMax',
                    'streamChannelMax', 'waveSoundMax', 'waveTrackMax']
            self.player_info = {k: u16(b, o + 2 * i) for i, k in enumerate(keys)}
            self.player_info['raw'] = b[o:o + 0x18].hex()

    def _sound(self, i, o):
        b = self.data
        fid = u32(b, o)
        pid = u32(b, o + 4)
        vol = u8(b, o + 8)
        rfilter = u8(b, o + 9)
        dt, do = ref(b, o + 12)
        flags, vals = read_flag_values(b, o + 20, 32)
        s = {'index': i, 'name': self.name(vals.get(0)), 'fileId': fid, 'player': item_str(pid),
             'volume': vol, 'remoteFilter': rfilter, 'type': DETAIL_TYPES.get(dt, hex(dt)),
             'optFlags': hex(flags)}
        if 1 in vals:
            s['panMode'] = vals[1] & 0xFF
            s['panCurve'] = (vals[1] >> 8) & 0xFF
        if 2 in vals:
            s['playerPriority'] = vals[2] & 0xFF
            s['isReleasePriorityFix'] = (vals[2] >> 8) & 0xFF
        if 3 in vals:
            s['singlePlay'] = {'type': vals[3] & 0xFFFF, 'effectiveDuration': vals[3] >> 16}
        if 8 in vals:
            s['sound3d'] = self._sound3d(o + vals[8])
        if 17 in vals:
            s['frontBypass'] = vals[17]
        user = {k: vals[k] for k in vals if k >= 28}
        if user:
            s['userParam'] = {str(k): v for k, v in user.items()}
        others = [k for k in vals if k not in (0, 1, 2, 3, 8, 17) and k < 28]
        if others:
            s['unknownOpt'] = {str(k): vals[k] for k in others}
        if do is not None:
            p = o + do
            if dt == 0x2202:
                s['wave'] = {'index': u32(b, p), 'allocTrack': u32(b, p + 4)}
                fl, vv = read_flag_values(b, p + 8, 32)
                if 0 in vv:
                    s['wave']['channelPriority'] = vv[0] & 0xFF
                    s['wave']['isReleasePriorityFix'] = (vv[0] >> 8) & 0xFF
            elif dt == 0x2203:
                bt, bo = ref(b, p)
                banks = u32_table(b, p + bo) if bo is not None else []
                alloc = u32(b, p + 8)
                fl, vv = read_flag_values(b, p + 12, 32)
                s['sequence'] = {'banks': [item_str(x) for x in banks], 'allocTrackFlags': hex(alloc),
                                 'startOffset': vv.get(0)}
                if 1 in vv:
                    s['sequence']['channelPriority'] = vv[1] & 0xFF
                    s['sequence']['isReleasePriorityFix'] = (vv[1] >> 8) & 0xFF
            elif dt == 0x2201:
                s['stream'] = self._stream_info(p)
        return s

    def _stream_info(self, p):
        b = self.data
        d = {'raw': b[p:p + 0x30].hex()}
        d['validTracks'] = u16(b, p)
        d['channelCount'] = u16(b, p + 2)
        tt, to = ref(b, p + 4)
        d['pitch'] = f32(b, p + 12)
        st, so = ref(b, p + 16)
        et, eo = ref(b, p + 24)
        d['prefetchFileId'] = u32(b, p + 32)
        if to is not None:
            tracks = []
            for t2, o2 in ref_table(b, p + to):
                q = p + to + o2
                tracks.append({'volume': u8(b, q), 'pan': u8(b, q + 1), 'span': u8(b, q + 2),
                               'flags': u8(b, q + 3), 'raw': b[q:q + 0x18].hex()})
            d['tracks'] = tracks
        if eo is not None:
            q = p + eo
            d['ext'] = {'streamType': u32(b, q), 'loopFlag': u32(b, q + 4),
                        'loopStart': u32(b, q + 8), 'loopEnd': u32(b, q + 12), 'raw': b[q:q + 0x14].hex()}
        if so is not None:
            q = p + so
            d['send'] = {'main': u8(b, q), 'fx': [u8(b, q + 1 + k) for k in range(3)]}
        return d

    def _sound3d(self, p):
        b = self.data
        fl = u32(b, p)
        return {'flags': hex(fl),
                'volume': bool(fl & 1), 'priority': bool(fl & 2), 'pan': bool(fl & 4),
                'span': bool(fl & 8), 'filter': bool(fl & 16),
                'decayRatio': round(f32(b, p + 4), 6), 'decayCurve': u8(b, p + 8),
                'dopplerFactor': u8(b, p + 9), 'raw': b[p:p + 0x14].hex()}

    def _sound_group(self, i, o):
        b = self.data
        start = u32(b, o)
        end = u32(b, o + 4)
        ft, fo = ref(b, o + 8)
        files = u32_table(b, o + fo) if fo is not None else []
        wt, wo = ref(b, o + 16)
        flags, vals = read_flag_values(b, o + 24, 32)
        g = {'index': i, 'name': self.name(vals.get(0)), 'start': item_str(start), 'end': item_str(end),
             'fileIds': files}
        if wo is not None:
            q = o + wo
            g['waveSoundGroup'] = {'raw': b[q:q + 0x20].hex()}
            wt2, wo2 = ref(b, q)
            if wo2 is not None:
                g['waveSoundGroup']['waveArchives'] = [item_str(x) for x in u32_table(b, q + wo2)]
        return g

    # ---- 파일
    def file_bytes(self, fid):
        f = self.files[fid]
        it = f.get('internal')
        if not it:
            return None
        return self.data[it['offset']: it['offset'] + it['size']]

    def find(self, label):
        iid = self.tree.get(label)
        if iid is None:
            return None
        t, idx = iid >> 24, iid & 0xFFFFFF
        return {1: self.sounds, 2: self.sound_groups, 3: self.banks, 4: self.players,
                5: self.wave_archives, 6: self.groups}[t][idx]

    def to_json(self):
        return {'path': str(self.path), 'version': hex(self.version),
                'sections': {hex(k): v for k, v in self.sections.items()},
                'counts': {'strings': len(self.strings), 'sounds': len(self.sounds),
                           'soundGroups': len(self.sound_groups), 'banks': len(self.banks),
                           'waveArchives': len(self.wave_archives), 'groups': len(self.groups),
                           'players': len(self.players), 'files': len(self.files)},
                'playerInfo': self.player_info,
                'players': self.players, 'sounds': self.sounds, 'soundGroups': self.sound_groups,
                'banks': self.banks, 'waveArchives': self.wave_archives, 'groups': self.groups,
                'files': [dict(f, magic=(self.file_bytes(f['index']) or b'')[:4].decode('ascii', 'replace'))
                          for f in self.files]}


def main(argv):
    if len(argv) >= 2 and argv[0] == 'dump':
        fs = Fsar(argv[1])
        js = json.dumps(fs.to_json(), ensure_ascii=False, indent=1)
        if len(argv) >= 3:
            Path(argv[2]).parent.mkdir(parents=True, exist_ok=True)
            Path(argv[2]).write_text(js, encoding='utf-8')
            print(argv[2], fs.to_json()['counts'])
        else:
            print(js)
    elif len(argv) >= 3 and argv[0] == 'find':
        fs = Fsar(argv[1])
        rx = re.compile(argv[2])
        for s in fs.strings:
            if rx.search(s):
                print(s, item_str(fs.tree.get(s)))
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
