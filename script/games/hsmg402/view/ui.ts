/**
 * hsmg402 2D UI — 원본 레이아웃(hs_system/layout.lyt, FLYT 9.0)을 view/lyt.ts 로 재생한다. 에셋 web/tools/analysis/hsmg402_web_assets.py → assets/hsmg402/ui/ui.json.
 * 로캘 koKR 고정(메시지 KRko, 글자 아틀라스 = font_holder_kr 의 fcpx 순서로 원본 FFNT 셀을 옮겨 붙인 것).
 *
 * 원본 그대로 [데이터·판독]:
 *   - 조작 가이드: sys_guide_02.bflyt(null_all (0, −480), 글자 x_text_00 hsfont_middle 72) + 메시지 hsmg402_MGctrlGuide "{E003}눈덩이 만들기(연타)"
 *     (E003 = B 버튼 아이콘, hsfont_middle_extension 컬러 글리프). 로직의 guide in/out 사건으로 in → normal(반복) / out → 끝나면 숨김(GameMgr::CreateGuide·Update·GameFinish).
 *   - 레이아웃 애니(in/normal/out)는 원본 bflan 그대로 1프레임씩 진행.
 *   - 버튼 글자: 메시지의 U+E000~E003(버튼 위치 아이콘)을 옆으로 쥔 Joy-Con 플레이어가 없을 때처럼 E004 A·E007 Y·E006 X·E005 B 로
 *     바꿔 그린다(main FUN_7100044654, IsExsistJoySidewisePlayerInLocalStation 거짓 분기). 가이드 {E003} → Ⓑ.
 *   - 네 모서리 상태(UIMGStatus): SceneMiniGameBase::SetupGame 이 Create(TYPE 0xd, PLACE 6)(hs_mgsetting 행 1 이 전부 0) →
 *     sys_mgstat_03_00 의 x_stat_0i 부품(sys_mgstat_03, 얼굴 부품 sys_face_100px)을 플레이어 ID 오름차순 i 번째에 붙인다.
 *     얼굴 = face_128_pcNN^u(x_face_pc128 재질 맵 1, 맵 0 원 마스크와 곱, 맵 1 좌표 = 페인 기준 투영 × texSrt 1.3 — lyt.ts), 이름 = hsmg_status_user_name "[0]" ← GameWork::GetDispPlayerName(COM = im_pcNN_name, 이름 없는 사람 =
 *     im_guest0k_name, k = 자기보다 처음 ID 가 작고 이름 없는 플레이어 수), 연승(x_parts_win)·통신 아이콘(x_p_rtt_00, 오프라인) 숨김.
 *     In = 단계 7 첫 프레임 START 텔롭 Start 직후 MinigameUIControl(0) → x_stat_0i 보임 + 'in'. 순위 = EntryPlayerRank(탈락 프레임)·
 *     SetPlayerRank(시간 종료) → UIMGStatus::SetRank → x_text_01 = hsmg_status_rank_small "[0]" ← im_rank01~04 + 'rank_on'.
 * 추정·근사(상태 UI):
 *   - 이름의 '처음 ID'(GameWork 플레이어 칸 +0xe4, SetInitialPlayerID) = 플레이어 번호, COM 이름 칸은 비어 있다고 본다 [추정]. 웹엔 계정 별명이
 *     없어 사람은 모두 게스트 이름이다.
 *   - 이름판 글꼴 nintendo_udsg-r_std_003 은 시스템 공유 글꼴(게임 데이터에 없음) → CSS 글꼴로 대신 그린다 [근사]. 글자 그림자 없음.
 *   - Out(MinigameUIControl(6), 결과 텔롭 Finished 뒤)은 웹 결과 흐름이 그 전에 끝나 쓰지 않는다. 그리는 순서 = 상태 → 타이머·가이드·텔롭 [추정].
 * 추정·근사:
 *   - 타이머: hs::UITimer(0) 의 TYPE → 레이아웃 대응을 판독하지 않았다. 이름으로 sys_timer_00 을 쓴다 [추정]. 숫자는 sys_num_time_00^t(60×760 세로 띠,
 *     10칸)에서 숫자 d 칸을 텍스처 이동 v = d·0.1 로 고른다 [근사: 원본 숫자 갱신 코드 미판독]. 자리 수에 맞는 x_num_{n}_* 만 보인다 [근사].
 *     표시값 = ceil(RemainSecond) [추정]. 화면 위치는 레이아웃 원점(가운데)이라 위쪽 가운데 (0, 430)으로 옮긴다 [근사: 원본 위치 미판독].
 *     'countdown' 애니는 쓰지 않는다(재생 조건 미판독). 타이머 시작 사건에서 in → normal, FINISH 때 out.
 *   - 시작·끝 텔롭: UIMGTelop 이 아니라 main 흐름(단계 7 Start·10 MainEnd)이 띄운다고 보고 sys_tlp_start(hsmg_tlp_start "START!")·
 *     sys_tlp_finish(hsmg_tlp_finish "FINISH!")를 단계 진입 때 in → normal 40프레임 → out [추정: 레이아웃·문구 이름 대응, 유지 시간 근사].
 *   - 결과 텔롭: 로직 telop type 5(승자) → 승자 1~2명 sys_tlp_win_00, 3명 이상 sys_tlp_win_01, 이름 칸 = im_pcNN_name, 글자 = 1명 hsmg_tlp_win "WIN!" /
 *     여러 명 hsmg_tlp_wins "WINS!" [추정]. type 6(무승부) → sys_tlp_draw_00 + hsmg_tlp_draw [추정]. Start 에서 in → normal(반복).
 *   - 진동(VB_*): bnvib 진폭 포락선을 50 ms 구간으로 Gain_Master·Gain_Low/High 를 곱해(1 로 자름) Gamepad dual-rumble 로 [근사].
 */
import type { Assets } from '../../../view/assets';
import type { PadSource, VibSegment } from '../../../view/input';
import { LayoutInstance, LytRenderer, type Lan, type Lyt, type LytFontAtlas } from '../../../view/lyt';
import type { Hsmg402State } from '../state';

interface UiJson {
  layouts: Record<string, Lyt>;
  anims: Record<string, Record<string, Lan>>;
  textures: Record<string, string>;
  fonts: Record<string, LytFontAtlas>;
  texts: Record<string, string>;
}

export interface VibInfo {
  bnvib: string;
  gainMaster: number;
  gainLow: number;
  gainHigh: number;
  envelope: { t: number; strong: number; weak: number }[];
}

const TELOP_HOLD = 40;
const STATUS_LAYOUT = 'sys_mgstat_03_00';
/** SetPicturePCFace(…, 1) → SetPictureUI2DTextureInfo 가 재질 텍스처 맵 1 을 바꾼다(맵 0 = 원 마스크 sys_facebase_01) [판독 @0x710013839c] */
export const FACE_MAP = 1;
/** 시스템 공유 글꼴 대체 [근사] */
const SYS_FONTS: Record<string, string> = { 'nintendo_udsg-r_std_003': '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif' };
/** FUN_7100044654: 옆으로 쥔 Joy-Con 없음 → 위치 아이콘을 버튼 글자로 */
const BUTTON_GLYPH: Record<string, string> = { '': '', '': '', '': '', '': '' };

export function remapButtonGlyphs(s: string): string {
  return s.replace(/[-]/g, (c) => BUTTON_GLYPH[c]);
}

/** 메시지 "[n]" 끼워 넣기(LayoutText::SetInsertMess) */
function insert(msg: string | undefined, args: string[]): string {
  return (msg ?? '').replace(/\[(\d+)\]/g, (_, n) => args[Number(n)] ?? '');
}

/** GameWork::GetDispPlayerName @0x710003423c — 웹은 이름 칸이 모두 비어 있다 */
export function dispPlayerNames(players: readonly { char: string; isCom: boolean }[], texts: Record<string, string>): string[] {
  const guest = ['im_guest01_name', 'im_guest02_name', 'im_guest03_name', 'im_guest01_name'];
  return players.map((p, i) => (p.isCom ? texts[`im_${p.char}_name`] ?? '' : texts[guest[i]] ?? ''));
}

/**
 * 한 스텝의 UIMGStatus::SetRank 호출(순서대로). ranStage9 = 이 스텝이 단계 9(GameMgr::Update)를 돌았다, prevFall = 직전 스텝 fallTime.
 * 새로 떨어진 플레이어 → EntryPlayerRank, 끝난 스텝이면 생존자(fallTime ≤ 0) → EntryPlayerRank(0).
 * 끝난 스텝인데 새 탈락이 없으면 시간 종료 SetPlayerRank(전원) 또는 4명 동시 탈락(fallTime 을 0 으로 되돌려 전원 EntryPlayerRank) — 둘 다 전원.
 */
export function statusRankCalls(state: Pick<Hsmg402State, 'stage' | 'players'>, prevFall: readonly number[], ranStage9: boolean): { id: number; rank: number }[] {
  if (!ranStage9) return [];
  const fresh = state.players.filter((p) => (prevFall[p.id] ?? 0) <= 0 && p.fallTime > 0);
  const finished = state.stage !== 9;
  if (finished && fresh.length === 0) return state.players.map((p) => ({ id: p.id, rank: p.rank }));
  const out = fresh.map((p) => ({ id: p.id, rank: p.rank }));
  if (finished) for (const p of state.players) if (p.fallTime <= 0) out.push({ id: p.id, rank: p.rank });
  return out;
}

/** UIMGStatus::SetRank 의 순위 문구(FUN_71000ccd4c): 0 → im_rank01, 1~3 → im_rank02~04 */
export function rankLabel(rank: number): string | null {
  return rank >= 0 && rank <= 3 ? `im_rank0${rank + 1}` : null;
}
const TIMER_POS = { x: 0, y: 430 };

/** 레이아웃 하나 + 재생 단계 */
class Telop {
  state: 'hidden' | 'in' | 'normal' | 'out' = 'hidden';
  hold = 0;

  constructor(
    readonly inst: LayoutInstance,
    /** normal 을 이 프레임만큼 두고 out(−1 = 계속) */
    private readonly holdFrames: number,
  ) {}

  start(): void {
    this.inst.visible = true;
    this.inst.play('in');
    this.state = 'in';
    this.hold = 0;
  }

  out(): void {
    if (this.state === 'hidden' || this.state === 'out') return;
    this.inst.play('out');
    this.state = 'out';
  }

  step(): void {
    if (this.state === 'hidden') return;
    this.inst.update(1);
    const m = this.inst.main;
    if (this.state === 'in' && m?.ended) {
      this.inst.play('normal');
      this.state = 'normal';
    } else if (this.state === 'normal' && this.holdFrames >= 0 && ++this.hold >= this.holdFrames) this.out();
    else if (this.state === 'out' && m?.ended) {
      this.inst.visible = false;
      this.state = 'hidden';
    }
  }
}

export class Hsmg402Ui {
  private data: UiJson | null = null;
  private lyt: LytRenderer | null = null;
  private guide: Telop | null = null;
  private timer: Telop | null = null;
  private start: Telop | null = null;
  private finish: Telop | null = null;
  private result: Telop | null = null;
  private lastStage = -1;
  private timerShown = false;
  /** 네 모서리 상태(UIMGStatus) — 플레이어 ID → 부품 페인 */
  private status: LayoutInstance | null = null;
  private statusPane: string[] = [];
  private namesSet = false;
  private prevFall: number[] = [];
  vib: Record<string, VibInfo> = {};

  constructor(private readonly assets: Assets) {}

  async load(path: string, charNames: (string | null)[]): Promise<void> {
    this.charNames = charNames;
    const d = await this.assets.json<UiJson>(path);
    const loadImg = (file: string): Promise<HTMLImageElement> =>
      new Promise((ok, bad) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => bad(new Error(`UI 그림을 읽지 못했다: ${file}`));
        img.src = this.assets.url(file);
      });
    const images = new Map<string, HTMLImageElement>();
    await Promise.all(Object.entries(d.textures).map(async ([n, f]) => images.set(n, await loadImg(f))));
    const fonts = new Map<string, { meta: LytFontAtlas; image: HTMLImageElement }>();
    await Promise.all(Object.entries(d.fonts).map(async ([fam, meta]) => fonts.set(fam, { meta, image: await loadImg(meta.file) })));
    this.data = d;
    this.lyt = new LytRenderer({ images, fonts, telop: null, sysFonts: SYS_FONTS });
    this.lyt.registerFontImages();
    this.guide = new Telop(this.instance('sys_guide_02'), -1);
    this.guide.inst.texts.set('x_text_00', remapButtonGlyphs(d.texts.hsmg402_MGctrlGuide ?? ''));
    this.timer = new Telop(this.instance('sys_timer_00'), -1);
    this.timer.inst.pos = { ...TIMER_POS };
    this.start = new Telop(this.instance('sys_tlp_start'), TELOP_HOLD);
    for (const p of ['x_text_00', 'x_text_01']) this.start.inst.texts.set(p, d.texts.hsmg_tlp_start ?? '');
    this.finish = new Telop(this.instance('sys_tlp_finish'), TELOP_HOLD);
    for (const p of ['x_text_00', 'x_text_01']) this.finish.inst.texts.set(p, d.texts.hsmg_tlp_finish ?? '');
    this.createStatus(charNames);
  }

  /** UIMGStatus::Create(0xd, 6) + 모듈 초기화(FUN_71000cb21c → vt+0x28 FUN_71000cb8c4) */
  private createStatus(charNames: (string | null)[]): void {
    const d = this.data!;
    const resolve = (n: string) => (d.layouts[n] ? { lyt: d.layouts[n], anims: d.anims[n] ?? {} } : null);
    const st = new LayoutInstance(d.layouts[STATUS_LAYOUT], d.anims[STATUS_LAYOUT] ?? {}, resolve);
    st.visible = true;
    const ids = charNames.map((_, i) => i).filter((i) => charNames[i]);
    this.statusPane = [];
    ids.forEach((id, k) => {
      const pane = `x_stat_0${k}`;
      this.statusPane[id] = pane;
      const part = st.part(pane);
      const face = st.part(`${pane}/x_parts_00`)?.mats.get('x_face_pc128');
      if (face) face.tex[FACE_MAP] = `face_128_${charNames[id]}^u`;
      part?.setPaneVisible('x_p_rtt_00', false);
      part?.setPaneVisible('x_parts_win', false);
      st.setPaneVisible(pane, false);
    });
    this.status = st;
  }

  private setStatusNames(state: Hsmg402State): void {
    const d = this.data;
    const st = this.status;
    if (!d || !st) return;
    const names = dispPlayerNames(state.players, d.texts);
    state.players.forEach((p, i) => {
      const pane = this.statusPane[p.id];
      if (pane) st.part(pane)?.texts.set('x_text_name_00', insert(d.texts.hsmg_status_user_name, [names[i]]));
    });
    this.namesSet = true;
  }

  /** MinigameUIControl(0) → UIMGStatus vt+0x80(FUN_71000cd2a4): 모듈마다 보임 + PlayPaneAnim("in") */
  private statusIn(): void {
    const st = this.status;
    if (!st) return;
    for (const pane of this.statusPane) {
      if (!pane) continue;
      st.setPaneVisible(pane, true);
      st.playPane(pane, 'in');
    }
  }

  /** UIMGStatus::SetRank → 모듈 vt+0x70(FUN_71000cb57c) → vt+0xc0(FUN_71000ccd4c) */
  private statusRank(id: number, rank: number): void {
    const st = this.status;
    const d = this.data;
    const pane = this.statusPane[id];
    const label = rankLabel(rank);
    if (!st || !d || !pane || !label) return;
    st.part(pane)?.texts.set('x_text_01', insert(d.texts.hsmg_status_rank_small, [d.texts[label] ?? '']));
    st.playPane(pane, 'rank_on');
  }

  /**
   * 순위 기록 시점(GameMgr::Update, 단계 9): 이번 스텝에 새로 떨어진 플레이어 → EntryPlayerRank, 게임이 끝난 스텝이면 남은 생존자 → EntryPlayerRank(0).
   * 끝난 스텝인데 새 탈락이 없으면 시간 종료 SetPlayerRank(전원) 또는 4명 동시 탈락(전원 EntryPlayerRank) — 둘 다 전원.
   */
  private statusRanks(state: Hsmg402State, ranStage9: boolean): void {
    for (const c of statusRankCalls(state, this.prevFall, ranStage9)) this.statusRank(c.id, c.rank);
    for (const p of state.players) this.prevFall[p.id] = p.fallTime;
  }

  private charNames: (string | null)[] = [];

  private instance(name: string): LayoutInstance {
    const d = this.data!;
    return new LayoutInstance(d.layouts[name], d.anims[name] ?? {});
  }

  get loaded(): boolean {
    return this.lyt !== null;
  }

  guideIn(): void {
    this.guide?.start();
  }

  guideOut(): void {
    this.guide?.out();
  }

  timerStart(): void {
    if (this.timerShown) return;
    this.timerShown = true;
    this.timer?.start();
  }

  /** 결과 텔롭(type 5 승자 / 6 무승부) Start */
  telopStart(type: 5 | 6, players: number[]): void {
    const d = this.data;
    if (!d) return;
    if (type === 6) {
      const t = new Telop(this.instance('sys_tlp_draw_00'), -1);
      for (const p of ['x_text_00', 'x_text_00_out']) t.inst.texts.set(p, d.texts.hsmg_tlp_draw ?? '');
      this.result = t;
    } else {
      const name = players.length <= 2 ? 'sys_tlp_win_00' : 'sys_tlp_win_01';
      const t = new Telop(this.instance(name), -1);
      const slots = name === 'sys_tlp_win_00' ? 2 : 4;
      for (let i = 0; i < slots; i++) {
        const pane = `x_text_name_0${i}`;
        const pid = players[i];
        const ch = pid !== undefined ? this.charNames[pid] : null;
        if (ch) t.inst.texts.set(pane, d.texts[`im_${ch}_name`] ?? '');
        else t.inst.setPaneVisible(pane, false);
      }
      const word = players.length === 1 ? d.texts.hsmg_tlp_win : d.texts.hsmg_tlp_wins;
      for (const p of ['x_text_win', 'x_text_win_out']) t.inst.texts.set(p, word ?? '');
      this.result = t;
    }
    this.result.start();
  }

  /** 스텝마다(원본 레이아웃은 프레임당 1 진행) */
  step(state: Hsmg402State): void {
    if (!this.lyt) return;
    if (!this.namesSet) this.setStatusNames(state);
    this.statusRanks(state, this.lastStage === 9);
    if (state.stage !== this.lastStage) {
      if (state.stage === 7) {
        this.start?.start();
        this.statusIn();
      }
      if (state.stage === 10) {
        this.finish?.start();
        this.timer?.out();
      }
      this.lastStage = state.stage;
    }
    if (state.timerRunning) this.timerStart();
    this.setTimerDigits(Math.max(0, Math.ceil(state.timerRemain - 1e-6)));
    for (const t of [this.guide, this.timer, this.start, this.finish, this.result]) t?.step();
    this.status?.update(1);
  }

  private setTimerDigits(v: number): void {
    const inst = this.timer?.inst;
    if (!inst) return;
    const s = String(Math.min(999, v));
    const n = s.length;
    for (let k = 1; k <= 3; k++) {
      for (let i = 0; i < k; i++) {
        const pane = `x_num_${k}_${i}`;
        inst.setPaneVisible(pane, k === n);
        if (k !== n) continue;
        const digit = Number(s[n - 1 - i]);
        const mat = inst.mats.get(pane);
        if (mat?.srt[0]) mat.srt[0].t[1] = digit * 0.1;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.lyt;
    if (!r) return;
    r.begin();
    if (this.status) r.draw(this.status);
    for (const t of [this.timer, this.guide, this.start, this.finish, this.result]) if (t) r.draw(t.inst);
    r.end(ctx);
  }

  vibrate(pad: PadSource | null | undefined, name: string): void {
    const v = this.vib[name];
    if (!pad || !v) return;
    if (!pad.vibrate) {
      pad.rumble?.(Math.round((v.envelope.length * 50)));
      return;
    }
    const segs: VibSegment[] = v.envelope.map((e) => ({
      ms: 50,
      strong: Math.min(1, e.strong * v.gainMaster * v.gainLow),
      weak: Math.min(1, e.weak * v.gainMaster * v.gainHigh),
    }));
    pad.vibrate(segs);
  }

  dispose(): void {
    this.lyt?.dispose();
    this.lyt = null;
    this.status = null;
  }
}
