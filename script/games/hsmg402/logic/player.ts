/**
 * hsmg402::Player(0xE70 B, hs::ActorPlayer 상속) — 플레이어 로직은 이 클래스 하나가 관리한다.
 * docs/minigame/hsmg402.md 4.3·5.2·6.4~6.8, analysis/notes/hsmg402_player.md [판독].
 *
 * Update @0x7100006cb0(Player 모델 틱) → 액터 control 에서 행동 함수 ActionEX1~4·6~8 → PostPhysics @0x71000071dc.
 * ActionEX5(마무리)는 부르는 곳이 없어 옮기지 않는다(관측 동작 같음).
 */
import { F, type V3, type V4, acosf, cross4, dot4, laneSq, nnSinCos, normalize4, scale4, v3 } from '../../../core/fmath';
import { Actor, PAD_A, PAD_B } from './actor';
import {
  CREATE_TRIGGER_COUNT,
  DAMAGE_BLINK_FRAME,
  DAMAGE_MOVE_ANIM_FRAME,
  DAMAGE_VEC_DEG,
  DAMAGE_VEC_LEN,
  DAMAGE_VEC_RES,
  DEG,
  DT,
  FALL_R2,
  FALL_SLOW_FRAME,
  FALL_SLOW_SPEED,
  FALL_Y,
  MOTION,
  PLAYER_GRAVITY,
  PUSH_SHOT_FRAME,
  RAD,
  CAPSULE_R,
  SNOW_FALL_FX_DIST,
  TRIGGER_COUNT_END_TIME,
  WALK_ANIM_SCALE,
  WALK_ANIM_SPEED,
  WALK_SPEED,
  WALK_SPEED_FACTOR,
} from './data';
import { HandAnchor } from './handAnchor';
import { PlayerCom } from './cpu';
import { SnowBall, type BallOwner, type HitSnowBallInfo } from './snowBall';
import type { World } from './game';
import type { Quat } from '../state';

export class Player extends Actor implements BallOwner {
  /** +0x527 조작 허용 / +0xD68 갱신 허용 */
  ctrlEnabled = true;
  updateEnabled = true;
  /** +0xE69 COM 표지 설정됨 */
  private comFlagSet = false;
  /** +0xDE0 손에 든 공 */
  heldBall: SnowBall | null = null;
  /** +0xE00 / +0xE04 */
  mashCount = 0;
  mashTimer = 0;
  /** +0xE0C 걷다가 큰 공 모션으로 바꿨음 */
  bigWalk = false;
  /** +0xE0D / +0xE0E / +0xE10 */
  knockActive = false;
  knockSkipFirst = false;
  knockV0: V4 = { x: 0, y: 0, z: 0, w: 0 };
  /** +0xE34 / +0xE38 / +0xE3C / +0xE64 */
  knockDamp = DAMAGE_VEC_RES[0];
  knockGravity = PLAYER_GRAVITY;
  knockDeg = DAMAGE_VEC_DEG[0];
  knockStopFrame = F(22);
  /** +0xE4C 탈락 시각(0 = 생존) / +0xE58 순위 / +0xE68 IsFall */
  fallTime = 0;
  rank = 3;
  isFall = false;
  /** CharacterModel 깜빡임 남은 초(IsEndBlink = ≤ 0) [미확정 #11] */
  blink = 0;
  /** 표현: SetSystemScaleVec / FluidMaterialParamChange / 발·몸 재질 배율 0 */
  systemScale: V3 = v3(1, 1, 1);
  fluidParam: Quat = { x: 1, y: 1, z: 1, w: 1 };
  footMaterialOff = false;
  /** SnowHandPos */
  readonly hand = new HandAnchor();
  /** PlEvCol(레이어 11) 위치 — TickOrder 1 에서 플레이어를 따라간다 */
  evCol: V3 = v3();
  /** +0xE50 */
  readonly com: PlayerCom;
  /** MoveGroundEX 가 마지막에 쓴 한 프레임 회전 상한(도, 시험·디버그용) */
  turnLimitDeg = 0;

  constructor(
    /** 목록 인덱스(= GW_PLAYER_ID, 웹은 참가 순서) */
    readonly index: number,
    readonly char: string,
    readonly isCom: boolean,
    comLevel: number,
    private readonly world: World,
  ) {
    super();
    // Player::Init @0x71000054d0: SetGravity(e38 = −37), PlayerCom(GetComLevel(id))
    this.gravity = PLAYER_GRAVITY;
    this.com = new PlayerCom(this, comLevel);
    if (isCom) {
      this.pad.overlay = true;
      this.comFlagSet = true;
    }
  }

  /** +0x48C 플레이어 ID */
  get id(): number {
    return this.index;
  }

  /** SetEnable(b) @0x710000af08: +0x527·+0xD68·PlayerCom::Enable */
  setEnable(b: boolean): void {
    this.ctrlEnabled = b;
    this.updateEnabled = b;
    this.com.enable(b);
  }

  /** IsInvincible @0x710000b098 = 행동 ∈ {0x16,0x17} 또는 !IsEndBlink */
  isInvincible(): boolean {
    return (this.action & ~1) === 0x16 || this.blink > 0;
  }

  /** GetSnowBallLevel: 없으면 −1 */
  getSnowBallLevel(): number {
    return this.heldBall ? this.heldBall.level : -1;
  }

  /** GetSnowBallSize: 없으면 0, 있으면 IsSize(scale.x × 1.1) */
  getSnowBallSize(): number {
    return this.heldBall ? this.heldBall.radius() : 0;
  }

  private fxPlayer(name: string): void {
    this.world.emit({ k: 'fx', owner: 'player', index: this.index, name, op: 'play', pos: { ...this.pos } });
  }

  /** Player::Update @0x7100006cb0 */
  update(): void {
    // ActorPlayer::Update — CharacterModel 깜빡임 [추정: 초 단위 감소]
    if (this.blink > 0) this.blink = Math.max(0, F(this.blink - DT));
    if (!this.comFlagSet && this.isCom) {
      this.pad.overlay = true;
      this.comFlagSet = true;
    }
    if (this.heldBall && this.heldBall.state !== 0) {
      this.heldBall = null;
      this.walkSpeed = WALK_SPEED;
      this.resetRotParam();
      this.setAnimSpeed(1.0);
      this.resetRotParam();
    }
    if (this.knockActive) {
      this.gravity = this.knockGravity;
      const v = this.add;
      const k = F(this.knockDamp * DT);
      this.add = { x: F(v.x - F(v.x * k)), y: F(v.y - F(v.y * k)), z: F(v.z - F(v.z * k)), w: F(v.w - F(v.w * k)) };
    }
    if (this.action !== 0x18) {
      const p = this.posV4();
      if (!(laneSq(p) < FALL_R2 && p.y >= FALL_Y)) {
        this.isFall = true;
        this.actionEX8(true);
      }
    }
    if (this.updateEnabled) {
      if (this.isCom && !this.isFall) this.com.update(this.world);
      const t = this.pad.getTrig();
      if (this.action < 2 && t & PAD_B) this.actionEX1(true);
      if ((this.action === 0x12 || this.action === 0x13) && this.ctrlEnabled && this.pad.getTrig() & PAD_A) this.actionEX4(true);
    }
  }

  /** 행동 함수표: 0x11~0x18 = ActionEX1~8 */
  protected override runAction(): void {
    switch (this.action) {
      case 0x11:
        this.actionEX1(false);
        break;
      case 0x12:
        this.actionEX2(false);
        break;
      case 0x13:
        this.actionEX3(false);
        break;
      case 0x14:
        this.actionEX4(false);
        break;
      case 0x16:
        this.actionEX6(false);
        break;
      case 0x17:
        this.actionEX7(false);
        break;
      case 0x18:
        this.actionEX8(false);
        break;
      default:
        super.runAction();
    }
  }

  /** ActionEX1 @0x7100007378 — 만들기(B 연타) */
  actionEX1(enter: boolean): void {
    if (enter) {
      if (this.setActionID(0x11) === 5) this.setControl(0);
      this.resetAddVector();
      this.setMotion('sb_make00', 0);
      this.bigWalk = false;
      this.mashCount = 0;
      this.mashTimer = TRIGGER_COUNT_END_TIME;
      return;
    }
    if (this.ctrlEnabled && this.pad.getTrig() & PAD_B) {
      this.mashTimer = TRIGGER_COUNT_END_TIME;
      this.mashCount++;
    }
    if (this.mashCount < CREATE_TRIGGER_COUNT) {
      this.mashTimer = F(this.mashTimer - DT);
      if (this.mashTimer > 0) return;
      this.actionIdle(true);
      return;
    }
    this.createSnowBall();
    this.actionEX2(true);
  }

  /** CreateSnowBall @0x71000074a0: 빈 칸에 SnowBall::Create, FX VO_HSMG402_CMP_SB */
  createSnowBall(): void {
    const pool = this.world.pool;
    const slot = pool.freeSlot();
    if (slot < 0) {
      this.heldBall = null;
      return;
    }
    const b = new SnowBall(slot, this);
    pool.put(b);
    this.heldBall = b;
    this.fxPlayer('VO_HSMG402_CMP_SB');
  }

  /** ActionEX2 @0x7100007988 — 공 들고 대기 */
  actionEX2(enter: boolean): void {
    if (enter) {
      this.setActionID(0x12);
      this.resetAddVector();
      this.setMotion(this.heldBall && this.heldBall.level > 2 ? 'sb_idle01' : 'sb_idle00', 0);
      this.setAnimSpeed(1.0);
      return;
    }
    if (!this.heldBall) {
      this.actionIdle(true);
      return;
    }
    if (this.pad.leverDeg() !== null) this.actionEX3(true);
  }

  /** ActionEX3 @0x7100007bf4 — 공 들고 걷기 */
  actionEX3(enter: boolean): void {
    if (enter) {
      this.setActionID(0x13);
      this.resetAddVector();
      this.setMotion(this.heldBall && this.heldBall.level > 2 ? 'sb_walk01' : 'sb_walk00', 0);
      return;
    }
    if (!this.heldBall) {
      this.resetAddVector();
      this.actionIdle(true);
      return;
    }
    const lv = this.heldBall.level;
    this.walkSpeed = F(WALK_SPEED * WALK_SPEED_FACTOR[lv]);
    this.setAnimSpeed(F(WALK_ANIM_SPEED[lv] * WALK_ANIM_SCALE));
    if (this.pad.leverDeg() === null) {
      this.setLeverRotateY(F(this.yaw * DEG));
      this.actionEX2(true);
      return;
    }
    if (!this.bigWalk && lv > 2) {
      this.setMotion('sb_walk01', this.motion.frame);
      this.bigWalk = true;
    }
    this.moveGroundEX(this.walkSpeed);
  }

  /** MoveGroundEX @0x71000081b4 — 늘 정면으로 전진, 한 프레임 회전 상한 = acos(dot(F, normalize(F + R·ws·dt))) */
  moveGroundEX(s: number): void {
    const deg = this.pad.leverDeg();
    if (deg === null) {
      this.add.x = 0;
      this.add.z = 0;
      this.setLeverRotateY(this.yaw); // 원본 그대로: 라디안을 도 자리에 넣는다
      return;
    }
    const lr = F(deg * RAD);
    const L = normalize4({ x: F(Math.sin(lr)), y: 0, z: F(Math.cos(lr)), w: 0 });
    const Fw = this.dirZ();
    const a = acosf(dot4(L, Fw));
    const c = cross4(Fw, L);
    const A = laneSq(c) === 0 ? { x: 0, y: 1, z: 0, w: 0 } : normalize4(c);
    const aDeg = F(a * DEG);
    let R = this.dirX();
    if (A.y > 0) R = { x: F(0 - R.x), y: F(0 - R.y), z: F(0 - R.z), w: F(0 - R.w) };
    const k = F(this.walkSpeed * DT);
    const p: V4 = { x: F(F(R.x * k) + Fw.x), y: F(F(R.y * k) + Fw.y), z: F(F(R.z * k) + Fw.z), w: F(F(R.w * k) + Fw.w) };
    const b = F(acosf(dot4(Fw, normalize4(p))) * DEG);
    this.turnLimitDeg = b;
    let t = aDeg < b ? aDeg : b;
    if (A.y < 0) t = F(-t);
    this.setRotateY(F(F(t + F(this.yaw * DEG)) * RAD));
    const F2 = this.dirZ(); // setRotate 가 바로 반영된다고 본다 [미확정 #9]
    this.add.x = F(F2.x * s);
    this.add.z = F(F2.z * s);
  }

  /** ActionEX4 @0x7100008c78 — 던지기(sb_push00 프레임 ≥ 4.0 에 Shot) */
  actionEX4(enter: boolean): void {
    if (enter) {
      this.setActionID(0x14);
      this.setControl(0);
      this.resetAddVector();
      this.setMotion('sb_push00', 0);
      this.setAnimSpeed(1.0);
      this.resetRotParam();
      this.walkSpeed = WALK_SPEED;
      return;
    }
    if (this.phase === 0) {
      if (this.motion.frame >= PUSH_SHOT_FRAME) {
        if (this.heldBall) {
          this.heldBall.shot(this.world, this.dirZ(), true);
          this.setControl(1);
        } else this.actionIdle(true);
      }
    } else if (this.isMotionEnd()) this.actionIdle(true);
  }

  /** ActionEX6 @0x71000094fc(앞 피격, co_damage02) / ActionEX7 @0x710000992c(뒤 피격, co_damage03) */
  private actionDamage(enter: boolean, front: boolean, face?: V4): void {
    if (enter) {
      this.setActionID(front ? 0x16 : 0x17);
      this.setControl(0);
      this.setMotion(front ? 'co_damage02' : 'co_damage03', 0);
      this.setAnimSpeed(1.0);
      if (this.heldBall) this.heldBall.crash(this.world);
      if (face) this.setRotateY(F(Math.atan2(face.x, face.z)));
      return;
    }
    if (this.phase === 0 && this.motion.frame >= DAMAGE_BLINK_FRAME) {
      const len = MOTION[this.motion.name]?.len ?? 0;
      this.blink = F(F(len - this.motion.frame) / 60);
      this.setControl(1);
    }
    if (this.isMotionEnd()) {
      this.blink = 0; // SetEndBlink [미확정 #11]
      this.actionIdle(true);
    }
  }

  actionEX6(enter: boolean, toBall?: V4): void {
    this.actionDamage(enter, true, toBall);
  }

  actionEX7(enter: boolean): void {
    this.actionDamage(enter, false, this.knockV0);
  }

  /** ActionEX8 @0x7100009d50 — 낙하 */
  actionEX8(enter: boolean): void {
    const damaged = this.motion.name === 'co_damage02' || this.motion.name === 'co_damage03';
    if (enter) {
      this.setActionID(0x18);
      this.setControl(0);
      this.fxPlayer('VO_HSMG402_FALL');
      if (!damaged) {
        this.setMotion('co_wriggle00', 0);
        this.setAnimSpeed(1.0);
      }
      if (F(Math.sqrt(F(F(this.pos.x * this.pos.x) + F(this.pos.z * this.pos.z)))) <= SNOW_FALL_FX_DIST) this.fxPlayer('SNOW_FALL00');
      this.footMaterialOff = true;
    }
    if (this.phase === 0 && damaged && this.motion.frame >= FALL_SLOW_FRAME) {
      this.setAnimSpeed(FALL_SLOW_SPEED);
      this.setControl(1);
    }
  }

  /** SetDamage @0x710000a1cc */
  setDamage(src: V3, lv: number): void {
    if (this.action === 0x16 || this.action === 0x17) return;
    if (this.blink > 0) return;
    const p = this.pos;
    const d = normalize4({ x: F(src.x - p.x), y: 0, z: F(src.z - p.z), w: 0 });
    const v = Player.knockVelocity(d, this.knockDeg, lv);
    this.setAddVector(v);
    this.knockActive = true;
    this.knockSkipFirst = true;
    this.knockDamp = DAMAGE_VEC_RES[lv];
    this.knockDeg = DAMAGE_VEC_DEG[lv];
    this.knockStopFrame = DAMAGE_MOVE_ANIM_FRAME[lv];
    this.knockV0 = { ...v };
    const ang = F(acosf(dot4(d, this.dirZ())) * DEG);
    if (ang < 90) this.actionEX6(true, d);
    else this.actionEX7(true);
  }

  /**
   * 넉백 초속: A = normalize(cross(d, Y)), θ = deg·0.017453292, 성분별 sdk sin/cos(A·θ),
   * r = (cz·sy·sx − sz·cx, sz·sy·sx + cz·cx, cy·sx, 0), v = normalize(r)·DamageVecLen[lv] (오일러 근사 그대로)
   */
  static knockVelocity(d: V4, deg: number, lv: number): V4 {
    const axis = normalize4(cross4(d, { x: 0, y: 1, z: 0, w: 0 }));
    const th = F(deg * RAD);
    const [s0, c0] = nnSinCos(F(axis.x * th));
    const [s1, c1] = nnSinCos(F(axis.y * th));
    const [s2, c2] = nnSinCos(F(axis.z * th));
    const r: V4 = {
      x: F(F(-F(s2 * c0)) + F(F(c2 * s1) * s0)),
      y: F(F(c2 * c0) + F(F(s2 * s1) * s0)),
      z: F(0 + F(c1 * s0)),
      w: 0,
    };
    return scale4(normalize4(r), DAMAGE_VEC_LEN[lv]);
  }

  /** SnowBallHit @0x710000b278 (0xB000): SetDamage + SeMgr::EntryPlayerVsSnowBall(위치 = 나 + normalize(공 − 나)·캡슐 r) */
  snowBallHit(info: HitSnowBallInfo): void {
    this.setDamage(info.pos, info.level);
    const n = normalize4({ x: F(info.pos.x - this.pos.x), y: F(info.pos.y - this.pos.y), z: F(info.pos.z - this.pos.z), w: 0 });
    const at = { x: F(this.pos.x + F(n.x * CAPSULE_R)), y: F(this.pos.y + F(n.y * CAPSULE_R)), z: F(this.pos.z + F(n.z * CAPSULE_R)) };
    this.world.se.entryPlayerVsSnowBall(this.world, this.index, info.slot, info.power, at);
  }

  /** PostPhysics @0x71000071dc — 넉백 정지 판정(맞은 프레임은 건너뜀) */
  postPhysics(): void {
    if (
      this.knockActive &&
      !this.knockSkipFirst &&
      this.grounded &&
      (this.action === 0x16 || this.action === 0x17) &&
      this.motion.frame >= this.knockStopFrame
    ) {
      this.knockV0 = { x: 0, y: 0, z: 0, w: 0 };
      this.resetAddVector();
      this.knockActive = false;
    }
    this.knockSkipFirst = false;
  }

  /** SetUpFinishEvent @0x710000af30: 든 공 ResHand + EventCrash, 핸들 비움 */
  setUpFinishEvent(): void {
    const b = this.heldBall;
    if (!b) return;
    b.resHand(this.world);
    b.eventCrash(this.world);
    this.heldBall = null;
  }

  /** 낙하 판정만(시험용): !((x²+z²)+(y²+w²) < 67.24 && y ≥ −0.5) */
  static isOutside(p: V4): boolean {
    return !(laneSq(p) < FALL_R2 && p.y >= FALL_Y);
  }
}
