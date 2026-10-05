/**
 * hs::UITimer(0) + bex::ut::TimeCounter — docs/minigame/hsmg402.md 3.2·6.1, engine/01_core.md 4.3 [판독].
 * SetTimer(60) → StartTimer(단계 7, main) → 매 프레임 Tick(엔진 델타 = 1/60 가정). IsEndTimer = 상태(+0x94) 0 또는 3.
 * UITimer::Update 를 누가 언제 부르는지는 [미확정 11.1 #2] — 웹은 장면 Update 안에서 GameMgr 보다 먼저 부른다(설정 timerTickBeforeMgr).
 */
import { F } from '../../../core/fmath';
import { DT } from './data';

export class MinigameTimer {
  /** TimeCounter 값(초) */
  v = 0;
  /** UITimer+0x94: 0 시작 전, 1 진행, 3 만료 */
  state = 0;

  /** TimeCounter::Set(t): v = max(t, 0) */
  setTimer(t: number): void {
    this.v = F(Math.max(F(t), 0));
    this.state = 0;
  }

  startTimer(): void {
    this.state = 1;
  }

  /** UITimer::Update — 진행 중이면 TimeCounter::Tick, 참이면 만료 */
  update(): void {
    if (this.state !== 1) return;
    if (this.tick()) this.state = 3;
  }

  /** TimeCounter::Tick: v>0 이면 v −= 델타; 결과 > 0 이면 거짓, 아니면 v=0·참. 처음부터 v≤0 이면 참 */
  private tick(): boolean {
    if (!(this.v > 0)) return true;
    this.v = F(this.v - DT);
    if (this.v > 0) return false;
    this.v = 0;
    return true;
  }

  /** UITimer::IsEndTimer @0x71000d79ec */
  isEndTimer(): boolean {
    return this.state === 0 || this.state === 3;
  }

  /** UITimer::RemainSecond @0x71000d7a20 = max(v, 0) */
  remainSecond(): number {
    return this.v > 0 ? this.v : 0;
  }
}
