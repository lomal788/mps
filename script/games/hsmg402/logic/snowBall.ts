/**
 * hsmg402::SnowBall(0x140 B) — docs/minigame/hsmg402.md 4.6·5.3·6.9~6.12 [판독].
 * state: 0 손(UpdateHandTransform @0x71000110a4), 1 굴러감(UpdateShotTransform @0x7100011e2c), 2 부서짐(UpdateCrash @0x71000123dc), −1 삭제 대기.
 * 공은 강체가 아니다. 위치는 이 코드가 적분하고 지면은 CastRay/CastShape(웹: ground.ts 해석식)만 본다.
 * 속도 vel 은 **프레임당 변위**다(플레이어는 초당).
 */
import {
  F,
  type V3,
  type V4,
  add4,
  laneSq,
  mulAdd4,
  normalize4,
  scale4,
  sub4,
} from '../../../core/fmath';
import type { BallStateId, Hsmg402Event, Quat } from '../state';
import {
  BREAK_FRAMES,
  DELETE_LIMIT_Y,
  DOWN_SPEED,
  DT,
  FLT_EPSILON,
  FLT_MIN,
  GROUND_RAY_MARGIN,
  MAX_LEVEL,
  MAX_MOVE_SPEED,
  MAX_SIZE,
  NORMAL_Y_LIMIT,
  SIZE_CHANGE_TIME,
  SIZE_SCALE,
  SOUND_DIV,
  SOUND_SUB,
  SPEED_SQ_LIMIT,
  tierOf,
} from './data';
import { castRayDown, type Ground } from './ground';
import type { HandAnchor } from './handAnchor';

/** 공이 읽는 던진이 쪽(Player 의 ComTransform·SnowHandPos) */
export interface BallOwner {
  readonly id: number;
  readonly index: number;
  readonly hand: HandAnchor;
  readonly pos: V3;
  dirZ(): V4;
}

export interface BallCtx {
  readonly ground: Ground;
  emit(e: Hsmg402Event): void;
}

/** HitSnowBallInfo(0x60 B, 메시지 0xB000/0xB001 인자) */
export interface HitSnowBallInfo {
  level: number;
  power: number;
  /** 공 엔티티 Translation(+0x10) = 모델 위치(+0x30) */
  pos: V3;
  slot: number;
}

const ONE_P_ONE = F(1.1);
const V4_ZERO = (): V4 => ({ x: 0, y: 0, z: 0, w: 0 });
const v3of = (v: V4): V3 => ({ x: v.x, y: v.y, z: v.z });

/** 소리 크기 L15(6.12): x = 1.1·scale − 0.44, q = x/0.66, IsNearlyEqual(x,1.1) 또는 q>1 → 127, 아니면 (int)(q·127) */
export function sizeSoundParam(scale: number): number {
  const r = F(MAX_SIZE * F(scale));
  let x = F(r + SOUND_SUB);
  if (Math.abs(x) < FLT_EPSILON) x = 0;
  let q = F(x / SOUND_DIV);
  if (Math.abs(q) < FLT_EPSILON) q = 0;
  if (Math.abs(F(x - MAX_SIZE)) < FLT_EPSILON || q > 1) return 127;
  return Math.trunc(F(q * F(127))) | 0;
}

export class SnowBall {
  /** +0x110 / +0x114 */
  state: BallStateId = 0;
  sub = 0;
  /** +0x10C */
  level = 0;
  /** 모델 스케일(x=y=z) */
  scale = SIZE_SCALE[0];
  /** 공 모델 위치(중심) */
  pos: V4 = V4_ZERO();
  /** +0xC0 손 위치(마지막) */
  handPos: V4 = V4_ZERO();
  /** +0xD0 이동/가속 벡터, +0xE0 속도(프레임당), +0xF0 낙하 벡터 */
  dir: V4 = V4_ZERO();
  vel: V4 = V4_ZERO();
  fall: V4 = V4_ZERO();
  /** +0x100 성장 타이머 / +0x104 가속 중 */
  growTimer = SIZE_CHANGE_TIME;
  accelerating = false;
  /** +0x70 직전 플레이어 위치(x, 0, z) */
  prevP: V4 = V4_ZERO();
  /** +0x118 출현 이펙트 단계 0→1→2 */
  appearStep = 0;
  /** +0x11C 낙하 플래그 */
  fallingOff = false;
  /** +0x11D MOVE(재생 중 tier, −1 없음) / +0x11E THROW / +0x11F FALL 이펙트 */
  moveFxTier = -1;
  throwFx = false;
  fallFx = false;
  /** 사운드: YKD_MOV / YKD_FIR_MOV 재생 중, +0x130 낙하음 1회 */
  movSe = false;
  firMovSe = false;
  fallSePlayed = false;
  /** +0x131 던진 공 */
  thrown = false;
  /** ComCollision 구(레이어 10): 반지름(레벨업 때만 다시 만든다)·켜짐 */
  colRadius = F(MAX_SIZE * SIZE_SCALE[0]);
  colEnabled = true;
  /** 풀이 매기는 생성 번호(웹 트리거 쌍 식별) */
  uid = 0;
  /** 충돌 구를 이번 프레임 다시 만들었음(트리거 재보고용) */
  colRecreated = false;
  /* 표현 */
  visible = true;
  breakVisible = false;
  breakFrame = 0;
  spinAxis: V3 = { x: 1, y: 0, z: 0 };
  spinAngle = 0;
  rot: Quat = { x: 0, y: 0, z: 0, w: 1 };

  /** SnowBall::Create @0x7100010544 — creatorId·SnowHandPos·던진이 ComTransform·Entity */
  constructor(
    readonly slot: number,
    readonly owner: BallOwner,
  ) {
    this.prevP = { x: owner.pos.x, y: 0, z: owner.pos.z, w: 0 };
    this.updatePosition(owner.hand.getPos(), owner.dirZ());
  }

  /** +0x108 creatorId */
  get ownerId(): number {
    return this.owner.id;
  }

  /** 모델 반지름 r = 1.1·scale.x */
  radius(): number {
    return F(MAX_SIZE * this.scale);
  }

  soundT(): number {
    return sizeSoundParam(this.scale);
  }

  info(): HitSnowBallInfo {
    return { level: this.level, power: this.soundT(), pos: v3of(this.pos), slot: this.slot };
  }

  private fx(ctx: BallCtx, owner: 'ball' | 'ballBreak', name: string, op: 'play' | 'stop'): void {
    ctx.emit({ k: 'fx', owner, index: this.slot, name, op, pos: v3of(this.pos) });
  }

  /** SnowBall::Update (틱, TickOrder 2) */
  update(ctx: BallCtx): void {
    this.colRecreated = false;
    this.spinAngle = 0;
    if (this.appearStep < 2) {
      this.appearStep++;
      if (this.appearStep === 1) this.fx(ctx, 'ball', 'SNOWBALL_APPEAR00', 'play');
    }
    switch (this.state) {
      case 0:
        this.updateHandTransform(ctx);
        break;
      case 1:
        this.updateShotTransform(ctx);
        break;
      case 2:
        this.updateCrash(ctx);
        break;
      default:
        break;
    }
    if (this.fallingOff && !this.fallFx && this.state !== -1) {
      this.fx(ctx, 'ball', 'SNOWBALL_FALL00', 'play');
      this.fallFx = true;
    }
  }

  /** UpdatePosition @0x7100010cdc: +0xC0 = hand; r = 1.1·scale.x; p = hand + (dz.x, 0, dz.z, dz.w)·r; p.y = r */
  updatePosition(hand: V4, dz: V4): void {
    this.handPos = { ...hand };
    const r = this.radius();
    this.pos = {
      x: F(hand.x + F(dz.x * r)),
      y: r,
      z: F(hand.z + F(dz.z * r)),
      w: F(hand.w + F(dz.w * r)),
    };
  }

  private stopMove(ctx: BallCtx): void {
    if (this.moveFxTier >= 0) {
      this.fx(ctx, 'ball', `SNOWBALL_MOVE0${this.moveFxTier}`, 'stop');
      this.moveFxTier = -1;
    }
    if (this.movSe) {
      ctx.emit({ k: 'seLoop', label: 'SQ_SE_HSMG402_YKD_MOV', ball: this.slot, op: 'stop', pos: v3of(this.pos), t: this.soundT() });
      this.movSe = false;
    }
  }

  private stopFirMov(ctx: BallCtx): void {
    if (this.firMovSe) {
      ctx.emit({ k: 'seLoop', label: 'SQ_SE_HSMG402_YKD_FIR_MOV', ball: this.slot, op: 'stop', pos: v3of(this.pos), t: this.soundT() });
      this.firMovSe = false;
    }
  }

  /** 굴림 회전(시각 전용, HsModel::Rotate): axis = normalize(cross(normalize(move), −Y)), angle = acos(dot(−Y, normalize(move − Y·r))) */
  private spin(move: V4, r: number): void {
    const len = Math.hypot(move.x, move.z);
    if (len < 1e-7) return;
    const mx = move.x / len;
    const mz = move.z / len;
    const axis = { x: -mz, y: 0, z: mx };
    const ang = Math.atan2(len, r);
    this.spinAxis = { x: F(axis.x), y: 0, z: F(axis.z) };
    this.spinAngle = F(ang);
    const s = Math.sin(ang / 2);
    const dq = { x: axis.x * s, y: 0, z: axis.z * s, w: Math.cos(ang / 2) };
    const q = this.rot;
    const nx = dq.w * q.x + dq.x * q.w + dq.y * q.z - dq.z * q.y;
    const ny = dq.w * q.y - dq.x * q.z + dq.y * q.w + dq.z * q.x;
    const nz = dq.w * q.z + dq.x * q.y - dq.y * q.x + dq.z * q.w;
    const nw = dq.w * q.w - dq.x * q.x - dq.y * q.y - dq.z * q.z;
    const n = Math.hypot(nx, ny, nz, nw) || 1;
    this.rot = { x: F(nx / n), y: F(ny / n), z: F(nz / n), w: F(nw / n) };
  }

  /** UpdateHandTransform @0x71000110a4 (state 0) */
  private updateHandTransform(ctx: BallCtx): void {
    const o = this.owner;
    this.dir = o.dirZ();
    const hand = o.hand.getPos();
    const m = sub4(hand, this.handPos);
    if (Math.sqrt(laneSq(m)) < FLT_EPSILON) {
      this.stopMove(ctx);
    } else {
      this.spin(m, this.radius());
      const P: V4 = { x: o.pos.x, y: 0, z: o.pos.z, w: 0 };
      if (Math.sqrt(laneSq(sub4(P, this.prevP))) >= FLT_EPSILON) {
        this.growTimer = F(this.growTimer - DT);
        if (this.level <= MAX_LEVEL - 1) {
          this.scale = F(F(F(SIZE_SCALE[this.level + 1] - SIZE_SCALE[this.level]) * DT) + this.scale);
          if (!(this.growTimer > 0)) {
            this.level++;
            this.scale = SIZE_SCALE[this.level];
            this.colRadius = F(ONE_P_ONE * SIZE_SCALE[this.level]);
            this.colRecreated = true;
            this.growTimer = F(1.0);
            if (this.level === MAX_LEVEL) this.fx(ctx, 'ball', 'SNOWBALL_MAX00', 'play');
          }
        }
      }
      this.prevP = P;
      this.updatePosition(hand, this.dir);
      const tier = tierOf(this.level);
      if (this.moveFxTier !== tier) {
        if (this.moveFxTier >= 0) this.fx(ctx, 'ball', `SNOWBALL_MOVE0${this.moveFxTier}`, 'stop');
        this.fx(ctx, 'ball', `SNOWBALL_MOVE0${tier}`, 'play');
        this.moveFxTier = tier;
      }
      ctx.emit({ k: 'seLoop', label: 'SQ_SE_HSMG402_YKD_MOV', ball: this.slot, op: this.movSe ? 'update' : 'start', pos: v3of(this.pos), t: this.soundT() });
      this.movSe = true;
    }
    // groundCheck
    const c = this.pos;
    const r = this.radius();
    if (!castRayDown(ctx.ground, c.x, c.y, c.z, F(r + GROUND_RAY_MARGIN))) {
      const nm = normalize4(m);
      const dir = nm.x === 0 && nm.y === 0 && nm.z === 0 && nm.w === 0 ? o.hand.getVecZ() : nm;
      this.dir = scale4(dir, ONE_P_ONE);
      this.accelerating = true;
      this.vel = V4_ZERO();
      this.stopMove(ctx);
      this.state = 1;
      this.sub = 0;
      this.fallingOff = true;
      this.playFallSe(ctx);
    }
  }

  /** Shot @0x71000129d0 */
  shot(ctx: BallCtx, d: V4, thrown: boolean): void {
    this.accelerating = true;
    this.dir = { ...d };
    this.vel = V4_ZERO();
    if (thrown) {
      this.fx(ctx, 'ball', `SNOWBALL_THROW0${tierOf(this.level)}`, 'play');
      this.throwFx = true;
      this.thrown = true;
    }
    this.stopMove(ctx);
    this.state = 1;
    this.sub = 0;
  }

  /** UpdateShotTransform @0x7100011e2c (state 1) */
  private updateShotTransform(ctx: BallCtx): void {
    if (this.accelerating) {
      this.vel = mulAdd4(this.dir, DT, this.vel);
      if (laneSq(this.vel) >= SPEED_SQ_LIMIT) {
        this.accelerating = false;
        this.dir = normalize4(this.dir);
        this.vel = scale4(this.dir, MAX_MOVE_SPEED);
      }
    }
    const pos = this.pos;
    const a = add4(pos, this.vel);
    const fy = F(this.fall.y + F(DT * DOWN_SPEED));
    const fallNew: V4 = { x: this.fall.x, y: fy, z: this.fall.z, w: this.fall.w };
    const b = add4(a, fallNew);
    const r = this.radius();
    const hit = ctx.ground.at(b.x, b.z);
    const dist = hit ? F(F(b.y - hit.h) * hit.ny) : 0;
    let np: V4;
    if (hit && dist <= r) {
      // CastShape 맞음: depth = | |hit − b| − r |, push = normal·depth (웹: 면까지 거리로 계산)
      const depth = F(Math.abs(F(dist - r)));
      const push: V4 = { x: F(hit.nx * depth), y: F(hit.ny * depth), z: F(hit.nz * depth), w: 0 };
      np = add4(b, push);
      fallNew.y = F(fy + push.y);
      if (!(Math.abs(fallNew.y) > FLT_MIN)) fallNew.y = 0;
      this.fall = fallNew;
      if (hit.ny < NORMAL_Y_LIMIT) this.fallingOff = true;
    } else {
      np = add4(a, this.fall);
      this.fall = fallNew;
      this.playFallSe(ctx);
      this.stopFirMov(ctx);
      this.thrown = false;
    }
    this.spin(sub4(np, pos), r);
    this.pos = np;
    // UpdateShotMoveSe: 땅 위의 던진 공만 굴림음 [추정: 조건]
    if (hit && dist <= r && this.thrown) {
      ctx.emit({ k: 'seLoop', label: 'SQ_SE_HSMG402_YKD_FIR_MOV', ball: this.slot, op: this.firMovSe ? 'update' : 'start', pos: v3of(this.pos), t: this.soundT() });
      this.firMovSe = true;
    }
    if (this.pos.y < DELETE_LIMIT_Y) {
      if (this.level === MAX_LEVEL) this.fx(ctx, 'ball', 'SNOWBALL_MAX00', 'stop');
      this.stopFirMov(ctx);
      this.state = -1;
      this.sub = 0;
    }
  }

  /** PlayFallSe: SQ_SE_HSMG402_YKD_FAL 1회(+0x130) */
  private playFallSe(ctx: BallCtx): void {
    if (this.fallSePlayed) return;
    this.fallSePlayed = true;
    ctx.emit({ k: 'seT', label: 'SQ_SE_HSMG402_YKD_FAL', pos: v3of(this.pos), t: this.soundT() });
  }

  /** Crash @0x71000130b8: state 2, 충돌 끔, MOVE/THROW 정지, FALL 표지면 PlayFxTrigger(FALL00)(재생/정지 [미확정 #17] — 이름대로 play), 이동음 정지 */
  crash(ctx: BallCtx): void {
    this.state = 2;
    this.sub = 0;
    this.colEnabled = false;
    this.stopMove(ctx);
    if (this.throwFx) {
      this.fx(ctx, 'ball', `SNOWBALL_THROW0${tierOf(this.level)}`, 'stop');
      this.throwFx = false;
    }
    if (this.fallFx) {
      this.fx(ctx, 'ball', 'SNOWBALL_FALL00', 'play');
      this.fallFx = false;
    }
    this.stopFirMov(ctx);
  }

  /** EventCrash @0x7100013308 = Crash + Play3D(SQ_SE_HSMG402_YKD_HIT_YKD) + L15 */
  eventCrash(ctx: BallCtx): void {
    this.crash(ctx);
    ctx.emit({ k: 'seT', label: 'SQ_SE_HSMG402_YKD_HIT_YKD', pos: v3of(this.pos), t: this.soundT() });
  }

  /** ResHand @0x7100013414: 이동 이펙트·소리 정지 후 state −1 */
  resHand(ctx: BallCtx): void {
    this.stopMove(ctx);
    this.state = -1;
    this.sub = 0;
  }

  /** UpdateCrash @0x71000123dc (state 2) */
  private updateCrash(ctx: BallCtx): void {
    if (this.sub === 0) {
      this.visible = false;
      if (this.level === MAX_LEVEL) this.fx(ctx, 'ball', 'SNOWBALL_MAX00', 'stop');
      ctx.emit({ k: 'fx', owner: 'ballBreak', index: this.slot, name: `SNOWBALL_BREAK0${tierOf(this.level)}`, op: 'play', pos: v3of(this.pos) });
      this.stopMove(ctx);
      this.stopFirMov(ctx);
      this.breakVisible = true;
      this.breakFrame = 0;
      this.sub = 1;
      return;
    }
    // 부속 1: break 애니(50f) 끝나면 −1 [미확정: IsFinishedAnim ±1]
    this.breakFrame = F(this.breakFrame + 1);
    if (this.breakFrame >= BREAK_FRAMES) {
      this.state = -1;
      this.sub = 0;
    }
  }

  /** HitMessage @0x7100013eb4 (0xB001 수신): 자기 level − 2 ≤ 상대 level 이면 Crash 참 */
  static crashesOnHit(selfLevel: number, otherLevel: number): boolean {
    return selfLevel - 2 <= otherLevel;
  }
}
