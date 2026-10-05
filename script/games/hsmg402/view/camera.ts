/**
 * hsmg402 카메라 — 원본 bex::Camera 애니 표 [0] env/hsmg402_cam_op.fsnb, [1] env/hsmg402_cam.fsnb [데이터·판독 3.2·7.4].
 *   - Aim 모드: 위치 pos·주시점 aim, fovy 0.39479113 rad = 22.62° **세로 전체각**(nn::bezel::Camera::SetProjectionPerspectiveFovy 가 fovy×0.5 로 계산 [판독]),
 *     near 0.1 / far 10000. cam_op 120f(0~60f 정지, 61~120f 에르밋으로 다가옴)는 변환기가 굽힌 프레임 배열을 그대로 쓴다.
 *   - 어느 애니를 몇 프레임으로 보일지는 로직 state.camera(anim, frame)가 정한다(단계 0·5·6 의 PlayAnim/StopAnim). anim 이 없으면 cam_op 0 프레임 [추정].
 *   - aspect: 카메라 애니 적용기(main @0x71006522ec)는 애니 user data 에 bezel_apply_aspect = 1 이 있을 때만 파일 aspect(1.78)를 쓰고, 없으면
 *     nn::bezel::Camera::GetAspectRatio(화면 비)를 쓴다 [판독]. hsmg402 fsnb 두 개(그리고 전체 fsnb 451개)에 그 키가 없다 [데이터] → 화면 16:9.
 * 결과 카메라 MiniGameFinishPlayerUpCamera(승자 1명): 각 24.7°·0.8 초·거리 12.8·주시 높이 1.5 [판독 값] — 보간 식은 main 클래스 미판독이라
 *   게임 카메라에서 목표(승자 + (0, 1.5, 0) 를 +Z 쪽 24.7° 위에서 12.8 거리로 봄)까지 smoothstep 으로 옮긴다 [근사].
 */
import * as THREE from 'three';
import type { Assets } from '../../../view/assets';
import type { Hsmg402State } from '../state';

interface CamJson {
  sceneAnims: { cameras: { frames: number; pos: number[][]; rotOrAim: number[][]; fovyRad: number[]; near: number[]; far: number[] }[] }[];
}

interface CamAnim {
  frames: number;
  pos: number[][];
  aim: number[][];
  fovy: number[];
  near: number[];
  far: number[];
}

export interface UpCamera {
  player: number;
  angle: number;
  time: number;
  distance: number;
  height: number;
  startFrame: number;
}

const at = <T>(a: T[], f: number): T => a[Math.min(a.length - 1, Math.max(0, Math.round(f)))];

export class CameraRig {
  private anims: Record<string, CamAnim> = {};
  up: UpCamera | null = null;
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.position.set(0, 12.5, 27.17857);
    camera.lookAt(0, 0, 0);
  }

  async load(assets: Assets, files: Record<string, string>): Promise<void> {
    for (const [key, file] of [
      ['cam_op', files['hsmg402_cam_op.fsnb']],
      ['cam', files['hsmg402_cam.fsnb']],
    ] as const) {
      if (!file) continue;
      const d = await assets.json<CamJson>(file);
      const c = d.sceneAnims[0]?.cameras[0];
      if (c) this.anims[key] = { frames: c.frames, pos: c.pos, aim: c.rotOrAim, fovy: c.fovyRad, near: c.near, far: c.far };
    }
  }

  update(state: Hsmg402State): void {
    const cam = this.camera;
    const name = state.camera.anim ?? 'cam_op';
    const a = this.anims[name] ?? this.anims.cam;
    if (!a) return;
    const f = name === 'cam_op' && !state.camera.anim ? 0 : state.camera.frame;
    const p = at(a.pos, f);
    const q = at(a.aim, f);
    cam.fov = (at(a.fovy, f) * 180) / Math.PI;
    cam.near = at(a.near, f);
    cam.far = at(a.far, f);
    this.v.set(p[0], p[1], p[2]);
    this.w.set(q[0], q[1], q[2]);
    const up = this.up;
    const target = up ? state.players[up.player] : undefined;
    if (up && target) {
      const k = Math.min(1, Math.max(0, (state.frame - up.startFrame) / Math.max(1, up.time * 60)));
      const s = k * k * (3 - 2 * k);
      const ang = (up.angle * Math.PI) / 180;
      const lx = target.pos.x;
      const ly = target.pos.y + up.height;
      const lz = target.pos.z;
      const px = lx;
      const py = ly + Math.sin(ang) * up.distance;
      const pz = lz + Math.cos(ang) * up.distance;
      this.v.lerp(new THREE.Vector3(px, py, pz), s);
      this.w.lerp(new THREE.Vector3(lx, ly, lz), s);
    }
    cam.position.copy(this.v);
    cam.lookAt(this.w);
    cam.updateProjectionMatrix();
  }
}
