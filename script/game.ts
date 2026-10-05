/**
 * 게임 등록 틀 — 페이지(main.ts)는 이 인터페이스로만 게임을 다룬다(DESIGN 5절).
 * 새 게임은 games/<id>/ 에 logic·view·state 를 두고 index.ts 에서 GameDef 를 만들어 games/index.ts 의 GAMES 에 더한다.
 *
 *   logic = def.createLogic(setup)              로직(DOM 없음, 60Hz 고정 스텝, 노드에서도 돈다)
 *   view  = def.createView(ctx, assets)         화면(three.js·HUD·소리), view.load() 로 에셋을 읽는다
 *   매 스텝: logic.step(pads, view.observe?.(t)) → view.onStep(logic.state, logic.events)   (소리·이펙트·진동은 여기서)
 *   rAF 마다: view.render(logic.state)
 * 스텝 시각 t: 소리가 있으면 페이지가 오디오 시계(지금 들리는 AudioContext 시각)로 스텝을 맞추고, 스텝마다 그 스텝이 나타내는 시각을 준다(main.ts).
 *   끝: logic.done → def.describeResult(logic.result, setup)
 */
import type { PadInput } from './core/pad';
import type { Assets, Progress } from './view/assets';
import type { AudioOut } from './view/audio';
import type { PadSource } from './view/input';
import type { Renderer } from './view/renderer';

export interface PlayerSetup {
  /** 캐릭터 ID(원본 im_pcNN_name 의 pcNN, 예 'pc01' = 마리오) */
  char: string;
  isCom: boolean;
  /** CPU 강도(원본 단계 수는 게임 판독 후 정한다) */
  comLevel: number;
}

export interface GameSetup {
  players: PlayerSetup[];
  /** 로직 시드(u32) */
  seed: number;
  /** 연습 모드 */
  practice: boolean;
  /** 게임별 설정(GameDef.options 의 key → 고른 value). 없으면 각 기본값 */
  options?: Record<string, string>;
}

/**
 * 게임별 설정 하나 — 원본에 있는 스위치·모드만 둔다(예: mg1801 리듬 모드 RmGameWork+0x20, Params.CpuMiss).
 * 페이지는 설정 패널에 고르기로 보이고 URL ?<key>=<value> 로도 받는다.
 */
export interface GameOption {
  key: string;
  label: string;
  choices: { value: string; label: string }[];
  /** 기본 value */
  def: string;
  /** 다른 설정이 이 값들일 때만 보인다(숨으면 기본값) */
  when?: { key: string; values: string[] };
  /** 원본 근거(설정 패널 툴팁) */
  note?: string;
}

/** 결과 공통 부분(게임마다 더 있다) */
export interface GameResult {
  quit: boolean;
  /** 원본 순위(0 = 1위). 같은 순위 허용 */
  ranks: number[];
  frames: number;
}

/**
 * 사운드 관측 — 원본 게임 프레임이 사운드 스레드가 쓴 값을 읽는 것(SoundModule::ReadGlobalVariable, SoundHandle::ReadLocalVariable).
 * 예: 리듬 게임의 박자(G14)·곡 교대(G12)는 시퀀서가 쓰고 게임은 읽기만 한다(docs/engine/02_rhythm.md 5.1).
 * 페이지가 스텝마다 view.observe(그 스텝의 오디오 시각)로 받아 logic.step 에 넘긴다.
 * 없으면(노드 시험·무음·시퀀서 없음) 로직은 자기 프레임 모델로 같은 값을 만든다 — 로직은 입력(패드 + 이 값)이 같으면 결정적이다.
 */
export interface SoundSnapshot {
  /** 이 값이 나타내는 AudioContext 시각(초) */
  time: number;
  /** 전역 변수 G0..G15(원본 기본 −1) */
  globals: readonly number[];
  /** 재생 요청한 사운드 라벨별 지역 변수 L0..L15. 핸들이 없으면 그 라벨이 없다 */
  locals: Readonly<Record<string, readonly number[]>>;
}

export interface GameLogic<S = unknown, E = unknown, R extends GameResult = GameResult> {
  /** sound: 이 스텝의 사운드 관측(없으면 null·생략 → 로직 자체 모델) */
  step(pads: readonly (PadInput | null | undefined)[], sound?: SoundSnapshot | null): void;
  readonly state: S;
  readonly events: readonly E[];
  readonly done: boolean;
  readonly result: R | null;
}

export interface ViewContext {
  renderer: Renderer;
  hud: CanvasRenderingContext2D;
  /** 소리(없으면 무음) */
  audio: AudioOut | null;
  setup: GameSetup;
  /** 플레이어별 입력원(진동용, CPU 는 null) */
  pads: (PadSource | null)[];
}

export interface GameView<S = unknown, E = unknown> {
  load(onProgress: Progress): Promise<void>;
  /**
   * 다음 로직 스텝에 넘길 사운드 관측 — time = 그 스텝이 나타내는 AudioContext 시각(지금 들리는 소리 기준).
   * 소리 쪽이 그 값을 만들고 있지 않으면 null(로직은 자기 모델). 없으면 늘 null
   */
  observe?(time: number): SoundSnapshot | null;
  /** 로직 한 스텝마다(소리·이펙트·진동) */
  onStep(state: S, events: readonly E[]): void;
  /** 그리기(rAF 마다 최신 상태) */
  render(state: S): void;
  /** 상태 줄 */
  status(state: S): { phase: string; timeLeft: number | null };
  /** ?debug=1 요약 */
  debug(state: S, events: readonly E[]): string;
  /** 자유 카메라(관찰용): 켜면 원본 카메라 대신 마우스로 움직이는 카메라로 그린다. 로직·소리·UI 는 그대로 */
  setFreeCamera?(on: boolean): void;
  dispose(): void;
}

export interface ResultRow {
  player: number;
  value: string;
  rank: number;
  /** 시험용 데이터 속성(data-*) */
  data?: Record<string, string | number>;
}

export interface GameDef<S = unknown, E = unknown, R extends GameResult = GameResult> {
  /** 원본 모듈 이름(예 'mg1801') */
  id: string;
  title: string;
  /** 에셋 폴더(ASSETS 기준, manifest.json 이 입구) */
  assetsDir: string;
  players: number;
  hasPractice: boolean;
  /** 게임별 설정(없으면 설정 칸 없음) */
  options?: readonly GameOption[];
  createLogic(setup: GameSetup): GameLogic<S, E, R>;
  createView(ctx: ViewContext, assets: Assets): GameView<S, E>;
  describeResult(r: R, setup: GameSetup): { head: string; rows: ResultRow[] };
}

/** 고른 설정을 정리한다 — 없거나 choices 밖이거나 when 이 맞지 않으면 기본값 */
export function readOptions(options: readonly GameOption[] | undefined, given: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of options ?? []) {
    const v = given?.[o.key];
    out[o.key] = v !== undefined && o.choices.some((c) => c.value === v) ? v : o.def;
  }
  for (const o of options ?? []) if (o.when && !o.when.values.includes(out[o.when.key])) out[o.key] = o.def;
  return out;
}
