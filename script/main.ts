/**
 * 페이지 조립 — 화면(WebGL + HUD), 설정 패널, 60Hz 고정 스텝 루프. 게임이 무엇인지는 game.ts 계약으로만 안다.
 *
 * 스텝 시계: 스텝 n 은 시계 시각 base + n/60 을 나타내고, rAF 마다 지금까지 와야 할 스텝을 돈다(밀린 스텝은 rAF 당 MAX_STEPS 까지 따라잡고,
 * MAX_BACKLOG_STEPS 보다 밀리면 넘친 시간을 버린다). 시계는 소리가 돌면 "지금 들리는 AudioContext 시각", 아니면 performance.now 다.
 * 원본은 게임 프레임이 사운드 스레드가 쓴 값(박자 G14 등)을 읽는다 — 웹도 오디오 시계로 스텝을 맞추고, 스텝마다 그 시각의 사운드 관측을
 * view.observe 로 받아 logic.step 에 넘긴다(game.ts SoundSnapshot). 탭이 숨으면 AudioContext 를 멈춰 두 시계가 함께 선다(원본 일시정지처럼).
 *
 * URL 옵션: ?game=<id> 시작할 게임, ?seed=<n> 시드, ?com=1111 플레이어별 CPU 여부, ?debug=1 디버그 줄,
 *           ?fast=N rAF 마다 N 스텝(시험용, 사운드 관측 없음), ?mute=1, ?auto=1 페이지를 열자마자 시작,
 *           ?<key>=<value> 게임별 설정(GameDef.options, 예: mg1801 ?mode=2&cpuMiss=1),
 *           ?avlat=raw|<ms> 출력 지연 보정(raw = 보정 없이 currentTime, 원본처럼 / ms = 측정값에 더 늦출 양),
 *           ?synclog=1 스텝·소리 시각 기록(window.__mpj.sync, tools/sync_measure.ts)
 * 시험 훅: window.__mpj (stage, frame, result, error, hold(frame), dropped, sync)
 */
import './style.css';
import { FPS, MAX_BACKLOG_STEPS, MAX_STEPS } from './core/clock';
import { DEV } from './env';
import { type GameDef, type GameLogic, type GameSetup, type GameView, type PlayerSetup, readOptions } from './game';
import { GAMES } from './games';
import { Assets } from './view/assets';
import { AudioOut } from './view/audio';
import { Hud } from './view/hud';
import { KeyboardPad, padSourcesFor, type PadSource } from './view/input';
import { Renderer } from './view/renderer';

type Stage = 'idle' | 'loading' | 'running' | 'done' | 'error';

interface Hook {
  stage: Stage;
  frame: number;
  seed: number | null;
  result: unknown;
  error: string | null;
  /** 이 프레임에 닿으면 멈춘다(스크린샷용) */
  held: number | null;
  hold(frame: number | null): void;
  /** 밀려서 버린 스텝 수(이 판) */
  dropped: number;
  /**
   * ?synclog=1 — steps: 스텝마다 [프레임, performance.now, currentTime, 들리는 오디오 시각, g14, row, stage, BGM 사건, 스텝 시각, 관측 여부],
   * frames: rAF 마다 [들리는 오디오 시각, 마지막 스텝 시각], audio: 소리 쪽(view/sound.ts)
   */
  sync: { steps: unknown[]; frames: unknown[]; audio: unknown[] } | null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const q = new URLSearchParams(location.search);
const fast = Math.max(0, Number(q.get('fast') ?? 0) | 0);
const avlat = q.get('avlat');
const debugOn = q.get('debug') === '1';
const PREFS_KEY = 'mps-web/prefs';

interface Prefs {
  game: string;
  com: boolean[];
  muted: boolean;
  /** 게임 id → 게임별 설정 */
  options: Record<string, Record<string, string>>;
}

function loadPrefs(): Prefs {
  const def: Prefs = { game: GAMES[0]?.id ?? '', com: [false, true, true, true], muted: false, options: {} };
  try {
    return { ...def, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return def;
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 저장소 없음 */
  }
}

const randomSeed = (): number => (Math.random() * 0x100000000) >>> 0;
const parseSeed = (s: string | null): number | null => (s && /^\s*(0x[0-9a-f]+|\d+)\s*$/i.test(s) ? Number(s) >>> 0 : null);

// ---------------------------------------------------------------- DOM
const app = document.getElementById('app')!;
app.className = 'jw';
const stageBox = el('div', 'jw-stage');
const glCanvas = el('canvas', 'jw-gl');
const hudCanvas = el('canvas', 'jw-hud');
const msg = el('div', 'jw-msg');
stageBox.append(glCanvas, hudCanvas, msg);

const panel = el('aside', 'jw-panel');
const title = el('h1', '', '마리오파티 슈퍼스타즈 웹');
const gameSel = el('select');
const seedIn = el('input');
seedIn.placeholder = '시드(비우면 무작위)';
const optBox = el('div', 'jw-options');
const comBox = el('div', 'jw-com');
const muteIn = el('input');
muteIn.type = 'checkbox';
const startBtn = el('button', '', '시작');
const stopBtn = el('button', '', '그만');
const camBtn = el('button', '', '자유 카메라');
camBtn.title = '켜면 마우스로 시점을 움직인다: 왼쪽 드래그 회전, 오른쪽 드래그 이동, 휠 확대·축소. 다시 누르면 원본 카메라';
let freeCam = false;
const status = el('div', 'jw-status');
const debugLine = el('pre', 'jw-debug');
const result = el('div', 'jw-result');
const label = (text: string, input: HTMLElement): HTMLLabelElement => {
  const l = el('label', '', text);
  l.append(input);
  return l;
};
panel.append(title, label('게임', gameSel), optBox, label('시드', seedIn), comBox, label('소리 끄기', muteIn), el('div', 'jw-buttons'), status, result);
panel.querySelector('.jw-buttons')!.append(startBtn, stopBtn, camBtn);
if (debugOn) panel.append(debugLine);
app.append(stageBox, panel);

const prefs = loadPrefs();
if (GAMES.length === 0) {
  gameSel.append(el('option', '', '(등록된 게임 없음)'));
  gameSel.disabled = true;
  startBtn.disabled = true;
} else {
  for (const g of GAMES) {
    const o = el('option', '', `${g.id} ${g.title}`);
    o.value = g.id;
    gameSel.append(o);
  }
  gameSel.value = q.get('game') ?? prefs.game;
}
const comQ = q.get('com');
const comIns = [0, 1, 2, 3].map((i) => {
  const c = el('input');
  c.type = 'checkbox';
  c.checked = comQ ? comQ[i] === '1' : (prefs.com[i] ?? i > 0);
  comBox.append(label(`${i + 1}P CPU`, c));
  return c;
});
muteIn.checked = q.get('mute') === '1' || prefs.muted;
prefs.options ??= {};

/** 게임별 설정 칸 — 고른 게임의 GameDef.options. 처음 값은 URL ?<key>= → 저장값 → 기본값 */
const optSels = new Map<string, HTMLSelectElement>();
const optLabels = new Map<string, HTMLLabelElement>();
let urlOptsUsed = false;
const currentDef = (): GameDef | undefined => GAMES.find((g) => g.id === gameSel.value);
const readGameOptions = (): Record<string, string> => {
  const d = currentDef();
  const given: Record<string, string> = {};
  for (const [k, sel] of optSels) given[k] = sel.value;
  return readOptions(d?.options, given);
};
const refreshOptionVisibility = (): void => {
  const d = currentDef();
  const vals = readGameOptions();
  for (const o of d?.options ?? []) {
    const l = optLabels.get(o.key);
    if (l) l.style.display = o.when && !o.when.values.includes(vals[o.when.key]) ? 'none' : '';
  }
};
const buildOptions = (): void => {
  optBox.replaceChildren();
  optSels.clear();
  optLabels.clear();
  const d = currentDef();
  if (!d?.options?.length) return;
  const saved = prefs.options[d.id] ?? {};
  const given: Record<string, string> = { ...saved };
  if (!urlOptsUsed) for (const o of d.options) if (q.has(o.key)) given[o.key] = q.get(o.key)!;
  urlOptsUsed = true;
  const vals = readOptions(d.options, given);
  for (const o of d.options) {
    const sel = el('select');
    for (const c of o.choices) {
      const op = el('option', '', c.label);
      op.value = c.value;
      sel.append(op);
    }
    sel.value = given[o.key] !== undefined && o.choices.some((c) => c.value === given[o.key]) ? given[o.key] : vals[o.key];
    if (o.note) sel.title = o.note;
    sel.addEventListener('change', refreshOptionVisibility);
    const l = label(o.label, sel);
    optSels.set(o.key, sel);
    optLabels.set(o.key, l);
    optBox.append(l);
  }
  refreshOptionVisibility();
};
buildOptions();
gameSel.addEventListener('change', buildOptions);
seedIn.value = q.get('seed') ?? '';

const renderer = new Renderer(glCanvas);
const hudCtx = hudCanvas.getContext('2d')!;
const hud = new Hud(hudCtx);
const keyboard = new KeyboardPad();
window.addEventListener('resize', () => renderer.resize());

const setMsg = (s: string): void => {
  msg.textContent = s;
  msg.hidden = s === '';
};
setMsg(GAMES.length === 0 ? '등록된 게임이 없다. script/games/index.ts 에 GameDef 를 더한다.' : '');

// ---------------------------------------------------------------- 상태
const hook: Hook = {
  stage: 'idle',
  frame: 0,
  seed: null,
  result: null,
  error: null,
  held: null,
  hold(frame) {
    this.held = frame;
  },
  dropped: 0,
  sync: q.get('synclog') === '1' ? { steps: [], frames: [], audio: [] } : null,
};
(window as unknown as { __mpj: Hook }).__mpj = hook;

let def: GameDef | null = null;
let logic: GameLogic | null = null;
let view: GameView | null = null;
let pads: (PadSource | null)[] = [];
let audio: AudioOut | null = null;
let token = 0;
/** 스텝 시계 종류(판마다 시작 때 정한다)와 스텝 0 의 시계 시각(초, NaN = 첫 그리기 뒤 정함). 스텝 n = base + n/FPS, n = hook.frame */
let clockKind: 'audio' | 'wall' = 'wall';
let base = 0;

const dispose = (): void => {
  view?.dispose();
  view = null;
  logic = null;
  def = null;
  hud.clear();
};

const finish = (stage: Stage): void => {
  hook.stage = stage;
  startBtn.disabled = GAMES.length === 0;
};

const readSetup = (): GameSetup => {
  const players: PlayerSetup[] = comIns.map((c, i) => ({ char: `pc0${i + 1}`, isCom: c.checked, comLevel: 0 }));
  return { players, seed: parseSeed(seedIn.value) ?? randomSeed(), practice: false, options: readGameOptions() };
};

async function start(d: GameDef, setup: GameSetup): Promise<void> {
  const my = ++token;
  dispose();
  result.replaceChildren();
  prefs.options[d.id] = { ...(setup.options ?? {}) };
  savePrefs({ game: d.id, com: setup.players.map((p) => p.isCom), muted: muteIn.checked, options: prefs.options });
  hook.stage = 'loading';
  hook.seed = setup.seed;
  hook.result = null;
  hook.error = null;
  hook.frame = 0;
  startBtn.disabled = true;
  if (!muteIn.checked) {
    try {
      audio ??= new AudioOut();
      await audio.resume();
    } catch (e) {
      console.warn('소리를 열지 못했다', e);
      audio = null;
    }
  }
  pads = padSourcesFor(
    setup.players.map((p) => p.isCom),
    keyboard,
  );
  const assets = new Assets(d.assetsDir);
  try {
    logic = d.createLogic(setup);
    view = d.createView({ renderer, hud: hudCtx, audio, setup, pads }, assets);
    view.setFreeCamera?.(freeCam);
    setMsg('에셋 읽는 중…');
    await view.load((n, total, what) => {
      if (my === token && hook.stage === 'loading') setMsg(`에셋 읽는 중 ${n}/${total}\n${what}`);
    });
  } catch (e) {
    console.error(e);
    if (my === token) {
      setMsg(`시작 실패: ${(e as Error).message}`);
      hook.error = String((e as Error).stack ?? e);
      dispose();
      finish('error');
    }
    return;
  }
  if (my !== token) return;
  def = d;
  setMsg('');
  status.textContent = `${d.id} 시드 ${setup.seed} (0x${setup.seed.toString(16).padStart(8, '0')})`;
  hook.stage = 'running';
  hook.dropped = 0;
  clockKind = audio && audio.ctx.state === 'running' && fast === 0 ? 'audio' : 'wall';
  /* 첫 rAF 의 그리기가 끝난 뒤 정한다 — 첫 그리기(셰이더·텍스처 올리기)의 긴 멈춤을 따라잡지 않게 */
  base = NaN;
}

startBtn.addEventListener('click', () => {
  const d = GAMES.find((g) => g.id === gameSel.value) ?? GAMES[0];
  if (d) void start(d, readSetup());
});
stopBtn.addEventListener('click', () => {
  token++;
  audio?.stopAll();
  dispose();
  setMsg('그만뒀다');
  finish('idle');
});
muteIn.addEventListener('change', () => audio?.setMuted(muteIn.checked));
camBtn.addEventListener('click', () => {
  freeCam = !freeCam;
  camBtn.textContent = freeCam ? '원본 카메라' : '자유 카메라';
  view?.setFreeCamera?.(freeCam);
});
document.addEventListener('visibilitychange', () => {
  /* 숨으면 소리 시계를 멈춘다 — 로직(rAF)과 시퀀서(타이머)가 서는 동안 오디오만 가지 않게. 벽시계면 숨은 동안을 건너뛴다 */
  if (audio) void (document.hidden ? audio.ctx.suspend() : audio.ctx.resume());
  if (clockKind === 'wall') base = clockNow() - hook.frame / FPS;
});

// ---------------------------------------------------------------- 루프
function stepOnce(): void {
  if (!logic || !view || !def) return;
  /* 이 스텝이 나타내는 시각(스텝 n+1 은 시계가 base + (n+1)/FPS 를 지나면 돈다) */
  const t = base + (hook.frame + 1) / FPS;
  const sound = clockKind === 'audio' ? (view.observe?.(t) ?? null) : null;
  logic.step(
    pads.map((p) => p?.read() ?? null),
    sound,
  );
  view.onStep(logic.state, logic.events);
  hook.frame++;
  if (hook.sync) logSync(t, sound !== null);
  if (logic.done) {
    const r = logic.result;
    hook.result = r;
    if (r) {
      const { head, rows } = def.describeResult(r, readSetup());
      result.replaceChildren(el('h2', '', head), ...rows.map((row) => el('div', 'jw-row', `${row.player + 1}P ${row.rank + 1}위 ${row.value}`)));
    }
    finish('done');
  }
}

/**
 * 지금 스피커로 나가는 소리의 AudioContext 시각(초) — getOutputTimestamp(출력 장치가 내고 있는 시각)를 지금으로 늘인다.
 * 원본은 출력 지연을 보정하지 않는다(게임이 시퀀서가 막 쓴 값을 읽는다, docs/engine/04_sound.md 8절·9.5).
 * 웹은 판정·화면을 들리는 소리에 맞추려고 보정한다 [근사: 원본에 없는 보정]. ?avlat=raw 면 currentTime(보정 없음), ?avlat=<ms> 면 그만큼 더 늦춘다.
 */
function heardTime(): number | null {
  if (!audio) return null;
  const ctx = audio.ctx;
  if (avlat === 'raw') return ctx.currentTime;
  const extra = (Number(avlat) || 0) / 1000;
  const ts = ctx.state === 'running' ? ctx.getOutputTimestamp?.() : undefined;
  if (!ts?.contextTime || !ts.performanceTime) return ctx.currentTime - (ctx.outputLatency ?? 0) - ctx.baseLatency - extra;
  return ts.contextTime + (performance.now() - ts.performanceTime) / 1000 - extra;
}

/** 스텝 시계(초) */
function clockNow(): number {
  return clockKind === 'audio' ? (heardTime() ?? performance.now() / 1000) : performance.now() / 1000;
}

function logSync(t: number, observed: boolean): void {
  const st = logic!.state as { g14?: number; row?: number; stage?: number };
  const ev = (logic!.events as { k: string; label?: string }[]).filter((e) => (e.k === 'bgm' || e.k === 'se') && e.label?.startsWith('SQ_BGM')).map((e) => `${e.k}:${e.label}`);
  hook.sync!.steps.push([hook.frame, performance.now(), audio?.ctx.currentTime ?? null, heardTime(), st.g14 ?? null, st.row ?? null, st.stage ?? null, ev.length ? ev : null, t, observed]);
}

const loop = (): void => {
  requestAnimationFrame(loop);
  if (hook.stage !== 'running' || !logic || !view) return;
  if (hook.held !== null && hook.frame >= hook.held) {
    /* 멈춘 동안은 시계를 따라 옮긴다(풀면 그 자리부터) */
    base = clockNow() - hook.frame / FPS;
    view.render(logic.state);
    return;
  }
  if (Number.isNaN(base)) {
    view.render(logic.state);
    base = clockNow() - hook.frame / FPS;
    return;
  }
  let budget: number;
  if (fast > 0) {
    budget = fast;
  } else {
    let due = Math.floor((clockNow() - base) * FPS + 1e-6) - hook.frame;
    if (due > MAX_BACKLOG_STEPS) {
      /* 너무 밀렸다(긴 멈춤): 넘친 시간을 버린다. 소리 시계면 로직이 그만큼 건너뛰어 소리를 다시 따라간다 */
      hook.dropped += due - MAX_STEPS;
      base += (due - MAX_STEPS) / FPS;
      due = MAX_STEPS;
    }
    budget = Math.max(0, Math.min(MAX_STEPS, due));
  }
  for (let i = 0; i < budget && hook.stage === 'running'; i++) {
    if (hook.held !== null && hook.frame >= hook.held) break;
    stepOnce();
  }
  if (hook.sync) hook.sync.frames.push([heardTime(), base + hook.frame / FPS]);
  if (view && logic) {
    view.render(logic.state);
    const s = view.status(logic.state);
    status.textContent = `${def?.id ?? ''} 프레임 ${hook.frame} ${s.phase}${s.timeLeft !== null ? ` 남은 ${s.timeLeft}` : ''}`;
    if (debugOn) debugLine.textContent = view.debug(logic.state, logic.events);
  }
};
requestAnimationFrame(loop);

if (q.get('auto') === '1' && GAMES.length > 0) startBtn.click();

if (DEV) new EventSource('/esbuild').addEventListener('change', () => location.reload());
