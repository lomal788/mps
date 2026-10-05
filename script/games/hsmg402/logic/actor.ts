/**
 * main hs::actor::Actor / ActorPad 중 hsmg402 가 쓰는 부분 — docs/minigame/hsmg402.md 4.4·4.5·6.6·6.7, analysis/notes/hsmg402_player.md 4.2·5·7.
 * 원본 Player 는 hs::ActorPlayer(→ Actor) 를 상속한다. 웹도 Player extends Actor 로 같은 단위를 둔다.
 *
 * 한 프레임(ActorManager 메시지 → main @0x71000e3dd8): controlPre → control(행동 함수 1회 → controlVec → 몸 회전) → 충돌 → controlPost → updateModel.
 * 판독 안 된 곳(웹 가정, 근거 수준은 줄마다):
 * - 몸 회전 RotActorY: 목표(Actor+0x1A0, 도)로 360°/s, 차 ≥ 85° 면 1100°/s [추정: 단위·보간 미판독 11.1 #9]
 * - 지면: 발 y ≤ 면 높이면 y = 면, 접지 [미확정 #4]. 최대 낙하 속도 −49 [추정 #10]
 * - 모션 프레임은 updateModel 에서 속도만큼 늘린다(60fps 클립). 행동 함수는 늘리기 전 값을 본다 [추정]
 */
import { F, type V3, type V4, v3 } from '../../../core/fmath';
import { NPAD, STICK_MAX, type PadInput } from '../../../core/pad';
import {
  DEG,
  DT,
  MOTION,
  RAD,
  ROT_FAST_DEG,
  ROT_SPEED,
  ROT_SPEED_FAST,
  STICK_DEADZONE,
  TERMINAL_VY,
  WALK_SPEED,
} from './data';
import type { Ground } from './ground';

/** ActorPad 비트(getTrig 재배치 뒤) */
export const PAD_B = 0x400;
export const PAD_A = 0x800;
/** ActorPad+0x24 버튼 마스크 */
const PAD_MASK = 0x003f1df0;

/** ActorPad (Actor+0x50) — 사람은 원시 패드, COM 은 오버레이(+0x11) */
export class ActorPad {
  /** +0x11 오버레이 모드(COM) */
  overlay = false;
  /** +0x2C 오버레이 트리거 */
  overlayTrig = 0;
  /** +0x88 / +0x8C 오버레이 스틱 */
  overlayX = 0;
  overlayY = 0;
  /** 사람: 이번 프레임 눌린 원시 비트(NPAD), 스틱(−1..1, 위 +) */
  rawDown = 0;
  stickX = 0;
  stickY = 0;

  /** 사람 패드 한 프레임(누른 순간 = 앞 프레임과 비교) */
  feed(p: PadInput | null, down: number): void {
    this.rawDown = p ? down : 0;
    this.stickX = p ? F(p.lx / STICK_MAX) : 0;
    this.stickY = p ? F(p.ly / STICK_MAX) : 0;
  }

  /** getTrig main @0x71000e023c: (raw&2)<<9 = 0x400(B), (raw&1)<<11 = 0x800(A). 오버레이면 +0x1C & +0x2C & +0x20 */
  getTrig(): number {
    if (this.overlay) return this.overlayTrig & 0x7fffffff & 0x7fffffff;
    const raw = this.rawDown & (NPAD.A | NPAD.B);
    return ((((raw & 2) << 9) | ((raw & 1) << 11)) & PAD_MASK) >>> 0;
  }

  /** (x, y) = 오버레이면 (+0x88, +0x8C) 아니면 GetStickLeft */
  stick(): [number, number] {
    return this.overlay ? [this.overlayX, this.overlayY] : [this.stickX, this.stickY];
  }

  /** SetLStickNormalize: 각 ±1 로 자름 */
  setLStickNormalize(x: number, y: number): void {
    this.overlayX = F(Math.max(-1, Math.min(1, x)));
    this.overlayY = F(Math.max(-1, Math.min(1, y)));
  }

  resetLStickData(): void {
    this.overlayX = 0;
    this.overlayY = 0;
  }

  addOverlayTrigger(bit: number): void {
    this.overlayTrig |= bit;
  }

  resetOverlayTrigger(): void {
    this.overlayTrig = 0;
  }

  /** ResetOverlay: 트리거·스틱 모두 [추정: 이름] */
  resetOverlay(): void {
    this.resetOverlayTrigger();
    this.resetLStickData();
  }

  /**
   * getPadActorDeg(base=0): len = sqrt(y·y + x·x) < 0.1 이면 레버 없음(null),
   * deg = atan2f(x, −y)·360/(2π) + base, (−180, 180] 로 감기. base = Actor+0x240 = 0 [추정 11.1 #7]
   */
  leverDeg(): number | null {
    const [x, y] = this.stick();
    const len = F(Math.sqrt(F(F(y * y) + F(x * x))));
    if (len < STICK_DEADZONE) return null;
    let deg = F(F(F(Math.atan2(x, -y)) * 360) / F(2 * Math.PI));
    if (deg > 180) deg = F(deg - 360);
    else if (deg < -180) deg = F(deg + 360);
    return deg;
  }
}

/** 모션 스택 한 칸(원본 MotionActorStack / SetAnimSpeed) */
export interface MotionState {
  name: string;
  frame: number;
  speed: number;
  next: string | null;
}

export class Actor {
  /** 모델 위치(발) */
  pos: V3 = v3();
  /** 몸 회전 yaw(라디안, ComTransform rot.y) */
  yaw = 0;
  /** Actor+0x1A0 목표 회전(도) */
  rotTarget = 0;
  /** Actor+0x1E0 추가 속도(초당) */
  add: V4 = { x: 0, y: 0, z: 0, w: 0 };
  /** Actor+0x280 걷기 속도 */
  walkSpeed = WALK_SPEED;
  /** Actor+0x2A4 중력 */
  gravity = F(-9.8);
  /** isGroundGeo(직전 충돌 결과) */
  grounded = false;
  /** Actor+0x17C 행동 ID / +0x180 진입 표지 / +0x184 부속 단계 */
  action = 0;
  actionEntered = false;
  phase = 0;
  /** Actor+0x2D8/+0x2DC/+0x2E0 회전 속도 */
  rotSpeed = ROT_SPEED;
  rotSpeedFast = ROT_SPEED_FAST;
  rotFastDeg = ROT_FAST_DEG;
  readonly pad = new ActorPad();
  motion: MotionState = { name: 'co_idle00', frame: 0, speed: 1, next: null };

  /* ── 변환 ── */

  /** ComTransform::CalculateDirectionZ = (sin yaw, 0, cos yaw) [추정: player calc 와 같은 근사] */
  dirZ(): V4 {
    return { x: F(Math.sin(this.yaw)), y: 0, z: F(Math.cos(this.yaw)), w: 0 };
  }

  /** CalculateDirectionX = (cos yaw, 0, −sin yaw) */
  dirX(): V4 {
    return { x: F(Math.cos(this.yaw)), y: 0, z: F(-Math.sin(this.yaw)), w: 0 };
  }

  posV4(): V4 {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, w: 0 };
  }

  /** setRotate(rot): Actor+0x1A0 도 rot.y·57.29578 로 덮는다 */
  setRotateY(yawRad: number): void {
    this.yaw = F(yawRad);
    this.rotTarget = F(this.yaw * DEG);
  }

  /** setLeverRotateY(도) — 목표 회전 */
  setLeverRotateY(deg: number): void {
    this.rotTarget = F(deg);
  }

  /* ── 행동 ── */

  /** Actor::SetActionID: 같은 ID 면 2, 바뀌면 5(부속 0, 진입 표지 1). 기본 ID<0x10 의 모션 검사는 쓰는 ID(0·1·3·0xF)가 다 등록돼 있어 생략 */
  setActionID(id: number): number {
    if (this.action === id) return 2;
    this.action = id;
    this.phase = 0;
    this.actionEntered = true;
    return 5;
  }

  setControl(n: number): void {
    this.phase = n;
  }

  resetAddVector(): void {
    this.add = { x: 0, y: 0, z: 0, w: 0 };
  }

  setAddVector(v: V4): void {
    this.add = { ...v };
  }

  /** ResetRotParam: 360 / 1100 / 85 */
  resetRotParam(): void {
    this.rotSpeed = ROT_SPEED;
    this.rotSpeedFast = ROT_SPEED_FAST;
    this.rotFastDeg = ROT_FAST_DEG;
  }

  /** MotionActorStack(name, 시작 프레임). next = 끝나면 이어 재생 */
  setMotion(name: string, start = 0, next: string | null = null): void {
    this.motion = { name, frame: F(start), speed: this.motion.speed, next };
  }

  /** SetAnimSpeed(0, s) */
  setAnimSpeed(s: number): void {
    this.motion.speed = F(s);
  }

  isMotionEnd(): boolean {
    const m = MOTION[this.motion.name];
    return !!m && !m.loop && this.motion.frame >= m.len;
  }

  /** ActionDefaultIdle main @0x71000f0494: 진입 add 0, co_idle00. 매 프레임 레버 → 걷기 */
  actionIdle(enter: boolean): void {
    if (enter) {
      this.setActionID(0);
      this.resetAddVector();
      this.setMotion('co_idle00');
      this.setAnimSpeed(1);
      return;
    }
    if (this.pad.leverDeg() !== null) this.actionWalk(true);
  }

  /** 기본 걷기 main @0x71000f066c: 진입 co_walk00. 레버 없으면 대기, 있으면 MoveGround(1, walkSpeed) */
  actionWalk(enter: boolean): void {
    if (enter) {
      this.setActionID(1);
      this.setMotion('co_walk00');
      this.setAnimSpeed(1);
      return;
    }
    const deg = this.pad.leverDeg();
    if (deg === null) {
      this.actionIdle(true);
      return;
    }
    this.moveGround(deg, this.walkSpeed);
  }

  /** MoveGround main @0x71000f3988: setLeverRotateY(deg), add.xz = (sin deg, cos deg)·s (스틱 크기 무관) */
  moveGround(deg: number, s: number): void {
    this.setLeverRotateY(deg);
    const r = F(deg * RAD);
    this.add.x = F(F(Math.sin(r)) * s);
    this.add.z = F(F(Math.cos(r)) * s);
  }

  /** Actor::ActionTurn: 목표 회전까지 돈 뒤 대기 [미확정: 모션·끝 조건] */
  actionTurn(enter: boolean): void {
    if (enter) {
      this.setActionID(3);
      this.resetAddVector();
      return;
    }
    if (Math.abs(wrapDeg(this.rotTarget - F(this.yaw * DEG))) < 1e-3) this.actionIdle(true);
  }

  /** ActorPlayer::ActionWin(true, 1): co_win01a → co_win01b */
  actionWin(enter: boolean): void {
    if (enter) {
      this.setActionID(0xf);
      this.resetAddVector();
      this.setMotion('co_win01a', 0, 'co_win01b');
      this.setAnimSpeed(1);
    }
  }

  /** 행동 함수표(controlAction main @0x71000e92e0). 파생이 0x11~ 를 덮는다 */
  protected runAction(): void {
    switch (this.action) {
      case 0:
        this.actionIdle(false);
        break;
      case 1:
        this.actionWalk(false);
        break;
      case 3:
        this.actionTurn(false);
        break;
      default:
        break;
    }
  }

  /** control(): 행동 함수 1회 → controlVec → 몸 회전 */
  control(): void {
    this.actionEntered = false;
    this.runAction();
    this.controlVec();
    this.rotActorY();
  }

  /** Actor::controlVec main @0x71000e95e0 (점프 없음, 보조 속도 0) */
  controlVec(): void {
    const a = this.add;
    if (this.grounded && a.y <= 0) a.y = F(DT * this.gravity);
    else {
      a.y = F(a.y + F(DT * this.gravity));
      if (a.y < TERMINAL_VY) a.y = TERMINAL_VY;
    }
    this.pos.x = F(F(a.x * DT) + this.pos.x);
    this.pos.y = F(F(a.y * DT) + this.pos.y);
    this.pos.z = F(F(a.z * DT) + this.pos.z);
  }

  /** RotActorY(getLeverRotateY) [추정: °/초] */
  rotActorY(): void {
    const cur = F(this.yaw * DEG);
    const diff = wrapDeg(this.rotTarget - cur);
    if (diff === 0) return;
    const sp = Math.abs(diff) >= this.rotFastDeg ? this.rotSpeedFast : this.rotSpeed;
    const step = F(sp * DT);
    const nd = Math.abs(diff) <= step ? this.rotTarget : F(cur + Math.sign(diff) * step);
    this.yaw = F(F(nd) * RAD);
  }

  /** 지면(collisionGroundGeo 대용): 발 y ≤ 면이면 y = 면 */
  collideGround(g: Ground): void {
    const hit = g.at(this.pos.x, this.pos.z);
    if (hit && this.pos.y <= hit.h) {
      this.pos.y = hit.h;
      this.grounded = true;
    } else this.grounded = false;
  }

  /** updateModel: 모션 프레임 진행 */
  updateModel(): void {
    const m = this.motion;
    const info = MOTION[m.name];
    m.frame = F(m.frame + m.speed);
    if (!info) return;
    if (m.frame >= info.len) {
      if (m.next) this.motion = { name: m.next, frame: 0, speed: m.speed, next: null };
      else if (info.loop) m.frame = F(m.frame - info.len);
    }
  }
}

/** (−180, 180] 로 감기 */
export function wrapDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  else if (x <= -180) x += 360;
  return F(x);
}
