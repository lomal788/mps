/**
 * hsmg402 로직 시험 — 분석 기대값(재구현 계산 JSON)과 대조, 결정성, 전원 CPU 한 판.
 * 기대값: analysis/hsmg402_calc.json, analysis/hsmg402_player_calc.json, analysis/core/rand_vectors.json (docs/minigame/hsmg402.md 10.2).
 * 기대값은 고치지 않는다. 다르면 FAIL 과 차이를 찍는다.
 *
 *   cd F:/dev/mps/web && npx tsx tools/test_hsmg402.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { F, f32Bits, frsqrte, neonInvLen, normalize4, type V4 } from '../script/core/fmath';
import { BexRand } from '../script/core/rng';
import type { GameSetup } from '../script/game';
import * as D from '../script/games/hsmg402/logic/data';
import { DT, FALL_R2, FLT_MAX, SIZE_SCALE } from '../script/games/hsmg402/logic/data';
import { Hsmg402Game } from '../script/games/hsmg402/logic/game';
import { FlatDiscGround, FlatGround, NoGround, StageGround, castRayDown, type Ground } from '../script/games/hsmg402/logic/ground';
import { HandAnchor } from '../script/games/hsmg402/logic/handAnchor';
import { Player } from '../script/games/hsmg402/logic/player';
import { resultRank } from '../script/games/hsmg402/logic/resultRank';
import { SnowBall, sizeSoundParam, type BallCtx, type BallOwner } from '../script/games/hsmg402/logic/snowBall';
import { MinigameTimer } from '../script/games/hsmg402/logic/timer';
import { PAD_B } from '../script/games/hsmg402/logic/actor';

const ROOT = resolve(import.meta.dirname, '../..');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (p: string): any => JSON.parse(readFileSync(resolve(ROOT, p), 'utf-8'));
const CALC = load('analysis/hsmg402_calc.json');
const PCALC = load('analysis/hsmg402_player_calc.json');
const RV = load('analysis/core/rand_vectors.json');

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
const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;
const hex = (x: number): string => `0x${f32Bits(x).toString(16).padStart(8, '0')}`;

const setupOf = (coms: boolean[], seed = 1, levels = [0, 0, 0, 0]): GameSetup => ({
  players: coms.map((c, i) => ({ char: `pc0${i + 1}`, isCom: c, comLevel: levels[i] })),
  seed,
  practice: false,
});

const ctxOf = (ground: Ground): BallCtx => ({ ground, emit: () => {} });

/** 공 단위 시험용 던진이(손 위치·방향을 직접 놓는다) */
class FakeOwner implements BallOwner {
  readonly id = 0;
  readonly index = 0;
  readonly hand = new HandAnchor();
  pos = { x: 0, y: 0, z: 0 };
  yaw = 0;
  dirZ(): V4 {
    return { x: F(Math.sin(this.yaw)), y: 0, z: F(Math.cos(this.yaw)), w: 0 };
  }
}

/* ───────── 1. 코어 ───────── */
section('rand_vectors(libc++ uniform_int·RangeF 분리 반올림)', () => {
  const s = RV.seed;
  let r = new BexRand(s);
  check('rand', JSON.stringify(Array.from({ length: 8 }, () => r.rand())) === JSON.stringify(RV.rand));
  r = new BexRand(s);
  check('rand_mod_6', JSON.stringify(Array.from({ length: 16 }, () => r.mod(6))) === JSON.stringify(RV.rand_mod_6));
  r = new BexRand(s);
  check('rand_range_3_10', JSON.stringify(Array.from({ length: 16 }, () => r.range(3, 10))) === JSON.stringify(RV.rand_range_3_10));
  r = new BexRand(s);
  check('rand_f_bits', JSON.stringify(Array.from({ length: 8 }, () => hex(r.f()))) === JSON.stringify(RV.rand_f_bits));
  r = new BexRand(s);
  check('rand_mod_f_2.5_bits', JSON.stringify(Array.from({ length: 8 }, () => hex(r.modF(2.5)))) === JSON.stringify(RV['rand_mod_f_2.5_bits']));
  r = new BexRand(s);
  check('rand_range_f_-1_1_bits', JSON.stringify(Array.from({ length: 8 }, () => hex(r.rangeF(-1, 1)))) === JSON.stringify(RV['rand_range_f_-1_1_bits']));
  r = new BexRand(s);
  const m1 = r.mod(1);
  check('edge_rand_mod_1_consumes', m1 === RV.edge_rand_mod_1_consumes[0] && r.e.calls === RV.edge_rand_mod_1_consumes[1]);
});

section('dt·frsqrte_check', () => {
  check('dt_bits', hex(DT) === CALC.dt_bits, hex(DT));
  const fc = CALC.frsqrte_check;
  check('frsqrte(1.0)', frsqrte(1.0) === fc['x=1.0'], `${frsqrte(1.0)}`);
  check('frsqrte(0.25)', frsqrte(0.25) === fc['x=0.25'], `${frsqrte(0.25)}`);
  check('inv_len(1.21)', neonInvLen(F(1.21)) === F(fc['inv_len(1.21)']), `${neonInvLen(F(1.21))}`);
});

/* ───────── 2. 시간·순위 ───────── */
section('timer_60s·guide_out·result_state3', () => {
  const t = new MinigameTimer();
  t.setTimer(60);
  t.startTimer();
  let n = 0;
  let guide: { ticks: number; remain: number; elapsed: number } | null = null;
  while (t.state !== 3 && n < 5000) {
    n++;
    t.update();
    if (!guide && F(60 - t.remainSecond()) >= 10) guide = { ticks: n, remain: t.remainSecond(), elapsed: F(60 - t.remainSecond()) };
  }
  check('timer_60s_tick_true_at', n === CALC.timer_60s_tick_true_at, `${n}`);
  check('guide_out.ticks', guide?.ticks === CALC.guide_out.ticks, JSON.stringify(guide));
  check('guide_out.elapsed', guide !== null && guide.elapsed === F(CALC.guide_out.elapsed));
  let acc = 0;
  let k = 0;
  while (!(acc > 2.0)) {
    acc = F(DT + acc);
    k++;
  }
  check('result_state3_over_2s', k === CALC.result_state3_over_2s.frames && acc === F(CALC.result_state3_over_2s.acc), `${k} ${acc}`);
});

section('rank_examples(ResultRank)', () => {
  const ex = CALC.rank_examples;
  check('[10,20,20,MAX]', JSON.stringify(resultRank([10, 20, 20, FLT_MAX], 4)) === JSON.stringify(ex['[10,20,20,MAX]']));
  check('[5,5,3,MAX]', JSON.stringify(resultRank([5, 5, 3, FLT_MAX], 4)) === JSON.stringify(ex['[5,5,3,MAX]']));
  check('all0', JSON.stringify(resultRank([0, 0, 0, 0], 4)) === JSON.stringify(ex.all0));
  check('[MAX,MAX,12,MAX]', JSON.stringify(resultRank([FLT_MAX, FLT_MAX, 12, FLT_MAX], 4)) === JSON.stringify(ex['[MAX,MAX,12,MAX]']));
});

section('scenarios(GameMgr::Update 6개)', () => {
  const events: Record<string, Record<number, number[]>> = {
    one_by_one: { 600: [1], 1200: [2], 1800: [3] },
    two_same_frame_then_last: { 600: [1, 2], 900: [3] },
    last_three_same_frame: { 600: [0], 900: [1, 2, 3] },
    all_four_same_frame: { 600: [0, 1, 2, 3] },
    time_up_two_survivors: { 600: [1], 1200: [2] },
    human_out_com_boost: { 300: [0], 1500: [1], 2000: [2] },
  };
  for (const [name, ev] of Object.entries(events)) {
    const exp = CALC.scenarios[name];
    const g = new Hsmg402Game(setupOf([false, true, true, true]));
    const m = g.mgr;
    m.start();
    m.timer.startTimer();
    for (const p of g.players) p.pos.y = 0;
    let end = -1;
    for (let n = 1; n < 4000; n++) {
      m.timer.update();
      for (const i of ev[n] ?? []) g.players[i].pos.y = -1.5;
      if (m.update()) {
        end = n;
        break;
      }
    }
    const ranks = g.players.map((p) => p.rank);
    const ft = g.players.map((p) => p.fallTime);
    const path = ranks.every((r) => r === 3) ? 'draw(telop type6)' : `winners=[${ranks.map((r, i) => (r === 0 ? i : -1)).filter((i) => i >= 0).join(', ')}]`;
    check(`${name}.end_frame`, end === exp.end_frame, `${end} vs ${exp.end_frame}`);
    check(`${name}.rank`, JSON.stringify(ranks) === JSON.stringify(exp.rank), `${JSON.stringify(ranks)} vs ${JSON.stringify(exp.rank)}`);
    check(`${name}.fall_time`, ft.every((t, i) => t === F(exp.fall_time[i])), `${JSON.stringify(ft)}`);
    check(`${name}.com_boost`, m.comBoost === exp.com_boost);
    check(`${name}.result_path`, path === exp.result_path, path);
  }
});

section('start_pose(cha_pos00~03)', () => {
  const g = new Hsmg402Game(setupOf([true, true, true, true]));
  g.players.forEach((p, k) => {
    const e = CALC.start_pose[`cha_pos0${k}`];
    check(`cha_pos0${k}.pos`, p.pos.x === e.pos[0] && p.pos.y === e.pos[1] && p.pos.z === e.pos[2]);
    check(`cha_pos0${k}.yaw_deg`, p.rotTarget === F(e.yaw_deg), `${p.rotTarget}`);
  });
});

section('constants(NRO 정적 표 = player calc constants, 비트 일치)', () => {
  const c = PCALC.constants;
  const eq = (name: string, a: readonly number[], b: number[]): void => check(name, a.length === b.length && a.every((x, i) => x === F(b[i])), JSON.stringify(a));
  eq('DamageVecRes', D.DAMAGE_VEC_RES, c.DamageVecRes);
  eq('DamageVecLen', D.DAMAGE_VEC_LEN, c.DamageVecLen);
  eq('DamageVecDeg', D.DAMAGE_VEC_DEG, c.DamageVecDeg);
  eq('DamageMoveAnimFrame', D.DAMAGE_MOVE_ANIM_FRAME, c.DamageMoveAnimFrame);
  eq('walk_speed_factor', D.WALK_SPEED_FACTOR, c.walk_speed_factor);
  eq('walk_anim_speed', D.WALK_ANIM_SPEED, c['walk_anim_speed_x0.001']);
  eq('CREATE_BUTTON_TRIG_TIME', D.CREATE_BUTTON_TRIG_TIME, c.CREATE_BUTTON_TRIG_TIME);
  check('walk_stop_percent', JSON.stringify(D.WALK_STOP_PERCENT) === JSON.stringify(c['walk_stop_percent(ThinkWalk)']));
  check('SHOT_PROBABILITY', JSON.stringify(D.SHOT_PROBABILITY) === JSON.stringify(c['SHOT_PROBABILITY[comLv][ballLv]']));
  check('스칼라', D.TRIGGER_COUNT_END_TIME === F(c.TRIGGER_COUNT_END_TIME) && D.CREATE_TRIGGER_COUNT === c.CREATE_TRIGGER_COUNT && D.OUT_FIELD_LENGE === F(c.OUT_FIELD_LENGE) && D.MOVE_GOAL_LIMIT === F(c.MOVE_GOAL_LIMIT) && D.WALK_SPEED === F(c.WalkSpeed) && D.PLAYER_GRAVITY === F(c.gravity) && D.FALL_R2 === F(c.fall_r2));
});

/* ───────── 3. 눈덩이 ───────── */
section('growth(level_ups·trace)', () => {
  const o = new FakeOwner();
  o.hand.updatePos({ pos: o.pos, dirZ: () => o.dirZ() });
  const b = new SnowBall(0, o);
  const ctx = ctxOf(new FlatGround());
  const ups: { frame: number; level: number; scale: number; radius: number }[] = [];
  const trace = new Map<number, { level: number; scale_bits: string; timer: number }>();
  for (let n = 1; n <= 500; n++) {
    o.pos = { x: F(o.pos.x + 0.001), y: 0, z: 0 };
    o.hand.updatePos({ pos: o.pos, dirZ: () => o.dirZ() });
    const lv = b.level;
    b.update(ctx);
    if (b.level !== lv) ups.push({ frame: n, level: b.level, scale: b.scale, radius: b.colRadius });
    trace.set(n, { level: b.level, scale_bits: hex(b.scale), timer: b.growTimer });
  }
  const exp = CALC.growth.level_ups;
  check('level_ups.frames', JSON.stringify(ups.map((u) => u.frame)) === JSON.stringify(exp.map((u: { frame: number }) => u.frame)), JSON.stringify(ups.map((u) => u.frame)));
  check('level_ups.scale/radius', ups.every((u, i) => u.scale === F(exp[i].scale) && u.radius === F(exp[i].radius)));
  for (const t of CALC.growth.trace) {
    const m = trace.get(t.frame)!;
    check(`trace ${t.frame}`, m.level === t.level && m.scale_bits === t.scale_bits && m.timer === F(t.timer), JSON.stringify(m));
  }
});

section('ball_pos_examples', () => {
  const o = new FakeOwner();
  o.hand.updatePos({ pos: o.pos, dirZ: () => o.dirZ() });
  const b = new SnowBall(0, o);
  const e0 = CALC.ball_pos_examples['lv0_face+Z'];
  check('lv0 hand', b.handPos.x === F(e0.hand[0]) && b.handPos.y === F(e0.hand[1]) && b.handPos.z === F(e0.hand[2]));
  check('lv0 ball', b.pos.x === F(e0.ball[0]) && b.pos.y === F(e0.ball[1]) && b.pos.z === F(e0.ball[2]), JSON.stringify(b.pos));
  const o7 = new FakeOwner();
  o7.pos = { x: 1, y: 0, z: 2 };
  const hand = new HandAnchor();
  const dz: V4 = { x: 1, y: 0, z: 0, w: 0 };
  hand.updatePos({ pos: o7.pos, dirZ: () => dz });
  b.scale = SIZE_SCALE[7];
  b.updatePosition(hand.getPos(), dz);
  const e7 = CALC.ball_pos_examples['lv7_face+X'];
  check('lv7 hand', hand.pos.x === F(e7.hand[0]) && hand.pos.z === F(e7.hand[2]));
  check('lv7 ball', b.pos.x === F(e7.ball[0]) && b.pos.y === F(e7.ball[1]) && b.pos.z === F(e7.ball[2]), JSON.stringify(b.pos));
});

function shotRun(d: V4, frames: number): { accelerating: boolean; vel: number[]; pos: number[] }[] {
  const o = new FakeOwner();
  o.hand.updatePos({ pos: o.pos, dirZ: () => o.dirZ() });
  const b = new SnowBall(0, o);
  const ctx = ctxOf(new FlatGround());
  b.pos = { x: 0, y: b.radius(), z: 0, w: 0 };
  b.appearStep = 2;
  b.shot(ctx, d, true);
  const out = [];
  for (let n = 1; n <= frames; n++) {
    b.update(ctx);
    out.push({ accelerating: b.accelerating, vel: [b.vel.x, b.vel.y, b.vel.z], pos: [b.pos.x, 0, b.pos.z] });
  }
  return out;
}

section('shot_throw_*·edge_fall_dir_x1.1', () => {
  const s = F(Math.sin(Math.PI / 6));
  const c = F(Math.cos(Math.PI / 6));
  const cases: [string, V4][] = [
    ['shot_throw_unit_dirZ_+Z', { x: 0, y: 0, z: 1, w: 0 }],
    ['shot_throw_unit_dir_30deg', { x: s, y: 0, z: c, w: 0 }],
    ['edge_fall_dir_x1.1', { x: F(1.1), y: 0, z: 0, w: 0 }],
  ];
  for (const [key, d] of cases) {
    const exp = CALC[key];
    const got = shotRun(d, exp.length);
    exp.forEach((e: { frame: number; accelerating: boolean; vel: number[]; pos: number[] }, i: number) => {
      const g = got[i];
      const ok = g.accelerating === e.accelerating && g.vel.every((v, j) => v === F(e.vel[j])) && g.pos.every((v, j) => v === F(e.pos[j]));
      check(`${key} frame ${e.frame}`, ok, `${JSON.stringify(g)} vs ${JSON.stringify(e)}`);
    });
  }
});

section('free_fall_to_delete', () => {
  for (const lv of [0, 3, 7]) {
    const o = new FakeOwner();
    o.hand.updatePos({ pos: o.pos, dirZ: () => o.dirZ() });
    const b = new SnowBall(0, o);
    const ctx = ctxOf(new NoGround());
    b.level = lv;
    b.scale = SIZE_SCALE[lv];
    b.pos = { x: 0, y: b.radius(), z: 0, w: 0 };
    b.state = 1;
    b.accelerating = false;
    b.appearStep = 2;
    let n = 0;
    while (b.state === 1 && n < 2000) {
      n++;
      b.update(ctx);
    }
    const e = CALC.free_fall_to_delete[`lv${lv}`];
    check(`lv${lv}`, n === e.frames && b.pos.y === F(e.y) && b.fall.y === F(e.fall_vy), `${n} ${b.pos.y} ${b.fall.y}`);
  }
});

section('ball_vs_ball(8×8)·size_sound_param', () => {
  for (const [k, e] of Object.entries(CALC.ball_vs_ball) as [string, { A_crash: boolean; B_crash: boolean }][]) {
    const [a, b] = k.split('v').map(Number);
    check(k, SnowBall.crashesOnHit(a, b) === e.A_crash && SnowBall.crashesOnHit(b, a) === e.B_crash);
  }
  for (let l = 0; l < 8; l++) check(`T lv${l}`, sizeSoundParam(SIZE_SCALE[l]) === CALC.size_sound_param[`lv${l}`], `${sizeSoundParam(SIZE_SCALE[l])}`);
});

section('ball_vs_ball 실제 트리거(게임 안 두 공 충돌)', () => {
  // 레벨 3 공과 레벨 0 공을 서로 굴려 부딪친다 → 3v0: A(3) 남음, B(0) 부서짐
  const g = new Hsmg402Game(setupOf([false, false, false, false]));
  const [p0, p1] = g.players;
  p0.createSnowBall();
  p1.createSnowBall();
  const A = p0.heldBall!;
  const B = p1.heldBall!;
  A.level = 3;
  A.scale = SIZE_SCALE[3];
  A.colRadius = F(1.1 * SIZE_SCALE[3]);
  A.pos = { x: -2, y: A.radius(), z: 0, w: 0 };
  B.pos = { x: 2, y: B.radius(), z: 0, w: 0 };
  A.shot(g, { x: 1, y: 0, z: 0, w: 0 }, true);
  B.shot(g, { x: -1, y: 0, z: 0, w: 0 }, true);
  for (let n = 0; n < 60 && B.state === 1; n++) g.step([null, null, null, null]);
  check('3v0: 큰 공(A) 남음', A.state === 1, `A.state=${A.state}`);
  check('3v0: 작은 공(B) 부서짐', B.state === 2 || B.state === -1, `B.state=${B.state}`);
});

/* ───────── 4. 플레이어 ───────── */
/** 시험용: 게임을 단계 9 까지 돌린다(전원 패드 없음) */
function toMain(g: Hsmg402Game): void {
  for (let n = 0; n < 2000 && g.stage !== 9; n++) g.step([null, null, null, null]);
}

function mashRun(interval: number, counted: boolean): { frame: number; ok: boolean; count: number } {
  const g = new Hsmg402Game(setupOf([false, false, false, false]), { cfg: { actorBeforePlayerUpdate: !counted } });
  toMain(g);
  const p = g.players[0];
  g.players.forEach((q, i) => {
    q.pos = { x: (i - 1.5) * 3, y: 0, z: 3 };
  });
  p.pos = { x: 0, y: 0, z: 0 };
  p.pad.overlay = true;
  for (let t = 1; t <= interval * 20 + 80; t++) {
    p.pad.overlayTrig = (t - 1) % interval === 0 ? PAD_B : 0;
    g.step([null, null, null, null]);
    if (p.heldBall) return { frame: t, ok: true, count: p.mashCount };
    if (t > 1 && p.action === 0) return { frame: t, ok: false, count: p.mashCount };
  }
  return { frame: -1, ok: false, count: p.mashCount };
}

section('mash(사람 연타, 첫 입력 셈/안 셈)', () => {
  for (const [key, counted] of [
    ['human_first_press_counted', true],
    ['human_first_press_not_counted', false],
  ] as const) {
    for (const e of PCALC.mash[key]) {
      const r = mashRun(e.interval, counted);
      const okExp = e.result === 'CreateSnowBall';
      check(`${key} interval ${e.interval}`, r.ok === okExp && r.frame === e.frame, `${JSON.stringify(r)} vs ${e.frame} ${e.result}`);
    }
  }
});

section('mash.com_gaps·com_create_frame(CPU B 간격)', () => {
  for (let lv = 0; lv < 4; lv++) {
    const g = new Hsmg402Game(setupOf([true, true, true, true], 7, [lv, lv, lv, lv]));
    toMain(g);
    const p = g.players[0];
    const c = p.com;
    c.level = lv;
    c.action = 2;
    c.phase = 2;
    c.timer = 0;
    c.target = -1;
    const presses: number[] = [];
    for (let t = 1; t < 120; t++) {
      c.update(g);
      if (p.pad.overlayTrig & PAD_B) presses.push(t);
    }
    const gaps = presses.slice(1, 6).map((f, i) => f - presses[i]);
    check(`lv${lv} gaps`, JSON.stringify(gaps) === JSON.stringify(PCALC.mash.com_gaps_frames[lv]), JSON.stringify(gaps));
    const e = PCALC.mash.com_create_frame[lv];
    const a = mashRun(e.gap, true);
    const b = mashRun(e.gap, false);
    check(`lv${lv} create counted/not`, a.frame === e.counted.frame && b.frame === e.not_counted.frame, `${a.frame}/${b.frame}`);
  }
});

section('walk_with_ball(MoveGroundEX 회전 상한)', () => {
  for (const e of PCALC.walk_with_ball) {
    const g = new Hsmg402Game(setupOf([false, false, false, false]));
    const p = g.players[0];
    p.pos = { x: 0, y: 0, z: 0 };
    p.createSnowBall();
    p.heldBall!.level = e.level;
    p.yaw = 0;
    p.walkSpeed = F(e.walk_speed);
    p.pad.overlay = true;
    const lr = (e.lever_deg * Math.PI) / 180;
    p.pad.setLStickNormalize(Math.sin(lr), -Math.cos(lr));
    const target = F(p.pad.leverDeg()!);
    // calc turn_sim 은 마지막 프레임(남은 각 <= 상한)의 상한 b 를 낸다
    let frames = 0;
    for (let t = 1; t <= 400; t++) {
      p.moveGroundEX(p.walkSpeed);
      if (Math.abs(F(p.yaw * 57.29578) - target) < 1e-3) {
        frames = t;
        break;
      }
    }
    const b = p.turnLimitDeg;
    check(`lv${e.level} lever ${e.lever_deg}`, frames === e.frames_to_face && b === F(e.turn_step_deg_per_frame), `frames ${frames} step ${b}`);
  }
});

section('knock_v0(SetDamage 초속 비트)', () => {
  for (const e of PCALC.knock_v0) {
    const d = normalize4({ x: 3, y: 0, z: 0, w: 0 });
    const v = Player.knockVelocity(d, F(68.5), e.level);
    check(`lv${e.level} src(+X) hex`, hex(v.x) === e.hex[0] && hex(v.y) === e.hex[1] && hex(v.z) === e.hex[2], `${hex(v.x)} ${hex(v.y)} ${hex(v.z)}`);
    const d2 = normalize4({ x: 2, y: 0, z: 3, w: 0 });
    const v2 = Player.knockVelocity(d2, F(68.5), e.level);
    check(`lv${e.level} src(2,0,3)`, v2.x === F(e['src(2,0,3)'][0]) && v2.y === F(e['src(2,0,3)'][1]) && v2.z === F(e['src(2,0,3)'][2]), `${v2.x} ${v2.y} ${v2.z}`);
  }
});

function knockSim(src: { x: number; y: number; z: number }, pos0: { x: number; y: number; z: number }, lv: number, ground: Ground) {
  const g = new Hsmg402Game(setupOf([false, false, false, false]));
  const p = g.players[0];
  p.pos = { ...pos0 };
  p.grounded = true;
  p.actionIdle(true);
  p.add = { x: 0, y: 0, z: 0, w: 0 };
  p.setDamage(src, lv);
  for (let t = 1; t <= 600; t++) {
    p.update();
    p.control();
    p.collideGround(ground);
    p.updateModel();
    p.postPhysics();
    if (Player.isOutside(p.posV4())) return { fall_frame: t, pos: [p.pos.x, p.pos.y, p.pos.z] };
    if (!p.knockActive) return { stop_frame: t, pos: [p.pos.x, p.pos.y, p.pos.z] };
  }
  return {};
}

section('knock_sim_*(지면 = 평면 원판 스텁, calc 와 같은 가정)', () => {
  const disc = new FlatDiscGround();
  PCALC['knock_sim_from_center(공이 +Z 쪽)'].forEach((e: { level: number; fall_frame: number | null; fall_pos?: number[]; stopped: { stop_frame: number; pos: number[] } | null }) => {
    const r = knockSim({ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 0 }, e.level, disc);
    if (e.stopped) check(`center lv${e.level} stop`, r.stop_frame === e.stopped.stop_frame && r.pos!.every((v, i) => near(v, e.stopped!.pos[i], 1e-4)), JSON.stringify(r));
    else check(`center lv${e.level} fall`, r.fall_frame === e.fall_frame && r.pos!.every((v, i) => near(v, e.fall_pos![i], 1e-4)), JSON.stringify(r));
  });
  PCALC['knock_sim_from_start_pos(-4.5,0,-4.5) 공이 원점 쪽'].forEach((e: { level: number; fall_frame: number; fall_pos: number[] }) => {
    const r = knockSim({ x: 0, y: 0, z: 0 }, { x: -4.5, y: 0, z: -4.5 }, e.level, disc);
    check(`start lv${e.level} fall`, r.fall_frame === e.fall_frame && r.pos!.every((v, i) => near(v, e.fall_pos[i], 1e-4)), JSON.stringify(r));
  });
});

section('fall_check·damage_side', () => {
  for (const [k, e] of Object.entries(PCALC.fall_check) as [string, boolean][]) {
    const p = JSON.parse(k) as number[];
    check(`fall ${k}`, Player.isOutside({ x: F(p[0]), y: F(p[1]), z: F(p[2]), w: 0 }) === e);
  }
  const cases: [string, V4][] = [
    ['facing+Z, src ahead', { x: 0, y: 0, z: 1, w: 0 }],
    ['facing+Z, src 89.9deg', { x: 1, y: 0, z: F(0.0017), w: 0 }],
    ['facing+Z, src behind', { x: 0, y: 0, z: -1, w: 0 }],
  ];
  for (const [k, d] of cases) {
    const g = new Hsmg402Game(setupOf([false, false, false, false]));
    const p = g.players[0];
    p.pos = { x: 0, y: 0, z: 0 };
    p.yaw = 0;
    p.actionIdle(true);
    p.setDamage({ x: d.x, y: 0, z: d.z }, 0);
    const exp = PCALC.damage_side[k][0] as string;
    check(k, (p.action === 0x16 ? 'EX6 front' : 'EX7 back') === exp, `action ${p.action.toString(16)}`);
  }
});

/* ───────── 5. CPU ───────── */
section('com_think_wait_rng(seed 0x1234, SearchRandMovePosition 소비 없이)', () => {
  const exp = PCALC['com_think_wait_rng(seed=0x1234)'];
  {
    const g = new Hsmg402Game(setupOf([true, true, true, true], 0x1234));
    const c = g.players[0].com;
    c.level = 0;
    c.outside = true;
    const got: string[] = [];
    for (let i = 0; i < 8; i++) {
      c.action = 0;
      const t = c.thinkWait(g);
      got.push(c.action === 2 ? 'create' : c.action === 1 ? 'walk' : t > 0 ? `wait${t.toFixed(1)}` : '?');
    }
    check('lv0_no_ball', JSON.stringify(got) === JSON.stringify(exp.lv0_no_ball.map((x: unknown[]) => x[0])), JSON.stringify(got));
  }
  {
    const g = new Hsmg402Game(setupOf([true, true, true, true], 0x1234));
    const p = g.players[0];
    p.createSnowBall();
    p.heldBall!.level = 3;
    const c = p.com;
    c.level = 1;
    c.outside = true;
    const got: string[] = [];
    for (let i = 0; i < 8; i++) {
      c.action = 0;
      const t = c.thinkWait(g);
      got.push(c.action === 3 ? 'shot' : c.action === 1 ? 'walk' : t > 0 ? `wait${t.toFixed(1)}` : '?');
    }
    check('lv1_ball3', JSON.stringify(got) === JSON.stringify(exp.lv1_ball3.map((x: unknown[]) => x[0])), JSON.stringify(got));
  }
});

section('com_rand_move(seed 0x1234, 기준 +X)', () => {
  const exp = PCALC['com_rand_move(seed=0x1234, self(0,0,0), base(+X))'];
  const run = (lv: number, self: { x: number; y: number; z: number }, big: boolean): { x: number; z: number }[] => {
    const g = new Hsmg402Game(setupOf([true, true, true, true], 0x1234));
    const p = g.players[0];
    p.pos = { ...self };
    if (big) {
      p.createSnowBall();
      p.heldBall!.scale = SIZE_SCALE[7];
    }
    p.com.level = lv;
    return Array.from({ length: 5 }, () => {
      const t = p.com.searchRandMovePosition(g, { x: 1, y: 0, z: 0, w: 0 });
      return { x: t.x, z: t.z };
    });
  };
  const a = run(1, { x: 0, y: 0, z: 0 }, false);
  exp.lv1.forEach((e: { target: number[] }, i: number) => check(`lv1 #${i}`, near(a[i].x, e.target[0], 2e-5) && near(a[i].z, e.target[1], 2e-5), JSON.stringify(a[i])));
  const b = run(3, { x: 5, y: 0, z: 0 }, true);
  exp['lv3_r1.1_self(5,0,0)'].forEach((e: { target: number[] }, i: number) => check(`lv3 #${i}`, near(b[i].x, e.target[0], 2e-5) && near(b[i].z, e.target[1], 2e-5), JSON.stringify(b[i])));
});

/* ───────── 6. 지면 경계(5.4·6.9 산술) ───────── */
section('지면 경계(손 공 지면 없음 ≈8.078, y<−0.5 ≈8.431, 탈락 y≤−1 ≈8.528)', () => {
  const g = new StageGround(true);
  const find = (pred: (r: number) => boolean): number => {
    for (let r = 7; r < 14; r += 0.0005) if (pred(r)) return r;
    return NaN;
  };
  const rNoGround = find((r) => !castRayDown(g, r, 0.44, 0, F(0.44 + 0.12)));
  const rHalf = find((r) => (g.at(r, 0)?.h ?? -99) < -0.5);
  const rOut = find((r) => (g.at(r, 0)?.h ?? -99) <= -1.0);
  const rFall = find((r) => {
    const h = g.at(r, 0)!.h;
    return r * r + h * h >= FALL_R2;
  });
  check('손 공 지면 없음', near(rNoGround, 8.078, 0.002), `${rNoGround}`);
  check('낙하 상태 |p|²≥67.24', near(rFall, 8.197, 0.002), `${rFall}`);
  check('낙하 상태 y<−0.5', near(rHalf, 8.431, 0.002), `${rHalf}`);
  check('탈락 y≤−1', near(rOut, 8.528, 0.002), `${rOut}`);
});

/* ───────── 7. 결정성·전원 CPU 한 판 ───────── */
function fullRun(seed: number, levels: number[], maxFrames = 20000): { frames: string[]; g: Hsmg402Game } {
  const g = new Hsmg402Game(setupOf([true, true, true, true], seed, levels));
  const frames: string[] = [];
  for (let f = 0; f < maxFrames && !g.done; f++) {
    g.step([null, null, null, null]);
    frames.push(JSON.stringify([g.state, g.events]));
  }
  return { frames, g };
}

section('결정성(같은 시드 두 번)', () => {
  const a = fullRun(12345, [0, 1, 2, 3]);
  const b = fullRun(12345, [0, 1, 2, 3]);
  let diff = -1;
  for (let i = 0; i < Math.min(a.frames.length, b.frames.length); i++)
    if (a.frames[i] !== b.frames[i]) {
      diff = i;
      break;
    }
  check('같음', diff < 0 && a.frames.length === b.frames.length, `프레임 ${diff}`);
  const c = fullRun(54321, [0, 1, 2, 3]);
  check('다른 시드는 다름', c.frames.join() !== a.frames.join());
});

section('전원 CPU 한 판(종료·순위)', () => {
  for (const [seed, lv] of [
    [1, [0, 0, 0, 0]],
    [2, [1, 1, 1, 1]],
    [3, [2, 2, 2, 2]],
    [4, [3, 3, 3, 3]],
    [5, [0, 1, 2, 3]],
  ] as [number, number[]][]) {
    const { g } = fullRun(seed, lv);
    const r = g.result;
    const ok = g.done && !!r && r.ranks.every((x) => x >= 0 && x <= 3) && (r.draw || r.ranks.includes(0));
    const balls = g.state.balls.filter((b) => b).length;
    console.log(`      seed ${seed} lv ${lv.join('')}: ${g.done ? `끝 ${r!.frames}f` : '안 끝남'} ranks ${JSON.stringify(r?.ranks)} fall ${JSON.stringify(r?.fallTimes.map((t) => +t.toFixed(2)))}${r?.draw ? ' 무승부' : ''}, 남은 공 ${balls}`);
    check(`seed ${seed}`, ok);
  }
});

console.log(`\n합계: ${pass} 통과, ${fail} 실패`);
if (fails.length) {
  console.log('\n실패 목록:');
  for (const f of fails.slice(0, 80)) console.log(`  - ${f}`);
}
process.exitCode = fail ? 1 : 0;
