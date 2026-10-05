/**
 * 입력(공용) — 키보드·Gamepad API → PadInput(Switch Npad 형식, core/pad.ts).
 * - 키보드(첫 사람): WASD/방향키 = 왼쪽 스틱, J = A, K = B, U = X, I = Y, Q = L, E = R, Enter = +, Backspace = −.
 * - 게임패드(표준 매핑): 0=B 1=A 2=Y 3=X (닌텐도 배치: 아래=B, 오른쪽=A), 4=L 5=R 6=ZL 7=ZR 8=− 9=+ 12~15=십자, 축 0·1·2·3=스틱.
 * 사람 플레이어는 슬롯 순서대로 패드 0, 1, … 를 받고 첫 사람은 키보드도 함께 쓴다.
 */
import { NPAD, STICK_MAX, emptyPad, type PadInput } from '../core/pad';

/** 진동 포락선 한 구간: ms 동안 dual-rumble 세기(0..1). strong = 저역 모터, weak = 고역 모터 */
export interface VibSegment {
  ms: number;
  strong: number;
  weak: number;
}

export interface PadSource {
  read(): PadInput | null;
  /** 진동: ms 동안 */
  rumble?(ms: number): void;
  /** 진동 포락선을 구간 순서대로 재생한다. 새로 부르면 앞 재생을 끊는다 */
  vibrate?(segments: readonly VibSegment[]): void;
}

const axis = (v: number): number => Math.max(-STICK_MAX, Math.min(STICK_MAX, Math.round(v * STICK_MAX)));

const KEY_BUTTONS: Record<string, number> = {
  KeyJ: NPAD.A,
  KeyK: NPAD.B,
  KeyU: NPAD.X,
  KeyI: NPAD.Y,
  KeyQ: NPAD.L,
  KeyE: NPAD.R,
  Enter: NPAD.PLUS,
  Backspace: NPAD.MINUS,
};

export class KeyboardPad implements PadSource {
  readonly pressed = new Set<string>();
  private readonly down = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    this.pressed.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };
  private readonly up = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
  };
  private readonly blur = (): void => this.pressed.clear();

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.down);
    target.addEventListener('keyup', this.up);
    target.addEventListener('blur', this.blur);
  }

  read(): PadInput {
    const k = this.pressed;
    const p = emptyPad();
    for (const [code, b] of Object.entries(KEY_BUTTONS)) if (k.has(code)) p.buttons |= b;
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    const up = k.has('ArrowUp') || k.has('KeyW');
    const down = k.has('ArrowDown') || k.has('KeyS');
    p.lx = axis((right ? 1 : 0) - (left ? 1 : 0));
    p.ly = axis((up ? 1 : 0) - (down ? 1 : 0));
    return p;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.down);
    this.target.removeEventListener('keyup', this.up);
    this.target.removeEventListener('blur', this.blur);
  }
}

const GP_BUTTONS: [number, number][] = [
  [0, NPAD.B],
  [1, NPAD.A],
  [2, NPAD.Y],
  [3, NPAD.X],
  [4, NPAD.L],
  [5, NPAD.R],
  [6, NPAD.ZL],
  [7, NPAD.ZR],
  [8, NPAD.MINUS],
  [9, NPAD.PLUS],
  [12, NPAD.UP],
  [13, NPAD.DOWN],
  [14, NPAD.LEFT],
  [15, NPAD.RIGHT],
];

export class GamepadPad implements PadSource {
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(readonly index: number) {}

  private pad(): Gamepad | null {
    return navigator.getGamepads?.()[this.index] ?? null;
  }

  read(): PadInput | null {
    const g = this.pad();
    if (!g) return null;
    const p = emptyPad();
    for (const [i, b] of GP_BUTTONS) if (g.buttons[i]?.pressed) p.buttons |= b;
    p.lx = axis(g.axes[0] ?? 0);
    p.ly = axis(-(g.axes[1] ?? 0));
    p.rx = axis(g.axes[2] ?? 0);
    p.ry = axis(-(g.axes[3] ?? 0));
    return p;
  }

  rumble(ms: number): void {
    const act = this.pad()?.vibrationActuator;
    void act?.playEffect('dual-rumble', { duration: ms, strongMagnitude: 0.6, weakMagnitude: 0.4 }).catch(() => undefined);
  }

  /**
   * Gamepad 는 진폭을 연속으로 바꿀 수 없어 구간마다 playEffect 를 다시 부른다(뒤 호출이 앞 효과를 대신한다).
   * 주파수는 표현할 수 없다 [근사: 05_ui_input 7.7].
   */
  vibrate(segments: readonly VibSegment[]): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    let at = 0;
    for (const seg of segments) {
      const play = (): void => {
        const act = this.pad()?.vibrationActuator;
        void act?.playEffect('dual-rumble', { startDelay: 0, duration: seg.ms, strongMagnitude: seg.strong, weakMagnitude: seg.weak }).catch(() => undefined);
      };
      if (at === 0) play();
      else this.timers.push(setTimeout(play, at));
      at += seg.ms;
    }
  }
}

/** 키보드와 패드를 합친다(버튼 OR, 스틱은 큰 쪽) */
class MergedPad implements PadSource {
  constructor(private readonly srcs: PadSource[]) {}

  read(): PadInput | null {
    let out: PadInput | null = null;
    for (const s of this.srcs) {
      const p = s.read();
      if (!p) continue;
      if (!out) {
        out = { ...p };
        continue;
      }
      out.buttons |= p.buttons;
      for (const a of ['lx', 'ly', 'rx', 'ry'] as const) if (Math.abs(p[a]) > Math.abs(out[a])) out[a] = p[a];
    }
    return out;
  }

  rumble(ms: number): void {
    for (const s of this.srcs) s.rumble?.(ms);
  }

  vibrate(segments: readonly VibSegment[]): void {
    for (const s of this.srcs) s.vibrate?.(segments);
  }
}

/** 플레이어 슬롯마다 입력원. CPU 는 null */
export function padSourcesFor(isCom: readonly boolean[], keyboard: KeyboardPad): (PadSource | null)[] {
  let next = 0;
  return isCom.map((com) => {
    if (com) return null;
    const i = next++;
    return i === 0 ? new MergedPad([keyboard, new GamepadPad(0)]) : new GamepadPad(i);
  });
}
