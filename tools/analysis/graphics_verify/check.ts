// Independent load check of converted glb with three.js GLTFLoader (node, no textures).
// usage: node web/tools/analysis/graphics_verify/run.mjs web/tools/analysis/graphics_verify/check.ts <set> [<set>...]
// writes extracted/converted/graphics/<set>/verify_three.json
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const ROOT = path.resolve(path.dirname(process.argv[1]), '../../../..');
const OUT = path.join(ROOT, 'extracted/converted/graphics');

// Textures are not decoded in node: answer every texture request with an empty Texture.
const stubTextures = (parser: any) => ({ name: 'stub_textures', loadTexture: () => Promise.resolve(new THREE.Texture()) });

function parse(buf: Buffer): Promise<any> {
  const loader = new GLTFLoader();
  loader.register(stubTextures as any);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => loader.parse(ab, '', res, rej));
}

const POSE_BONES = ['pelvis', 'spine00', 'head', 'L_upperarm', 'R_upperarm', 'R_hand', 'attach_R_hand', 'L_thigh'];

async function checkSet(set: string) {
  const dir = path.join(OUT, set);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const report: any = { set, models: {} };
  let fails = 0;
  for (const [name, m] of Object.entries<any>(manifest.models)) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta', name + '.json'), 'utf8'));
    const gltf = await parse(fs.readFileSync(path.join(dir, m.url)));
    const scene: THREE.Object3D = gltf.scene;
    scene.updateMatrixWorld(true);
    const r: any = { errors: [] as string[] };
    // meshes / vertex counts
    let verts = 0, tris = 0, meshes = 0;
    const meshByName: Record<string, THREE.Mesh> = {};
    scene.traverse((o: any) => {
      if (o.isMesh) {
        meshes++;
        verts += o.geometry.attributes.position.count;
        tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
        meshByName[o.name] = o;
      }
    });
    r.meshes = meshes; r.vertices = verts; r.triangles = tris;
    if (meshes !== meta.meshes.length) r.errors.push(`mesh count ${meshes} != ${meta.meshes.length}`);
    if (verts !== meta.vertexCount) r.errors.push(`vertices ${verts} != ${meta.vertexCount}`);
    if (tris !== meta.triangleCount) r.errors.push(`triangles ${tris} != ${meta.triangleCount}`);
    // bone names preserved
    const missing = meta.boneNames.filter((b: string) => !scene.getObjectByName(b));
    r.bonesMissing = missing.length;
    if (missing.length) r.errors.push('bones missing: ' + missing.slice(0, 5).join(','));
    // skinning: bind pose must reproduce the stored positions
    let maxBindErr = 0, skinned = 0;
    scene.traverse((o: any) => {
      if (!o.isSkinnedMesh) return;
      skinned++;
      if (o.skeleton.bones.length !== meta.bones) r.errors.push(`skeleton bones ${o.skeleton.bones.length} != ${meta.bones}`);
      const pos = o.geometry.attributes.position;
      const v = new THREE.Vector3(), w = new THREE.Vector3();
      o.skeleton.update();
      for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 500))) {
        v.fromBufferAttribute(pos, i);
        w.copy(v);
        o.applyBoneTransform(i, w);
        maxBindErr = Math.max(maxBindErr, w.distanceTo(v));
      }
    });
    r.skinnedMeshes = skinned; r.bindPoseSkinErr = maxBindErr;
    if (maxBindErr > 1e-4) r.errors.push('bind pose skin error ' + maxBindErr);
    // bounding box (model space)
    const box = new THREE.Box3().setFromObject(scene);
    r.bbox = { min: box.min.toArray().map((x) => +x.toFixed(4)), max: box.max.toArray().map((x) => +x.toFixed(4)) };
    // clips
    r.clips = {};
    for (const clip of gltf.animations as THREE.AnimationClip[]) {
      const mc = meta.clips.find((c: any) => c.name === clip.name);
      const expect = mc ? mc.frames / 60 : NaN;
      r.clips[clip.name] = { duration: clip.duration, frames: mc?.frames, tracks: clip.tracks.length };
      if (!(Math.abs(clip.duration - expect) < 1e-5) && !(mc && mc.frames === 0)) r.errors.push(`clip ${clip.name} duration ${clip.duration} != ${expect}`);
      // sample local TRS of a few bones at a few frames (for the python curve cross-check)
      const mixer = new THREE.AnimationMixer(scene);
      const act = mixer.clipAction(clip);
      act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; act.play();
      const samples: any = {};
      const names = POSE_BONES.filter((b) => scene.getObjectByName(b)).concat(meta.boneNames.slice(0, 4));
      for (const f of [0, Math.floor(mc?.frames / 2) || 0, Math.max(0, (mc?.frames ?? 1) - 1)]) {
        mixer.setTime(f / 60);
        scene.updateMatrixWorld(true);
        const fr: any = {};
        for (const b of names) {
          const o = scene.getObjectByName(b)!;
          const wp = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
          fr[b] = { t: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(), world: wp.toArray() };
        }
        samples[f] = fr;
      }
      r.clips[clip.name].samples = samples;
      mixer.stopAllAction(); mixer.uncacheRoot(scene);
      scene.traverse((o: any) => { if (o.userData?.boneIndex !== undefined || true) {} });
    }
    r.morph = Object.fromEntries(Object.entries(meshByName).filter(([, mm]: any) => mm.morphTargetDictionary).map(([k, mm]: any) => [k, Object.keys(mm.morphTargetDictionary)]));
    fails += r.errors.length;
    report.models[name] = r;
    console.log(`${set}/${name}: meshes=${meshes} verts=${verts} tris=${tris} skinned=${skinned} bindErr=${maxBindErr.toExponential(2)} clips=${gltf.animations.length} errors=${r.errors.length}${r.errors.length ? ' ' + r.errors.join('; ') : ''}`);
  }
  report.errors = fails;
  fs.writeFileSync(path.join(dir, 'verify_three.json'), JSON.stringify(report, null, 1));
  console.log(`${set}: ${Object.keys(report.models).length} models, ${fails} errors`);
}

for (const s of process.argv.slice(2)) await checkSet(s);
