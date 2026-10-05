/**
 * HUD — WebGL 캔버스 위에 겹친 2D 캔버스. 좌표는 원본 기준 해상도(1920×1080)로 그린다.
 * 원본 UI 레이아웃(.lyt)은 view/lyt.ts 재생기가 그려서 이 캔버스에 겹친다. 이 도구의 글자는 디버그 표시(?debug=1)용이다.
 */
import { SCREEN_H, SCREEN_W } from './renderer';

export class Hud {
  /** ?debug=1 — 글자 디버그 표시를 켠다 */
  static readonly debug: boolean = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';

  constructor(readonly ctx: CanvasRenderingContext2D) {
    ctx.canvas.width = SCREEN_W;
    ctx.canvas.height = SCREEN_H;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
  }

  text(s: string, x: number, y: number, opts: { size?: number; color?: string; align?: CanvasTextAlign } = {}): void {
    const c = this.ctx;
    c.font = `bold ${opts.size ?? 48}px system-ui, sans-serif`;
    c.textAlign = opts.align ?? 'left';
    c.textBaseline = 'top';
    c.lineWidth = 8;
    c.strokeStyle = 'rgba(0,0,0,0.8)';
    c.strokeText(s, x, y);
    c.fillStyle = opts.color ?? '#fff';
    c.fillText(s, x, y);
  }
}
