/**
 * hs::mg::Util::ResultRank(int*, float*, int, bool) main @0x710010b908 — docs/minigame/hsmg402.md 6.2 [판독].
 * 다른 미니게임과 공용 후보. 인자 n 은 쓰지 않고 GameWork::GetPlayerNum() 을 쓴다.
 */
import { F } from '../../../core/fmath';

/**
 * 전부 0.0 이면 전원 N−1.
 * desc(true):  rank[i] = N−1 − #{ j≠i : !(v[i] < v[j]) }   (큰 값이 1등, 동점은 좋은 순위)
 * desc(false): rank[i] = N−1 − #{ j≠i : !(v[i] > v[j]) }
 */
export function resultRank(values: readonly number[], playerNum: number, desc = true): number[] {
  const v = values.map((x) => F(x));
  const n = playerNum;
  if (v.slice(0, n).every((x) => x === 0)) return new Array<number>(n).fill(n - 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let r = n - 1;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (desc ? !(v[i] < v[j]) : !(v[i] > v[j])) r--;
    }
    out.push(r);
  }
  return out;
}
