/**
 * hsmg402 데굴데굴 눈덩이 — GameDef. 로직 logic/game.ts(결정적, 노드에서도 돈다), 화면 view/index.ts(Hsmg402View).
 * docs/minigame/hsmg402.md.
 *
 * 조작(원본: B 연타 = 눈덩이 만들기, A = 날리기, L 스틱 = 이동 — ActorPad 0x400 = B, 0x800 = A):
 * - 키보드(view/input.ts KeyboardPad): WASD/방향키 = 스틱, K = B(만들기 연타), J = A(날리기)
 * - 게임패드(표준 매핑): 0 = B(아래 버튼), 1 = A(오른쪽 버튼), 왼쪽 스틱
 * 입력은 누른 순간(trig)만 쓴다. 키 자동 반복은 Pads 가 앞 프레임과 비교해 거른다.
 */
import type { GameDef } from '../../game';
import type { Hsmg402Event, Hsmg402Result, Hsmg402State } from './state';
import { Hsmg402Game } from './logic/game';
import { HSMG402_OPTIONS } from './logic/data';
import { Hsmg402View } from './view/index';

export const hsmg402: GameDef<Hsmg402State, Hsmg402Event, Hsmg402Result> = {
  id: 'hsmg402',
  title: '데굴데굴 눈덩이',
  assetsDir: 'hsmg402/',
  players: 4,
  hasPractice: false,
  options: HSMG402_OPTIONS,
  createLogic: (setup) => new Hsmg402Game(setup),
  createView: (ctx, assets) => new Hsmg402View(ctx, assets),
  describeResult(r) {
    return {
      head: r.draw ? '무승부' : '결과',
      rows: r.ranks.map((rank, i) => ({
        player: i,
        rank,
        value: r.fallTimes[i] > 0 ? `${r.fallTimes[i].toFixed(2)}초 탈락` : '생존',
        data: { fallTime: r.fallTimes[i], rank },
      })),
    };
  },
};
