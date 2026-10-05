/**
 * hsmg402 데굴데굴 눈덩이 — 로직 → 화면 계약(docs/minigame/hsmg402.md 9.3).
 * 좌표는 원본 월드 단위(무대 중심 원점, 원판 반지름 7.4971, y 위). 각도는 라디안(원본 rot.y, yaw 0 = +Z, 정면 = (sin yaw, 0, cos yaw)).
 * 시간은 초, 한 step = 원본 한 프레임(dt = f32(1/60)).
 *
 * 화면이 지킬 것:
 * - motion 은 원본 클립 이름(접두 pcNN_ 를 뺀 것: co_idle00·co_walk00·sb_make00·sb_idle00/01·sb_walk00/01·sb_push00·co_damage02/03·co_wriggle00·co_win01a/b).
 *   motionFrame 은 로직이 센 재생 프레임(원본 GetSkelFrame 과 같은 뜻, 속도 motionSpeed 배). 클립에 붙은 ftrg(SNOW_MAKE00·VO_HSMG402_MAKE_SB·SE_PC_WALK·VO_PC_ACTION·
 *   bv_vib_* 등)는 로직이 내지 않는다 — 화면이 motion/motionFrame 으로 낸다(7.8).
 * - 공은 32칸 슬롯(원본 SnowBallMgr). null = 빈 칸. state −1(삭제 대기) 공은 숨긴다.
 * - 이벤트 이름은 원본 라벨 그대로다(SE 라벨, FX 트리거 이름, 메시지 라벨).
 */
import type { V3 } from '../../core/fmath';
import type { GameEvent } from '../../core/events';
import type { GameResult } from '../../game';

/** 4성분 쿼터니언(x, y, z, w) */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** 행동 ID(원본 Actor+0x17C, 4.10) */
export const ACTION = {
  IDLE: 0,
  WALK: 1,
  /** ActionEX1 만들기(B 연타) */
  MAKE: 0x11,
  /** ActionEX2 공 들고 대기 */
  HOLD_IDLE: 0x12,
  /** ActionEX3 공 들고 걷기 */
  HOLD_WALK: 0x13,
  /** ActionEX4 던지기 */
  PUSH: 0x14,
  /** ActionEX6 앞 피격 */
  DAMAGE_FRONT: 0x16,
  /** ActionEX7 뒤 피격 */
  DAMAGE_BACK: 0x17,
  /** ActionEX8 낙하 */
  FALL: 0x18,
  /** 결과 회전(Actor::ActionTurn, controlAction 표 3) */
  TURN: 3,
  /** 승리 동작(ActorPlayer::ActionWin, controlAction 표 0xF) */
  WIN: 0xf,
} as const;

/** 눈덩이 state(SnowBall+0x110) */
export type BallStateId = 0 | 1 | 2 | -1;

export interface CpuView {
  /** PlayerCom+0x5A0: 0 생각, 1 걷기, 2 만들기, 3 던지기 */
  action: number;
  /** PlayerCom+0x5A4 */
  phase: number;
  /** PlayerCom+0x5A8 COM 레벨 0~3 */
  level: number;
  /** PlayerCom+0x50 이동 목표 */
  goal: V3;
  /** PlayerCom+0x594 */
  timer: number;
  /** PlayerCom+0x598 표적 플레이어 인덱스(−1 없음) */
  target: number;
}

export interface PlayerView {
  /** GW_PLAYER_ID(= 참가 순서 0..3) */
  id: number;
  /** 캐릭터 ID(pcNN) */
  char: string;
  isCom: boolean;
  /** 모델 위치(발 기준) */
  pos: V3;
  /** 몸 회전 yaw(라디안) */
  yaw: number;
  /** 행동 ID(ACTION) */
  action: number;
  /** 행동 부속 단계(Actor+0x184) */
  phase: number;
  /** 원본 클립 이름(pcNN_ 빼고) */
  motion: string;
  /** 재생 프레임(원본 프레임 단위) */
  motionFrame: number;
  /** 재생 배속(EX3 의 표×0.001 은 단위 미확정이라 그대로 싣는다 — 6.6) */
  motionSpeed: number;
  /** 모션이 바뀐 뒤 끝나면 이어 재생할 클립(co_win01a → co_win01b) */
  motionNext: string | null;
  /** 추가 속도(Actor+0x1E0, 초당) */
  addVel: V3;
  /** 넉백 중(Player+0xE0D) */
  knockActive: boolean;
  /** 낙하 상태(Player+0xE68) */
  isFall: boolean;
  /** 탈락 시각(Player+0xE4C, 0 = 생존) */
  fallTime: number;
  /** 순위(Player+0xE58, 0 = 1등, 초기 3) */
  rank: number;
  /** 손에 든 공 슬롯(−1 없음) */
  heldBall: number;
  /** 연타 수(Player+0xE00) / 연타 제한 타이머(+0xE04) */
  mashCount: number;
  mashTimer: number;
  /** 조작 허용(Player+0x527 / +0xD68) */
  ctrlEnabled: boolean;
  /** 깜빡임 남은 초(CharacterModel SetBlinkTimer, 0 = 끝). 화면은 > 0 동안 깜빡인다 */
  blink: number;
  /**
   * 시스템 스케일(Actor::SetSystemScaleVec). 배치 때 (2,1,2), 착지 후 (1,1,1) [추정: 표현 값, 7.5].
   * fluidParam = FluidMaterialParamChange 값(배치 때 (0,1,1,1), 착지 후 (1,1,1,1)).
   */
  systemScale: V3;
  fluidParam: Quat;
  /** 낙하(EX8) 때 발·몸 재질 배율 0 */
  footMaterialOff: boolean;
  cpu?: CpuView;
}

export interface BallView {
  slot: number;
  state: BallStateId;
  /** state 부속 단계(SnowBall+0x114) */
  sub: number;
  level: number;
  /** 모델 스케일(겉보기·충돌 반지름 = 1.1 × scale) */
  scale: number;
  /** 공 중심(모델 위치) */
  pos: V3;
  /** +0xD0 이동/가속 벡터, +0xE0 속도(프레임당), +0xF0 낙하 벡터 */
  dir: V3;
  vel: V3;
  fall: V3;
  growTimer: number;
  accelerating: boolean;
  /** +0x11C 가장자리 넘어감 */
  fallingOff: boolean;
  /** 만든 플레이어 ID(+0x108) */
  ownerId: number;
  /** 이번 프레임 굴림 회전(시각 전용, HsModel::Rotate). 축(월드)·각(라디안) */
  spinAxis: V3;
  spinAngle: number;
  /** 굴림 누적 회전(spin 을 월드 축으로 왼쪽에 곱해 쌓은 것, 시각 전용) */
  rot: Quat;
  /** 공 모델 보이기(state 2 에서 숨김) */
  visible: boolean;
  /** 부서짐 모델(snowball_break) 보이기·애니 프레임(50f, 알파 30f 부터) */
  breakVisible: boolean;
  breakFrame: number;
}

export interface ResultView {
  /** GameMgr+0x88(결과 단계 0·1·2·3·10) */
  step: number;
  /** GameMgr+0x8C */
  acc: number;
  /** rank 0 인 플레이어 ID */
  winners: number[];
  draw: boolean;
  /** MiniGameFinishPlayerUpCamera 대상(승자 1명일 때), 없으면 null */
  upCamera: { player: number; angle: number; time: number; distance: number; height: number } | null;
}

export interface Hsmg402State {
  frame: number;
  /** 흐름 단계(MainLoop +0x2D8, 01_core 5.5) */
  stage: number;
  /** 흐름 부속 단계(Scene+0x444 / main +0x2DC) */
  sub: number;
  /** 단계 안에서 센 프레임(main 단계 4·6·7 등 웹 대기용) */
  stageFrame: number;
  /** UITimer RemainSecond(초) */
  timerRemain: number;
  timerRunning: boolean;
  /** 조작 가이드(sys_guide_02) 표시 */
  guideVisible: boolean;
  /** 장면 카메라 애니(0 cam_op / 1 cam), 재생 프레임, 재생 중 */
  camera: { anim: 'cam_op' | 'cam' | null; frame: number; playing: boolean };
  players: PlayerView[];
  /** 32칸 */
  balls: (BallView | null)[];
  result: ResultView;
}

/** 공 크기 → 소리 변수 L15(T, 0~127, 6.12) */
export type Hsmg402Event =
  | GameEvent
  /** 흐름 단계 바뀜(화면이 페이드·카운트다운·BGM·결과 UI 를 단계로 맞춘다) */
  | { k: 'stage'; stage: number }
  /**
   * FX 트리거(원본 ComFxTrigger::Play/Stop). owner = 'ball'(슬롯의 공 모델) | 'ballBreak'(부서짐 모델) | 'player'(플레이어 모델).
   * 이름: SNOWBALL_APPEAR00, SNOWBALL_MAX00, SNOWBALL_MOVE0%d, SNOWBALL_THROW0%d, SNOWBALL_FALL00, SNOWBALL_BREAK0%d(%d = level<3→0, <6→1, 그 밖 2),
   *       VO_HSMG402_CMP_SB, VO_HSMG402_FALL, SNOW_FALL00
   */
  | { k: 'fx'; owner: 'ball' | 'ballBreak' | 'player'; index: number; name: string; op: 'play' | 'stop'; pos: V3 }
  /** 3D 효과음 + 지역 변수 L15(= T). 1회 재생: SQ_SE_HSMG402_YKD_FAL / _HIT_YKD / _HIT_PC */
  | { k: 'seT'; label: string; pos: V3; t: number }
  /**
   * 따라가는 루프음(Play3DHookPosition). SQ_SE_HSMG402_YKD_MOV(손 공) / _FIR_MOV(굴러가는 공).
   * op 'start' = 새로 재생, 'update' = 위치·L15 갱신, 'stop' = 정지. ball = 슬롯
   */
  | { k: 'seLoop'; label: string; ball: number; op: 'start' | 'update' | 'stop'; pos: V3; t: number }
  /** 장면 카메라(bex::Camera::PlayAnim/StopAnim). anim 0 cam_op, 1 cam */
  | { k: 'camera'; op: 'play' | 'stop'; anim: 'cam_op' | 'cam'; speed: number }
  /** 결과 카메라(MiniGameFinishPlayerUpCamera::Start) */
  | { k: 'upCamera'; player: number; angle: number; time: number; distance: number; height: number }
  /** 텔롭(UIMGTelop). type 5 승자(+0x60), 6 무승부(+0x68) [추정: 종류]. op 'set' = SetPlayers, 'start' = Start */
  | { k: 'telop'; type: 5 | 6; op: 'set' | 'start'; players: number[] }
  /** 조작 가이드 In/Out(UICtrlGuide) */
  | { k: 'guide'; op: 'in' | 'out' }
  /** 타이머(UITimer) 시작 */
  | { k: 'timer'; op: 'start' };

export interface Hsmg402Result extends GameResult {
  /** 플레이어별 탈락 시각(0 = 생존) */
  fallTimes: number[];
  draw: boolean;
}
