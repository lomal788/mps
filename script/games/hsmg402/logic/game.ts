/**
 * hsmg402::SceneHsmg402 훅 + main hs::SceneMiniGameBase::MainLoop 일부 — docs/minigame/hsmg402.md 3·9.4·9.5.
 * 흐름은 파이버가 아니라 장면 Update 에서 한 프레임 한 걸음(단계 바뀌면 부속 0). 결정적, DOM 없음.
 *
 * 한 스텝 순서(원본 엔티티 순서는 [미확정 11.1 #1] — 설정으로 바꿀 수 있다):
 *   1. 각 Player.update()                         (설정 actorBeforePlayerUpdate 면 2 와 순서를 바꾼다)
 *   2. ActorManager: 전 액터 control(행동 → controlVec → 회전) → 지면·밀어내기 → updateModel
 *   3. TickOrder 1: PlEvCol 위치, SnowHandPos.UpdatePos
 *   4. TickOrder 2: 장면 Update(흐름 단계, 단계 9 면 GameMgr.update)
 *   5. TickOrder 2: 공 슬롯 순서대로 SnowBall.update
 *   6. 트리거(공 구 ↔ PlEvCol·공): 새로 겹친 쌍만 0x1B → 0xB000/0xB001
 *   7. PostPhysics(메시지 5): SeMgr.reset, 각 Player.postPhysics
 * main 흐름의 페이드·카운트다운·라운드 처리(단계 4·7·10~12)는 판독 밖이라 설정의 프레임 수로 기다린다.
 */
import { F, type V3 } from '../../../core/fmath';
import { Pads, type PadInput } from '../../../core/pad';
import { MpsRand, type BexRand } from '../../../core/rng';
import { readOptions, type GameLogic, type GameSetup, type SoundSnapshot } from '../../../game';
import type { BallView, Hsmg402Event, Hsmg402Result, Hsmg402State, PlayerView } from '../state';
import { CAM_OP_FRAMES, DEFAULT_CONFIG, HSMG402_OPTIONS, type Hsmg402Config } from './data';
import { GameMgr } from './gameMgr';
import { StageGround, type Ground } from './ground';
import { Player } from './player';
import { SeMgr, type SeSink } from './seMgr';
import { SnowBall, type BallCtx, type HitSnowBallInfo } from './snowBall';
import { SnowBallPool } from './snowBallPool';

/** 로직 객체가 서로 보는 세계 */
export interface World extends BallCtx, SeSink {
  readonly cfg: Hsmg402Config;
  readonly ground: Ground;
  /** sync 난수(PlayerCom 만 쓴다) */
  readonly rng: BexRand;
  readonly pool: SnowBallPool;
  readonly players: Player[];
  readonly se: SeMgr;
}

/** 시험용 덮어쓰기 */
export interface GameOverrides {
  cfg?: Partial<Hsmg402Config>;
  ground?: Ground;
}

interface Trigger {
  ball: SnowBall;
  player?: Player;
  other?: SnowBall;
}

const cloneV3 = (v: V3): V3 => ({ x: v.x, y: v.y, z: v.z });

export class Hsmg402Game implements GameLogic<Hsmg402State, Hsmg402Event, Hsmg402Result>, World {
  readonly cfg: Hsmg402Config;
  readonly ground: Ground;
  readonly rand: MpsRand;
  readonly pool = new SnowBallPool();
  readonly players: Player[] = [];
  readonly se = new SeMgr();
  readonly mgr: GameMgr;
  private readonly pads = new Pads();
  private readonly ev: Hsmg402Event[] = [];
  private prevPairs = new Set<string>();

  frame = 0;
  /** MainLoop +0x2D8 단계 / +0x2DC main 부속 / Scene+0x444 훅 부속 / 단계 안 프레임 */
  stage = 0;
  mainSub = 0;
  hookSub = 0;
  stageFrame = 0;
  /** PlayerCtrlStart(단계 8) ~ PlayerCtrlEnd(단계 9 끝) */
  ctrlWindow = false;
  camera: { anim: 'cam_op' | 'cam' | null; frame: number; playing: boolean; speed: number } = { anim: null, frame: 0, playing: false, speed: 1 };
  private finished = false;
  private res: Hsmg402Result | null = null;
  private st: Hsmg402State;

  constructor(
    setup: GameSetup,
    ov: GameOverrides = {},
  ) {
    const opt = readOptions(HSMG402_OPTIONS, setup.options);
    this.cfg = { ...DEFAULT_CONFIG, ...ov.cfg };
    this.ground = ov.ground ?? new StageGround(this.cfg.ground48);
    this.rand = new MpsRand(setup.seed >>> 0);
    // OnSetupGame: GameMgr(SnowBallMgr·UITimer 60) … / OnSyncSetup: 플레이어 생성·배치, 서로 등록, 가이드
    this.mgr = new GameMgr(this);
    setup.players.forEach((ps, i) => {
      const lv = opt.comLevel === 'setup' ? ps.comLevel : Number(opt.comLevel);
      const p = new Player(i, ps.char, ps.isCom, Math.max(0, Math.min(3, lv | 0)), this);
      this.players.push(p);
      this.mgr.entryPlayer(p, i); // GetMGEntryPlayer 값의 뜻 [미확정 #5] — 웹은 참가 순서 = cha_pos 번호
    });
    for (const p of this.players) {
      p.hand.updatePos(p);
      p.evCol = cloneV3(p.pos);
    }
    this.mgr.createGuide();
    this.st = this.buildState();
  }

  get rng(): BexRand {
    return this.rand.sync;
  }

  get state(): Hsmg402State {
    return this.st;
  }

  get events(): readonly Hsmg402Event[] {
    return this.ev;
  }

  get done(): boolean {
    return this.finished;
  }

  get result(): Hsmg402Result | null {
    return this.res;
  }

  emit(e: Hsmg402Event): void {
    this.ev.push(e);
  }

  emitSe(label: string, pos: V3, t: number): void {
    this.ev.push({ k: 'seT', label, pos: cloneV3(pos), t });
  }

  step(pads: readonly (PadInput | null | undefined)[], _sound?: SoundSnapshot | null): void {
    this.ev.length = 0;
    if (this.finished) return;
    this.frame++;
    this.pads.read(pads);
    const gate = this.cfg.gateHumanPad && !this.ctrlWindow;
    this.players.forEach((p, i) => {
      if (p.isCom) return;
      const src = gate ? null : (pads[i] ?? null);
      p.pad.feed(src ? this.pads.now[i] : null, gate ? 0 : this.pads.down[i]);
    });
    if (this.cfg.actorBeforePlayerUpdate) {
      this.actorTick();
      for (const p of this.players) p.update();
    } else {
      for (const p of this.players) p.update();
      this.actorTick();
    }
    for (const p of this.players) {
      p.evCol = cloneV3(p.pos);
      p.hand.updatePos(p);
    }
    this.flowStep();
    for (const b of this.pool.slots) b?.update(this);
    this.triggers();
    this.se.reset();
    for (const p of this.players) p.postPhysics();
    if (this.camera.playing) this.camera.frame = F(this.camera.frame + this.camera.speed);
    this.st = this.buildState();
  }

  /** ActorManager 메시지(main @0x71000e3dd8): 전 액터 control → 충돌 → updateModel */
  actorTick(): void {
    for (const p of this.players) p.control();
    for (const p of this.players) p.collideGround(this.ground);
    if (this.cfg.actorPush) this.pushActors();
    for (const p of this.players) p.updateModel();
  }

  /** 플레이어끼리 수평 밀어내기(collisionActorHorizontal 미판독) [추정: 본체 캡슐 r 0.5 대칭 분리] */
  private pushActors(): void {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i].pos;
        const b = ps[j].pos;
        if (Math.abs(a.y - b.y) >= 1.5) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = 1.0;
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const nz = d > 1e-6 ? dz / d : 0;
        const h = (min - d) / 2;
        a.x = F(a.x - nx * h);
        a.z = F(a.z - nz * h);
        b.x = F(b.x + nx * h);
        b.z = F(b.z + nz * h);
      }
  }

  private playCamera(anim: 'cam_op' | 'cam', speed: number): void {
    this.camera = { anim, frame: 0, playing: true, speed };
    this.emit({ k: 'camera', op: 'play', anim, speed });
  }

  /* ── 장면 훅(SceneHsmg402) ── */

  /** OnGameInit @0x7100016518: 착지 대기 → cam_op 재생 → 다음 프레임 정지 */
  private onGameInit(): boolean {
    if (this.hookSub === 0) {
      for (const p of this.players) {
        if (p.pos.y > 0) return false;
        p.systemScale = { x: 1, y: 1, z: 1 };
        p.fluidParam = { x: 1, y: 1, z: 1, w: 1 };
      }
      this.playCamera('cam_op', 1.0);
      this.hookSub = 1;
      return false;
    }
    this.camera.playing = false;
    this.emit({ k: 'camera', op: 'stop', anim: 'cam_op', speed: 0 });
    this.hookSub = 0;
    return true;
  }

  /** OnGameOpening @0x71000165fc: cam_op 끝까지 → cam(속도 0) */
  private onGameOpening(): boolean {
    if (this.hookSub === 0) {
      this.playCamera('cam_op', 1.0);
      this.hookSub = 1;
      return false;
    }
    if (this.camera.frame >= CAM_OP_FRAMES) {
      this.playCamera('cam', 0.0);
      this.hookSub = 0;
      return true;
    }
    return false;
  }

  /** 흐름 한 걸음(MainLoop, 단계 처리기 표 @0x71014a78e8) */
  private flowStep(): void {
    const c = this.cfg;
    let next = this.stage;
    if (this.mgr.timer.state === 1 && this.stage >= 7 && this.stage <= 9 && (this.stage !== 9 || c.timerTickBeforeMgr)) this.mgr.timer.update();
    switch (this.stage) {
      case 0:
        if (this.onGameInit()) next = 4;
        break;
      case 4:
        if (this.stageFrame + 1 >= c.firstFadeFrames) next = 5;
        break;
      case 5:
        if (this.onGameOpening()) next = 6;
        break;
      case 6:
        next = 7; // OnGameStartBefore: 오프닝 스킵이 아니면 참
        break;
      case 7:
        if (this.stageFrame === 0 && c.timerStartAt === 'enter') this.startTimer();
        if (this.stageFrame + 1 >= c.countdownFrames) {
          if (c.timerStartAt === 'leave') this.startTimer();
          next = 8;
        }
        break;
      case 8:
        this.mgr.start(); // OnGameStartAfter → main PlayerCtrlStart
        this.ctrlWindow = true;
        next = 9;
        break;
      case 9:
        if (this.mgr.update()) {
          this.mgr.resultPreparation();
          this.ctrlWindow = false; // PlayerCtrlEnd(1.0)
          next = 10;
        }
        if (this.stage === 9 && !c.timerTickBeforeMgr && this.mgr.timer.state === 1) this.mgr.timer.update();
        break;
      case 10:
        if (this.stageFrame + 1 >= c.mainEndFrames) next = 12;
        break;
      case 12:
        next = 13;
        break;
      case 13:
        next = 14;
        break;
      case 14:
        if (this.mgr.result()) next = 15;
        break;
      default:
        break;
    }
    if (next !== this.stage) {
      this.stage = next;
      this.mainSub = 0;
      this.stageFrame = 0;
      this.emit({ k: 'stage', stage: next });
      if (next === c.guideInStage) this.mgr.guideIn();
      if (next === 15) this.finish();
    } else this.stageFrame++;
  }

  private startTimer(): void {
    this.mgr.timer.startTimer();
    this.emit({ k: 'timer', op: 'start' });
  }

  private finish(): void {
    this.finished = true;
    this.res = {
      quit: false,
      ranks: this.players.map((p) => p.rank),
      frames: this.frame,
      fallTimes: this.players.map((p) => p.fallTime),
      draw: this.mgr.draw,
    };
  }

  /* ── 트리거(0x1B) ── */

  private overlapPlayer(b: SnowBall, p: Player): boolean {
    const c = b.pos;
    const cy = p.evCol.y + this.cfg.plEvColCenterY;
    const h = this.cfg.plEvColHalf;
    const dy = Math.max(-h, Math.min(h, c.y - cy));
    const d = Math.hypot(c.x - p.evCol.x, c.y - (cy + dy), c.z - p.evCol.z);
    return d < this.cfg.plEvColR + b.colRadius;
  }

  private triggers(): void {
    const balls = this.pool.slots.filter((b): b is SnowBall => !!b && b.colEnabled && (b.state === 0 || b.state === 1));
    const now = new Set<string>();
    const evs: Trigger[] = [];
    if (this.cfg.retriggerOnRecreate)
      for (const b of balls) if (b.colRecreated) for (const k of [...this.prevPairs]) if (k.split('|').includes(`b${b.uid}`)) this.prevPairs.delete(k);
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      for (const p of this.players) {
        if (!this.overlapPlayer(b, p)) continue;
        const k = `b${b.uid}|p${p.index}`;
        now.add(k);
        if (!this.prevPairs.has(k)) evs.push({ ball: b, player: p });
      }
      for (let j = i + 1; j < balls.length; j++) {
        const o = balls[j];
        const d = Math.hypot(b.pos.x - o.pos.x, b.pos.y - o.pos.y, b.pos.z - o.pos.z);
        if (d >= b.colRadius + o.colRadius) continue;
        const k = `b${b.uid}|b${o.uid}`;
        now.add(k);
        if (!this.prevPairs.has(k)) evs.push({ ball: b, other: o });
      }
    }
    this.prevPairs = now;
    for (const t of evs) {
      if (t.player) {
        // HitMessageTrig: 던진이 자신은 무시, 그 밖은 0xB000 후 자기 Crash
        if (t.player === t.ball.owner) continue;
        t.player.snowBallHit(t.ball.info());
        t.ball.crash(this);
      } else if (t.other) {
        const a = t.ball;
        const b = t.other;
        const ia = a.info();
        const ib = b.info();
        this.hitMessage(b, ia);
        this.hitMessage(a, ib);
      }
    }
  }

  /** SnowBall::HitMessage @0x7100013eb4 (0xB001): 자기 level − 2 ≤ 상대 level 이면 Crash + SeMgr::EntrySnowBallVsSnowBall */
  private hitMessage(self: SnowBall, from: HitSnowBallInfo): void {
    if (!SnowBall.crashesOnHit(self.level, from.level)) return;
    self.crash(this);
    this.se.entrySnowBallVsSnowBall(this, self.slot, from.slot, from.power, self.pos);
  }

  /* ── 상태 ── */

  private buildState(): Hsmg402State {
    const players: PlayerView[] = this.players.map((p) => ({
      id: p.id,
      char: p.char,
      isCom: p.isCom,
      pos: cloneV3(p.pos),
      yaw: p.yaw,
      action: p.action,
      phase: p.phase,
      motion: p.motion.name,
      motionFrame: p.motion.frame,
      motionSpeed: p.motion.speed,
      motionNext: p.motion.next,
      addVel: { x: p.add.x, y: p.add.y, z: p.add.z },
      knockActive: p.knockActive,
      isFall: p.isFall,
      fallTime: p.fallTime,
      rank: p.rank,
      heldBall: p.heldBall ? p.heldBall.slot : -1,
      mashCount: p.mashCount,
      mashTimer: p.mashTimer,
      ctrlEnabled: p.ctrlEnabled,
      blink: p.blink,
      systemScale: { ...p.systemScale },
      fluidParam: { ...p.fluidParam },
      footMaterialOff: p.footMaterialOff,
      cpu: p.isCom
        ? { action: p.com.action, phase: p.com.phase, level: p.com.level, goal: { x: p.com.goal.x, y: p.com.goal.y, z: p.com.goal.z }, timer: p.com.timer, target: p.com.target }
        : undefined,
    }));
    const balls: (BallView | null)[] = this.pool.slots.map((b) =>
      b
        ? {
            slot: b.slot,
            state: b.state,
            sub: b.sub,
            level: b.level,
            scale: b.scale,
            pos: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
            dir: { x: b.dir.x, y: b.dir.y, z: b.dir.z },
            vel: { x: b.vel.x, y: b.vel.y, z: b.vel.z },
            fall: { x: b.fall.x, y: b.fall.y, z: b.fall.z },
            growTimer: b.growTimer,
            accelerating: b.accelerating,
            fallingOff: b.fallingOff,
            ownerId: b.ownerId,
            spinAxis: { ...b.spinAxis },
            spinAngle: b.spinAngle,
            rot: { ...b.rot },
            visible: b.visible && b.state !== -1,
            breakVisible: b.breakVisible && b.state !== -1,
            breakFrame: b.breakFrame,
          }
        : null,
    );
    const m = this.mgr;
    return {
      frame: this.frame,
      stage: this.stage,
      sub: this.hookSub,
      stageFrame: this.stageFrame,
      timerRemain: m.timer.remainSecond(),
      timerRunning: m.timer.state === 1,
      guideVisible: m.guideVisible,
      camera: { anim: this.camera.anim, frame: this.camera.frame, playing: this.camera.playing },
      players,
      balls,
      result: {
        step: m.resultStep,
        acc: m.acc,
        winners: [...m.winners],
        draw: m.draw,
        upCamera: m.upCamera
          ? { player: m.upCamera.player, angle: F(24.7), time: F(0.8), distance: F(12.8), height: F(1.5) }
          : null,
      },
    };
  }
}
