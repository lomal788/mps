"""nn::atk 시퀀스 사운드 도구 — FSEQ 역어셈블, FBNK/FWAR/FWAV 파싱, DSP-ADPCM 디코드, 시퀀스 렌더(재구현 근사).

사용:
  python web/tools/analysis/sound_seq.py disasm <fsar> <라벨>            시퀀스 라벨의 명령 목록(정적, 도달 가능한 코드)
  python web/tools/analysis/sound_seq.py bank <fsar> <뱅크 이름|번호>      뱅크 악기·영역 표
  python web/tools/analysis/sound_seq.py render <fsar> <라벨> <out.wav> [초]  렌더(근사). 이벤트 로그를 out.json 으로

근거 수준(04_sound.md):
  - 파일 구조·명령 바이트 해석: [데이터] (표본으로 확인한 범위)
  - 렌더러의 엔벌로프·볼륨 곡선·팬 곡선·틱 양자화: [추정] nn::atk(NW4R 계열) 공개 지식 기반 재구현. 원본 출력과 대조하지 않았다.
"""
from __future__ import annotations

import json
import math
import struct
import sys
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from sound_fsar import Fsar, item_str, ref, sized_ref, u8, u16, u32, s32, f32  # noqa: E402


# ---------------------------------------------------------------- 공통 파일 헤더
def file_blocks(b):
    """nn::atk 바이너리 공통 헤더: magic, BOM, headerSize, version, fileSize, nBlocks, blockRefs{u16 type,pad,s32 off,u32 size}"""
    n = u16(b, 0x10)
    out = {}
    for i in range(n):
        t, off, size = sized_ref(b, 0x14 + 12 * i)
        out[t] = (off, size)
    return u32(b, 8), out


# ---------------------------------------------------------------- FSEQ
def parse_fseq(b):
    assert b[:4] == b'FSEQ'
    ver, blocks = file_blocks(b)
    doff, dsize = blocks[0x5000]
    data = b[doff + 8: doff + dsize]
    labels = {}
    if 0x5001 in blocks:
        loff, _ = blocks[0x5001]
        base = loff + 8
        n = u32(b, base)
        for i in range(n):
            t, o = ref(b, base + 4 + 8 * i)
            p = base + o
            dt, doffs = ref(b, p)
            ln = u32(b, p + 8)
            name = b[p + 12: p + 12 + ln].decode('ascii', 'replace')
            labels[name] = doffs
    return {'version': ver, 'data': data, 'labels': labels}


EXT_VAR = {0x80: 'setvar', 0x81: 'addvar', 0x82: 'subvar', 0x83: 'mulvar', 0x84: 'divvar', 0x85: 'shiftvar',
           0x86: 'randvar', 0x87: 'andvar', 0x88: 'orvar', 0x89: 'xorvar', 0x8A: 'notvar', 0x8B: 'modvar',
           0x90: 'cmp_eq', 0x91: 'cmp_ge', 0x92: 'cmp_gt', 0x93: 'cmp_le', 0x94: 'cmp_lt', 0x95: 'cmp_ne'}

U8_CMDS = {0xB0: 'timebase', 0xB1: 'env_hold', 0xB2: 'monophonic', 0xB3: 'velocity_range', 0xB4: 'biquad_type',
           0xB5: 'biquad_value', 0xB6: 'bank_select', 0xBD: 'mod_phase', 0xBE: 'mod_curve', 0xBF: 'front_bypass',
           0xC0: 'pan', 0xC1: 'volume', 0xC2: 'main_volume', 0xC3: 'transpose', 0xC4: 'pitch_bend',
           0xC5: 'bend_range', 0xC6: 'prio', 0xC7: 'note_wait', 0xC8: 'tie', 0xC9: 'porta', 0xCA: 'mod_depth',
           0xCB: 'mod_speed', 0xCC: 'mod_type', 0xCD: 'mod_range', 0xCE: 'porta_sw', 0xCF: 'porta_time',
           0xD0: 'attack', 0xD1: 'decay', 0xD2: 'sustain', 0xD3: 'release', 0xD4: 'loop_start', 0xD5: 'volume2',
           0xD6: 'printvar', 0xD7: 'surround_pan', 0xD8: 'lpf_cutoff', 0xD9: 'fxsend_a', 0xDA: 'fxsend_b',
           0xDB: 'mainsend', 0xDC: 'init_pan', 0xDD: 'mute', 0xDE: 'fxsend_c', 0xDF: 'damper'}
S8_CMDS = {0xC3, 0xC4, 0xD7, 0xD8}
S16_CMDS = {0xE0: 'mod_delay', 0xE1: 'tempo', 0xE2: 'mod_period', 0xE3: 'sweep_pitch'}
NOARG = {0xFB: 'env_reset', 0xFC: 'loop_end', 0xFD: 'ret', 0xFF: 'fin'}


class Reader:
    def __init__(self, data, pc):
        self.d = data
        self.pc = pc

    def u8(self):
        v = self.d[self.pc]
        self.pc += 1
        return v

    def s8(self):
        v = self.u8()
        return v - 256 if v >= 128 else v

    def u16(self):
        v = self.d[self.pc] | (self.d[self.pc + 1] << 8)
        self.pc += 2
        return v

    def s16(self):
        v = self.u16()
        return v - 65536 if v >= 32768 else v

    def u24(self):
        v = self.d[self.pc] | (self.d[self.pc + 1] << 8) | (self.d[self.pc + 2] << 16)
        self.pc += 3
        return v

    def vlen(self):
        v = 0
        while True:
            c = self.u8()
            v = (v << 7) | (c & 0x7F)
            if not c & 0x80:
                return v


def decode_cmd(r: Reader):
    """명령 하나를 읽어 dict 로 돌려준다. 접두(random/variable/if/time*)는 'prefix' 목록으로 붙인다.

    인자 규칙 [데이터: 표본 해석이 일관됨 / 명령 표는 NW4R·nn::atk MML 계열 공개 지식]
      접두 0xA0 random: 마지막 인자 대신 s16 min, s16 max
      접두 0xA1 variable: 마지막 인자 대신 u8 변수 번호
      접두 0xA2 if: 비교 플래그가 참일 때만 실행
      접두 0xA3/0xA4/0xA5 time/time_random/time_variable: 뒤 명령 인자 뒤에 s16 시간(또는 범위/변수)
    다중 바이트 인자는 리틀 엔디언이다(호출 주소가 데이터 범위 안에 들어오는 것으로 확인).
    """
    start = r.pc
    prefix = []
    argmode = None  # None / 'random' / 'variable'
    timemode = None
    while True:
        c = r.u8()
        if c == 0xA0:
            prefix.append('random'); argmode = 'random'; continue
        if c == 0xA1:
            prefix.append('variable'); argmode = 'variable'; continue
        if c == 0xA2:
            prefix.append('if'); continue
        if c in (0xA3, 0xA4, 0xA5):
            prefix.append({0xA3: 'time', 0xA4: 'time_random', 0xA5: 'time_variable'}[c]); timemode = c; continue
        break

    def last_arg(kind):
        if argmode == 'random':
            return ('random', r.s16(), r.s16())
        if argmode == 'variable':
            return ('var', r.u8())
        return {'u8': r.u8, 's8': r.s8, 'u16': r.u16, 's16': r.s16, 'vlen': r.vlen}[kind]()

    cmd = {'pc': start, 'op': c, 'prefix': prefix}
    if c < 0x80:
        cmd['name'] = 'note'
        cmd['key'] = c
        cmd['velocity'] = r.u8()
        cmd['length'] = last_arg('vlen')
    elif c == 0x80:
        cmd['name'] = 'wait'; cmd['value'] = last_arg('vlen')
    elif c == 0x81:
        cmd['name'] = 'prg'; cmd['value'] = last_arg('vlen')
    elif c == 0x88:
        cmd['name'] = 'opentrack'; cmd['track'] = r.u8(); cmd['target'] = r.u24()
    elif c == 0x89:
        cmd['name'] = 'jump'; cmd['target'] = r.u24()
    elif c == 0x8A:
        cmd['name'] = 'call'; cmd['target'] = r.u24()
    elif c in U8_CMDS:
        cmd['name'] = U8_CMDS[c]; cmd['value'] = last_arg('s8' if c in S8_CMDS else 'u8')
    elif c in S16_CMDS:
        cmd['name'] = S16_CMDS[c]; cmd['value'] = last_arg('s16')
    elif c == 0xFE:
        cmd['name'] = 'alloctrack'; cmd['value'] = r.u16()
    elif c in NOARG:
        cmd['name'] = NOARG[c]
    elif c == 0xF0:
        e = r.u8()
        cmd['ext'] = e
        if e in EXT_VAR:
            cmd['name'] = EXT_VAR[e]; cmd['var'] = r.u8(); cmd['value'] = last_arg('s16')
        elif e == 0xE0:
            cmd['name'] = 'userproc'; cmd['value'] = last_arg('u16')
        else:
            raise ValueError(f'알 수 없는 확장 명령 F0 {e:02X} @0x{start:X}')
    else:
        raise ValueError(f'알 수 없는 명령 {c:02X} @0x{start:X}')
    if timemode == 0xA3:
        cmd['time'] = r.s16()
    elif timemode == 0xA4:
        cmd['time'] = ('random', r.s16(), r.s16())
    elif timemode == 0xA5:
        cmd['time'] = ('var', r.u8())
    cmd['end'] = r.pc
    return cmd


def var_name(v):
    if v < 16:
        return f'L{v}'
    if v < 32:
        return f'G{v - 16}'
    return f'T{v - 32}'


def fmt_cmd(c):
    def a(x):
        if isinstance(x, tuple):
            return f'rand({x[1]},{x[2]})' if x[0] == 'random' else var_name(x[1])
        return str(x)
    p = ''.join(f'[{x}]' for x in c['prefix'])
    n = c['name']
    if n == 'note':
        s = f'note {c["key"]} v{c["velocity"]} len {a(c["length"])}'
    elif n in ('jump', 'call'):
        s = f'{n} 0x{c["target"]:X}'
    elif n == 'opentrack':
        s = f'opentrack {c["track"]} 0x{c["target"]:X}'
    elif 'var' in c:
        s = f'{n} {var_name(c["var"])} {a(c["value"])}'
    elif 'value' in c:
        s = f'{n} {a(c["value"])}'
    else:
        s = n
    if 'time' in c:
        s += f' time {a(c["time"])}'
    return (p + ' ' + s).strip()


def disasm(data, start):
    """start 에서 도달 가능한 코드를 정적으로 훑는다(jump/call/opentrack 대상 포함)."""
    seen = {}
    todo = [start]
    while todo:
        pc = todo.pop()
        while pc not in seen and pc < len(data):
            c = decode_cmd(Reader(data, pc))
            seen[pc] = c
            n = c['name']
            if n in ('jump', 'call', 'opentrack'):
                todo.append(c['target'])
            if n in ('jump', 'fin', 'ret') and 'if' not in c['prefix']:
                break
            pc = c['end']
    return [seen[k] for k in sorted(seen)]


# ---------------------------------------------------------------- FBNK
def _region_chunk(b, p):
    """키/벨로시티 영역 묶음: 0x6000 direct, 0x6001 range, 0x6002 index, 0x6003 null.
    반환: [(상한, 대상 offset)] — 대상 offset 은 파일 기준."""
    t, o = ref(b, p)
    if o is None:
        return []
    q = p + o
    if t == 0x6000:
        rt, ro = ref(b, q)
        return [(127, q + ro if ro is not None else None)]
    if t == 0x6001:
        n = u32(b, q)
        keys = list(b[q + 4: q + 4 + n])
        rp = q + 4 + ((n + 3) & ~3)
        out = []
        for i in range(n):
            rt, ro = ref(b, rp + 8 * i)
            out.append((keys[i], q + ro if ro is not None else None))
        return out
    if t == 0x6002:
        lo, hi = b[q], b[q + 1]
        out = []
        for i in range(hi - lo + 1):
            rt, ro = ref(b, q + 4 + 8 * i)
            out.append((lo + i, q + ro if ro is not None else None))
        return out
    if t == 0x6003:
        return []
    raise ValueError(f'영역 묶음 형식 {t:#x}')


def _vel_region(b, p):
    """VelocityRegion: u32 waveIdIndex, u32 flags + 값들.
    비트: 0 originalKey, 1 volume, 2 pan(u8 pan, s8 surroundPan), 3 pitch(f32), 4 note param(isIgnoreNoteOff, keyGroup, interpolation),
    9 ADSHR 참조(이 구조 기준 offset → ref(?, off) → u8 A,D,S,H,R) [데이터: 표본에서 일관]"""
    wid = u32(b, p)
    flags = u32(b, p + 4)
    q = p + 8
    vals = {}
    for bit in range(32):
        if flags & (1 << bit):
            vals[bit] = q
            q += 4
    r = {'waveIdIndex': wid, 'flags': hex(flags), 'originalKey': 60, 'volume': 127, 'pan': 64,
         'surroundPan': 0, 'pitch': 1.0, 'ignoreNoteOff': 0, 'keyGroup': 0, 'interpolation': 0,
         'adshr': [127, 127, 127, 0, 127]}
    if 0 in vals:
        r['originalKey'] = b[vals[0]]
    if 1 in vals:
        r['volume'] = b[vals[1]]
    if 2 in vals:
        r['pan'] = b[vals[2]]
        sp = b[vals[2] + 1]
        r['surroundPan'] = sp - 256 if sp >= 128 else sp
    if 3 in vals:
        r['pitch'] = f32(b, vals[3])
    if 4 in vals:
        r['ignoreNoteOff'], r['keyGroup'], r['interpolation'] = b[vals[4]], b[vals[4] + 1], b[vals[4] + 2]
    if 9 in vals:
        off = u32(b, vals[9])
        rt, ro = ref(b, p + off)
        if ro is not None:
            a = p + off + ro
            r['adshr'] = list(b[a:a + 5])
    unk = [k for k in vals if k not in (0, 1, 2, 3, 4, 9)]
    if unk:
        r['unknownBits'] = {str(k): u32(b, vals[k]) for k in unk}
    return r


def parse_fbnk(b):
    assert b[:4] == b'FBNK'
    ver, blocks = file_blocks(b)
    ioff, _ = blocks[0x5800]
    base = ioff + 8
    wt, wo = ref(b, base)
    it, io = ref(b, base + 8)
    waves = []
    n = u32(b, base + wo)
    for i in range(n):
        waves.append((u32(b, base + wo + 4 + 8 * i), u32(b, base + wo + 8 + 8 * i)))
    insts = []
    tb = base + io
    n = u32(b, tb)
    for i in range(n):
        t, o = ref(b, tb + 4 + 8 * i)
        if o is None or t != 0x5900:
            insts.append(None)
            continue
        ip = tb + o
        keys = []
        for kmax, kp in _region_chunk(b, ip):
            if kp is None:
                continue
            vels = []
            for vmax, vp in _region_chunk(b, kp):
                if vp is None:
                    continue
                vels.append((vmax, _vel_region(b, vp)))
            keys.append((kmax, vels))
        insts.append(keys)
    return {'version': ver, 'waveIds': waves, 'instruments': insts}


# ---------------------------------------------------------------- FWAR / FWAV
def parse_fwar(b):
    assert b[:4] == b'FWAR'
    ver, blocks = file_blocks(b)
    ioff, _ = blocks[0x6800]
    foff, _ = blocks[0x6801]
    n = u32(b, ioff + 8)
    out = []
    for i in range(n):
        t, o, sz = sized_ref(b, ioff + 12 + 12 * i)
        out.append(b[foff + 8 + o: foff + 8 + o + sz])
    return out


ENCODINGS = {0: 'pcm8', 1: 'pcm16', 2: 'dsp_adpcm', 3: 'ima_adpcm'}


def parse_fwav(b):
    assert b[:4] == b'FWAV', b[:4]
    ver, blocks = file_blocks(b)
    ioff, _ = blocks[0x7000]
    doff, _ = blocks[0x7001]
    p = ioff + 8
    enc = b[p]
    loop = b[p + 1]
    rate = u32(b, p + 4)
    loop_start = u32(b, p + 8)
    nframes = u32(b, p + 12)
    orig_loop_start = u32(b, p + 16)
    tb = p + 20
    nch = u32(b, tb)
    chans = []
    for c in range(nch):
        t, o = ref(b, tb + 4 + 8 * c)
        cp = tb + o
        st, so = ref(b, cp)
        at, ao = ref(b, cp + 8)
        ch = {'data': doff + 8 + so}
        if ao is not None and enc == 2:
            q = cp + ao
            ch['coefs'] = list(struct.unpack_from('<16h', b, q))
            ch['ps'], ch['yn1'], ch['yn2'] = struct.unpack_from('<Hhh', b, q + 32)
        chans.append(ch)
    w = {'encoding': ENCODINGS.get(enc, enc), 'loop': bool(loop), 'sampleRate': rate, 'loopStart': loop_start,
         'frames': nframes, 'originalLoopStart': orig_loop_start, 'channels': []}
    for ch in chans:
        if enc == 2:
            w['channels'].append(dsp_decode(b, ch['data'], nframes, ch['coefs'], ch['yn1'], ch['yn2']))
        elif enc == 1:
            w['channels'].append(np.frombuffer(b, '<i2', nframes, ch['data']).astype(np.int16))
        elif enc == 0:
            w['channels'].append((np.frombuffer(b, 'i1', nframes, ch['data']).astype(np.int16) << 8))
        else:
            raise ValueError(f'인코딩 {enc} 미구현')
    return w


def dsp_decode(b, off, nsamples, coefs, yn1=0, yn2=0):
    """GC/Wii/Switch DSP-ADPCM: 8바이트 프레임 = 헤더(pred<<4|scale) + 14 니블."""
    out = np.empty(nsamples, np.int16)
    h1, h2 = yn1, yn2
    i = 0
    p = off
    while i < nsamples:
        ps = b[p]
        pred = (ps >> 4) & 7
        scale = 1 << (ps & 0xF)
        c1 = coefs[pred * 2]
        c2 = coefs[pred * 2 + 1]
        for k in range(14):
            if i >= nsamples:
                break
            byte = b[p + 1 + (k >> 1)]
            n = (byte >> 4) if (k & 1) == 0 else (byte & 0xF)
            if n >= 8:
                n -= 16
            s = ((n * scale) << 11) + 1024 + c1 * h1 + c2 * h2
            s >>= 11
            if s > 32767:
                s = 32767
            elif s < -32768:
                s = -32768
            out[i] = s
            h2 = h1
            h1 = s
            i += 1
        p += 8
    return out


# ---------------------------------------------------------------- 아카이브 묶음 (웨이브 조회)
class SoundSet:
    """FSAR 하나(및 필요하면 메인 프로젝트)에서 뱅크·웨이브를 찾아 주는 묶음."""

    def __init__(self, fsar: Fsar):
        self.fs = fsar
        self._banks = {}
        self._wars = {}
        self._waves = {}

    def bank(self, idx):
        if idx not in self._banks:
            info = self.fs.banks[idx]
            self._banks[idx] = parse_fbnk(self.fs.file_bytes(info['fileId']))
        return self._banks[idx]

    def war(self, idx):
        if idx not in self._wars:
            info = self.fs.wave_archives[idx]
            raw = self.fs.file_bytes(info['fileId'])
            if raw is None:
                raise FileNotFoundError(f'웨이브 아카이브 {idx} 파일 {info["fileId"]} 가 이 아카이브 안에 없다')
            self._wars[idx] = parse_fwar(raw)
        return self._wars[idx]

    def wave(self, war_item, index):
        key = (war_item, index)
        if key not in self._waves:
            t = war_item >> 24
            assert t == 5, item_str(war_item)
            self._waves[key] = parse_fwav(self.war(war_item & 0xFFFFFF)[index])
        return self._waves[key]


# ---------------------------------------------------------------- 렌더러 [추정]
OUT_RATE = 48000
FRAME_MS = 5  # nn::atk 시퀀스 갱신 주기 5 ms [판독 main FUN_71005cdd50: 프레임 예산 0x50000 = 5 ms × 65536]

# NW4R 계열 엔벌로프(0.1 dB 단위 값) [추정: 공개 지식 기반, 원본 대조 안 함]
_ATTACK_TABLE = [0, 1, 5, 14, 26, 38, 51, 63, 73, 84, 92, 100, 109, 116, 123, 127, 132, 137, 143]
VOLUME_INIT_DB10 = -904.0


def _decibel_square(v):
    if v <= 0:
        return -904.0
    return 10.0 * 20.0 * math.log10((v / 127.0) ** 2)


def _calc_attack(a):
    return (255 - a) / 256.0 if a < 109 else _ATTACK_TABLE[127 - a] / 256.0


def _calc_rate(r):
    if r >= 127:
        return 65535.0
    if r == 126:
        return 120.0 / 5.0
    if r < 50:
        return ((r << 1) + 1) / 128.0 / 5.0
    return 60.0 / (126 - r) / 5.0


class Env:
    def __init__(self, a, d, s, h, r):
        self.att = _calc_attack(a)
        self.dec = _calc_rate(d)
        self.sus = _decibel_square(s)
        self.hold = h
        self.rel = _calc_rate(r)
        self.value = VOLUME_INIT_DB10
        self.state = 'attack'
        self.hold_ms = 0

    def release(self, r=None):
        if r is not None:
            self.rel = _calc_rate(r)
        self.state = 'release'

    def step_ms(self, ms):
        """ms 동안 진행하고 그 구간 끝의 선형 진폭을 돌려준다."""
        for _ in range(ms):
            if self.state == 'attack':
                self.value *= self.att
                if self.value > -1.0 / 32.0:
                    self.value = 0.0
                    self.state = 'hold'
            elif self.state == 'hold':
                self.hold_ms += 1
                if self.hold_ms >= self.hold * 1:  # hold 단위 [미확정]
                    self.state = 'decay'
            elif self.state == 'decay':
                self.value -= self.dec
                if self.value <= self.sus:
                    self.value = self.sus
                    self.state = 'sustain'
            elif self.state == 'release':
                self.value -= self.rel
        if self.value <= VOLUME_INIT_DB10 + 1:
            return 0.0
        return 10.0 ** (self.value / 200.0)

    def dead(self):
        return self.state == 'release' and self.value <= -723


@dataclass
class Voice:
    track: int
    wave: dict
    pos: float
    step: float
    gain_l: float
    gain_r: float
    env: Env
    length: int  # 남은 틱, -1 = 무한
    amp: float = 0.0
    done: bool = False
    key: int = 0


@dataclass
class Track:
    no: int
    pc: int
    wait: int = 0
    stack: list = field(default_factory=list)  # (ret_pc, loop_count or None)
    vars: list = field(default_factory=lambda: [-1] * 16)
    open: bool = True
    note_wait: bool = True
    tie: bool = False
    volume: int = 127
    volume2: int = 127
    pan: int = 64
    init_pan: int = 0
    transpose: int = 0
    bend: int = 0
    bend_range: int = 2
    prg: int = 0
    bank: int = 0
    attack: int = 255
    decay: int = 255
    sustain: int = 255
    release: int = 255
    mute: int = 0
    cmp: bool = True


class SeqRenderer:
    """시퀀스 사운드 하나를 스테레오 float 로 렌더한다. 근사 재현이다([추정])."""

    def __init__(self, sset: SoundSet, sound: dict, global_vars=None, seed=1, frame_ms=FRAME_MS,
                 local_vars=None, random_mode='rng'):
        self.sset = sset
        self.sound = sound
        fseq = parse_fseq(sset.fs.file_bytes(sound['fileId']))
        self.data = fseq['data']
        self.labels = fseq['labels']
        self.banks = [int(x.split(':')[1]) for x in sound['sequence']['banks']]
        self.tempo = 120  # 기본 tempo 120·timebase 48 [판독 main FUN_71005cb794: +0x120 = 0x783040]
        self.timebase = 48
        self.main_volume = 127
        self.local = [-1] * 16  # 지역·전역 변수 기본 −1 [판독 main FUN_71005cb794·FUN_71005cb744]
        for k, v in (local_vars or {}).items():
            self.local[int(k)] = v
        self.random_mode = random_mode  # 'rng' | 'mid' | 'min' | 'max'
        self.glob = global_vars if global_vars is not None else [-1] * 16
        self.tracks = {0: Track(0, sound['sequence']['startOffset'])}
        self.voices: list[Voice] = []
        self.tick = 0
        self.time_ms = 0
        self.events = []
        self.rng = np.random.default_rng(seed)
        self.frame_ms = frame_ms
        self.loops = {}  # track → (jump tick, target pc)
        self.pc_tick = {}  # (track, pc) → 처음 실행 틱
        self.finished = False
        self.missing = []

    # ---- 변수
    def getvar(self, t: Track, v):
        if v < 16:
            return self.local[v]
        if v < 32:
            return self.glob[v - 16]
        return t.vars[v - 32]

    def setvar(self, t: Track, v, val):
        val = max(-32768, min(32767, int(val)))
        if v < 16:
            self.local[v] = val
        elif v < 32:
            self.glob[v - 16] = val
            self.events.append({'t': self.time_ms / 1000.0, 'tick': self.tick, 'track': t.no,
                                'global': v - 16, 'value': val})
        else:
            t.vars[v - 32] = val

    def argval(self, t, x):
        if isinstance(x, tuple):
            if x[0] == 'random':
                if self.random_mode == 'mid':
                    return (x[1] + x[2]) // 2
                if self.random_mode == 'min':
                    return x[1]
                if self.random_mode == 'max':
                    return x[2]
                return int(self.rng.integers(x[1], x[2] + 1))
            return self.getvar(t, x[1])
        return x

    # ---- 노트
    def note_on(self, t: Track, key, vel, length):
        k = max(0, min(127, key + t.transpose))
        bank_i = self.banks[t.bank] if t.bank < len(self.banks) else None
        if bank_i is None:
            return
        bank = self.sset.bank(bank_i)
        if t.prg >= len(bank['instruments']) or bank['instruments'][t.prg] is None:
            self.missing.append(('prg', t.prg))
            return
        region = None
        for kmax, vels in bank['instruments'][t.prg]:
            if k <= kmax:
                for vmax, vr in vels:
                    if vel <= vmax:
                        region = vr
                        break
                break
        if region is None:
            return
        war_item, widx = bank['waveIds'][region['waveIdIndex']]
        try:
            wav = self.sset.wave(war_item, widx)
        except FileNotFoundError as e:
            self.missing.append(str(e))
            return
        semis = (k - region['originalKey']) + t.bend * t.bend_range / 127.0
        step = wav['sampleRate'] / OUT_RATE * (2.0 ** (semis / 12.0)) * region['pitch']
        vol = (vel / 127.0) ** 2 * (region['volume'] / 127.0) ** 2 * (t.volume / 127.0) ** 2 * (t.volume2 / 127.0) ** 2
        pan = (t.pan - 64) / 63.0 + (region['pan'] - 64) / 63.0 + t.init_pan / 63.0
        pan = max(-1.0, min(1.0, pan))
        gl = math.sqrt(min(1.0, 1.0 - pan))
        gr = math.sqrt(min(1.0, 1.0 + pan))
        a, d, s, h, r = region['adshr']
        env = Env(t.attack if t.attack != 255 else a, t.decay if t.decay != 255 else d,
                  t.sustain if t.sustain != 255 else s, h, t.release if t.release != 255 else r)
        self.voices.append(Voice(t.no, wav, 0.0, step, gl * vol, gr * vol, env, length if length > 0 else -1, key=k))
        self.events.append({'t': self.time_ms / 1000.0, 'tick': self.tick, 'track': t.no, 'note': k,
                            'vel': vel, 'len': length, 'prg': t.prg, 'wave': [item_str(war_item), widx]})

    # ---- 틱 하나
    def run_track(self, t: Track):
        if t.wait > 0:
            t.wait -= 1
            if t.wait > 0:
                return
        guard = 0
        while t.wait == 0 and t.open:
            guard += 1
            if guard > 10000:
                raise RuntimeError('무한 루프')
            self.pc_tick.setdefault((t.no, t.pc), self.tick)
            c = decode_cmd(Reader(self.data, t.pc))
            t.pc = c['end']
            if 'if' in c['prefix'] and not t.cmp:
                continue
            n = c['name']
            if n == 'note':
                ln = self.argval(t, c['length'])
                if not t.mute:
                    self.note_on(t, c['key'], c['velocity'], ln)
                if t.note_wait:
                    t.wait = ln
            elif n == 'wait':
                t.wait = self.argval(t, c['value'])
            elif n == 'prg':
                v = self.argval(t, c['value'])
                t.prg = v & 0xFFFF
            elif n == 'opentrack':
                if c['track'] not in self.tracks or not self.tracks[c['track']].open:
                    self.tracks[c['track']] = Track(c['track'], c['target'])
            elif n == 'jump':
                if c['target'] < c['pc'] and t.no not in self.loops:
                    self.loops[t.no] = (self.tick, c['target'])
                    self.events.append({'t': self.time_ms / 1000.0, 'tick': self.tick, 'track': t.no,
                                        'loopJump': c['target']})
                t.pc = c['target']
            elif n == 'call':
                t.stack.append((t.pc, None))
                t.pc = c['target']
            elif n == 'ret':
                if t.stack:
                    t.pc = t.stack.pop()[0]
            elif n == 'loop_start':
                t.stack.append((t.pc, self.argval(t, c['value'])))
            elif n == 'loop_end':
                if t.stack:
                    pc, cnt = t.stack[-1]
                    if cnt == 0:
                        t.pc = pc  # 무한
                    elif cnt is not None and cnt > 1:
                        t.stack[-1] = (pc, cnt - 1)
                        t.pc = pc
                    else:
                        t.stack.pop()
            elif n == 'fin':
                t.open = False
            elif n == 'alloctrack':
                pass
            elif n == 'tempo':
                self.tempo = self.argval(t, c['value'])
                self.events.append({'t': self.time_ms / 1000.0, 'tick': self.tick, 'track': t.no, 'tempo': self.tempo})
            elif n == 'timebase':
                self.timebase = self.argval(t, c['value'])
                self.events.append({'t': self.time_ms / 1000.0, 'tick': self.tick, 'track': t.no, 'timebase': self.timebase})
            elif n == 'main_volume':
                self.main_volume = self.argval(t, c['value'])
            elif n in ('volume', 'volume2', 'pan', 'transpose', 'bend_range', 'attack', 'decay', 'sustain',
                       'release', 'mute', 'init_pan'):
                setattr(t, n, self.argval(t, c['value']))
            elif n == 'pitch_bend':
                t.bend = self.argval(t, c['value'])
            elif n == 'note_wait':
                t.note_wait = bool(self.argval(t, c['value']))
            elif n == 'tie':
                t.tie = bool(self.argval(t, c['value']))
            elif n == 'bank_select':
                t.bank = self.argval(t, c['value'])
            elif n == 'env_reset':
                t.attack = t.decay = t.sustain = t.release = 255
            elif n in EXT_VAR.values():
                v = c['var']
                val = self.argval(t, c['value'])
                cur = self.getvar(t, v)
                if n == 'setvar':
                    self.setvar(t, v, val)
                elif n == 'addvar':
                    self.setvar(t, v, cur + val)
                elif n == 'subvar':
                    self.setvar(t, v, cur - val)
                elif n == 'mulvar':
                    self.setvar(t, v, cur * val)
                elif n == 'divvar':
                    if val:
                        self.setvar(t, v, int(cur / val))
                elif n == 'modvar':
                    if val:
                        self.setvar(t, v, int(math.fmod(cur, val)))
                elif n == 'shiftvar':
                    self.setvar(t, v, cur << val if val >= 0 else cur >> -val)
                elif n == 'randvar':
                    self.setvar(t, v, int(self.rng.integers(0, val + 1)) if val >= 0 else -int(self.rng.integers(0, -val + 1)))
                elif n == 'andvar':
                    self.setvar(t, v, cur & val)
                elif n == 'orvar':
                    self.setvar(t, v, cur | val)
                elif n == 'xorvar':
                    self.setvar(t, v, cur ^ val)
                elif n == 'notvar':
                    self.setvar(t, v, ~val)
                elif n == 'cmp_eq':
                    t.cmp = cur == val
                elif n == 'cmp_ge':
                    t.cmp = cur >= val
                elif n == 'cmp_gt':
                    t.cmp = cur > val
                elif n == 'cmp_le':
                    t.cmp = cur <= val
                elif n == 'cmp_lt':
                    t.cmp = cur < val
                elif n == 'cmp_ne':
                    t.cmp = cur != val
            elif n == 'userproc':
                self.events.append({'t': self.time_ms / 1000.0, 'tick': self.tick, 'track': t.no,
                                    'userproc': self.argval(t, c['value'])})
            # 그 밖(LFO·필터·센드·우선순위 등)은 렌더에 반영하지 않는다

    def do_tick(self):
        for v in self.voices:
            if v.length > 0:
                v.length -= 1
                if v.length == 0 and v.env.state != 'release':
                    v.env.release()
        for no in range(16):  # 같은 틱에 새로 연 트랙도 번호 순서대로 돈다 [판독 main FUN_71005cdef0: 트랙 배열 0..15 순서로 ParseNextTick]
            t = self.tracks.get(no)
            if t is not None and t.open:
                self.run_track(t)
        self.tick += 1

    def render(self, max_sec=60.0, stop_at_loop=False, extra_after_loop_ticks=None):
        frame_samples = OUT_RATE * self.frame_ms // 1000
        out = []
        # 5 ms 프레임마다 틱 길이만큼 누적해 넘친 틱을 처리한다 [판독 main FUN_71005cdd50: 예산 = 프레임 수 × 0x50000(5 ms·65536)].
        # 첫 틱 위상: 생성자 초기값대로 읽으면 틱 k 가 한 프레임 늦어야 하지만, 그렇게 렌더하면 원본 녹음 SM_BGM_MG1801_DH 와 238샘플 어긋난다.
        # 아래(틱 0 을 첫 프레임에서 바로 처리) 쪽이 녹음과 2샘플로 맞아 이것을 쓴다 [실행: 자체 렌더 vs 원본 녹음]
        frac = 1.0
        max_frames = int(max_sec * 1000 / self.frame_ms)
        stop_tick = None
        for _ in range(max_frames):
            frac += self.tempo * self.timebase * self.frame_ms / 60000.0
            while frac >= 1.0:
                frac -= 1.0
                if stop_tick is not None and self.tick >= stop_tick:
                    break
                self.do_tick()
            if stop_at_loop and stop_tick is None and self.loops and \
                    all((not tr.open) or tr.no in self.loops for tr in self.tracks.values()):
                stop_tick = self.tick + (extra_after_loop_ticks or 0)
            buf = np.zeros((frame_samples, 2), np.float32)
            alive = []
            for v in self.voices:
                amp0 = v.amp
                amp1 = v.env.step_ms(self.frame_ms)
                v.amp = amp1
                w = v.wave
                n = w['frames']
                idx = v.pos + v.step * np.arange(frame_samples)
                if w['loop']:
                    ls, le = w['loopStart'], n
                    over = idx >= le
                    if over.any():
                        idx = np.where(over, ls + np.mod(idx - ls, le - ls), idx)
                    valid = np.ones(frame_samples, bool)
                else:
                    valid = idx < n - 1
                i0 = np.clip(idx.astype(np.int64), 0, n - 1)
                i1 = np.clip(i0 + 1, 0, n - 1)
                fr = (idx - np.floor(idx)).astype(np.float32)
                ramp = np.linspace(amp0, amp1, frame_samples, endpoint=False, dtype=np.float32)
                chs = w['channels']
                sl = (chs[0][i0] * (1 - fr) + chs[0][i1] * fr) / 32768.0
                sr = sl if len(chs) == 1 else (chs[1][i0] * (1 - fr) + chs[1][i1] * fr) / 32768.0
                sl = np.where(valid, sl, 0) * ramp
                sr = np.where(valid, sr, 0) * ramp
                buf[:, 0] += sl * v.gain_l
                buf[:, 1] += sr * v.gain_r
                v.pos = float(v.pos + v.step * frame_samples)
                if w['loop'] and v.pos >= n:
                    v.pos = w['loopStart'] + math.fmod(v.pos - w['loopStart'], n - w['loopStart'])
                if (not w['loop'] and v.pos >= n - 1) or v.env.dead():
                    continue
                alive.append(v)
            self.voices = alive
            seqvol = (self.main_volume / 127.0) ** 2
            out.append(buf * seqvol)
            self.time_ms += self.frame_ms
            all_closed = all(not t.open for t in self.tracks.values())
            if all_closed and not self.voices:
                self.finished = True
                break
            if stop_tick is not None and self.tick >= stop_tick and not self.voices:
                break
            if stop_tick is not None and self.tick >= stop_tick:
                break
        audio = np.concatenate(out) if out else np.zeros((0, 2), np.float32)
        return audio * (self.sound['volume'] / 127.0)


def write_wav(path, audio, rate=OUT_RATE):
    a = np.clip(audio, -1.0, 1.0)
    pcm = (a * 32767.0).astype('<i2')
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(pcm.shape[1] if pcm.ndim == 2 else 1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def main(argv):
    if len(argv) >= 3 and argv[0] == 'disasm':
        fs = Fsar(argv[1])
        s = fs.find(argv[2])
        fseq = parse_fseq(fs.file_bytes(s['fileId']))
        inv = {v: k for k, v in fseq['labels'].items()}
        for c in disasm(fseq['data'], s['sequence']['startOffset']):
            lab = f'  <{inv[c["pc"]]}>' if c['pc'] in inv else ''
            print(f'{c["pc"]:05X}: {fmt_cmd(c)}{lab}')
    elif len(argv) >= 3 and argv[0] == 'bank':
        fs = Fsar(argv[1])
        idx = int(argv[2]) if argv[2].isdigit() else next(b['index'] for b in fs.banks if b['name'] == argv[2])
        bk = parse_fbnk(fs.file_bytes(fs.banks[idx]['fileId']))
        print('waveIds', [(item_str(a), b) for a, b in bk['waveIds']])
        for i, inst in enumerate(bk['instruments']):
            print('prg', i)
            for kmax, vels in inst or []:
                for vmax, r in vels:
                    print(f'  key<={kmax} vel<={vmax}', r)
    elif len(argv) >= 4 and argv[0] == 'render':
        fs = Fsar(argv[1])
        s = fs.find(argv[2])
        sec = float(argv[4]) if len(argv) > 4 else 30.0
        r = SeqRenderer(SoundSet(fs), s)
        audio = r.render(sec)
        write_wav(argv[3], audio)
        Path(argv[3]).with_suffix('.json').write_text(json.dumps(
            {'events': r.events, 'loops': r.loops, 'missing': r.missing, 'sec': len(audio) / OUT_RATE},
            ensure_ascii=False, indent=1), encoding='utf-8')
        print(argv[3], len(audio) / OUT_RATE, 'peak', float(np.abs(audio).max()) if len(audio) else 0)
    else:
        print(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
