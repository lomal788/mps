/**
 * hsmg402::SnowHandPos — 손 위치 운반(pos_snowball 모델 루트). docs/minigame/hsmg402.md 6.9 [판독].
 * TickOrder 1, 메시지 0 → UpdatePos @0x7100015124: hand = CalculateDirectionZ(player)·0.5 + player.translation (fmul 후 fadd).
 * GetPos 는 모델 루트 위치(vt+0x250)다. 뼈 attach00 은 로직에 쓰이지 않는다(6.9 조정).
 */
import { F, type V3, type V4 } from '../../../core/fmath';

const HALF = F(0.5);

export class HandAnchor {
  /** pos_snowball 모델 루트 위치 */
  pos: V4 = { x: 0, y: 0, z: 0, w: 0 };

  updatePos(p: { readonly pos: V3; dirZ(): V4 }): void {
    const d = p.dirZ();
    this.pos = {
      x: F(F(d.x * HALF) + p.pos.x),
      y: F(F(d.y * HALF) + p.pos.y),
      z: F(F(d.z * HALF) + p.pos.z),
      w: 0,
    };
  }

  getPos(): V4 {
    return { ...this.pos };
  }

  /** GetVecZ — UpdatePos 는 위치만 놓으므로 모델 회전은 단위 회전 → (0,0,1) [추정] */
  getVecZ(): V4 {
    return { x: 0, y: 0, z: 1, w: 0 };
  }
}
