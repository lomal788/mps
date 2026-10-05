/**
 * three.js 자원 해제 — 장면에서 빼기만 하면 GPU 텍스처·버퍼와 렌더러 내부 캐시(지오메트리별 VAO)가 남는다.
 * 게임 화면은 판이 끝날 때(view.dispose) 자기 장면과 에셋 캐시를 이 함수들로 모두 푼다.
 * 같은 지오메트리·재질·텍스처를 여러 번 만나도 한 번만 푼다(seen).
 */
import * as THREE from 'three';

export type Seen = Set<object>;

function disposeTexture(t: unknown, seen: Seen): void {
  if (!(t instanceof THREE.Texture) || seen.has(t)) return;
  seen.add(t);
  t.dispose();
}

function disposeValue(v: unknown, seen: Seen): void {
  if (v instanceof THREE.Texture) disposeTexture(v, seen);
  else if (Array.isArray(v)) for (const x of v) disposeTexture(x, seen);
}

export function disposeMaterial(m: THREE.Material, seen: Seen = new Set()): void {
  if (seen.has(m)) return;
  seen.add(m);
  for (const v of Object.values(m)) disposeValue(v, seen);
  const uniforms = (m as THREE.ShaderMaterial).uniforms;
  if (uniforms) for (const u of Object.values(uniforms)) disposeValue(u?.value, seen);
  m.dispose();
}

/** root 아래 메시의 지오메트리·재질·텍스처, 스킨 뼈 텍스처, 빛 그림자 맵을 푼다 */
export function disposeTree(root: THREE.Object3D, seen: Seen = new Set()): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !seen.has(mesh.geometry)) {
      seen.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const m of mat) disposeMaterial(m, seen);
    else if (mat) disposeMaterial(mat, seen);
    const sk = (o as THREE.SkinnedMesh).skeleton;
    if (sk && !seen.has(sk)) {
      seen.add(sk);
      sk.dispose();
    }
    const light = o as THREE.DirectionalLight;
    if (light.isLight && light.shadow?.map) light.shadow.dispose();
  });
}

/** 장면 전체(배경·환경맵 포함)를 풀고 비운다 */
export function disposeScene(scene: THREE.Scene, seen: Seen = new Set()): void {
  disposeTree(scene, seen);
  disposeValue(scene.background, seen);
  disposeValue(scene.environment, seen);
  scene.background = null;
  scene.environment = null;
  scene.clear();
}
