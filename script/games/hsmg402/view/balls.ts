/**
 * hsmg402 눈덩이 — 슬롯 32칸(원본 SnowBallMgr)마다 hsmg402_snowball 과 hsmg402_snowball_break 모델 하나씩.
 *
 * 원본 그대로 [데이터·판독]:
 *   - 공 위치 = state 의 모델 위치, 크기 = scale(겉보기 반지름 1.1 × scale — 모델 snowball_low 노드 스케일 1.1 이 glb 안에 있다),
 *     굴림 회전 = state.rot(로직이 HsModel::Rotate 를 누적한 쿼터니언)
 *   - 부서짐: breakVisible 동안 snowball_break 를 같은 위치·같은 scale 로(SetScale 은 두 모델 모두, docs 6.9), 뼈 애니 50f 1회를 breakFrame 으로,
 *     재질 애니 blendColor.a(0~30f 1 → 50f 0)를 breakFrame 으로
 *   - state −1(삭제 대기)·null 은 숨김
 *   - 부서짐 모델은 굴림 회전을 받지 않는다 [추정: 조각이 −y 로 떨어지는 애니라 회전을 곱하면 낙하 방향이 돈다]
 * 재질: material.ts 규칙(눈 그래프 4268919678 — 램프 확산 fld_dif·림·최종 곱 snowball_alb(1,0), web/docs/engine/03_graphics.md).
 * 근사: 자체 국소 IBL(snowball_rad/irr, use_local_ibl)은 장면 IBL 로 대신하고 irradianceColorScale 만 곱한다. snowball_fluid(높이장 붓)은 그리지 않는다.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BallView } from '../state';
import { type MatAnim, type ModelInfo, ModelInst } from './stage';

export const SLOTS = 32;

interface Slot {
  ball: ModelInst;
  brk: ModelInst;
}

export class BallPool {
  private readonly slots: Slot[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    ball: GLTF,
    ballInfo: ModelInfo | undefined,
    brk: GLTF,
    brkInfo: ModelInfo | undefined,
    private readonly brkAnim: MatAnim | null,
  ) {
    for (let i = 0; i < SLOTS; i++) {
      const s = { ball: new ModelInst(ball, ballInfo), brk: new ModelInst(brk, brkInfo) };
      s.ball.root.visible = false;
      s.brk.root.visible = false;
      this.scene.add(s.ball.root, s.brk.root);
      this.slots.push(s);
    }
  }

  update(balls: readonly (BallView | null)[]): void {
    for (let i = 0; i < SLOTS; i++) {
      const s = this.slots[i];
      const b = balls[i];
      if (!b || b.state === -1) {
        s.ball.root.visible = false;
        s.brk.root.visible = false;
        continue;
      }
      s.ball.root.visible = b.visible;
      s.ball.root.position.set(b.pos.x, b.pos.y, b.pos.z);
      s.ball.root.scale.setScalar(b.scale);
      s.ball.root.quaternion.set(b.rot.x, b.rot.y, b.rot.z, b.rot.w);
      s.brk.root.visible = b.breakVisible;
      if (b.breakVisible) {
        s.brk.root.position.set(b.pos.x, b.pos.y, b.pos.z);
        s.brk.root.scale.setScalar(b.scale);
        s.brk.setSkelFrame(b.breakFrame);
        if (this.brkAnim) s.brk.applyMatAnim(this.brkAnim, b.breakFrame);
      }
    }
  }

  dispose(): void {
    for (const s of this.slots) {
      s.ball.dispose();
      s.brk.dispose();
      s.ball.root.removeFromParent();
      s.brk.root.removeFromParent();
    }
    this.slots.length = 0;
  }
}
