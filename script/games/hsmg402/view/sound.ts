/**
 * hsmg402 소리 — 로직 사건(원본 라벨) → assets/hsmg402/manifest.json(web/tools/analysis/hsmg402_web_assets.py).
 *
 * 원본 그대로 [데이터·판독]:
 *   - 효과음 10종(subarc_hsmg402)·환경음 SQ_AMB_BLZARD_1·캐릭터 보이스(SQ_VOI_DS_PCNN_*)·발소리(SQ_SE_FS_PCNN_*_SNOW)는 시퀀스 원본 명령을
 *     웹에서 실시간으로 돈다(view/seq.ts). 그래서 L15(공 크기 T)에 따른 볼륨 base + T·m/127 과 pitch bend 127 − T 는 시퀀스의
 *     setvar/mulvar/divvar·bend 명령이 원본 그대로 계산한다(docs 6.12·7.7). 루프 3종(YKD_MOV·YKD_MAX_SHN·YKD_FIR_MOV)은 원본 시퀀스가 스스로 반복하고
 *     정지(Stop) 때 끊는다. 로직의 seLoop 'update' 는 재생 중 L15 를 바꾼다(WriteTrackLocalVariable 0xf).
 *   - FX 트리거 이름 → SE(ftrg se_hsmg402_snowball): SNOWBALL_APPEAR00 → YKD_APP, SNOWBALL_MAX00 → YKD_MAX + YKD_MAX_SHN, _Stop → YKD_MAX_SHN 정지,
 *     SNOWBALL_THROW0%d → YKD_FIR.
 *   - 프리셋 hsmg402 치환('b' 레코드): SQ_SE_MFA_VOLUME0_SNOW_MAKE00 → SQ_SE_HSMG402_SB_MAKE00, SM_JIN_MG_WIN → _MP03, LOSE·DRAW → DRAW_MP03,
 *     SQ_SE_PLY_DMG_CLASH → _SNOW.
 *   - BGM SM_BGM_HSMG103_402_702_810_JMP(BFSTM 디코드 그대로): 재생 위치 scene_start(mgsound_setting) — 화면 첫 스텝에 시작.
 *     리전 INTRO_00~03(0~3.556 s) 뒤 REG_SEQ_MAIN(MAIN_00 시작 3.556 s ~ MAIN_01 끝 36.067 s) 반복(jump_setting CSV TRUE).
 *   - 3D(Play3D): FSAR 3D 정보(flags 0x7/0x5, decayRatio 0.5, 로그 곡선)를 view/audio.ts calc3d(원본 Sound3DEngine 판독)로 계산한다.
 * 근사·추정:
 *   - 3D 리스너: 프리셋 hsmg402 ']' 레코드 2개(번호 0: maxVolumeDistance 100·unitDistance 50, 번호 4: 16.6·10)를 mpj 'P' 레코드 배치로 읽은 값
 *     [추정]. 위치 = 카메라 + 오프셋 앞 세 칸. 출력 리스너가 둘이라 calc3d 규칙대로 팬은 0, 볼륨은 최댓값(무대 안은 1).
 *   - 같은 플레이어(PLY_*) 동시 재생 한도를 넘으면 가장 오래된 것을 멈춘다 [추정: nn::atk 공개 동작, 우선순위 비교는 생략].
 *   - 보이스의 USER_PROC_RANDOM_VOICE(userproc)는 seq.ts 가 처리하지 않아 변형 하나(L14 = 1)만 난다 [근사].
 *   - BGM 정지 = FINISH(단계 10 진입) 때 [추정], 페이드 길이 FADE_TIME_02 값 미판독 → 0.5 초 [근사].
 *   - 결과 징글 = 텔롭 Start 때(result_jingle_play_position 'telop', ;default 행 [추정]). 승자 텔롭(type 5) SM_JIN_MG_WIN, 무승부(type 6) SM_JIN_MG_DRAW.
 *   - 환경음은 장면 시작부터 원점 3D 로 [추정: 프리셋 e/a 레코드, 재생 위치 미판독]. 사운드 공간 이펙트(EFFECT_SND_SP_HSMG_MTN)는 없다.
 *   - 시작 텔롭·카운트다운·FINISH 의 시스템 SE·보이스는 main 흐름(미판독)이라 내지 않는다.
 */
import type * as THREE from 'three';
import type { V3 } from '../../../core/fmath';
import type { Assets } from '../../../view/assets';
import { type AudioOut, type Bus, calc3d, type Listener3d, type Sound3dInfo } from '../../../view/audio';
import { SeqEngine, type SeqData, type SeqSound } from '../../../view/seq';

interface PlayerInfo {
  name: string;
  max: number;
}
type Entry =
  | { kind: 'stream'; bus: Bus; file: string; gain: number; durationSec: number; loop: { startSec: number; endSec: number } | null }
  | { kind: 'seq'; bus: Bus; player: PlayerInfo | null; playerPriority: number; sound3d: Sound3dInfo | null; seq: SeqData };

export interface SoundManifest {
  sounds: Record<string, Entry>;
  substitute: Record<string, string>;
  listener3d: { preset: { index: number; offset: number[]; interiorSize: number; maxVolumeDistance: number; unitDistance: number }[] };
  bgm: { label: string; regions: Record<string, { startSec: number; endSec: number }> };
  effects: { seTriggers: Record<string, string[]> };
}

interface Handle {
  label: string;
  player: string | null;
  seq: SeqSound | null;
  src: AudioBufferSourceNode | null;
  pos: V3 | null;
  info: Sound3dInfo | null;
  started: number;
}

const ORIGIN: V3 = { x: 0, y: 0, z: 0 };
const BGM_FADE_SEC = 0.5;

export class Hsmg402Sound {
  private m: SoundManifest | null = null;
  private readonly bufs = new Map<string, AudioBuffer>();
  private readonly seqBufs = new Map<string, (AudioBuffer | undefined)[]>();
  private engine: SeqEngine | null = null;
  private readonly g = new Array<number>(16).fill(-1);
  private readonly handles = new Set<Handle>();
  /** 키(라벨|슬롯) → 루프 핸들 */
  private readonly loops = new Map<string, Handle>();
  private bgm: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private camera: THREE.Camera | null = null;

  constructor(
    private readonly assets: Assets,
    private readonly audio: AudioOut | null,
  ) {}

  async load(man: SoundManifest, progress: (n: number, total: number, s: string) => void): Promise<void> {
    this.m = man;
    const a = this.audio;
    if (!a) return;
    this.engine = new SeqEngine(a, { get: (i) => this.g[i], set: (i, v) => (this.g[i] = v) });
    const files = new Set<string>();
    for (const e of Object.values(man.sounds)) {
      if (e.kind === 'stream') files.add(e.file);
      else for (const w of e.seq.waves) files.add(w.file);
    }
    let n = 0;
    const list = [...files];
    await Promise.all(
      list.map(async (f) => {
        try {
          this.bufs.set(f, await a.load(this.assets.url(f)));
        } catch (e) {
          console.warn('소리를 읽지 못했다', f, e);
        }
        progress(++n, list.length, f);
      }),
    );
    for (const [label, e] of Object.entries(man.sounds)) if (e.kind === 'seq') this.seqBufs.set(label, e.seq.waves.map((w) => this.bufs.get(w.file)));
  }

  setCamera(c: THREE.Camera): void {
    this.camera = c;
  }

  private listeners(): Listener3d[] {
    const cam = this.camera;
    if (!cam || !this.m) return [];
    cam.updateMatrixWorld();
    const view = cam.matrixWorldInverse.elements;
    const p = cam.position;
    return this.m.listener3d.preset.map((l) => ({
      pos: { x: p.x + (l.offset[0] ?? 0), y: p.y + (l.offset[1] ?? 0), z: p.z + (l.offset[2] ?? 0) },
      view,
      interiorSize: l.interiorSize,
      maxVolumeDistance: l.maxVolumeDistance,
      unitDistance: l.unitDistance,
      output: true,
    }));
  }

  private amb3d(info: Sound3dInfo | null, pos: V3 | null): { gain: number; pan: number } {
    if (!info || !pos) return { gain: 1, pan: 0 };
    const ls = this.listeners();
    if (!ls.length) return { gain: 1, pan: 0 };
    const r = calc3d(ls, info, pos);
    return { gain: r.volume, pan: r.pan };
  }

  /** 라벨 하나 재생(치환 적용). pos 가 있으면 3D, local = 지역 변수 초기값 */
  play(label: string, pos: V3 | null = null, local?: Record<number, number>): Handle | null {
    const a = this.audio;
    const m = this.m;
    if (!a || !m || !this.engine) return null;
    const target = m.substitute[label] ?? label;
    const e = m.sounds[target];
    if (!e) return null;
    if (e.kind === 'stream') {
      const buf = this.bufs.get(e.file);
      if (!buf) return null;
      const src = a.play(buf, e.bus, { gain: e.gain });
      const h: Handle = { label: target, player: null, seq: null, src, pos: null, info: null, started: a.ctx.currentTime };
      this.track(h);
      return h;
    }
    const pl = e.player;
    if (pl && pl.max > 0) {
      const same = [...this.handles].filter((h) => h.player === pl.name).sort((x, y) => x.started - y.started);
      while (same.length >= pl.max) this.stopHandle(same.shift()!);
    }
    const { gain, pan } = this.amb3d(e.sound3d, pos);
    const seq = this.engine.play(e.seq, this.seqBufs.get(target) ?? [], e.bus, { gain, pan, local });
    const h: Handle = { label: target, player: pl?.name ?? null, seq, src: null, pos, info: e.sound3d, started: a.ctx.currentTime };
    this.track(h);
    return h;
  }

  private track(h: Handle): void {
    this.handles.add(h);
  }

  private stopHandle(h: Handle): void {
    h.seq?.stop();
    try {
      h.src?.stop();
    } catch {
      /* 이미 멈춤 */
    }
    this.handles.delete(h);
  }

  /** 라벨로 멈춤(FX 트리거 _Stop 등) */
  stopLabel(label: string, key?: string): void {
    const target = this.m?.substitute[label] ?? label;
    if (key) {
      const h = this.loops.get(key);
      if (h) {
        this.stopHandle(h);
        this.loops.delete(key);
      }
      return;
    }
    for (const h of [...this.handles]) if (h.label === target) this.stopHandle(h);
  }

  /** FX 트리거 이름에 붙은 SE(ftrg se_hsmg402_snowball). key = 그 공 슬롯(루프 SE 를 공마다 따로 멈추려고) */
  fxTrigger(name: string, op: 'play' | 'stop', pos: V3, key: string): void {
    const m = this.m;
    if (!m) return;
    const trig = m.effects.seTriggers;
    if (op === 'play') {
      for (const label of trig[name] ?? []) {
        const h = this.play(label, pos);
        /* 루프(_Stop 짝이 있는 것)는 키로 기억 */
        if (h && (trig[`${name}_Stop`] ?? []).includes(label)) {
          const k = `${label}|${key}`;
          const old = this.loops.get(k);
          if (old) this.stopHandle(old);
          this.loops.set(k, h);
        }
      }
    } else {
      for (const label of trig[`${name}_Stop`] ?? []) this.stopLabel(label, `${label}|${key}`);
    }
  }

  /** 로직 seLoop(Play3DHookPosition + L15) */
  loop(label: string, ball: number, op: 'start' | 'update' | 'stop', pos: V3, t: number): void {
    const k = `${label}|ball${ball}`;
    if (op === 'stop') {
      this.stopLabel(label, k);
      return;
    }
    let h = this.loops.get(k);
    if (op === 'start' || !h || h.seq?.finished) {
      if (h) this.stopHandle(h);
      h = this.play(label, pos, { 15: t }) ?? undefined;
      if (h) this.loops.set(k, h);
      return;
    }
    h.pos = pos;
    if (h.seq) h.seq.local[15] = t;
  }

  /** BGM: INTRO 부터, MAIN 리전 반복 */
  startBgm(): void {
    const a = this.audio;
    const m = this.m;
    if (!a || !m || this.bgm) return;
    const e = m.sounds[m.bgm.label];
    if (!e || e.kind !== 'stream') return;
    const buf = this.bufs.get(e.file);
    if (!buf) return;
    const r = m.bgm.regions;
    const ls = r.REG_MAIN_00?.startSec;
    const le = r.REG_MAIN_01?.endSec;
    const gain = a.ctx.createGain();
    gain.gain.value = e.gain;
    gain.connect(a.busNode('bgm'));
    const src = a.ctx.createBufferSource();
    src.buffer = buf;
    if (ls !== undefined && le !== undefined) {
      src.loop = true;
      src.loopStart = ls;
      src.loopEnd = le;
    }
    src.connect(gain);
    a.track(src);
    src.start();
    this.bgm = { src, gain };
  }

  stopBgm(fade = BGM_FADE_SEC): void {
    const a = this.audio;
    const b = this.bgm;
    if (!a || !b) return;
    const t = a.ctx.currentTime;
    b.gain.gain.setValueAtTime(b.gain.gain.value, t);
    b.gain.gain.linearRampToValueAtTime(0, t + fade);
    try {
      b.src.stop(t + fade);
    } catch {
      /* 이미 멈춤 */
    }
    this.bgm = null;
  }

  /** 매 스텝: 따라가는 소리(루프)의 3D 볼륨·팬을 위치로 갱신, 끝난 핸들 정리 */
  update(): void {
    for (const h of [...this.handles]) {
      if (h.seq?.finished) {
        this.handles.delete(h);
        continue;
      }
      if (h.seq && h.pos && h.info) {
        const { gain, pan } = this.amb3d(h.info, h.pos);
        h.seq.setOuter(gain, pan);
      }
    }
  }

  dispose(): void {
    this.stopBgm(0);
    this.engine?.stopAll();
    for (const h of this.handles) {
      try {
        h.src?.stop();
      } catch {
        /* 이미 멈춤 */
      }
    }
    this.handles.clear();
    this.loops.clear();
    this.bufs.clear();
    this.seqBufs.clear();
  }
}

export { ORIGIN };
