/**
 * hsmg402::PlayerCom(0x5B0 B) — CPU. docs/minigame/hsmg402.md 4.7·6.13, analysis/notes/hsmg402_player.md 9 [판독].
 * 난수는 sync 엔진의 SyncRandMod/Range/RangeF 만 쓴다(소비 순서 6.13.7). 패드는 ActorPad 오버레이(+0x11)로 넣는다.
 *
 * 원본 그대로 두는 것(9.9): 위협 공 = IsDeleteWait(state −1) 공만, 던질 확률 r <= p, SearchFrontPlayer 의 탈락 미검사, 레벨 1 의 매 프레임 난수.
 * [미확정 #12] SearchSafeAreaMovePosition 식은 구조만 판독돼 웹은 목표를 바꾸지 않는다(SearchRandMovePosition 결과 유지).
 *              SearchRandMovePosition 의 회전 부호는 표준 Y 회전(x' = x cos + z sin, z' = −x sin + z cos)으로 둔다.
 */
import { F, type V4, acosf, add4, dot4, laneSq, nnSinCos, normalize4, scale4, sub4 } from '../../../core/fmath';
import { PAD_A, PAD_B } from './actor';
import {
  CREATE_BUTTON_TRIG_TIME,
  DEG,
  DT,
  FLT_MAX,
  FLT_MIN,
  MOVE_GOAL_LIMIT,
  OUT_FIELD_LENGE,
  SHOT_PROBABILITY,
  WALK_STOP_PERCENT,
} from './data';
import type { World } from './game';
import type { Player } from './player';

/** AtherPlayerState(0x60 B) */
interface OtherState {
  /** +0 ID */
  id: number;
  /** +0x10 위치 */
  pos: V4;
  /** +0x20 normalize(위치.xz) */
  dirFromOrigin: V4;
  /** +0x30 normalize(상대.xz − 나.xz) */
  dir: V4;
  /** +0x50 상대 원점 수평 거리 / +0x54 나와의 수평 거리 */
  originDist: number;
  dist: number;
  /** +0x5C 탈락(fallTime > 0) / +0x5D 무적 */
  out: boolean;
  invincible: boolean;
}

/** 위협 공 기록(+0x90 + i·0x40) */
interface ThreatBall {
  pos: V4;
  dir: V4;
  move: V4;
  level: number;
  dist: number;
  radius: number;
}

const ZERO4 = (): V4 => ({ x: 0, y: 0, z: 0, w: 0 });
const HALF_DEG_RAD = F(Math.PI / 360);

export class PlayerCom {
  /** +0x10 켜짐 */
  enabled = false;
  /** +0x50 이동 목표 / +0x60 직전 위치 */
  goal: V4 = ZERO4();
  prevPos: V4 = ZERO4();
  /** +0x70 / +0x74 */
  originDist = 0;
  outside = false;
  others: OtherState[] = [];
  threats: ThreatBall[] = [];
  /** +0x594 / +0x598 */
  timer = 0;
  target = -1;
  /** +0x5A0 행동(0 생각, 1 걷기, 2 만들기, 3 던지기) / +0x5A4 부속 */
  action = 0;
  phase = 0;

  constructor(
    private readonly p: Player,
    /** +0x5A8 COM 레벨 0~3 */
    public level: number,
  ) {}

  /** Enable(b) @0x710000bd24: ResetLStickData, +0x10 = b */
  enable(b: boolean): void {
    this.p.pad.resetLStickData();
    this.enabled = b;
  }

  /** SetLevel(GW_PLAYER_COM_LEVEL) */
  setLevel(lv: number): void {
    this.level = lv;
  }

  /** 8바이트 쓰기: 행동 + 부속 0 */
  private setAction(a: number): void {
    this.action = a;
    this.phase = 0;
  }

  /** PlayerCom::Update @0x710000c0c0 */
  update(w: World): void {
    if (!this.enabled) return;
    this.others = [];
    this.threats = [];
    const pos = this.p.posV4();
    const xz: V4 = { x: pos.x, y: 0, z: pos.z, w: pos.w };
    this.originDist = F(Math.sqrt(laneSq(xz)));
    this.outside = this.originDist >= OUT_FIELD_LENGE;
    this.thinkOtherPlayerState(w);
    this.thinkSnowBall(w);
    let done = false;
    switch (this.action) {
      case 0:
        done = this.thinkActionWait(w);
        break;
      case 1:
        if (this.phase === 0) this.thinkWalk(w);
        break;
      case 2:
        done = this.thinkActionCreateSnowBall(w);
        break;
      case 3:
        done = this.thinkActionShot();
        break;
      default:
        break;
    }
    if (done) this.setAction(0);
    this.prevPos = this.p.posV4();
  }

  /** ThinkOtherPlayerState @0x710000c354 */
  private thinkOtherPlayerState(w: World): void {
    const me = this.p.posV4();
    for (const o of w.players) {
      if (o === this.p) continue;
      const op = o.posV4();
      const flat: V4 = { x: op.x, y: 0, z: op.z, w: op.w };
      const rel: V4 = { x: F(op.x - me.x), y: 0, z: F(op.z - me.z), w: F(op.w - me.w) };
      this.others.push({
        id: o.id,
        pos: op,
        dirFromOrigin: normalize4(flat),
        dir: normalize4(rel),
        originDist: F(Math.sqrt(laneSq(flat))),
        dist: F(Math.sqrt(laneSq(rel))),
        out: o.fallTime > 0,
        invincible: o.isInvincible(),
      });
    }
  }

  /** ThinkSnowBall @0x710000c898: 다른 사람 공 중 IsDeleteWait 인 것만(원본 그대로) */
  private thinkSnowBall(w: World): void {
    const pool = w.pool;
    const me = this.p.posV4();
    for (let i = 0; i < pool.slots.length; i++) {
      if (!pool.idxValid(i) || pool.getCreaterId(i) === this.p.id) continue;
      if (!pool.isDeleteWait(i)) continue;
      const b = pool.slots[i]!;
      const bp: V4 = { x: b.pos.x, y: 0, z: b.pos.z, w: 0 };
      const toBall = normalize4(sub4(bp, { x: me.x, y: 0, z: me.z, w: 0 }));
      if (!pool.isGrowth(i) && acosf(dot4(toBall, b.dir)) < F(Math.PI / 2)) continue;
      if (this.threats.length >= 20) break;
      this.threats.push({
        pos: bp,
        dir: toBall,
        move: { ...b.dir },
        level: b.level,
        dist: F(Math.sqrt(laneSq(sub4(bp, { x: me.x, y: 0, z: me.z, w: 0 })))),
        radius: pool.getSize(i),
      });
    }
  }

  /** ThinkActionWait @0x710000cdb0 */
  private thinkActionWait(w: World): boolean {
    if (this.phase === 2) {
      this.timer = F(this.timer - DT);
      if (this.timer > 0) return false;
      this.phase = 1;
      return false;
    }
    if (this.phase === 1) {
      const t = this.thinkWait(w);
      this.timer = t;
      if (t <= 0) return false;
      this.phase = 2;
      return false;
    }
    if (this.phase === 0) {
      this.p.pad.resetOverlay();
      this.phase = 1;
    }
    return false;
  }

  /** 위협 공 중 "내 위치가 공 진행선에서 반지름 안"(|나−공|·sin(acos(dot(norm(나−공), 이동))) <= 반지름) */
  private dangerBalls(): number[] {
    const me = this.p.posV4();
    const out: number[] = [];
    this.threats.forEach((t, i) => {
      const d = sub4(me, t.pos);
      const sq = laneSq(d);
      const c = dot4(normalize4(d), t.move);
      const s = F(Math.sin(acosf(c)));
      if (F(F(Math.sqrt(sq)) * s) <= t.radius) out.push(i);
    });
    return out;
  }

  /** ThinkWait @0x710000d47c — 대기 시간(0 이면 행동을 정했음) */
  thinkWait(w: World): number {
    if (!this.outside) this.goal = this.searchRandMovePosition(w);
    else {
      const p = this.p.posV4();
      const n = normalize4({ x: F(0 - p.x), y: F(0 - p.y), z: F(0 - p.z), w: F(0 - p.w) });
      this.goal = { x: F(n.x + n.x), y: F(n.y + n.y), z: F(n.z + n.z), w: F(n.w + n.w) };
    }
    const rng = w.rng;
    const lv = this.level;
    const ballLv = this.p.getSnowBallLevel();
    if (ballLv !== -1) {
      const r = rng.mod(100);
      if (r <= SHOT_PROBABILITY[lv][ballLv]) {
        this.setAction(3);
        return 0;
      }
      if (lv === 2 || lv === 3) {
        // 위협 공이 있으면 SearchSafeAreaMovePosition [미확정 #12: 목표 유지]
        this.setAction(1);
        return 0;
      }
      if (lv === 1) {
        if (rng.mod(100) > 59) return F(0.3);
      } else if (lv === 0) {
        if (rng.mod(100) > 39) return F(0.4);
      } else return 0;
      this.setAction(1);
      return 0;
    }
    if (lv === 2 || lv === 3) {
      if (this.dangerBalls().length > 0) {
        this.setAction(1);
        return 0;
      }
      if (this.searchFrontPlayer(F(30), F(4.0)) === -1) this.setAction(2);
      else this.setAction(1);
      return 0;
    }
    if (lv === 1) {
      const r = rng.mod(100);
      if (r < 40) this.setAction(2);
      else if (r > 89) return F(0.3);
      else this.setAction(1);
      return 0;
    }
    if (lv === 0) {
      const r = rng.mod(100);
      if (r < 20) this.setAction(2);
      else if (r > 59) return F(0.4);
      else this.setAction(1);
      return 0;
    }
    return 0;
  }

  /**
   * SearchRandMovePosition @0x710000d874:
   * b = (다른 플레이어 쌍 중 acos(dot(−dir_i, dir_j)) 가 가장 큰 i 의) −dir_i (쌍이 없으면 −dir_0)
   * dist = SyncRandRangeF(1, 4), ang = SyncRandRange(0, 30) → Y 축 반각 (ang − 360)/2 쿼터니언으로 b 를 돌린 r
   * t = pos + r·dist, lim = comLv ≥ 2 ? 8 − 5·GetSnowBallSize() : 8, |t|(3차원) ≥ lim 이면 t = pos + (−r)·dist
   */
  searchRandMovePosition(w: World, baseOverride?: V4): V4 {
    let b: V4;
    if (baseOverride) b = baseOverride;
    else {
      const o = this.others;
      let best = -Infinity;
      let bi = 0;
      for (let i = 0; i < o.length; i++)
        for (let j = 0; j < o.length; j++) {
          if (i === j) continue;
          const a = acosf(dot4(scale4(o[i].dir, -1), o[j].dir));
          if (a > best) {
            best = a;
            bi = i;
          }
        }
      b = o.length ? scale4(o[bi].dir, -1) : { x: 0, y: 0, z: 1, w: 0 };
    }
    const dist = w.rng.rangeF(1.0, 4.0);
    const ang = w.rng.range(0, 30);
    const [sh, ch] = nnSinCos(F(F(ang - 360) * HALF_DEG_RAD));
    // q = (0, sh, 0, ch) 로 b 를 돌린다: x' = x(1−2sh²) + z·2sh·ch, z' = −x·2sh·ch + z(1−2sh²)
    const cosT = F(1 - F(2 * F(sh * sh)));
    const sinT = F(2 * F(sh * ch));
    const r: V4 = { x: F(F(b.x * cosT) + F(b.z * sinT)), y: b.y, z: F(F(-b.x * sinT) + F(b.z * cosT)), w: b.w };
    const pos = this.p.posV4();
    let t = add4(pos, scale4(r, dist));
    const lim = this.level >= 2 ? F(8.0 - F(5.0 * this.p.getSnowBallSize())) : F(8.0);
    if (F(Math.sqrt(laneSq(t))) >= lim) t = add4(pos, scale4(scale4(r, -1), dist));
    return t;
  }

  /** SearchFrontPlayer(ang, len) @0x710000de80: 정면과 상대 방향 각 ≤ ang && 거리 ≤ len 인 첫 상대(탈락 검사 없음), 없으면 −1 */
  searchFrontPlayer(ang: number, len: number): number {
    const f = this.p.dirZ();
    for (let i = 0; i < this.others.length; i++) {
      const a = F(acosf(dot4(f, this.others[i].dir)) * DEG);
      if (a <= ang && this.others[i].dist <= len) return i;
    }
    return -1;
  }

  /** IsTargetDirection(th) @0x710000f710: acos(dot(내 정면, 표적 +0x30))·57.29578 <= th */
  private isTargetDirection(th: number): boolean {
    const o = this.others[this.target];
    if (!o) return false;
    return F(acosf(dot4(o.dir, this.p.dirZ())) * DEG) <= th;
  }

  /** 살아 있는 상대 중 나와 가장 가까운(+0x54 최소, 없으면 0) */
  private nearest(): number {
    let best = FLT_MAX;
    let idx = 0;
    this.others.forEach((o, i) => {
      if (!o.out && o.dist < best) {
        best = o.dist;
        idx = i;
      }
    });
    return idx;
  }

  /** 살아 있는(무적 제외 선택) 상대 중 원점에서 가장 먼(+0x50 최대, 없으면 0) */
  private farthest(skipInvincible: boolean): number {
    let best = FLT_MIN;
    let idx = 0;
    this.others.forEach((o, i) => {
      if (!o.out && !(skipInvincible && o.invincible) && o.originDist > best) {
        best = o.originDist;
        idx = i;
      }
    });
    return idx;
  }

  /** ThinkActionCreateSnowBalll @0x710000ce74 */
  private thinkActionCreateSnowBall(w: World): boolean {
    const pad = this.p.pad;
    if (this.phase === 2) {
      if (this.p.getSnowBallLevel() > -1) this.setAction(0);
      this.timer = F(this.timer - DT);
      if (this.timer <= 0) {
        pad.addOverlayTrigger(PAD_B);
        this.timer = CREATE_BUTTON_TRIG_TIME[this.level];
      } else pad.resetOverlayTrigger();
      return this.target !== -1 && !!this.others[this.target]?.out;
    }
    if (this.phase !== 1) {
      if (this.phase !== 0) return false;
      this.timer = 0;
      this.phase = 1;
    }
    if (this.level === 1 && w.rng.mod(100) < 30) this.phase = 2;
    this.target = this.level < 3 ? this.nearest() : this.level === 3 ? this.farthest(true) : this.farthest(false);
    if (!this.isTargetDirection(F(0.2))) {
      const o = this.others[this.target];
      if (o) pad.setLStickNormalize(o.dir.x, F(-o.dir.z));
      return false;
    }
    pad.setLStickNormalize(0, 0);
    this.phase = 2;
    return false;
  }

  /** ThinkActionShot @0x710000d154 */
  private thinkActionShot(): boolean {
    const pad = this.p.pad;
    if (this.phase === 1) {
      if (this.target === -1) {
        pad.addOverlayTrigger(PAD_A);
        this.setAction(0);
      } else if (this.others[this.target]?.out) {
        this.phase = 0;
      } else {
        const o = this.others[this.target];
        this.goal = { ...o.pos };
        if (this.isTargetDirection(F(0.2))) {
          pad.addOverlayTrigger(PAD_A);
          this.setAction(0);
          pad.resetLStickData();
          return false;
        }
        const me = this.p.posV4();
        const n = normalize4({ x: F(o.pos.x - me.x), y: 0, z: F(o.pos.z - me.z), w: F(o.pos.w - me.w) });
        pad.setLStickNormalize(n.x, F(-n.z));
      }
    } else if (this.phase === 0) {
      this.target = this.level < 1 ? this.nearest() : this.level !== 3 ? this.farthest(false) : this.farthest(true);
      this.phase = 1;
    }
    if (this.p.getSnowBallLevel() !== -1) return false;
    pad.resetLStickData();
    return true;
  }

  /** ThinkWalk @0x710000f410 */
  private thinkWalk(w: World): void {
    const pos = this.p.posV4();
    const to: V4 = { x: F(this.goal.x - pos.x), y: 0, z: F(this.goal.z - pos.z), w: F(this.goal.w - pos.w) };
    const end = (): void => {
      this.setAction(0);
      this.p.pad.resetLStickData();
    };
    if (laneSq(to) <= F(MOVE_GOAL_LIMIT * MOVE_GOAL_LIMIT)) return end();
    const dir = normalize4(to);
    const prevDir = normalize4({ x: F(this.goal.x - this.prevPos.x), y: 0, z: F(this.goal.z - this.prevPos.z), w: F(this.goal.w - this.prevPos.w) });
    if (F(acosf(dot4(dir, prevDir)) * DEG) >= 179) return end();
    const lv = this.p.getSnowBallLevel();
    if (lv !== -1) {
      const r = w.rng.range(1, 101);
      if (r <= WALK_STOP_PERCENT[lv]) return end();
    }
    if (this.searchFrontPlayer(F(2), F(2.0)) !== -1) return end();
    this.p.pad.setLStickNormalize(dir.x, F(-dir.z));
  }
}
