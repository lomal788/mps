/**
 * 로직 → 화면 사건(이번 프레임에 생긴 것). 화면은 소리·이펙트·진동을 이 목록으로만 낸다.
 * 이름은 원본 라벨을 그대로 쓴다(예: SQ_SE_MG1801_JUST, mg1801_water_entry00).
 * 게임 전용 사건이 필요하면 게임의 state.ts 에서 이 유니온을 넓힌다.
 */
import type { V3 } from './fmath';

export type GameEvent =
  /** 2D 효과음(원본 SoundModule::Play) */
  | { k: 'se'; label: string }
  /** 3D 효과음(원본 SoundModule::Play3D) */
  | { k: 'se3d'; label: string; pos: V3 }
  /** BGM(원본 RmMgSceneBase::SetGameBgmName 등으로 고른 곡) */
  | { k: 'bgm'; label: string }
  | { k: 'bgmStop' }
  /** 파티클 이펙트(원본 bex::Effect::Create + Start) */
  | { k: 'effect'; name: string; pos: V3 }
  /** 진동(원본 FxTrigger·bnvib) */
  | { k: 'vibrate'; player: number; name: string };
