/**
 * hsmg402::GameMgr(0xA8 B) — docs/minigame/hsmg402.md 3.2·3.3·4.2·6.1·6.3 [판독].
 * 시작 배치(EntryPlayer), 시작(Start), 매 프레임 탈락·순위·종료(Update, 흐름 단계 9), 결과 연출(ResultPreparation·Result, 단계 14).
 * 보상 계산은 NRO 밖이다. 순위는 EntryPlayerRank / SetPlayerRank 로 main 에 넘긴다(웹은 result 로 낸다).
 */
import { F, v3 } from '../../../core/fmath';
import { DT, FLT_MAX, GAME_TIME, OUT_Y, START_POS, UP_CAMERA } from './data';
import type { World } from './game';
import type { Player } from './player';
import { resultRank } from './resultRank';
import { MinigameTimer } from './timer';

export class GameMgr {
  /** +0x08~+0x18 참가자(Start 뒤 ID 오름차순) */
  list: Player[] = [];
  /** +0x70 UITimer(60) */
  readonly timer = new MinigameTimer();
  /** +0x78 가이드(UICtrlGuide +0x60 Out 했음) */
  guideVisible = false;
  guideOutDone = false;
  /** +0x88 종료 카운터 / 결과 단계, +0x8C 결과 대기 누적 */
  finishCount = 0;
  resultStep = 0;
  acc = 0;
  /** +0x90 타이머 종료 판정 허용(생성자 1, 바꾸는 곳 없음) */
  readonly timerCheck = true;
  /** +0xA0 MiniGameFinishPlayerUpCamera(승자 1명) */
  upCamera: { player: number; frame: number } | null = null;
  winners: number[] = [];
  draw = false;
  /** 사람 전원 탈락으로 CPU 레벨 3 전환이 일어났음(시험용 관측) */
  comBoost = false;

  constructor(private readonly world: World) {
    this.timer.setTimer(GAME_TIME);
  }

  /** EntryPlayer @0x7100000c3c: cha_pos0k 위치(y 는 1.0)·회전, SystemScale (2,1,2), Fluid (0,1,1,1), SetEnable(false) */
  entryPlayer(p: Player, k: number): void {
    this.list.push(p);
    const s = START_POS[k];
    p.pos = v3(s.x, 1.0, s.z);
    p.yaw = F((s.yawDeg * Math.PI) / 180);
    p.setLeverRotateY(F(s.yawDeg));
    p.systemScale = v3(2, 1, 2);
    p.fluidParam = { x: 0, y: 1, z: 1, w: 1 };
    p.setEnable(false);
  }

  /** CreateGuide: 처음 숨김 */
  createGuide(): void {
    this.guideVisible = false;
  }

  guideIn(): void {
    if (this.guideVisible || this.guideOutDone) return;
    this.guideVisible = true;
    this.world.emit({ k: 'guide', op: 'in' });
  }

  private guideOut(): void {
    this.guideOutDone = true;
    if (this.guideVisible) {
      this.guideVisible = false;
      this.world.emit({ k: 'guide', op: 'out' });
    }
  }

  /** Start @0x7100001eb4: 전원 SetEnable(true), GetPlayerID 오름차순 정렬 */
  start(): void {
    for (const p of this.list) p.setEnable(true);
    this.list.sort((a, b) => a.id - b.id);
  }

  /** Update @0x7100001fac — 참이면 게임 끝 */
  update(): boolean {
    this.world.pool.update();
    if (this.finishCount !== 0) return false;
    const n = this.list.length;
    if (!this.guideOutDone && F(10.0) <= F(GAME_TIME - this.timer.remainSecond())) this.guideOut();
    if (this.timerCheck && this.timer.isEndTimer()) {
      const v = new Array<number>(n).fill(0);
      for (const p of this.list) v[p.id] = p.fallTime === 0 ? FLT_MAX : p.fallTime;
      const rank = resultRank(v, n, true);
      this.list.forEach((p, i) => {
        p.setEnable(false);
        p.rank = rank[i];
      });
      return this.finish();
    }
    const elapsed = F(GAME_TIME - this.timer.remainSecond());
    const fallen: number[] = [];
    let alive = 0;
    for (const p of this.list) {
      if (p.fallTime > 0) continue;
      if (p.pos.y > OUT_Y) {
        alive++;
        continue;
      }
      p.fallTime = elapsed;
      p.setEnable(false);
      fallen.push(p.id);
    }
    if (fallen.length >= 1) {
      const v = new Array<number>(n).fill(0);
      const t0 = this.list[0].fallTime;
      if (this.list.every((p) => p.fallTime === t0)) {
        for (const p of this.list) p.fallTime = 0;
      } else for (const p of this.list) v[p.id] = p.fallTime === 0 ? FLT_MAX : p.fallTime;
      const r = resultRank(v, n, true);
      for (const p of this.list) if (fallen.includes(p.id)) p.rank = r[p.id];
    }
    if (alive > 1) {
      const humans = this.list.filter((p) => !p.isCom);
      if (humans.length >= 1 && humans.every((p) => p.fallTime > 0)) {
        for (const p of this.list) p.com.setLevel(3);
        this.comBoost = true;
      }
      return false;
    }
    if (fallen.length < this.list.length) for (const p of this.list) if (p.fallTime <= 0) p.rank = 0;
    return this.finish();
  }

  private finish(): boolean {
    this.gameFinish();
    this.finishCount++;
    return true;
  }

  /** GameFinish @0x7100002614: 가이드 Out, 전원 SetEnable(false), IsFall 아닌 플레이어 ActionIdle(true, 0) */
  private gameFinish(): void {
    this.guideOut();
    for (const p of this.list) {
      p.setEnable(false);
      if (!p.isFall) p.actionIdle(true);
    }
  }

  /** ResultPreparation @0x71000026dc: +0x88 = 0, 전원 SetUpFinishEvent */
  resultPreparation(): void {
    this.finishCount = 0;
    this.resultStep = 0;
    this.acc = 0;
    for (const p of this.list) p.setUpFinishEvent();
  }

  private livingWinners(): Player[] {
    return this.list.filter((p) => p.rank === 0 && p.fallTime <= 0 && !p.isFall);
  }

  /** Result @0x7100002720 — 참이면 OnGameEnding 끝 */
  result(): boolean {
    const w = this.world;
    switch (this.resultStep) {
      case 0: {
        const n = this.list.length;
        if (this.list.every((p) => p.rank === n - 1)) {
          this.draw = true;
          this.resultStep = 10;
          return false;
        }
        this.winners = this.list.filter((p) => p.rank === 0).map((p) => p.id);
        w.emit({ k: 'telop', type: 5, op: 'set', players: [...this.winners] });
        const live = this.livingWinners();
        for (const p of live) {
          p.setLeverRotateY(0); // SetTargetRotateY(0.0)
          p.actionTurn(true);
        }
        if (live.length === 1) {
          const c = { player: live[0].id, angle: UP_CAMERA.angle, time: UP_CAMERA.time, distance: UP_CAMERA.distance, height: UP_CAMERA.height };
          this.upCamera = { player: live[0].id, frame: 0 };
          w.emit({ k: 'upCamera', ...c });
        }
        this.resultStep = 1;
        return false;
      }
      case 1: {
        const waiting = this.livingWinners().some((p) => p.action !== 0);
        let camDone = true;
        if (this.upCamera) {
          this.upCamera.frame++;
          camDone = this.upCamera.frame >= w.cfg.upCameraFrames; // Update() 참 = SetTime(0.8) 경과 [추정 #16]
        }
        if (camDone && !waiting) this.resultStep = 2;
        return false;
      }
      case 2:
        for (const p of this.livingWinners()) p.actionWin(true);
        w.emit({ k: 'telop', type: 5, op: 'start', players: [...this.winners] });
        this.resultStep = 3;
        return false;
      case 3:
        this.acc = F(DT + this.acc);
        return this.acc > 2.0;
      case 10:
        w.emit({ k: 'telop', type: 6, op: 'start', players: [] });
        this.resultStep = 3;
        return false;
      default:
        return false;
    }
  }
}
