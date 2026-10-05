/**
 * hsmg402 정적 상수(NRO 데이터, 심볼 이름 그대로)와 hs_actorparam.csv 값, 웹 설정 키 — docs/minigame/hsmg402.md 4.9·9.4·11.
 * 상수는 손으로 고치지 않는다. 값은 f32 비트로 옮긴다(0x… 는 원본 즉시값·데이터 비트).
 */
import { F, f32FromBits } from '../../../core/fmath';
import { FRAME_DT } from '../../../core/clock';
import type { GameOption } from '../../../game';

/** GetDeltaTime = ActorUtil::getDeltaTime = f32(1/60) = 0x3C888889 */
export const DT = FRAME_DT;

/** GameMgr::GameTime @0x7100030668 */
export const GAME_TIME = F(60.0);

/* Player 정적 표 (@0x7100030760~) */
export const DAMAGE_VEC_RES = [0.42, 0.42, 0.42, 0.42, 0.42, 0.42, 0.42, 0.42].map(F);
/** [6] 은 NRO 데이터 비트 0x41AA3D70(21.279999) — f32(21.28)=0x41AA3D71 이 아니다 */
export const DAMAGE_VEC_LEN = [7.0, 8.96, 10.92, 13.58, 16.17, 18.55, f32FromBits(0x41aa3d70), 23.03].map(F);
export const DAMAGE_VEC_DEG = [68.5, 68.5, 68.5, 68.5, 68.5, 68.5, 68.5, 68.5].map(F);
export const DAMAGE_MOVE_ANIM_FRAME = [20, 20, 21, 21, 22, 22, 22, 22].map(F);
/** Player::TRIGGER_COUNT_END_TIME @0x71000307E0 / CREATE_TRIGGER_COUNT @0x71000307E4 */
export const TRIGGER_COUNT_END_TIME = F(0.5);
export const CREATE_TRIGGER_COUNT = 9;
/** 무명 걷기 속도 배율 @0x71000307E8, 걷기 모션 속도 @0x7100030808(×0.001 로 씀), CPU 걷기 중단 % @0x7100030828 */
export const WALK_SPEED_FACTOR = [1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.5].map(F);
export const WALK_ANIM_SPEED = [0.5, 0.4, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1].map(F);
export const WALK_ANIM_SCALE = f32FromBits(0x3a83126f); // 0.001
export const WALK_STOP_PERCENT = [0, 0, 5, 10, 50, 80, 90, 100];

/* PlayerCom (@0x7100030848~) */
export const OUT_FIELD_LENGE = F(8.0);
export const MOVE_GOAL_LIMIT = F(0.01);
export const CREATE_BUTTON_TRIG_TIME = [0.18181819, 0.16666667, 0.125, 0.1].map(F);
export const SHOT_PROBABILITY = [
  [10, 10, 30, 40, 60, 80, 90, 90],
  [1, 5, 20, 30, 50, 70, 80, 99],
  [5, 10, 20, 30, 50, 70, 80, 99],
  [5, 10, 20, 30, 50, 70, 80, 99],
];

/* SnowBall (@0x71000308E0~) */
export const MAX_LEVEL = 7;
export const MAX_SIZE = F(1.1); // 0x3F8CCCCD
export const SIZE_CHANGE_TIME = F(1.0);
export const SIZE_SCALE = [0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map(F);
export const MIN_SIZE = F(0.44);
export const MAX_MOVE_SPEED = F(0.1);
export const DOWN_SPEED = f32FromBits(0xbf7ae148); // -0.98
export const DELETE_LIMIT_Y = F(-11.0);

/* 즉시값 */
export const GROUND_RAY_MARGIN = f32FromBits(0x3df5c28f); // 0.12
export const NORMAL_Y_LIMIT = f32FromBits(0x3f7ae148); // 0.98
export const SPEED_SQ_LIMIT = f32FromBits(0x3c23d70b); // 0.010000001 = f32(0.1·0.1)
export const FLT_EPSILON = f32FromBits(0x34000000);
export const FLT_MIN = f32FromBits(0x00800000);
export const FLT_MAX = f32FromBits(0x7f7fffff);
export const SOUND_DIV = f32FromBits(0x3f28f5c2); // 0.65999997
export const SOUND_SUB = f32FromBits(0xbee147af); // -0.44000003
export const FALL_R2 = f32FromBits(0x42867ae1); // 67.24 = 8.2²
export const FALL_Y = F(-0.5);
export const OUT_Y = F(-1.0);
export const DEG = f32FromBits(0x42652ee1); // 57.29578
export const RAD = f32FromBits(0x3c8efa35); // 0.017453292
/** Player 생성자 기본값(@0x7100004dec): e30 7.0(미사용), e34 0.42, e38 −37, e3C 68.5, e64 22, e08 −33 */
export const PLAYER_GRAVITY = f32FromBits(0xc2140000); // -37
export const REFLECT_FLIP_Y = F(-33);
/** ActionEX8: 수평 거리 ≤ 11.5 면 SNOW_FALL00 */
export const SNOW_FALL_FX_DIST = F(11.5);
/** ActionEX4: sb_push00 프레임 ≥ 4.0 에 Shot */
export const PUSH_SHOT_FRAME = F(4.0);
/** ActionEX6/7: 프레임 ≥ 20 에 깜빡임 / EX8: 피격 모션 프레임 ≥ 16 이면 속도 0.3 */
export const DAMAGE_BLINK_FRAME = F(20);
export const FALL_SLOW_FRAME = F(16);
export const FALL_SLOW_SPEED = F(0.3);

/* hs_actorparam.csv (hs_system/data, 행 = 파일 첫 빈 줄이 0) */
/** 행 2 WALK_SPEED */
export const WALK_SPEED = F(2.0);
/** 행 4·5·6 ROT 360 / 1100 / 85 (ResetRotParam) — 단위 °/초 [추정] */
export const ROT_SPEED = F(360);
export const ROT_SPEED_FAST = F(1100);
export const ROT_FAST_DEG = F(85);
/** 행 32 CAPSULE_HIT_RANGE (1, 0.5, 0.5) → 본체 캡슐 top 1.0 / bottom 0.5 / r 0.5 */
export const CAPSULE_R = F(0.5);
/** ActorPad +0x94 스틱 데드존 */
export const STICK_DEADZONE = F(0.1);
/** Actor+0x2D4 최대 낙하 속도 −49 [추정: ResetJumpParamEx] */
export const TERMINAL_VY = F(-49);

/* 시작 위치(pos_op 뼈 cha_pos00~03, y 는 코드가 1.0 으로 덮음) — 3.3 표 [데이터] */
export const START_POS: readonly { x: number; z: number; yawDeg: number }[] = [
  { x: -4.5, z: -4.5, yawDeg: 45 },
  { x: 4.5, z: -4.5, yawDeg: -45 },
  { x: -4.5, z: 4.5, yawDeg: 135 },
  { x: 4.5, z: 4.5, yawDeg: -135 },
];

/**
 * 모션 길이(프레임, FSKA +0x40 [추정: 필드], pc01 값) — 7.8. loop = 반복 클립.
 * co_wriggle00 길이는 문서에 없어 반복으로만 둔다(Infinity).
 */
export const MOTION: Readonly<Record<string, { len: number; loop: boolean }>> = {
  co_idle00: { len: 120, loop: true },
  co_walk00: { len: 44, loop: true },
  sb_make00: { len: 24, loop: false },
  sb_idle00: { len: 56, loop: true },
  sb_idle01: { len: 56, loop: true },
  sb_walk00: { len: 44, loop: true },
  sb_walk01: { len: 44, loop: true },
  sb_push00: { len: 48, loop: false },
  co_damage02: { len: 74, loop: false },
  co_damage03: { len: 74, loop: false },
  co_wriggle00: { len: Infinity, loop: true },
  co_win01a: { len: 132, loop: false },
  co_win01b: { len: 60, loop: true },
};

/** cam_op 길이 120f [데이터: hsmg402_cam_op.fsnb] */
export const CAM_OP_FRAMES = 120;
/** snowball_break 애니 50f [데이터] */
export const BREAK_FRAMES = 50;

/** 결과: MiniGameFinishPlayerUpCamera 인자(GameMgr::Result 단계 0) */
export const UP_CAMERA = { angle: F(24.7), time: F(0.8), distance: F(12.8), height: F(1.5) };

/** 무대 단면(48각 회전체, 7.5° 간격, 0° 에 정점) — 7.2 [데이터: collision apx] */
export const STAGE_RINGS: readonly [number, number][] = [
  [0, 0],
  [7.4971, 0],
  [8.0388, -0.091],
  [8.1986, -0.2092],
  [8.4291, -0.4897],
  [8.5264, -0.9679],
  [8.6121, -2.5105],
  [13.5532, -11.8051],
];

/** 효과 단계 %d: level < 3 ? 0 : level < 6 ? 1 : 2 */
export const tierOf = (level: number): number => (level < 3 ? 0 : level < 6 ? 1 : 2);

/**
 * 웹 설정 — 원본 순서·시간이 [미확정]인 곳. 기본값은 문서(9.4) 권장 또는 웹 결정이고, 각 줄에 근거 수준을 적는다.
 */
export interface Hsmg402Config {
  /** 액터 갱신(ActorManager)을 Player::Update 보다 먼저 돌린다. false(기본) = Update → 액터 → 연타 첫 B 를 두 번 셈(9회) [미확정 11.1 #1] */
  actorBeforePlayerUpdate: boolean;
  /** 타이머 Tick 을 같은 프레임 GameMgr::Update 보다 먼저(기본 true, calc 가정) [미확정 #2] */
  timerTickBeforeMgr: boolean;
  /** 단계 4 FirstFade 대기 프레임(GMSystemWipe 페이드 길이 미판독) [미확정, 웹 기본값 30] */
  firstFadeFrames: number;
  /** 단계 7 시작 텔롭·카운트다운 프레임(main 흐름 미판독) [미확정, 웹 기본값 180] */
  countdownFrames: number;
  /** UITimer::StartTimer 시점: 'enter' = 단계 7 진입, 'leave' = 단계 7 끝(기본) [미확정] */
  timerStartAt: 'enter' | 'leave';
  /** 단계 10~12(MainEnd·NextRound·Finish) 합계 대기 프레임(PlayerCtrlEnd(1.0) 1초 [추정]) [미확정, 웹 기본값 60] */
  mainEndFrames: number;
  /** 가이드 In 을 부르는 흐름 단계(SysMiniGameUiMgr::EntryMgUI 쪽 미판독) [미확정, 웹 기본값 8] */
  guideInStage: number;
  /** 사람 패드를 PlayerCtrlStart(단계 8)~PlayerCtrlEnd(단계 9 끝) 밖에서 막는다 [미확정 #6, 기본 true] */
  gateHumanPad: boolean;
  /** 플레이어끼리 수평 밀어내기(collisionActorHorizontal 미판독, 반지름 0.5 대칭 분리) [추정, 기본 true] */
  actorPush: boolean;
  /** 공 충돌 구를 레벨업 때 다시 만들면 겹친 상대에게 트리거 진입을 다시 보고 [추정: PhysX, 기본 true] */
  retriggerOnRecreate: boolean;
  /** PlEvCol 캡슐: 축 y, 중심 높이·반 길이·반지름 — 9.7 [추정] */
  plEvColCenterY: number;
  plEvColHalf: number;
  plEvColR: number;
  /** 48각 단면 판정(기본 true). false 면 원(오차 ≤ 0.016) */
  ground48: boolean;
  /** 결과 카메라 Update() 가 참이 되는 시간 = SetTime(0.8) 경과 [추정] — 프레임 */
  upCameraFrames: number;
}

export const DEFAULT_CONFIG: Hsmg402Config = {
  actorBeforePlayerUpdate: false,
  timerTickBeforeMgr: true,
  firstFadeFrames: 30,
  countdownFrames: 180,
  timerStartAt: 'leave',
  mainEndFrames: 60,
  guideInStage: 8,
  gateHumanPad: true,
  actorPush: true,
  retriggerOnRecreate: true,
  plEvColCenterY: 0.5,
  plEvColHalf: 0.45,
  plEvColR: 0.55,
  ground48: true,
  upCameraFrames: 48,
};

/**
 * GameDef.options — 원본 스위치만: COM 레벨(GW_PLAYER_COM_LEVEL 0~3, GameWork::GetComLevel → PlayerCom+0x5A8).
 * 'setup' = 페이지가 준 플레이어별 comLevel.
 */
export const HSMG402_OPTIONS: readonly GameOption[] = [
  {
    key: 'comLevel',
    label: 'CPU 레벨',
    choices: [
      { value: 'setup', label: '플레이어 설정' },
      { value: '0', label: '0' },
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
    ],
    def: 'setup',
    note: 'GW_PLAYER_COM_LEVEL 0~3 (PlayerCom+0x5A8). 사람이 모두 탈락하면 GameMgr 가 매 프레임 전원 3 으로 올린다',
  },
];
