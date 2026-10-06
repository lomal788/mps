/**
 * hsmg402 공용 흐름 소리 검사 — sound_sys/sys.json(web/tools/analysis/hsmg402_sys_sound_assets.py)을 원본과 대조하고, 한 판 소리 일정을 찍는다.
 *   A. main 이미지(extracted/exefs/main.decomp.bin + RELATIVE 재배치)를 TS 로 따로 읽어 UIMGTelop 표 0x71014ab280 의 type 0·2·5·6 칸 = sys.json
 *      + 함수 안 adrp/add 로 가리키는 문자열(SetPlayers WINNER/WINNERS, Create case 5 WINNER, MGSound 징글·호루라기) [판독 근거의 기계어 대조]
 *   B. mgsound_setting.csv hsmg402·;default 행 = sys.json(whistle_entry_type·result_jingle·bgm_stop) [데이터]
 *   C. 음성 wav = subarc_sysvoi_kokr 안 FWAV(DSP-ADPCM)를 이 스크립트가 다시 디코드한 표본과 같음(길이·샘플레이트·표본 전부) [실행]
 *   D. sound.ts Hsmg402Sound.telop/whistle 의 라벨 고르기(play 를 기록기로 바꿔 실제 코드 실행) [합성]
 *   E. 전원 CPU·전원 사람(무입력) 한 판을 로직으로 돌려 index.ts 규칙(단계 7 START, 8 호루라기, 10 FINISH, telop start 결과)으로 소리 일정 [재구현 계산]
 *
 *   cd F:/dev/mps/web && npx tsx tools/check_hsmg402_sound.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameSetup } from '../script/game';
import { Hsmg402Game } from '../script/games/hsmg402/logic/game';
import { Hsmg402Sound } from '../script/games/hsmg402/view/sound';

const ROOT = resolve(import.meta.dirname, '../..');
const ASSET = resolve(ROOT, 'web/assets/hsmg402');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SYS: any = JSON.parse(readFileSync(resolve(ASSET, 'sound_sys/sys.json'), 'utf-8'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MAN: any = JSON.parse(readFileSync(resolve(ASSET, 'manifest.json'), 'utf-8'));

let pass = 0;
let fail = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++;
  else {
    fail++;
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function section(name: string, fn: () => void): void {
  const f0 = fail;
  const p0 = pass;
  try {
    fn();
  } catch (e) {
    fail++;
    fails.push(`${name}: 예외 ${(e as Error).stack ?? e}`);
  }
  console.log(`${fail === f0 ? 'PASS' : 'FAIL'}  ${name}  (${pass - p0} 통과, ${fail - f0} 실패)`);
}

/* ───────── main 이미지 ───────── */
const BASE = 0x7100000000n;
class Main {
  readonly b: Buffer;
  constructor(p: string) {
    this.b = Buffer.from(readFileSync(p));
    const mod0 = this.b.readUInt32LE(4);
    if (this.b.toString('latin1', mod0, mod0 + 4) !== 'MOD0') throw new Error('MOD0 없음');
    let off = mod0 + this.b.readInt32LE(mod0 + 4);
    const tags = new Map<bigint, bigint>();
    for (;;) {
      const t = this.b.readBigInt64LE(off);
      const v = this.b.readBigUInt64LE(off + 8);
      off += 16;
      if (t === 0n) break;
      if (!tags.has(t)) tags.set(t, v);
    }
    const rela = Number(tags.get(7n)!);
    const sz = Number(tags.get(8n)!);
    for (let r = rela; r < rela + sz; r += 24) {
      const roff = Number(this.b.readBigUInt64LE(r));
      const info = this.b.readBigUInt64LE(r + 8);
      const add = this.b.readBigInt64LE(r + 16);
      if ((info & 0xffffffffn) === 0x403n) this.b.writeBigUInt64LE(BASE + add, roff);
    }
  }
  off(va: number): number {
    return va - 0x7100000000;
  }
  ptr(va: number): number {
    const v = this.b.readBigUInt64LE(this.off(va));
    return v === 0n ? 0 : Number(v - BASE);
  }
  cstrAt(o: number): string {
    return this.b.toString('utf8', o, this.b.indexOf(0, o));
  }
  /** [a,b) 안의 adrp xN + add xN,xN,#imm 짝이 가리키는 C 문자열들 */
  strRefs(a: number, e: number): string[] {
    const out: string[] = [];
    const page = new Map<number, number>();
    for (let va = a; va < e; va += 4) {
      const ins = this.b.readUInt32LE(this.off(va));
      if (((ins & 0x9f000000) >>> 0) === 0x90000000) {
        const rd = ins & 31;
        const immlo = (ins >>> 29) & 3;
        const immhi = (ins >>> 5) & 0x7ffff;
        let imm = (immhi << 2) | immlo;
        if (imm & 0x100000) imm -= 0x200000;
        page.set(rd, (Math.floor((va - 0x7100000000) / 4096) + imm) * 4096);
      } else if (((ins & 0xffc00000) >>> 0) === 0x91000000) {
        const rd = ins & 31;
        const rn = (ins >>> 5) & 31;
        const imm = (ins >>> 10) & 0xfff;
        const p = page.get(rn);
        if (p !== undefined) {
          const o = p + imm;
          if (o > 0 && o < this.b.length) {
            const s = this.cstrAt(o);
            if (/^[A-Za-z0-9_]{4,}$/.test(s)) out.push(s);
          }
          page.delete(rn);
          if (rd !== rn) page.delete(rd);
        }
      }
    }
    return out;
  }
}

section('A. main UIMGTelop 표·기계어 문자열 = sys.json', () => {
  const m = new Main(resolve(ROOT, 'extracted/exefs/main.decomp.bin'));
  const str = (va: number): string | null => {
    const p = m.ptr(va);
    return p ? m.cstrAt(p) : null;
  };
  for (const t of [0, 2, 5, 6]) {
    const p = 0x71014ab280 + t * 0x30;
    const row = { layout: str(p), se: str(p + 8), voice: str(p + 0x10), message: str(p + 0x18) };
    const j = SYS.telop[String(t)];
    for (const k of ['layout', 'se', 'voice', 'message'] as const) check(`type ${t} ${k}`, row[k] === j[k], `${row[k]} vs ${j[k]}`);
    const slot90 = t === 5 ? 'WD_VOI_LOC_SYS_WINNER' : (row.se ?? '');
    check(`type ${t} SE 칸`, j.slot90 === slot90, `${j.slot90}`);
    check(`type ${t} 음성 칸`, j.slot98 === (row.voice ?? ''), `${j.slot98}`);
    console.log(`      type ${t}: ${row.layout} SE ${row.se} 음성 ${row.voice} 문구 ${row.message}`);
  }
  const fn: [string, number, number, string[]][] = [
    ['UIMGTelop::Create(case 5 WINNER)', 0x71000d3688, 0x71000d3ba8, ['WD_VOI_LOC_SYS_WINNER', 'hsmg_tlp_count']],
    ['UIMGTelop::SetPlayers(WINNER/WINNERS)', 0x71000d462c, 0x71000d4a70, ['WD_VOI_LOC_SYS_WINNER', 'WD_VOI_LOC_SYS_WINNERS', 'hsmg_tlp_win', 'hsmg_tlp_wins']],
    ['UIMGTelop::Start(카운트다운 3)', 0x71000d3f0c, 0x71000d402c, ['SQ_SE_TLP_321GO_3', 'WD_VOI_LOC_SYS_3']],
    ['MGSound 징글 선택 FUN_710004d150', 0x710004d150, 0x710004d278, ['SM_JIN_MG_WIN', 'SM_JIN_MG_DRAW']],
    ['MGSound 호루라기 FUN_710004d528', 0x710004d528, 0x710004d570, ['SQ_SE_SYS_WHISTLE']],
  ];
  for (const [name, a, e, want] of fn) {
    const got = new Set(m.strRefs(a, e));
    for (const w of want) check(`${name} ⊃ ${w}`, got.has(w), [...got].join(','));
  }
  /* SetPlayers: 인원 > 1 → WINNERS 를 +0x90 에(@0x71000d4980 cmp x8,#1 / b.ls) */
  check('SetPlayers cmp #1', m.b.readUInt32LE(m.off(0x71000d4980)) === 0xf100051f, m.b.readUInt32LE(m.off(0x71000d4980)).toString(16));
});

section('B. mgsound_setting.csv = sys.json', () => {
  const rows = readFileSync(resolve(ROOT, 'extracted/nkn/audio.nx.bea/audio/data/mgsound_setting.csv'), 'utf-8')
    .split(/\r?\n/)
    .map((l) => l.split(','));
  const head = rows.find((r) => r[0] === ';id')!;
  const def = rows.find((r) => r[0] === ';default')!;
  const row = rows.find((r) => r[0] === 'hsmg402')!;
  const val = (k: string): string => {
    const i = head.indexOf(k);
    return row[i] || def[i] || '';
  };
  for (const k of ['whistle_entry_type', 'result_jingle_play_position', 'result_jingle_play_offset', 'mg_bgm_stop_offset', 'mg_bgm_stop_fade', 'mg_bgm_play_position'])
    check(k, SYS.setting[k].value === val(k), `${SYS.setting[k].value} vs ${val(k)}`);
  check('whistle entryType 0', SYS.whistle.entryType === 0 && val('whistle_entry_type') === '0');
  check('징글 위치 telop·지연 0', val('result_jingle_play_position') === 'telop' && val('result_jingle_play_offset') === '0');
  check('BGM 정지 지연 0', val('mg_bgm_stop_offset') === '0');
});

/* ───────── FWAV DSP 디코드(독립 구현) ───────── */
function fwavs(b: Buffer): { rate: number; frames: number; pcm: Int16Array[] }[] {
  const out = [];
  for (let o = b.indexOf('FWAV'); o >= 0; o = b.indexOf('FWAV', o + 4)) {
    const nb = b.readUInt16LE(o + 0x10);
    let info = -1;
    let data = -1;
    for (let i = 0; i < nb; i++) {
      const t = b.readUInt16LE(o + 0x14 + 12 * i);
      const off = b.readInt32LE(o + 0x14 + 12 * i + 4);
      if (t === 0x7000) info = o + off;
      if (t === 0x7001) data = o + off;
    }
    const p = info + 8;
    const enc = b[p];
    const rate = b.readUInt32LE(p + 4);
    const frames = b.readUInt32LE(p + 12);
    const tb = p + 20;
    const nch = b.readUInt32LE(tb);
    const pcm: Int16Array[] = [];
    for (let c = 0; c < nch; c++) {
      const cp = tb + b.readInt32LE(tb + 4 + 8 * c + 4);
      const so = b.readInt32LE(cp + 4);
      const ao = b.readInt32LE(cp + 8 + 4);
      if (enc !== 2) throw new Error(`인코딩 ${enc}`);
      const q = cp + ao;
      const coef = Array.from({ length: 16 }, (_, k) => b.readInt16LE(q + 2 * k));
      let h1 = b.readInt16LE(q + 34);
      let h2 = b.readInt16LE(q + 36);
      const s = new Int16Array(frames);
      let at = data + 8 + so;
      for (let i = 0; i < frames; at += 8) {
        const ps = b[at];
        const c1 = coef[((ps >> 4) & 7) * 2];
        const c2 = coef[((ps >> 4) & 7) * 2 + 1];
        const sc = 1 << (ps & 15);
        for (let k = 0; k < 14 && i < frames; k++, i++) {
          const by = b[at + 1 + (k >> 1)];
          let n = k & 1 ? by & 15 : by >> 4;
          if (n >= 8) n -= 16;
          let v = (n * sc * 2048 + 1024 + c1 * h1 + c2 * h2) >> 11;
          v = Math.max(-32768, Math.min(32767, v));
          s[i] = v;
          h2 = h1;
          h1 = v;
        }
      }
      pcm.push(s);
    }
    out.push({ rate, frames, pcm });
  }
  return out;
}
function readWav(p: string): { rate: number; ch: number; frames: number; data: Int16Array } {
  const b = readFileSync(p);
  let o = 12;
  let rate = 0;
  let ch = 0;
  for (;;) {
    const id = b.toString('latin1', o, o + 4);
    const sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      ch = b.readUInt16LE(o + 10);
      rate = b.readUInt32LE(o + 12);
    } else if (id === 'data') {
      const d = new Int16Array(b.buffer.slice(b.byteOffset + o + 8, b.byteOffset + o + 8 + sz));
      return { rate, ch, frames: d.length / ch, data: d };
    }
    o += 8 + sz + (sz & 1);
  }
}

section('C. 음성 wav = sysvoi FWAV 재디코드(길이·샘플레이트·표본)', () => {
  const loc = SYS.voiceLocale;
  check('로캘 koKR → subarc_sysvoi_kokr / KOKR', loc.locale === 'koKR' && loc.archive === 'subarc_sysvoi_kokr' && loc.suffix === 'KOKR');
  const fsst = readFileSync(resolve(ROOT, `extracted/bea/sound~${loc.archive}.nx.bea/audio/sounddata/${loc.archive}/${loc.archive}.fsst`));
  const ws = fwavs(fsst);
  check('FWAV 17개', ws.length === 17, `${ws.length}`);
  for (const [label, e] of Object.entries(SYS.sounds) as [string, any][]) {
    if (e.kind !== 'stream') continue;
    check(`${label} 대상 접미`, e.target === `${label}_${loc.suffix}`);
    const w = readWav(resolve(ASSET, e.file));
    const cands = ws.filter((x) => x.frames === w.frames && x.rate === w.rate && x.pcm.length === w.ch);
    let same = false;
    for (const c of cands) {
      let ok = true;
      for (let i = 0; i < w.frames && ok; i++) for (let k = 0; k < w.ch; k++) if (c.pcm[k][i] !== w.data[i * w.ch + k]) ok = false;
      if (ok) same = true;
    }
    check(`${label} 표본 일치`, same, `후보 ${cands.length}`);
    check(`${label} 길이`, Math.abs(e.durationSec - w.frames / w.rate) < 1e-6 && e.sampleRate === w.rate);
    console.log(`      ${label} → ${e.target}: ${w.frames} 표본 / ${w.rate} Hz = ${(w.frames / w.rate).toFixed(4)} s, ch ${w.ch}, vol ${e.volume}(gain ${e.gain})`);
  }
  for (const [label, e] of Object.entries(SYS.sounds) as [string, any][]) {
    if (e.kind !== 'seq') continue;
    for (const wv of e.seq.waves) check(`${label} 파형 파일 ${wv.file}`, existsSync(resolve(ASSET, wv.file)));
    console.log(`      ${label}: 시퀀스 vol ${e.seq.volume}, 파형 ${e.seq.waves.length}, 플레이어 ${e.player?.name}`);
  }
  check('징글 치환 WIN → _MP03', MAN.substitute.SM_JIN_MG_WIN === 'SM_JIN_MG_WIN_MP03' && !!MAN.sounds.SM_JIN_MG_WIN_MP03);
  check('징글 치환 DRAW → DRAW_MP03', MAN.substitute.SM_JIN_MG_DRAW === 'SM_JIN_MG_DRAW_MP03' && !!MAN.sounds.SM_JIN_MG_DRAW_MP03);
});

/** 실제 sound.ts 코드로 라벨 고르기(play → 기록) */
function recorder(): { s: Hsmg402Sound; log: string[] } {
  const s = new Hsmg402Sound({} as never, null);
  const log: string[] = [];
  const any = s as unknown as { sys: unknown; play: (l: string) => null };
  any.sys = SYS;
  any.play = (l: string) => {
    log.push(l);
    return null;
  };
  return { s, log };
}

section('D. sound.ts telop/whistle 분기', () => {
  const cases: [0 | 2 | 5 | 6, number[], string[]][] = [
    [0, [], ['SQ_SE_TLP_START', 'WD_VOI_LOC_SYS_START']],
    [2, [], ['SQ_SE_TLP_FINISH', 'WD_VOI_LOC_SYS_FINISH']],
    [5, [], ['WD_VOI_LOC_SYS_WINNER', 'SM_JIN_MG_WIN']],
    [5, [2], ['WD_VOI_LOC_SYS_WINNER', 'SM_JIN_MG_WIN']],
    [5, [0, 3], ['WD_VOI_LOC_SYS_WINNERS', 'SM_JIN_MG_WIN']],
    [5, [0, 1, 2, 3], ['WD_VOI_LOC_SYS_WINNERS', 'SM_JIN_MG_WIN']],
    [6, [], ['WD_VOI_LOC_SYS_DRAW', 'SM_JIN_MG_DRAW']],
  ];
  for (const [t, pl, want] of cases) {
    const { s, log } = recorder();
    s.telop(t, pl);
    check(`telop ${t} [${pl}]`, JSON.stringify(log) === JSON.stringify(want), JSON.stringify(log));
  }
  const { s, log } = recorder();
  s.whistle(0);
  s.whistle(1);
  check('whistle(0)만', JSON.stringify(log) === '["SQ_SE_SYS_WHISTLE"]', JSON.stringify(log));
  for (const l of ['SQ_SE_TLP_START', 'SQ_SE_TLP_FINISH', 'SQ_SE_SYS_WHISTLE', 'WD_VOI_LOC_SYS_START', 'WD_VOI_LOC_SYS_FINISH', 'WD_VOI_LOC_SYS_WINNER', 'WD_VOI_LOC_SYS_WINNERS', 'WD_VOI_LOC_SYS_DRAW'])
    check(`${l} sys.json 에 있음`, !!SYS.sounds[l]);
  /* 승자 캐릭터 보이스는 co_win01a 모션 ftrg(VO_PC_ACTION 등)가 낸다 — 그 라벨이 manifest 에 있는지 */
  const idx = JSON.parse(readFileSync(resolve(ROOT, 'web/assets/chara/index.json'), 'utf-8')) as Record<string, unknown>;
  for (const pc of Object.keys(idx)) {
    const mj = JSON.parse(readFileSync(resolve(ROOT, `web/assets/chara/${pc}/motions.json`), 'utf-8'));
    for (const ev of mj.motions.co_win01a?.events ?? [])
      for (const o of ev.out) if (o.kind === 'se') check(`${pc} co_win01a ${o.label}`, !!MAN.sounds[MAN.substitute[o.label] ?? o.label]);
  }
});

const setupOf = (coms: boolean[], seed: number, levels = [0, 0, 0, 0]): GameSetup => ({
  players: coms.map((c, i) => ({ char: `pc0${i + 1}`, isCom: c, comLevel: levels[i] })),
  seed,
  practice: false,
});

section('E. 한 판 소리 일정(index.ts 규칙, 로직 실행)', () => {
  const runs: [string, boolean[], number, number[]][] = [
    ['CPU seed 1', [true, true, true, true], 1, [0, 0, 0, 0]],
    ['CPU seed 5', [true, true, true, true], 5, [0, 1, 2, 3]],
    ['사람 4 무입력', [false, false, false, false], 1, [0, 0, 0, 0]],
  ];
  for (const [name, coms, seed, lv] of runs) {
    const g = new Hsmg402Game(setupOf(coms, seed, lv));
    const { s, log } = recorder();
    const sched: string[] = [];
    let last = -1;
    for (let f = 0; f < 20000 && !g.done; f++) {
      g.step([null, null, null, null]);
      const st = g.state;
      const n0 = log.length;
      if (st.stage !== last) {
        if (st.stage === 7) s.telop(0);
        if (st.stage === 8) s.whistle(0);
        if (st.stage === 10) s.telop(2);
        last = st.stage;
      }
      for (const e of g.events) if (e.k === 'telop' && e.op === 'start') s.telop(e.type, e.players);
      if (log.length > n0) sched.push(`f${st.frame}(단계 ${st.stage}): ${log.slice(n0).join(' + ')}`);
    }
    console.log(`      ${name}: 끝 ${g.result?.frames}f ranks ${JSON.stringify(g.result?.ranks)}${g.result?.draw ? ' 무승부' : ''}`);
    for (const l of sched) console.log(`        ${l}`);
    const kinds = sched.map((l) => l.split(': ')[1]);
    check(`${name} START`, kinds[0] === 'SQ_SE_TLP_START + WD_VOI_LOC_SYS_START');
    check(`${name} 호루라기`, kinds[1] === 'SQ_SE_SYS_WHISTLE');
    check(`${name} FINISH`, kinds[2] === 'SQ_SE_TLP_FINISH + WD_VOI_LOC_SYS_FINISH');
    const r = g.result!;
    const winners = r.ranks.filter((x) => x === 0).length;
    const want = r.draw ? 'WD_VOI_LOC_SYS_DRAW + SM_JIN_MG_DRAW' : `${winners >= 2 ? 'WD_VOI_LOC_SYS_WINNERS' : 'WD_VOI_LOC_SYS_WINNER'} + SM_JIN_MG_WIN`;
    check(`${name} 결과`, kinds[3] === want, `${kinds[3]} vs ${want}`);
    check(`${name} 4건`, sched.length === 4, `${sched.length}`);
  }
});

console.log(`\n합계: ${pass} 통과, ${fail} 실패`);
if (fails.length) {
  console.log('\n실패 목록:');
  for (const f of fails.slice(0, 60)) console.log(`  - ${f}`);
  process.exitCode = 1;
}
