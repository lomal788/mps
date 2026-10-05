/**
 * 소리 출력 — WebAudio 버스(se·voice·bgm → master). 원본 라벨 → 파일 대응은 게임 manifest 가 정한다.
 * 3D 효과음 계산은 원본 nn::atk Sound3DEngine·Sound3DCalculator 를 옮긴 calc3d 가 한다(아래, docs/engine/04_sound.md 6.7).
 * 시퀀스 효과음의 실시간 재생은 seq.ts.
 */
import type { V3 } from '../core/fmath';

export type Bus = 'se' | 'voice' | 'bgm';

export class AudioOut {
  readonly ctx = new AudioContext();
  private readonly master = this.ctx.createGain();
  private readonly buses: Record<Bus, GainNode>;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private readonly playing = new Set<AudioBufferSourceNode>();

  constructor() {
    this.master.connect(this.ctx.destination);
    const bus = (): GainNode => {
      const g = this.ctx.createGain();
      g.connect(this.master);
      return g;
    };
    this.buses = { se: bus(), voice: bus(), bgm: bus() };
  }

  resume(): Promise<void> {
    return this.ctx.resume();
  }

  /** url 의 소리를 한 번만 받아 디코드한다 */
  load(url: string): Promise<AudioBuffer> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`소리를 읽지 못했다: ${url} (${r.status})`);
          return r.arrayBuffer();
        })
        .then((b) => this.ctx.decodeAudioData(b));
      this.buffers.set(url, p);
    }
    return p;
  }

  busNode(bus: Bus): AudioNode {
    return this.buses[bus];
  }

  /** stopAll 이 멈출 수 있게 등록한다(다른 곳에서 만든 소스) */
  track(src: AudioBufferSourceNode): void {
    src.addEventListener('ended', () => this.playing.delete(src));
    this.playing.add(src);
  }

  /** when: 시작 AudioContext 시각(없으면 지금), offset: 버퍼 안 시작 초 */
  play(
    buf: AudioBuffer,
    bus: Bus,
    opts: { loop?: boolean; loopStart?: number; loopEnd?: number; gain?: number; when?: number; offset?: number } = {},
  ): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = opts.loop ?? false;
    if (opts.loopStart !== undefined) src.loopStart = opts.loopStart;
    if (opts.loopEnd !== undefined) src.loopEnd = opts.loopEnd;
    let out: AudioNode = this.buses[bus];
    if (opts.gain !== undefined) {
      const g = this.ctx.createGain();
      g.gain.value = opts.gain;
      g.connect(out);
      out = g;
    }
    src.connect(out);
    this.track(src);
    src.start(opts.when ?? 0, opts.offset ?? 0);
    return src;
  }

  setMuted(m: boolean): void {
    this.master.gain.value = m ? 0 : 1;
  }

  stopAll(): void {
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {
        /* 이미 멈춤 */
      }
    }
    this.playing.clear();
  }

  dispose(): void {
    this.stopAll();
    void this.ctx.close();
  }
}

// ---------------------------------------------------------------- 3D [판독 main, 04_sound.md 6.7]
/** 리스너 하나(nn::atk Sound3DListener). view = 리스너 행렬(카메라 뷰 행렬, 열 우선 16칸, 앞 = −Z) */
export interface Listener3d {
  pos: V3;
  view: ArrayLike<number>;
  interiorSize: number;
  maxVolumeDistance: number;
  unitDistance: number;
  /** 출력 대상 플래그 비트 0 */
  output: boolean;
}

/** 사운드 3D 정보(FSAR) */
export interface Sound3dInfo {
  flags: number;
  decayRatio: number;
  decayCurve: number;
  dopplerFactor: number;
}

/** 관리자(nn::atk Sound3DManager) 기본값 [판독 FUN_71005b92b0: +0x40 = 32, +0x44 = 0.9f, +0x48 = 0] */
export const SOUND3D_MANAGER = { maxPriorityReduction: 32, panRange: 0.9, sonicVelocity: 0 };
/** 팬 계산의 스피커 각 [판독 FUN_71005b8df0: 앞 π/6, 뒤 2π/3, 서라운드 오프셋 0] */
const FRONT = Math.PI / 6;
const REAR = (2 * Math.PI) / 3;

export interface Ambient3d {
  volume: number;
  priority: number;
  /** −1(왼)..1(오른) */
  pan: number;
  /** 앞뒤 서라운드 팬(스테레오 출력에서는 쓰지 않는다) */
  span: number;
}

/** 볼륨·우선순위 [판독 FUN_71005b8858] */
function volumeAndPriority(d: number, l: Listener3d, s: Sound3dInfo): [number, number] {
  let v = 1;
  if (l.maxVolumeDistance < d) {
    const x = (d - l.maxVolumeDistance) / l.unitDistance;
    if (s.decayCurve === 2) v = Math.max(0, (1 - s.decayRatio) * -x + 1);
    else if (s.decayCurve === 1) v = s.decayRatio ** x;
  }
  return [v, -Math.trunc((1 - v) * SOUND3D_MANAGER.maxPriorityReduction)];
}

/** 팬·서라운드 [판독 FUN_71005b8918 → FUN_71005b8ab8] */
function panSurround(l: Listener3d, pos: V3): [number, number] {
  const m = l.view;
  let x = m[0] * pos.x + m[4] * pos.y + m[8] * pos.z + m[12];
  const y = m[1] * pos.x + m[5] * pos.y + m[9] * pos.z + m[13];
  let z = m[2] * pos.x + m[6] * pos.y + m[10] * pos.z + m[14];
  const dist = Math.sqrt(x * x + y * y + z * z);
  const interior = l.interiorSize;
  if (dist === 0) {
    x = 0;
    z = 0;
  } else {
    let h = Math.sqrt(x * x + z * z);
    if (interior < h) h = interior;
    x = (x * h) / dist;
    z = (z * h) / dist;
  }
  const th = Math.atan2(x, -z);
  const PI = Math.PI;
  let pan: number;
  let sur: number;
  if (th < -REAR) {
    pan = PI === REAR ? -0.5 : PI / (REAR - PI) + th / (REAR - PI);
    sur = 1;
  } else if (th < -PI / 2) {
    pan = -1;
    sur = -REAR === -PI / 2 ? 0.5 : (PI / 2) / (-REAR + PI / 2) + th / (-REAR + PI / 2);
  } else if (th < -FRONT) {
    pan = -1;
    sur = -PI / 2 === -FRONT ? -0.5 : (PI / 2) / (-PI / 2 + FRONT) + th / (-PI / 2 + FRONT);
  } else if (th < FRONT) {
    pan = FRONT !== 0 ? th / FRONT : 0;
    sur = -1;
  } else if (th < PI / 2) {
    pan = 1;
    sur = PI / 2 === FRONT ? -0.5 : (PI / 2) / (FRONT - PI / 2) - th / (FRONT - PI / 2);
  } else if (th < REAR) {
    pan = 1;
    sur = PI / 2 === REAR ? 0.5 : (PI / 2) / (PI / 2 - REAR) - th / (PI / 2 - REAR);
  } else {
    pan = PI === REAR ? 0.5 : -PI / (REAR - PI) + th / (REAR - PI);
    sur = 1;
  }
  const r = Math.sqrt(x * x + z * z) / interior;
  const c = (Math.cos(FRONT) + Math.cos(REAR)) * 0.5;
  const range = SOUND3D_MANAGER.panRange;
  return [r * pan * range, (1 - r) * (c / (c - Math.cos(REAR))) + r * sur * range + 1];
}

/**
 * 원본 Sound3DEngine::UpdateAmbientParam [판독 main 0x71005b8e40~0x71005b90c0].
 * 볼륨은 출력 플래그가 선 리스너들의 최댓값, 우선순위는 최댓값.
 * 팬·서라운드는 출력 플래그가 선 리스너가 정확히 하나일 때만 계산한다(둘 이상이면 0).
 * 도플러(피치)·필터는 계산하지 않는다(mg1801 사운드의 dopplerFactor 0, 필터 비트는 COUNT_STICK 만).
 */
export function calc3d(listeners: readonly Listener3d[], s: Sound3dInfo, pos: V3): Ambient3d {
  const f = s.flags & 0x1f;
  const out: Ambient3d = { volume: 1, priority: 0, pan: 0, span: 0 };
  if (f & 2) out.priority = -SOUND3D_MANAGER.maxPriorityReduction;
  if (f & 1) out.volume = 0;
  const outputs = listeners.filter((l) => l.output).length;
  for (const l of listeners) {
    if (f & 3) {
      const d = Math.hypot(pos.x - l.pos.x, pos.y - l.pos.y, pos.z - l.pos.z);
      const [v, p] = volumeAndPriority(d, l, s);
      if (l.output && f & 1) out.volume = Math.max(out.volume, v);
      if (f & 2) out.priority = Math.max(out.priority, p);
    }
    if (f & 0xc && l.output && outputs === 1) {
      const [pan, span] = panSurround(l, pos);
      if (f & 4) out.pan = pan;
      if (f & 8) out.span = span;
    }
  }
  return out;
}
