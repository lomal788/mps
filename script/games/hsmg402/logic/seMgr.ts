/**
 * hsmg402::SeMgr(0x810 B) — 충돌 소리 등록. 매 프레임 PostPhysics 메시지(5)에서 Reset 한다 [판독: SceneHsmg402::PostPhysics @0x7100016ac0].
 * CheckToEntry* 의 중복 거르기 규칙은 [미확정 11.1 #18] — 웹은 같은 프레임 같은 쌍을 한 번만 낸다(함수 이름 [추정]).
 * L15(power) = 공 크기 T(6.12). 공끼리의 L15 인자는 보낸 공의 T [추정].
 */
import type { V3 } from '../../../core/fmath';

export interface SeSink {
  emitSe(label: string, pos: V3, t: number): void;
}

export class SeMgr {
  private readonly seen = new Set<string>();

  reset(): void {
    this.seen.clear();
  }

  /** SeMgr::EntryPlayerVsSnowBall @0x71000039f8 → SQ_SE_HSMG402_YKD_HIT_PC */
  entryPlayerVsSnowBall(sink: SeSink, player: number, ballSlot: number, power: number, pos: V3): void {
    const key = `p${player}:b${ballSlot}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    sink.emitSe('SQ_SE_HSMG402_YKD_HIT_PC', pos, power);
  }

  /** SeMgr::EntrySnowBallVsSnowBall @0x7100003548 → SQ_SE_HSMG402_YKD_HIT_YKD */
  entrySnowBallVsSnowBall(sink: SeSink, a: number, b: number, power: number, pos: V3): void {
    const key = a < b ? `b${a}:b${b}` : `b${b}:b${a}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    sink.emitSe('SQ_SE_HSMG402_YKD_HIT_YKD', pos, power);
  }
}
