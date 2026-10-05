# 02. 코드 모듈 구조와 엔진층

2026-10-05. 담당: modules. 상태: **모듈 구조·엔진 코어 판독 1차 완료**. 원본을 실행해 확인한 것은 없다. 웹 코드는 없다.

이 문서는 모듈 개요 문서다. 엔진 코어 세부(시간·파이버·난수·장면 수명·NRO 로딩 의사코드)는 [web/docs/engine/01_core.md](../engine/01_core.md)로 나눴다. 게임 구조(모드·장면 흐름·보드·미니게임 분류·데이터 표)는 [03_game_structure.md](03_game_structure.md), 에셋 형식은 [01_package_and_assets.md](01_package_and_assets.md)에 있다.

확정 수준 표기:
- **[실행]**: 이 문서의 도구를 실제로 돌려 확인했다. 원본 게임 실행은 아니다.
- **[판독]**: Ghidra 디컴파일 또는 capstone 디스어셈블로 원본 명령을 읽었다.
- **[데이터]**: 동적 심볼·문자열·추출 파일에서 확인했다.
- **[재구현 계산]**: 판독한 식을 파이썬으로 다시 계산했다.
- **[추정]**: 근거는 있으나 코드로 닫지 못했다.
- **[미확정]**: 근거가 없거나 서로 맞지 않는다.

주소는 SwitchLoader 기본 베이스(0x7100000000) 기준이다. 모듈마다 같은 주소 공간을 쓴다. 그래서 **주소에는 모듈 이름을 함께 쓴다**(`main @0x…`, `hsmg101 @0x…`). main 평면 이미지 오프셋은 주소 − 0x7100000000이다(web/docs/analysis/03의 `main+0x…` 표기와 같은 값이다).

---

## 목차

1. [요약](#1-요약)
2. [실행 파일과 미들웨어](#2-실행-파일과-미들웨어)
3. [NRO 모듈 분류와 로딩 경로](#3-nro-모듈-분류와-로딩-경로)
4. [심볼과 모듈 간 링크](#4-심볼과-모듈-간-링크)
5. [엔진층 bex: mpj 대조](#5-엔진층-bex-mpj-대조)
6. [게임층 hs](#6-게임층-hs)
7. [미니게임 NRO 예: hsmg101](#7-미니게임-nro-예-hsmg101)
8. [웹 포팅 시사점](#8-웹-포팅-시사점)
9. [Ghidra 환경과 재현](#9-ghidra-환경과-재현)
10. [검증·실행 기록](#10-검증실행-기록)
11. [미확정과 다음 단계](#11-미확정과-다음-단계)

---

## 1. 요약

| 질문 | 결론 | 근거 | 수준 |
|---|---|---|---|
| 코드 계층 | `nn::bezel`(Nintendo Bezel Engine 1.55.0, main에 정적 링크) → `bex`(엔진 확장, `libBEX`) → `hs`(게임 공용) → NRO(`hsmg###`·`hsbd01`·`hsmm##`·`hsmn##`·`op`·`ed`) | main 문자열 `NintendoWare_Bezel_Engine-1_55_0`, 소스 경로 `C:/project/hs/hs/libBEX/…/bex_system_dll.cpp` | 데이터 |
| 내부 코드명 | **hs**. NRO 빌드 경로는 `C:/project/hs/hs/Programs/Outputs/NX64/<모듈>/NX_Release/<모듈>.nrs`, NRR 은 `hs.nrr` | main 문자열 | 데이터 |
| NRO 를 언제 싣나 | 장면을 시작할 때 `bex::SystemScene` 상태 1에서 싣는다(장면목록 열1 == 1). 끝낼 때는 16+2 프레임 뒤 상태 10에서 내린다. **NRO 파일명 = 장면 이름**이다 | main `FUN_710034a6c4`, `FUN_710030b598/7ac/dd4/8ec` | 판독 |
| 보드·미니게임 전환 | 보드 `hsbd01` → `SceneBdGameBase::RequestCallMiniGame` → `CallScene("hsmg###")`(보드 장면은 삭제되고 NRO 도 내려감) → 미니게임 끝 `RequestExitGame` → `ReturnScene`(보드 다시 생성) | main `@0x710010e868`, `@0x7100391800`, 5.1 | 판독 / 보드 상태 보존 방식은 미확정 |
| NRO 가 main 에서 쓰는 것 | import 60,290행: main 55,265(hs 32,261 · bex 18,279 · nn::bezel 2,537 · rtti 717 …), sdk 4,521(libc·nn::util·std) | `analysis/modules/nro_imports.tsv` | 데이터 |
| bex 가 mpj 와 같은가 | **아니다.** 이름만 같은 다른 세대다. 정규화 이름이 같은 함수는 26개뿐이다. 시간·파이버·난수·장면 수명 모두 구현이 다르다(5절) | `main_exports.tsv` 대 mpj `main.nso.tsv` | 데이터 + 판독 |
| 미니게임 시간 | `bex::GetDeltaTime()` = f32(1/60) 고정(프레임레이트 기본값 0 = 고정 60) | main `@0x7100305058` | 판독 / 변경 경로 미사용은 추정 |
| 미니게임 공용 기반 | `hs::SceneMiniGameBase`. 105개 전부 상속한다(12개는 `sb::SceneMiniGameBase`를 거침). 흐름 단계 0~0x13을 **장면 Update 에서 한 프레임에 한 걸음** 돈다. NRO 는 `OnGame*` 가상 함수 26칸을 덮는다 | main `@0x710008aa88`, 표 `@0x71014a78e8` | 판독 |

## 2. 실행 파일과 미들웨어

### 2.1 ExeFS [데이터]

| 파일 | 크기 | 내용 |
|---|---|---|
| `main` | 11,819,896 (평면 0x164F000) | 게임 + Bezel 엔진 + 미들웨어 전부. 동적 심볼 정의 3,505 / 미정의 1,059 |
| `sdk` | 5,755,393 | Nintendo SDK(정의 심볼 26,570). NRO 가 libc·`nn::util`·`std`·`nn::ldn` 을 여기서 가져온다 |
| `subsdk0` | 4,920,073 | **NVN GLSL 셰이더 컴파일러**(`glslcCompileSpecialized` 등 export 20개) |
| `subsdk1` | 3,409,290 | **동영상**(`NintendoSDK_movie-11_4_3`) |
| `rtld` | 7,187 | 런타임 링커 |
| `main.npdm` | 1,572 | 권한 |

### 2.2 main 에 들어 있는 미들웨어 [데이터: `SDK MW+…` 문자열]

| 라이브러리 | 버전 | mpj(잼버리) |
|---|---|---|
| NintendoWare Bezel Engine (+Network Addon, Fxt) | **1.55.0** | 2.9.0 |
| PhysX | **3.4.0** | 4.1.2 |
| Lua | **5.2** | 5.4 |
| NEX | 4.6.5 | — |
| Pia | 5.33.0 | — |
| NintendoWare G3d·Ui2d·Font·Atk·Vfx·Vfx2 | 11.4.3 | — |

엔진 세대 자체가 mpj 보다 한참 앞이다. 그래서 bex 가 다른 것과 맞물린다(5절).

## 3. NRO 모듈 분류와 로딩 경로

### 3.1 분류와 장면 기반 클래스 [데이터: `analysis/modules/scene_vtables.tsv`]

| 모듈 | 개수 | 장면 클래스 | 상속하는 main 기반 | 정적 포함 라이브러리 |
|---|---|---|---|---|
| `hsmg###` | 105 | `hsmgNNN::SceneHsmgNNN` | `hs::SceneMiniGameBase` | 12개는 `sb` 라이브러리(`sb::SceneMiniGameBase`, `sb::Replay`, `sb::Players<>`, `sb::Com<>`) |
| `hsbd01` | 1 | `hsbd01::SceneHsbd01` | `hs::SceneBdGameBase` | — (가장 큼, 3.0 MB, 정의 심볼 7,054) |
| `hsmm01`~`07`, `hsmmet` | 8 | `hsmmNN::SceneHsmmNN` | `hs::SceneHsGameBase` → `hsmm::HSMMSceneBase` | `hsmm` 공용 라이브러리(심볼 1,883개, 128 클래스)가 8개 NRO 에 **복제**되어 있다 |
| `hsmn00`~`09`, `ed` | 11 | `hsmnNN::SceneHsmnNN`, `ed::SceneEd` | `hs::SceneHsFlowBase` | — |
| `op` | 1 | `op::SceneOp` | `hs::SceneHsGameBase` | — |

- 모드 이름(미니게임 마운틴·메뉴 등)과의 대응은 [03 §5](03_game_structure.md#5-장면-시스템과-모드-흐름)에 있다.
- `sb` 를 쓰는 12개: hsmg108·203·204·208·209·213·215·429·704·803·806·809. 이들만 `Get/SetSyncRandSeed`를 써서 리플레이 시드를 저장·복원한다 **[판독: hsmg108 `sb::Replay::LoadReplayData @0x710000fe1c`]**. `sb`라는 이름의 뜻은 **[미확정]**이다. mpj main 에도 `sb::` 심볼이 있다 **[데이터]**.
- 미니게임 NRO 의 자기 클래스는 평균 20.7개다(최소 4, 최대 80). 이름 관례가 섞여 있다(`PlayerMgr`·`PlayerManager`·`PlayerMan`). 여러 팀이 나눠 만든 것으로 보인다 **[추정]**.

### 3.2 로딩 경로 요약 [판독 — 세부는 01_core §5.1·§6]

```
부팅: SystemDll 초기화 → nn::ro::Initialize → "/.nrr/hs.nrr" 읽기 → RegisterModuleInfo
장면 요청 (ChangeScene/CallScene/ReturnScene, 이름 = 장면목록 열0)
  SystemScene 상태 0 : 장면목록 열4 아카이브 비동기 로드
          상태 1 : 열1 == 1 이면  "/nro/NX_Release/<이름>.nro" 읽기(0x1000 정렬)
                                → nn::ro::GetBufferSize → SystemHeap::Alloc → nn::ro::LoadModule
                   장면 팩토리(열5 클래스 이름) → 장면 객체
          상태 2~6: SyncBegin → Begin → Load → Setup → SyncSetup
          상태 7 : 실행 (장면 Update = 엔티티 틱)
          종료   : Cleanup → (8) 장면 삭제·아카이브 언마운트 → (9) 16프레임 → (10) 2프레임 → UnloadModule
```

| 사실 | 수준 |
|---|---|
| `hs.nrr` 해시 126개 = `nro/NX_Release` 126개 파일 SHA-256 전부 일치 | 실행 |
| 장면목록 `system/data/bex_scenelist.csv`(복호본 `extracted/nkn/system.nx.bea/system/data/bex_scenelist.csv`)는 161행이다. 열1=0(main 내장) 6행, 1(NRO) 155행 | 데이터 |
| 장면 팩토리는 열5 클래스 이름을 잡은 람다(`PTR 0x71014b2740`)다. 열5가 비면 기본 클래스를 쓴다 | 판독(목록 파서 `FUN_7100381d90`) |
| 장면목록 열1 행 중 NRO 가 없는 것(hsbd00·02~05·10·99, test_* 등)은 장면으로 부르지 않는다. 보드는 늘 `ChangeScene("hsbd01")`다. hsbd00/02~05 행은 `GetBoardNo`로 골라 **아카이브 목록만** 꺼내 미리 싣는다 | 판독: main `FUN_71000282a4`, `analysis/decomp/main_board.c` |
| 보드별 아카이브는 `hsbd01::SceneHsbd01::PrepareLoadArchive_game`(hsbd01 `@0x710012bb7c`)이 직접 고른다("hsbd00" + 보드 객체 + 플레이어·NPC + "object/objbd_pack" + "emote") | 판독 |
| 미니게임 NRO 이름은 `hs::MGList::GetNameFromID(GameWork::GetMiniGameID())`다(보드에서 부를 때) | 판독: main `@0x710010e868` |
| 장면을 바꿀 때마다 이전 장면의 NRO 를 내린다. 상주 플래그(bit3)를 쓰는 호출은 찾지 못했다 | 판독 / 상주 사용처 미확정 |

## 4. 심볼과 모듈 간 링크

### 4.1 main 이 내보내는 심볼 [데이터: `analysis/modules/main_exports.tsv`]

NRO 는 main 의 동적 심볼을 **이름으로** 링크한다. 그래서 main·NRO 모두 C++ 맹글링 이름이 남아 있다.

| 네임스페이스 | main 정의 심볼(vtable·typeinfo 포함) | 클래스 수 |
|---|---|---|
| `hs` | 1,781 | 127 |
| `bex` | 1,167 | 107 |
| `nn` | 419 (대부분 `nn::bezel`) | |
| `std` | 55 | |
| `nd`·`NdObject`·`libndcore`·`GMSystemMain` 등 | 37 | |

- 메인 스레드가 SHARED 에 적은 수(hs 1,441 / bex 995)는 집계 기준이 다르다(이 표는 thunk·vtable·typeinfo 포함).
- 주요 hs 클래스(정의 함수 수): `hs::actor::Actor` 269, `hs::GameWork` 186, `hs::SaveDataMgr` 110, `hs::HsModel` 87, `hs::CharacterModel` 71, `hs::SaveData` 56, `hs::PlayerModel` 52, `hs::PlayReport` 51, `hs::SceneMiniGameBase` 46. 전체 목록은 6절에 있다.
- 주요 bex 클래스: `bex::Model` 326, `bex::Layout` 90, `bex::Camera` 51, `bex::Net` 41, `bex::Sound` 36, `bex::SystemRender` 34, `bex::Pad` 34, `bex::Effect2Mgr` 28, `bex::SystemInput` 26, `bex::Collision` 22, `bex::SceneGameBase` 19, `bex::Fiber` 13. 자유 함수 `bex::` 17개(GetDeltaTime·GetFrameRate·Rand*·SyncRand* 등).

### 4.2 NRO 가 가져다 쓰는 것 [데이터: `nro_imports.tsv`, `main_class_usage.tsv`, `main_function_usage.tsv`]

| 제공 모듈 | import 행 | 비고 |
|---|---|---|
| main | 55,265 | hs 32,261 · bex 18,279 · `nn::bezel` 2,537 · rtti 717 · NdObject 386 · nn::nex 252 |
| sdk | 4,521 | libc 2,264 · `nn::util` 720 · std · `nn::ldn` · `nn::diag` |
| 미해결 | 504 | 모듈마다 `__rel_dyn/plt_start/end` 4개(링커 표지). 실제 미해결은 0 |

NRO 가 많이 쓰는 main 클래스(NRO 수 / 그중 미니게임 수):

| 클래스 | NRO | 미니게임 | import 행 |
|---|---|---|---|
| `bex::SceneGameBase`·`bex::SceneBase`·`rtti::Typeinfo`·`NdObject` | 126 | 105 | — |
| `bex::Model` | 124 | 105 | 8,360 |
| `hs::HsModel` / `hs::GameWork` / `bex::Camera` | 124 | 105 | 1,778 / 1,670 / 1,128 |
| `hs::PlayerModel` / `hs::CharacterModel` | 116 / 114 | 103 / 102 | 2,470 / 4,294 |
| `bex::Sound` | 110 | 89 | 546 |
| `hs::UIMGTelop` | 107 | 99 | 530 |
| `bex::Fiber` | 106 | 86 | 636 |
| `hs::SceneMiniGameBase` | 105 | 105 | 1,428 |
| `hs::mg::SysMiniGameMgr` | 98 | 97 | 237 |
| `bex::Effect2Mgr` | 95 | 85 | 540 |
| `hs::actor::Actor` / `hs::ActorPlayer` / `hs::ActorManager` / `hs::actor::ActorPad` | 86 | 86 | 10,570 / 1,997 / 627 / 340 |
| `hs::UITimer` | 80 | 71 | 346 |
| `bex::DataCSV` | 72 | 58 | 378 |
| `bex::Layout` / `bex::Pad` | 64 | 44 / 50 | 1,049 / 279 |

엔진 코어 함수 사용:

| 함수 | NRO(미니게임) |
|---|---|
| `bex::Fiber::Fiber`·`Change`·`SetPauseLevel` | 106 (86) |
| `bex::SyncRandMod` | 90 (75) |
| `bex::GetDeltaTime` | 84 (67) |
| `bex::SyncRandRangeF` | 79 (70) |
| `bex::Fiber::Sleep` | 52 (38) |
| `bex::Pad::GetTrigAButton` | 31 (22) |
| `bex::GetFrameRate` | 20 (19) |
| `bex::SetSyncRandSeed` | 13 (12) |

### 4.3 NRO 가 main 심볼을 다시 정의하는 경우 [데이터]

- 각 NRO 가 `bex::Singleton<…>::pSingleton_`(예: hsmg101 의 `GameWork`·`SystemMain`·`SysMiniGameMgr`·`SystemRender`·`GMSystemWipe`)를 약한 정의로 갖고 있다. 런타임에는 rtld 가 먼저 실린 main 쪽으로 묶는 것으로 본다 **[추정]**.
- hs 헤더 인라인 함수(예: `hs::HsModel::Translate` 4바이트, `hs::SceneMiniGameBase::OnGame*` 기본 구현)도 NRO 마다 복제되어 있다.

## 5. 엔진층 bex: mpj 대조

mpj 판독 근거는 [C:/dev/mpj/web/docs/engine/01_core.md](C:/dev/mpj/web/docs/engine/01_core.md)다(읽기만 함). mps 판독은 [web/docs/engine/01_core.md](../engine/01_core.md)이고, 절 번호는 아래 "mps 근거" 열에 있다.

### 5.1 API 구성 [데이터]

| 항목 | mpj | mps |
|---|---|---|
| 코어 모듈 | `bex::MainModule`, `RandModule`, `FiberModule`, `InputModule`, `bex::sound`, `SceneModule`, `CoreSystem` 타이밍 0x0D~0x1B | `bex::SystemMain`, `SystemScene`, `SystemFiber`, `SystemInput`/`SystemSyncInput`, `SystemAudio`, `SystemArchive`, `SystemRender`, `SystemEffect2` … + 자유 함수 `bex::GetDeltaTime()`·`bex::Rand()`·`bex::SyncRand*()` |
| 같은 정규화 이름 함수 | — | **26개**: `bex::Collision::*` 11, `Collision{Capsule,Cylinder,Ray,Triangle}::Set` 4, `bex::NetTransfer::*` 7, `bex::Fiber::{SetPauseLevel,SetStackSize,Sleep,getStaticTypeinfo}` 4 |
| 게임층 | `bq::`(1,813) · `ca::` | `hs::` |

### 5.2 기능별 대조 [판독]

| 기능 | mpj | mps | 같은가 | mps 근거 |
|---|---|---|---|---|
| 메인 루프 | `MainModule` vt+0x40 → `CoreSystem` 타이밍 0x0D~0x1B, 위상정렬 | `SystemMain` vt+0x50: vt+0x48(델타) → vt+0x20 → vt+0x28(하위 시스템 고정 순서) → Bezel 엔진 프레임 | **다름** | 01_core §3 |
| 게임 코드가 도는 곳 | 타이밍 0x0E: SceneModule → FiberModule | Bezel 엔티티 틱(장면 엔티티 TickOrder 2, 파이버 엔티티 TickOrder=인자) | **다름** | §3.3, §5.3 |
| `GetDeltaTime` 원천 | `MainModule` 시간구조체+0x08 = `g_FrameStep.delta` | `SystemMain+0x198`(vt+0x90) | 다름 | §4.1 |
| 기본 프레임 모드 | Variable60(nnMain 이 덮어씀). 리듬·온라인만 Fixed60 | **Fixed60**(열거 0). 바꾸는 경로는 Lua 바인딩 하나 | **다름** | §4.1 |
| 고정 1/60 값 | f32 `0x3C888889` | f32 `0x3C888889`(`1.0f/60.0f`) | 같음 | §4.1 |
| 가변 delta | 실측 ns, ≤0.05 s, 한 프레임 늦음 | 엔진 델타 `engine+0x18` = clamp(실측 µs, min, max)×timeScale(16,666 µs 양자화 옵션) | 다름(값 미확정) | §4.2 |
| 프레임레이트 열거 | 0 F60, 1 V60, 2 F30, 3 V30, 4 F20 … 8 | 0 F60, 1 V60, 2 F30, 3 V30, 4 V60(vsync0), 5 F60(vsync0) | 다름 | §4.1 |
| 파이버 실행 | 장면 시퀀스별 목록, 우선순위 안정정렬, 한 프레임 한 번 | 파이버마다 엔티티, 엔진 틱 순서 | **다름** | §7.1 |
| `Wait()`/`Change()` | `Wait()` = 다음 프레임 | `Change()` = 다음 틱 | 의미 같음 | §7.2 |
| `Sleep(t)` | delta 를 빼고 ≤1.19e-5 이면 **그 틱** 재개 | **상수 1/60** 을 빼고 0으로 자른 뒤 **다음 틱** 재개(Sleep(0.5)=31틱) | **다름** | §7.2 |
| 난수 엔진 | MT19937 ×2, `RandModule+8` 포인터 | 전역 `std::mt19937` ×2(`0x71015f70d8` sync, `0x71015f7ac8` async) | 알고리즘 같음, 배치 다름 | §8.1 |
| 부팅 시드 | `GetSystemTick` 하위 32비트 | 같음 | 같음 | §8.1 |
| async `RandMod/Range` | libc++ `uniform_int` 기각 표본 | 같음 | 같음 | §8.2 |
| **sync** `RandMod/Range` | `(u·n)>>32` | libc++ `uniform_int`(async 와 같은 함수 `@0x710019bfcc`) | **다름** | §8.2 |
| `RandF` | `f32(u)·2⁻³²` | 같음 | 같음 | §8.2 |
| `RandModF`/`RangeF` | async: fmadd(한 번 반올림) / sync: 별도 식 | 둘 다 곱·합 **따로** 반올림 | **다름** | §8.2 |
| sync 시드 시점 | 장면마다 상태 8에서: 오프라인 `async.Rand()`, 온라인 네트워크 값 | **온라인만** `SceneGameBase::SyncBegin`에서 호스트 `Rand()` 전송. 오프라인은 다시 시드하지 않음. 리플레이 미니게임 12개는 직접 Set | **다름** | §8.1 |
| 장면 수명 | `GameScene` 구현체 상태 0~10(OnEntry … OnStartUpdate, UpdateMain) | `SystemScene` 상태 0~10 + `SceneGameBase` SyncBegin/Begin/Load/Setup/SyncSetup/Update/Cleanup | 구조 비슷, 함수 다름 | §5.1, §5.2 |
| 미니게임 흐름 | `bq::MinigameScene::MinigameFlow`, **FiberLite 파이버** 안에서 `Wait()` 한 걸음 | `hs::SceneMiniGameBase::MainLoop`, **장면 Update 에서 직접** 한 걸음 | 단계 체계는 같은 계열(0~0x12 처리기 표, 7~9 에서 3분 타이머 → 10, 0x13 종료), 실행 위치 다름 | §5.5 |
| 입력 | `bex::InputModule` | `bex::Pad::GetTrig*(int 플레이어)` → `SystemSyncInput`(PlayerID→PadID 표 +0x150 → GameController 엔티티, PadID<8) | 다름 | `analysis/decomp/main_input.c` |
| 사운드 | `bex::sound` | `bex::Sound::Play/Play3D/Play3DHookPosition/Stop/…`(int 핸들), `SetSyncRandSeed` 가 사운드에도 시드 전달 | 다름 | `main_exports.tsv` |
| 엔티티 약한 핸들 | `{ptr, node, gen}`, 유효 = `gen == node.word0>>32` | `{ptr(+0x10), gen(+0x18), node(+0x20), slot(+0x28, −1 무효)}`, 유효 = `gen == *node>>20`, 하위 20비트 = 참조 수(원자 증감) | 다름 | `main_fiber.c` `FUN_71002e3a44` |
| `ActorUtil::getDeltaTime` | — | 상수 1/60 | — | §4.1 |

결론: **mpj 의 코어 판독 결과를 mps 에 그대로 쓰면 안 된다.** 그대로 쓸 수 있는 것은 MT19937 엔진·부팅 시드·async 정수 분포·RandF·고정 1/60 비트 값·미니게임 흐름 단계 번호 체계 정도다. 나머지는 mps 판독(01_core)을 따른다.

`bex::Collision::*` 11개는 이름만 같다. 구현이 같은지는 비교하지 않았다 **[미확정]**.

## 6. 게임층 hs

### 6.1 클래스 지도 [데이터: main export, 괄호 = 정의 함수 수]

| 영역 | 클래스 |
|---|---|
| 장면 기반 | `SceneHsGameBase`(10), `SceneMiniGameBase`(46), `SceneBdGameBase`(15), `SceneHsFlowBase`(9) |
| 게임 상태·세이브 | `GameWork`(186, 싱글턴, 플레이어 워크 4개 `+0x18/+0x148/+0x278/+0x3A8`(간격 0x130, 온라인 동기 때 0x129 B 복사 — `SceneHsGameBase::SyncBeginGame @0x7100088d50`)), `PlayerWork`, `SaveDataMgr`(110), `SaveData`(56), `BoardData`(19), `HouseData`(11), `ShopData`, `CardData`, `GameRecordList`, `MGHistory`, `RewardMgr`, `UnlockMgr`, `flag`(전역 플래그 On/Off/Check) |
| 데이터 표 | `MGList`(14, 미니게임 마스터 — web/docs/analysis/03 §4.1), `CharacterList`(13), `ObjectList`(7), `FaceAnimeDatabase`, `mg::InstSettingDb` |
| 캐릭터·모델 | `HsModel`(87), `CharacterModel`(71), `PlayerModel`(52), `NPCModel`(37), `ObjectModel`(24), `ModelBlink`, `CharacterFxTrigger` |
| 액터(미니게임 공용 조작) | `actor::Actor`(269: Action* 상태, 지면·충돌, 점프·엉덩이찍기·피격), `actor::ActorPad`(37), `actor::ActorModel`(25), `actor::ActorParam`(21), `actor::ActorHit`, `actor::ActorHitManager`, `actor::ActorEffect`, `actor::ActorUtil`, `ActorPlayer`(31), `ActorManager`(14) |
| 미니게임 시스템 | `mg::SysMiniGameMgr`(15: PlayerCtrlStart/End, EntryActivePlayer, MinigameUIControl), `mg::SysMiniGameUiMgr`, `mg::MiniGameFinishPlayerUpCamera`(9), `mg::Util`, `MGSound`, `MGThumbnaill` |
| UI | `UIBase`(25), `UIMGStatus`(27), `UIMGTelop`(17), `UITimer`(23), `UIStopWatch`(22), `UIScore`(17), `UIMessageDialog`(32), `UIMessageWindow`(27), `UICard`(21), `UIErrorWindow`, `UIPause`, `UIRetryMenu`, `UIMGGuide`, `UIGuideBase` 외, `Layout`(14), `LayoutText`(13), `UiUtil` |
| 네트워크 | `Net`(11), `NetVoiceChat`, `NetInvitationReceiver`, `*Fiber`(랭킹 업/다운로드·재접속·초대·사진 저장) |
| 기타 | `PlayReport`(51), `Pad`(10), `ScreenSplitterAssist`(14), `TalkMessage`, `MessageStudio`, `InformationGuide`, `Interpolation<Vector3f>`, `ut` |

### 6.2 미니게임 기반 `hs::SceneMiniGameBase` 가상 함수 [데이터: hsmg101 vtable `@0x7100025d10`, 488 B]

vt 오프셋은 vtable 주소점(+0x10) 기준이다. "재정의 수"는 미니게임 105개 중 자기 함수로 덮은 개수다(`analysis/modules/mg_scene_overrides.tsv`). 단, sb 계열 12개는 일부 칸을 `sb::SceneMiniGameBase`가 덮으므로 이 수에서 빠질 수 있다.

| vt | 함수 | 정의한 곳 | 재정의 수 | 부르는 곳 |
|---|---|---|---|---|
| +0x20~+0x50 | SyncBegin, Begin, Load, Setup, SyncSetup, Update, Cleanup | `bex::SceneGameBase` | 0 | `SystemScene` 상태 2~7 |
| +0x58/+0x60 | OnReceiveMessage, ForceExit | `bex::SceneBase` | 0 | 엔티티 메시지 |
| +0x68 | SyncBeginGame | `hs::SceneHsGameBase` | 0 | SyncBegin |
| +0x70~+0x98 | BeginGame, LoadGame, SetupGame, SyncSetupGame, MainLoop, CleanupGame | `hs::SceneMiniGameBase` | 0 | Begin…Cleanup |
| +0xA0 | ExitGame | `bex::SceneGameBase` | 0 | Cleanup |
| +0xA8/+0xB0 | PrepareLoadArchive_system/player | `hs::SceneMiniGameBase` | 0 | Begin |
| +0xB8 | **PrepareLoadArchive_game** | 미니게임 | **93** | Begin |
| +0xC0 | OnBeginGame | 기본 빈 함수 | 6 | BeginGame |
| +0xC8 | OnLoadGame | 기본 참 | 15 | LoadGame |
| +0xD0 | OnSetupGame | 기본 빈 함수 | 35 | SetupGame 끝 |
| +0xD8 | **OnSyncSetup** | 미니게임 | **97** | SyncSetupGame |
| +0xE0 | OnGameInit | | 62 | 흐름 단계 0 |
| +0xE8 | OnGameTitle | | 0 | 단계 1 |
| +0xF0 / +0xF8 | OnGameInstInit / OnGameInstStart | | 1 / 3 | 단계 2 / 3 |
| +0x100 | OnGameFirstFade | | 37 | 단계 4 |
| +0x108 | **OnGameOpening** | | **95** | 단계 5 |
| +0x110 | **OnGameStartBefore** | | **92** | 단계 6 |
| +0x118 | OnGameStart | | 45 | 단계 7 |
| +0x120 | OnGameStartAfter | | 77 | 단계 8 |
| +0x128 | **OnGameMain** | | **100** | 단계 9 |
| +0x130 | OnGameMainEnd | | 68 | 단계 10 |
| +0x138 | OnGameNextRound | | 6 | 단계 11 |
| +0x140 | OnGameFinish | | 67 | 단계 12 |
| +0x148 | OnGameEndingBefore | | 62 | 단계 13 |
| +0x150 | **OnGameEnding** | | **98** | 단계 14 |
| +0x158 | OnGameEndingAfter | | 22 | 단계 15 |
| +0x160 | OnGameLastFade | | 16 | 단계 16 |
| +0x168 | OnGameExit | | 0 | [미확정] |
| +0x170 | OnBeforeSecenceLoop | `hs::SceneMiniGameBase` | 1 | [미확정] |
| +0x178 / +0x180 | OnGameSequenceBefore / After | | 26 / 8 | MainLoop 앞·뒤 |
| +0x188 | **OnCleanupGame** | | **97** | CleanupGame 처음 |
| +0x190 | OnThreeMinTimerEnd | | 13 | 단계 7~9 3분 초과 |
| +0x198 | OnGameEndingSkip | | 15 | 단계 18 |

흐름 단계 표와 의사코드는 [01_core §5.5](../engine/01_core.md)에 있다.

### 6.3 다른 장면 기반의 확장 칸 [데이터]

- `hs::SceneBdGameBase`(hsbd01)는 `SyncBeginGame`·`BeginGame`·`SetupGame`·`MainLoop`·`CleanupGame`·`PrepareLoadArchive_game`을 hsbd01 이 직접 구현한다. `OnGame*` 칸이 없다.
- `hsmm::HSMMSceneBase`는 `+0xC0` 뒤에 `HSMMPrepareLoadArchive_game`, `HSMMBeginGame`, `HSMMSetupGame`, `HSMMMainLoop`, `HSMMCleanupGame`, `OnExitBegin/Loop/End`, `OnResultBegin/Loop/End`, `OnPlayerTypeChange`를 더한다.
- `hs::SceneHsFlowBase`(메뉴)는 `LoadGame`·`SetupGame`·`MainLoop`·`CleanupGame`·`PrepareLoadArchive_game`을 모듈이 구현한다.

## 7. 미니게임 NRO 예: hsmg101

"웨이브 웨이브"(Tidal Toss), MINIGAME_ID 49, 1 vs 3. 전체 디컴파일은 `analysis/decomp/hsmg101.nro.c`(236 함수)다.

### 7.1 클래스 [데이터]

| 클래스 | 부모(import) | 역할 |
|---|---|---|
| `SceneHsmg101` | `hs::SceneMiniGameBase` | 장면, 훅 구현 |
| `PlayerMgr` | — | 4명 관리, 승자 판정 `GetWinner`, 결과 위치 |
| `Player` → `BoatPlayer`(1명 쪽) / `WalkPlayer`(3명 쪽) | `hs::ActorPlayer` | 조작·충돌(`ActionEX2/3/4` 덮음) |
| `Com` → `ComBoat` / `ComWalk` | — | CPU |
| `Stage`, `Wave` | — | 파도 생성·갱신 |
| `Boat` | — | 보트 모델·훅 |
| `CsvData` | — | `mg/hsmg101/data/hsmg101_data.csv`를 `bex::DataCSV`로 읽음(GetFloat 열 1·2·3·4·5·8·0xB·0xC·0x11 …) |
| `MgCamera`, `MgTimer`, `MgTelop` | — | 카메라 애니, UITimer, 승리 텔롭 |
| `SceneHsmg101::FiberEnding` | `bex::Fiber` | 엔딩 연출 파이버 |

### 7.2 덮은 가상 함수와 흐름 [판독: `hsmg101.nro.c`]

`SceneHsmg101` 필드(장면 객체 기준): `+0x3D0` MgCamera*, `+0x3D8` MgTimer*, `+0x3E0` MgTelop*, `+0x3E8` PlayerMgr*, `+0x3F0` Stage*, `+0x3F8` 오프닝 타이머 `{f32 t, u8 정지}`, `+0x400` FiberEnding*, `+0x408` CsvData.

| 단계 | 훅 | hsmg101 동작 | 주소 |
|---|---|---|---|
| Begin | PrepareLoadArchive_game | 기본(덮지 않음) | — |
| SyncSetup | `OnSyncSetup` | MgCamera·MgTimer·MgTelop·PlayerMgr(0x50)·Stage(0x60) 생성, `PlayerMgr::SetReference(CsvData, Stage)`, `Stage::SetUpWave(CsvData)`, 오프닝 타이머 {0, 정지 0} | `@0x7100008910` |
| 5 | `OnGameOpening` | `PlayerMgr::ActionOpening`; 정지가 아니면 `t += GetDeltaTime()`(SystemMain vt+0x90 직접 호출); **`t > 3.0` 이면 참** | `@0x7100008cac` |
| 6 | `OnGameStartBefore` | 오프닝을 건너뛰었으면(장면 +0x3A8) 파도 삭제·플레이어 초기화·`Effect2Mgr::StopAll` | `@0x7100008d14` |
| 8 | `OnGameStartAfter` | `PlayerMgr::OnGameStart` | `@0x7100008d60` |
| 9 | `OnGameMain` | `UITimer::IsEndTimer()` 또는 `PlayerMgr::IsAllLost()` 면 참 | `@0x7100008d7c` |
| 10 | `OnGameMainEnd` | `PlayerMgr::OnGameEnd(UITimer::RemainSecondLyt())` | `@0x7100008dbc` |
| 13 | `OnGameEndingBefore` | `FiberEnding` 생성(`bex::Fiber(2, null)`) | `@0x7100008df4` |
| 14 | `OnGameEnding` | `FiberEnding->IsCompleted()` | `@0x7100008e7c` |
| (파이버) | `FiberEnding::Run` | 모두 탈락이 아니면 `FadeOut(0.333334)`·`Sleep(0.333334)`, 카메라 애니 1, 결과 위치로 이동, `Sleep(0.083333)`, `FadeIn`·`Sleep`. 모두 탈락이면 카메라 애니가 끝날 때까지 `Change()`. 이어서 `ActionResult`, `GetWinner` → `MgTelop::PlayWin` | `@0x7100008e84` |
| 매 프레임 | `OnGameSequenceBefore` | `Stage::Update()` | `@0x7100009088` |
| Cleanup | `OnCleanupGame` | 위 객체 전부 삭제 | `@0x7100009090` |

- 오프닝 길이: 고정 1/60 누적 기준으로 **181번째 프레임에 `t > 3.0`** 이 된다(t = 3.0166645) **[재구현 계산: `web/tools/analysis/core_fiber_sleep.py`]**.
- FiberEnding `Sleep(0.33333397)` = 22틱, `Sleep(0.083333336)` = 7틱 **[재구현 계산]**.
- `Stage::Update`가 `OnGameSequenceBefore`에서 돈다. 즉 흐름 처리기보다 먼저, 매 프레임(단계와 상관없이) 파도가 갱신된다 **[판독]**.

## 8. 웹 포팅 시사점

| 원본 구조 | 웹 권장(제안) | 이유 |
|---|---|---|
| 장면 = NRO 하나 | 장면 = 동적 import 모듈 하나(`games/hsmgNNN/scene.ts`) | 로딩·해제 단위가 같다 |
| `bex_scenelist.csv` | 장면 등록 표(이름 → 모듈·아카이브 목록) | 보드처럼 "목록만 쓰는 행"이 있다 |
| `hs::SceneMiniGameBase` + 26개 훅 | 공용 `MinigameScene` 기반 클래스 + 훅 인터페이스(빈 기본 구현, `OnGameOpening` 등 bool 반환) | 105개가 같은 흐름을 쓴다 |
| `MainLoop` 단계 0~0x13 | 공용 흐름 상태기계(한 프레임 한 걸음, `OnGameSequenceBefore/After`로 감쌈) | 01_core §5.5 |
| 시간 | 고정 dt = `Math.fround(1/60)`, 모든 누적은 f32 | 01_core §4 |
| 파이버 | generator + 틱마다 `max(s − 1/60, 0)` 규칙 | 01_core §7 |
| 난수 | mps 판 `SyncRand`(uniform_int) — mpj 판 재사용 금지 | 01_core §8 |
| `hs::actor::Actor` | 공용 액터 모듈 하나(86개 미니게임이 씀) | 가장 큰 공용 의존 |

## 9. Ghidra 환경과 재현

| 항목 | 값 |
|---|---|
| Ghidra | `tools/ghidra_12.1.2_PUBLIC`(SwitchLoader 포함, mpj 에서 복사) |
| main 프로젝트 | `ghidra_proj/mps_main`(프로그램 `main.nso` = `extracted/exefs/main` 복사본), 분석 1,830초, 함수 42,537(이름 5,596) |
| NRO 프로젝트 | `ghidra_proj/g0`~`g3`(크기 균형 4분할 `ghidra_proj/group#.txt`, 동시 실행), 함수 행 204,226(외부 thunk 88,273, 무명 FUN_ 3,294). 로그에 오류 없음 |
| 디스크 | `ghidra_proj` 1.2 GB |
| 함수 목록 | `analysis/functions/<모듈>.tsv`(main.nso 1 + NRO 126) — address, size, name, signature |
| 디컴파일 | `analysis/decomp/*.c`, 색인 `analysis/decomp/INDEX.tsv`(`web/tools/analysis/decomp_index.py`) |
| 스크립트 | `web/tools/analysis/ghidra_scripts/`: ExportFunctions, DecompileAll, DecompileNamed, DecompileCallers, CoreTool |
| 보조 도구 | `web/tools/analysis/core.sh`(main CoreTool, 약 20초), `web/tools/analysis/dis_main.py`(capstone + export 이름), `web/tools/analysis/mod_symbols.py`(모듈 간 심볼표), `web/tools/analysis/nro_vtable.py`, `web/tools/analysis/mg_scene_overrides.py`, `web/tools/analysis/fn.py`(덤프에서 함수 뽑기, `(depth N)` 접미 처리 추가), `web/tools/analysis/core_rand.py`, `web/tools/analysis/core_fiber_sleep.py` |

```sh
cd F:/dev/mps
# main 가져오기 + 분석 + 함수 목록 (약 30분)
web/tools/analysis/ghidra_main.sh
# NRO 그룹 i (0~3) 가져오기 + 분석 + 함수 목록
web/tools/analysis/ghidra_group.sh i
# 이미 분석한 main 에서 주소 단위 판독
web/tools/analysis/core.sh out.c dec:710034a6c4 refs:71011755db ptrs:71014a78e8:40 "srch:7100300000-7100310000:#0x198"
# 이름 패턴 디컴파일 (패턴 구분자 ~)
MSYS_NO_PATHCONV=1 tools/ghidra_12.1.2_PUBLIC/support/analyzeHeadless.bat F:/dev/mps/ghidra_proj mps_main \
  -process main.nso -noanalysis -readOnly -scriptPath F:/dev/mps/web/tools/analysis/ghidra_scripts \
  -postScript DecompileNamed.java F:/dev/mps/analysis/decomp/main_core.c "bex::Fiber::~bex::SceneGameBase::" 1 2500
# NRO 하나 전체 디컴파일
MSYS_NO_PATHCONV=1 tools/ghidra_12.1.2_PUBLIC/support/analyzeHeadless.bat F:/dev/mps/ghidra_proj g3 \
  -process hsmg101.nro -noanalysis -readOnly -scriptPath F:/dev/mps/web/tools/analysis/ghidra_scripts \
  -postScript DecompileAll.java F:/dev/mps/analysis/decomp/hsmg101.nro.c
# 심볼표·vtable 표
.venv/Scripts/python web/tools/analysis/mod_symbols.py
.venv/Scripts/python web/tools/analysis/mg_scene_overrides.py
.venv/Scripts/python web/tools/analysis/nro_vtable.py extracted/romfs/nro/NX_Release/hsmg101.nro SceneHsmg101
```

- 디맹글러: `.venv`에 `itanium-demangler`(순수 파이썬)를 설치했다. `std::function` 람다 같은 일부 이름은 풀지 못해 맹글링 그대로 남는다.
- 같은 Ghidra 프로젝트는 동시에 한 프로세스만 열 수 있다. 병렬 판독은 다른 프로젝트(g0~g3)끼리만 한다.

## 10. 검증·실행 기록

| 검증 | 결과 | 종류 |
|---|---|---|
| hs.nrr 해시 ↔ NRO 126개 SHA-256 | 126/126 일치 | 실행(자체 스크립트) |
| NRO import 해결 | 미해결 0(링커 표지 504 제외) | 실행(`mod_symbols.py`) |
| 난수 MT 출력 ↔ numpy MT19937 | 1,000개 일치 | 재구현 계산 |
| Sleep 프레임 수, 3.0초 누적 | 01_core §7.2·§9 표 | 재구현 계산 |
| 원본 실행 대조 | 없음 | — |

함수 단위 판독과 재구현 계산은 했지만 전체 프로그램 동작은 검증하지 않았다. 특히 엔티티 틱 순서는 원본 실행 없이 닫을 수 없다.

## 11. 미확정과 다음 단계

| 항목 | 상태 | 필요한 근거 |
|---|---|---|
| 같은 TickOrder 안에서 장면 Update 와 파이버의 순서 | 미확정 | Bezel `Engine` 엔티티 틱 판독, 또는 원본 실행 계측 |
| 엔진 델타 clamp·timeScale 값(TimeCounter 가 씀) | 미확정 | 엔진 초기화 판독 |
| Lua 가 SetFrameRate 를 부르는지 | 미확정(추출 .lua 에 이름 없음) | Lua 5.2 바이트코드 디컴파일 |
| PauseLevel 정지 규칙(파이버 1, 장면 8, 로드 중 SetPause(4)) | 미확정 | `FUN_71006143d0`·엔진 틱 |
| `SystemMain` +0xE0/+0xE8/+0x118 하위 시스템 정체 | 추정·미확정 | 생성자 typeinfo |
| 보드 ↔ 미니게임 왕복 때 보드 상태 보존 위치 | 미확정(보드 장면 객체는 삭제·재생성) | hsbd01 SetupGame·GameWork 판독(structure 담당과 협의) |
| 미니게임 흐름 단계 10~17 세부 분기 | 일부 판독 | 처리기 정독 |
| `bex::act::FiberMan`, `bex::Collision` 동등성 | 미판독 | |
| `sb` 라이브러리 이름 뜻·출처 | 미확정 | |
| NRO 약한 싱글턴 정의가 main 으로 묶이는지 | 추정 | rtld 판독 또는 실행 |
