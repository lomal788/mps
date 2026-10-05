/**
 * 패드 입력 — Switch Npad 한 개의 한 프레임. 로직은 이 원시 값만 받는다.
 * 버튼 비트와 스틱 범위는 nn::hid::NpadButton / AnalogStickState 공개 문서(switchbrew HID services) 기준이다 [문서].
 * 게임별로 어떤 버튼을 읽는지는 게임 판독 문서에 적는다(예: mg1801 Player::PadDriver).
 */

export const NPAD = {
  A: 1 << 0,
  B: 1 << 1,
  X: 1 << 2,
  Y: 1 << 3,
  STICK_L: 1 << 4,
  STICK_R: 1 << 5,
  L: 1 << 6,
  R: 1 << 7,
  ZL: 1 << 8,
  ZR: 1 << 9,
  PLUS: 1 << 10,
  MINUS: 1 << 11,
  LEFT: 1 << 12,
  UP: 1 << 13,
  RIGHT: 1 << 14,
  DOWN: 1 << 15,
} as const;

/** 스틱 축 최대값(±32767) */
export const STICK_MAX = 32767;

export interface PadInput {
  /** NPAD 비트 */
  buttons: number;
  /** 왼쪽 스틱 −32767..32767 (위가 +) */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  /** 가속도(G). 모션 조작 게임만 쓴다(원본 bex::InputModule::GetAcc). 없으면 0 */
  accX: number;
  accY: number;
  accZ: number;
}

export const emptyPad = (): PadInput => ({ buttons: 0, lx: 0, ly: 0, rx: 0, ry: 0, accX: 0, accY: 0, accZ: 0 });

/** 4명의 프레임 입력. 누름(down)·뗌(up)은 앞 프레임과 비교해 만든다 */
export class Pads {
  readonly now: PadInput[] = [emptyPad(), emptyPad(), emptyPad(), emptyPad()];
  readonly down = [0, 0, 0, 0];
  readonly up = [0, 0, 0, 0];

  read(src: readonly (PadInput | null | undefined)[]): void {
    for (let i = 0; i < 4; i++) {
      const prev = this.now[i].buttons;
      const p = src[i] ?? emptyPad();
      this.now[i] = { ...p };
      this.down[i] = p.buttons & ~prev;
      this.up[i] = prev & ~p.buttons;
    }
  }
}
