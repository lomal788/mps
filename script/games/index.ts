/**
 * 등록된 게임 목록. 게임을 만들면 import 해서 아래 배열에 더한다(순서 = 페이지 목록 순서).
 */
import type { GameDef } from '../game';
import { hsmg402 } from './hsmg402';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAMES: GameDef<any, any, any>[] = [hsmg402];
