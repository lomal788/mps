# 04. 미니게임 공용 흐름 소리 — START·FINISH·승자/무승부 텔롭, 호루라기, BGM 정지, 결과 징글

2026-10-06 작성. 상태:
- **분석**: main 의 미니게임 흐름 처리기(단계 7·8·10·12·14)·`hs::UIMGTelop`·`hs::MGSound` 의 소리 경로를 판독했다. 남은 미확정은 9절.
- **웹 구현**: hsmg402 에만 연결(`web/script/games/hsmg402/view/sound.ts` `telop()`·`whistle()`, `view/index.ts` 단계 변화 처리). 자료 `web/assets/hsmg402/sound_sys/`(`web/tools/analysis/hsmg402_sys_sound_assets.py`).
- **동작 검증**: 원본 실행 대조는 없다. `web/tools/check_hsmg402_sound.ts` 가 원본 표·기계어 문자열·설정 CSV·음성 디코드 표본을 대조한다(10절).

확정 수준: [판독] 원본 명령·디컴파일, [데이터] 데이터 파일, [실행] 도구 실행, [추정], [미확정]. 형식은 [../분석.txt](../분석.txt).
주소는 main NSO(베이스 0x7100000000). 판독 덤프: `analysis/decomp/sound_mgflow7.c`(단계 7·8 처리기, UIMGTelop, SysMiniGameMgr, MGSound), `sound_telop2.c`(텔롭 표·vtable·SetPlayers 디스어셈블), `sound_telop3.c`(텔롭 갱신), `sound_uibase.c`(SysMiniGameUiMgr), `sound_stop.c`(Stop_Type·StopBatch_Type·호루라기·대기 표), 기존 `main_mgflow2.c`(단계 9·10·12…), `main_core.c`(SetupGame). Ghidra 복사본 `ghidra_work/sound/`, 래퍼 `web/tools/analysis/sound_ghidra.sh`(CoreTool `fdec:` = 함수가 없는 주소에 함수를 만들어 디컴파일 — 단계 7 처리기 `@0x710008b0e8` 가 그런 주소였다).

## 1. 사용자에게 보이는(들리는) 동작

| 시점 | 화면 | 소리 |
|---|---|---|
| 시작(흐름 단계 7 첫 프레임) | START 텔롭 | `SQ_SE_TLP_START`(무음 자리표, 2절) + 음성 `WD_VOI_LOC_SYS_START`(한국어 판 "스타트") |
| START 텔롭이 사라진 프레임 | — | 호루라기 `SQ_SE_SYS_WHISTLE`(미니게임별 `whistle_entry_type` 이 0 일 때) → 다음 프레임 조작 시작(단계 8) |
| 끝(단계 12 첫 프레임) | FINISH 텔롭 | `SQ_SE_TLP_FINISH` + 음성 `WD_VOI_LOC_SYS_FINISH`, 같은 프레임에 BGM 정지(페이드)·소리 묶음 7 정지 |
| 결과(미니게임이 승자 텔롭 Start) | 승자 이름 + WIN!/WINS! | 승자 1명 `WD_VOI_LOC_SYS_WINNER`, 2명 이상 `WD_VOI_LOC_SYS_WINNERS`, 이어서 결과 징글 `SM_JIN_MG_WIN`(프리셋 치환) |
| 결과(무승부 텔롭 Start) | DRAW | 음성 `WD_VOI_LOC_SYS_DRAW` + 징글 `SM_JIN_MG_DRAW`(프리셋 치환) |

승자 캐릭터 고유 보이스는 텔롭이 아니라 캐릭터 승리 모션(`co_win01a`)의 ftrg(`VO_PC_ACTION` 등)가 낸다 [데이터: `web/assets/chara/pcNN/motions.json` events]. 텔롭 쪽 SetPlayers 의 캐릭터 비교 루프(`@0x71000d49c4~0x71000d49f8`)는 결과를 버리고 라벨은 상수 `WD_VOI_LOC_SYS_WINNER` 그대로다 [판독: 디스어셈블].

## 2. UIMGTelop (main) [판독]

### 2.1 누가 만드나

- 시작·끝 텔롭은 **기반 장면**이 만든다: `hs::SceneMiniGameBase::SetupGame @0x710008a0c0` 이 `UIMGTelop::Create(0)`(START)를 장면+0x2E0 에, `Create(2)`(FINISH)를 +0x2E8 에 만들고 `GetHandle` 을 시퀀스 텔롭 칸 0(장면+0x340~+0x358)·1(+0x360~+0x378)에 넣는다 [`main_core.c` SetupGame 117~154행]. `EntrySeqTelop @0x710008a820`(칸 덮어쓰기)는 main 안에서 부르는 곳이 없고 NRO 용 export 다.
- 미니게임이 따로 만드는 텔롭(hsmg402 GameMgr 의 type 0·2·5·6)은 미니게임이 직접 `Start` 한다. hsmg402 는 type 5·6 만 Start 하고 0·2 는 만들기만 한다(쓰이지 않음) — hsmg402.md 4.2.

### 2.2 type 표 `@0x71014ab280` (0x30 간격, Create 가 읽음) [데이터: main 이미지 + RELATIVE 재배치]

| type | +0 레이아웃(`hs_system/layout.lyt/sys_tlp.lyt`) | +8 SE | +0x10 음성 | +0x18 문구 | +0x28 inout |
|---|---|---|---|---|---|
| 0 START | `sys_tlp_start.bflyt` | `SQ_SE_TLP_START` | `WD_VOI_LOC_SYS_START` | `hsmg_tlp_start` | 0 |
| 1 카운트다운 | `sys_321go.bflyt`(첫 애니 `count`) | — | — | — | 0 |
| 2 FINISH | `sys_tlp_finish.bflyt` | `SQ_SE_TLP_FINISH` | `WD_VOI_LOC_SYS_FINISH` | `hsmg_tlp_finish` | 0 |
| 5 승자 | `sys_tlp_win_00.bflyt` | — | — | — | 0 |
| 6 무승부 | `sys_tlp_draw_00.bflyt` | — | `WD_VOI_LOC_SYS_DRAW` | `hsmg_tlp_draw` | 0 |
| 10 MISS / 11 GOTITEM | `sys_tlp_miss`/`sys_tlp_gotitem` | `SM_JIN_MG_DRAW`/`SM_JIN_MG_WIN` | `…_MISS`/`…_GOTITEM` | | |

전 13칸은 `sys.json` 의 `telopTable` 에 있다. 문자열이 없는 칸은 Create 가 `""` 로 둬 재생하지 않는다.

### 2.3 필드 (UIMGTelop 기준, 0xB0 B)

| 오프셋 | 뜻 | writer | reader |
|---|---|---|---|
| +0x50 | bex::Layout | Create, SetPlayers(3명 이상이면 `sys_tlp_win_01` 로 다시 만듦) | Start·갱신 |
| +0x78 | type | Create | Start·갱신·SetPlayers |
| +0x80 | 카운트(type 1) | Start·갱신 | IsEndCountdown |
| +0x84 | 상태 0 대기 / 1 in / 2 normal / 3 out / 4 끝 | Start(1)·갱신·Out(vt+0x88: 2→3)·ForceOut(4) | Finished(상태−1 > 2, idle<0 이면 2 도), 단계 12(==3) |
| +0x88 | 첫 애니 이름(표 +0x20, 없으면 inout 0 → `"in"`) | Create | Start |
| +0x90 | SE 칸(표 +8) — type 5 는 Create 가 `WD_VOI_LOC_SYS_WINNER`, SetPlayers 가 인원으로 다시 고름 | Create·SetPlayers | Start |
| +0x98 | 음성 칸(표 +0x10) | Create | Start |
| +0xA4 | normal 유지 초(idle). type 0 = 0.5, type 2 = 1.0(inout 0 일 때), 그 밖 −1(Out 호출까지 유지) | 생성자(−1)·Create·SetIdleTimeout | 갱신 |
| +0xA8 | inout 플래그(표 +0x28) | Create | Start·갱신 |
| +0xA9 | 소리 끄기 플래그(0 이면 Start 가 소리를 낸다) | 생성자(0) | Start |

### 2.4 Start `@0x71000d3f0c`

```c
PlayAnim(+0x88); 상태 = 1; SetVisible(1);
if (!+0xA9) { if (+0x90 != "") Sound::Play(+0x90); if (+0x98 != "") Sound::Play(+0x98); }   // 2D 재생
if (type == 1) { +0x80 = 0; Play("SQ_SE_TLP_321GO_3"); Play("WD_VOI_LOC_SYS_3"); }
if (type == 5 || type == 6) MGSound::FUN_710004cf78(1, type);   // 결과 징글(5절)
if (type == 7 || type == 8) SysMiniGameMgr FUN_7100049dd8;
```

### 2.5 갱신 `FUN_71000d3bbc`(vt+0x20, 매 프레임)

- 상태 1: 애니 끝 → inout 이면 숨김·상태 4. 아니면 type ≠ 1 은 `"normal"`·상태 2·`TimeCounter.Set(idle)`; type 1 은 카운트 0/1/2 마다 `"count"`·`SQ_SE_TLP_321GO_2`+`WD_VOI_LOC_SYS_2`, `"count"`·`_1`+`_1`, `"go"`·`SQ_SE_TLP_321GO_GO`+`WD_VOI_LOC_SYS_GO`, 3 이면 숨김·상태 4.
- 상태 2: idle ≥ 0 이고 시간이 다 되면 vt+0x88(`FUN_71000d42a0`: `"out"`·상태 3).
- 상태 3: 애니 끝 → 숨김·상태 4.

### 2.6 SetPlayers `@0x71000d462c` (type 5 만)

- 빈 목록 → +0x90 = `WD_VOI_LOC_SYS_WINNER`, 그 밖 일 없음.
- 3명 이상 → 레이아웃을 `sys_tlp_win_01.bflyt` 로 다시 만든다. 문구 `x_text_win` = 1명 `hsmg_tlp_win`, 그 밖 `hsmg_tlp_wins`.
- **음성**: 인원 ≥ 2 → `WD_VOI_LOC_SYS_WINNERS`(`@0x71000d4980 cmp x8,#1; b.ls`), 1명 → `WD_VOI_LOC_SYS_WINNER`(캐릭터 ID 9 초과면 Abort).

## 3. 흐름 처리기의 소리 (장면 기준, `hs::SceneMiniGameBase`) [판독]

MainLoop 는 한 프레임에 처리기 하나를 부르고(01_core 5.5), 단계가 바뀌면 부속(+0x2DC)=0.

| 단계·부속 | 처리기 | 동작(소리 관련 순서대로) | 다음 |
|---|---|---|---|
| 7·0 | `@0x710008b0e8` | 시퀀스 텔롭 0 이 있으면: type==3(라운드) 또는 4 → `MGSound FUN_710004cb30(0,0)`, 그 밖(START) → `UIMGTelop::Start`(1절 소리). `MinigameUIControl(0)`·`(1)`. 이어서 type 0 → `FUN_710004cb30(0,0)`, type 1 → `(1,0)`. 부속 1 | 7 |
| 7·1 | | type 1(카운트다운) 이면 `IsEndCountdown` 대기 → 부속 2, `cb30(0,0)`, 호루라기 `d528(0)`, `d528(1)`. 그 밖은 `Finished` 대기 → 부속 2, **`d528(0)`** | 7 |
| 7·2 | | OnGameStart 참 → UITimer Start/Resume, `UIPause::Start` | 8 |
| 8 | `@0x710008b99c` | PlayerCtrlStart. 첫 라운드이고(+0x2C8 == −1 또는 …) → `MinigameUIControl(3)` + `d528(1)`. `MinigameUIControl(8)` | 9 |
| 9 | `@0x710008bab4` | OnGameMain 참(또는 외부 판정) → `PlayerCtrlEnd(1.0)`(= `MinigameUIControl(9)`) | 10 |
| 10 | `@0x710008bc68` | OnGameMainEnd 참 → `MinigameUIControl(9)`, 라운드제 아니면(+0x2C8 == −1) | 12 |
| 12·0 | `@0x710008bd84` | `UIPause::Stop`. 시퀀스 텔롭 1(FINISH) `Start`(1절 소리) → **BGM 정지** `FUN_710004cf08(MGSound, 0)` → `Sound::StopBatch_Type(7, 1)` → 부속 1, UITimer Suspend | 12 |
| 12·1 | | FINISH 상태 == 3(out 시작) → `MinigameUIControl(5)`, 부속 2, 대기 = `FUN_710004b734(MG표, id)` 프레임 × 0.01666667 | 12 |
| 12·2 | | `Finished` && 대기 ≤ 0 && OnGameFinish 참 → `MinigameUIControl(6)` | 13(게임 모드 4·5 → 0x12) |
| 14 | 미니게임 OnGameEnding | 미니게임이 결과 텔롭 type 5/6 `SetPlayers`·`Start`(hsmg402: GameMgr::Result 단계 2 / 10) | |

- 텔롭이 등록되지 않았으면(칸 index −1) 단계 7·12 는 소리 없이 넘어간다.
- 인스트(설명) 모드(`DAT_71015e6a08 ≠ 0`)에서는 START Start 를 건너뛴다.

## 4. MGSound (`bex::Singleton<hs::MGSound>`, 장면+0x390) [판독]

미니게임별 설정 = `mgsound_setting.csv` 행을 담은 0x1F8 B 표(`DAT_71015db6e0 + id·0x1F8 + 8`, 범위 밖은 `;default` 행 `+0xCEC0`, +0x1F5 = 기본 행 대체 금지 플래그). 소리 칸 6개(각 0x28 B: +0 핸들, +8 라벨, +0x10 지연 TimeCounter, +0x14 지연, +0x18 정지 지연, +0x1C 페이드 종류, +0x20 핸들 안 남김 플래그): +0x20 BGM, +0x48 오프닝 징글, +0x70 결과 징글, +0x98·+0xC0 결과 환호·가야, +0xE8 새 기록.

| 함수 | 뜻 |
|---|---|
| `FUN_710004c7e8` | 매 프레임(MainLoop): 칸마다 지연 재생/지연 정지(`FUN_710004c340`), +0x110 타이머 감소 |
| `FUN_710004cb30(pos, off)` | BGM 재생 위치(+0x88)가 pos 면 `FUN_710004cdec`(BGM 재생: 라벨 +0x8C, 지연 = play_offset(+0x14C)+off, 정지 지연 +0x150, 페이드 +0x154). pos 0 이고 위치가 2 이고 오프닝을 건너뛰었으면(+0x18) `FUN_710004cbe0`(no_intro 라벨로 다시 재생 + `RegionSequenceJump(intro_skip)`) |
| `FUN_710004cf08(fade)` | BGM 정지: 정지 지연(+0x38) > 0 이면 그만큼 뒤, 아니면 바로 `Stop_Type(핸들, 페이드 종류)` |
| `FUN_710004cf78(pos, type)` | 결과 징글: 설정 +0x158(result_jingle_play_position) == pos 이고 1회 표지 없으면 라벨 `FUN_710004d150(id, pos, type)` 를 지연 +0x15C 로 재생, 표지 +0x114. +0x160/+0x168(환호·가야) 위치가 같으면 각 칸(라벨 없음 → 무음). +0x110 = 4.83 s |
| `FUN_710004d150(id, pos, type)` | `MGList::GetType(id) < 3` 이고 pos ≠ 1 이면 순위 0 이 있으면 `SM_JIN_MG_WIN`, 없으면 `SM_JIN_MG_DRAW`. pos == 1(텔롭): type 5 → `SM_JIN_MG_WIN`, 6 → `SM_JIN_MG_DRAW` |
| `FUN_710004d528(n)` | 설정 +0x1F0(whistle_entry_type) == n 이면 `SQ_SE_SYS_WHISTLE` |

- CSV 열 순서와 표 칸(+0x88 bgm_play_position, +0x14C play_offset, +0x150 stop_offset, +0x154 stop_fade, +0x158 jingle_position, +0x15C jingle_offset, +0x1F0 whistle_entry_type)의 대응은 열 순서·사용처로 맞춘 것이다 [추정: CSV → 표 변환기 미판독]. 문자열 → 열거값(`telop` = 1 등)도 같은 근거 [추정].
- 프리셋 'b' 치환이 마지막에 라벨을 바꾼다(hsmg402: `SM_JIN_MG_WIN` → `_MP03`, `SM_JIN_MG_DRAW`/`LOSE` → `SM_JIN_MG_DRAW_MP03`).

## 5. 로캘 음성 [데이터]

- 코드 라벨은 `WD_VOI_LOC_SYS_*` 인데 소리 자료 라벨은 `WD_VOI_LOC_SYS_*_<접미>` 다. 접미·아카이브는 프리셋 `global` 의 'v' 레코드: koKR → `subarc_sysvoi_kokr`·`KOKR`(zhTW 도 kokr, zhCN·enEU 는 enus). main 에는 접미 문자열이 없다(bex 사운드 계층이 붙임) [추정: 라벨 이름 대응].
- `subarc_sysvoi_kokr.fsst`: 웨이브 사운드 18개(PLY_VOI_SYS, 최대 동시 1), FWSD → FWAR 의 FWAV(DSP-ADPCM, 48 kHz, 모노), 3D 없음(flags 0). 볼륨 START·FINISH 38, WINNER(S)·DRAW 45.
- `SQ_SE_TLP_START` 는 메인 fspj 의 시퀀스지만 플레이어 `PLY_SE_DUMMY`·볼륨 0·파형 0 개다 — 무음 자리표 [데이터]. `SQ_SE_TLP_FINISH`(PLY_SE_TLP, vol 22)·`SQ_SE_SYS_WHISTLE`(PLY_SE_SYS, vol 28)은 실제 소리.

## 6. 웹 포팅 명세

| 원본 | 웹(권장 이름) |
|---|---|
| UIMGTelop::Start 의 SE·음성 칸 | `Hsmg402Sound.telop(type, players)` — SE 칸 → 음성 칸 → (5·6) 징글 |
| MGSound `d528(0)` | `Hsmg402Sound.whistle(0)` |
| MGSound `cf08(0)` | `Hsmg402Sound.stopBgm()`(FINISH 와 같은 프레임) |
| type 표·설정 | `assets/hsmg402/sound_sys/sys.json`(`telop`·`telopTable`·`setting`·`voiceLocale`·`sounds`) |

```ts
onStageChange(stage):
  if (stage === 7) sound.telop(0)              // 원본: 단계 7 첫 프레임
  if (stage === 8) sound.whistle(0)            // 원본: START 텔롭 Finished 프레임(= 단계 8 진입 1프레임 전)
  if (stage === 10) { sound.telop(2); sound.stopBgm() }   // 원본: 단계 12 첫 프레임(웹 로직은 대기를 단계 10 에 둠)
onEvent(telop start, type, players): sound.telop(type, players)
```

- 다른 미니게임도 같은 sys.json 형식을 쓰면 된다(설정 행만 다름: whistle_entry_type, 징글 위치).
- 웹이 원본과 다른 곳: hsmg402 로직은 단계 7 을 고정 180 프레임(`countdownFrames`), 단계 10 을 60 프레임(`mainEndFrames`) 유지한다. 원본은 단계 7 = START 텔롭 길이(in 애니 + normal 0.5 s + out 애니), 단계 10 = 1 프레임, 단계 12 = FINISH out 시작까지(in + normal 1.0 s) + `FUN_710004b734` 대기 + 텔롭 끝. 웹 소리는 웹 단계·ui.ts 텔롭 시작 시점에 맞춰 낸다(같은 프레임에 텔롭과 소리).

## 7. 상호작용

- FINISH 의 `StopBatch_Type(7, 1)`: 그룹 바이트(소리 객체 +0x16+그룹)가 켜진 재생 중 소리를 페이드 종류 1 로 끊는다(`FUN_7100460f78`). 그룹 7 에 무엇이 드는지는 미판독 — 웹은 끊지 않는다.
- 결과 징글 +0x110 = 4.83 s 타이머: `FUN_710004d288` 가 징글 끝 + 타이머 0 을 "결과 소리 끝" 으로 본다(호출처 미판독).

## 8. 에셋

`.venv/Scripts/python web/tools/analysis/hsmg402_sys_sound_assets.py` → `web/assets/hsmg402/sound_sys/{sys.json, wave/sys_war*.wav, voice/WD_VOI_LOC_SYS_*_KOKR.wav}`. 메인 에셋 스크립트(`hsmg402_web_assets.py`)가 지우는 `sound/` 밖이라 따로 돌려도 된다. 시퀀스는 `export_seq`(웹 실시간 시퀀서 형식), 음성은 FWSD(정보 0x4900/0x4901/0x4902 배치를 assert 로 확인) → FWAV DSP-ADPCM 그대로 PCM16 wav.

## 9. 미확정

| 항목 | 영향 | 필요한 근거 |
|---|---|---|
| `FADE_TIME_02` 길이(SystemAudio+0xA33AC 표) | BGM 페이드(웹 0.5 s 근사) | 표를 채우는 SystemAudio 초기화 판독 |
| StopBatch 그룹 7 의 대상 | FINISH 때 끊기는 소리 | 소리 객체 그룹 바이트 설정처 |
| `FUN_710004b734` 대기 값(hsmg402) | 단계 12 길이(웹 로직 `mainEndFrames`) | `DAT_71015db6b0` 표를 채우는 로더(0x2C 간격, +0x18) |
| START/FINISH in·out 애니 길이 | 단계 7·12 길이, 호루라기 시점 | `sys_tlp_start/finish` bflan 프레임 수(UI 담당) |
| CSV 문자열 → 표 열거값·칸 대응 | 4절 [추정] 표기 | mgsound_setting 로더 판독 |
| 로캘 접미를 붙이는 위치 | 5절 [추정] | bex SystemAudio::Play 라벨 해석 판독 |

## 10. 검증 [실행]

`cd F:/dev/mps/web && npx tsx tools/check_hsmg402_sound.ts` — 131/131 통과(2026-10-06):
- A. main 이미지를 TS 로 따로 읽어(RELATIVE 재배치) type 0·2·5·6 칸 = sys.json, 함수 안 adrp/add 문자열(Create case 5 WINNER, SetPlayers WINNER/WINNERS·win/wins, Start 321GO_3, 징글 선택 WIN/DRAW, 호루라기) [판독 근거의 기계어 대조].
- B. mgsound_setting.csv hsmg402 행(+;default) = sys.json.
- C. 음성 wav 5개 = subarc_sysvoi_kokr FWAV 를 검사 스크립트가 따로 DSP 디코드한 표본과 전부 같음(START 42,929 / FINISH 51,091 / WINNER 45,304 / WINNERS 50,357 / DRAW 54,287 표본, 48 kHz 모노).
- D. 실제 `sound.ts` 코드의 라벨 고르기(승자 0·1·2·4명, 무승부, 호루라기 0/1). 승리 모션 `co_win01a` 보이스 라벨이 manifest 에 있음.
- E. 로직 한 판(전원 CPU seed 1·5, 전원 사람 무입력) 소리 일정: START f167, 호루라기 f347, FINISH = 단계 10 진입, 결과 = 단계 14 텔롭 Start(사람 4 무입력 → 4명 승자 → WINNERS).
