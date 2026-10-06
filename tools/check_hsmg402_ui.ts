/**
 * hsmg402 네 모서리 상태 UI·조작 가이드 버튼 글자 노드 검사(화면 없음).
 *   npx tsx tools/check_hsmg402_ui.ts
 * 1) 배치: assets/hsmg402/ui/ui.json 의 sys_mgstat_03_00(+부품 sys_mgstat_03·sys_face_100px)을 view/lyt.ts LayoutInstance 로 만들고
 *    얼굴·이름 페인의 레이아웃 좌표를 bflyt 값으로 손 계산한 기대값과 비교한다 [데이터 + 재구현 계산]. 원본 캡처(1280×720, 게임 영역 추정)와도 느슨히 맞춘다 [참고 이미지].
 * 2) 글자: GetDispPlayerName 규칙·순위 문구(im_rank01~04)·버튼 글자 치환(FUN_7100044654) [판독].
 * 3) 시점: 로직을 실제로 돌려 statusRankCalls(ui.ts)가 내는 SetRank 호출이 GameMgr::Update 의 EntryPlayerRank/SetPlayerRank 시점과
 *    맞는지 본다(탈락 프레임 = fallTime 이 처음 > 0 인 스텝, 마지막 값 = 최종 rank, 시간 종료면 전원 한 번에) [재구현 계산].
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GameSetup } from '../script/game';
import { Hsmg402Game } from '../script/games/hsmg402/logic/game';
import { dispPlayerNames, FACE_MAP, rankLabel, remapButtonGlyphs, statusRankCalls } from '../script/games/hsmg402/view/ui';
import { applySrt, LayoutInstance, projTexCoords, type Lan, type Lyt, type LytFontAtlas } from '../script/view/lyt';

interface UiJson {
  layouts: Record<string, Lyt>;
  anims: Record<string, Record<string, Lan>>;
  textures: Record<string, string>;
  fonts: Record<string, LytFontAtlas>;
  texts: Record<string, string>;
}
const ui = JSON.parse(readFileSync(fileURLToPath(new URL('../assets/hsmg402/ui/ui.json', import.meta.url)), 'utf8')) as UiJson;

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, info = ''): void => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`  실패 ${name} ${info}`);
  }
};

/* ───────── 1. 배치 ───────── */
const resolve = (n: string) => (ui.layouts[n] ? { lyt: ui.layouts[n], anims: ui.anims[n] ?? {} } : null);
const st = new LayoutInstance(ui.layouts.sys_mgstat_03_00, ui.anims.sys_mgstat_03_00 ?? {}, resolve);

/**
 * 손 계산 [데이터: bflyt]: x_stat_0i.T + Null_all 왼쪽(−400/2) + null_00(78, −20) = 얼굴(x_parts_00 = null_00 가운데).
 * 이름 = 얼굴 + null_name(부모 원점 왼쪽 −10/2 + 5, ±32: 위 줄은 덮어쓰기 +32) + x_text_name_00.T(162, 오른쪽 덮어쓰기 −166/−162).
 */
const EXPECT = [
  { pane: 'x_stat_00', corner: '좌상', face: [-878, 467], name: [-716, 499], align: 'left', plateSx: 1 },
  { pane: 'x_stat_01', corner: '우상', face: [877, 467], name: [711, 499], align: 'right', plateSx: -1 },
  { pane: 'x_stat_02', corner: '좌하', face: [-878, -466], name: [-716, -498], align: 'left', plateSx: 1 },
  { pane: 'x_stat_03', corner: '우하', face: [877, -466], name: [715, -498], align: 'right', plateSx: -1 },
];
/** 원본 캡처에서 눈으로 잰 얼굴 가운데(1280×720, 위 원점) [참고 이미지] */
const CAPTURE_FACE = [
  [71, 57],
  [1207, 57],
  [71, 662],
  [1207, 662],
];
/** 캡처의 게임 영역 [추정: 가장자리 검은 띠] x 18~1262, y 10~710 */
const toCapture = (x: number, y: number): [number, number] => [18 + ((960 + x) * 1244) / 1920, 10 + ((540 - y) * 700) / 1080];

console.log('배치(레이아웃 좌표, 가운데 원점·y 위 +)');
EXPECT.forEach((e, i) => {
  const p = st.paneGlobalPos(e.pane)!;
  const part = st.part(e.pane)!;
  const f = part.paneGlobalPos('x_parts_00')!;
  const n = part.paneGlobalPos('x_text_name_00')!;
  const face = [p.x + f.x, p.y + f.y];
  const name = [p.x + n.x, p.y + n.y];
  const align = part.panes.get('x_text_name_00')!.align?.x;
  const plate = part.panes.get('namebase')!.s[0];
  const cap = toCapture(face[0], face[1]);
  console.log(
    `  ${e.corner} ${e.pane}: 얼굴 (${face.join(', ')}) 이름 (${name.join(', ')}) 정렬 ${align} 이름판 배율x ${plate} → 캡처 (${cap.map((v) => v.toFixed(1)).join(', ')}) 잰 값 (${CAPTURE_FACE[i].join(', ')})`,
  );
  check(`${e.pane}.face`, face[0] === e.face[0] && face[1] === e.face[1], JSON.stringify(face));
  check(`${e.pane}.name`, name[0] === e.name[0] && name[1] === e.name[1], JSON.stringify(name));
  check(`${e.pane}.align`, align === e.align, `${align}`);
  check(`${e.pane}.plate`, plate === e.plateSx, `${plate}`);
  check(`${e.pane}.capture`, Math.abs(cap[0] - CAPTURE_FACE[i][0]) <= 8 && Math.abs(cap[1] - CAPTURE_FACE[i][1]) <= 8, cap.join(','));
  check(`${e.pane}.face_size`, part.part('x_parts_00')!.panes.get('x_face_pc128')!.size.join() === '108,108');
});

/* 회귀: 이름판 조각이 이어지고 이름 글자가 판 위에 있다(부모 기준점 = 부모 원점 ±크기/2) */
console.log('이름판(레이아웃 x 구간)');
EXPECT.forEach((e) => {
  const P = st.paneGlobalPos(e.pane)!;
  const part = st.part(e.pane)!;
  const gx = (n: string): number => P.x + part.paneGlobalPos(n)!.x;
  const gy = (n: string): number => P.y + part.paneGlobalPos(n)!.y;
  const sgn = part.panes.get('namebase')!.s[0];
  const rect = (n: string, w: number): [number, number] => (sgn > 0 ? [gx(n), gx(n) + w] : [gx(n) - w, gx(n)]);
  const nb = rect('namebase', 100);
  const p4 = rect('pict_04', 100);
  const p2 = rect('pict_02', 60);
  const joined = sgn > 0 ? nb[1] === p4[0] && p4[1] === p2[0] : nb[0] === p4[1] && p4[0] === p2[1];
  const plate = [Math.min(nb[0], p2[0]), Math.max(nb[1], p2[1])];
  const tc = gx('x_text_name_00');
  const textStart = e.align === 'left' ? tc - 105 : tc + 105;
  console.log(`  ${e.corner}: 판 ${JSON.stringify(nb)}+${JSON.stringify(p4)}+${JSON.stringify(p2)} 글자 상자 [${tc - 105}, ${tc + 105}] 시작 ${textStart}`);
  check(`${e.pane}.판 이어짐`, joined, JSON.stringify([nb, p4, p2]));
  check(`${e.pane}.글자 시작이 판 위`, textStart >= plate[0] && textStart <= plate[1], `${textStart} ${plate}`);
  check(`${e.pane}.글자 상자와 판 겹침 ≥ 상자 폭 90%`, Math.min(plate[1], tc + 105) - Math.max(plate[0], tc - 105) >= 189);
  check(`${e.pane}.글자·판 같은 높이`, gy('x_text_name_00') === gy('namebase') && gy('namebase') === gy('pict_02'));
});

/* 회귀: 얼굴 재질 — 맵 0 = 원 마스크(정점 UV 0~2, mirror), 맵 1 = 얼굴(페인 기준 투영 × texSrt 1.3, clamp) */
{
  const part = st.part('x_stat_00/x_parts_00')!;
  const mat = part.mats.get('x_face_pc128')!;
  mat.tex[FACE_MAP] = 'face_128_pc01^u';
  const src = mat.src;
  check('얼굴 맵 슬롯', FACE_MAP === 1 && mat.tex[0] === 'sys_facebase_01^s' && mat.tex[1] === 'face_128_pc01^u' && src.texMaps[0].wrapU === 'mirror' && src.texMaps[1].wrapU === 'clamp');
  check('좌표 생성 0 정점·1 투영', src.texCoordGen?.[0].source === 0 && src.texCoordGen?.[1].source === 4 && src.projTexGen?.length === 1, JSON.stringify(src.texCoordGen));
  const pane = part.panes.get('x_face_pc128')!;
  check('마스크 정점 UV 0~2', JSON.stringify(pane.src.uvs?.[0]) === JSON.stringify([0, 0, 2, 0, 0, 2, 2, 2]));
  const h = 54;
  const local: [number, number][] = [
    [-h, h],
    [h, h],
    [-h, -h],
    [h, -h],
  ];
  const uvp = projTexCoords(local, 128, 128, src.projTexGen![0]);
  const fin = [0, 1, 2, 3].map((i) => applySrt(src.texSrt[1], uvp[i * 2], uvp[i * 2 + 1]));
  const e0 = 1.3 * (0.5 - 54 / 128 - 0.5) + 0.5;
  console.log(`얼굴 맵 1 UV(TL, TR, BL, BR): ${fin.map((p) => `(${p[0].toFixed(4)}, ${p[1].toFixed(4)})`).join(' ')}`);
  check('얼굴 UV TL', Math.abs(fin[0][0] - e0) < 1e-5 && Math.abs(fin[0][1] - e0) < 1e-5, JSON.stringify(fin[0]));
  check('얼굴 UV BR', Math.abs(fin[3][0] - (1 - e0)) < 1e-5 && Math.abs(fin[3][1] - (1 - e0)) < 1e-5, JSON.stringify(fin[3]));
  check('얼굴 한 장(UV 폭 < 1.2, 위가 v 작음)', fin[1][0] - fin[0][0] < 1.2 && fin[1][0] > fin[0][0] && fin[2][1] > fin[0][1]);
}

/* 애니 길이·트랙 [데이터: bflan] */
const a = ui.anims.sys_mgstat_03;
check('in.frameSize', a.in.frameSize === 10, `${a.in.frameSize}`);
check('rank_on.frameSize', a.rank_on.frameSize === 6, `${a.rank_on.frameSize}`);
{
  const part = st.part('x_stat_00')!;
  part.play('in');
  for (let i = 0; i < 10; i++) part.update(1);
  check('in 끝 Null_all 알파 255·순위 글자 알파 0', part.panes.get('Null_all')!.alpha === 255 && part.panes.get('x_text_01')!.alpha === 0);
  part.play('rank_on');
  part.update(2);
  const y2 = part.panes.get('x_text_01')!.t[1];
  for (let i = 0; i < 4; i++) part.update(1);
  check('rank_on 순위 글자 알파 255·y −46→−38→−46', part.panes.get('x_text_01')!.alpha === 255 && y2 === -38 && part.panes.get('x_text_01')!.t[1] === -46, `${y2}`);
}

/* 얼굴 텍스처 10명 */
for (const c of ['pc01', 'pc02', 'pc03', 'pc04', 'pc05', 'pc06', 'pc07', 'pc11', 'pc12', 'pc13']) check(`face_128_${c}^u`, !!ui.textures[`face_128_${c}^u`]);

/* ───────── 2. 글자 ───────── */
const T = ui.texts;
const n1 = dispPlayerNames(
  [
    { char: 'pc01', isCom: false },
    { char: 'pc11', isCom: false },
    { char: 'pc03', isCom: false },
    { char: 'pc13', isCom: true },
  ],
  T,
);
console.log(`이름(사람 3 + COM 캐서린): ${JSON.stringify(n1)}`);
check('이름 사람3+COM', JSON.stringify(n1) === JSON.stringify([T.im_guest01_name, T.im_guest02_name, T.im_guest03_name, T.im_pc13_name]));
check('게스트 문구', T.im_guest01_name === '게스트 1' && T.im_guest02_name === '게스트 2' && T.im_pc13_name === '캐서린');
const n2 = dispPlayerNames(
  [
    { char: 'pc05', isCom: true },
    { char: 'pc12', isCom: true },
    { char: 'pc01', isCom: false },
    { char: 'pc02', isCom: true },
  ],
  T,
);
console.log(`이름(COM 와리오·동키콩, 사람 P3, COM 루이지): ${JSON.stringify(n2)}`);
check('이름 COM 캐릭터 이름', n2[0] === T.im_pc05_name && n2[1] === T.im_pc12_name && n2[3] === T.im_pc02_name && n2[0] === '와리오' && n2[1] === '동키콩');
check('이름 서식', T.hsmg_status_user_name === '[0]' && T.hsmg_status_rank_small === '[0]');
const ranks = [0, 1, 2, 3].map((r) => T[rankLabel(r)!]);
console.log(`순위 문구: ${JSON.stringify(ranks)}`);
check('순위 문구', JSON.stringify(ranks) === JSON.stringify(['1st', '2nd', '3rd', '4th']) && rankLabel(-1) === null);
const mid = ui.fonts.hsfont_middle;
check('순위 글자 아틀라스', [...'1st2nd3rd4th'].every((c) => !!mid.glyphs[c]));

/* 버튼 글자 */
const guide = remapButtonGlyphs(T.hsmg402_MGctrlGuide);
console.log(`가이드 원문 첫 글자 U+${T.hsmg402_MGctrlGuide.codePointAt(0)!.toString(16)} → U+${guide.codePointAt(0)!.toString(16)}`);
check('가이드 E003 → E005(B)', T.hsmg402_MGctrlGuide[0] === '' && guide[0] === '' && guide.slice(1) === T.hsmg402_MGctrlGuide.slice(1));
check('치환표 A·Y·X·B', remapButtonGlyphs('') === '');
for (const c of ['', '', '', '']) {
  const g = mid.glyphs[c];
  check(`아틀라스 U+${c.codePointAt(0)!.toString(16)}`, !!g && g.font === 'hsfont_middle_extension' && g.color === true);
}

/* ───────── 3. 순위 표시 시점 ───────── */
const setupOf = (coms: boolean[], seed: number, levels = [0, 0, 0, 0]): GameSetup => ({
  players: coms.map((c, i) => ({ char: `pc0${i + 1}`, isCom: c, comLevel: levels[i] })),
  seed,
  practice: false,
});

function runCase(label: string, setup: GameSetup): void {
  const g = new Hsmg402Game(setup);
  const prevFall: number[] = [];
  let lastStage = -1;
  let inFrame = -1;
  const calls: { f: number; id: number; rank: number }[] = [];
  const firstFall: number[] = [];
  for (let f = 0; f < 20000 && !g.done; f++) {
    g.step([null, null, null, null]);
    const s = g.state;
    for (const c of statusRankCalls(s, prevFall, lastStage === 9)) calls.push({ f, ...c });
    for (const p of s.players) {
      if (firstFall[p.id] === undefined && (prevFall[p.id] ?? 0) <= 0 && p.fallTime > 0) firstFall[p.id] = f;
      prevFall[p.id] = p.fallTime;
    }
    if (s.stage === 7 && lastStage !== 7) inFrame = f;
    lastStage = s.stage;
  }
  const s = g.state;
  const finishF = calls.length ? calls[calls.length - 1].f : -1;
  console.log(
    `  ${label}: In ${inFrame}f, 호출 ${calls.map((c) => `${c.f}f P${c.id}=${T[rankLabel(c.rank)!]}`).join(' ')} / 최종 rank ${JSON.stringify(s.players.map((p) => p.rank))}`,
  );
  check(`${label}.in`, inFrame > 0);
  for (const p of s.players) {
    const mine = calls.filter((c) => c.id === p.id);
    check(`${label}.P${p.id}.호출`, mine.length >= 1, `${mine.length}`);
    check(`${label}.P${p.id}.마지막=최종`, mine.length > 0 && mine[mine.length - 1].rank === p.rank, JSON.stringify(mine));
    if (firstFall[p.id] !== undefined && firstFall[p.id] < finishF) check(`${label}.P${p.id}.탈락 프레임`, mine[0]?.f === firstFall[p.id], `${mine[0]?.f} vs ${firstFall[p.id]}`);
  }
}

console.log('순위 표시 시점(SetRank 호출 = 로직 스텝 번호)');
for (const [seed, lv] of [
  [1, [0, 0, 0, 0]],
  [2, [1, 1, 1, 1]],
  [3, [2, 2, 2, 2]],
  [4, [3, 3, 3, 3]],
  [5, [0, 1, 2, 3]],
] as [number, number[]][])
  runCase(`seed${seed}`, setupOf([true, true, true, true], seed, lv));
/* 시간 종료(사람 4명, 입력 없음 → 아무도 안 떨어짐): SetPlayerRank 로 전원 한 번에 1st */
{
  const g = new Hsmg402Game(setupOf([false, false, false, false], 7));
  const prevFall: number[] = [];
  let lastStage = -1;
  const calls: { f: number; id: number; rank: number }[] = [];
  for (let f = 0; f < 20000 && !g.done; f++) {
    g.step([null, null, null, null]);
    for (const c of statusRankCalls(g.state, prevFall, lastStage === 9)) calls.push({ f, ...c });
    for (const p of g.state.players) prevFall[p.id] = p.fallTime;
    lastStage = g.state.stage;
  }
  console.log(`  시간 종료: ${calls.map((c) => `${c.f}f P${c.id}=${T[rankLabel(c.rank)!]}`).join(' ')}`);
  check('시간 종료 전원 같은 프레임 1st', calls.length === 4 && calls.every((c) => c.f === calls[0].f && c.rank === 0));
}

console.log(`\n합계: ${pass} 통과, ${fail} 실패`);
if (fail) process.exit(1);
