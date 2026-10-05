/**
 * 렌더러 — three.js WebGLRenderer 하나를 페이지가 만들고 게임 화면이 빌려 쓴다.
 * 원본 기준 해상도는 1920×1080(boot.nbinit BaseWidth/Height) [데이터]. 캔버스 내부 해상도는 SCREEN_W×SCREEN_H 비율(16:9)을 지키고,
 * 실제 픽셀 수는 표시 크기 × devicePixelRatio 로 맞춘다.
 * 게임 화면이 포스트 체인(PostRenderer)을 걸면 render() 가 그 체인으로 그린다(HDR 타깃 → 블룸·톤맵 등). 끝나면 null 로 푼다.
 */
import * as THREE from 'three';

export const SCREEN_W = 1920;
export const SCREEN_H = 1080;

/** 장면을 받아 화면까지 그리는 포스트 체인 */
export interface PostRenderer {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private post: PostRenderer | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.setClearColor(0x404040, 1);
    this.resize();
  }

  /** 표시 크기가 바뀌면 부른다 */
  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, Math.round((w * SCREEN_H) / SCREEN_W));
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.gl.setSize(w, h, false);
  }

  get aspect(): number {
    return SCREEN_W / SCREEN_H;
  }

  clear(): void {
    this.gl.clear();
  }

  setPost(post: PostRenderer | null): void {
    this.post = post;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.post) this.post.render(scene, camera);
    else this.gl.render(scene, camera);
  }

  dispose(): void {
    this.gl.dispose();
  }
}
