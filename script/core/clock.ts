/**
 * 시간 — 로직 한 step = 원본 한 프레임.
 *
 * [판독: docs/engine/01_core.md 4절] mps 는 SystemMain 프레임레이트 열거 기본값 0(고정 60)이고 바꾸는 경로(Lua 바인딩)의 사용처가 없다
 * → bex::GetDeltaTime = f32(1/60) = 0x3C888889 (FRAME_DT 와 비트 일치). hs::actor::ActorUtil::getDeltaTime 도 같은 상수다.
 * bex::ut::TimeCounter 는 엔진 델타(engine+0x18 = timeScale × 1/60)를 빼는데 timeScale 은 [미확정]이라 1.0(= FRAME_DT)으로 본다.
 * 파이버 Sleep 은 델타가 아니라 상수 1/60 을 뺀다(01_core 7.2).
 */
import { F } from './fmath';

export const FPS = 60;

/** 한 프레임의 델타 시간(초, f32) */
export const FRAME_DT = F(1 / FPS);

/** 브라우저 루프 한 스텝(ms) */
export const STEP_MS = 1000 / FPS;

/**
 * rAF 한 번에 도는 최대 스텝 수(2 s). 더 밀린 스텝은 다음 rAF 로 넘긴다 — 무거운 렌더(느린 GPU, 초당 1~2 장)에서도 로직이 시계를 따라가게.
 * 로직 스텝 하나는 mg1801 에서 0.5 ms 안쪽이다[실행: tools/sync_measure.ts, 화면 쪽 onStep 포함]
 */
export const MAX_STEPS = 120;

/** 밀린 스텝이 이보다 많으면(5 s, 긴 멈춤) 넘친 시간을 버린다(main.ts) */
export const MAX_BACKLOG_STEPS = 300;
