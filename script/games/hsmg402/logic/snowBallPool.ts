/**
 * hsmg402::SnowBallMgr(0x30 B) — +0x18 vector<unique_ptr<SnowBall>> 32칸. docs/minigame/hsmg402.md 4.6 [판독].
 * CreateSnowBall @0x71000141f8 은 첫 빈 칸에 만들고, 칸이 없으면 무효 핸들(null). Update @0x7100014498 은 state == −1 인 공을 지운다
 * (GameMgr::Update 안, 흐름 단계 9 에서만 불린다).
 */
import { MAX_SIZE } from './data';
import { F } from '../../../core/fmath';
import type { SnowBall } from './snowBall';

export const POOL_SLOTS = 32;

export class SnowBallPool {
  readonly slots: (SnowBall | null)[] = new Array<SnowBall | null>(POOL_SLOTS).fill(null);

  /** 첫 빈 칸 번호(없으면 −1) */
  freeSlot(): number {
    return this.slots.indexOf(null);
  }

  /** 만든 순서 번호(웹 트리거 쌍 식별용 — 같은 칸을 다시 쓰는 공을 구별) */
  private serial = 0;

  put(b: SnowBall): void {
    b.uid = ++this.serial;
    this.slots[b.slot] = b;
  }

  /** SnowBallMgr::Update — state −1 삭제 */
  update(): void {
    for (let i = 0; i < POOL_SLOTS; i++) if (this.slots[i]?.state === -1) this.slots[i] = null;
  }

  /* 조회(PlayerCom 이 쓴다) */
  idxValid(i: number): boolean {
    return this.slots[i] !== null;
  }
  getCreaterId(i: number): number {
    return this.slots[i]?.ownerId ?? -1;
  }
  /** IsDeleteWait @0x7100014664 = state == −1 */
  isDeleteWait(i: number): boolean {
    return this.slots[i]?.state === -1;
  }
  /** IsGrowth @0x7100014688 = state == 0 */
  isGrowth(i: number): boolean {
    return this.slots[i]?.state === 0;
  }
  /** GetSnowBallSize = scale.x × 1.1 */
  getSize(i: number): number {
    const b = this.slots[i];
    return b ? F(b.scale * MAX_SIZE) : 0;
  }
}
