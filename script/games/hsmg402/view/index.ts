/**
 * hsmg402 데굴데굴 눈덩이 화면 — 로직 state(state.ts 계약)만 읽고 three.js·소리·UI 를 그린다. 원본 근거·근사 목록은 각 파일 머리 주석:
 *   stage.ts(무대·조명·안개·IBL·재질 근사), fluid.ts(눈 자국 높이장 — 원본 붓·복원·노멀 식), character.ts(캐릭터·모션·눈), balls.ts(눈덩이·부서짐), effects.ts(이펙트 — VFXB v40 원본 이미터 수치, 런타임 view/vfx.ts),
 *   camera.ts(cam_op/cam·결과 카메라), sound.ts(SE·BGM·보이스·3D), ui.ts(가이드·타이머·텔롭·진동), post.ts(블룸·톤맵·FXAA·비네트).
 * 에셋: assets/hsmg402/manifest.json + assets/chara(web/tools/analysis/hsmg402_web_assets.py). 모델을 못 읽으면 상자·구로 그린다(디버그 대체).
 *
 * 사건 → 화면 (원본 라벨 그대로):
 *   fx(ball/ballBreak/player) → effects.ts(트리거 → 이미터셋, 공 중심·공 배율에 붙임) + 같은 이름 SE 트리거(sound.fxTrigger). op 'stop' = 트리거 _Stop.
 *   VO_HSMG402_CMP_SB·VO_HSMG402_FALL(player) → 캐릭터 base 트리거 해석(SQ_VOI_DS_PCNN_JUMP/FALL), SNOW_FALL00 → 이펙트.
 *   seT → 1회 3D 재생 + L15, seLoop → 루프 핸들(L15 갱신·정지), upCamera → camera.ts, telop → ui.ts + 결과 징글, guide·timer → ui.ts.
 *   캐릭터 모션 ftrg(SNOW_MAKE00·SNOW_BREATH00·VO_*·SE_PC_WALK…·VB_*)는 state 의 motion/motionFrame 을 따라 화면이 낸다(state.ts 약속).
 *   흐름 단계 10(MainEnd) 진입 → BGM 정지 [추정].
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { V3 } from '../../../core/fmath';
import type { GameView, ViewContext } from '../../../game';
import type { Assets, Progress } from '../../../view/assets';
import { disposeScene, type Seen } from '../../../view/dispose';
import { Hud } from '../../../view/hud';
import type { Hsmg402Event, Hsmg402State, PlayerView } from '../state';
import { BallPool } from './balls';
import { CameraRig } from './camera';
import { type CharaIndexEntry, CharacterActor, CharacterTemplate } from './character';
import { type Anchor, Effects, type EffectsManifest, poseMatrix } from './effects';
import { loadLut3D, PostChain } from './post';
import { Hsmg402Sound, type SoundManifest } from './sound';
import { loadMatAnim, type Manifest, Stage } from './stage';
import { Hsmg402Ui, type VibInfo } from './ui';

type FullManifest = Manifest & SoundManifest & { ui: string; chara: string; vib: Record<string, VibInfo> };

const PLAYER_COLOR = [0xe5413a, 0x3a7be5, 0x3ab85a, 0xe5c23a];

interface PlayerTrack {
  motion: string;
  frame: number;
}

export class Hsmg402View implements GameView<Hsmg402State, Hsmg402Event> {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(22.62, 16 / 9, 0.1, 10000);
  private readonly rig = new CameraRig(this.camera);
  private freeCam: THREE.PerspectiveCamera | null = null;
  private freeControls: OrbitControls | null = null;
  private readonly hud: Hud;
  private readonly stage: Stage;
  private readonly fx: Effects;
  private readonly sound: Hsmg402Sound;
  private readonly ui: Hsmg402Ui;
  private readonly chara: Assets;
  private post: PostChain | null = null;
  private balls: BallPool | null = null;
  private actors: (CharacterActor | null)[] = [];
  private tpls: CharacterTemplate[] = [];
  /** 모델 대체(상자·구) */
  private readonly fallbackPlayers: THREE.Mesh[] = [];
  private readonly fallbackBalls: THREE.Mesh[] = [];
  private readonly tracks: PlayerTrack[] = [];
  /** 공에 붙은 이펙트 키 → 슬롯(공이 사라지면 Stop) */
  private readonly fxFollow = new Map<string, number>();
  /** 이펙트 붙는 곳이 읽는 마지막 state */
  private lastState: Hsmg402State | null = null;
  private started = false;
  private lastStage = -1;
  private lastRenderFrame = 0;
  private readonly fallbackLight: THREE.HemisphereLight;

  private readonly assets: Assets;
  /** 페이지가 준 Assets(하위 Assets 를 함께 푼다) */
  private readonly root: Assets;

  constructor(
    private readonly ctx: ViewContext,
    assets: Assets,
  ) {
    /* Assets.dir 는 끝에 '/' 가 있어야 한다(view/assets.ts). GameDef.assetsDir 가 'hsmg402' 면 하위 Assets 로 고쳐 쓴다 */
    this.assets = assets.dir.endsWith('/') ? assets : assets.sub(`${assets.dir}/`);
    this.root = assets;
    assets = this.assets;
    this.hud = new Hud(ctx.hud);
    this.scene.background = new THREE.Color(0x0b1420);
    this.stage = new Stage(this.scene);
    this.fx = new Effects(this.scene);
    this.sound = new Hsmg402Sound(assets, ctx.audio);
    this.sound.setCamera(this.camera);
    this.ui = new Hsmg402Ui(assets);
    this.chara = assets.sub('chara/');
    const geo = new THREE.CapsuleGeometry(0.5, 0.6, 4, 8);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: PLAYER_COLOR[i] }));
      m.visible = false;
      this.scene.add(m);
      this.fallbackPlayers.push(m);
    }
    const sg = new THREE.SphereGeometry(1.1, 16, 12);
    const sm = new THREE.MeshStandardMaterial({ color: 0xf4f8ff });
    for (let i = 0; i < 32; i++) {
      const m = new THREE.Mesh(sg, sm);
      m.visible = false;
      this.scene.add(m);
      this.fallbackBalls.push(m);
    }
    /* 대체 조명(무대를 못 읽었을 때만) */
    this.fallbackLight = new THREE.HemisphereLight(0xcfe4ff, 0x404858, 1.5);
    this.scene.add(this.fallbackLight);
  }

  async load(onProgress: Progress): Promise<void> {
    onProgress(0, 1, 'hsmg402 manifest');
    const man = await this.assets.json<FullManifest>('manifest.json');
    this.ui.vib = man.vib ?? {};
    await this.stage.load(this.assets, man, this.ctx.renderer.gl, onProgress);
    if (this.stage.loaded) {
      this.scene.background = null;
      this.fallbackLight.visible = false;
    }
    try {
      await this.rig.load(this.assets, man.anims);
    } catch (e) {
      console.warn('카메라 애니를 읽지 못했다', e);
    }
    onProgress(0, 1, 'snowball');
    try {
      const [ball, brk] = await Promise.all([this.assets.gltf(man.models.hsmg402_snowball.file), this.assets.gltf(man.models.hsmg402_snowball_break.file)]);
      const brkAnim = man.anims['hsmg402_snowball_break.fmab'] ? await loadMatAnim(this.assets, man.anims['hsmg402_snowball_break.fmab']) : null;
      this.balls = new BallPool(this.scene, ball, man.models.hsmg402_snowball, brk, man.models.hsmg402_snowball_break, brkAnim);
      this.stage.fluid.setBallModel(ball);
    } catch (e) {
      console.warn('눈덩이 모델을 읽지 못해 구로 그린다', e);
    }
    onProgress(0, 1, 'chara/index.json');
    const chars = this.ctx.setup.players.map((p) => p.char);
    try {
      const index = await this.chara.json<Record<string, CharaIndexEntry>>('index.json');
      const byKey = new Map<string, Promise<CharacterTemplate>>();
      for (const k of chars) if (index[k] && !byKey.has(k)) byKey.set(k, CharacterTemplate.load(this.chara, k, index[k]));
      const loaded = new Map<string, CharacterTemplate>();
      for (const [k, p] of byKey) loaded.set(k, await p);
      this.tpls = [...loaded.values()];
      this.actors = chars.map((k) => {
        const t = loaded.get(k) ?? loaded.get('pc01') ?? null;
        if (!t) return null;
        const a = new CharacterActor(t, this.stage.charaEnv);
        this.scene.add(a.root);
        return a;
      });
    } catch (e) {
      console.warn('캐릭터를 읽지 못해 상자로 그린다', e);
    }
    onProgress(0, 1, 'sound');
    try {
      await this.sound.load(man, onProgress);
    } catch (e) {
      console.warn('소리를 읽지 못했다', e);
    }
    onProgress(0, 1, 'ui');
    try {
      await this.ui.load(man.ui, chars);
    } catch (e) {
      console.warn('UI 를 읽지 못했다', e);
    }
    try {
      await this.fx.load(this.assets, man.effects as unknown as EffectsManifest);
    } catch (e) {
      console.warn('이펙트 텍스처를 읽지 못했다', e);
    }
    this.post = new PostChain(this.ctx.renderer.gl, man.env.post);
    if (man.env.lut) {
      try {
        this.post.setLut(await loadLut3D(this.assets, man.env.lut));
      } catch (e) {
        console.warn('색 보정 LUT 를 읽지 못했다', e);
      }
    }
    this.ctx.renderer.setPost(this.post);
    onProgress(1, 1, '완료');
  }

  private playerPos(p: PlayerView, up = 0): V3 {
    return { x: p.pos.x, y: p.pos.y + up, z: p.pos.z };
  }

  onStep(state: Hsmg402State, events: readonly Hsmg402Event[]): void {
    this.lastState = state;
    if (!this.started) {
      this.started = true;
      /* mgsound_setting mg_bgm_play_position = scene_start [데이터] */
      this.sound.startBgm();
      this.sound.play('SQ_AMB_BLZARD_1', { x: 0, y: 0, z: 0 });
      /* fld INITIALIZE(눈보라·별) — 무대 상시 [판독 문자열] */
      this.fx.startField();
    }
    if (state.stage !== this.lastStage) {
      if (state.stage === 10) this.sound.stopBgm();
      this.lastStage = state.stage;
    }
    for (const e of events) this.onEvent(state, e);
    this.motionEvents(state);
    for (let i = 0; i < state.players.length; i++) this.actors[i]?.step(state.players[i]);
    /* 공이 사라지면(state −1·null) 붙은 이펙트 Stop [추정: 모델이 지워질 때 트리거 정지]. 위치는 effects.update 가 붙는 곳에서 읽는다 */
    for (const [key, slot] of this.fxFollow) {
      const b = state.balls[slot];
      if (!b || b.state === -1) {
        this.fx.stop(key);
        this.fxFollow.delete(key);
      }
    }
    this.sound.update();
    this.ui.step(state);
  }

  private onEvent(state: Hsmg402State, e: Hsmg402Event): void {
    switch (e.k) {
      case 'fx': {
        if (e.owner === 'player') {
          const p = state.players[e.index];
          if (!p) break;
          if (e.name.startsWith('VO_')) {
            if (e.op !== 'play') break;
            const tpl = this.actors[e.index]?.tpl;
            for (const o of tpl?.code[e.name] ?? []) this.sound.play(o.label, this.playerPos(p, 1));
          } else if (e.op === 'play') this.fx.spawn(e.name, this.charaAnchor(e.index, this.fx.target(e.name)));
          break;
        }
        const key = `${e.owner}${e.index}`;
        this.sound.fxTrigger(e.name, e.op, e.pos, key);
        /* 공 모델(hsmg402_snowball / _break)에 붙은 FX 트리거: play = 재생, stop = _Stop */
        const fk = `${key}|${e.name}`;
        if (e.op === 'play') {
          this.fx.play(fk, e.name, this.ballAnchor(e.index));
          this.fxFollow.set(fk, e.index);
        } else {
          this.fx.stop(fk);
          this.fxFollow.delete(fk);
        }
        break;
      }
      case 'seT':
        this.sound.play(e.label, e.pos, { 15: e.t });
        break;
      case 'seLoop':
        this.sound.loop(e.label, e.ball, e.op, e.pos, e.t);
        break;
      case 'upCamera':
        this.rig.up = { player: e.player, angle: e.angle, time: e.time, distance: e.distance, height: e.height, startFrame: state.frame };
        break;
      case 'telop':
        if (e.op === 'start') {
          this.ui.telopStart(e.type, e.players);
          /* result_jingle_play_position 'telop'(;default) [추정], 라벨은 프리셋 치환으로 _MP03 */
          this.sound.play(e.type === 5 ? 'SM_JIN_MG_WIN' : 'SM_JIN_MG_DRAW');
        }
        break;
      case 'guide':
        if (e.op === 'in') this.ui.guideIn();
        else this.ui.guideOut();
        break;
      case 'timer':
        this.ui.timerStart();
        break;
      case 'se':
        this.sound.play(e.label);
        break;
      case 'se3d':
        this.sound.play(e.label, e.pos);
        break;
      case 'bgm':
        this.sound.startBgm();
        break;
      case 'bgmStop':
        this.sound.stopBgm();
        break;
      case 'effect':
        this.fx.spawn(e.name, e.pos);
        break;
      case 'vibrate':
        this.ui.vibrate(this.ctx.pads[e.player], e.name);
        break;
      default:
        break;
    }
  }

  /** 캐릭터 모션 ftrg 이벤트(지난 스텝 → 이번 스텝 사이 프레임) */
  private motionEvents(state: Hsmg402State): void {
    state.players.forEach((p, i) => {
      const a = this.actors[i];
      if (!a) return;
      const { name, frame } = a.resolve(p);
      const tr = this.tracks[i];
      const prev = tr && tr.motion === name ? tr.frame : -1;
      this.tracks[i] = { motion: name, frame };
      if (tr && tr.motion === name && frame === tr.frame) return;
      for (const ev of a.eventsBetween(name, prev, frame)) {
        for (const o of ev.out) {
          if (o.kind === 'se') this.sound.play(o.label, this.playerPos(p, 0.5));
          else if (o.kind === 'vib') this.ui.vibrate(this.ctx.pads[i], o.name);
          else if (o.kind === 'fx') {
            /* 캐릭터 공용 FX 트리거(SNOW_MAKE00·SNOW_BREATH00) → 대상 노드(ftrg +34 NDcha_pos)에 붙여 재생 */
            this.fx.spawn(ev.key, this.charaAnchor(i, this.fx.target(ev.key)));
          }
        }
      }
    });
  }

  /** 공 슬롯에 붙는 곳: 공 중심 + 균일 배율 b.scale [추정: 회전 없음, effects.ts 머리말] */
  private ballAnchor(slot: number): Anchor {
    const m = new THREE.Matrix4();
    return () => {
      const b = this.lastState?.balls[slot];
      if (!b || b.state === -1) return null;
      return poseMatrix(m, b.pos, b.scale);
    };
  }

  /** 캐릭터 노드(ftrg +34: NDcha_pos·attach_body)의 월드 행렬. 노드를 못 찾으면 발밑 위치 + 방향 */
  private charaAnchor(i: number, node: string | null): Anchor {
    const m = new THREE.Matrix4();
    let obj: THREE.Object3D | null | undefined;
    return () => {
      if (obj === undefined) obj = (node && this.actors[i]?.root.getObjectByName(node)) || null;
      if (obj) {
        obj.updateWorldMatrix(true, false);
        return m.copy(obj.matrixWorld);
      }
      const p = this.lastState?.players[i];
      return p ? poseMatrix(m, p.pos, 1, p.yaw) : null;
    };
  }

  render(state: Hsmg402State): void {
    const dt = Math.max(0, (state.frame - this.lastRenderFrame) / 60);
    this.lastRenderFrame = state.frame;
    this.stage.update(state.frame);
    state.players.forEach((p, i) => {
      const a = this.actors[i];
      const fb = this.fallbackPlayers[i];
      if (a) {
        a.pose(p, state.frame);
        if (fb) fb.visible = false;
      } else if (fb) {
        fb.visible = true;
        fb.position.set(p.pos.x, p.pos.y + 0.8, p.pos.z);
        fb.rotation.y = p.yaw;
      }
    });
    if (this.balls) this.balls.update(state.balls);
    else
      this.fallbackBalls.forEach((m, i) => {
        const b = state.balls[i];
        m.visible = !!b && b.state !== -1 && b.visible;
        if (b) {
          m.position.set(b.pos.x, b.pos.y, b.pos.z);
          m.scale.setScalar(b.scale);
        }
      });
    this.stage.fluid.update(this.ctx.renderer.gl, state, this.actors);
    this.fx.update(dt, state.frame);
    this.rig.update(state);
    this.freeControls?.update();
    this.ctx.renderer.render(this.scene, this.freeCam ?? this.camera);
    this.hud.clear();
    this.ui.draw(this.hud.ctx);
    if (Hud.debug) {
      this.hud.text(`hsmg402 단계 ${state.stage}/${state.sub} 남은 ${state.timerRemain.toFixed(2)} 카메라 ${state.camera.anim ?? '-'}:${state.camera.frame}`, 40, 30, { size: 32 });
      state.players.forEach((p, i) => this.hud.text(`${i + 1}P ${p.motion}:${p.motionFrame} act ${p.action.toString(16)} ${p.isFall ? '낙하' : ''} 순위 ${p.rank}`, 40, 80 + i * 40, { size: 28 }));
    }
  }

  status(state: Hsmg402State): { phase: string; timeLeft: number | null } {
    return { phase: `단계 ${state.stage}`, timeLeft: state.timerRunning ? Math.ceil(state.timerRemain) : null };
  }

  debug(state: Hsmg402State, events: readonly Hsmg402Event[]): string {
    const balls = state.balls.filter((b) => b && b.state !== -1).length;
    return `frame ${state.frame} stage ${state.stage} sub ${state.sub} timer ${state.timerRemain.toFixed(3)} balls ${balls}\nevents ${events.map((e) => e.k).join(' ')}`;
  }

  setFreeCamera(on: boolean): void {
    if (!on) {
      this.freeControls?.dispose();
      this.freeControls = null;
      this.freeCam = null;
      return;
    }
    if (this.freeCam) return;
    const cam = this.camera.clone();
    const c = new OrbitControls(cam, this.ctx.renderer.canvas);
    c.target.set(0, 0, 0);
    c.enableDamping = true;
    c.dampingFactor = 0.15;
    c.update();
    this.freeCam = cam;
    this.freeControls = c;
  }

  /** 판이 끝나면 이 판의 GPU 자원·소리·UI 를 모두 푼다(장면 → 모델 인스턴스 → 템플릿 → 에셋 캐시) */
  dispose(): void {
    this.setFreeCamera(false);
    this.ctx.renderer.setPost(null);
    this.post?.dispose();
    this.post = null;
    this.sound.dispose();
    this.ui.dispose();
    this.fx.dispose();
    this.balls?.dispose();
    this.balls = null;
    for (const a of this.actors) a?.dispose();
    this.actors = [];
    for (const t of this.tpls) t.dispose();
    this.tpls = [];
    this.stage.dispose();
    this.fxFollow.clear();
    const seen: Seen = new Set();
    disposeScene(this.scene, seen);
    this.root.dispose(seen);
  }
}
