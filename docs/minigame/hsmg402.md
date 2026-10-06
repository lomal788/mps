# hsmg402 데굴데굴 눈덩이 (Snowball Summit / ゆきだまゴロゴロ)

2026-10-05 작성. 상태:
- **분석**: 1차 완료(판독·재구현 계산). 장면 흐름·눈덩이·승패·플레이어·CPU·에셋을 판독했다. 남은 미확정은 11절에 있다.
- **웹 구현**: 로직(`web/script/games/hsmg402/{state.ts,logic/*,index.ts}`, 코어 `web/script/core/{fmath,rng}.ts` mps 판)과 화면(`view/**`: 무대·캐릭터 10명·공·카메라, 조명·후처리 [07](../engine/07_camera_lighting.md), 재질 [03](../engine/03_graphics.md), 이펙트 VFXB v40 [08](../engine/08_effects.md), 원본 시퀀스 SE·BGM, 원본 레이아웃 UI). 노드 시험 `web/tools/test_hsmg402.ts` 290 통과. 미확정 순서·시간은 `logic/data.ts`의 `Hsmg402Config` 설정 키. 조작 키: K = B(만들기 연타), J = A(날리기), WASD/방향키 = 스틱.
- **동작 검증**: 원본 게임 실행 대조는 하지 않았다. 10절의 검증은 판독한 식을 파이썬으로 다시 계산한 것이고, 웹은 헤드리스로 한 판(오프닝→START→게임→결과)을 오류 없이 완주했다(`web/test/tmp/shot_hsmg402.ts`, 화면 `web/test/out/hsmg402_f*.png`).

확정 수준 표기([../분석.txt](../분석.txt)):
- **[실행]** 도구를 실제로 돌린 것이다(에셋 변환·파서·계산 스크립트). **원본 게임을 실행한 것은 없다.**
- **[판독]** 원본 명령·디컴파일 판독, **[데이터]** 데이터 파일 확인, **[재구현 계산]** 판독한 식을 `web/tools/analysis/hsmg402_*calc.py`로 다시 계산, **[산술]** 노트의 데이터 값으로 이 문서에서 손계산(검증 스크립트 밖), **[추정]**, **[미확정]**.

주소 규약:
- 따로 적지 않으면 `hsmg402.nro` 주소다(SwitchLoader 베이스 0x7100000000). main NSO 주소는 `main @…`로 쓴다.
- `vt+N`은 vtable 주소점 기준 오프셋이다.
- 필드 기준 객체를 늘 함께 적는다. `Player+0x…`는 Player 객체 시작, `Actor+0x…`는 Player+0x4C0의 `hs::actor::Actor` 부분 객체 기준이다(예: Actor+0x17C = Player+0x63C). `SnowBall+`, `GameMgr+`, `Scene+`(SceneHsmg402), `PlayerCom+`도 같은 식이다.

통합한 근거 노트(세부 근거와 디스어셈블 위치는 노트에 있다):
- [analysis/notes/hsmg402_flow.md](../../../analysis/notes/hsmg402_flow.md): 장면 흐름, GameMgr, 눈덩이, 종료·순위·결과, 난수 위치.
- [analysis/notes/hsmg402_player.md](../../../analysis/notes/hsmg402_player.md): 입력, 이동, 피격, 상태기계, CPU, 난수 소비 순서.
- [analysis/notes/hsmg402_assets.md](../../../analysis/notes/hsmg402_assets.md): 에셋, 충돌 apx, 카메라, 조명, 이펙트, 소리, UI, 모션, 위치표, 변환 결과.
- [analysis/notes/SHARED.md](../../../analysis/notes/SHARED.md)의 `[hsmg402-*]` 줄. 엔진 코어는 [../engine/01_core.md](../engine/01_core.md)를 따른다.

노트끼리 어긋난 곳은 본문에 **조정:** 또는 **정정:**으로 이유를 남겼다. 모음은 11.2에 있다.

---

## 1. 기능 개요와 사용자에게 보이는 동작

| 항목 | 내용 | 수준 |
|---|---|---|
| 코드·ID | hsmg402, MINIGAME_ID 1, type 0(4인 대전), 팩 노멀·액션·N64 | [데이터] `analysis/minigame_catalog.tsv` |
| 규칙 문구 | "눈덩이를 굴려 커다랗게 만들고 라이벌에게 맞혀 주세요." | [데이터] `hsmg_inst.msbt` `inst_hsmg402_rule` |
| 조작 | **B 연타 = 눈덩이 만들기**(`{E003}`), L 스틱 = 이동(`{E015}`), **A = 눈덩이 날리기**(`{E000}`). 점프·대시·달리기는 없다. 입력은 누른 순간(trig)만 쓴다 | [판독+데이터] `Player::Update @0x7100006cb0`, main `ActorPad::getTrig @0x71000e023c`. **E000 = A, E003 = B 확정**(SHARED 50행의 추정을 player 담당이 판독으로 닫음) |
| 진행 | 각자 B를 9번 이상 연타해 발 앞에 눈덩이를 만든다. 공을 든 채 걸으면 공이 커지고(레벨 0→7), 걸음은 느려지고 회전은 둔해진다. A로 앞으로 밀어 굴린다. 굴러간 공은 방향이 고정되고 감속이 없다 | [판독] |
| 맞으면 | 공 레벨이 클수록 세게 공 반대쪽 위로 튕겨 나간다(초속 7.0~23.03). 손에 든 공은 부서진다 | [판독+데이터] |
| 탈락·승패 | 둥근 눈밭 밖으로 떨어져 **위치 y ≤ −1.0**이 되면 탈락한다. 남은 사람이 1명 이하이거나 60초가 끝나면 종료한다. 늦게 떨어질수록 순위가 높고, 생존자는 공동 1등이다. 4명이 한 프레임에 동시에 떨어지면 전원 최하위(무승부 텔롭)다 | [판독] `GameMgr::Update @0x7100001fac` |
| 무대 | 바다 위 설산 정상의 원판 눈밭(반지름 7.4971 평면 + 둥근 가장자리 + 절벽). 눈보라·별 파티클, 오로라, 눈 자국 높이장 | [데이터] |
| 카메라 | 오프닝 cam_op 120f(앞 60f 정지, 뒤 60f 다가옴) → 게임 중 고정 내려다보기(fovy 22.62°) | [데이터+판독] |
| BGM | `SM_BGM_HSMG103_402_702_810_JMP`(hsmg103·702·810과 공용) | [데이터] `mgsound_setting.csv` |
| 주의 | 작업 지시 초안의 "굴러오는 커다란 눈덩이를 피하며 살아남기"는 원본과 다르다. 눈덩이가 저절로 생기거나 굴러오는 코드는 없다(`Player::CreateSnowBall`, `SnowBall::Shot`만 있음) | [판독] |

핵심 결론 요약:

| 질문 | 결론 | 수준 |
|---|---|---|
| 시간 단위 | 모든 갱신은 고정 dt = f32(1/60) = `0x3C888889`. 플레이어(액터)는 초 단위 속도(m/s), **눈덩이는 프레임당 변위** 단위다 | [판독] |
| 눈덩이 성장 | 공을 든 플레이어가 **움직인 프레임** 61개마다 레벨+1, 레벨 7까지 427프레임. 반지름 = 1.1 × SIZE_SCALE[레벨] | [판독+재구현 계산] |
| 던진 공 | 6번째 틱에 프레임당 0.1(초당 6)로 고정, 마찰·유도 없음, 지면이 없으면 낙하, y < −11에서 삭제 | [판독+재구현 계산] |
| 공끼리 | 받는 공은 `자기 레벨 − 2 ≤ 상대 레벨`이면 부서진다. 레벨 차 3 이상이면 큰 공만 남는다 | [판독+재구현 계산] |
| 낙하 상태 vs 탈락 | 낙하 상태(0x18) 진입은 플레이어 쪽 `|p|² ≥ 67.24 또는 y < −0.5`, 탈락 기록은 GameMgr 쪽 `y ≤ −1.0`. **서로 다른 판정**이다(5.4) | [판독] |
| 난수 | 흐름·눈덩이·판정·결과에는 난수가 없다. CPU(`PlayerCom`)만 `SyncRandMod/Range/RangeF`를 쓴다 | [판독] |

## 2. 분석 대상 원본·버전·자료 위치

| 항목 | 위치 |
|---|---|
| 원본 | Mario Party Superstars US v0 (ProgID 0x01006fe013472000). 원본 폴더 `F:/dev/mps/original/`은 읽기 전용 |
| 코드 | `extracted/romfs/nro/NX_Release/hsmg402.nro`(장면 클래스 `hsmg402::SceneHsmg402`, vtable `@0x7100035cb0`), main `extracted/exefs/main` |
| 함수 목록 | `analysis/functions/hsmg402.nro.tsv` |
| 디컴파일 | `analysis/decomp/hsmg402_player_all.c`(NRO 전체 347 함수), `hsmg402_flow_dis.c`(흐름·눈덩이 44 함수 디스어셈블), `hsmg402_player_dis.c`(플레이어·CPU 24 함수 디스어셈블), `hsmg402_player_main_*.c`(main `hs::actor`·`ActorPlayer`·`ActorManager` 414 함수, 파라미터 로더, 기본 걷기) |
| Ghidra 작업 복사본 | `ghidra_work/hsmg402_flow/`, `ghidra_work/hsmg402_player/`(원 프로젝트 `ghidra_proj/g0`의 복사본) |
| 본 아카이브 | `extracted/bea/hsmg402.nx.bea/mg/hsmg402/`(model·env·data/map·effect·ftrg·dbg). 데이터 CSV(.nkn) 파라미터 표는 없다. 게임 상수는 전부 NRO 정적 상수다 [데이터] |
| 공용 파라미터 | `extracted/nkn/hs_system.nx.bea/hs_system/data/hs_actorparam.csv`(액터 걷기 2.0 등) |
| 소리 | `extracted/bea/sound~subarc_hsmg402.nx.bea/…/subarc_hsmg402.fsst`, BGM `extracted/romfs/stream/SM_BGM_HSMG103_402_702_810_JMP.dspadpcm.bfstm` |
| 캐릭터 모션 | `extracted/bea/chara~pc~pcNN_*.nx.bea/chara/pc/pcNN_*/motion/pcNN_{sb_*,co_*}.fskb` |
| 변환 결과 | `extracted/converted/hsmg402/`(graphics·collision·effect·ftrg·sound·ui) |
| 계산 도구 | `web/tools/analysis/hsmg402_calc.py` → `analysis/hsmg402_calc.json`, `web/tools/analysis/hsmg402_player_calc.py` → `analysis/hsmg402_player_calc.json` |
| 기타 도구 | `web/tools/analysis/dis_nro.py`(NRO capstone), `web/tools/analysis/nro_vtable.py`, `web/tools/analysis/graphics_convert.py mps_hsmg402`, `web/tools/analysis/glb_nodes.py`, `web/tools/analysis/scene_apx34_mesh.py` |
| 공용 문서 | [../engine/01_core.md](../engine/01_core.md)(시간·난수·흐름 단계), [web/docs/analysis/01](../analysis/01_package_and_assets.md)(형식), [web/docs/analysis/02](../analysis/02_code_modules.md)(모듈·장면 가상 함수 표), [web/docs/analysis/03](../analysis/03_game_structure.md)(미니게임 표) |

mpj(잼버리) 대조: 같은 미니게임이 mpj에 없고 엔진층(bex) 세대가 달라 **판독 결과를 재사용하지 않았다**. 액터 라이브러리도 다르다(mps `hs::actor::Actor` vs mpj `ComActor`). 에셋 변환 도구와 형식 규약(FRES·BNTX·FSAR 3D·시퀀스 변수·카메라 fovy)만 같은 구조로 확인해 썼다 [판독/실행].

## 3. 진입점과 전체 호출 흐름

### 3.1 덮어쓴 장면 가상 함수 [판독: `web/tools/analysis/nro_vtable.py … SceneHsmg402`]

| vt | 함수 | 주소 | 동작 |
|---|---|---|---|
| +0xB8 | PrepareLoadArchive_game | `@0x7100015bb4` | 빈 함수(장면 목록 기본 아카이브만) |
| +0xD0 | OnSetupGame | `@0x7100015bb8` | 3.2 |
| +0xD8 | OnSyncSetup | `@0x7100016298` | 플레이어 생성·배치, 가이드 UI(3.3) |
| +0xE0 | OnGameInit(단계 0) | `@0x7100016518` | 착지 대기 + 카메라 초기화 |
| +0x108 | OnGameOpening(단계 5) | `@0x71000165fc` | 오프닝 카메라 애니가 끝날 때까지 |
| +0x110 | OnGameStartBefore(단계 6) | `@0x7100016694` | 오프닝 스킵 때 카메라를 게임 카메라로 |
| +0x120 | OnGameStartAfter(단계 8) | `@0x71000166f0` | `GameMgr::Start` |
| +0x128 | OnGameMain(단계 9) | `@0x71000166f8` | `GameMgr::Update`가 참이면 `ResultPreparation` 후 참 |
| +0x148 | OnGameEndingBefore(단계 13) | `@0x7100016734` | 항상 참 |
| +0x150 | OnGameEnding(단계 14) | `@0x710001673c` | `GameMgr::Result` 결과 반환 |
| +0x188 | OnCleanupGame | `@0x7100016744` | SeMgr·Map 삭제 → 플레이어 Detach·삭제 → `ActorManager::Destroy` → GameMgr·모델·카메라 삭제 → PostPhysics 엔티티 정리 |

나머지 훅은 기본 동작이다(대부분 참 반환, Sequence 훅은 빈 함수). 단계 번호와 처리기는 [01_core §5.5](../engine/01_core.md)에 있다.

### 3.2 OnSetupGame `@0x7100015bb8` (순서대로) [판독]

1. `SetUpCollisionLayer @0x71000161f0`: 켬 (4,10)(10,10)(10,11)(11,11), 끔 (10,6)(10,9)(11,6)(11,9).
   - 레이어 10 = 눈덩이 구, 11 = 플레이어 이벤트 충돌 "PlEvCol", **4 = 플레이어 본체 캡슐**.
   - **조정:** flow 노트는 레이어 4를 [미확정: 플레이어 본체 추정]으로 두었다. player 노트가 `Actor::InitDefaultCollision`의 `SetCollisionLayer(4)`(main `@0x71000e8ad4`)로 닫았다 [판독].
   - 레이어 6·9의 정체는 [미확정]이다.
2. Scene+0x3F0 `env/hsmg402_dir_light00.fmdb` → `SystemRender::SetGlobalDirectionalLightHook("dir_light")`. +0x3F8 `env/hsmg402_env.fmdb`. +0x400 `env/hsmg402_fluid.fmdb`, `SetViewportBit(1)`.
3. Scene+0x410 `GameMgr`(0xA8 B) 생성 → `GameMgr::Create @0x71000005c0`.
4. `hs::ActorManager::Create/Initialize/EnableCollision(true,true)`. ActorManager+0x90 하위 4비트 = 1 [의미 미확정].
5. Scene+0x418 `vector<unique_ptr<Player>>`를 `GameWork::GetPlayerNum()`개로 맞춘다.
6. Scene+0x430 `Map`(0x60) → `Map::Create`: sky·fld·fld_cliff·bg·aurora·fld_mask·ice_mid·ice_far·ice_fix·ice_rev 모델과 `bex::Map`("mg/hsmg402/data/map/map.nbmap").
7. Scene+0x408 `bex::Camera`, 뷰포트 0, 애니 표 `[0]=env/hsmg402_cam_op.fsnb`, `[1]=env/hsmg402_cam.fsnb`.
8. 장면 전용 엔티티(+0x3D0~+0x3E8 핸들), **TickOrder 2**, `ComMessageListener`에 메시지 5 → `PostPhysics @0x7100016ac0`(= `SeMgr::Reset`).
9. Scene+0x438 `SeMgr`(0x810 B), Scene+0x444(훅 부속 단계) = 0.

`GameMgr::Create`가 만드는 것(GameMgr 기준) [판독]:
- +0x20 `SnowBallMgr`(0x30 B, 슬롯 **32칸**).
- +0x28 `model/hsmg402_pos_op.fmdb`(시작 위치 뼈).
- +0x30~+0x48 `pos_result_draw/_1win/_2win/_3win` 모델. **NRO 안에서 읽는 곳이 없다**(생성·소멸뿐).
- +0x50~+0x68 `UIMGTelop` 4개(`Create(type,0)` type 0/2/5/6). 쓰는 것은 +0x60(type 5, 승자 [추정])·+0x68(type 6, 무승부 [추정])뿐.
- +0x70 `UITimer(0)`, vt+0x30(1), `SetTimer(60.0)`(GameTime).

### 3.3 OnSyncSetup `@0x7100016298`와 시작 배치 [판독]

```
entry = GameWork::GetMGEntryPlayer()            // main @0x7100032ef4, vector<int>, 난수 호출 없음
for i in 0..PlayerNum-1:
  players[i] = new Player(0xE70); Player::Init(players[i])     // @0x71000054d0, 4.3
  ActorManager::AttachActor(players[i])
  GameMgr::EntryPlayer(players[i], entry[i])                   // @0x7100000c3c
for i: for j≠i: players[i].EntryAtherPlayer(handle(players[j]))  // → PlayerCom::EntryOtherPlayer
GameMgr::CreateGuide()       // "hs_system/layout.lyt"·"sys_guide_02.bflyt", 메시지 "hsmg402_MGctrlGuide", 처음 숨김
return true
```

`GameMgr::EntryPlayer(p, k)`:
1. `Player::EntrySnowBallMgr(SnowBallMgr 핸들)`, GameMgr 목록(+0x08~+0x18)에 push.
2. pos_op 뼈 `"cha_pos0%d" % k`의 위치·회전을 읽는다. **위치 y는 1.0으로 덮어쓴다**(`fmov s0,#1.0`).
3. `Actor::SetSystemScaleVec((2,1,2,0))`, `FluidMaterialParamChange((0,1,1,1))`.
4. vt+0x240 `SetPosition`, vt+0x268 `SetRotationQuaternion`, 쿼터니언 → yaw(rad) × 57.29578 → `setLeverRotateY(도)`.
5. `SetEnable(false)`(단계 8까지 조작 불가).

| 뼈 | 위치(데이터 y=0, 코드가 y=1.0으로) | yaw |
|---|---|---|
| cha_pos00 | (−4.5, 1.0, −4.5) | 45° |
| cha_pos01 | (4.5, 1.0, −4.5) | −45° |
| cha_pos02 | (−4.5, 1.0, 4.5) | 135° |
| cha_pos03 | (4.5, 1.0, 4.5) | −135°(데이터 3.9269907 rad = 225°) |

[데이터: pos_op 뼈] + [재구현 계산: yaw]. 전원 원점을 본다(yaw 0 = +Z, 방향 = (sin yaw, 0, cos yaw)). `entry[i]`(플레이어 → cha_pos 번호)의 뜻은 [미확정]이다.

### 3.4 흐름 단계별 동작 (장면 Update 안, 한 프레임에 한 걸음) [판독]

| 단계 | 훅 | hsmg402 동작 | 다음 |
|---|---|---|---|
| 0 Init | OnGameInit | 부속 0: 앞에서부터 보며 **y > 0인 플레이어가 있으면 거짓**(y=1.0에서 떨어져 착지 대기). y ≤ 0인 플레이어마다 `SetSystemScaleVec((1,1,1,0))`, `FluidMaterialParamChange((1,1,1,1))`. 모두 착지하면 `Camera::PlayAnim(0 cam_op, 1.0)`, 부속=1, 거짓. 부속 1: `StopAnim`, 부속=0, **참** | 4 |
| 4 FirstFade | 기본 | 페이드 인 | 5 |
| 5 Opening | OnGameOpening | 부속 0: `PlayAnim(0, 1.0)`, 부속=1. 부속 1: `IsFinishedAnim`이면 `PlayAnim(1 cam, 0.0)`, 부속=0, 참 | 6 |
| 6 StartBefore | OnGameStartBefore | 오프닝 스킵(Scene+0x3A8) && 부속==1이면 `PlayAnim(1, 0.0)`, 부속=2, 거짓(한 프레임 대기). 그 밖은 참 | 7 |
| 7 Start | 기본 | 시작 텔롭·카운트다운, `UITimer::StartTimer`(main) | 8 |
| 8 StartAfter | OnGameStartAfter | `GameMgr::Start @0x7100001eb4`: 전원 `SetEnable(true)`, 목록을 `GetPlayerID` **오름차순** 정렬. main이 `PlayerCtrlStart` | 9 |
| 9 Main | OnGameMain | `GameMgr::Update`(6.1). 참이면 `ResultPreparation(카메라)` 후 참 → main `PlayerCtrlEnd(1.0)` | 10 |
| 10~12 | 기본 | main 흐름(라운드·결과 UI) | 13 |
| 13 EndingBefore | 항상 참 | | 14 |
| 14 Ending | OnGameEnding | `GameMgr::Result`(6.3)가 참이 될 때까지 | 15 |

- 단계 9의 main 처리기 `@0x710008bab4`는 OnGameMain이 거짓이어도 `GetMGJudgeType()==1`이고 누군가 `GetPlayerMGWinLose(i)==1`이면 끝낸다(외부 판정 모드) [판독].
- `SnowBallMgr::Update`(삭제)와 탈락 판정은 **단계 9에서만** 돈다. 결과 연출 중에도 공 엔티티는 자기 틱으로 계속 움직인다 [판독].
- 단계 7~9에서 3분 타이머가 끝나면 main이 단계 10으로 보낸다(01_core §5.5). hsmg402는 60초 타이머가 먼저 끝난다.
- hsmg402 흐름은 파이버가 아니라 장면 Update에서 진행된다. 세 노트 어디에도 hsmg402의 `bex::Fiber` 사용 기록은 없다 [판독].

### 3.5 한 프레임 안의 엔티티 순서 [판독 + 미확정]

| 엔티티 | TickOrder | 메시지 → 처리 | 근거 |
|---|---|---|---|
| PlEvCol(플레이어 이벤트 충돌, Player+0xD98) | **1** | 0x1B → `CollisionHit`(아무것도 안 함), 0xB000 → `SnowBallHit` | `Player::Init @0x7100005700` `ChangeTickOrder`, 메시지 `@0x7100005ed4/0x7100005f24` |
| SnowHandPos(pos_snowball 모델 엔티티) | 1 | 0 → `UpdatePos` | `SnowHandPos::Create @0x7100014d58`(ChangeTickOrder `@0x7100014e24` 부근) |
| Player 모델 엔티티 | [미확정: 이 NRO에서 바꾸지 않음] | 틱 → vt+0x70 → `Player::Update @0x7100006cb0` | player 노트 3.2 |
| ActorManager 엔티티 | [미확정] | 메시지 → main `@0x71000e3dd8`(모든 액터 controlPre → control → 충돌 → controlPost → updateModel) | player 노트 3.2 |
| 장면(MainLoop) | 2 | 0 → 장면 Update(흐름 단계) | 01_core §5.3 |
| SnowBall 모델·break 모델 | 2 | 0 → `SnowBall::Update`, 0x1B → `HitMessageTrig`, 0xB001 → `HitMessage` | `SnowBall::Create @0x7100010630/0x710001063c` |
| 장면 보조 엔티티 | 2 | 5 → `PostPhysics`(SeMgr::Reset) | OnSetupGame `@0x7100015f90` |
| Player PostPhysics | — | 물리 뒤 → `Player::PostPhysics @0x71000071dc` | player 노트 8.3 |

- **정정:** flow 노트 3.6 표는 "Player TickOrder 1"이라 적었다. `Player::Init`의 `ChangeTickOrder(…, 1)` 대상은 Player+0xD98에 저장된 **PlEvCol 엔티티**다. 이 문서 작성 중 `hsmg402_player_all.c`에서 `Engine::CreateEntity` → `*(this+0xd98) = …` → `ChangeTickOrder(그 엔티티)` 순서를 다시 확인했다 [판독]. Player 모델 자체의 TickOrder는 이 NRO에서 바꾸지 않는다.
- TickOrder 값은 판독이지만, 작은 값이 먼저인지, 같은 값 안의 순서, 트리거 메시지(0x1B)가 물리 단계 어디서 오는지는 Bezel 엔진 내부라 **[미확정]**이다(01_core §3.3과 같은 미확정).
- 이 순서가 관측 결과를 바꾸는 곳(알려진 것):
  1. 연타 첫 입력이 두 번 세지는가(9회 vs 10회, 6.5).
  2. 손에 든 공이 이번 프레임 손 위치를 쓰는가 한 프레임 전 것을 쓰는가(SnowHandPos(1) vs SnowBall(2)).
  3. state −1 공이 CPU 위협 목록에 잡히는가(6.13.2).
  4. 게임 종료 프레임에 막 낙하 상태가 된 플레이어가 `ActionIdle`을 받는가(5.4).

## 4. 구조체·필드·상수·열거형

### 4.1 SceneHsmg402 (장면 객체 기준) [판독]

| 오프셋 | 타입 | 내용 | writer / reader |
|---|---|---|---|
| +0x3A8 | u8 | 오프닝 스킵(기반 클래스) | main / OnGameStartBefore |
| +0x3D0~+0x3E8 | 핸들 | PostPhysics 엔티티 | OnSetupGame / OnCleanupGame |
| +0x3F0 / +0x3F8 / +0x400 | HsModel* | dir_light / env / fluid | OnSetupGame |
| +0x408 | bex::Camera* | 장면 카메라 | OnSetupGame / 훅, ResultPreparation |
| +0x410 | GameMgr* | | OnSetupGame / OnGameMain 등 |
| +0x418~+0x428 | vector<unique_ptr<Player>> | | OnSyncSetup |
| +0x430 | Map* | | OnSetupGame |
| +0x438 | SeMgr* | | OnSetupGame / PostPhysics |
| +0x444 | int | 훅 부속 단계(Init/Opening/StartBefore 공용) | 훅들 |

### 4.2 GameMgr (0xA8 B, GameMgr 기준) [판독]

| 오프셋 | 타입 | 내용 | writer | reader |
|---|---|---|---|---|
| +0x08~+0x18 | vector<Player*> | 참가자(Start 후 ID 오름차순) | EntryPlayer, Start | Update, Result |
| +0x20 | SnowBallMgr* | | Create | Update, EntryPlayer |
| +0x28 | HsModel* | pos_op | Create | EntryPlayer |
| +0x30~+0x48 | HsModel* | pos_result_* (**읽는 곳 없음**) | Create | — |
| +0x50~+0x68 | UIMGTelop* | type 0/2/5/6 | Create | +0x60·+0x68만 Result |
| +0x70 | UITimer* | 60초 | Create | Update |
| +0x78 | 가이드 UI | `UICtrlGuide`(In `@0x7100003f80`, Out `@0x7100003fc4`) | CreateGuide | Update, GameFinish |
| +0x88 | int | 종료 카운터 / 결과 단계 | Update(++), ResultPreparation(0), Result | Update, Result |
| +0x8C | f32 | 결과 대기 누적 | Result | Result |
| +0x90 | bool | 타이머 종료 판정 허용(생성자 1, 바꾸는 곳 없음) | 생성자 | Update |
| +0x98 | bex::Camera* | 장면 카메라 | ResultPreparation | Result |
| +0xA0 | MiniGameFinishPlayerUpCamera* | 승자 1명일 때 | Result | Result |

### 4.3 Player (0xE70 B, `hs::ActorPlayer` 상속, Player 기준) [판독]

| 오프셋 | 형 | 뜻 | 초기값 | writer | reader |
|---|---|---|---|---|---|
| +0x48C | int | 플레이어 ID(GW_PLAYER_ID) | Initialize | — | CreateSnowBall(공 creatorId), GetComLevel |
| +0x521 | u8 | ActorPad+0x11 오버레이 입력(COM) | 0 | Init, Update | main ActorPad |
| +0x527 | u8 | Actor+0x67 조작 허용 | — | `SetEnable` | Update(A), ActionEX1(B 세기) |
| +0x63C | int | Actor+0x17C 현재 행동 ID | — | `Actor::SetActionID` | Update, SetDamage, GameMgr::Result |
| +0x644 | int | Actor+0x184 행동 부속 단계 | — | `Actor::SetControl` | ActionEX4~8 |
| +0x96C | f32 | 낙하 중 모션 속도 0.3 기록(쓰기만) | — | ActionEX8 | 없음 |
| +0xD68 | u8 | 갱신 허용(입력·COM) | 1 | SetEnable | Update |
| +0xD6C~0xD84 | int×7 | 추가 모션 번호 sb_make00, sb_idle00, sb_idle01, sb_walk00, sb_walk01, sb_push00, co_wriggle00 | 0 | Init | EX1~4, EX8 |
| +0xD88~0xD94 | int×4 | EX5용 모션 번호(아무도 안 씀 → 0) | 0 | — | EX5 |
| +0xD98~0xDB0 | 핸들 | PlEvCol 엔티티 | — | Init | — |
| +0xDB8 | ptr | SnowHandPos | — | Init | CreateSnowBall |
| +0xDC0~0xDD8 | 핸들 | SnowBallMgr | — | EntrySnowBallMgr | CreateSnowBall |
| +0xDE0~0xDF8 | 핸들 | 손에 든 공(+0xDF8 = −1이면 없음) | 없음 | CreateSnowBall, Update(정리) | 거의 전부, SetUpFinishEvent |
| +0xE00 | int | 연타 수 | 0 | EX1 | EX1 |
| +0xE04 | f32 | 연타 제한 타이머 | 0 | EX1 | EX1 |
| +0xE08 | f32 | 반사 뒤집기 기준 y(−33, 표현 전용) | −33 | 생성자 | Update |
| +0xE0C | u8 | 걷다가 큰 공 모션으로 바꿨음 | 0 | EX1(0), EX3(1) | EX3 |
| +0xE0D | u8 | 넉백 중 | 0 | SetDamage(1), PostPhysics(0) | Update, PostPhysics |
| +0xE0E | u8 | 넉백 첫 PostPhysics 건너뛰기 | 0 | SetDamage(1), PostPhysics(0) | PostPhysics |
| +0xE10 | Vec4 | 넉백 초속 | 0 | SetDamage | EX6, EX7 |
| +0xE20 | Vec4 | 0 벡터(정지용) | 0 | PostPhysics | PostPhysics |
| +0xE30 | f32 | 7.0(쓰이지 않음) | 7.0 | 생성자 | — |
| +0xE34 | f32 | 넉백 감쇠 계수 | 0.42 | SetDamage(표) | Update |
| +0xE38 | f32 | 중력 | −37 | 생성자 | Init, Update |
| +0xE3C | f32 | 넉백 세움 각(도) | 68.5 | SetDamage(표) | SetDamage |
| +0xE4C | f32 | **탈락 시각**(= 60 − RemainSecond, 0 = 생존) | 0 | GameMgr::Update | GameMgr, PlayerCom(+0x5C 탈락 표지) |
| +0xE50 | ptr | PlayerCom | — | Init | Update |
| +0xE58 | int | **순위**(0 = 1등) | 3 | GameMgr::Update | GameMgr::Result |
| +0xE5C | int | EX5 인자 | — | EX5 | EX5 |
| +0xE60 | f32 | 0.33(읽는 곳 없음) | 0 | EX6 | — |
| +0xE64 | f32 | 넉백 정지 모션 프레임 | 22 | SetDamage(표) | PostPhysics |
| +0xE68 | u8 | **IsFall**(낙하 상태 표지) | 0 | Update | IsFall, GameMgr::GameFinish·Result, PlayerCom::Update 호출 조건 |
| +0xE69 | u8 | COM 표지 설정됨 | 0 | Init, Update | Update |

GameMgr가 부르는 Player 가상 함수: vt+0x250 `HsModel::GetPosition`(탈락 y 판정), vt+0x448 `PlayerModel::GetPlayerID`, vt+0x4A8 `ActorPlayer::ActionWin(bool,int)`, 부속 vtable(Player vtable+0x570) vt+0x88 `Actor::ActionIdle`·vt+0xA0 `Actor::ActionTurn` [판독].

### 4.4 hs::actor::Actor (main, Actor 기준)에서 이 게임이 쓰는 칸 [판독]

| 오프셋 | 뜻 | 근거 |
|---|---|---|
| +0x50 | ActorPad(4.5) | main `checkLever @0x71000f172c` |
| +0x17C / +0x180 / +0x184 | 행동 ID / 진입 표지 / 부속 단계 | `SetActionID @0x71000f0590`, `SetControl @0x71000e60f8` |
| +0x1A0 | 목표 회전(도, `setLeverRotateY`) | `@0x71000e5cbc` |
| +0x1E0 | 추가 속도 벡터(add vector) | `SetAddVector @0x71000e5b64` |
| +0x240 | 카메라 없을 때 스틱 기준각(0 [추정]) | `@0x71000e5e0c` |
| +0x248 | 메인 카메라 핸들(이 NRO는 `SetMainCamera`를 부르지 않음) | `@0x71000e5e14` |
| +0x280 | 걷기 속도 | `SetWalkSpeed/GetWalkSpeed` |
| +0x2A4 | 중력 | `SetGravity` |
| +0x2D4 | 최대 낙하 속도(−49 [추정]) | `@0x71000e58c4` 근처 |
| +0x2D8 / +0x2DC / +0x2E0 | 회전 속도 360 / 고속 1100 / 고속 경계 85 | `ResetRotParam @0x71000e5900` |
| +0x7B0~0x7BC | 캡슐 top/bottom/r/종류 | `SetCapsuleHitRange` |

### 4.5 ActorPad (Actor+0x50) [판독: main `ActorPad::ActorPad @0x71000dfdcc`]

| 오프셋 | 뜻 | 값 |
|---|---|---|
| +0x11 | 오버레이 모드(COM) | Player+0x521 |
| +0x1C / +0x20 | 오버레이 마스크 | 0x7FFFFFFF |
| +0x24 | 버튼 마스크 | 0x003F1DF0 (0x400·0x800 포함) |
| +0x2C | 오버레이 트리거 | COM이 `AddOverlayTrigger`/`ResetOverlayTrigger` |
| +0x88 / +0x8C | 오버레이 스틱(x, y) | COM `SetLStickNormalize`(각 ±1로 자름) |
| +0x94 | 스틱 데드존 | 0.1 |

버튼 재배치(`getTrig`): ActorPad 0x400 = 원시 bit1 = **B**(`(raw&2)<<9`), 0x800 = 원시 bit0 = **A**(`(raw&1)<<11`). 오버레이 모드면 `+0x1C & +0x2C & +0x20` [판독].

### 4.6 SnowBall (0x140 B, `SnowBallMgr::CreateSnowBall @0x71000141f8` 인라인 생성자, SnowBall 기준) [판독]

| 오프셋 | 타입 | 내용 | writer | reader |
|---|---|---|---|---|
| +0x20 | HsModel* | `model/hsmg402_snowball.fmdb`, TickOrder 2 | Create | 전부 |
| +0x28 | HsModel* | `model/hsmg402_snowball_break.fmdb`, 숨김, 애니 표 `[0]=".../hsmg402_snowball_break"` | Create | UpdateCrash |
| +0x30~+0x48 | 핸들 | SnowHandPos | Create | 손 상태 |
| +0x50~+0x68 | 핸들 | 던진이 ComTransform | Create | 손 상태(방향·위치) |
| +0x70 | Vec4 | 직전 플레이어 위치(x, 0, z) | Create, UpdateHand | UpdateHand |
| +0x80~+0x98 | 핸들 | 던진이 Entity(자기 충돌 무시) | Create | HitMessageTrig |
| +0xA0~+0xB8 | 핸들 | ComCollision(구, 반지름 1.1×scale, 레이어 10, trigger) | Create, 레벨업 | Crash, Disable |
| +0xC0 | Vec4 | 손 위치(마지막) | UpdatePosition | UpdateHand |
| +0xD0 | Vec4 | 이동/가속 벡터 d | UpdateHand, Shot, UpdateShot | UpdateShot, CPU(`GetSnowBallMoveVec`) |
| +0xE0 | Vec4 | 속도 v(**프레임당 변위**) | Shot, UpdateShot, UpdateHand(낙하 전환 때 0) | UpdateShot |
| +0xF0 | Vec4 | 낙하 벡터(y만 의미) | UpdateShot | UpdateShot |
| +0x100 | f32 | 성장 타이머(초기 1.0) | UpdateHand | UpdateHand |
| +0x104 | u8 | 가속 중 | Shot, UpdateHand(낙하 전환) | UpdateShot |
| +0x108 | int | creatorId(−1 초기) | Create | `GetCreaterId`(CPU) |
| +0x10C | int | level 0~7 | UpdateHand | 전부 |
| +0x110 | int | state: 0 손, 1 굴러감, 2 부서짐, −1 삭제 대기 | Create(0), Shot·UpdateHand(1), Crash(2), UpdateCrash·ResHand·Disable·UpdateShot(−1) | Update, Mgr, Player::Update |
| +0x114 | int | state 부속 단계(state 쓸 때 64비트로 같이 0) | | UpdateCrash |
| +0x118 | int | 출현 이펙트 단계 0→1→2(1일 때 "SNOWBALL_APPEAR00") | Update | Update |
| +0x11C | u8 | 낙하 플래그(가장자리 넘어감) | UpdateHand, UpdateShot | Update |
| +0x11D / +0x11E / +0x11F / +0x120 | u8 | MOVE / THROW / FALL / BREAK 이펙트 재생 중 | | |
| +0x124 / +0x128 / +0x12C | 사운드 핸들 | 이동음 / 굴림음 / … | UpdateMoveSe 등 | |
| +0x130 | u8 | 낙하음 1회 재생됨 | PlayFallSe | PlayFallSe |
| +0x131 | u8 | 던진 공(Shot(…, true)) | Shot | UpdateShot(공중이면 0) |

`SnowBallMgr`(0x30 B): +0x18 `vector<unique_ptr<SnowBall>>`(32칸). `CreateSnowBall`은 첫 빈 칸에 만들고, 칸이 없으면 무효 핸들이다. `Update @0x7100014498`는 state == −1인 공을 삭제한다. 읽기 함수: `GetSnowBallPos`(모델 위치), `GetSnowBallMoveVec`(+0xD0), `GetSnowBallLevel`(+0x10C), `GetSnowBallSize`(= scale.x × 1.1), `GetCreaterId`(+0x108), `IsDeleteWait @0x7100014664`(state == −1), `IsGrowth @0x7100014688`(state == 0) [판독].

### 4.7 PlayerCom (0x5B0 B, PlayerCom 기준) [판독: 생성자 `@0x710000bbb4`]

| 오프셋 | 뜻 |
|---|---|
| +0x08 | Player* |
| +0x10 | 켜짐(`Enable`) |
| +0x18~0x28 | 다른 3명 핸들 |
| +0x30~0x48 | SnowBallMgr 핸들 |
| +0x50 | 이동 목표 위치 |
| +0x60 | 직전 프레임 자기 위치 |
| +0x70 / +0x74 | 원점 수평 거리 / 거리 ≥ 8.0 |
| +0x78~0x88 | vector<AtherPlayerState>(0x60 B): +0 ID, +0x10 위치, +0x20 normalize(위치.xz), +0x30 normalize(상대.xz − 나.xz), +0x40 상대 정면, +0x50 상대 원점 수평 거리, +0x54 나와의 수평 거리, +0x58 상대 공 레벨, +0x5C 탈락(Player+0xE4C > 0), +0x5D 무적 |
| +0x90 + i×0x40 | 위협 공 기록 20칸: +0 공 위치(y=0), +0x10 나→공 방향, +0x20 공 이동 벡터, +0x30 레벨, +0x34 거리, +0x38 반지름 |
| +0x590 | 위협 공 수 |
| +0x594 | 대기/연타 타이머 |
| +0x598 | 표적 인덱스(−1 없음) |
| +0x5A0 / +0x5A4 | 행동(0 생각, 1 걷기, 2 만들기, 3 던지기) / 부속 단계(8바이트로 같이 씀) |
| +0x5A8 | COM 레벨 0~3(`GameWork::GetComLevel`, 사람 전원 탈락 시 GameMgr가 3으로) |

### 4.8 HitSnowBallInfo (0x60 B, 메시지 0xB000/0xB001 인자) [판독]

+0 level(int), +4 power(int, 6.12 소리 크기 식 0~127), +0x10 공 엔티티 Translation, +0x30 공 모델 위치, +0x40~+0x58 공 모델 엔티티 핸들.

### 4.9 상수 [데이터: NRO 정적 상수, 심볼 이름 그대로]

| 심볼 | 주소 | 값 |
|---|---|---|
| `GameMgr::GameTime` | 0x7100030668 | 60.0 |
| `Player::DamageVecRes[8]` | 0x7100030760 | 0.42 ×8 |
| `Player::DamageVecLen[8]` | 0x7100030780 | 7.0, 8.96, 10.92, 13.58, 16.17, 18.55, 21.28, 23.03 |
| `Player::DamageVecDeg[8]` | 0x71000307A0 | 68.5 ×8 |
| `Player::DamageMoveAnimFrame[8]` | 0x71000307C0 | 20, 20, 21, 21, 22, 22, 22, 22 |
| `Player::TRIGGER_COUNT_END_TIME` | 0x71000307E0 | 0.5 |
| `Player::CREATE_TRIGGER_COUNT` | 0x71000307E4 | 9 |
| 무명 걷기 속도 배율[8] | 0x71000307E8 | 1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.5 |
| 무명 걷기 모션 속도[8] (×0.001로 씀) | 0x7100030808 | 0.5, 0.4, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1 |
| 무명 CPU 걷기 중단 %[8] | 0x7100030828 | 0, 0, 5, 10, 50, 80, 90, 100 |
| `PlayerCom::OUT_FIELD_LENGE` | 0x7100030848 | 8.0 |
| `PlayerCom::MOVE_GOAL_LIMIT` | 0x710003084C | 0.01 |
| `PlayerCom::CREATE_BUTTON_TRIG_TIME[4]` | 0x7100030850 | 0.18181819, 0.16666667, 0.125, 0.1 |
| `PlayerCom::SHOT_PROBABILITY[4][8]` | 0x7100030860 | 레벨0 {10,10,30,40,60,80,90,90}, 레벨1 {1,5,20,30,50,70,80,99}, 레벨2·3 {5,10,20,30,50,70,80,99} |
| `SnowBall::MAX_LEVEL` | 0x71000308E0 | 7 |
| `SnowBall::MAX_SIZE` | 0x71000308E4 | 1.1 |
| `SnowBall::SIZE_CHANGE_TIME` | 0x71000308E8 | 1.0 |
| `SnowBall::SIZE_SCALE[8]` | 0x71000308EC | 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0 |
| `SnowBall::MIN_SIZE` | 0x710003090C | 0.44 |
| `SnowBall::MAX_MOVE_SPEED` | 0x7100030910 | 0.1(프레임당) |
| `SnowBall::DOWN_SPEED` | 0x7100030914 | −0.98 |
| `SnowBall::DELETE_LIMIT_Y` | 0x7100030918 | −11.0 |
| `EX_COL_NAME` | 0x71000351B0 | "PlEvCol" |
| `SnowBall::HitMessageTrig::SNOW_BALL_NAME` | 0x71000376D8 | `HashedString("hsmg402_snowball.fmdb")` |
| 즉시값 | | 1.1(0x3F8CCCCD), 0.12(지면 레이 여유), 0.98(법선 y 문턱), 0.010000001(= 0.1²), FLT_EPSILON(0x34000000), 0.65999997, −0.44000003, 67.24(낙하 반지름² = 8.2²), −0.5, −1.0, 57.29578(0x42652EE1), 0.017453292, 0.001(0x3A83126F) |
| main `hs_actorparam.csv` | 행 1~37 | WALK 2.0(행 2), RUN 6(행 1), ROT 360/1100/85, G −9.8(행 10, 이 게임은 −37로 덮음), CAPSULE (1, 0.5, 0.5)(행 32). 행 번호 = 파일 첫 빈 줄이 행 0. 로더 main `FUN_71000e4e78`, 값 = 0x71015EB0F8 + 행×16 |

### 4.10 열거형·메시지·레이어

| 종류 | 값 |
|---|---|
| 행동 ID(Actor+0x17C) | 0 대기, 1 걷기, **0x11 만들기(EX1), 0x12 공 들고 대기(EX2), 0x13 공 들고 걷기(EX3), 0x14 던지기(EX4), 0x15 마무리(EX5, 호출처 없음), 0x16 앞 피격(EX6), 0x17 뒤 피격(EX7), 0x18 낙하(EX8)**. 기본 2~0xF(달리기·점프 등)는 모션 묶음 0x4F03에 없어 들어가지 못한다 |
| 눈덩이 state(SnowBall+0x110) | 0 손, 1 굴러감, 2 부서짐, −1 삭제 대기 |
| CPU 행동(PlayerCom+0x5A0) | 0 생각, 1 걷기, 2 만들기, 3 던지기 |
| 메시지 | 0 틱, 5 PostPhysics, 0x1B TriggerEntered, 0xB000 공→플레이어 피격, 0xB001 공→공 |
| 충돌 레이어 | 4 플레이어 본체 캡슐, 10 눈덩이 구, 11 PlEvCol. 켬 (4,10)(10,10)(10,11)(11,11), 끔 (10,6)(10,9)(11,6)(11,9). 지면 Cast 필터 12 [추정: 지형] |
| 이펙트 단계 tier | `level < 3 ? 0 : level < 6 ? 1 : 2` → `SNOWBALL_MOVE0%d`·`THROW0%d`·`BREAK0%d`의 %d |

## 5. 상태 전이와 전체 수명

### 5.1 게임 한 판

```
OnSetupGame(충돌 레이어·조명·GameMgr·ActorManager·Map·카메라·SeMgr)
→ OnSyncSetup(플레이어 생성·cha_pos 배치 y=1.0·SetEnable(false)·가이드 숨김)
→ 단계 0: 낙하 착지 대기(y ≤ 0) → 스케일 (2,1,2)→(1,1,1) → cam_op 재생/정지
→ 단계 5: cam_op 끝까지 → cam(게임 카메라) → 단계 7: 카운트다운·타이머 시작
→ 단계 8: GameMgr::Start(전원 SetEnable(true), ID 정렬)
→ 단계 9: 매 프레임 GameMgr::Update(공 삭제·가이드 10초 Out·탈락·순위·종료)
   참 → ResultPreparation(손에 든 공 ResHand+EventCrash) → main PlayerCtrlEnd
→ 단계 14: GameMgr::Result(승자 회전·카메라·승리 동작·2초) → 단계 15~
→ OnCleanupGame
```

재도전(단계 17)이면 main이 SetupGame·SyncSetupGame을 다시 부른다(01_core §5.5). hsmg402 쪽 재초기화는 OnSetupGame·OnSyncSetup이 객체를 새로 만들어 덮는 것으로 이루어진다 [판독: +0x410 등 대입 전에 이전 객체 삭제 패턴]. 재도전 경로 자체는 실행 확인하지 않았다.

### 5.2 플레이어 행동 상태기계 [판독]

| ID | 함수 | 진입 때 | 매 프레임 | 나가는 조건 → 다음 |
|---|---|---|---|---|
| 0 대기 | main `ActionDefaultIdle @0x71000f0494` | add 0, `SetMotionIdle` | `ActionChange(0x38)` | 스틱 → 1. **B → 0x11**(Update) |
| 1 걷기 | main `@0x71000f066c` | `co_walk00` | `MoveGround(1, walkSpeed)` | 스틱 없음 → 0. **B → 0x11** |
| 0x11 만들기 | `ActionEX1 @0x7100007378` | `SetControl(0)`, add 0, `sb_make00`, e0C=0, 수=0, 타이머=0.5 | 6.5 | 9회 → `CreateSnowBall` → 0x12. 타이머 ≤ 0 → 0 |
| 0x12 공 들고 대기 | `ActionEX2 @0x7100007988` | add 0, 공 레벨 > 2면 `sb_idle01` 아니면 `sb_idle00`, 모션 속도 1.0 | | 공 없음 → 0. 스틱 → 0x13. **A → 0x14**(Update) |
| 0x13 공 들고 걷기 | `ActionEX3 @0x7100007bf4` | add 0, 레벨 > 2면 `sb_walk01` 아니면 `sb_walk00`(블렌드 0.75) | 6.6 | 스틱 없음 → 0x12. 공 없음 → 0 또는 1. **A → 0x14** |
| 0x14 던지기 | `ActionEX4 @0x7100008c78` | `SetControl(0)`, add 0, `sb_push00`, `ResetRotParam`, 걷기 2.0 | 부속 0: 모션 프레임 ≥ 4.0이면 공 있으면 `Shot(정면 Z, true)`·부속 1, 없으면 → 0. 부속 1: 모션 끝 → 0 | |
| 0x15 마무리 | `ActionEX5 @0x7100009258` | 공 `Shot(0, false)` | | **부르는 곳 없음** |
| 0x16 앞 피격 | `ActionEX6 @0x71000094fc` | `co_damage02`(기본 ID 0xE), 든 공 `Crash`, 공 쪽을 보게 회전 | 부속 0·모션 프레임 ≥ 20 → `SetBlinkTimer((끝−프레임)/60)`, 부속 1. 모션 끝 → `SetEndBlink`, → 0 | |
| 0x17 뒤 피격 | `ActionEX7 @0x710000992c` | `co_damage03`(0xF), 날아가는 쪽을 보게 회전 | 같음 | |
| 0x18 낙하 | `ActionEX8 @0x7100009d50` | FX `VO_HSMG402_FALL`. 피격 모션 중이고 프레임 ≥ 16이면 모션 속도 0.3. 피격 모션이 아니면 `co_wriggle00`. 수평 거리 ≤ 11.5면 FX `SNOW_FALL00`. 발·몸 재질 배율 0 | | **없음**(탈락은 GameMgr의 y ≤ −1) |

- **정정:** flow 노트 6.3은 "`ActionEX5`는 `Shot(0, false)`(떨굼)"을 동작으로 적었다. player 노트가 vt+0x4D0·Actor vt+0x128·ID 0x15 설정처를 전수 확인해 **부르는 곳이 없음**을 밝혔다 [판독]. 그래서 "떨굼" 경로는 관측되지 않는다. 웹에서 빼도 동작이 같다.
- `SetDamage`는 0x18을 막지 않는다. 낙하 중 다시 맞으면 0x16/0x17로 바뀌고, 다음 Update에서 아직 밖이면 다시 0x18로 간다(낙하 음성 다시 재생) [판독].

### 5.3 눈덩이 수명 [판독]

```
CreateSnowBall(연타 9회) → state 0(손): 플레이어가 움직이면 성장, 손 앞 r 거리·높이 r
  ├ A(던지기 모션 프레임 4) → Shot(정면, true) → state 1
  ├ 손 아래 지면 없음(가장자리) → state 1(d = 이동 방향×1.1), 낙하 플래그, 낙하음
  ├ 트리거 접촉(플레이어·다른 공) → Crash → state 2   (손에 든 공도 해당)
  ├ 들고 있던 플레이어가 맞음(EX6/7) → Crash → state 2
  └ 결과 준비(SetUpFinishEvent) → ResHand(state −1) + EventCrash(Crash+HIT_YKD)
state 1: 방향 고정·가속 → 0.1/프레임, 지면 Cast, 공중이면 낙하, y < −11 → state −1
         트리거 접촉 → Crash → state 2
state 2: 공 숨김, break 모델 50f 애니 → 끝나면 state −1
state −1: 다음 단계 9 GameMgr::Update 의 SnowBallMgr::Update 에서 삭제
```

- 레벨은 손에 있을 때만 오른다. 굴러가는 동안 크기는 그대로다(UpdateShotTransform에 SetScale 없음).
- `Disable @0x71000134a8`(state −1·숨김·충돌 끔)을 부르는 `SnowBallMgr::AllRemove`는 이 NRO에서 호출처가 없다.
- 단계 9가 끝난 뒤(결과 연출)에는 삭제가 일어나지 않는다. state −1 공은 장면이 끝날 때까지 슬롯을 차지한다. 32칸이 차는 경로는 4인 게임에서 찾지 못했다 [판독+추정].

### 5.4 낙하 상태(0x18)와 탈락 기록의 관계 — **조정**

두 노트의 판정은 서로 다른 함수의 서로 다른 조건이다. 둘 다 맞고, 역할이 다르다.

| 판정 | 어디서 | 조건 | 결과 | 수준 |
|---|---|---|---|---|
| 낙하 상태 진입 | `Player::Update @0x7100006eb0~0x7100006f20`(Player 모델 틱) | 행동 ≠ 0x18 && `!((x²+z²)+(y²+w²) < 67.24 && y ≥ −0.5)` — **3차원** 길이² ≥ 67.24(8.2²) 또는 y < −0.5 | IsFall(+0xE68)=1, `ActionEX8`(0x18). CPU 생각 중지, 입력 무시. 넉백은 감쇠·중력으로 계속 | [판독] |
| 탈락 기록 | `GameMgr::Update @0x7100001fac`(장면 틱, 단계 9) | fallTime ≤ 0 && `GetPosition().y ≤ −1.0`(`b.hi`로 y > −1이면 생존) | fallTime = 60 − RemainSecond, SetEnable(false), RemoveActivePlayer, 순위 | [판독] |

- GameMgr는 탈락에 IsFall을 **읽지 않는다**. IsFall을 읽는 곳은 `GameFinish`(IsFall이 아닌 플레이어만 `ActionIdle`)와 `Result`(승자 동작은 fallTime ≤ 0 && !IsFall인 사람만)뿐이다 [판독].
- 생존자 수(alive)도 y > −1만 센다. 그래서 낙하 상태지만 아직 y > −1인 플레이어는 생존자로 세어지고, 게임은 그 사람이 y ≤ −1을 지날 때까지 이어진다.

지면 위로 가장자리를 넘어갈 때의 순서 [산술: assets 노트 6.3 단면 표를 구간 선형 보간, 위치가 발 기준이고 지면에 붙어 있다고 가정]:

| 경계 | 지면 위 수평 반지름 | 단면 위치 |
|---|---|---|
| 평평한 원판 끝 | 7.4971 | 고리 1 |
| 손에 든 공이 "지면 없음"이 됨(공 중심 아래 지면 y < −0.12) | ≈ 8.078 | 고리 2~3 사이 |
| 낙하 상태(|p|² ≥ 67.24) | ≈ 8.197 | 고리 3(8.1986, −0.2092) 바로 앞 |
| 낙하 상태(y < −0.5) | ≈ 8.431 | 고리 4 바로 뒤 |
| **탈락(y ≤ −1.0)** | ≈ 8.528 | 고리 5(8.5264, −0.9679) 바로 뒤, 거의 수직 벽(법선 y 0.06) |
| 눈덩이 삭제(y < −11) | ≈ 13.125 | 넓은 원뿔 경사(고리 6→7) 위 |

- 그래서 걸어서·밀려서 떨어지면 **낙하 상태가 먼저**(|p| 조건), 몇 프레임 뒤 **탈락 기록**이 온다. y < −0.5 조건은 지면 경로에서는 |p| 조건보다 늦어 사실상 공중 낙하용이다.
- 공중 경로: 넉백 최대 초속 y는 10.137(시작 위치에서 레벨 7, player calc)이고 최고 높이는 약 1.389다. 이 높이에서 |p|² ≥ 67.24가 되려면 수평 8.08 이상이어야 한다 [산술]. 원판(7.4971) 위 공중에서 낙하 상태에 들어가는 경우는 이 수치로는 없다.
- 같은 프레임에 두 조건이 동시에 처음 성립하는 경우(큰 변위)에도 탈락 시각은 GameMgr가 그 프레임 경과 시간으로 기록한다. 낙하 상태 진입이 같은 프레임의 GameMgr보다 앞인지 뒤인지는 엔티티 순서라 [미확정]이고, 영향은 그 프레임에 게임이 끝날 때 `GameFinish`의 `ActionIdle` 대상 여부뿐이다.
- **[미확정]** 둥근 가장자리(법선 y 0.80~0.20) 위에서 낙하 상태 플레이어가 미끄러지지 않고 y > −1에 멈출 수 있는지. 액터 지면 처리(main `collisionGroundGeo`)를 판독하지 않았다. 멈출 수 있다면 그 사람은 60초까지 생존자로 남고, 시간 종료 때 1등 순위를 받지만 `Result`에서 승리 동작은 하지 않는다(!IsFall 조건).

### 5.5 CPU 생각 수명 [판독]

`PlayerCom::Update`는 `Player::Update` 안에서 +0xD68 켜짐 && IsPlayerCom && !IsFall일 때만 돈다. 행동 함수가 참을 돌려주면 행동 = 0(생각)으로 돌아간다. 6.13 참조.

## 6. 계산식·조건·상세 의사코드

모든 실수는 f32다. dt = f32(1/60) = 0x3C888889. 벡터는 4성분(Vec4)이고 길이²·내적은 `(x·x' + z·z') + (y·y' + w·w')` 순서로 더한다(NEON `fmul; ext; fadd; faddp`). 정규화는 `frsqrte` + `frsqrts` 두 번이고 길이 0이면 0 벡터다. "fmul → fadd"는 두 번 반올림, "융합"은 한 번 반올림이다.

### 6.1 GameMgr::Update `@0x7100001fac` (단계 9, 매 프레임) [판독: 디스어셈블]

```c
bool GameMgr::Update() {
  SnowBallMgr::Update();                                   // state==-1 공 삭제
  if (finishCount /*+0x88*/ != 0) return false;
  if (!guide.outDone && 10.0f <= 60.0f - timer.RemainSecond()) guide.Out();
  if (timerCheck /*+0x90*/ && timer.IsEndTimer()) {          // 시간 종료 (IsEndTimer: UITimer+0x94 가 0 또는 3)
    for p in list: v[p.id] = p.fallTime; if (v[p.id] == 0) v[p.id] = FLT_MAX;
    ResultRank(rank, v, 4, true);
    for i,p in list: p.SetEnable(false); p.rank = rank[i];
    SysMiniGameMgr::SetPlayerRank(rank, 1);
    goto finish;
  }
  elapsed = 60.0f - timer.RemainSecond();                  // f32 뺄셈
  fallen = []; alive = 0;
  for p in list (null 제외):
    if (p.fallTime > 0) continue;
    if (p.GetPosition().y > -1.0f) { alive++; continue; }
    p.fallTime = elapsed; p.SetEnable(false);
    fallen.push(p.id); SysMiniGameMgr::RemoveActivePlayer(p.id);
  if (fallen.size >= 1) {
    if (모든 플레이어의 fallTime 이 서로 같다) { 전원 fallTime = 0; v[id] = 0 }   // 4명 동시 탈락
    else { v[id] = fallTime; 0 이면 FLT_MAX }
    ResultRank(r, v, 4, true);
    for p in list: if (p.id in fallen) { p.rank = r[p.id]; EntryPlayerRank(p.id, p.rank, 1); }
  }
  if (alive > 1) {
    if (사람 플레이어 ≥ 1명 && 사람 전원 fallTime > 0)
      for i < PlayerNum: list[i].SetComLevel(3);           // 매 프레임
    return false;
  }
  if (fallen.size < list.size)
    for p with p.fallTime <= 0: p.rank = 0; EntryPlayerRank(p.id, 0, 1);   // 생존자 1등
finish:
  GameFinish();   // @0x7100002614: 가이드 Out, 전원 SetEnable(false), IsFall 아닌 플레이어 ActionIdle(true,0)
  finishCount++;
  return true;
}
```

- 동시 탈락 처리는 "모든 플레이어"의 fallTime이 같을 때만 0으로 되돌린다. 4명이 한 프레임에 떨어질 때만 해당한다. 1명이 먼저 떨어진 뒤 남은 3명이 동시에 떨어지면 3명 공동 1등이다 [판독+재구현 계산 `last_three_same_frame`].
- 시간 종료 판정이 탈락 판정보다 먼저다. 타이머가 끝난 프레임에 떨어진 사람은 기록되지 않고 생존자(FLT_MAX)로 순위를 받는다 [판독].

### 6.2 순위 `hs::mg::Util::ResultRank(int*, float*, int, bool)` main `@0x710010b908` [판독]

```
N = GameWork::GetPlayerNum()                       // 인자 n 은 쓰지 않는다
if (모든 v[i] == 0.0) { rank[i] = N-1 for all; return; }
desc(true):  rank[i] = N-1 - #{ j≠i : !(v[i] < v[j]) }   // 큰 값이 1등, 동점은 좋은 순위(1·2·2·4 식)
desc(false): rank[i] = N-1 - #{ j≠i : !(v[i] > v[j]) }
```

예 [재구현 계산]: [10, 20, 20, MAX] → [3, 1, 1, 0], [5, 5, 3, MAX] → [1, 1, 3, 0], 전부 0 → [3, 3, 3, 3].

### 6.3 결과 `ResultPreparation @0x71000026dc`, `Result @0x7100002720` [판독]

`ResultPreparation(camera)`: +0x88 = 0, +0x98 = camera, 전원 `Player::SetUpFinishEvent @0x710000af30`(손에 든 공이 있으면 `ResHand` + `EventCrash`).

| 단계(+0x88) | 동작 | 다음 |
|---|---|---|
| 0 | 전원 rank == 인원−1이면 → 10. 아니면 rank==0인 ID 목록을 텔롭(+0x60)에 `SetPlayers`. 그중 fallTime ≤ 0 && !IsFall인 승자마다 `SetTargetRotateY(0.0)`, `ActionTurn(true,0)`. 그런 승자가 **정확히 1명**이면 `MiniGameFinishPlayerUpCamera(장면 카메라)`: `SetTargetAngle(24.7)`, `SetTime(0.8)`, `SetTargetDistance(12.8)`, `SetLookAtTaretPlayer(1.5, 승자)`, `Start` | 1 |
| 1 | 살아 있는 승자 중 행동 ID(+0x63C) ≠ 0인 사람이 있으면 대기. 카메라가 있으면 `Update()`가 참 && 대기 없음, 없으면 대기 없음일 때 → 2. 매 프레임 텔롭(+0x60) vt+0x30(1) | 2 |
| 2 | 살아 있는 승자 `ActionWin(true, 1)`(co_win01a → co_win01b), 텔롭 `Start` | 3 |
| 3 | `acc(+0x8C) = dt + acc`, `acc > 2.0`이면 **참** → 121번째 프레임 [재구현 계산] | — |
| 10 | 텔롭(+0x68, type 6, 무승부 [추정]) `Start` | 3 |

- **조정(결과 위치):** assets 노트는 `pos_result_{1win,2win,3win,draw}` 뼈 위치표(7.3)를 냈다. flow 노트는 GameMgr+0x30~+0x48을 읽는 명령이 NRO 전체에 없음을 확인했다 [판독]. **결론은 flow 판독을 따른다**: 결과 위치 모델은 로드만 하고 쓰지 않는다. 승자는 떨어지지 않은 그 자리에서 yaw 0(+Z, 카메라 쪽)을 보고 승리 동작을 한다. 위치표는 데이터 참고로만 남긴다.
- 보상(코인 등) 계산은 NRO 안에 없다. 순위는 `EntryPlayerRank(id, rank, 1)` 또는 `SetPlayerRank(rank[4], 1)`로 main에 넘긴다.

### 6.4 Player::Update `@0x7100006cb0` [판독]

```
Player::Update():
  ActorPlayer::Update()
  if !e69 && GameWork::IsPlayerCom(id): pad.overlay(+0x521)=1; e69=1
  if 공 핸들 유효 && SnowBall.state != 0:          // 던졌거나 부서짐
      공 핸들 비움; SetWalkSpeed(2.0); ResetRotParam(); SetAnimSpeed(0, 1.0); ResetRotParam()
  if e0D(넉백):
      SetGravity(e38 = -37)
      v = GetAddVector(); k = e34 * dt
      v = v - v*k   (4성분, fmul 뒤 fsub); SetAddVector(v)
  if 행동 != 0x18:
      p = GetPosition()
      if !((x²+z²)+(y²+w²) < 67.24 && y >= -0.5): e68 = 1; ActionEX8(true)
  if GetPosition().y <= e08(-33): 반사 뒤집기(표현 전용)
  if e0xD68:
      if IsPlayerCom(id) && !e68: PlayerCom::Update()          // 6.13
      t = pad.getTrig()
      if 행동 < 2 && (t & 0x400): ActionEX1(true)               // B
      if 행동 ∈ {0x12, 0x13} && e527 && (pad.getTrig() & 0x800): ActionEX4(true)   // A
```

입력 가능 구간: `SetEnable(b)`가 +0x527·+0xD68·`PlayerCom::Enable(b)`를 같이 바꾼다. 스틱 이동은 행동 함수 안에서 읽어 +0xD68과 무관하다. 사람 패드의 시작 전 차단은 main `PlayerCtrlStart/End`와 패드 표지 몫이라 [미확정]이다.

### 6.5 연타 `ActionEX1` `@0x7100007378` [판독+데이터+재구현 계산]

```
ActionEX1(enter=true):  SetActionID(0x11)==5 이면 SetControl(0); ResetAddVector();
                        MotionActorStack(sb_make00, 0, 자동); e0C=0; count=0; timer=0.5
ActionEX1(false):
  if e527 && (pad.getTrig() & 0x400): timer = 0.5; count += 1
  if count < 9:
      timer = timer - dt
      if timer > 0: return
      ActionIdle(true); return          // 실패
  CreateSnowBall(); ActionEX2(true)
```

- 입력 사이 허용 간격 = 29프레임. 30프레임 쉬면 실패하고 대기로 간다.
- 같은 프레임에 `Update`가 EX1에 들어가고 그 뒤 액터 갱신이 `EX1(false)`를 부르면, 진입시킨 첫 B가 한 번 더 세어진다(트리거는 그 프레임 내내 참). **9회/10회는 3.5의 순서에 달려 [미확정]**이다.

| 입력 간격(프레임) | 첫 입력도 셈: 공 생기는 프레임 | 안 셈 |
|---|---|---|
| 1 | 9 (B 9번) | 10 (B 10번) |
| 2 | 17 | 19 |
| 4 | 33 | 37 |
| 8 | 65 | 73 |
| 15 | 121 | 136 |
| 29 | 233 | 262 |
| 30 | 실패(30프레임째) | 실패(60프레임째) |

`Player::CreateSnowBall @0x71000074a0`: `SnowBallMgr::CreateSnowBall`(빈 칸) → Player+0xDE0 핸들 → `SnowBall::Create(creatorId=Player+0x48C, SnowHandPos, 플레이어 ComTransform, 플레이어 Entity)` → 플레이어 모델에 FX 트리거 `VO_HSMG402_CMP_SB`(`@0x710000784c`).

### 6.6 이동 [판독]

**스틱** (main `Actor::getMoveLever @0x71000f1868` → `ActorPad::getPadActorDeg`):

```
(x, y) = 오버레이면 (+0x88, +0x8C) 아니면 GetStickLeft(pad)
len = sqrt(y*y + x*x); if len < 0.1: 레버 없음
deg = atan2f(x, -y) * 360 / (2π) + base;  (-180, 180] 로 감기
base = Actor+0x240 (hsmg402 는 SetMainCamera 를 부르지 않음, 값 0 [추정])
```

스틱 위 = yaw 180° = −Z = 카메라에서 멀어지는 쪽이다. 스틱 크기는 데드존 판정에만 쓰인다.

**맨몸 걷기** (main `MoveGround @0x71000f3988`): 속도 **2.0 고정**, `add.xz = (sin deg, cos deg) × 2.0`, 목표 회전 = deg. 몸 회전은 `control()`의 `RotActorY`(360, 차 ≥ 85°면 1100, 단위·보간 세부 [미확정]).

**공 들고 걷기** (`ActionEX3 @0x7100007bf4`, `MoveGroundEX @0x71000081b4`):

```
lv = SnowBall.level
SetWalkSpeed(2.0 * WALK_FACTOR[lv]);  SetAnimSpeed(0, WALK_ANIM[lv] * 0.001)
if !checkLever(0x30): 공 있으면 현재 yaw 를 목표로 두고 ActionEX2(true), 없으면 ActionIdle(true); return
if 공 없음: SetWalkSpeed(2.0); ResetRotParam(); ActionWalk(true); return
if !e0C && lv > 2: 현재 프레임에서 sb_walk01 로 바꿈(블렌드 0.75); e0C = 1
MoveGroundEX(ws):
  if !getMoveLever(&deg): add.x = add.z = 0; setLeverRotateY(GetRotate().y)   // 라디안 그대로(원본 그대로)
  L = normalize((sin deg, 0, cos deg) * ws);  F = CalculateDirectionZ()
  a_deg = acosf(clamp(dot(L, F), -1, 1)) * 57.29578
  A = normalize(cross(F, L)), 0 이면 (0,1,0)
  R = CalculateDirectionX(); if A.y > 0: R = 0 - R
  b = acosf(clamp(dot(F, normalize(F + R*(ws*dt))), -1, 1)) * 57.29578     // 한 프레임 회전 상한
  t = min(a_deg, b); if A.y < 0: t = -t
  rot.y = (t + rot.y*57.29578) * 0.017453292; setRotate(rot)
  F2 = CalculateDirectionZ()                  // setRotate 반영 시점 [미확정]
  SetSpeedMoveGround(F2 * ws)                 // x, z 만: 늘 정면으로 전진(차처럼 조향)
```

| 공 레벨 | 속도 | 회전 상한(°/프레임) | 90° 도는 프레임 |
|---|---|---|---|
| 0~2 | 2.0 | 1.9092 | 48 |
| 3 | 1.8 | 1.7184 | 53 |
| 4 | 1.6 | 1.5275 | 59 |
| 5 | 1.4 | 1.3366 | 68 |
| 6 | 1.2 | 1.1459 | 79 |
| 7 | 1.0 | 0.9547 | 95 |

[재구현 계산]. 걷기 모션 속도 `표 × 0.001`(0.0005~0.0001)은 디스어셈블 값 그대로지만 단위가 [미확정]이다(값대로면 모션이 거의 멈춘다).

### 6.7 액터 적분 main `Actor::controlVec @0x71000e95e0` [판독]

```
if isGroundGeo() && add.y <= 0:  base = Actor+0x1F0; if !Actor+0x18C: add.y = dt * gravity   // 땅: 매 프레임 다시 놓음
else: base = Actor+0x200
      if !Actor+0x18C: add.y = add.y + dt*gravity          // 이 게임은 점프가 없어 이 줄
      if add.y < Actor+0x2D4: add.y = Actor+0x2D4         // 최대 낙하 속도(-49 [추정])
total = base + add (+ Actor+0x210, +0x494>0 일 때만)
pos = (total + Actor+0x220) * dt + tempPos  → setPosition
```

걷기와 넉백이 같은 add 벡터를 쓴다. 피격 행동은 이동 함수를 부르지 않아 섞이지 않는다. 지면 높이 맞추기·벽 밀기(`collisionGeo`/`collisionGroundGeo`)는 [미확정]이다.

### 6.8 피격·넉백 [판독+데이터]

`SnowBallHit @0x710000b278`(0xB000): `SetDamage(공 모델 위치, 레벨)` → 효과음 위치 = 플레이어 위치 + normalize(공 − 플레이어) × 캡슐 반지름 → `SeMgr::EntryPlayerVsSnowBall(플레이어, 공, power, 위치)`. `CollisionHit`(0x1B)는 이름 비교 결과를 버리고 아무것도 하지 않는다.

```
SetDamage(src, lv) @0x710000a1cc:
  if 행동 ∈ {0x16, 0x17}: return
  if !CharacterModel::IsEndBlink(): return                    // 깜빡이는 동안 무적
  p = GetPosition()
  d = normalize((src.x, 0, src.z, src.w) - (p.x, 0, p.z, p.w))   // 플레이어 → 공 (수평)
  A = normalize(cross(d, (0,1,0)))
  θ = e3C(68.5) * 0.017453292
  (sx,cx),(sy,cy),(sz,cz) = 벡터 sin/cos(A * θ)              // 6.14
  r = (cz*sy*sx - sz*cx, sz*sy*sx + cz*cx, cy*sx, 0)
  v = normalize(r) * DamageVecLen[lv];  SetAddVector(v)
  e0D = 1; e0E = 1; e34 = DamageVecRes[lv]; e3C = DamageVecDeg[lv]; e64 = DamageMoveAnimFrame[lv]; e10 = v
  ang = acosf(clamp(dot(d, CalculateDirectionZ()))) * 57.29578
  ang < 90 ? ActionEX6(true) : ActionEX7(true)                // 앞 피격 / 뒤 피격
PostPhysics @0x71000071dc:
  if e0D && !e0E && isGroundGeo() && 행동 ∈ {0x16,0x17} && GetSkelFrame(0) >= e64:
      e10 = e20 = 0; SetAddVector(0); e0D = 0
  e0E = 0                                                      // 맞은 프레임의 PostPhysics 는 건너뜀
```

- 공이 +X 쪽이면 r = (−sin θ, cos θ, 0): **공 반대쪽으로, 위로 68.5° 세운 방향**이다. 축 방향이 아니면 오일러 근사라 정확한 축 회전과 조금 다르다(원본 그대로 유지).
- 매 Update `v -= v·(0.42·dt)`, 중력 −37. 낙하(0x18)로 바뀌면 정지 조건이 맞지 않아 넉백이 끝까지 이어진다.
- 무적 `IsInvincible @0x710000b098` = 행동 ∈ {0x16, 0x17} 또는 `!IsEndBlink()`. 깜빡임 길이의 정확한 뜻은 [미확정].

| 공 레벨 | 넉백 초속(공 +X, 플레이어 원점) v.x / v.y |
|---|---|
| 0 | −6.5129 / 2.5655 |
| 3 | −12.6351 / 4.9771 |
| 7 | −21.4275 / 8.4405 |

(전체 8단계는 `analysis/hsmg402_player_calc.json` `knock_v0`.)

### 6.9 손에 든 공(state 0) [판독: 디스어셈블]

**SnowHandPos::UpdatePos @0x7100015124** (TickOrder 1, 메시지 0):

```
hand = CalculateDirectionZ(player) * 0.5 + player.translation     // fmul 후 fadd
pos_snowball 모델(SnowHandPos+0x20).SetPosition(hand)              // vt+0x240
GetPos() = pos_snowball 모델.GetPosition()                         // vt+0x250, 뼈를 읽지 않음
```

**SnowBall::UpdateHandTransform @0x71000110a4**:

```c
d(+0xD0) = player.ComTransform.CalculateDirectionZ();
hand = SnowHandPos.GetPos();
m = hand - ballHand(+0xC0);
if (|m| < FLT_EPSILON) { MOVE 이펙트·이동음 정지; goto groundCheck; }
// (시각) 굴림 회전: axis = normalize(cross(normalize(hand - (ball.x, r, ball.z)), -UnitY)), angle = acos(clamp(dot)) → Rotate
P = player.translation; P.y = 0;
if (|P - prevP(+0x70)| >= FLT_EPSILON) {           // 플레이어가 움직였을 때만 성장
  timer = timer - dt;                              // 레벨 검사보다 먼저(레벨 7 에서도 준다)
  if (level <= 6) {
    s = (SIZE_SCALE[level+1] - SIZE_SCALE[level]) * dt + scale.x;   // fsub → fmul → fadd
    SetScale(s,s,s) (공·break 둘 다);
    if (timer <= 0) {
      level++; SetScale(SIZE_SCALE[level]);
      충돌 컴포넌트 제거 후 구(반지름 1.1*SIZE_SCALE[level]) 다시 생성, 레이어 10;
      timer = 1.0;
      if (level == 7) PlayFx("SNOWBALL_MAX00");
    }
  }
}
prevP = P;
UpdatePosition(hand);
MOVE0{tier} 이펙트 갱신; UpdateMoveSe();
groundCheck:
c = model.GetPosition(); r = 1.1*scale.x;
if (!CastRay(c → c - UnitY*(r + 0.12), 필터 12)) {            // 발밑 지면 없음
  dir = normalize(m) 이 0 벡터면 SnowHandPos.GetVecZ() 아니면 normalize(m);
  d = dir * 1.1; 가속중 = 1; v = 0; MOVE 이펙트·이동음 정지;
  state = 1 (부속 0); 낙하플래그(+0x11C) = 1; PlayFallSe();
}
```

`UpdatePosition(hand) @0x7100010cdc`: `+0xC0 = hand; r = 1.1f*scale.x; p = hand + (dz.x, 0, dz.z, dz.w)*r; p.y = r;` → 두 모델 `SetPosition(p)`. 공은 **손 앞 r 거리, 중심 높이 r**(지면 y=0 가정)이다.

- **조정(공 위치):** assets 노트는 `pos_snowball` 뼈 `attach00` = (0, 1.1, 1.1)을 손 위치로 [추정]했다. 이 문서 작성 중 확인한 결과, `SnowHandPos::Create @0x7100014d58`이 `hsmg402_pos_snowball.fmdb`를 싣지만 `UpdatePos`는 그 모델의 **루트 위치**를 `플레이어 + 앞×0.5`로 놓기만 하고, `GetPos`도 루트 위치(vt+0x250)를 돌려준다. NRO 전체에서 `GetBone*` 호출은 `GameMgr::EntryPlayer`의 `cha_pos0%d` 하나뿐이다 [판독]. 그래서 **attach00 오프셋은 로직에 쓰이지 않는다.** 공 중심은 `플레이어 + 앞×(0.5 + r)`, 높이 r이다. 레벨 7(r=1.1)에서 앞 1.6·위 1.1이고, attach00(앞 1.1·위 1.1)과는 다르다.
- **조정(반지름):** flow의 충돌 반지름 `1.1 × scale`과 assets의 모델 노드 스케일 1.1(메시 반지름 1.0 → 겉보기 1.1)은 일치한다. `SetScale(s)`가 모델에 곱해지므로 겉보기 반지름 = 충돌 반지름 = 1.1×s다 [판독+데이터].
- 성장 [재구현 계산]: 움직인 프레임 61개마다 레벨+1(타이머 1.0에서 dt를 60번 빼도 2.79e-7이 남아 61번째에 ≤ 0). 레벨 7까지 427프레임. 멈춰 있으면 성장도 타이머도 멈춘다.
- 손 공이 굴러 떨어지기 시작하는 경계는 공 크기와 무관하게 "공 중심 바로 아래 지면 y < −0.12"이고, 단면 표로 수평 ≈ 8.078이다 [산술].

### 6.10 던진 공·굴러가는 공(state 1) [판독]

`Shot(d, thrown) @0x71000129d0`: 가속중=1, +0xD0=d, v=0. thrown이면 "SNOWBALL_THROW0{tier}" 1회, +0x131=1. MOVE 이펙트·이동음 정지, state=1. 던짐은 `ActionEX4`에서 `sb_push00` 프레임 ≥ 4.0일 때 `Shot(CalculateDirectionZ(), true)`.

```c
// UpdateShotTransform @0x7100011e2c (매 틱)
if (가속중) {
  v = v + d*dt;                                         // 성분별 fmul 후 fadd
  if ((v.x²+v.z²)+(v.y²+v.w²) >= 0.010000001f) {        // |v| >= 0.1
    가속중 = 0;
    d = normalize(d);                                   // frsqrte + frsqrts×2
    v = d * 0.1f;                                       // 이후 고정
  }
}
pos = model.GetPosition();
a = pos + v;
fy = fall.y + dt * (-0.98f);  fallNew = (fall.x, fy, fall.z, fall.w);
b = a + fallNew;  r = 1.1f*scale.x;
if (CastShape(구 r, 회전 없음, a → b, 필터 12)) {
  if (결과 플래그(+0x84) bit1|bit2) { /* pos' = a, fall 유지 */ }
  else {
    depth = | |hit.pos - b| - r |;  push = hit.normal * depth;
    pos' = b + push;  fallNew.y = fy + push.y;  fall = fallNew;
    if (!(|fall.y| > FLT_MIN && !NaN)) fall.y = 0;
    if (hit.normal.y < 0.98f) 낙하플래그 = 1;
  }
} else {                                                // 공중
  pos' = a + fall(이전 값);  fall = fallNew;  PlayFallSe(); 굴림음 정지; +0x131 = 0;
}
// (시각) 굴림 회전
SetPosition(pos') 두 모델; UpdateShotMoveSe();
if (model.y < -11.0f) { if (level==7) StopFx("SNOWBALL_MAX00"); state = -1; }
```

- 공은 PhysX 강체가 아니다. 위치는 코드가 적분하고, 엔진은 `CastShape`/`CastRay`(필터 12)와 트리거 충돌(레이어 10)만 준다. CastShape 결과 +0이 접촉점인지 충돌 순간 중심인지, 플래그 bit1/bit2의 뜻은 [미확정]이다.
- 단위: v는 프레임당 변위다. 단위 방향이면 가속은 프레임마다 +1/60 → 6번째 틱에 0.1 고정(초당 6, 플레이어 걷기의 3배). 낙하는 fall.y가 프레임마다 −0.98/60씩 → 초 단위로 환산하면 −58.8/s² [산술].
- 던진 직후 6틱 변위 합 0.35, 이후 틱당 0.1. 가장자리에서 굴러 떨어지는 공(d = 1.1×dir)도 6틱째 고정이다. 지면 없는 자유낙하로 삭제까지 레벨 0 38틱, 레벨 3·7 39틱 [재구현 계산]. 실제로는 원뿔 경사(법선 y 0.47)에 닿아 밀려 내려가므로 경로가 다르다(지면 Cast를 재현하지 않았다).
- 방향은 던진 순간 고정이고 감속이 없다. 경로를 휘게 하는 코드(유도·바람·경사 가속)는 없다. 경사에서는 CastShape 밀어내기만 작용한다.

### 6.11 충돌·부서짐 [판독]

`SnowBall::HitMessageTrig @0x7100013740`(0x1B) — **공의 state와 상관없이**(손에 든 공도) 처리한다:

| 상대 엔티티 | 처리 |
|---|---|
| 이름이 `"hsmg402_snowball.fmdb"`(다른 공) | 상대에게 0xB001 `HitSnowBallInfo{level, 위치}`. 자기는 그대로 |
| 던진이 자신(+0x80 핸들) | 무시 |
| 그 밖(레이어 11 = PlEvCol 등) | 0xB000 `HitSnowBallInfo{level, power, 엔티티 위치, 모델 위치, 핸들}` 전송 후 **자기 `Crash`** |

`SnowBall::HitMessage @0x7100013eb4`(0xB001 수신): `자기 level − 2 ≤ 상대 level`이면 자기 `Crash` + `SeMgr::EntrySnowBallVsSnowBall`. 트리거는 양쪽 공에 모두 오므로 레벨 차 3 이상이면 큰 공만 남고, 2 이하면 둘 다 부서진다.

- `Crash @0x71000130b8`: state=2(부속 0), 충돌 끔, MOVE/THROW 이펙트 정지, FALL 이펙트 플래그(+0x11F)가 켜져 있으면 `SNOWBALL_FALL00`으로 `PlayFxTrigger` 후 +0x11F=0(재생인지 정지 인자인지 [미확정]), 이동음 정지.
- `UpdateCrash @0x71000123dc`: 부속 0 → 공 숨김, MAX 이펙트 정지(레벨 7), `SNOWBALL_BREAK0{tier}`(break 모델), 소리 정지, break 모델 보이기 + `PlayAnim(0,0)`, 부속 1. 부속 1 → break 애니 끝나면 state=−1.
- `EventCrash @0x7100013308` = `Crash` + `Play3D("SQ_SE_HSMG402_YKD_HIT_YKD")` + L15. `ResHand @0x7100013414` = 이동 이펙트·소리 정지 후 state=−1.
- 던진이 무시는 그 공의 creator 1명만 해당한다. 남이 든 공(state 0)에 닿아도 양쪽 공이 0xB001을 주고받고, 플레이어에 닿으면 손 공이라도 부서진다.

### 6.12 소리 크기 변수 L15 [판독+재구현 계산]

```
x = 1.1*scale + (-0.44000003);  |x| < FLT_EPSILON 이면 0
q = x / 0.65999997;              같은 처리
T = (IsNearlyEqual(x, 1.1) || q > 1) ? 127 : (int)(q * 127)
```

레벨 0~7 → 0, 10, 21, 42, 63, 84, 105, 127. 손에 든 공은 레벨 사이에서 scale이 연속으로 커지므로 값도 연속으로 변한다.

**조정(L15에 쓰는 값):** assets 노트는 "무엇을 쓰는지 [미확정]"이었다. 이 문서 작성 중 `hsmg402_player_all.c`의 `WriteTrackLocalVariable(h, 0xf, …)` 호출 6곳을 확인했다 [판독]:

| 함수 | 라벨 | L15 값 |
|---|---|---|
| `SnowBall::UpdateMoveSe` | `SQ_SE_HSMG402_YKD_MOV`(손 공 굴림 루프, `Play3DHookPosition`) | 위 T(현재 scale) |
| `SnowBall::PlayFallSe` | `SQ_SE_HSMG402_YKD_FAL`(1회, +0x130) | T |
| `SnowBall::UpdateShotMoveSe` | `SQ_SE_HSMG402_YKD_FIR_MOV`(던진 공 굴림, `Play3DHookPosition`) | T |
| `SnowBall::EventCrash` | `SQ_SE_HSMG402_YKD_HIT_YKD` | T |
| `SeMgr::EntrySnowBallVsSnowBall @0x7100003548` | `SQ_SE_HSMG402_YKD_HIT_YKD` | 인자(공끼리 충돌 정보 [추정: power = T]) |
| `SeMgr::EntryPlayerVsSnowBall @0x71000039f8` | `SQ_SE_HSMG402_YKD_HIT_PC` | 인자 power(HitSnowBallInfo+4 = T) |

시퀀스 쪽 식은 assets 노트 10.1: T = clamp(L15, 0, 127), vol = base + T·m/127(MOV 72+55, FIR_MOV·FAL 96+31, HIT 112+15), pitch_bend = 127 − T(T가 클수록 크고 낮은 소리). `SeMgr`는 `CheckToEntry*`로 같은 충돌의 중복 등록을 거르는 것으로 보이고(함수 이름), 매 프레임 PostPhysics 메시지에서 `Reset`한다. 거르는 규칙은 [미확정]이다.

### 6.13 CPU `hsmg402::PlayerCom` [판독]

#### 6.13.1 매 프레임 `PlayerCom::Update @0x710000c0c0`

```
if !enabled: return
UpdateInit()                         // 상대·위협 공 기록 지움
dist = |pos.xz|; +0x70 = dist; +0x74 = (dist >= 8.0)
ThinkOtherPlayerState(); ThinkSnowBall()
done = [ThinkActionWait, ThinkWalk, ThinkActionCreateSnowBalll, ThinkActionShot][+0x5A0]()
if done: +0x5A0 = 0 (+0x5A4 = 0)
+0x60 = pos
```

#### 6.13.2 위협 공 `ThinkSnowBall @0x710000c898`

```
for i in 공 슬롯:
  if !IdxValid(i) || GetCreaterId(i) == 내 ID: continue
  if !IsDeleteWait(i): continue              // tbz w0 → 건너뜀 (@0x710000c9f4)
  if !IsGrowth(i) && acos(dot(나→공, 공 이동 벡터)) < π/2: continue
  기록(위치·방향·이동 벡터·레벨·거리·반지름)
```

- **조정:** player 노트는 "IsDeleteWait가 참인 공만 본다는 조건이 이름과 반대로 보인다"를 [미확정]으로 두었다. 이 문서 작성 중 `IsDeleteWait @0x7100014664` = `state == −1`, `IsGrowth @0x7100014688` = `state == 0`(디컴파일), 호출 PLT 슬롯 이름(0x7100017f70 → IsDeleteWait, 0x7100017fb0 → IsGrowth, 이웃 슬롯도 이름 일관)을 확인했다 [판독]. 원본 코드 그대로면 **위협 목록에는 삭제 대기 공만 들어가고 IsGrowth 분기는 늘 거짓**이다. 삭제 대기 공은 다음 단계 9 `SnowBallMgr::Update`에서 지워지므로 길어야 한 프레임 남는다. 결과적으로 레벨 2·3 CPU의 "날아오는 공 피하기"(SearchSafeArea)는 거의 일어나지 않는다고 본다 [추정: 효과]. 의도와 다를 수 있지만 **웹은 원본 조건을 그대로 둔다**. 실제로 잡히는지는 3.5 순서에 달려 [미확정]이다.

#### 6.13.3 생각 `ThinkActionWait @0x710000cdb0` + `ThinkWait @0x710000d47c`

```
ThinkActionWait:  부속 0: pad.ResetOverlay(); 부속=1
                  부속 1: t = ThinkWait(); if t > 0: timer = t; 부속 = 2
                  부속 2: timer -= dt; if timer <= 0: 부속 = 1
ThinkWait():
  goal = 바깥(+0x74) ? 2 * normalize(0 - pos) : SearchRandMovePosition()     // 난수 2회(안쪽일 때)
  if 공을 들었음:
      r = SyncRandMod(100)
      if r <= SHOT_PROBABILITY[comLv][공레벨]: 행동=3; return 0
      lv 2·3: 위협 공 중 |나−공|·sin(acos(dot(norm(나−공), 이동))) <= 반지름 인 것 → 1개 이상이면 goal = SearchSafeAreaMovePosition(목록); 행동=1; return 0
      lv 1: r = SyncRandMod(100); r <= 59 → 행동=1, return 0;  아니면 return 0.3
      lv 0: r = SyncRandMod(100); r <= 39 → 행동=1, return 0;  아니면 return 0.4
  else:
      lv 2·3: 위협 공 검사 → 있으면 안전 지점·행동=1
              없으면 SearchFrontPlayer(30°, 4.0) 찾으면 행동=1, 못 찾으면 행동=2
      lv 1: r = SyncRandMod(100); r < 40 → 2, r < 90 → 1, 아니면 return 0.3
      lv 0: r = SyncRandMod(100); r < 20 → 2, r < 60 → 1, 아니면 return 0.4
```

던질 확률은 `r <= p`라 실제 (p+1)%다.

#### 6.13.4 걷기 `ThinkWalk @0x710000f410`

```
to = goal - pos (y=0); if |to|² <= 0.0001: 끝
dir = normalize(to); prevDir = normalize(goal - prevPos) (y=0)
if acos(dot(dir, prevDir))*57.29578 >= 179: 끝                    // 지나침
if 공을 들었음: r = SyncRandRange(1, 101); if r <= 표[공레벨]{0,0,5,10,50,80,90,100}: 끝
if SearchFrontPlayer(2°, 2.0) != -1: 끝
pad.SetLStickNormalize(dir.x, -dir.z); return 계속
끝: 행동=0; pad.ResetLStickData()
```

#### 6.13.5 무작위 목표 `SearchRandMovePosition @0x710000d874`

```
b = (다른 플레이어 쌍 중 acos(dot(-dir_i, dir_j)) 가 가장 큰 i 의) -dir_i; 쌍이 없으면 -dir_0
dist = SyncRandRangeF(1.0, 4.0);  ang = SyncRandRange(0, 30)        // [0, 29]
r = b 를 Y 축으로 ang 도 회전(쿼터니언 반각 (ang-360)/2, 부호 [미확정])
t = pos + r*dist
lim = comLv >= 2 ? 8.0 - 5.0*GetSnowBallSize() : 8.0
if |t| (3차원) >= lim: t = pos + (-r)*dist
```

#### 6.13.6 만들기 `ThinkActionCreateSnowBalll @0x710000ce74`, 던지기 `ThinkActionShot @0x710000d154`

```
만들기: 부속 0: timer=0; 부속=1
        부속 1: if comLv==1 && SyncRandMod(100) < 30: 부속=2           // 매 프레임 1회 소비
                표적 = comLv<3 ? 살아 있는 상대 중 가장 가까운 : 살아 있고 무적 아닌 상대 중 원점에서 가장 먼
                if !IsTargetDirection(0.2°): 스틱 = (방향.x, -방향.z); return 0
                스틱 0; 부속=2
        부속 2: if 공을 들었음: 행동=0
                timer -= dt; if timer <= 0: AddOverlayTrigger(0x400 B); timer = CREATE_BUTTON_TRIG_TIME[comLv]
                else: ResetOverlayTrigger()
                if 표적 탈락: return 1
던지기: 부속 0: 표적 = comLv<1 ? 가장 가까운 : comLv!=3 ? 원점에서 가장 먼 : 원점에서 가장 먼(무적 제외); 부속=1
        부속 1: 표적 없음: A; 행동=0.  표적 탈락: 부속=0
                if IsTargetDirection(0.2°): AddOverlayTrigger(0x800 A); 행동=0; 스틱 0; return 0
                스틱 = normalize(표적-나) (x, -z)                       // 공 든 채 돌기
        공이 없으면 스틱 0, return 1
IsTargetDirection(th) @0x710000f710: acos(dot(내 정면, 상대방향)) * 57.29578 <= th
SearchFrontPlayer(ang, len) @0x710000de80: 각 <= ang && 거리 <= len 인 첫 상대(탈락 검사 없음), 없으면 -1
```

B 간격 [재구현 계산]: 레벨 0·1 11프레임, 레벨 2 8프레임, 레벨 3 7프레임. 공이 생기기까지 레벨 0·1 89/100, 레벨 2 65/73, 레벨 3 57/64프레임(첫 입력 셈/안 셈).

`SearchSafeAreaMovePosition @0x710000e0b0`은 구조만 읽었다(난수 없음, ±45° 후보·`|p|² ≤ 64`·각도 정렬·30°/150°/44.5°/20° 문턱). 정확한 식은 [미확정]이다.

#### 6.13.7 난수 소비 순서 (sync 엔진만) [판독]

1. `ThinkWait`(생각 부속 1): 필드 안쪽이면 `SearchRandMovePosition`의 `SyncRandRangeF(1,4)` → `SyncRandRange(0,30)`이 먼저, 그다음 분기별 `SyncRandMod(100)` 1회(레벨 0·1의 공 든 경우 던지기 실패 시 1회 더). 레벨 2·3 맨손은 Mod를 쓰지 않는다.
2. `ThinkWalk`: 공을 들었으면 매 프레임 `SyncRandRange(1,101)` 1회.
3. `ThinkActionCreateSnowBalll`: 레벨 1만 부속 1에서 매 프레임 `SyncRandMod(100)` 1회.
4. 플레이어 순서는 Player 모델 엔티티 틱 순서다([미확정], 생성 순 [추정]).

분포 식은 01_core §8.2(libc++ `uniform_int` 기각 표본, RangeF는 곱·합 따로 반올림). 오프라인에서는 장면마다 다시 시드하지 않아 직전 장면까지 소비한 sync 상태가 이어진다. hsmg402는 리플레이(`sb::Replay`) 미니게임이 아니다.

### 6.14 sdk 벡터 sin/cos와 정규화 [판독+데이터]

`SetDamage @0x710000a358~0x710000a47c`: `n = trunc(a/(2π) ± 0.5)`, `x = a − n·2π`(융합), ±π/2 밖이면 `π−x`/`−π−x`로 접고 cos 부호를 뒤집는다. sin = x·(1 + x²·(−S4 + x²·(S3 + x²·(−S2 + x²·(S1 − x²·S0))))), cos = 1 + x²·(−C4 + x²·(C3 + x²·(−C2 + x²·(C1 − x²·C0)))). 계수는 sdk `nn::util::detail::SinCoefficients @0xab263c`·`CosCoefficients @0xab2650`이고 값은 `web/tools/analysis/hsmg402_player_calc.py`에 있다.

정규화 `frsqrte`(8비트 추정) + `frsqrts` 뉴턴 2회. frsqrte(1.0) = 0.998046875, frsqrte(0.25) = 1.99609375 [재구현 계산]. 구현은 `web/tools/analysis/hsmg402_calc.py`의 `neon_normalize`·`lane_sq`.

## 7. 애니메이션·이펙트·소리·카메라·에셋 연결

### 7.1 에셋 목록과 변환 [데이터+실행]

| 묶음 | 원본 | 변환 결과(`extracted/converted/hsmg402/`) |
|---|---|---|
| 모델 19 + dbg 1 | `model/*.fmdb`(+fskb 6, fmab 4, `_fxdb.nkn` 3), `env/*.fmdb` | `graphics/model/*.glb` 20, `graphics/tex/*.png` 53, `graphics/anim/*.json` 6, `graphics/meta/*.dump.json`. three GLTFLoader 로드 오류 0(`graphics/verify_three.json`) |
| 충돌 | `data/map/map.nbmap` → `5de38a06c3c8d0b3e232a12950a35473.apx`(PhysX 3.4 BVH33, 정점 337·삼각형 624) | `collision/hsmg402_col_apx.{obj,json}`. `hsmg402_col.fmdb`와 삼각형 624/624 일치 |
| 이펙트 | `effect/effect.xml`(VFXB v40), `ftrg/*.ftrg` 4, 공용 `hs_system/effect/effect.xml` | `effect/vfxb.json`(v40 배치, 이미터 수치 확정), `effect/tex/*.png` 8, `ftrg/*.txt`, 웹 `assets/hsmg402/effect/sets.json` |
| 소리 | `subarc_hsmg402.fsst`(SE 10), BGM bfstm, 환경음 `subarc_amb_blzard_1` | `sound/*.wav`, `sound/subarc_hsmg402.json` |
| UI | `hs_system/layout.lyt`(`sys_guide_02`, `sys_timer_00`), 메시지 | `ui/*.bflyt.json`, `ui/messages.json`, 썸네일 png |

코드가 직접 싣는 모델(NRO 문자열): `pos_snowball`, `pos_result_{1win,2win,3win,draw}`, `pos_op`, `snowball`, `snowball_break`, `sky`, `ice_mid`, `ice_far`, `ice_fix`, `ice_rev`, `aurora`, `bg`, `fld`, `fld_cliff`, `fld_mask`. `hsmg402_col.fmdb`(충돌은 apx로 실음)와 `dbg/height_clear.fmdb`는 코드에서 참조하지 않는다 [판독].

### 7.2 무대·충돌 형상 [데이터+실행]

중심 원점, Y축 대칭 48각(7.5° 간격, 0°에 정점) 회전체, 바닥 면 없음.

| 고리 | r | y | 면 법선 y |
|---|---|---|---|
| 중심 | 0 | 0 | 1.0(원판) |
| 1 | 7.4971 | 0 | 0.99 |
| 2 | 8.0388 | −0.0910 | 0.80 |
| 3 | 8.1986 | −0.2092 | 0.63 |
| 4 | 8.4291 | −0.4897 | 0.47 |
| 5 | 8.5264 | −0.9679 | 0.20 |
| 6 | 8.6121 | −2.5105 | 0.06(거의 수직 벽) |
| 7 | 13.5532 | −11.8051 | 0.47(넓은 원뿔) |

48각과 원의 차이는 최대 r·(1 − cos 3.75°) = 0.016이다. nbmap 충돌 속성 (0,6,3,0)의 뜻과 Cast 필터 12와의 관계는 [미확정]이다.

### 7.3 위치표 [데이터: fmdb 뼈, `web/tools/analysis/glb_nodes.py`]

| 모델 | 로직에서 쓰나 | 값 |
|---|---|---|
| `pos_op` cha_pos00~03 | **쓴다**(EntryPlayer, y는 1.0으로 덮음) | 3.3 표 |
| `pos_result_1win` | 안 쓴다(6.3 조정) | 00 (0,0,2), 01 (−2.5,0,−2), 02 (0,0,−2), 03 (2.5,0,−2) |
| `pos_result_2win` | 안 쓴다 | 00 (−1.25,0,2), 01 (1.25,0,2), 02 (−1.25,0,−2), 03 (1.25,0,−2) |
| `pos_result_3win` | 안 쓴다 | 00 (−2.5,0,2), 01 (0,0,2), 02 (2.5,0,2), 03 (0,0,−2) |
| `pos_result_draw` | 안 쓴다 | 00 (−3.75,0,−2), 01 (−1.25,0,−2), 02 (1.25,0,−2), 03 (3.75,0,−2) |
| `pos_snowball` attach00 | 모델 루트만 손 위치 운반에 쓰고 **뼈는 안 쓴다**(6.9 조정) | (0, 1.1, 1.1) |

### 7.4 카메라 [데이터+판독]

| 파일 | 내용 |
|---|---|
| `hsmg402_cam.fsnb`(게임, 애니 표 [1]) | Aim, pos (0, 12.5, 27.17857), aim (0,0,0), fovy 0.39479113 rad = **22.62°(전체 세로각)**, near 0.1 / far 10000. 거리 29.915, 내려다보는 각 24.70° |
| `hsmg402_cam_op.fsnb`(오프닝, [0]) | 120f. 0~60f pos (0, 24.626633, 47.26102)·aim (0, 1.499958, 1.1056058) 정지 → 120f 게임 카메라 값(오차 1e-4). 에르밋 곡선, 굽힌 배열 `graphics/anim/hsmg402_cam_op.fsnb.json` |

- fovy 규약: main `nn::bezel::Camera::SetProjectionPerspectiveFovy @0x7100596aa0`가 fovy×0.5로 계산 [판독]. three.js `fov = 22.62`.
- 재생 시점은 3.4: 단계 0(착지 후 cam_op `PlayAnim(0,1.0)` → 다음 프레임 `StopAnim`), 단계 5(cam_op 다시 재생 → 끝나면 cam `PlayAnim(1, 0.0)`), 단계 6(오프닝 스킵이면 cam으로).
- 결과(승자 1명): `MiniGameFinishPlayerUpCamera` 각 24.7°, 0.8초, 거리 12.8, 주시 높이 1.5(main 클래스, 보간 식 [미확정]).
- aspect: 카메라 애니 적용기(main `@0x71006522ec`)는 애니 user data `bezel_apply_aspect` = 1 일 때만 파일 aspect 를 쓰고 아니면 `Camera::GetAspectRatio`(화면 비)를 쓴다 [판독]. hsmg402 fsnb 두 개에 그 키가 없다 [데이터] → **화면 16:9**(1.78 은 적용되지 않음). 근거 [../engine/07_camera_lighting.md](../engine/07_camera_lighting.md) 6.6.

### 7.5 조명·환경·유체 [데이터 + 판독]

식·주소·검산은 [../engine/07_camera_lighting.md](../engine/07_camera_lighting.md)(mps 판)에 있다. 여기에는 hsmg402 값으로 정리한다.

- 평행광 `dir_light00`: color (0.570, 1.220, 1.5)(세기 곱 없이 그대로 Env UBO +0x10, 셰이더 확산에 1/π 없음 [판독]), 위치 (4.1, 5, −11.5). **`lightRotation` (30, −25) = (x°, y°) → L(면→광원) = (−cos x·sin y, sin x, −cos x·cos y) = (0.366, 0.5, −0.785)**, 빛은 무대 뒤(−Z)·위·오른쪽에서 카메라 쪽으로 온다 [판독]. lightPosition 방향과 9.1°, IBL rad 큐브의 해와 7.9° [재구현 계산].
- 그림자: 고정 정사영 l −17 r 15 t 12 b −8 n 1 f 30, 빛 행렬 기준(Z = L, X ≈ 세계 X(0.931, −0.197, 0.309), Y = (0, −0.843, −0.537)) [판독]. bias 0.5·normalBias 1 의 단위 [미확정].
- `env_mt`: IBL rad/irr/chara_rad/chara_irr(배율 1, 회전 0), 큐브 조회 방향 (x, y, −z) [판독]. **안개 `fog_param` = (시작 60, 끝 1000, 배율 0.95)**: 안개 양 = 1 − sat(0.95·(1000 − d)/940), d = 카메라 거리, 색 = irr 큐브(fog_cubemap 1) → 무대(d≈30) 2%, d 200 에서 19% [판독 + 재구현 계산]. fog_color 는 모드 1 에서만 쓰인다.
- `post_mt`(filter_order 1): 블룸 v4(문턱 0.7·세기 1, 휘도 문턱) → 합성 패스(노출 x = c·1 + 0 → **톤맵 타입 5 = 유리식 곡선** → **LUT: g = t^(1/2.2) 로 hsmg402_lut 100% (`lut_blend` 0 = 둘째 LUT 섞는 비율 0)** → **비네트 ×(1 − 0.2·|ndc|)**) → FXAA(상대 0.125·0.7152, 절대 0.0833) [판독].
- **화면 색** [재구현 계산 + 참고 이미지]: 원본 무대 눈은 수치로도 하늘색이다. 무대 한 점을 원본 식으로 계산하면 sRGB 양지 (144, 219, 242)·그늘 (115, 170, 218), 공식 스크린샷 무대 중앙 (144, 220, 242)·중앙값 (138, 211, 234). 고치기 전 웹 (130, 205, 231)/(66, 120, 165) 이 어두웠던 원인은 눈 그래프의 그늘 램프(0,0) 몫과 확산 IBL 둘째 항 램프(0.6)·irr(카메라 시선) 누락(7.11) — 단계표는 [../engine/07_camera_lighting.md](../engine/07_camera_lighting.md) 12절, 도구 `web/tools/analysis/hsmg402_color_calc.py`.
- 오로라 위쪽의 딱딱한 청록 띠는 `sky_grad_mt`(더하기)였다: 원본 샘플러 wrapV = Clamp 인데 웹이 Repeat 로 덮어써 윗변 v = −0.206 이 0.794 로 감겨 알파 0.84 가 됐다(Clamp 면 0.004) [데이터 + 재구현 계산] → glb 샘플러 그대로 쓰게 고침.
- 광원: 해·달 메시는 없고 평행광 방향(고도 30°)은 화면 밖이다. 반짝이는 것은 이펙트 `map_snow00` glare·`map_star00/01` [데이터].
- **눈 자국(유체 높이장)** — 엔진 식·주소·검증은 [../engine/03_graphics.md](../engine/03_graphics.md) 7.6. hsmg402 값으로 정리:
  - 자료 `hsmg402_fluid.fmdb` 재질 `fld_fluid`: 512², 월드 19×19, 중심 (0,0,0), 깊이 0.3, 시뮬레이션 0, clear_enable 0, texture_clear 1(`fld_clear`, BC1_SRGB → 선형 0~0.863, 원판 r ≈ 8.5 안에 눈, 가장자리 쪽 흰 둔덕), add 0.00015 [데이터].
  - 좌표: **u = (x + 9.5)/19, v = (z + 9.5)/19**, 텍셀 = 19/512 = 0.0371 m [판독: main 0x7100421374].
  - 매 프레임(일시정지 제외): ① 붓들을 더하기(ONE·ONE)로 → ② h += 0.00015 → ③ h = min(h, fld_clear) → ④ 노멀(3×3 Sobel). 첫 프레임만 h = fld_clear [판독: FUN_71003ee4d0·FUN_71003ee0a0, 블렌드 표 0xd Min·0xf Add]. 즉 **파인 홈은 프레임당 0.00015(초당 0.009)씩만 메워지고 처음 눈 높이(fld_clear) 위로는 안 올라간다** — 홈 −1 → 0.2 복원 ≈ 133 초 > 한 판 60 초 [재구현 계산].
  - 눈덩이 붓(`snowball_fluid` 구, 반지름 1.12 × 0.6 × 공 배율): **h += −fluid0_hgt(x − 공x + 0.5, 0.5 − (z − 공z))·sat(10·프레임 이동 거리)·M160** [판독: 붓 FS p6]. 텍스처 범위가 공 중심 ±0.5 m 라 홈 폭은 공 배율 0.4~0.74 에서 메시 실루엣(0.27~0.5 m 반경), 그 위로는 텍스처 가장자리(≈ 0)까지 [판독 + 재구현 계산]. 멈춘 공은 쓰지 않는다(sat(10·0) = 0).
  - 캐릭터 붓(`L/R_footfluid_m` 발 판, `bodyfluid_m` 몸 원판): **h += hgt·w·(w ≥ 1.01 ? 1 : sat(10·이동 거리)·utilityParameter0.x)·utilityParameter1.x(0.5)·M160**, w = 뼈 `NDinput_0` 위치(몸 x, 왼발 y, 오른발 z — 모션 애니가 걷기에서 디딘 발만 1), hgt = BC4_SNORM(발 중심 −0.79, 몸 중심 −0.32·가장자리 +0.28) → 걸으면 발자국 길, 피격·승리(w 3)는 멈춰도 몸 자국 [판독 + 데이터].
  - **`FluidMaterialParamChange(v)` = `SetMaterialUtilityScaleFoot(v)` = 발 붓 재질 utilityParameter0 = v** [판독: main 0x71000ea3c0]. 시작 (0,1,1,1) → 떨어지는 동안 발 자국 없음, 단계 0 에서 착지(y ≤ 0)한 플레이어부터 (1,1,1,1). 몸 붓(Body)은 바꾸지 않는다.
  - **`SetSystemScaleVec(v)`** = Actor+0x330(y 는 +0x324 에도) — `damageActor`/`damageScale` 이 기본 배율(+0x310)에 곱해 모델 배율로 쓴다 [판독: main 0x71000e577c·0x71000e9adc]. 물리 판정에는 쓰지 않는다. 시작 (2,1,2)은 발 붓이 꺼진(utilityParameter0 0) 동안이라 눈 자국에 영향 없음 [판독 + 추정].
  - 지면 `fld_snow_fluid_mt` 윗면(y 0.196, 정점 간격 0.127 m): **정점 y += h·0.3**, N = normalize(N_면 + n_유체), 색 × fld_sg_alb(−h, 0). 아래 `fld_snow_mt` 면(y 0)이 h < −0.653 에서 홈 바닥이 된다 [판독 + 데이터]. 홈 벽의 청회색 그늘은 램프 확산(N·L)·IBL 이 노멀 변화로 만든다(색 곱 fld_sg_alb 는 거의 한 색).
  - [미확정] 높이 RT 형식(웹은 float + [−1,1]), M160 기본값(웹 1), fld_clear 행 방향(웹: png 위 = z −9.5).
  - [참고 이미지: 사용자 제공 원본 캡처] 공이 지나간 자리 = 공 지름 폭 깊은 홈(바닥·벽 청회색, 양 가장자리 밝음), 걸은 자리 = 좁은 홈, 한 판 내내 남음, 직선 경로·끝은 둥글게. 위 판독(붓 형태·Min 복원·133 초)과 맞는다.

### 7.6 이펙트 트리거 ↔ 코드 [데이터+판독]

형식·런타임·이미터 수치 전체는 [engine/08_effects.md](../engine/08_effects.md)(VFXB v40 필드 표 4.3, 방출·입자 식 6, hsmg402 이미터셋 표 7). 여기는 코드 연결만.

| 트리거(대상 노드) | 코드 호출 | 이미터셋 → 이미터(텍스처) · 성격 |
|---|---|---|
| `INITIALIZE` ×4(`field`) | 문자열 [판독], 무대 상시 | map_snow00(눈보라 13: BoxFill 층 + glare, FRND·FSPN 필드), map_field00(얼음판 반짝임), map_star00(무한 수명 별 70, 4색 무작위), map_star01(300f 마다 유성 + 자식 꼬리) |
| `SNOWBALL_APPEAR00`(hsmg402_snowball) | `SnowBall::Update` +0x118 단계 1(생성 직후 1회) | ring00a(노란 고리, 1·5f 에 2개)·circle00a(빛). se ftrg로 `YKD_APP` |
| `SNOWBALL_MAX00`(〃) | UpdateHand 레벨 7 도달. 정지: UpdateShot(y < −11, 레벨 7)·UpdateCrash·Disable | ring00a·circle00a(1회) + twinkle00_start(20f)·twinkle00_Copy1(**연속**, 매 f 2개, 공 둘레 구). se `YKD_MAX`(1회) + `YKD_MAX_SHN`(루프, `_Stop`으로 정지) |
| `SNOWBALL_MOVE0{tier}`(〃) | 손 공이 움직이는 프레임 갱신, 멈추면 정지 | snow_solid00(snow01 4×2 무작위 칸 + fakevolume00·CSDP). **연속**, start 45f(00)·18f(01·02) 뒤부터 매 f 2개, 이미터 y −1(공 배율 → 지면). MOVE00만 트리거 +88~+90 = 10.0(뜻 [미확정]) |
| `SNOWBALL_THROW0{tier}`(〃) | `Shot(…, true)` 1회 재생 → 낙하·부서짐에서 정지 | snow_solid_leave00. **연속 방출 + followType 1**(월드에 남음) → 굴러가는 동안 꼬리, `_Stop`에서 페이드 30f. se `YKD_FIR` |
| `SNOWBALL_FALL00`(〃) | `SnowBall::Update`: 낙하 플래그(+0x11C)가 켜지고 +0x11F가 0이면 재생, +0x11F=1. `Crash`/`Disable`에서 +0x11F면 같은 이름 호출 후 0 | kotai(반구 50개, EAET 로 이미터 y −0.6→−0.8) |
| `SNOWBALL_BREAK0{tier}`(hsmg402_snowball_break) | `UpdateCrash` 부속 0 | snow_solid00(반구 3 / 35 / 75개, 공기 0.96) |
| `VO_HSMG402_CMP_SB`(플레이어) | `CreateSnowBall` | base에서 `SQ_VOI_DS_PC01_JUMP` |
| `VO_HSMG402_FALL`(플레이어) | `ActionEX8` 진입 | base에서 `SQ_VOI_DS_PC01_FALL` |
| `SNOW_FALL00`(플레이어, base ftrg 대상 `attach_body`) | `ActionEX8`, 수평 거리 ≤ 11.5 | `fx_pc_snow_fall00`(hs_system, kotai) |
| `SNOW_MAKE00`·`SNOW_BREATH00`(모션 이벤트, 대상 `NDcha_pos` = 발밑) | `sb_make00` 4f / `sb_idle00·01` 0·30·56f | `fx_pc_snow_make00`(양손 눈가루·물방울·연기 6) / `fx_pc_snow_breath00`(발밑 찬 김) |

- **조정(tier):** assets 노트는 `%d`(0~2)의 기준을 [추정: 크기]로 두었다. flow 판독으로 `tier = level < 3 ? 0 : level < 6 ? 1 : 2`로 닫혔다 [판독].
- 이미터 수치는 VFXB v40 배치 판독으로 **확정**됐다(08_effects.md 4.3, 전수 125 파일 오류 0) [판독+데이터]. 웹은 원본 수치로 돌린다(`view/vfx.ts` + `view/effects.ts`). GPU 이미터 운동식·빌보드 크기·색 합성 같은 셰이더 쪽은 [추정](08_effects.md 9.4).
- 공 이펙트는 공 모델(중심)에 붙고 **공 크기 배율을 받는다** [추정: 이동 꼬리 이미터 y −1.0 × 배율이 늘 지면 — 08_effects.md 6.5].

### 7.7 소리 [데이터+실행+판독]

| 라벨 | 1회/루프 | L15 | 코드 연결 |
|---|---|---|---|
| `SQ_SE_HSMG402_YKD_APP` | 1회 | — | ftrg `SNOWBALL_APPEAR00` |
| `SQ_SE_HSMG402_YKD_MOV` | 루프 | vol 72 + T·55/127, bend 127−T | `UpdateMoveSe`(손 공 굴림) |
| `SQ_SE_HSMG402_YKD_MAX` / `_MAX_SHN` | 1회 / 루프 | — | ftrg `SNOWBALL_MAX00` |
| `SQ_SE_HSMG402_YKD_FIR` | 1회 | — | ftrg `SNOWBALL_THROW0%d` |
| `SQ_SE_HSMG402_YKD_FIR_MOV` | 지속 | vol 96 + T·31/127 | `UpdateShotMoveSe`(던진 공 굴림) |
| `SQ_SE_HSMG402_YKD_HIT_YKD` | 1회 | vol 112 + T·15/127 | `EventCrash`, `SeMgr::EntrySnowBallVsSnowBall` |
| `SQ_SE_HSMG402_YKD_HIT_PC` | 1회 | vol 112 + T·15/127 | `SeMgr::EntryPlayerVsSnowBall` |
| `SQ_SE_HSMG402_YKD_FAL` | 1회 | vol 96 + T·31/127 | `PlayFallSe`(공 낙하, 1회 표지) |
| `SQ_SE_HSMG402_SB_MAKE00` | 1회 | — | 프리셋 치환 `SQ_SE_MFA_VOLUME0_SNOW_MAKE00` → 이것(se 트리거 위치 [미확정]) |

- SE는 모두 3D(flags 0x7, decayRatio 0.5, 로그 곡선). 시퀀스 산술은 정수(mulvar 뒤 divvar) [추정: 버림].
- BGM 리전: INTRO 4마디(각 0.889 s) → MAIN(반복). `intro_skip` = REG_SEQ_MAIN. 재생 위치 `scene_start`. 징글 치환 `SM_JIN_MG_WIN` → `_MP03`, LOSE·DRAW → `SM_JIN_MG_DRAW_MP03`. 환경음 `SQ_AMB_BLZARD_1`.
- 진동: `bv_vib_hsmg402_snowball_shot`(sb_push00 0f), `bv_vib_hsmg402_snowball_hit_dmg`(피격 모션).

### 7.8 캐릭터 모션 [데이터+판독]

| 상태 | 모션(접두 pcNN_) | 프레임 [데이터 추정] | 붙은 이벤트 |
|---|---|---|---|
| 대기 / 걷기 | `co_idle00` / `co_walk00` | 120 / 44 | |
| 만들기 0x11 | `sb_make00` | 24 | fx `SNOW_MAKE00` 4f, vo `VO_HSMG402_MAKE_SB` 3f |
| 공 들고 대기 0x12 | `sb_idle00`(레벨 ≤ 2) / `sb_idle01` | 56 | fx `SNOW_BREATH00` 0·30·56f |
| 공 들고 걷기 0x13 | `sb_walk00` / `sb_walk01` | 44 | se `SE_PC_WALK` 17·40f |
| 던지기 0x14 | `sb_push00` | 48 | **프레임 4.0에 Shot**, vo `VO_PC_ACTION` 0f, vb 0f, se 2·39f |
| 피격 0x16 / 0x17 | `co_damage02` / `co_damage03` | 74 / 74 | 프레임 20~22 넉백 정지, 20 깜빡임 |
| 낙하 0x18 | `co_wriggle00`(피격 중이 아니면) | — | 피격 중이면 16f부터 속도 0.3 |
| 승리 | `co_win01a` → `co_win01b` | 132 / 60 | |

프레임 수는 FSKA +0x40 u32로 읽었다(필드 정의 [추정]). 전이 블렌드는 공용 `chara_pc_anim_transit.mpat`.

### 7.9 UI [데이터+판독]

- 조작 가이드: `sys_guide_02.bflyt`, 메시지 `hsmg402_MGctrlGuide` "눈덩이 만들기(연타)". 처음 숨김, 경과 10초(601번째 틱) 이후 첫 Update에서 `Out`, `GameFinish`에서도 Out.
- 타이머: `hs::UITimer(0)` 60초(`sys_timer_00.bflyt` [추정]). 텔롭: `UIMGTelop` type 5(승자)·6(무승부) [추정].

### 7.10 논리 상태와 화면

| 변환 | 물리·판정에 영향 | 시각 전용 |
|---|---|---|
| 공 scale(SIZE_SCALE, 연속 성장) | 충돌 구 반지름(레벨업 때 다시 생성), 손 앞 거리·높이 r, 지면 Cast 반지름, 소리 T | 겉보기 크기 |
| 공 굴림 회전(`HsModel::Rotate`) | 없음 | 회전만 |
| 공 위치 y = r(손) | 지면 Cast 시작점 | |
| 플레이어 SystemScale (2,1,2)→(1,1,1) | 없음 [판독: damageActor·damageScale 의 모델 배율에만 곱함] | 모델 배율(웹 무시) |
| FluidMaterialParamChange (0,…)→(1,…) | 없음 | 발 붓 utilityParameter0(눈 자국 켬) [판독] |
| 반사 뒤집기(y ≤ −33) | 없음 | 물 반사 |
| 눈 자국 높이장 | 없음 | 지면 정점 변위·노멀·색(7.5), 웹 view/fluid.ts |

### 7.11 재질 [판독 + 추정]

식·근거·도구는 [../engine/03_graphics.md](../engine/03_graphics.md)(mps 재질 체계). 여기에는 hsmg402 재질만 정리한다.

- 실제로 그리는 셰이더는 공용 bfsha 가 아니라 **`hsmg402.nx.bea/_hsmg402.bnbshpk`(장면 셰이더 팩, FSHA 8개)** 와 캐릭터 팩 `_chara/pc/pcNN_*.bnbshpk` 안의 정적 변형이다. 재질 옵션으로 프로그램을 고르고 그 Maxwell 코드를 읽었다 [판독].
- hsmg402 재질에는 `basecolor_source0..3`·`material_layer_count`(bezel_pbr 전용 다층 재질)가 **없다**. 쓰는 옵션은 forward_plus 계열 `use_*`·`texture_srt_*`·`rim_lighting`·`directional_light_off`·`use_lightmap` 등 [데이터].

| 재질 | 판독한 식(요지) | 웹 |
|---|---|---|
| 하늘 `sky_mt`·`sky_grad_mt`(simple) | out = `_a0` × blendColor, 조명·안개 없음 [판독] | 같게 |
| 구름 `cloud_mt`(그래프 2978185753) | rgb = aurora_grad02(TEXCOORD_3·srt3)·emissionScale, a = cloud_alb(0·srt0).a·blendColor.a·cloud_mask(1·srt1).a·cloud_mask(2·srt2).a, 조명 없음 [판독 FS 전체] | 같게(state 2 알파 섞기 [추정]) |
| 배경·빙산 `bg_mt`·`tree_mt`·`ice_mt`(map) | 평행광 없음(`directional_light_off` 1). 확산 = alb·(1−metallic)·base_lmp(TEXCOORD_1).rgb·lightMapScale(1~1.5)·lightmap_color_scale(1) + IBL(확산 × irradianceColorScale = 0~0.25, 반사 × 1) + 빙산 `_e0`(=alb)·emissionScale(0.02~0.1) [판독] | lightMap(HDR)·평행광 끔·IBL 배율·emissive. 디테일 맵·lm.a 가림 생략 |
| 지면 `fld_snow(_fluid)_mt`(그래프 746197195) | 직접광 = mix(알베도·램프(0,0), 알베도·램프(N·L·0.5+0.5)·광색, 그림자), 확산 IBL = 알베도·(1−F)·(irr(N) + 램프(0.6)·irr(카메라 시선)), 림(rimLightColor × 광색 × (1−N·V)^rimPower × 배율), **출력 × fld_sg_alb(u, 0)** — u = 윗면(p384) −높이장, 가장자리(p768) 정점색 a. 텍스처가 거의 한 색이라 u 와 무관. 거칠기 = min(3면 투영 노이즈, roughness), 윗면(p384, 정점 그래프 2881520328)은 정점 y += h·0.3, N = normalize(N + n_유체)(7.5) [판독] | 직접광·그늘 램프·IBL 두 항(irr 큐브)·림·최종 곱, 윗면 높이장 변위·노멀·u = −h(MPS_FLUID). 노이즈 거칠기 생략 |
| 절벽 `fld_cliff_mt`(그래프 2263802738) | cliff_lmp·cliff_gi·cliff_ao(TEXCOORD_2) + 시차 보정 큐브 pal_rad + 평행광 [판독 일부] | cliff_lmp 를 라이트맵으로 [근사] |
| 오로라 `aurora*_mt`(그래프 474410661) | D = dodge(grad00, sat(alb·정점색·blendColor·utilityColor0)), rgb = D·(irr(N) + 광색·sat(N·L)) + overlay(D, grad01·utilityColor1), 알파 = alb.a·정점색.a·blendColor.a(애니)·mask.r·(1 + grad01.r). 정점 = 월드 + noise·utilityParameter0 [판독 FS 전체·VS] | 반사 항·정점 변위 뺌, 더하기(state 3 [추정]) |
| 눈덩이 `fld_snow_mt`(그래프 4268919678) | 지면과 같은 구조(그늘 램프·IBL 두 항·림·최종 × snowball_alb), 국소 IBL snowball_rad/irr·irradianceColorScale 2.5 [판독] | 확산은 snowball_irr 큐브 그대로, 반사만 장면 rad [근사] |
| 부서짐 `snowball_break`(같은 그래프) | state 2, blendColor.a 애니(30→50f 1→0) | 같게 |
| 유체 붓 `fld_snow_fluid_mt`(snowball), 캐릭터 `*fluid_m` | forward_plus_fluid — 높이장에 ONE·ONE 로 더하는 붓, 식 7.5 [판독] | 장면에서 숨기고 view/fluid.ts 붓 장면에서 원본 식으로 |
| 캐릭터 몸 | PBR + 곡률(cvt)·산란 LUT·3D 텍스처(피부·옷) [판독 일부] | 일반 PBR [근사] |
| 캐릭터 눈 | 눈 = mix(utilityColor0(흰자), mix(홍채₁(TEXCOORD_2·srt2), 홍채₂(TEXCOORD_1·srt1), 홍채₂.a), sat(a₁+a₂)), 결과 = mix(눈, 눈꺼풀(TEXCOORD_0·srt0), 눈꺼풀.a) [판독: pc01] | 흰자 = utilityColor0 로 고침, 나머지 character.ts 기존 |

- texsrt: 셰이더가 2×3 행렬로 곱한다 [판독]. 값 = nn::g3d Maya 식 [추정, u 쪽은 눈꺼풀 셀 이동으로 확인] → 재질 애니(aurora·sky texsrt0~3, 5760f)를 이 행렬로 건다.
- renderInfo `state_type` 1/2/3 = 컷아웃/알파/더하기, `face_cull_type` 0/1/2 = 뒷면/앞면/양면 [추정: 데이터 상관].

## 8. 다른 기능과의 상호작용

| 상대 | 내용 | 수준 |
|---|---|---|
| main 흐름 | 단계 7 카운트다운·타이머 시작, 단계 8 `PlayerCtrlStart`, 단계 9 끝 `PlayerCtrlEnd(1.0)`, 외부 판정 모드(JudgeType 1) | [판독] |
| GameMgr ↔ Player | +0xE4C·+0xE58 쓰기, `SetEnable`, `SetComLevel(3)`, 결과 `SetUpFinishEvent`·`ActionTurn`·`ActionWin` | [판독] |
| Player ↔ SnowBall | 만들기(`CreateSnowBall`), 손 공 갱신은 공이 플레이어 Transform·SnowHandPos를 읽음, A로 `Shot`, 피격 시 든 공 `Crash`. 공 state ≠ 0이면 다음 Update에서 핸들을 놓고 걷기 2.0 복구 | [판독] |
| SnowBall ↔ 플레이어 PlEvCol | 트리거 진입(0x1B) → 0xB000 → `SetDamage` + 소리. 공은 그 즉시 Crash | [판독] |
| 결과 중 피격 | `SetEnable(false)` 뒤에도 `SetDamage`는 막지 않는다(+0x527 검사 없음). 굴러가던 공에 맞으면 넉백된다. GameMgr::Update는 이미 끝나(+0x88 ≠ 0) 순위는 바뀌지 않는다. 승자가 맞으면 행동 ID ≠ 0이 되어 결과 단계 1이 피격 모션이 끝날 때까지 기다린다 [판독 합성]. 낙하까지 가면 IsFall이 되어 대기 대상에서 빠진다 [추정] | 판독+추정 |
| 플레이어끼리 | 기본 액터 충돌로 밀어냄(`collisionActorHorizontal` 등), 머리 위에 서기 꺼짐(`SetCollisionUpDownActorEnable(false)`). 판독하지 않음 | [미확정] |
| CPU 레벨 | 사람 전원 탈락 시 매 프레임 전원 3 | [판독] |
| 일시정지 | PauseLevel 규칙(01_core §10) | [미확정] |
| 네트워크 | 온라인일 때만 SyncBegin에서 sync 시드 공유. 입력 동기는 `SystemSyncInput` | [판독] / 세부 [미확정] |

## 9. 웹 포팅 구조와 구현 순서

이 절은 구현 명세다. mps 웹 코드는 아직 없다. 웹 권장 이름은 모두 **제안**이고, 원본 이름은 심볼·오프셋으로 따로 적었다.

### 9.1 참고 구조와 mps 엔진층 차이

참고 구조는 mpj 웹(`C:/dev/mpj/web/script/`, 읽기만)이다.
- 게임 계약 `game.ts`: `createLogic(setup)`은 DOM 없이 60Hz 고정 스텝으로 돌고 노드에서도 돈다. `createView(ctx, assets)`는 three.js·HUD·소리를 맡는다.
- 매 스텝: `logic.step(pads)` → `view.onStep(state, events)`(소리·이펙트·진동). rAF마다 `view.render(state)`.
- 오디오 시계로 스텝을 맞춘다(`main.ts`).
- `core/`: `fmath.ts`(f32), `rng.ts`(MT19937), `pad.ts`, `clock.ts`, `events.ts`, `sched.ts`. 게임은 `games/<id>/{index.ts, state.ts, logic/*, view/*}`.

mps에서 **그대로 쓰면 안 되는 것** [판독: 01_core, SHARED]:

| 항목 | mpj | mps(hsmg402) |
|---|---|---|
| 시간 | CoreSystem 타이밍 | `GetDeltaTime` = 고정 f32(1/60), 액터 `ActorUtil::getDeltaTime`도 상수. UITimer는 엔진 델타로 감산(TimeCounter) |
| 흐름 | 파이버 `Wait()`로 한 걸음 | **장면 Update에서 한 프레임 한 걸음**(단계 바뀌면 부속=0). hsmg402는 파이버를 쓰지 않는다 |
| Sleep | — | 파이버 Sleep은 상수 1/60 감산(hsmg402는 미사용) |
| 난수 분포 | sync `(u·n)>>32` | libc++ `uniform_int` 기각 표본, RangeF는 곱·합 따로 반올림. **mpj `BexRandModule` 재사용 금지** |
| 시드 | 장면마다 재시드 | 오프라인은 재시드 없음(이전 장면 상태가 이어짐). 웹은 골든용 시드 주입을 둔다 |
| 갱신 단위 | 파이버 우선순위 목록 | Bezel 엔티티 TickOrder(1·2) + 메시지(0 틱, 5 PostPhysics, 0x1B 트리거, 0xB000/0xB001 사용자) |
| f32 도우미 | `addScaledV3`는 `a + b·s`를 한 번만 자름(융합 흉내) | 이 게임은 `v + d·dt`가 **fmul 뒤 fadd**(두 번 반올림)인 곳이 많다. 연산마다 6절 표기대로 구분한다 |

### 9.2 모듈과 책임 (제안 경로 `web/script/games/hsmg402/`)

| 웹 파일(제안) | 원본 | 책임 |
|---|---|---|
| `index.ts` | — | GameDef(id `hsmg402`, players 4, CPU 레벨 0~3) |
| `state.ts` | — | 로직 → 화면 계약(9.3) |
| `logic/game.ts` | `SceneHsmg402` 훅 + main `MainLoop` 일부 | 단계 0·5·6·8·9·14(3.4), 프레임 순서(9.4) |
| `logic/gameMgr.ts` | `GameMgr` | 6.1 Update, 6.3 Result, 가이드 10초, 시작 배치(3.3) |
| `logic/resultRank.ts` | main `hs::mg::Util::ResultRank` | 6.2(다른 미니게임과 공용 후보) |
| `logic/timer.ts` | `hs::UITimer` + `bex::ut::TimeCounter` | 60초, `RemainSecond`, `IsEndTimer` |
| `logic/snowBallPool.ts` | `SnowBallMgr` | 32칸, 생성·삭제(삭제는 단계 9 GameMgr에서만), 조회 함수 |
| `logic/snowBall.ts` | `SnowBall` | state 0/1/2/−1(6.9~6.11), 이벤트(FX·SE 요청) |
| `logic/handAnchor.ts` | `SnowHandPos` | `hand = dirZ·0.5 + pos` |
| `logic/actor.ts` | main `hs::actor::Actor`·`ActorPad` | 행동 ID·부속·진입 표지, add 벡터, `controlVec`, 기본 대기/걷기, 몸 회전, 스틱 각 |
| `logic/player.ts` | `hsmg402::Player` | Update(6.4), EX1~4·6~8, MoveGroundEX, SetDamage, PostPhysics |
| `logic/cpu.ts` | `PlayerCom` | 6.13 전체 |
| `logic/ground.ts` | PhysX 지형 + Cast | 회전체 단면 해석식(9.7) |
| `logic/data.ts` | NRO 정적 상수·actorparam | 4.9 표(손으로 고치지 않음) |
| `core/fmath.ts`·`core/rng.ts`(mps판) | — | f32·NEON 정규화·sdk sin/cos, mps 분포 난수 |
| `view/*` | — | glb 무대·캐릭터, 카메라(cam_op 배열), 조명·안개·후처리(engine/07 판독식, lighting.ts·post.ts), 눈 자국, 파티클 근사, 소리(L15), UI |

### 9.3 상태 객체 (state.ts 초안)

```ts
interface Hsmg402State {
  frame: number;
  stage: number; sub: number;                      // 흐름 단계(MainLoop +0x2D8)·Scene+0x444
  timerRemain: number;                             // UITimer
  guideVisible: boolean;
  players: {
    id: number; isCom: boolean;
    pos: V3; yaw: number;                          // 라디안(원본 rot.y)
    action: number; phase: number; motion: string; motionFrame: number;
    addVel: V3; knockActive: boolean;
    isFall: boolean; fallTime: number; rank: number;
    heldBall: number;                              // 슬롯 번호 또는 -1
    mashCount: number; mashTimer: number;
    cpu?: { action: number; phase: number; level: number; goal: V3; timer: number; target: number };
  }[];
  balls: ({ slot: number; state: 0|1|2|-1; sub: number; level: number; scale: number;
            pos: V3; dir: V3; vel: V3; fall: V3; growTimer: number; accelerating: boolean;
            fallingOff: boolean; ownerId: number; spinAxis: V3; spinAngle: number } | null)[];   // 32칸
  result: { step: number; acc: number; winners: number[]; draw: boolean };
}
```

### 9.4 초기화와 업데이트 순서 (한 스텝)

초기화: `setup`(OnSetupGame 순서 3.2) → `syncSetup`(3.3: 플레이어 0..N−1 생성, cha_pos 배치 y=1.0, SetEnable(false), 서로 등록) → 다음 스텝부터 Update.

한 스텝(권장 기본값, 원본 엔티티 순서가 [미확정]이므로 **설정으로 바꿀 수 있게** 둔다):

```
0. dt = F(1/60)
1. 각 플레이어 Player.update()                     // 6.4: 공 상태 → 넉백 감쇠 → 낙하 판정 → CPU → B/A 입력
2. ActorManager: 각 액터 controlPre → control(행동 함수 1회 → controlVec) → 지면·벽·액터끼리 충돌 → controlPost → updateModel
3. TickOrder 1: 각 PlEvCol 위치 갱신(플레이어 따라감), 각 HandAnchor.updatePos()
4. TickOrder 2: 장면 Update(흐름 단계; 단계 9 면 GameMgr.update(): 공 삭제 → 가이드 → 시간 종료 → 탈락 → 순위)
5. TickOrder 2: 공 슬롯 순서대로 SnowBall.update()       // 6.9~6.11 상태기계, 출현·낙하 이펙트
6. 트리거 판정: 공 구(레이어 10) ↔ PlEvCol(11)·다른 공(10) 겹침 "진입" 1회 → 0x1B → HitMessageTrig → 0xB000/0xB001 처리
7. PostPhysics: SeMgr.reset(), 각 Player.postPhysics()
8. state·events 정리(소리·이펙트·진동 요청)
```

- 1·2 순서를 바꾸는 설정(`mashFirstPressCounted`)을 둔다. 기본은 1 → 2(첫 B 두 번 셈, 9회). 원본 영상으로 "1프레임 1회 연타 시 9회/10회"를 확인하면 고정한다.
- 3·4·5의 상대 순서와 6의 시점도 [미확정]이다. 4를 5보다 먼저 두는 근거는 "장면 엔티티가 공보다 먼저 생성됨"뿐이다 [추정].

### 9.5 의사코드 (스텝 골격)

```ts
step(pads: PadInput[]) {
  const dt = F(1 / 60);
  for (const p of this.players) p.update(pads[p.id], this);           // Player::Update
  this.actors.tick(dt, this.ground);                                   // ActorManager
  for (const p of this.players) p.handAnchor.updatePos(p);             // SnowHandPos (TickOrder 1)
  const done = this.flow.step(this);                                   // MainLoop 한 걸음(단계 9 에서 gameMgr.update)
  for (const b of this.pool.slots) if (b) b.update(dt, this);          // SnowBall::Update
  this.triggers.detect(this.pool, this.players).forEach(ev => this.dispatch(ev));   // 0x1B → 0xB000/0xB001
  this.se.reset(); for (const p of this.players) p.postPhysics(this.ground);         // 메시지 5
  this.frame++;
}
```

### 9.6 원본 이름 ↔ 웹 권장 이름

| 원본(기준 객체+오프셋·심볼) | 웹 권장 |
|---|---|
| Scene+0x444 | `flow.sub` |
| GameMgr+0x88 / +0x8C / +0x90 | `gameMgr.finishCount`(결과 중 `result.step`) / `result.acc` / `timerCheck` |
| GameMgr+0xA0 | `result.upCamera` |
| Player+0xE4C / +0xE58 / +0xE68 | `fallTime` / `rank` / `isFall` |
| Actor+0x17C / +0x184 / +0x180 | `action` / `phase` / `actionEntered` |
| Actor+0x1E0 / +0x280 / +0x2A4 | `addVel` / `walkSpeed` / `gravity` |
| Player+0xDE0 | `heldBall` |
| Player+0xE00 / +0xE04 | `mashCount` / `mashTimer` |
| Player+0xE0D / +0xE0E / +0xE10 | `knockActive` / `knockSkipFirst` / `knockV0` |
| Player+0xE34 / +0xE3C / +0xE64 | `knockDamp` / `knockDeg` / `knockStopFrame` |
| Player+0x527 / +0xD68 | `ctrlEnabled` / `updateEnabled` |
| SnowBall+0x10C / +0x110 / +0x114 | `level` / `state` / `sub` |
| SnowBall+0xD0 / +0xE0 / +0xF0 | `dir` / `vel` / `fall` |
| SnowBall+0x100 / +0x104 | `growTimer` / `accelerating` |
| SnowBall+0x70 / +0xC0 | `prevOwnerXZ` / `handPos` |
| SnowBall+0x80 / +0x108 | `ownerEntity` / `ownerId` |
| SnowBall+0x118 / +0x11C / +0x130 / +0x131 | `appearStep` / `fallingOff` / `fallSePlayed` / `thrown` |
| PlayerCom+0x5A0 / +0x5A4 / +0x5A8 | `cpu.action` / `cpu.phase` / `cpu.level` |
| PlayerCom+0x50 / +0x594 / +0x598 / +0x60 | `cpu.goal` / `cpu.timer` / `cpu.target` / `cpu.prevPos` |
| `SIZE_SCALE`·`DamageVecLen` 등 정적 상수 | 같은 이름(`data.ts`) |

### 9.7 웹 환경 때문에 바꿔야 하는 부분

| 원본 | 웹 | 동등성 유지 |
|---|---|---|
| PhysX 3.4 지형(apx 삼각 메시) + 액터 `collisionGroundGeo` | **회전체 단면 해석식** `h(r)`(7.2 표 구간 선형 보간)과 48각 판정. 또는 `hsmg402_col_apx.json` 삼각형에 직접 레이·구 스윕 | 원판 r ≤ 7.4971은 y=0 정확. 가장자리 경사 처리(미끄러짐)는 [미확정]이라 "지면 위 y = h(r), 법선 y < 문턱이면 지지 안 함" 같은 규칙을 넣지 말고 문서화된 가정으로 둔다. 48각 대신 원을 쓰면 오차 ≤ 0.016 |
| 손 공 `CastRay(c → c − (r+0.12), 필터 12)` | `h(|c.xz|) ≥ c.y − (r + 0.12)`이면 맞음. 손 공은 c.y = r라 결국 `h(|c.xz|) ≥ −0.12` | 경계 수평 ≈ 8.078(6.9). 48각 판정을 쓰면 원본과 같은 면을 본다 |
| 굴러가는 공 `CastShape(구 r, a → b)` | 구 스윕 vs 회전체. 원판 위는 해석적으로 "중심 y = r 유지", 가장자리·원뿔은 삼각형 스윕 | 반환 구조(+0 위치, 플래그 bit1/bit2)가 [미확정]이므로 1차 목표는 "지면 위 y = r 유지, 지면 없으면 이전 fall로 낙하, 법선 y < 0.98이면 낙하 플래그"까지 맞추는 것이다 |
| Bezel 트리거(0x1B TriggerEntered) | 구–캡슐·구–구 겹침을 프레임마다 검사해 **새로 겹친 쌍만** 이벤트 | PlEvCol = 캡슐 길이 0.9, 반지름 0.55, 오프셋 y = 0.5(축·길이 해석 [추정]). 공 구 반지름은 레벨업 때만 다시 만들어지므로 레벨 사이 연속 성장은 충돌에 반영되지 않는다(원본 그대로). 레이어 행렬 4.10 |
| 엔티티 TickOrder·메시지 | 9.4의 명시 순서 + 설정 | 미확정 지점마다 설정 키를 두고 문서에 기본값을 적는다 |
| NEON `frsqrte+frsqrts×2` | `web/tools/analysis/hsmg402_calc.py`의 `frsqrte`/`frsqrts` 구현을 TS로 옮김 | `1/Math.sqrt`는 마지막 비트가 다를 수 있다. 골든 비교가 필요하면 반드시 옮긴다 |
| sdk 벡터 sin/cos 다항식 | 6.14 다항식 그대로(계수는 `hsmg402_player_calc.py`) | `Math.sin`으로 바꾸지 않는다(넉백 초속 비트 차이) |
| `acosf`·`atan2f`(libm) | `Math.acos` 후 `F()` | 1 ulp 차이 가능(player calc와 같은 근사). 골든 필요 시 원본 libm 판독 필요 |
| 셰이더(custom/fluid/water/map) | `view/material.ts` 규칙(원본 셰이더 판독, engine/03_graphics.md·7.11). 물·유체·디테일·피부 산란 등은 근사 | 시각 전용 |
| 눈 자국 유체 | GPU 높이장(float 512² 두 장 번갈아) + 붓 RT(half, 더하기) + 노멀 RT, 지면 재질 MPS_FLUID(view/fluid.ts·material.ts) | 시각 전용. 렌더 1회에 로직 n 프레임 묶음, 높이 [−1,1] 자르기 [추정] |
| VFXB v40 파티클 | 원본 이미터 수치로 CPU 런타임(`view/vfx.ts`). GPU 셰이더 쪽(운동식·빌보드 크기·색 합성)만 근사 — engine/08_effects.md 9.4 | 시각 전용 |
| 시퀀스 SE(L15) | 렌더 wav + 볼륨 `base + trunc(T·m/127)`, 피치 bend `127−T`(범위 5~7반음) | 시퀀스 산술 정수 [추정] |
| BGM 리전 점프 | 렌더 wav 리전(INTRO 0~3.556 s, MAIN 3.556~36.067 s 반복) | |
| 사람 패드 | 키보드·Gamepad → ActorPad 비트(B 0x400, A 0x800), 스틱 데드존 0.1, 각 `atan2(x, −y)` | trig(누른 순간)만 쓴다. 키 자동 반복 무시 |

### 9.8 에셋 변환 경로

| 단계 | 명령 | 산출 |
|---|---|---|
| 아카이브 추출 | `web/tools/analysis/bea.py`(완료) | `extracted/bea/hsmg402.nx.bea/` 등 |
| 모델·애니·텍스처 | `.venv/Scripts/python web/tools/analysis/graphics_convert.py mps_hsmg402` | `extracted/converted/hsmg402/graphics/` |
| 로드 검사 | `WEB_MODULES=C:/dev/mpj/web/node_modules node web/tools/analysis/graphics_verify/run.mjs web/tools/analysis/graphics_verify/check.ts ../hsmg402/graphics` | `verify_three.json` |
| 위치표 | `web/tools/analysis/glb_nodes.py extracted/converted/hsmg402/graphics/model/hsmg402_pos_*.glb` | 7.3 |
| 충돌 | `web/tools/analysis/scene_apx34_mesh.py <apx> --obj … --json …` | `collision/hsmg402_col_apx.{obj,json}` |
| 이펙트 | `web/tools/analysis/effect_vfxb.py dump … --png`(hsmg402 + hs_system), `web/tools/analysis/ui_ftrg.py dump …`, `web/tools/analysis/hsmg402_web_assets.py --only-effects` | `effect/`, `effect/hs_system`, `ftrg/`, 웹 `assets/hsmg402/effect/` |
| 소리 | `web/tools/analysis/sound_fsar.py dump`, `sound_seq.py disasm/render`, `sound_bfstm.py decode`, `sound_preset.py show hsmg402` | `sound/` |
| 캐릭터 | `web/tools/analysis/graphics_convert.py mps_pc01` 등(캐릭터별) | `extracted/converted/graphics/mps_pcNN` |

전체 재현 명령은 [assets 노트 15절](../../../analysis/notes/hsmg402_assets.md)에 있다. 웹에서는 `assets/hsmg402/` 아래로 복사하고 manifest를 만드는 것을 권장한다(웹 구조가 생기면 정한다).

### 9.9 원본과 같게 유지할 순서·정밀도

- 모든 실수 f32(`Math.fround`). 저장할 때마다 자른다. 융합(fmla/fmls/fmadd)과 분리(fmul → fadd)를 6절 표기대로 구분한다.
- 길이²·내적은 `(x·x' + z·z') + (y·y' + w·w')` 순서. 정규화는 frsqrte+뉴턴 2회, 길이 0 → 0 벡터.
- 성장: `timer -= dt`를 레벨 검사보다 먼저. 스케일은 `(S[l+1] − S[l])·dt + scale`, 레벨업 프레임엔 표 값으로 덮는다. "움직였다" 판정은 `|P − prevP| ≥ FLT_EPSILON`(P.y = 0).
- 굴러감: `v += d·dt` 직후 가속 판정, 같은 틱 새 v로 이동. 공중 프레임은 **이전** fall로 이동하고 fall은 그 뒤 갱신.
- 탈락 시각 `60 − RemainSecond()`(f32). 같은 프레임 탈락자는 같은 시각 → 동순위. 4명 동시만 전원 최하위. 시간 종료 판정이 탈락 판정보다 먼저.
- 낙하 상태는 3차원 길이²와 `y < −0.5`를 함께, 탈락은 `y ≤ −1.0`만.
- 감쇠 `v − F(v·k)`(분리), 적분 `F(F(v·dt) + p)`.
- 넉백 방향은 오일러 근사 식 그대로(축 회전으로 "고치지" 않는다).
- CPU: 위협 공 조건(IsDeleteWait), 확률 `r <= p`, `SearchFrontPlayer`의 탈락 미검사, 레벨 1의 매 프레임 난수 소비를 그대로 둔다.
- 난수는 mps sync 엔진, 소비 순서는 6.13.7.

### 9.10 브라우저·서버 공유

로직(`logic/*`, `core/fmath`, `core/rng`)은 DOM 없이 노드에서도 돌게 한다. 온라인 대전을 한다면 원본처럼 sync 난수 시드를 장면 시작 때 맞추고 입력만 동기화하면 같은 결과가 나온다(결정적 로직). 화면·소리는 공유하지 않는다.

### 9.11 구현 순서 (권장)

1. `core/fmath`(f32, NEON 정규화, sdk sin/cos)와 mps `rng` → `analysis/core/rand_vectors.json`, `hsmg402_calc.json` `frsqrte_check`, `hsmg402_player_calc.json` `knock_v0` 비트와 대조.
2. `timer`·`resultRank`·`gameMgr.update` → `hsmg402_calc.json` `scenarios` 6개와 대조(합성 입력: 프레임별 y 주입).
3. 손 공(6.9) → `growth.level_ups` 61·…·427, `ball_pos_examples`.
4. 굴러가는 공(6.10, 지면 없음부터) → `shot_throw_*`, `edge_fall_dir_x1.1`, `free_fall_to_delete`.
5. 공끼리·플레이어 충돌(6.11) → `ball_vs_ball` 8×8.
6. 액터·플레이어(6.4~6.8) → `mash`, `walk_with_ball`, `knock_sim_*`, `fall_check`, `damage_side`.
7. CPU(6.13) → `com_think_wait_rng`, `com_rand_move`(회전 부호 미확정 주의).
8. 지면(9.7) → 가장자리 경계 6.9·5.4 수치 확인.
9. 화면: 상자 모형 → glb·카메라(7.4) → 조명·유체·파티클·소리·UI.
10. 헤드리스 확인은 마지막 1회.

## 10. 검증 코드·실행 결과·기대값

### 10.1 실행한 것

| 무엇 | 명령 | 종류 | 결과 |
|---|---|---|---|
| 흐름·눈덩이 계산 | `cd F:/dev/mps && PYTHONIOENCODING=utf-8 .venv/Scripts/python web/tools/analysis/hsmg402_calc.py` | 재구현 계산 | `analysis/hsmg402_calc.json`. 이 문서 작성 중 다시 돌려 기존 파일과 **바이트 동일** 확인 |
| 플레이어·CPU 계산 | `cd F:/dev/mps && PYTHONIOENCODING=utf-8 .venv/Scripts/python web/tools/analysis/hsmg402_player_calc.py` | 재구현 계산 | `analysis/hsmg402_player_calc.json`. 다시 돌려 **바이트 동일** 확인 |
| 에셋 변환·로드 | 9.8 명령 | 실행(도구) | glb 20 로드 오류 0, 텍스처 53 디코드 실패 0, apx↔col 624/624 |
| 판독 대조(이 문서) | decomp grep: TickOrder 대상, SnowHandPos 뼈 사용, IsDeleteWait 본문·PLT 이름, L15 호출 6곳, FX 문자열 위치 | 판독 | 3.5·6.9·6.12·6.13.2·7.6 조정 |
| 눈 자국 자료 | `cd F:/dev/mps && .venv/Scripts/python web/tools/analysis/hsmg402_fluid_assets.py` | 실행(도구) | `web/assets/hsmg402/fluid/`(fluid.json + 캐릭터 10명 붓 BC4_SNORM 직접 디코드 png 20) |
| 눈 자국 식 대조(7.5) | `cd F:/dev/mps/web && npx tsx tools/check_hsmg402_fluid.ts` | 원본 기계어 에뮬 vs 웹 식 | 눈덩이 붓·캐릭터 붓 3종·지면 VS·fluid_normal 최대 오차 ≤ 3.2e-7, 블렌드 Add/Min/Max·Env 칸·붓 부호 — 오류 0 (화면·원본 실행 대조 아님) |

**원본 게임 실행 대조는 없다.** 함수 단위 재구현 계산을 게임 전체 동작 검증으로 보지 않는다.

### 10.2 핵심 기대값 [재구현 계산]

| 항목 | 입력 | 기대값 | 출처(JSON 키) |
|---|---|---|---|
| dt | — | 0x3C888889 | `dt_bits` / `dt` |
| 60초 타이머 종료 | SetTimer(60), 매 틱 1/60 | 3601번째 틱 | `timer_60s_tick_true_at` |
| 가이드 Out | | 601번째 틱(경과 10.016514) | `guide_out` |
| 결과 3단계 대기 | acc += dt, > 2.0 | 121프레임(acc 2.0166655) | `result_state3_over_2s` |
| 레벨업 프레임 | 매 프레임 이동 | 61, 122, 183, 244, 305, 366, 427 | `growth.level_ups` |
| 성장 중간 | 1프레임 / 60프레임 | scale 0x3ecd3a07 / 0x3ee66665, timer 0.98333335 / 2.79e-7 | `growth.trace` |
| 공 위치 | 레벨 0, 원점, +Z | 손 (0,0,0.5), 공 (0, 0.44, 0.94) | `ball_pos_examples` |
| 공 위치 | 레벨 7, 플레이어 (1,0,2), +X | 손 (1.5,0,2), 공 (2.6, 1.1, 2.0) | 같음 |
| 던짐 | +Z 단위 | 틱 1~6 z = 0.0166667, 0.05, 0.1, 0.1666667, 0.25, 0.35, 이후 +0.1 | `shot_throw_unit_dirZ_+Z` |
| 가장자리 낙하 공 | d = 1.1·(+X) | 6틱째 0.375, 이후 +0.1 | `edge_fall_dir_x1.1` |
| 자유낙하 → 삭제 | fall 0에서 | 레벨 0 38틱, 레벨 3·7 39틱 | `free_fall_to_delete` |
| 공끼리 | A, B 레벨 | A 부서짐 ⇔ A − 2 ≤ B (예: 3v0 A 남음, 3v1 둘 다) | `ball_vs_ball` |
| 소리 T | 레벨 0~7 | 0, 10, 21, 42, 63, 84, 105, 127 | `size_sound_param` |
| frsqrte | 1.0 / 0.25 | 0.998046875 / 1.99609375 | `frsqrte_check` |
| 순위 | 하나씩 탈락(10·20·30초) | rank [0,3,2,1], 1800프레임 종료 | `scenarios.one_by_one` |
| 순위 | 4명 같은 프레임 | [3,3,3,3], 무승부 텔롭 | `scenarios.all_four_same_frame` |
| 순위 | 1명 먼저, 3명 동시 | [3,0,0,0], 승자 3명 | `scenarios.last_three_same_frame` |
| 순위 | 시간 종료 생존 2명 | [0,3,2,0], 3601프레임 | `scenarios.time_up_two_survivors` |
| 순위 | 사람 먼저 탈락 | CPU 레벨 3 전환, [3,2,1,0] | `scenarios.human_out_com_boost` |
| 시작 자세 | cha_pos00~03 | 3.3 표 | `start_pose` |
| 연타 | 매 프레임 B | 9프레임(첫 입력 셈) / 10프레임(안 셈) | `mash.human_first_press_*` |
| 연타 실패 | 간격 30 | 30 / 60프레임째 대기로 | 같음 |
| CPU 연타 | 레벨 0·1·2·3 | 간격 11·11·8·7, 공 생성 89/100·89/100·65/73·57/64 | `mash.com_*` |
| 공 들고 회전 | 레벨 0, 스틱 90° | 1.9092°/프레임, 48프레임 | `walk_with_ball` |
| 넉백 초속 | 레벨 3, 공 +X | (−12.6351, 4.9771, 0), 비트 0xc14a2940 / 0x409f444a | `knock_v0` |
| 넉백 거리 | 원점, 공 +Z | 레벨 0 20프레임 2.018 m 정지, 레벨 6 24프레임 7.263 m, 레벨 7 26프레임 낙하 | `knock_sim_from_center` |
| 넉백 낙하 | 시작 위치(−4.5,0,−4.5), 원점 쪽 공 | 레벨 0 19프레임 … 레벨 6·7 6프레임 낙하 | `knock_sim_from_start_pos` |
| 낙하 판정 | (8.19,0,0) / (8.2,0,0) / (5.8,0,5.8) / (0,−0.5,0) / (0,−0.51,0) / (7,−0.3,4) | 아님 / 낙하 / 낙하 / 아님 / 낙하 / 아님 | `fall_check` |
| 앞/뒤 피격 | 정면 +Z, 공 앞·89.9°·뒤 | EX6, EX6, EX7 | `damage_side` |
| CPU 생각 확률 | 레벨 0 맨손 | 만들기 20 / 걷기 40 / 대기 0.4초 40 | `com_think_wait` |
| CPU 난수 표본 | seed 0x1234, 레벨 0 맨손 | create, walk, walk, walk, walk, wait0.4, walk, walk(SearchRandMovePosition 소비 없이) | `com_think_wait_rng` |

### 10.3 스텁·가정으로 검증되지 않은 범위

| 스텁·가정 | 영향 |
|---|---|
| dt와 엔진 델타 = f32(1/60) | UITimer 감산 주체·시점([미확정])에 따라 종료 ±1프레임 |
| 지면: flow 계산은 "지면 없음"·XZ 이동만, player 계산은 r ≤ 7.4971 평면 원판(밖은 지면 없음) | 가장자리 경사·원뿔 위 공·플레이어 경로는 검증 밖 |
| CastShape/CastRay·트리거·엔티티 틱 순서 | 스텁도 없이 제외. 충돌 결과는 레벨 규칙 표만 검증 |
| 한 프레임 순서 Update → 액터 → PostPhysics | 연타는 두 경우를 모두 계산 |
| 피격 모션 프레임 = 맞은 뒤 프레임 수(속도 1.0) | 넉백 정지 프레임 |
| `CalculateDirectionZ` = (sin yaw, 0, cos yaw), `acosf` = f64 acos 반올림 | 1 ulp 차이 가능 |
| `SearchRandMovePosition` 회전 = 표준 Y 회전 | 회전 부호 [미확정] |
| 최대 낙하 속도 −49 | [추정] |
| 위 5.4·6.9의 반지름 경계 | [산술], 스크립트 밖 |

## 11. 미확정 사항과 추가 분석에 필요한 근거

### 11.1 남은 미확정 (세 노트 합침, 중복 제거)

| # | 항목 | 영향 | 필요한 근거 |
|---|---|---|---|
| 1 | 엔티티 틱 순서: Player 모델 vs ActorManager vs TickOrder 1(PlEvCol·SnowHandPos) vs TickOrder 2(장면·공), 같은 TickOrder 안 순서, 트리거 메시지(0x1B)·0xB000 도착 시점 | 연타 9/10회, 손 공 위치 1프레임 지연, CPU 위협 목록, 종료 프레임 ActionIdle | Bezel `Engine` 엔티티 틱 판독 또는 원본 실행(1프레임 1회 연타 영상) |
| 2 | `UITimer::Update`를 누가 언제 부르나 | 타이머 종료 ±1프레임 | main UI 관리자 판독 |
| 3 | CastShape 결과 구조(+0 위치 의미, +0x84 플래그 bit1/bit2), 필터 12의 정체, nbmap 속성 (0,6,3,0) | 굴러가는 공의 경사 처리 | Bezel PhysicsSystem·bex Map 판독 |
| 4 | 액터 지면·벽 충돌(`collisionGeo`/`collisionGroundGeo`), 플레이어끼리 밀기, 경사에서 미끄러짐 | 낙하 상태 플레이어가 y > −1에 멈출 수 있나(5.4), 넉백 정지 위치 | main 충돌 함수 판독 |
| 5 | `GetMGEntryPlayer` 값의 뜻(플레이어 → cha_pos 번호) | 시작 위치 배정 | main `@0x7100032ef4` 정독 |
| 6 | 사람 패드 차단(`PlayerCtrlStart/End`, ActorPad +0x14/+0x17) | 시작 전·종료 후 사람 입력 | main `SysMiniGameMgr::PlayerCtrlStart` 판독 |
| 7 | 스틱 기준각 Actor+0x240(0 추정), Actor+0x37A("정면으로 걷기") 기본값 | 스틱 방향 | Actor 생성자·`ActorPlayer::Initialize` |
| 8 | EX3 `SetAnimSpeed(0, 표×0.001)` 단위 | 공 들고 걷기 모션 속도(시각) | main `bex::Model::SetAnimSpeed` 정독 |
| 9 | 몸 회전 `RotActorY` 단위·보간, `MoveGroundEX`에서 setRotate 뒤 `CalculateDirectionZ`가 새 회전을 보나 | 회전·이동 방향 1프레임 | main `ActorUtil::InterpolateRot`, Bezel ComTransform 갱신 시점 |
| 10 | 최대 낙하 속도 Actor+0x2D4(−49 추정) | 공중 낙하 속도 | `ResetJumpParamEx` 호출 경로 |
| 11 | `IsEndBlink`/`SetEndBlink`/`SetBlinkTimer` 뜻(무적 길이) | 연속 피격 | main CharacterModel 깜빡임 판독 |
| 12 | `SearchSafeAreaMovePosition` 정확한 식, `SearchRandMovePosition` 회전 부호 | CPU 목표(레벨 2·3 회피는 6.13.2 때문에 드묾) | NEON 쿼터니언 부분 정독(`ghidra_work/hsmg402_player/safe.s`부터) |
| 13 | PlEvCol 캡슐의 축·길이 해석 | 피격 판정 범위 | `Engine::CreateCapsuleCollision` 판독 |
| 14 | 모션 프레임 수(FSKA +0x40 필드 정의) | 피격 정지·던지기 시점 | BfresLibrary FrameCount 확인 |
| 15 | UIMGTelop type 0/2/5/6 표시, UITimer TYPE → 레이아웃 | 결과 텔롭 | main `UIMGTelop::Create`·`hs::UITimer` 생성자 |
| 16 | `MiniGameFinishPlayerUpCamera` 보간 식 | 결과 카메라 | main 클래스 판독 |
| 17 | `SNOWBALL_FALL00`을 Crash/Disable에서 부를 때 재생인지 정지인지 | 이펙트 | `PlayFxTrigger` 인자 판독 |
| 18 | SeMgr `CheckToEntry*` 중복 제거 규칙, 공끼리 HIT 소리의 L15 인자 | 소리 중복·크기 | SeMgr 디스어셈블 정독 |
| 19 | ~~`SetSystemScaleVec`·`FluidMaterialParamChange`의 뜻~~ **닫힘(7.5)**: 앞은 damageActor 모델 배율, 뒤는 발 유체 붓 utilityParameter0. 남은 것: 유체 높이 RT 형식·M160 기본값·fld_clear 행 방향 | 눈 자국 깊이·방향 | NdRender RT 설정표(인덱스 0x15)·모델 렌더 자료 생성자 판독 또는 원본 실행 화면 |
| 20 | 기반 흐름(main) 쪽 난수 소비, 단계 10~17 세부 분기, `ActorManager+0x90` 하위 4비트, 레이어 6·9 | 난수 상태 이어짐, 재도전 | main 흐름 처리기·ActorManager 판독 |
| 21 | 재질: state_type·face_cull_type 뜻, texsrt 행렬 식(v 부호·회전), 정점색 미바인드 값(눈 최종 곱에는 영향 없음), 절벽·캐릭터 몸 그래프 나머지 식(옵션 체계·UV·기본색·라이트맵·램프·림·눈 그늘/IBL·오로라 FS 는 engine/03 으로 닫힘), 오로라 정점 변위(noise_alb 미수록)·반사 항, VFXB v40 GPU 셰이더 식(이미터 수치는 확정, engine/08_effects.md 11), ftrg 0x9101 필드·`YKD_VOL` 곡선, 조명 쪽 남은 것(그림자 bias 단위, 블룸 해상도·간격, 출력 sRGB 여부 판독 — 참고 이미지와는 sRGB 가정이 맞음. lightRotation 축·톤맵 5·`lut_blend`·fog 3값·aspect·확산 1/π 없음은 engine/07 로 닫힘), 절벽·바다 밝기 차(웹이 참고 이미지보다 어둡다: 절벽 (26,53,79) vs (42,72,104), 바다 (27,64,116) vs (36,91,128) — 절벽 gi·ao 섞기·물 셰이더 미판독), 사운드 프리셋 `]` 레코드·`snsp`·BGM 점프 Prm1 `1`, `SNOW_MAKE00` fx/se 동시 발동·`PC01` 라벨 치환 | 화면·소리 근사(로직 무관) | assets 노트 16절의 각 근거(셰이더·bex gfx·sound·ComFxTrigger 판독) |
| 22 | 나머지 apx 121개(휴리스틱 실패) | 다른 미니게임 충돌(이 게임은 해석 완료) | PhysX 3.4 직렬화 소스 |

### 11.2 이번 통합의 조정·정정 모음

| 항목 | 노트 내용 | 결론 | 근거 |
|---|---|---|---|
| TickOrder 1 대상 | flow 3.6: "Player TickOrder 1" | **정정:** PlEvCol 엔티티(Player+0xD98). Player 모델 TickOrder는 이 NRO에서 안 바꿈 | player 노트 SHARED 90행 + 이 문서에서 `Player::Init` 디컴파일 재확인 (3.5) |
| 레이어 4 | flow: [미확정: 플레이어 본체 추정] | 플레이어 본체 캡슐(top 1.0/bottom 0.5/r 0.5) | player 노트 `InitDefaultCollision` (3.2) |
| ActionEX5 떨굼 | flow 6.3: `Shot(0, false)` 동작 | **정정:** 호출처 없음, 관측되지 않음 | player 노트 13절 (5.2) |
| 탈락 vs 낙하 | flow y ≤ −1.0 / player |p|² ≥ 67.24 또는 y < −0.5 | 둘 다 맞음. 앞은 순위 기록(GameMgr), 뒤는 상태 진입(Player). 지면 경로 순서는 낙하 상태 → 탈락 | 5.4 |
| 공 반지름 | flow 1.1×scale / assets 노드 스케일 1.1 | 일치 | 6.9 |
| 손·공 위치 | flow 플레이어+앞×0.5, 공 = 손+앞×r / assets attach00 (0,1.1,1.1) 추정 | flow 판독을 따름. attach00은 로직에서 안 씀 | `SnowHandPos::UpdatePos`·`GetPos` 재확인 (6.9) |
| 결과 위치 모델 | flow: 안 씀 / assets: 위치표 | flow 판독을 따름. 표는 데이터 참고 | 6.3, 7.3 |
| L15 값 | assets: [미확정] | 공 크기 T(0~127). MOV·FAL·FIR_MOV·HIT_YKD·HIT_PC | `WriteTrackLocalVariable(…, 0xf, …)` 6곳 확인 (6.12) |
| `%d` tier | assets: [추정: 크기] | `level < 3 ? 0 : level < 6 ? 1 : 2` | flow 판독 (7.6) |
| CPU 위협 공 IsDeleteWait | player: 이유 [미확정] | 코드 그대로 state −1 공만 봄 → 회피 거의 없음 [추정: 효과], 웹은 그대로 | `IsDeleteWait`·`IsGrowth` 본문, PLT 이름 (6.13.2) |
| 결과 중 피격 | flow: [미확정] | 넉백은 일어남, 순위 불변, 승자 피격 시 결과 단계 1 대기 연장 [판독 합성] | player `SetDamage` (8절) |
| E000/E003 | SHARED 50행 추정 | E000 = A, E003 = B | player 판독 (1절) |

원본 파일과 웹 소스는 바꾸지 않았다. 이 문서 작성에서 쓴 파일은 이 문서, [README.md](README.md)의 hsmg402 행, [SHARED.md](../../../analysis/notes/SHARED.md) 한 줄이다.
