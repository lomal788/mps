/**
 * nn::atk 시퀀스 사운드(FSEQ) 실시간 재생 — web/tools/analysis/sound_seq.py SeqRenderer 의 TS 판(같은 명령 해석·같은 엔벌로프·같은 볼륨 식).
 * 효과음처럼 변수·무작위·재생 중 지역 변수 변경이 소리를 바꾸는 시퀀스와, 전역 변수로 서로 맞물리는 리듬 마스터(SQ_BGM_RC_MAIN_RHYTHM)·OP 를
 * 원본처럼 돌리려고 쓴다(docs/engine/04_sound.md 4.2·5.3·6.4~6.6).
 *
 * 원본에서 확인한 것 [판독 main]:
 *   - 갱신 주기 5 ms. 프레임마다 tempo × timebase / 60000 틱을 누적하고 넘친 틱을 그 프레임에 처리한다(FUN_71005cdd50, 예산 0x50000 = 5 ms·65536)
 *   - 한 틱 안에서 트랙 0..15 순서(FUN_71005cdef0). 기본 tempo 120·timebase 48, 지역·전역 변수 기본 −1(FUN_71005cb794·FUN_71005cb744)
 *   - tempo 명령은 0..1023 로 자른다(FUN_71005c9c80 case 0xE1)
 *   - 첫 틱 위상은 원본 녹음과 2샘플로 맞는 렌더러 쪽(틱 0 을 첫 프레임에서 처리)을 따른다 [실행: 자체 렌더 vs 원본 녹음]
 * 근사(렌더러와 같다):
 *   - 엔벌로프·볼륨 곡선·팬 곡선은 NW4R 계열 공개 지식 재구현이다. 원본 출력과 대조한 것은 BGM 녹음 하나뿐이다
 *   - 파형 보간은 브라우저 재생 속도 변환이 한다(렌더러는 선형 보간)
 *   - 무작위(random 접두·randvar)는 Math.random. 원본 엔진 난수 순서는 [미확정]
 *   - LFO·lpf_cutoff·biquad·fxsend(리버브)·sweep_pitch·porta·time 접두(볼륨 램프)는 반영하지 않는다
 * 렌더러와 다르게 한 것: 트랙 volume·volume2 와 main_volume 을 재생 중인 음에도 바로 반영한다(원본 채널 갱신처럼). 렌더러는 노트 시작 값을 고정한다.
 * 실시간 처리: 4 ms 타이머로 지금 + LOOKAHEAD 까지의 프레임을 처리한다. 게임이 쓴 지역 변수는 최대 LOOKAHEAD 늦게 보인다(원본은 다음 5 ms 프레임).
 * 여러 소리는 프레임 시각 순서로 번갈아 처리한다(SeqEngine.advanceAll) — 시퀀스 사이 전역 변수 주고받기가 시각 순서대로 일어난다.
 */
import type { AudioOut, Bus } from './audio';

export interface SeqVelRegion {
  velMax: number;
  wave: number;
  originalKey: number;
  volume: number;
  pan: number;
  pitch: number;
  adshr: number[];
}
export interface SeqKeyRegion {
  keyMax: number;
  vels: SeqVelRegion[];
}
export interface SeqWave {
  file: string;
  rate: number;
  frames: number;
  loop: boolean;
  loopStart: number;
  channels: number;
}
/** tools/mg1801_web_assets.py export_seq 가 만든다 */
export interface SeqData {
  /** 사운드 정보 volume(u8) */
  volume: number;
  /** FSEQ DATA 블록(base64) */
  data: string;
  /** 사운드 정보 startOffset(DATA 기준) */
  start: number;
  banks: ({ instruments: (SeqKeyRegion[] | null)[] } | null)[];
  waves: SeqWave[];
}

/** 전역 변수(G0..G15) — time 은 그 틱이 처리되는 AudioContext 시각(프레임 시작) */
export interface SeqGlobals {
  get(i: number, time: number): number;
  set(i: number, v: number, time: number): void;
}

const FRAME_SEC = 0.005;
const LOOKAHEAD = 0.015;
const PUMP_MS = 4;

// ---------------------------------------------------------------- 명령 해석 (sound_seq.py decode_cmd)
type Arg = number | { rnd: [number, number] } | { v: number };
interface Cmd {
  name: string;
  end: number;
  pc: number;
  ifp: boolean;
  key?: number;
  velocity?: number;
  length?: Arg;
  value?: Arg;
  track?: number;
  target?: number;
  v?: number;
}
const EXT_VAR: Record<number, string> = {
  0x80: 'setvar', 0x81: 'addvar', 0x82: 'subvar', 0x83: 'mulvar', 0x84: 'divvar', 0x85: 'shiftvar', 0x86: 'randvar', 0x87: 'andvar',
  0x88: 'orvar', 0x89: 'xorvar', 0x8a: 'notvar', 0x8b: 'modvar', 0x90: 'cmp_eq', 0x91: 'cmp_ge', 0x92: 'cmp_gt', 0x93: 'cmp_le', 0x94: 'cmp_lt', 0x95: 'cmp_ne',
};
const U8_CMDS: Record<number, string> = {
  0xb0: 'timebase', 0xb1: 'env_hold', 0xb2: 'monophonic', 0xb3: 'velocity_range', 0xb4: 'biquad_type', 0xb5: 'biquad_value', 0xb6: 'bank_select',
  0xbd: 'mod_phase', 0xbe: 'mod_curve', 0xbf: 'front_bypass', 0xc0: 'pan', 0xc1: 'volume', 0xc2: 'main_volume', 0xc3: 'transpose', 0xc4: 'pitch_bend',
  0xc5: 'bend_range', 0xc6: 'prio', 0xc7: 'note_wait', 0xc8: 'tie', 0xc9: 'porta', 0xca: 'mod_depth', 0xcb: 'mod_speed', 0xcc: 'mod_type', 0xcd: 'mod_range',
  0xce: 'porta_sw', 0xcf: 'porta_time', 0xd0: 'attack', 0xd1: 'decay', 0xd2: 'sustain', 0xd3: 'release', 0xd4: 'loop_start', 0xd5: 'volume2',
  0xd6: 'printvar', 0xd7: 'surround_pan', 0xd8: 'lpf_cutoff', 0xd9: 'fxsend_a', 0xda: 'fxsend_b', 0xdb: 'mainsend', 0xdc: 'init_pan', 0xdd: 'mute',
  0xde: 'fxsend_c', 0xdf: 'damper',
};
const S8_CMDS = new Set([0xc3, 0xc4, 0xd7, 0xd8]);
const S16_CMDS: Record<number, string> = { 0xe0: 'mod_delay', 0xe1: 'tempo', 0xe2: 'mod_period', 0xe3: 'sweep_pitch' };
const NOARG: Record<number, string> = { 0xfb: 'env_reset', 0xfc: 'loop_end', 0xfd: 'ret', 0xff: 'fin' };

function decode(d: Uint8Array, start: number): Cmd {
  let pc = start;
  const u8 = (): number => d[pc++];
  const s8 = (): number => {
    const v = u8();
    return v >= 128 ? v - 256 : v;
  };
  const u16 = (): number => {
    const v = d[pc] | (d[pc + 1] << 8);
    pc += 2;
    return v;
  };
  const s16 = (): number => {
    const v = u16();
    return v >= 32768 ? v - 65536 : v;
  };
  const u24 = (): number => {
    const v = d[pc] | (d[pc + 1] << 8) | (d[pc + 2] << 16);
    pc += 3;
    return v;
  };
  const vlen = (): number => {
    let v = 0;
    for (;;) {
      const c = u8();
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
  };
  let argmode: 'random' | 'variable' | null = null;
  let timemode = 0;
  let ifp = false;
  let c: number;
  for (;;) {
    c = u8();
    if (c === 0xa0) argmode = 'random';
    else if (c === 0xa1) argmode = 'variable';
    else if (c === 0xa2) ifp = true;
    else if (c === 0xa3 || c === 0xa4 || c === 0xa5) timemode = c;
    else break;
  }
  const last = (kind: () => number): Arg => {
    if (argmode === 'random') return { rnd: [s16(), s16()] };
    if (argmode === 'variable') return { v: u8() };
    return kind();
  };
  const cmd: Cmd = { name: '', end: 0, pc: start, ifp };
  if (c < 0x80) {
    cmd.name = 'note';
    cmd.key = c;
    cmd.velocity = u8();
    cmd.length = last(vlen);
  } else if (c === 0x80) {
    cmd.name = 'wait';
    cmd.value = last(vlen);
  } else if (c === 0x81) {
    cmd.name = 'prg';
    cmd.value = last(vlen);
  } else if (c === 0x88) {
    cmd.name = 'opentrack';
    cmd.track = u8();
    cmd.target = u24();
  } else if (c === 0x89 || c === 0x8a) {
    cmd.name = c === 0x89 ? 'jump' : 'call';
    cmd.target = u24();
  } else if (c in U8_CMDS) {
    cmd.name = U8_CMDS[c];
    cmd.value = last(S8_CMDS.has(c) ? s8 : u8);
  } else if (c in S16_CMDS) {
    cmd.name = S16_CMDS[c];
    cmd.value = last(s16);
  } else if (c === 0xfe) {
    cmd.name = 'alloctrack';
    cmd.value = u16();
  } else if (c in NOARG) {
    cmd.name = NOARG[c];
  } else if (c === 0xf0) {
    const e = u8();
    if (e in EXT_VAR) {
      cmd.name = EXT_VAR[e];
      cmd.v = u8();
      cmd.value = last(s16);
    } else if (e === 0xe0) {
      cmd.name = 'userproc';
      cmd.value = last(u16);
    } else throw new Error(`알 수 없는 확장 명령 F0 ${e.toString(16)} @${start}`);
  } else throw new Error(`알 수 없는 명령 ${c.toString(16)} @${start}`);
  if (timemode === 0xa3) s16();
  else if (timemode === 0xa4) {
    s16();
    s16();
  } else if (timemode === 0xa5) u8();
  cmd.end = pc;
  return cmd;
}

// ---------------------------------------------------------------- 엔벌로프 (sound_seq.py Env, 0.1 dB 단위) [추정: NW4R 계열 공개 지식]
const ATTACK_TABLE = [0, 1, 5, 14, 26, 38, 51, 63, 73, 84, 92, 100, 109, 116, 123, 127, 132, 137, 143];
const VOLUME_INIT_DB10 = -904;
const decibelSquare = (v: number): number => (v <= 0 ? -904 : 10 * 20 * Math.log10((v / 127) ** 2));
const calcAttack = (a: number): number => (a < 109 ? (255 - a) / 256 : ATTACK_TABLE[127 - a] / 256);
const calcRate = (r: number): number => (r >= 127 ? 65535 : r === 126 ? 120 / 5 : r < 50 ? ((r << 1) + 1) / 128 / 5 : 60 / (126 - r) / 5);

class Env {
  private readonly att: number;
  private readonly dec: number;
  private readonly sus: number;
  private rel: number;
  private value = VOLUME_INIT_DB10;
  state: 'attack' | 'hold' | 'decay' | 'sustain' | 'release' = 'attack';
  private holdMs = 0;

  constructor(
    a: number,
    d: number,
    s: number,
    private readonly hold: number,
    r: number,
  ) {
    this.att = calcAttack(a);
    this.dec = calcRate(d);
    this.sus = decibelSquare(s);
    this.rel = calcRate(r);
  }

  release(): void {
    this.state = 'release';
  }

  /** ms 동안 진행하고 끝의 선형 진폭 */
  stepMs(ms: number): number {
    for (let i = 0; i < ms; i++) {
      switch (this.state) {
        case 'attack':
          this.value *= this.att;
          if (this.value > -1 / 32) {
            this.value = 0;
            this.state = 'hold';
          }
          break;
        case 'hold':
          this.holdMs++;
          if (this.holdMs >= this.hold) this.state = 'decay';
          break;
        case 'decay':
          this.value -= this.dec;
          if (this.value <= this.sus) {
            this.value = this.sus;
            this.state = 'sustain';
          }
          break;
        case 'release':
          this.value -= this.rel;
          break;
        default:
          break;
      }
    }
    return this.value <= VOLUME_INIT_DB10 + 1 ? 0 : 10 ** (this.value / 200);
  }

  dead(): boolean {
    return this.state === 'release' && this.value <= -723;
  }
}

// ---------------------------------------------------------------- 트랙·음
class Track {
  wait = 0;
  readonly stack: { pc: number; count: number | null }[] = [];
  readonly vars = new Array<number>(16).fill(-1);
  open = true;
  noteWait = true;
  volume = 127;
  volume2 = 127;
  pan = 64;
  initPan = 0;
  transpose = 0;
  bend = 0;
  bendRange = 2;
  prg = 0;
  bank = 0;
  attack = 255;
  decay = 255;
  sustain = 255;
  release = 255;
  mute = 0;
  cmp = true;
  /** 트랙 볼륨(volume²·volume2²) — 재생 중인 음에도 걸린다 */
  readonly gain: GainNode;

  constructor(
    readonly no: number,
    public pc: number,
    ctx: BaseAudioContext,
    dest: AudioNode,
    time: number,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(1, time);
    this.gain.connect(dest);
  }

  applyGain(time: number): void {
    this.gain.gain.setValueAtTime((this.volume / 127) ** 2 * (this.volume2 / 127) ** 2, time);
  }
}

interface Voice {
  track: Track;
  src: AudioBufferSourceNode;
  env: Env;
  gain: GainNode;
  length: number;
  amp: number;
  /** 파형이 끝나는 AudioContext 시각(반복 파형은 Infinity) */
  endTime: number;
}

/** 시퀀스 사운드 하나(원본 SoundHandle 하나) */
export class SeqSound {
  /** 지역 변수 L0..L15 (SoundHandle::WriteLocalVariable) */
  readonly local = new Array<number>(16).fill(-1);
  private readonly d: Uint8Array;
  private readonly tracks: (Track | undefined)[] = [];
  private voices: Voice[] = [];
  private tempo = 120;
  private timebase = 48;
  private mainVolume = 127;
  private frac = 1.0;
  private frame = 0;
  private tick = 0;
  /** 지금 처리 중인 틱의 시각(전역 쓰기에 붙인다) */
  private tickTime = 0;
  private readonly out: GainNode;
  private vol: number;
  private readonly baseVol: number;
  finished = false;
  private stopped = false;

  /**
   * gain: 시퀀스 밖에서 곱하는 배율(3D 볼륨 등). pan: 음마다 더하는 팬(3D 팬, −1..1)
   */
  constructor(
    private readonly audio: AudioOut,
    private readonly data: SeqData,
    bytes: Uint8Array,
    private readonly buffers: (AudioBuffer | undefined)[],
    private readonly globals: SeqGlobals,
    bus: Bus,
    readonly t0: number,
    opts: { gain?: number; pan?: number; local?: Record<number, number>; onNote?: (key: number, time: number, start: number) => void } = {},
  ) {
    this.d = bytes;
    this.onNote = opts.onNote ?? null;
    const ctx = audio.ctx;
    this.out = ctx.createGain();
    this.baseVol = data.volume / 127;
    this.vol = this.baseVol * (opts.gain ?? 1);
    this.extraPan = opts.pan ?? 0;
    this.out.gain.setValueAtTime(this.vol, t0);
    this.out.connect(audio.busNode(bus));
    for (const [k, v] of Object.entries(opts.local ?? {})) this.local[Number(k)] = v;
    this.tracks[0] = new Track(0, data.start, ctx, this.out, t0);
  }

  private extraPan: number;

  /** 재생 중 3D 볼륨·팬을 바꾼다(Play3DHookPosition 처럼 위치를 따라가는 소리). 팬은 다음 음부터 */
  setOuter(gain: number, pan: number): void {
    this.vol = this.baseVol * gain;
    this.extraPan = pan;
    this.out.gain.setTargetAtTime(this.vol * (this.mainVolume / 127) ** 2, this.audio.ctx.currentTime, 0.01);
  }
  /** 시험 기록(?synclog=1): 음 시작 — 틱 시각과 실제 start 시각(늦게 처리하면 뒤로 밀린다) */
  private readonly onNote: ((key: number, time: number, start: number) => void) | null;

  private getvar(t: Track, v: number, time: number): number {
    if (v < 16) return this.local[v];
    if (v < 32) return this.globals.get(v - 16, time);
    return t.vars[v - 32];
  }

  private setvar(t: Track, v: number, val: number): void {
    const x = Math.max(-32768, Math.min(32767, Math.trunc(val)));
    if (v < 16) this.local[v] = x;
    else if (v < 32) this.globals.set(v - 16, x, this.tickTime);
    else t.vars[v - 32] = x;
  }

  private argval(t: Track, x: Arg | undefined, time: number): number {
    if (x === undefined) return 0;
    if (typeof x === 'number') return x;
    if ('rnd' in x) return x.rnd[0] + Math.floor(Math.random() * (x.rnd[1] - x.rnd[0] + 1));
    return this.getvar(t, x.v, time);
  }

  private noteOn(t: Track, key: number, vel: number, length: number, time: number): void {
    const k = Math.max(0, Math.min(127, key + t.transpose));
    const bank = this.data.banks[t.bank];
    const inst = bank?.instruments[t.prg];
    if (!inst) return;
    const kr = inst.find((r) => k <= r.keyMax);
    const region = kr?.vels.find((r) => vel <= r.velMax);
    if (!region) return;
    const buf = this.buffers[region.wave];
    const w = this.data.waves[region.wave];
    if (!buf || !w) return;
    const ctx = this.audio.ctx;
    const semis = k - region.originalKey + (t.bend * t.bendRange) / 127;
    const rate = 2 ** (semis / 12) * region.pitch;
    const vol = (vel / 127) ** 2 * (region.volume / 127) ** 2;
    const p = Math.max(-1, Math.min(1, (t.pan - 64) / 63 + (region.pan - 64) / 63 + t.initPan / 63 + this.extraPan));
    const gl = Math.sqrt(Math.min(1, 1 - p)) * vol;
    const gr = Math.sqrt(Math.min(1, 1 + p)) * vol;
    const [a, d, s, h, r] = region.adshr;
    const env = new Env(t.attack !== 255 ? t.attack : a, t.decay !== 255 ? t.decay : d, t.sustain !== 255 ? t.sustain : s, h, t.release !== 255 ? t.release : r);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    if (w.loop) {
      src.loop = true;
      src.loopStart = w.loopStart / w.rate;
      src.loopEnd = w.frames / w.rate;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    src.connect(g);
    const merge = ctx.createChannelMerger(2);
    const lg = ctx.createGain();
    const rg = ctx.createGain();
    lg.gain.value = gl;
    rg.gain.value = gr;
    if (buf.numberOfChannels >= 2) {
      const split = ctx.createChannelSplitter(2);
      g.connect(split);
      split.connect(lg, 0);
      split.connect(rg, 1);
    } else {
      g.connect(lg);
      g.connect(rg);
    }
    lg.connect(merge, 0, 0);
    rg.connect(merge, 0, 1);
    merge.connect(t.gain);
    this.audio.track(src);
    src.start(Math.max(time, ctx.currentTime));
    this.onNote?.(k, time, Math.max(time, ctx.currentTime));
    const endTime = w.loop ? Infinity : time + (w.frames - 1) / w.rate / rate;
    this.voices.push({ track: t, src, env, gain: g, length: length > 0 ? length : -1, amp: 0, endTime });
  }

  private runTrack(t: Track, time: number): void {
    if (t.wait > 0) {
      t.wait--;
      if (t.wait > 0) return;
    }
    let guard = 0;
    while (t.wait === 0 && t.open) {
      if (++guard > 10000) throw new Error('시퀀스 무한 루프');
      const c = decode(this.d, t.pc);
      t.pc = c.end;
      if (c.ifp && !t.cmp) continue;
      const val = (): number => this.argval(t, c.value, time);
      switch (c.name) {
        case 'note': {
          const ln = this.argval(t, c.length, time);
          if (!t.mute) this.noteOn(t, c.key!, c.velocity!, ln, time);
          if (t.noteWait) t.wait = ln;
          break;
        }
        case 'wait':
          t.wait = val();
          break;
        case 'prg':
          t.prg = val() & 0xffff;
          break;
        case 'opentrack': {
          const old = this.tracks[c.track!];
          if (!old || !old.open) this.tracks[c.track!] = new Track(c.track!, c.target!, this.audio.ctx, this.out, time);
          break;
        }
        case 'jump':
          t.pc = c.target!;
          break;
        case 'call':
          t.stack.push({ pc: t.pc, count: null });
          t.pc = c.target!;
          break;
        case 'ret': {
          const top = t.stack.pop();
          if (top) t.pc = top.pc;
          break;
        }
        case 'loop_start':
          t.stack.push({ pc: t.pc, count: val() });
          break;
        case 'loop_end': {
          const top = t.stack[t.stack.length - 1];
          if (top) {
            if (top.count === 0) t.pc = top.pc;
            else if (top.count !== null && top.count > 1) {
              top.count--;
              t.pc = top.pc;
            } else t.stack.pop();
          }
          break;
        }
        case 'fin':
          t.open = false;
          break;
        case 'tempo':
          this.tempo = Math.max(0, Math.min(1023, val()));
          break;
        case 'timebase':
          this.timebase = val();
          break;
        case 'main_volume':
          this.mainVolume = val();
          this.out.gain.setValueAtTime(this.vol * (this.mainVolume / 127) ** 2, time);
          break;
        case 'volume':
          t.volume = val();
          t.applyGain(time);
          break;
        case 'volume2':
          t.volume2 = val();
          t.applyGain(time);
          break;
        case 'pan':
          t.pan = val();
          break;
        case 'init_pan':
          t.initPan = val();
          break;
        case 'transpose':
          t.transpose = val();
          break;
        case 'bend_range':
          t.bendRange = val();
          break;
        case 'pitch_bend':
          t.bend = val();
          break;
        case 'attack':
          t.attack = val();
          break;
        case 'decay':
          t.decay = val();
          break;
        case 'sustain':
          t.sustain = val();
          break;
        case 'release':
          t.release = val();
          break;
        case 'mute':
          t.mute = val();
          break;
        case 'note_wait':
          t.noteWait = val() !== 0;
          break;
        case 'bank_select':
          t.bank = val();
          break;
        case 'env_reset':
          t.attack = t.decay = t.sustain = t.release = 255;
          break;
        default:
          if (c.v !== undefined) this.varOp(t, c.name, c.v, val(), time);
          break;
      }
    }
  }

  private varOp(t: Track, n: string, v: number, val: number, time: number): void {
    const cur = this.getvar(t, v, time);
    switch (n) {
      case 'setvar':
        return this.setvar(t, v, val);
      case 'addvar':
        return this.setvar(t, v, cur + val);
      case 'subvar':
        return this.setvar(t, v, cur - val);
      case 'mulvar':
        return this.setvar(t, v, cur * val);
      case 'divvar':
        if (val) this.setvar(t, v, Math.trunc(cur / val));
        return;
      case 'modvar':
        if (val) this.setvar(t, v, cur % val);
        return;
      case 'shiftvar':
        return this.setvar(t, v, val >= 0 ? cur << val : cur >> -val);
      case 'randvar':
        return this.setvar(t, v, val >= 0 ? Math.floor(Math.random() * (val + 1)) : -Math.floor(Math.random() * (-val + 1)));
      case 'andvar':
        return this.setvar(t, v, cur & val);
      case 'orvar':
        return this.setvar(t, v, cur | val);
      case 'xorvar':
        return this.setvar(t, v, cur ^ val);
      case 'notvar':
        return this.setvar(t, v, ~val);
      case 'cmp_eq':
        t.cmp = cur === val;
        return;
      case 'cmp_ge':
        t.cmp = cur >= val;
        return;
      case 'cmp_gt':
        t.cmp = cur > val;
        return;
      case 'cmp_le':
        t.cmp = cur <= val;
        return;
      case 'cmp_lt':
        t.cmp = cur < val;
        return;
      case 'cmp_ne':
        t.cmp = cur !== val;
        return;
      default:
        return;
    }
  }

  private doTick(time: number): void {
    this.tickTime = time;
    for (const v of this.voices) {
      if (v.length > 0) {
        v.length--;
        if (v.length === 0 && v.env.state !== 'release') v.env.release();
      }
    }
    for (let no = 0; no < 16; no++) {
      const t = this.tracks[no];
      if (t?.open) this.runTrack(t, time);
    }
    this.tick++;
  }

  /** 다음에 처리할 5 ms 프레임의 시작 시각 */
  get nextFrameTime(): number {
    return this.t0 + this.frame * FRAME_SEC;
  }

  /** until(AudioContext 시각) 앞에서 시작하는 프레임을 모두 처리 */
  advance(until: number): void {
    while (!this.finished && this.nextFrameTime < until) this.stepFrame();
  }

  /** 프레임 하나: 틱 누적·처리 → 음 엔벌로프 */
  stepFrame(): void {
    const tf = this.nextFrameTime;
    const te = tf + FRAME_SEC;
    if (!this.stopped) {
      this.frac += (this.tempo * this.timebase * FRAME_SEC * 1000) / 60000;
      while (this.frac >= 1) {
        this.frac -= 1;
        this.doTick(tf);
      }
    }
    const alive: Voice[] = [];
    for (const v of this.voices) {
      const amp1 = v.env.stepMs(5);
      v.gain.gain.linearRampToValueAtTime(amp1, te);
      v.amp = amp1;
      const silentTrack = !v.track.open && v.track.volume2 === 0;
      if (v.env.dead() || te >= v.endTime || silentTrack) {
        if (te < v.endTime) {
          try {
            v.src.stop(te);
          } catch {
            /* 이미 멈춤 */
          }
        }
        continue;
      }
      alive.push(v);
    }
    this.voices = alive;
    this.frame++;
    const allClosed = this.tracks.every((t) => !t || !t.open);
    if ((allClosed || this.stopped) && this.voices.length === 0) this.finished = true;
  }

  /** 원본 SoundHandle::Stop(0) — 트랙을 멈추고 음을 바로 끊는다 */
  stop(): void {
    this.stopped = true;
    for (const t of this.tracks) if (t) t.open = false;
    const now = this.audio.ctx.currentTime;
    for (const v of this.voices) {
      try {
        v.src.stop(now);
      } catch {
        /* 이미 멈춤 */
      }
    }
    this.voices = [];
    this.finished = true;
  }
}

/** 시퀀스 사운드 묶음 — 타이머 하나로 전부 진행한다. 돌 소리가 없으면 타이머를 멈춘다 */
export class SeqEngine {
  private readonly sounds = new Set<SeqSound>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly bytes = new WeakMap<SeqData, Uint8Array>();

  constructor(
    private readonly audio: AudioOut,
    readonly globals: SeqGlobals,
  ) {}

  private dataBytes(d: SeqData): Uint8Array {
    let b = this.bytes.get(d);
    if (!b) {
      const s = atob(d.data);
      b = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
      this.bytes.set(d, b);
    }
    return b;
  }

  /** 지금 재생을 시작한다. 첫 프레임은 다음 타이머에서 처리하므로 같은 걸음에 쓴 지역 변수가 틱 0 에 보인다 */
  play(
    data: SeqData,
    buffers: (AudioBuffer | undefined)[],
    bus: Bus,
    opts: { gain?: number; pan?: number; local?: Record<number, number>; onNote?: (key: number, time: number, start: number) => void } = {},
  ): SeqSound {
    const s = new SeqSound(this.audio, data, this.dataBytes(data), buffers, this.globals, bus, this.audio.ctx.currentTime, opts);
    this.sounds.add(s);
    this.timer ??= setInterval(() => this.pump(), PUMP_MS);
    return s;
  }

  pump(): void {
    this.advanceAll(this.audio.ctx.currentTime + LOOKAHEAD);
    if (this.sounds.size === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * until 앞의 프레임을 모든 소리에 걸쳐 시각 순서로 하나씩 처리한다(같은 시각이면 재생 시작 순서).
   * 원본은 사운드 스레드 한 프레임 안에서 모든 시퀀스를 갱신하므로, 시퀀스끼리 전역 변수로 주고받는 일
   * (마스터 countTrack 의 G12·G14, BGM 의 G13·G10 핸드셰이크)이 프레임 순서대로 보인다 [판독 FUN_71005cdd50].
   * 한 프레임 안 소리 사이 순서(플레이어 목록 순서)는 [추정: 재생 시작 순서].
   */
  advanceAll(until: number): void {
    for (;;) {
      let next: SeqSound | null = null;
      for (const s of this.sounds) if (!s.finished && s.nextFrameTime < until && (!next || s.nextFrameTime < next.nextFrameTime - 1e-9)) next = s;
      if (!next) break;
      try {
        next.stepFrame();
      } catch (e) {
        console.warn('시퀀스 재생 오류로 멈춘다', e);
        next.stop();
      }
    }
    for (const s of this.sounds) if (s.finished) this.sounds.delete(s);
  }

  stopAll(): void {
    for (const s of this.sounds) s.stop();
    this.sounds.clear();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
