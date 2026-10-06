# 01. 엔진 코어 — 메인 루프·시간·파이버·난수·장면 수명·NRO 로딩

2026-10-05. 담당: modules. 상태: **코어 판독 1차 완료**(원본 실행 확인 없음). 웹 코드는 고치지 않았다(9절은 명세다).

확정 수준: **[실행]** 원본 실행 확인(이 문서에는 없음), **[판독]** 원본 명령·디컴파일 판독, **[데이터]** 데이터 확인, **[재구현 계산]** 판독한 식을 파이썬으로 다시 계산, **[추정]**, **[미확정]**.

주소는 SwitchLoader 기본 베이스(0x7100000000) 기준이다. 따로 적지 않으면 **main NSO** 주소다. NRO 주소는 모듈 이름을 함께 쓴다(`hsmg101 @0x…`). main 평면 이미지(`extracted/exefs/main.decomp.bin`) 오프셋 = 주소 − 0x7100000000.

> **mpj(잼버리) 문서와의 관계.** 이름이 같은 `bex` 층이지만 mps 의 bex 는 **다른 세대**다. mpj 는 `MainModule`·`RandModule`·`FiberModule`·`CoreSystem` 타이밍 체계이고, mps 는 `SystemMain`·`SystemScene`·`SystemFiber`·자유 함수(`bex::GetDeltaTime`, `bex::Rand` …)와 Bezel 엔티티 틱 체계다. mpj 의 주소·오프셋·순서 결론([C:/dev/mpj/web/docs/engine/01_core.md](C:/dev/mpj/web/docs/engine/01_core.md))을 그대로 쓰면 안 된다. 대조 표는 [web/docs/analysis/02_code_modules.md §5](../analysis/02_code_modules.md#5-엔진층-bex-mpj-대조).

---

## 1. 기능 개요

| 코어 | 원본 | 결론 요약 | 수준 |
|---|---|---|---|
| 메인 루프 | `SystemMain` vt+0x50 `@0x7100302f78` | 매 바퀴: 실측 시간 → vt+0x48(델타 갱신) → vt+0x20 → vt+0x28(하위 시스템·장면 상태기계) → Bezel 엔진 프레임 | 판독 |
| 시간 | `bex::GetDeltaTime @0x710012cb50` = `SystemMain+0x198` | 프레임레이트 열거 기본값 0(고정 60) → **항상 f32(1/60) = `0x3C888889`**. 바꾸는 경로는 Lua 바인딩 하나뿐이고 사용처를 찾지 못했다 | 판독 / 변경 경로 미사용은 추정 |
| 파이버 | `bex::Fiber` | 파이버마다 Bezel 엔티티(틱 순서 = 생성자 첫 인자)를 만들고 엔티티 틱에서 재개. `Change()` = 다음 틱, `Sleep(t)` = 틱마다 **상수 1/60** 을 빼고 0이 된 **다음 틱**에 재개 | 판독 + 재구현 계산 |
| 난수 | `bex::Rand*`, `bex::SyncRand*` | 전역 `std::mt19937` 두 개(sync, async). **sync·async 분포 식이 같다**(libc++ `uniform_int` 기각 표본, 실수형은 곱·합 따로 반올림). 시드는 부팅 때 `GetSystemTick`, sync 는 **온라인일 때만** 장면 시작에 다시 시드 | 판독 + 재구현 계산 |
| 장면 수명 | `bex::SystemScene` 상태 0~10 + `bex::SceneGameBase` | 아카이브 로드 → (NRO 면) 모듈 로드 → 장면 생성 → SyncBegin → Begin → Load → Setup → SyncSetup → (Update 매 프레임) → Cleanup → 삭제 → 16+2 프레임 뒤 NRO 해제 | 판독 |
| 미니게임 흐름 | `hs::SceneMiniGameBase::MainLoop @0x710008aa88` | 장면 Update 안에서 **한 프레임에 한 걸음**(파이버 아님). 단계 0~0x13, 처리기 표 `@0x71014a78e8` | 판독 |

## 2. 분석 대상·자료 위치

| 항목 | 위치 |
|---|---|
| 원본 | Mario Party Superstars US v0, `extracted/exefs/main`(NSO), `extracted/romfs/nro/NX_Release/*.nro`, `extracted/romfs/.nrr/hs.nrr` |
| Ghidra | `ghidra_proj/mps_main`(main.nso), `ghidra_proj/g0`~`g3`(NRO, `ghidra_proj/group#.txt`) |
| 판독 덤프 | `analysis/decomp/main_*.c`(명령별, 머리줄 `// ######## <명령>`·`// ==== <주소> <이름>`), `main_core.c`(bex/hs 장면·파이버·난수·시간 이름 있는 함수 273개), 색인 `analysis/decomp/INDEX.tsv` |
| 도구 | `web/tools/analysis/core.sh`(CoreTool 래퍼), `web/tools/analysis/dis_main.py`(capstone, export 이름 표시), `web/tools/analysis/core_rand.py`(난수 재구현), `web/tools/analysis/core_fiber_sleep.py`(Sleep 프레임 수) |
| 계산 결과 | `analysis/core/rand_vectors.json`, `analysis/core/fiber_sleep.json` |

## 3. 진입점과 전체 호출 흐름

### 3.1 메인 루프 `SystemMain` vt+0x50 `FUN_7100302f78` [판독]

`SystemMain` 싱글턴은 `bex::Singleton<bex::SystemMain>::pSingleton_ @0x71015a7bf0`, vtable `0x71014b1030`(생성 `FUN_7100301b94`).

```c
SetCpuBoostMode(1);
vt+0x68();                       // 힙 설정 (FUN_7100305678)
FUN_71003030c0(this);            // InitializeSystem: 하위 시스템 생성 (3.2)
vt+0x18();  SetCpuBoostMode(0);
if (현재 장면 없음) SystemScene::CallScene(this+0x208 문자열);  // 이 문자열을 채우는 곳은 미확인. 첫 메뉴 장면 hsmn00 은 web/docs/analysis/03 §5.2
while (!엔진 종료 요청) {
  this+0x1A8 = (f32)(now - this+0x1A0) / 1e9;   // 실측 프레임 시간(초), 쓰는 곳 미확정
  vt+0x48();    // 프레임 시작: vt+0x80(델타 갱신 4.1) → vt+0x88(엔진 상태≤8) → [+0x118]vt+0x48 → Tool vt+0x48
  vt+0x20();    // Render vt+0x50, Primitive vt+0x48
  vt+0x28();    // 하위 시스템 갱신 (3.3)
  FUN_71005ff7f4(engine);   // Bezel 엔진 한 프레임 → FUN_71005fef40 (엔진 델타 4.2, 각 서브시스템 갱신)
}
```

### 3.2 하위 시스템 배치 (`SystemMain` 필드, `FUN_71003030c0` 판독) [판독 / 일부 추정]

| 필드 | 생성자 | 시스템 | 근거 |
|---|---|---|---|
| +0xE0 | `FUN_71002e7e94` | SystemInput 계열 **[추정: 주소가 SystemInputBase 함수 옆]** | |
| +0xE8 | `FUN_7100300174` | SystemSyncInput **[추정: 주소 근접]** | |
| +0xF0 | `FUN_71002cc2f4` | SystemArchive | 싱글턴 대입 |
| +0xF8 | `FUN_7100348dd8` | **SystemScene** | 싱글턴 대입 |
| +0x100 | `FUN_71002d0158` | SystemAudio | 싱글턴 대입 |
| +0x108 | `FUN_71002d3404` | SystemDebug | 싱글턴 대입 |
| +0x110 | `FUN_71002e3f0c` | **SystemFiber** (`DAT_71015ee5c8`, typeinfo "bex::SystemFiber") | 전역 대입 |
| +0x118 | `FUN_71002e5888` | [미확정] | |
| +0x128 | `FUN_710034ffa4` | SystemTool | 싱글턴 대입 |
| +0x130 | `FUN_710030db64` | SystemPrimitive | 싱글턴 대입 |
| +0x138 | `FUN_71003381c4` | SystemRender | 싱글턴 대입 |
| +0x140, +0x148 | `FUN_71002d640c` | SystemEffect2 (둘) | 싱글턴 대입 |
| +0x150 | `FUN_7100350f60` | SystemVibration | 싱글턴 대입 |

NRO 로더(SystemDll)는 이 표 밖의 전역 `*(0x7101607c48)`이다(6절).

### 3.3 한 프레임 순서 (`SystemMain` vt+0x28 `FUN_7100302d04`) [판독]

```
frameCounter(+0x1AC)++ ; (+0x180 플래그면 vt+0x78 재초기화)
[엔진상태<9] +0xF0 Archive.vt+0x28
             +0x138 Render.vt+0x28
[엔진상태<9] +0x118, +0xE0, +0xE8 .vt+0x28 → FUN_71001942c0
             → SystemScene 상태기계 FUN_710034a6c4 (5.1)
             → SystemFiber 대기/삭제 목록 처리 FUN_71002e40a0
             → +0x100 Audio, +0x140/+0x148 Effect2, +0x150 Vibration
             +0x108 Debug, +0x128 Tool, +0x130 Primitive
```

그 다음 Bezel 엔진 프레임에서 엔티티가 틱한다. **장면 Update 와 게임 파이버는 둘 다 엔티티 틱에서 돈다**(장면은 엔티티 "BEXSceneBaseEntityForScript" 메시지 0, 파이버는 "bex::SystemFiber.FiberBase" 엔티티). 둘 다 TickOrder 2(파이버는 생성자 인자가 2일 때). 같은 틱 순서 안의 순서는 엔진 내부라 확인하지 못했다 **[미확정]**. 장면이 자기가 만든 파이버보다 먼저 생성되므로 장면 → 파이버 순서일 가능성이 있다 **[추정]**.

## 4. 시간

### 4.1 `bex::GetDeltaTime` [판독]

| 함수 | 주소 | 동작 |
|---|---|---|
| `bex::GetDeltaTime()` | `@0x710012cb50` | `SystemMain` vt+0x90 = `@0x7100009764`: `return *(f32*)(this+0x198)` |
| (무명) GetDeltaRate | `@0x710012cb70` | vt+0x98 = `this+0x19C` |
| (무명) SetFrameRate | `@0x710012cb90` | `this+0x190 = w0`. 호출처는 Lua 바인딩 `FUN_71001c5a54`(인자 열거 `FRAME_RATE` 0~5 검사) 하나 |
| `bex::GetFrameRate()` | `@0x710012cbb0` | `this+0x190` |
| `hs::actor::ActorUtil::getDeltaTime()` | `@0x71000e6ac0` | **상수** `0x3C888889` |

프레임 시작 `SystemMain` vt+0x80 `@0x7100305058`:

```c
switch (frameRate /*+0x190*/) {          // 분기 표 @0x7101196287
  case 0: fps=60; vsync=1; fixed=1; break;   // 고정 60
  case 1: fps=60; vsync=1; fixed=0; break;   // 가변 60 (그 밖 값도 같음)
  case 2: fps=30; vsync=2; fixed=1; break;   // 고정 30
  case 3: fps=30; vsync=2; fixed=0; break;   // 가변 30
  case 4: fps=60; vsync=0; fixed=0; break;
  case 5: fps=60; vsync=0; fixed=1; break;
}
step = 1.0f / fps;                         // f32 나눗셈
engine+0x21C bit3 = fixed;  FUN_71005fd008(engine, step) /* engine+0x2C */;  FUN_71005fd088(engine, vsync);
delta /*+0x198*/ = engine+0x18;  rate /*+0x19C*/ = delta / step;
if (fixed) { delta = step; rate = 60.0f / fps; }
```

- 초기값: `SystemMain` vt+0x78 `@0x7100306ce4`가 `+0x190 = 0`(고정 60) **[판독]**. main 안에서 `+0x190`에 쓰는 다른 곳은 SetFrameRate 하나다(전역 명령 검색 `analysis/decomp/main_sm_srch2.c`) **[판독]**.
- 추출한 `.lua` 25개(바이트코드)에서 SetFrameRate 계열 이름을 찾지 못했다. `bex.lua`에 `FRAME_RATE` 열거 이름만 있다 **[데이터]**. 그래서 미니게임에서 `GetDeltaTime()` = **f32(1/60) = 0x3C888889** 로 본다 **[추정: Lua 미사용]**.
- mpj 와의 차이: mpj 오프라인 장면은 가변(실측 ≤ 0.05 s)이었다. mps 는 고정이 기본이다.

### 4.2 Bezel 엔진 델타 `FUN_71005fef40` (engine+0x18) [판독]

`bex::ut::TimeCounter::Tick @0x7100371664`는 `SystemMain+0x198`이 아니라 **엔진 델타 `engine+0x18`** 을 뺀다.

```c
if (engine+0x21C bit3 /*fixed*/) raw = engine+0x2C;            // = 1/fps (4.1 에서 넣은 값)
else { us = ns/1000; if (bit8) us = max(1, round(us/16666))*16666; raw = (f32)us * 1e-6; }
raw = clamp(raw, engine+0x20 /*최소*/, engine+0x24 /*최대*/);   engine+0x1C = raw;
engine+0x18 = engine+0x28 /*timeScale*/ * raw;
```

- 고정 모드면 `engine+0x18 = timeScale × clamp(1/60)`. timeScale·clamp 값은 확인하지 못했다 **[미확정]**. 1.0 이면 1/60 과 같다 **[추정]**.

### 4.3 TimeCounter [판독 `@0x7100371630~0x71003716c0`]

| 함수 | 식 |
|---|---|
| `Set(t)` | `v = max(t, 0)` |
| `Tick()` | `v>0` 이면 `v -= engine+0x18`; 결과 `>0` 이면 false, 아니면 `v=0`, true. 처음부터 `v≤0` 이면 true |
| `IsEnd()` | `v <= 0` |
| `Remain()` | `max(v, 0)` |

프레임 카운터(`@0x7100371464`/`@0x7100371484`): `Set(n)`, `Tick()` = n==0 이면 true, 아니면 `--n == 0`.

## 5. 장면 수명

### 5.1 `SystemScene` 상태기계 `FUN_710034a6c4` [판독]

`SystemScene`(싱글턴, 생성 `FUN_7100348dd8`) 필드: `+0x28` 상태, `+0x2C` 이전 상태, `+0x30` 장면 단계 번호, `+0x38` 현재 장면, `+0x40` 요청된 장면 이름, `+0x58` 직전 장면 이름, `+0x70` 현재 장면 이름, `+0xA0` 프레임 카운터, `+0xA8` ArchiveLoader, `+0x120` 플래그(bit0 종료 요청, bit4 전환 중, bit12 NRO 장면이었음, bit16 아카이브 유지).

| 상태 | 하는 일 | 다음 |
|---|---|---|
| 0 | 요청 이름(+0x40)이 있고 현재 장면이 없으면: 장면목록 항목의 아카이브(열4)와 추가 목록(+0xF0)을 ArchiveLoader 에 넣고 `BeginLoadAsync`, CPU 부스트 | 1 |
| 1 | 아카이브 로드 끝 → 이름을 +0x70 으로 복사 → 장면목록 **열1 == 1 이면 NRO 등록·로드**(6절, 이름 = 장면 이름) → 장면 생성 `FUN_710034b310`(팩토리, 열5 클래스) → `+0x38`, 장면+0x1F8 = 열1 | 2 |
| 2 | 단계 1: 장면 vt+0x20 **SyncBegin** 이 참일 때까지(종료 요청이면 Cleanup 으로) | 3 |
| 3 | 단계 2: vt+0x28 **Begin** | 4 |
| 4 | 단계 3: vt+0x30 **Load** 가 참일 때까지 | 5 |
| 5 | 단계 4: vt+0x38 **Setup**, 장면+0x1FC = 1(Update 허용), CPU 부스트 끔 | 6 |
| 6 | 단계 5: vt+0x40 **SyncSetup** 이 참일 때까지 | 7 |
| 7 | 단계 6: 실행 중(Update 는 엔티티 틱에서 5.3). 종료 요청(+0x120 bit0)이면 단계 7: 장면+0x1FC=0, vt+0x50 **Cleanup**, 카운터 16 | 8 |
| 8 | +0x70 → +0x58, 장면 삭제(vt+8), 아카이브 언마운트(bit16 아니면), 카운터 16 | 9 |
| 9 | 카운터 16 소진 + 엔진 상태<6 → +0x70 비움, 카운터 2 | 10 |
| 10 | 카운터 2 소진 → 상태 0. **직전 장면이 NRO 면 `UnloadModule`·버퍼 해제**(이름 +0x58) | 0 |

- 상태 2~6 의 `(int)장면[0x3F]==2` 분기는 Lua 장면(열1=2)용 코루틴 실행이다. 장면목록에는 0·1만 있다 **[데이터]**.
- 전환 API(`ChangeScene`/`CallScene`/`ReturnScene`/`ReturnSceneTo`/`RebootScene` `@0x710034b408~`)는 web/docs/analysis/03 §5.2 참고.

### 5.2 `bex::SceneGameBase` 단계 함수 [판독 `main_core.c`]

| vt | 함수 | 하는 일 | 부르는 하위 가상 |
|---|---|---|---|
| +0x20 | `SyncBegin @0x7100391020` | 1회 vt+0x68 **SyncBeginGame**. 온라인(세션 연결)이면 호스트가 `Rand()`를 보내고 모두 `SetSyncRandSeed`(6.3). 끝에 SyncInput 초기화, `SetPause(4)` | 0x68 |
| +0x28 | `Begin @0x7100391240` | vt+0x70 **BeginGame** → vt+0xA8/B0/B8 **PrepareLoadArchive_system/player/game** | 0x70, 0xA8~0xB8 |
| +0x30 | `Load @0x71003912e4` | 처음: `BeginLoadAsync`, 거짓. 이후: 로드 끝 && vt+0x78 **LoadGame** && 엔진 상태>3 | 0x78 |
| +0x38 | `Setup @0x7100391380` | vt+0x80 **SetupGame** | 0x80 |
| +0x40 | `SyncSetup @0x71003913c0` | 온라인 핸드셰이크(메시지 4/5) 또는 SyncInput 시작 대기 → vt+0x88 **SyncSetupGame**, `CancelPause(4)` | 0x88 |
| +0x48 | `Update @0x71003915b4` | 아카이브 추가 로드 갱신, 종료 요청(+0x280 bit8) 아니면 vt+0x90 **MainLoop** | 0x90 |
| +0x50 | `Cleanup @0x7100391624` | SyncInput 정지, `CancelPause(1,2,3)`, vt+0x98 **CleanupGame**, 아카이브 언마운트, vt+0xA0 **ExitGame**(이유 +0x260) | 0x98, 0xA0 |

`SceneGameBase` 필드: `+0x60` 장면 이름(char[0x80]), `+0x1F8` 장면 종류(장면목록 열1), `+0x1FC` Update 허용, `+0x218` ArchiveLoader, `+0x260` 종료 이유, `+0x268` Call 대상 이름, `+0x280` 플래그(bit8 종료 요청, bit12 로드 시작), `+0x285/+0x286` 온라인 시드·데이터 수신, `+0x294` SyncBeginGame 완료.

### 5.3 장면 Update 호출 경로 [판독]

`bex::SceneBase::OnReceiveMessage @0x710034dbc4`: 메시지 종류 0 && 장면+0x1FC && 엔진 상태<2 이면 vt+0x48(Update). 장면 엔티티는 `FUN_7100390d9c`에서 "BEXSceneBaseEntityForScript", **TickOrder 2**, 일시정지 단계 8 로 만든다.

### 5.4 hs 장면 기반 클래스 [판독]

| 클래스 | 부모 | 쓰는 NRO | 역할 |
|---|---|---|---|
| `hs::SceneHsGameBase` | `bex::SceneGameBase` | hsmm01~07·hsmmet·op 가 직접 | 게임 공통: SyncBeginGame 에서 세이브/플레이어 데이터 동기(온라인), 메시지 속도 |
| `hs::SceneMiniGameBase` | `SceneHsGameBase` | hsmg 105 개 | 미니게임 흐름(5.5), UI(UIMGTelop×2, UIMGStatus, UIPause), MGSound |
| `hs::SceneBdGameBase` | `SceneHsGameBase` | hsbd01 | 보드. `RequestCallMiniGame @0x710010e868` = `MGList::GetNameFromID(GetMiniGameID())` 로 `RequestCallGame` |
| `hs::SceneHsFlowBase` | `bex::SceneGameBase` 계열(생성 `FUN_7100381668`) | hsmn00~09·ed | 메뉴·흐름 장면 |
| `sb::SceneMiniGameBase` | `hs::SceneMiniGameBase` | hsmg108·203·204·208·209·213·215·429·704·803·806·809 (NRO 안에 정적 포함) | `sb::Replay`(시드 저장·복원), `sb::Players<>`, `sb::Com<>` |
| `hsmm::HSMMSceneBase` | `SceneHsGameBase` | hsmm01~07·hsmmet (NRO 안에 정적 포함) | 미니게임 모드(마운틴) 공통, HSMM* 가상 추가 |

미니게임 hs 훅 연결(`hs::SceneMiniGameBase`): `BeginGame`→`OnBeginGame`(vt+0xC0), `LoadGame`→`OnLoadGame`(0xC8), `SetupGame`(UI 생성)→`OnSetupGame`(0xD0), `SyncSetupGame`(UIPause 생성)→`OnSyncSetup`(0xD8), `MainLoop`→5.5, `CleanupGame`→먼저 `OnCleanupGame`(0x188).

### 5.5 미니게임 흐름 `hs::SceneMiniGameBase::MainLoop @0x710008aa88` [판독]

```c
// 매 프레임 (장면 Update)
if (튜토리얼/인스트 객체 조건) { flag::On(2); state = max(state, 0x10); }
if (!+0x3A4) { vt+0x178 OnGameSequenceBefore; MGSound 갱신; }
next = HANDLER[state](this);          // 멤버 함수 포인터 표 @0x71014a78e8, 0~0x12
if (next != state) { state = next; sub(+0x2DC) = 0; }
if (!+0x3A4 && next < 0x11) vt+0x180 OnGameSequenceAfter;
if (state == 0x13 && 인스트 아님) { RequestExitGame(); return; }
UI 갱신(+0x388);
if (7 <= state <= 9 && 3분 타이머(+0x310) 만료) { vt+0x190 OnThreeMinTimerEnd; state = 10; return; }
if (state < 0x10 && 강제 종료 조건) { ...; RequestExitGame(); }
```

| 단계 | 처리기 | 부르는 훅(scene vt) | 다음 단계(주요) |
|---|---|---|---|
| 0 | `@0x710008ac38` | OnGameInit(0xE0) | 참: 4 (인스트 객체 있으면 2) |
| 1 | `@0x710008ac80` | OnGameTitle(0xE8) | 2 |
| 2 | `@0x710008aca8` | OnGameInstInit(0xF0) | 3 |
| 3 | `@0x710008acd0` | OnGameInstStart(0xF8) | 4 |
| 4 | `@0x710008ad48` | OnGameFirstFade(0x100), 페이드 인(0.23333 문턱) | 5 |
| 5 | `@0x710008aeac` | OnGameOpening(0x108), 오프닝 스킵 | 6 |
| 6 | `@0x710008af6c` | OnGameStartBefore(0x110), 페이드 | 7 |
| 7 | `@0x710008b0e8` | OnGameStart(0x118), 시작 텔롭(기반 UIMGTelop type 0)·카운트다운, 텔롭 끝에 호루라기, `UITimer::StartTimer`, `UIPause::Start` — 소리는 [04_sound_flow.md](04_sound_flow.md) 3절 | 8 |
| 8 | `@0x710008b99c` | OnGameStartAfter(0x120), `SysMiniGameMgr::PlayerCtrlStart` | 9 |
| 9 | `@0x710008bab4` | **OnGameMain(0x128)** 또는 승패 판정 → `PlayerCtrlEnd(1.0)` | 10 |
| 10 | `@0x710008bc68` | OnGameMainEnd(0x130), 라운드 수 +0x2D0++ | 11 / 8(다음 라운드) / 12 |
| 11 | `@0x710008bd28` | OnGameNextRound(0x138) | 12 |
| 12 | `@0x710008bd84` | OnGameFinish(0x140): 부속 0 FINISH 텔롭(type 2) Start·BGM 정지·`StopBatch_Type(7,1)`·타이머 정지, 1 텔롭 out 시작 → 대기 설정, 2 텔롭 끝·대기 0 → `MinigameUIControl(6)`(04_sound_flow 3절) | 대기 0xC / 인스트 0x10 / 13(게임 모드 4·5 → 0x12) |
| 13 | `@0x710008c694` | OnGameEndingBefore(0x148) | 14 |
| 14 | `@0x710008c724` | OnGameEnding(0x150) | 참: 15 |
| 15 | `@0x710008c74c` | OnGameEndingAfter(0x158) (미니게임 ID 0x61·0x62 이고 1인이면 별도 분기) | 대기 0xF / 진행 대상 [미확정] |
| 16 | `@0x710008c7f0` | OnGameLastFade(0x160), `UIRetryMenu` | 0x11 |
| 17 | `@0x710008cad0` | 종료/재도전: 재도전이면 SetupGame(0x80)·SyncSetupGame(0x88) 다시 → 0 | 0 / 0x11 / 0x13 |
| 18 | `@0x710008cc34` | OnGameEndingSkip(0x198) | 0x12 / 0x10 |
| 0x13 | (없음) | MainLoop 이 `RequestExitGame` | — |

- 단계 번호 체계와 "7~9 에서 3분 타이머 → 10" 은 mpj `MinigameFlow`와 같은 모양이다. 그러나 mpj 는 흐름이 **파이버**(FiberLite) 안에서 `Wait()`로 한 걸음씩 갔고, mps 는 **장면 Update 에서 직접** 한 걸음 간다 **[판독]**.
- 단계 10~16 의 세부 분기 조건(라운드제·인스트 모드·결과 UI)은 일부만 읽었다 **[미확정]**.

## 6. NRO 로딩 (SystemDll, `bex_system_dll.cpp`) [판독]

| 단계 | 함수 | 동작 |
|---|---|---|
| 초기화 | 무명 `@0x710030b4e8~0x710030b554` | `nn::ro::Initialize` → `sprintf("/.nrr/%s.nrr","hs")` → 파일 있으면 0x1000 정렬로 읽어 `nn::ro::RegisterModuleInfo` |
| 등록 | `FUN_710030b598(dll, key, name)` | 같은 이름 항목이 없으면 항목(+0x70 이름, +0x270 경로 `"/nro/NX_Release/%s.nro"`)을 만들고 파일을 0x1000 정렬로 읽어 +0x38 에 둔다(`FUN_71007af610`) |
| 로드 | `FUN_710030b7ac(dll, key, name, resident)` | 아직 안 실었으면 `nn::ro::GetBufferSize` → `bex::SystemHeap::Alloc(0x1000 정렬)` → `nn::ro::LoadModule(+0x48, image, bss, size, 1, …)`, 플래그 bit2. `resident`면 bit3 |
| 해제 | `FUN_710030bdd4` | bit3(상주) 아니면 `nn::ro::UnloadModule` + 버퍼 해제 |
| 제거 | `FUN_710030b8ec` | 파일 이미지 해제, 항목 삭제 |

- 호출은 모두 `SystemScene` 상태기계(5.1) 한 곳이다. 이름 인자는 장면 이름이다(`@0x710034b0e4~0x710034b14c` 디스어셈블). 그래서 **NRO 파일명 = 장면 이름**이다.
- 장면목록에 NRO 가 없는 행(hsbd00·hsbd02~05·hsbd10·hsbd99·test_*)은 장면으로 부르면 안 되는 행이다. 보드는 늘 `ChangeScene("hsbd01")`로 들어가고, 보드별 행은 아카이브 목록만 꺼내 미리 싣는다(main `FUN_71000282a4`, `analysis/decomp/main_board.c`) **[판독]**.
- `hs.nrr` 해시 126개 = NRO 126개 파일 SHA-256 전부 일치 **[실행]**.
- NRO 는 main 의 동적 심볼을 이름으로 링크한다. 각 NRO 도 `bex::Singleton<…>::pSingleton_` 를 약한 정의로 갖고 있다. 런타임에 어느 정의로 묶이는지는 rtld 순서에 달려 있다. main 이 먼저이므로 main 쪽으로 묶인다고 본다 **[추정]**.

## 7. 파이버

### 7.1 구조 [판독]

| 객체 | 크기·vtable | 필드 |
|---|---|---|
| `bex::Fiber` | 0x10, vtable `0x71014af248` | +8 = impl. vt+0x18 = `Run`(게임 클래스가 덮는다), +0x20 SetPauseLevel |
| impl (`FUN_71002e35dc`로 엔티티 생성) | 0xB0, vtable `0x71014af220` | +0x10 엔티티 핸들, +0x30 메시지 리스너, +0x38 스택, +0x40 스택 크기(기본 0x10000), +0x44 **sleep(f32)**, +0x48 nn::os::FiberType, +0x68 bit2 완료, +0xA0 소유 `bex::Fiber*`, +0xA8 정지 요청 |

생성 `bex::Fiber::Fiber(u32 tickOrder, const char* name) @0x710012fce8`:
- 엔티티 이름은 `name`, 없으면 "bex::SystemFiber.FiberBase"다.
- `TickOrder = tickOrder`다. `tickOrder ≥ GetTickOrderCount()`이면 2로 바꾼다.
- 엔티티 일시정지 단계는 1이다.
- 예: hsmg101 `FiberEnding`은 `Fiber(2, null)`이다.

### 7.2 매 틱 (impl vt+0x10 `@0x710012f9bc`) [판독, 디스어셈블리]

```c
if (stack == 0) { stack = AllocateMemory(size, 0x1000); InitializeFiber(...); }   // 첫 틱
if (completed) return;
if (sleep > 0) { sleep = fmaxf(sleep + (-1/60f /*0xBC888889*/), 0); return; }   // 이번 틱 재개 안 함
if (sleep < 0) return;                                                         // 영원히
current = owner; SwitchToFiber(fiber); current = null;                         // 재개
```

| 호출 | 동작 | 재개 |
|---|---|---|
| `Change()` `@0x710012fe98` | sleep 그대로(0) 양보 | **다음 틱** |
| `Sleep(t)` `@0x710012fee8` | sleep = t 후 양보 | 틱마다 1/60 을 빼 0 이 된 틱의 **다음 틱** |
| `SetSleepTime(t)` | sleep = t (양보 없음) | |
| `IsCompleted()` | 스택 있음 && +0x68 bit2 | |

재구현 계산(`web/tools/analysis/core_fiber_sleep.py`, f32): `Sleep(0)`=1틱, `Sleep(1/60)`=2틱, `Sleep(0.083333336)`=7틱, `Sleep(0.33333397)`=22틱, `Sleep(0.5)`=31틱, `Sleep(1.0)`=62틱, `Sleep(3.0)`=182틱 **[재구현 계산]**.

- mpj 와 다르다. mpj 는 `g_FrameStep.delta`를 빼고 남은 값이 ≤1.19e-5 이면 **그 틱에** 재개했다. mps 는 고정 상수 1/60 을 빼고 0으로 자른 뒤 **다음 틱**에 재개한다.
- 틱 호출 경로는 엔티티 메시지 리스너(`PTR 0x71014b0d70`)로 보인다 **[추정]**. 일시정지 단계와 엔진 PauseLevel 의 정지 규칙은 확인하지 못했다 **[미확정]**.

### 7.3 `bex::act::FiberMan` [미판독]

`bex::act::Man`/`FiberMan`/`Base`(Add/Erase/WaitProc/CalcTime/CalcTurn) export 는 있지만, 이번에는 읽지 않았다 **[미확정]**.

## 8. 난수 [판독 + 재구현 계산]

### 8.1 엔진·시드

| 엔진 | 주소 | mt[624] | index | seed |
|---|---|---|---|---|
| sync | `0x71015f70d8` | +0 | +0x9C0 (u64) | +0x9C8 |
| async | `0x71015f7ac8` | +0 | +0x9C0 | +0x9C8 |

| 시점 | 함수 | 시드 |
|---|---|---|
| 정적 초기화 | `@0x710019c200` | 두 엔진 모두 `nn::os::GetSystemTick()` 하위 32비트 |
| 온라인 장면 시작 | `bex::SceneGameBase::SyncBegin @0x7100391020` | 호스트 `Rand()`(async) → 전송 → 모두 `SetSyncRandSeed` |
| 리플레이 미니게임 12개 | `sb::Replay::LoadReplayData`/`StoreGameSettings`(예: hsmg108 `@0x710000fe1c`/`@0x7100010594`) | 저장해 둔 시드 복원 |
| Lua | `FUN_710025e76c` | 스크립트가 주는 값 |

- `SetSyncRandSeed`는 사운드 쪽 `FUN_7100466a1c`에도 시드를 넘긴다.
- **오프라인 장면에서는 시드를 다시 넣지 않는다.** 직전 장면까지 소비된 sync 상태가 이어진다. mpj 는 장면마다 `async.Rand()`로 다시 시드했다.

### 8.2 분포 (sync·async 같음)

| 함수 | 식 | 소비 없는 경우 |
|---|---|---|
| `Rand` | u | |
| `RandMod(n)` | libc++ `uniform_int(0,n−1)`(`@0x710019bfcc`): w = ⌈log2 n⌉, `u & (2^w−1)` 이 n 미만이 될 때까지 다시 뽑음 | n<2 → 0 |
| `RandRange(a,b)` | lo=min, hi=max(부호 없음), `uniform_int(lo, hi−1)` → [lo, hi) | hi−lo<2 → lo |
| `RandF` | `f32(u)·2⁻³² + 0` | |
| `RandModF(x)` | `f32(f32(u)·2⁻³² · x) + 0`(곱 반올림 후 덧셈) | x≤0 → 0 |
| `RandRangeF(a,b)` | lo/hi = f32 비교(gt)로 정렬, `f32(lo + f32(f32(hi−lo) · f32(u)·2⁻³²))` | |

- `f32(u)`는 ucvtf(가까운 짝수)다. u ≥ 0xFFFFFF80 이면 RandF 가 1.0 이 된다 → 구간 [0,1] **[재구현 계산 아님, 식 판독]**.
- 재구현 `web/tools/analysis/core_rand.py`의 MT 출력은 numpy MT19937 과 1,000개 일치했다 **[재구현 계산]**. 분포 함수는 판독 식 그대로 옮겼고 원본 실행 대조는 없다.
- 시험 벡터: `analysis/core/rand_vectors.json`(seed 12345).

### 8.3 NRO 사용 빈도 [데이터 `analysis/modules/main_function_usage.tsv`]

| 함수 | NRO 수(미니게임) |
|---|---|
| `SyncRandMod` | 90 (75) |
| `SyncRandRangeF` | 79 (70) |
| `SyncRandRange` | 54 (49) |
| `SyncRandF` | 42 (39) |
| `SyncRandModF` | 40 (39) |
| `SyncRand` | 18 (9) |
| `SetSyncRandSeed`/`GetSyncRandSeed` | 13 / 12 (리플레이 12 + hsbd01) |
| async `RandMod`·`RandF`·`RandRangeF`·`Rand` | 7·3·3·1 |

## 9. 웹 포팅 명세 (코어)

| 원본 | 웹 권장 이름(제안) | 구현 |
|---|---|---|
| `SystemMain` 프레임 | `Engine.frame()` | ① `dt = 1/60`(f32 `0x3C888889`, `Math.fround(1/60)`) ② 시스템 갱신 ③ 장면 상태기계 ④ 엔티티 틱(장면 Update → 파이버, 생성 순) |
| `bex::GetDeltaTime` | `time.dt` | 상수 `Math.fround(1/60)`. 누적은 매번 `Math.fround(acc + dt)` |
| `bex::Fiber` | `Fiber`(generator) | `yield`=Change. `sleep(t)`: `s=fround(t)`; 매 틱 `s>0` 이면 `s=max(fround(s - 1/60),0)` 후 대기, `s==0` 이면 재개 |
| `TimeCounter` | `TimeCounter` | 4.3 식, 감산값은 엔진 델타(=1/60 가정) |
| `bex::SyncRand*` | `SyncRand` | MT19937 + 8.2 식. **mpj 판 SyncRand 를 재사용하면 안 된다**(분포 다름) |
| `SystemScene` 상태 0~10 | `SceneManager` | 로드 대기·16+2 프레임 공백까지 재현할지는 웹 결정. 게임 논리에는 SyncBegin→…→SyncSetup 순서와 "Setup 다음 프레임부터 Update" 만 중요 |
| `MainLoop` 단계 표 | `MinigameFlow` | 5.5 표대로 한 프레임 한 걸음, 단계 바뀌면 `sub=0` |

검증 기대값(재구현 계산): Sleep 표(7.2), hsmg101 오프닝 대기(`acc += dt; acc > 3.0`) = **181 프레임**째 참(acc = 3.0166645).

## 10. 미확정

| 항목 | 필요한 근거 |
|---|---|
| 엔티티 틱 안의 순서(장면 Update vs 파이버, 같은 TickOrder) | Bezel `Engine` 엔티티 틱 함수 판독 |
| 엔진 델타 clamp(+0x20/+0x24)·timeScale(+0x28) 값 | 엔진 초기화(`boot.lua` → BezelEngineInitializer) 판독 |
| Lua 장면/스크립트가 SetFrameRate 를 부르는지 | Lua 바이트코드 디컴파일 |
| PauseLevel 정지 규칙(파이버 1, 장면 8, SetPause(4)) | `FUN_71006143d0`·엔진 틱 판독 |
| SystemMain +0xE0/+0xE8/+0x118 정체 | 생성자 typeinfo 판독 |
| `bex::act::FiberMan` | 판독 안 함 |
| 미니게임 단계 10~17 세부 분기 | 처리기 디컴파일 정독 |
