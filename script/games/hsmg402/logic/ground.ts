/**
 * 지면 — 원본은 PhysX 3.4 삼각 메시(map.nbmap → apx, 정점 337·삼각형 624)에 CastRay/CastShape(필터 12)와 액터 collisionGroundGeo 를 쓴다.
 * 웹은 docs/minigame/hsmg402.md 9.7 대로 **회전체 단면 해석식**으로 바꾼다(7.2 표, 48각, 7.5° 간격, 0° 에 정점, 바닥 면 없음).
 *
 * 48각 판정: 한 부채꼴(7.5°) 안의 두 고리 사이 면은 평면이고, 그 높이는 부채꼴 가운데 방향으로의 투영 d 에만 달린다.
 * 고리 i 는 d = R_i·cos(3.75°) 에 놓이므로 req = d / cos(3.75°) 로 단면 표를 선형 보간하면 원본 메시와 같은 면을 본다.
 * 0° 가 +X 축인지는 [추정](apx 정점 0번 방향 미확인). 원으로 바꾸면 오차 ≤ 0.016.
 *
 * 경사 처리(미끄러짐·벽 밀기)·CastShape 결과 구조(+0 위치, 플래그 bit1/bit2)는 [미확정 11.1 #3·#4]이라 넣지 않는다.
 * 액터는 "발 y ≤ h 이면 y = h, 접지", 굴러가는 공은 "면까지 거리 ≤ r 이면 면 법선으로 밀어냄" 만 한다.
 */
import { F } from '../../../core/fmath';
import { STAGE_RINGS } from './data';

export interface GroundHit {
  /** 그 수평 위치의 면 높이 */
  h: number;
  /** 면 법선(단위) */
  nx: number;
  ny: number;
  nz: number;
}

export interface Ground {
  /** 수평 (x, z) 아래 면. 메시 밖이면 null */
  at(x: number, z: number): GroundHit | null;
}

const SECTOR = (7.5 * Math.PI) / 180;
const HALF_COS = Math.cos(SECTOR / 2);

/** 원본 무대: 48각(또는 원) 회전체 */
export class StageGround implements Ground {
  constructor(private readonly use48 = true) {}

  at(x: number, z: number): GroundHit | null {
    const r = Math.hypot(x, z);
    let req = r;
    let mx = r > 0 ? x / r : 1;
    let mz = r > 0 ? z / r : 0;
    let scale = 1;
    if (this.use48 && r > 0) {
      let phi = Math.atan2(z, x);
      if (phi < 0) phi += 2 * Math.PI;
      const k = Math.floor(phi / SECTOR);
      const mid = (k + 0.5) * SECTOR;
      mx = Math.cos(mid);
      mz = Math.sin(mid);
      req = (x * mx + z * mz) / HALF_COS;
      scale = 1 / HALF_COS;
    }
    const rings = STAGE_RINGS;
    const last = rings[rings.length - 1];
    if (req > last[0]) return null;
    let i = 0;
    while (i < rings.length - 2 && req > rings[i + 1][0]) i++;
    const [r0, y0] = rings[i];
    const [r1, y1] = rings[i + 1];
    const s = (y1 - y0) / (r1 - r0);
    const h = y0 + s * (req - r0);
    const g = s * scale;
    const inv = 1 / Math.sqrt(1 + g * g);
    return { h: F(h), nx: F(-g * mx * inv), ny: F(inv), nz: F(-g * mz * inv) };
  }
}

/** 시험용: 반지름 R 원판(y=0), 밖은 지면 없음 — web/tools/analysis/hsmg402_player_calc.py 스텁과 같다 */
export class FlatDiscGround implements Ground {
  constructor(private readonly radius = 7.4971) {}

  at(x: number, z: number): GroundHit | null {
    return Math.hypot(x, z) <= this.radius ? { h: 0, nx: 0, ny: 1, nz: 0 } : null;
  }
}

/** 시험용: 끝없는 평면 y=0 */
export class FlatGround implements Ground {
  at(): GroundHit {
    return { h: 0, nx: 0, ny: 1, nz: 0 };
  }
}

/** 시험용: 지면 없음 */
export class NoGround implements Ground {
  at(): null {
    return null;
  }
}

/** CastRay(c → c − UnitY·len) 근사: 그 수평 위치의 면이 [c.y − len, c.y] 안에 있으면 맞음 */
export function castRayDown(g: Ground, x: number, y: number, z: number, len: number): boolean {
  const hit = g.at(x, z);
  return hit !== null && hit.h <= y && hit.h >= y - len;
}
