# 08. 이펙트 — VFXB v40 (nn::vfx2) 형식·런타임 (mps 판)

2026-10-05. 담당: vfx. 상태: **형식(EmitterData v40 배치) 판독 완료**, **입자 계산 CPU 경로 판독**, **hsmg402 웹 런타임 구현**(원본 수치 사용). 원본 실행 확인 없음. 웹 화면(헤드리스) 확인은 아직 안 했다(메인 스레드가 마지막에 1회).

확정 수준: **[판독]** main 명령·디컴파일 판독, **[데이터]** 데이터 값 확인, **[실행: 파서]** 우리 파서를 원본 파일 전체에 돌림, **[재구현 계산]** 판독 식을 다시 계산, **[추정]**, **[미확정]**. 원본 실행 확인은 이 문서에 없다.

주소는 SwitchLoader 기본 베이스 0x7100000000 기준 **main NSO** 주소다. 오프셋은 따로 적지 않으면 **EmitterData(EMTR 바이너리) 시작 기준**이다.

> **mpj(잼버리, VFXB v53) 문서와의 관계.** 섹션 체계·키표·LCG·방출 식의 골격은 같지만 **EmitterData 배치가 다르다**(v53 0x1100 B ↔ v40 0xB80 B, 샘플러 6 ↔ 3). mpj 의 오프셋([C:/dev/mpj/web/docs/engine/08_effects.md](C:/dev/mpj/web/docs/engine/08_effects.md) 4.3)을 그대로 쓰면 안 된다. mpj 는 입자 운동식을 셰이더라 미판독으로 두었는데, mps 는 **CPU 입자 갱신 함수(FUN_71009fe0e0)를 찾아 판독**했다(6.3).

관련 문서: [hsmg402.md 7.6](../minigame/hsmg402.md#76-이펙트-트리거--코드-데이터판독)(트리거 ↔ 코드), [web/docs/analysis/01 §2.12](../analysis/01_package_and_assets.md)(파일 위치·버전), [01_core.md](01_core.md)(고정 60 프레임).

---

## 1. 기능 개요와 사용자에게 보이는 동작

hsmg402(데굴데굴 눈덩이)에서 보이는 파티클:

| 화면 | FX 트리거 | 이미터셋 | 언제 |
|---|---|---|---|
| 무대 눈보라(먼·중간·가까운 층 + 반짝이는 큰 눈송이), 얼음판 위 반짝임, 배경 별(무작위 4색), 가끔 지나가는 유성(꼬리) | `INITIALIZE`(대상 `field`) | `hsmg402_map_snow00`(13)·`map_field00`·`map_star00`(3)·`map_star01`(유성 + 자식) | 장면 시작부터 상시 |
| 눈덩이가 생길 때 노란 고리 + 빛 | `SNOWBALL_APPEAR00` | `hsmg402_snowball_appear00` | 공 생성 직후 1회 |
| 최대 크기 도달: 큰 고리·빛 + 공 둘레 반짝이(지속) | `SNOWBALL_MAX00` | `hsmg402_snowball_max00` | 레벨 7 도달 ~ 정지 |
| 손에 든 공이 구를 때 땅의 눈가루 | `SNOWBALL_MOVE0{0,1,2}` | `…move00/01/02` | 움직이는 동안(00 은 45프레임, 01·02 는 18프레임 뒤부터) |
| 던진 공이 구르며 남기는 눈가루 꼬리 | `SNOWBALL_THROW0{0,1,2}` | `…throw00/01/02` | 던질 때 ~ 정지(연속 방출, 월드에 남음) |
| 공이 떨어질 때 눈덩이 부스러기 | `SNOWBALL_FALL00` | `…fall00`(kotai) | 낙하 시작 |
| 공이 부서질 때 눈 조각 | `SNOWBALL_BREAK0{0,1,2}`(break 모델) | `…break00/01/02` | 부서짐 |
| 캐릭터가 눈덩이를 만들 때 양손 쪽 눈가루·연기 | `SNOW_MAKE00`(모션 `sb_make00` 4f) | `fx_pc_snow_make00`(hs_system) | 모션 이벤트 |
| 캐릭터 발밑 찬 김 | `SNOW_BREATH00`(모션 `sb_idle00/01`) | `fx_pc_snow_breath00` | 모션 이벤트 |
| 캐릭터가 떨어질 때 눈 부스러기 | `SNOW_FALL00`(코드) | `fx_pc_snow_fall00` | `ActionEX8`, 수평거리 ≤ 11.5 |

---

## 2. 분석 대상 원본·버전·자료 위치

| 항목 | 위치 |
|---|---|
| 이펙트 바이너리 | 장면 아카이브 `<장면>/effect/effect.xml`(VFXB, 125개 전부 **vfx 40**, gfxApi 0x400). hsmg402: `extracted/bea/hsmg402.nx.bea/mg/hsmg402/effect/effect.xml`(1.47 MB, 이미터셋 16), 캐릭터 공용: `extracted/bea/hs_system.nx.bea/hs_system/effect/effect.xml`(이미터셋 160) |
| 셰이더 | **파일 안 `GRSN` 섹션**(mpj 는 `.bnsh` 따로) — 판독하지 않았다 |
| FX 트리거 | 장면 `ftrg/fx_hsmg402_{fld,snowball,snowball_break}.ftrg`, 캐릭터 공용 `hs_system.nx.bea/chara/pc/ftrgBase/ftrg/fx_pc_base.ftrg`, 캐릭터별 `chara/pc/pcNN_*/ftrg/fx_pcNN_*.ftrg` |
| 파서 | `web/tools/analysis/effect_vfxb.py`(tree/dump/check/find, **V40 표 추가**) |
| 판독 도구 | `web/tools/analysis/vfx40_scan.py`(즉치 오프셋 접근 함수 찾기, capstone), `web/tools/analysis/vfx_ghidra.sh`(Ghidra 복사본 `ghidra_work/vfx/` 에 CoreTool) |
| 디컴파일 | `analysis/decomp/vfx40_calc.c`(최대 입자 수·이미터 갱신·입자 초기값), `vfx40_emit.c`·`vfx40_emit2.c`(방출 간격), `vfx40_cpu.c`(CPU 입자 갱신), `vfx40_field.c`·`vfx40_field2.c`·`vfx40_noise.c`(필드), `vfx40_sub.c`(하위 섹션 등록), `vfx40_color.c`·`vfx40_key.c`(색 키), `vfx40_got.c`·`vfx40_dat.c`·`vfx40_quad.c` |
| 덤프 | `extracted/converted/hsmg402/effect/vfxb.json`(v40 배치로 다시 만듦), `extracted/converted/effect/hs_system/`(vfxb.json + tex 116), `extracted/converted/effect/hsmg101/`(다시 만듦) |
| 웹 | 런타임 `web/script/view/vfx.ts`, hsmg402 연결 `web/script/games/hsmg402/view/effects.ts` + `view/index.ts` 사건 처리, 자료 `web/assets/hsmg402/effect/sets.json` + png 12, 검사 `web/tools/check_vfx.ts` |
| 참고 | EffectLibrary(`tools/oss/EffectLibrary`, v40 분기 있으나 mps 와 안 맞음 — 4.3 끝), mpj 08_effects.md(읽기만) |

---

## 3. 진입점과 전체 호출 흐름

### 3.1 계층 [판독: 함수 이름·호출]

```
FX 트리거(ftrg 0x9101: 이름 +14, 대상 노드 +34, 이펙트 파일 +3c, 이미터셋 +50[0x9105 +00 "x.eset"])
  └ 모델에 붙은 트리거 재생/정지(hs::HsModel::*VFXFxTrigger @0x7100064c30~) — 장면 코드는 트리거 이름만 부른다(hsmg402.md 7.6)
      └ nn::bezel::ParticleFx2Emitter(@0x7100559c50~ Stop/IsValid/SetEmitterMultiplyColor…)
          └ nn::vfx2 (심볼 없음, main 0x71009e0000~0x7100a10000)
              FUN_71009f60d4  이미터 1프레임 갱신(방출 창·페이드·자식·입자 계산 호출, 시간 +dt)
              FUN_71009f5788  방출 간격(타이머·누적·LCG)
              FUN_71009f7f38 → FUN_71009f82a4  입자 k 개 만들기(볼륨 표본·속도·크기·수명)
              FUN_71009fe0e0  CPU 입자 갱신(이동·공기저항·중력·필드)
              FUN_71009e8920 / FUN_7100a08518  최대 입자 수(버퍼 크기)
              FUN_71009f4ed8  EMTR 하위 섹션(FRND·FSPN·EA**·CSDP…)을 리소스 칸에 등록
              FUN_71009f36f8  이미터 상수 → GPU 상수 버퍼(색 타입·텍스처·필드)
              FUN_71009febb0 / FUN_71009ff51c  색0/알파0, 색1/알파1 키 계산(CPU 경로)
              FUN_71009fc110  키 보간
```

- 이 판의 bex 이펙트 층(`bex::Effect2Mgr`, `bex::SystemEffect2` @0x710012ee58·0x71002de6b8)은 이름만 확인했다. mpj 의 `bex::Effect`(Create/Setup/Start/SetPosition) 판독을 그대로 옮길 수 없다 [미확정].
- hsmg402 장면 코드는 이펙트를 직접 만들지 않고 **FX 트리거 이름**을 부른다(`SNOWBALL_*`, `SNOW_FALL00`, 무대 `INITIALIZE`) [판독: hsmg402.md 7.6].

### 3.2 한 프레임 안 이미터 갱신 순서 FUN_71009f60d4 [판독]

1. 시간 `t = inst+0x44`, 시작 `start(+0x87C)`, 끝 `start + duration(+0x884)`. 자식이면 시작 = 부모 입자 수명 × `timing(+0x880)`/100.
2. 이미터 애니(EA**) 값 갱신 → allDirection·크기·볼륨 배율 캐시(inst+0x7AC, +0x7C4~, +0x7D0~).
3. 페이드 인(`+0x7D9/+0x7DA` 이면 inst+0x70 += dt/fadeInTime(+0x7EC)), 정지 중이면 페이드 아웃(`+0x7DB/+0x7DC` 이면 inst+0x6C −= dt/alphaFadeTime(+0x7E8), 0 이하 → 이미터 끝).
4. 수명이 다한 입자 정리(링 버퍼 머리 이동).
5. 방출: `start ≤ t` 이고 (one-time 이면 `t < start+duration` 이거나 아직 한 번도 안 냈으면) FUN_71009f5788.
6. calcType 0(CPU) 또는 2(GPU+SO, 조건부)면 CPU 입자 계산 FUN_71009f6b00 → FUN_71009fe0e0.
7. `t += dt`.

---

## 4. 구조체·필드·상수·열거형

### 4.1 파일·섹션 [실행: 파서]

mpj 08 4.1·4.2 와 같다(헤더 0x40, 섹션 헤더 0x20, ESTA/ESET/EMTR/GRTF/GTNT/PRMA/TRMA/G3PR/G3NT). 다른 점:

| 항목 | v40 (mps) |
|---|---|
| 버전 | 헤더 +0x0A = **40** (125 파일 전부) |
| 셰이더 | **`GRSN` 섹션이 파일 안에 있다**(hsmg402 0x76128 B) |
| `ESFT` | 없음(hsmg402·hs_system) |
| ESET 바이너리 | 16 B(0) + 이름 char[64] + u32×10 (첫 칸 = 이미터 수(자식 포함)) |
| EMTR 바이너리 | **EmitterData 0xB80 B**(3,674/3,674), 뒤에 하위 섹션 체인(attr) |

### 4.2 EmitterData v40 (0xB80 B) 블록 [실행: 파서][판독·데이터: 표시]

| 오프셋 | 크기 | 블록 | 근거 |
|---|---|---|---|
| 0x000 | 0x10 | flag, randomSeed, pad×2 | P |
| 0x010 | 0x40 | 이름 char[64] | P(이름 깨짐 0) |
| 0x050 | 0x780 | **Static**(4.3) | D(키 개수↔키표, 아래) |
| 0x7D0 | 0x88 | **EmitterInfo** | C(+0x7D2·+0x7D3·+0x7D8~+0x7DC·+0x7E8·+0x7EC) |
| 0x858 | 0x20 | **Inherit**: u8×16, u32 +0x868, **u8 +0x86C**, velocityRate +0x870, scaleRate +0x874 | C(+0x86C) D |
| 0x878 | 0x48 | **Emission** | C |
| 0x8C0 | 0x60 | **Shape**(v39 처럼 끝 8 B 포함) | C |
| 0x920 | 0x10 | **Render** | C(+0x923) D |
| 0x930 | 0x50 | **Particle**(루프 비율 i32×5, v50 미만 꼴) | C |
| 0x980 | 0x10 | 키 보간 방식 u8(+0x980 color0, +0x981 alpha0 …) + 컴바이너 추정 | C(+0x980/+0x981) |
| 0x990 | 0x80 | **ShaderRef**(정의 문자열 +0x9F0) | C(+0x994/+0x998) D |
| 0xA10 | 0x04 | actionIndex | D(≠0 ⇔ CADP 126/126) |
| 0xA14 | 0x30 | **Velocity** | C |
| 0xA44 | 0x10 | f32×4 (100,0,0,0 흔함, +0xA44 를 방출 속도 상속 쪽에서 읽음) | C(읽기만) |
| 0xA54 | 0x2C | **Color**(타입 4 + 색0·알파0·색1·알파1) | C |
| 0xA80 | 0x24 | **Scale** | C |
| 0xAA4 | 0x0C | Fluctuation u8×8 + u32 | P |
| 0xAB0 | 0x60 | **Sampler ×3**(각 0x20: textureID u64, wrapU, wrapV, filter, sphere, maxLOD, lodBias, u8×4, u8×4, u32) | C(+0xAB0) P(ID 4,190/4,190) |
| 0xB10 | 0x30 | **TexAnim ×3**(각 0x10) | C(+0xB10) |
| 0xB40 | 0x40 | reserved | P |

### 4.3 필드 표 (확정 수준: C=판독, D=데이터, P=전수 파서 통과, E=추정)

| 오프셋 | 타입 | 이름(EffectLibrary 이름, 원본 심볼 아님) | 뜻·근거 |
|---|---|---|---|
| 0x060~0x074 | u32×6 | numColor0/Alpha0/Color1/Alpha1/Scale/ParamKeys | D: 키표 18,370개 모두 유효 키 수와 일치(시간 단조·꼬리 0). C: FUN_71009febb0 이 static+0x10/+0x14 를 키 수로 읽음 |
| 0x080~0x0A7 | f32×10 | color0..scale LoopRate/LoopRandom | P(hsmg402 전부 0) |
| 0x0B0 | f32×3 | gravityDir | D (0,−1,0) |
| 0x0BC | f32 | gravityScale | D(=emission +0x89C 와 같음) |
| 0x0C0 | f32 | **airRes** | C: CPU 갱신이 static+0x70 을 `powf(air, dt)` 로 씀 |
| 0x0D0~0x10F | f32×16 | center·offset·amplitude·cycle·phaseRnd·phaseInit·coefficient | P. +0xE0 amplitudeX, +0xE8 cycleX, +0xF0 phaseRndX 로 보면 Fluctuation 값과 맞는다 E |
| 0x110 | 0x90×3 | TexPatAnim: num, frequency, numRandom, pad, table i32×32 | D: 무작위 패턴(4)이면 numRandom = 아틀라스 칸 수(snow01 4×2 → 8) |
| 0x2C0 | 0x50×3 | TexScrollAnim(…, +0x48/+0x4C = **칸 나눔 U·V**) | D: snow01 = (4,2), 나머지 (1,1) |
| 0x3B0 | f32 | **colorScale** | D(0.37~6.0) |
| 0x3C0/0x440/0x4C0/0x540 | 8×{x,y,z,t} | **color0 / alpha0 / color1 / alpha1 키표** | C: static+0x370/+0x3F0 를 키표로 읽음 |
| 0x5C0 | f32×16 | softEdge·fresnel·near/far alpha·decal·alphaThreshold·addVelToScale·softParticle | P |
| 0x600 / 0x680 | 키표 | **scale 키**, param 키 | D |
| 0x700 | f32×16 | unknown6 (v40 에 있음, 라이브러리는 v41+) | P(전부 0) |
| 0x740 | f32×20 | rotateInit xyz·Rand xyz·**rotateAdd xyz(+0x760)**·rotateRegist(+0x76C)·addRand·scaleLimitDistNear/Far(+0x780 50, +0x784 100) | D: 눈송이 rotateInitRand Z = 2π |
| 0x790 | f32×16 | unknown7 (1/6×3, 60×3 흔함) | P |
| 0x7D0 | u8 | isParticleDraw | D |
| 0x7D1 | u8 | sortType | C(읽기) |
| 0x7D2 | u8 | **calcType** 0 CPU / 1 GPU / 2 GPU+스트림아웃 | C: 2 면 computeShaderIndex(+0x998) ≠ −1 (181/181) D |
| 0x7D3 | u8 | **followType** 0 / 1 / 2 | C: ≠0 이면 입자마다 행렬을 저장(FUN_71009f82a4), 1 이면 중력을 그 행렬로 돌림. 이름 0=전부·1=안 따라감·2=위치만 E |
| 0x7D8 | u8 | **isFadeEmit**: 정지 요청 때 방출을 멈춤 | C: `param_5 &= (+0x7D8 == 0)` |
| 0x7D9/0x7DA | u8 | 페이드 인(알파/크기 E) | C: fadeInTime(+0x7EC) 로 inst+0x70 증가 |
| 0x7DB/0x7DC | u8 | 페이드 아웃(알파/크기 E) | C: 정지 중 alphaFadeTime(+0x7E8) 로 inst+0x6C 감소, ≤1.19e-7 이면 이미터 끝 |
| 0x7E0/0x7E4 | u32 | randomSeed, drawPath | P |
| 0x7F0~0x84B | f32 | 이미터 trans xyz, transRand, rotate xyz(라디안), rotateRand, scale xyz, color0 rgba, color1 rgba | D: 별 (0,−40,−115) rot X 90° scale (100,1,14) |
| 0x86C | u8 | 자식 방출 방식 | C: 자식인데 0 이면 최대 입자 수 × 부모 수, ≠0 이면 시작을 부모 시간 기준 |
| 0x878 | bool | **isOneTime** | C |
| 0x879 | bool | isWorldGravity | C(CPU 갱신 분기) |
| 0x87A | bool | isEmitDistEnabled(거리 방출) | C(+0x8AC~+0x8BC 와 함께) |
| 0x87B | bool | isWorldOrientedVelocity | C |
| 0x87C | u32 | **start**(프레임) | C |
| 0x880 | u32 | **timing**(자식: 부모 수명 %) | C |
| 0x884 | u32 | **duration** | C |
| 0x888 | f32 | **rate** | C |
| 0x88C | i32 | **rateRandom**(정수 %) | C |
| 0x890 | i32 | **interval**(간격 − 1) | C |
| 0x894 | i32 | **intervalRandom** | C: `+ (u32 × r) >> 32` |
| 0x898 | f32 | **positionRandom** | C: 랜덤 단위벡터 표 × 이 값 |
| 0x89C / 0x8A0 | f32 / f32×3 | **중력 크기 / 방향**(CPU 갱신이 쓰는 쪽) | C |
| 0x8AC~0x8BC | f32×4, i32 | emitterDist unit/min/max/margin, particlesMax | C |
| 0x8C0 | u8 | **volumeType** | C: 함수 표 `PTR_LAB_710155f028[volumeType]` |
| 0x8C1~0x8C7 | u8 | sweepStartRandom, arcType, isVolumeLatitudeEnabled, tblIndex, tblIndex64, latitudeDir, isGpuEmitter | P |
| 0x8C8/0x8CC/0x8D0 | f32 | sweepLongitude, sweepLatitude, sweepStart | D(2π, π, 0) |
| 0x8D4/0x8D8 | f32 | volumeSurfacePosRand, caliberRatio | P |
| 0x8DC/0x8E0 | f32 | lineCenter, lineLength | P |
| 0x8E4 / 0x8F0 | f32×3 | **volumeRadius / volumeFormScale** | C(+0x8F0 × 세트 배율) D |
| 0x8FC | i32 | **primEmitType** — 0 이면 분할 볼륨에서 방출 수 × 분할 수 | C(FUN_71009e8920·FUN_71009e9530) |
| 0x900 | u64 | primitiveIndex | P |
| 0x908/0x90C/0x910/0x914 | i32 | **numDivideCircle**, …Random, **numDivideLine**, …Random | C |
| 0x920~0x923 | u8 | isBlendEnable, **isDepthTest**, depthFunc, isDepthMask | C(+0x923) D(010300 2,590) |
| 0x924~0x927 | u8 | isAlphaTest, alphaFunc, **blendType**(+0x926), displaySide | D |
| 0x928 | f32 | alphaThreshold | P |
| 0x930 | bool | **infiniteLife** | C: 수명 2.6843546e8 |
| 0x932 | u8 | **billboardType** | D(hsmg402 전부 0) |
| 0x933/0x934 | u8 | rotType, offsetType | P |
| 0x935~0x93A | u8 | rotRevRand xyz, isRotate xyz | D: 회전하는 눈송이만 isRotateZ 1 |
| 0x940 | i32 | **life**(프레임) | C |
| 0x944 | i32 | **lifeRandom**(정수 %) | C: `life·(1 − floor(u·r)/100)` |
| 0x948 | f32 | **momentumRandom** | C: 운동량 = `1 + m − 2m·u` |
| 0x950/0x958 | u64 | primitiveID / ExID | P(417/417 G3NT 에 있음) |
| 0x960~0x969 | bool×10 | loopColor0, loopAlpha0, loopColor1, loopAlpha1, scaleLoop, loopRandom×5 | C(+0x960/+0x961/+0x965/+0x966) |
| 0x96C~0x97C | i32×5 | color0/alpha0/color1/alpha1/scale LoopRate | C(+0x96C/+0x970) |
| 0x980/0x981 | u8 | **color0/alpha0 키 보간**(0 선형, 1 계단) | C(FUN_71009fc110 6번째 인자) |
| 0x994 | i32 | **shaderIndex** | C(FUN_71009f3508) |
| 0x998 | i32 | **computeShaderIndex** | C, D(calcType 2 ⇔ ≠ −1) |
| 0x99C/0x9A0 | i32 | userShaderIndex1/2 | P |
| 0x9A4 | i32 | customShaderIndex | D: 1 ⇔ CSDP 하위 섹션(1,156/1,156) |
| 0x9E8/0x9EC | i32/u32 | ? (−1 또는 작은 수) | P [미확정] |
| 0x9F0 / 0xA00 | char[16] | userShaderDefine(예 "DEPTH_ONLY") | D(28개) |
| 0xA10 | u32 | actionIndex | D(CADP) |
| 0xA14 | f32 | **allDirection** | C(× 세트 속도 배율) |
| 0xA18 | f32 | **designatedDirScale** | C |
| 0xA1C | f32×3 | **designatedDir** | C |
| 0xA28 | f32 | **diffusionDirAngle**(도) | C: `1 − angle/90` |
| 0xA2C | f32 | xzDiffusion | C(읽기) |
| 0xA30 | f32×3 | **diffusion** xyz | C: 랜덤 단위벡터 ⊙ 이 값 |
| 0xA3C | f32 | **velRandom**(%) | C |
| 0xA40 | f32 | emVelInherit | C |
| 0xA5C~0xA5F | u8×4 | **color0Type, color1Type, alpha0Type, alpha1Type** | C(FUN_71009febb0: +0xA5C/+0xA5E 쌍, FUN_71009ff51c: +0xA5D/+0xA5F) |
| 0xA60 | f32×4 | color0 rgb + **alpha0** | C |
| 0xA70 | f32×4 | color1 rgb + alpha1 | C |
| 0xA80 / 0xA8C | f32×3 | **scale / scaleRandom(%)** | C: X·Y 랜덤 같으면 난수 하나 |
| 0xA98 | u8×4 | scaling by camera dist 등 | P |
| 0xA9C/0xAA0 | f32 | scaleMin/Max(50, 100 흔함) | P |
| 0xAA4 | u8×8 | isApplyAlpha, isApplyScale, isApplyScaleY, (8), phaseRandomX/Y … | D(반짝이만 alpha/scale 1) E(바이트 뜻) |
| 0xAB0 | u64 | **sampler0 textureID** | C, P |
| 0xAB8/0xAB9 | u8 | **wrapU/V**(0 Mirror, 1 Repeat, 2 Clamp) | D |
| 0xB10 | u8 | **patternAnimType**(0 없음, 1 수명맞춤, 2 클램프, 3 루프, 4 무작위 — eft 이름 E) | C(읽기) D |
| 0xB14 | u8 | repeat(0 1×1, 1 2×1, 2 1×2, 3 2×2) | D(mpj 4.4) E |

**EffectLibrary 와의 차이(오프셋 밀림의 원인)**: 라이브러리의 v40 분기는 이름을 96 B 로 읽고 unknown6·unknown7·Inherit 의 u64·ShaderRef 확장·Action 꼴을 v41+ 로 둔다. 실제 v40 = 이름 64 B(v39 꼴) + unknown6/7·+0x868 칸·0x80 B ShaderRef·4 B Action(v41+ 꼴 일부) 섞임 [실행: 파서].

### 4.4 열거형 (hsmg402 에서 쓰는 값)

| 필드 | 값 | 근거 |
|---|---|---|
| volumeType | 0 Point, 2 CircleDiv(이동 꼬리 220°·10 분할), 3 CircleFill(얼음판 반짝임 r 8.5, 별 원판), 4 Sphere(MAX 반짝이 r 1.1), 6 SphereDiv64(MAX 시작 반짝이), 7 SphereFill(부서짐·낙하 반구), 11 BoxFill(눈보라 30×10 판) | 이름 순서 mpj 4.4 E, 2·13 은 C |
| blendType | 0 알파(눈 조각), 1 가산(고리·빛·눈보라·별) | D(눈 조각 0, 빛나는 것 1) E(식) |
| followType | 0 눈보라·별, 1 낙하 조각·던진 꼬리·입김, 2 고리·반짝이·이동 꼬리 | C(분기) E(뜻) |
| calcType | 0 유성 부모(Emitter1), 1 대부분, 2 눈보라 층(FRND·FSPN) | D |
| color0Type | 0 상수, 2 키, **3 키 중 무작위**(별 4색) | C |

### 4.5 하위 섹션(attr 체인) — 리소스 칸 등록 FUN_71009f4ed8 [판독]

| magic | 리소스 칸(이미터 계산 리소스 기준) | 뜻 |
|---|---|---|
| EAES / EAER / **EAET** | +0x298 / +0x2A0 / +0x2A8 | 이미터 배율/회전/**이동** 애니(있으면 행렬 갱신 표지 +1·+2 = 1) |
| EAC0 / EAC1 / EAA0 / EAA1 | +0x2B0 / +0x2B8 / +0x2D0 / +0x2D8 | 이미터 색0·색1·알파0·알파1 |
| EATR / EAPL / EAOV / EADV / EASL / EASS / EAGV | +0x2C0 / +0x2C8 / +0x2E0 / +0x2E8 / +0x2F0 / +0x2F8 / +0x300 | 방출률 / 수명 / allDirection(+0x2E0 → +0xA14 곱 C) / 지정속도 / ? / 입자 크기(+0x2F8 → 크기 곱 C) / 중력 |
| FRND / FRN1 / FMAG / FSPN / FCOL / FCOV / FPAD / FCLN / FGWD / FCSF | +0x248 / +0x250 / +0x258 / +0x260 / +0x268 / +0x270 / +0x278 / +0x280 / +0x288 / +0x290 | 필드(있으면 +3 = 1) |
| CSDP / CADP / CUDP | +0x308(+크기) / +0x318 / +0x320 | 커스텀 셰이더·액션·유저 데이터 |
| EP01~EP04 | +0x348, 종류 +0x340 = 1~4 | 방출 플러그인 |

- EA** 공통: `{u8 enable, loop, randomStart, pad; u32 keyCount; u32 loopCount; {x,y,z,t}×n}`(mpj 와 같음). hsmg402 `kotai` 의 EAET = (0,−0.6,0)@0 → (0,−0.8,0)@106. t 단위는 프레임 E.
- **FRND**(0xD4 B) [판독 FUN_71009fc704·FUN_7100a00900]: +0 바이트 [0] 방식(0), [1] 사용자 표 사용, [2] 공기저항 시간 변환; +4 f32×3 **진폭**; +0x10 i32 **주기 I**(1000); +0x14/+0x18 방식 1 의 값; +0x1C f32×4 진폭 표(4,3,2,1.5); +0x2C f32×4 주기 표(0.6,0.42,0.23,0.15); +0x3C 진폭 키 애니 사용.
- **FSPN**(0x13C B) [판독 FUN_71009fced8]: +0 f32 **회전 속도**(rad/프레임), +4 u32 **축**(0 X, 1 Y, 2 Z), +8 f32 바깥 확산 속도, +0xC 애니 사용.

### 4.6 이미터 인스턴스(런타임) 칸 [판독 — 웹 구현에 필요한 것만]

| inst+ | 내용 | writer / reader |
|---|---|---|
| +0x01 | 한 번이라도 방출함 | FUN_71009f7f38(인자로 &inst[1]) / FUN_71009f5788·FUN_71009f60d4 |
| +0x44 | 이미터 시간(프레임) | FUN_71009f60d4 끝에서 += dt |
| +0x48 | 이번 dt | FUN_71009f60d4 |
| +0x50 / +0x54 / +0x58 | 방출 타이머 / 누적 / 간격 — **초기값 타이머 = 간격 = interval+1** | FUN_71009e732c(초기화 @0x71009e7648) / FUN_71009f5788 |
| +0x5C / +0x60 / +0x68 | 방출률·간격·수명 배율 | 세트 API |
| +0x6C / +0x70 | 페이드 아웃 / 인 계수 | FUN_71009f60d4 |
| +0x98 | EmitterData 포인터 | — |
| +0xA4 | **LCG 상태** `x·0x41C64E6D + 0x3039` | 방출·입자 초기화 |
| +0x238 | 이미터 계산 리소스(+0x10 EmitterData, +0x248~ 필드, +0x298~ 애니, +0x420 수명 최대) | FUN_71009f4ed8 |
| +0x78 | 이미터셋 인스턴스(+0x100~ 볼륨 배율, +0x150~ 입자 크기 배율, +0x208 속도 배율, +0x6C 방출률 배율, +0x70 간격 배율, +0x74 수명 배율) | 세트 API |

---

## 5. 상태 전이와 전체 수명

```
트리거 재생 → 이미터셋 생성(이미터마다 타이머 = 간격 = interval+1, 시간 0)
매 프레임: 이미터 갱신(3.2) → 방출 창 안이면 방출 → 입자 계산 → 시간 +1
트리거 _Stop → 이미터 정지 표지
   isFadeEmit(+0x7D8) 이면 방출 중단(hsmg402 전부 1)
   페이드 아웃 플래그(+0x7DB/+0x7DC) 면 alphaFadeTime 동안 계수 1→0, 0 되면 이미터 삭제(남은 입자도)
   아니면 남은 입자가 수명대로 사라짐
one-time 이미터: start+duration 지나면 방출 끝 → 입자 다 사라지면 이미터 끝 [판독: 창][추정: 세트 자동 삭제 시점]
```

hsmg402 의 정지 규칙은 로직 사건을 따른다(hsmg402.md 7.6): MOVE 는 멈추면·단계가 바뀌면 `_Stop`, MAX00 은 낙하 삭제·부서짐·비활성 때, THROW 는 공이 낙하·부서질 때. 공이 지워지면(state −1) 웹은 붙은 이펙트를 `Stop` 한다 [추정: 모델 삭제 때 트리거 정지].

---

## 6. 계산식·조건·상세 의사코드

### 6.1 방출 [판독: FUN_71009f60d4·FUN_71009f5788·FUN_71009e904c]

```ts
// 이미터 시간 t(프레임). 1프레임 = dt 1 (고정 60, 01_core.md)
window = t >= start && (!isOneTime || t < start + duration || !emitted) && !(stopped && isFadeEmit)
if (window) {
  if (timer >= step) {
    n = floor(timer / step); rem = timer - n * step
    sum = Σ_{n번} rate * (100 - (divided ? 0 : rateRandom) * u) / 100   // u = LCG / 2^32
    if (!emitted && sum <= 1) sum = 1                                   // 첫 방출 최소 1개
    accum += sum; k = floor(accum)
    if (k > 0) { emit(k × (divided ? numDivide : 1)); accum -= k; emitted = true
                 step = interval + 1 + floor(u * intervalRandom) }      // × 간격 배율(1)
    timer = rem
  }
  timer += isOneTime ? clamp(start + duration - (t + 1), 0, 1) : 1
}
divided = volumeType ∈ {2,5,6,13} && primEmitType == 0                  // FUN_71009e9530
```

hsmg402 방출 일정 [재구현 계산: 위 식, `web/tools/check_vfx.ts` 로 확인]:

| 이미터 | one-time | start/duration | interval→간격 | rate | 방출 프레임 | 합계 |
|---|---|---|---|---|---|---|
| appear·max `ring00a` | ✓ | 1/6 | 3→4 | 1 | 1, 5 | 2 |
| appear·max `circle00a` | ✓ | 1/1 | 3→4 | 1 | 1 | 1 |
| max `twinkle00_start` | ✓ | 0/20 | 0→1 | 1 | 0~19 | 20 |
| max `twinkle00_Copy1` | 연속 | 0 | 0→1 | 2 | 매 프레임 2 | 정지까지 |
| break00 / 01 / 02 `snow_solid00` | ✓ | 1/5 | 1→2 / 0→1 / 0→1 | 1 / 7 / 15 | 1,3,5 / 1~5 / 1~5 | 3 / 35 / 75 |
| fall00 `kotai` | ✓ | 1/25 | 0→1 | 2 | 1~25 | 50 |
| move00 / 01·02 | 연속 | 45 / 18 | 0→1 | 2 | 45~ / 18~ 매 프레임 | 정지까지 |
| throw00·01 / 02 | 연속 | 1 | 0→1 | 1 / 2 | 1~ | 정지까지 |
| make00 L·R / tubu / smoke | ✓ | 1/10 / 1/10 / 1/1 | 0 / 0 / 29 | 3 / 1 / 1 | 1~10 / 1~10 / 1 | 30 / 10 / 1 |
| breath00 | ✓ | 1/1 | 29 | 1 | 1 | 1 |
| 눈보라 far/middle/near(+glare) | 연속 | 0 | 8/5/3 (26/17/11) | 1 | 9/6/4(27/18/12)프레임마다 | 상시 |
| 눈보라 start 3종 / near_near | ✓ | 0/1 | — | 100·100·200 / 240 | 0 | 640 |
| near_near2 | 연속 | **180** | 1→2 | 1 | 180~ 2프레임마다 | 상시 |
| 별 star_a/b/c | ✓ 무한 수명 | 0/1 | 0 | 20·30·20 | 0 | 70(평생) |
| 유성 Emitter1 / 자식 Emitter2 | 연속 | 0 | 299→300 / 0 | 1 / 1 | 300프레임마다 / 부모 입자마다 매 프레임 | 상시 |

### 6.2 입자 초기값 [판독: FUN_71009f82a4, 볼륨 표본 식만 추정]

```ts
(pos, nrm) = volumeSample(volumeType)          // 함수 표 PTR_LAB_710155f028[volumeType]. 각도 기준·분포는 [추정]
pos += randUnit() * positionRandom              // 단위벡터 표 DAT_71016402b8
v  = nrm * allDirection
v += (diffusionDirAngle == 0) ? normalize(designatedDir) * designatedDirScale
                              : cone(designatedDir, cosMin = 1 - angle/90) * designatedDirScale
v *= 1 - u * velRandom / 100
v += randUnit() ⊙ diffusion                     // 단위벡터 표 DAT_71016402b0
if (scaleRandomX == scaleRandomY) { f = 1 - u*scaleRandomX/100; sx = scaleX*f; sy = scaleY*f }
else { sx = scaleX*(1 - u*rX/100); sy = scaleY*(1 - u*rY/100) }
momentum = 1 + m - 2*m*u                        // m = momentumRandom
life = infiniteLife ? 2.6843546e8 : life * (1 - floor(u * lifeRandom) / 100)
colorKey = floor(u * numColor0Keys)             // color0Type 3 일 때
followType != 0 → 입자에 지금 이미터 행렬을 저장
```

### 6.3 CPU 입자 갱신 FUN_71009fe0e0 [판독]

```ts
// 매 프레임, 입자 로컬(이미터) 좌표
pos += vel * (dt * momentum)
if (airRes != 1) vel *= pow(airRes, dt)
if (gravityScale > 0) vel += dt * gravityScale * gravityDir   // emission +0x89C/+0x8A0, isWorldGravity 면 입자 행렬로 돌림
// 필드(있는 것만): FCOL → FRND → FRN1 → FMAG → FSPN → FCOV → FCLN → FPAD → FGWD → FCSF
FRND: for c in xyz: x0 = (age + rnd_c * I) * (2π / I)        // airMode 이고 air≠1 이면 age → (1 - air^age)/(1 - air)
                    pos_c += amp_c * (N(x0 + dt·2π/I) - N(x0))
      N(x) = 4·sin(x/0.6) + 3·sin(x/0.42) + 2·sin(x/0.23) + 1.5·sin(x/0.15)   // 사용자 표면 +0x1C/+0x2C 값
FSPN: θ = speed * dt * momentum; pos 를 axis 둘레로 θ 회전 (Y: x' = cosθ·x + sinθ·z, z' = cosθ·z − sinθ·x)
```

- 2π 상수: FUN_7100a01930 이 `nn::util::FloatPi × 2` 를 DAT_71016402a8 에 넣는다(`vfx40_got.c`) [판독].
- 이 함수는 CPU 이미터(calcType 0) 경로다. calcType 1·2 는 셰이더(파일 안 GRSN)가 계산한다. **웹은 셰이더도 같은 식이라고 본다** [추정]. 근거: FUN_71009f36f8 이 같은 필드 값(FRND 등)을 상수 버퍼로 그대로 넘긴다.

### 6.4 색·알파·크기 [판독: 색0·알파0 CPU 경로, 나머지 추정]

```ts
r = age / life
color0 = type==3 ? keys0[colorKey] : type==2 ? keyEval(keys0, loop? fmod(rate·u·loopRandom + age, rate)/rate : r) : const
alpha0 = alpha0Type==2 ? keyEval(alphaKeys, …).x : const alpha0
keyEval: 키 1개면 그 값, r < 첫 키 시각이면 첫 값, r ≥ 끝 키 시각이면 끝 값, 사이 = 보간(0 선형, 1 계단)   // FUN_71009fc110
// [추정] 그리기
rgb   = tex.rgb * color0 * colorScale * emitterColor0.rgb
alpha = tex.a * alpha0 * emitterColor0.a * fadeOut(알파 플래그면) * fluc
size  = (sx, sy) * keyEval(scaleKeys, r) * flucScale * fadeOut(크기 플래그면)
rot   = rotateInit.z + u*rotateInitRand.z + (±)(rotateAdd.z + u*rotateAddRand.z) * age   // isRotateZ 일 때
fluc  = 1 - amplitude * (0.5 - 0.5·cos 2π(age/cycle + phase))                            // isApplyAlpha/Scale
```

### 6.5 위치와 붙는 곳 [추정]

```ts
E   = T(trans 또는 EAET 키값) · R(rotate XYZ) · S(scale)          // EmitterInfo
W   = anchor · E                                                   // anchor = 트리거 대상 노드 월드 행렬
world = follow==0 ? W·pos : follow==1 ? Wbirth·pos : Wbirth·pos + (W.t − Wbirth.t)
quad  = 카메라를 보는 사각형, 한 변 = size(±0.5), 이미터 행렬 배율은 크기에 곱하지 않음
```

- 공 이펙트의 anchor = 공 중심 + **균일 배율 b.scale**. 근거: move 트레일 이미터 y = −1.0 이 배율을 받으면 공 중심 1.1·s 에서 지면 0.1·s 위가 된다(모든 단계에서 지면) [재구현 계산]. 크기에 배율을 곱하지 않는 것은 입자 초기화가 세트 행렬이 아니라 세트 +0x150(입자 크기 배율 API)만 곱한다는 판독과 맞춘 [추정].
- 사각형 한 변 = 크기: main 에서 ±0.5 사각형 상수를 찾지 못했다(±1 꼴은 vfx 밖 FUN_71007c343c 에서 쓰임). 고리·빛 크기가 공 둘레에 맞는 쪽을 골랐다 [미확정].

---

## 7. 이펙트·에셋 연결 — hsmg402 이미터셋별 원본 수치

값은 `web/assets/hsmg402/effect/sets.json`(= `effect_vfxb.py` v40 summary). 크기 = 기본(랜덤 %)·키, 속도 = (allDirection / designatedDirScale·방향), 중력 = 프레임² 당.

### 7.1 눈덩이 (`hsmg402_snowball_*`)

| 셋 / 이미터 | 계산·추종 | 볼륨 / 위치 | 수명 | 속도 · 중력 · 공기 | 크기 | 색·알파 | 블렌드 | 텍스처 |
|---|---|---|---|---|---|---|---|---|
| appear00 `ring00a` | GPU, 2 | Point | 15 | 0 | 1.1, 키 0.67→1 | color0 (1,1,0) × 0.37, 알파 0→1@.25→1@.63→0 | 가산 | ring00 (R8) |
| appear00 `circle00a` | GPU, 2 | Point | 20 | 0 | 2.0 | 흰 × 0.5, 알파 0→1@.25→0 | 가산 | circle00 (BC1) |
| max00 `ring00a` | GPU, 2 | Point | 30 | 0 | 2.5, 키 .67→.88@.2→1 | (1,1,0) × 0.75, 알파 0→1@.12→.42@.3→0 | 가산 | ring00 |
| max00 `circle00a` | GPU, 2 | Point | 40 | 0 | 4.5 | 흰 × 0.5, 알파 0→1@.12→.29@.52→0 | 가산 | circle00 |
| max00 `twinkle00_start` | GPU, 2, 깊이 끔 | SphereDiv64 r 1.25 | 30 (50%) | 0 | 1.5 (50%) | 흰 × 2, 흔들림 알파·크기(주기 20) | 가산 | twinkle00 |
| max00 `twinkle00_Copy1` | GPU, 2 | Sphere r 1.1 | 45 (75%) | 0 | 0.5 (75%), 키 0→1→1→0, 회전 Z 랜덤 2π + 0.0349/f | 흰 × 6, 알파 0→1@.5→0, 흔들림(주기 7) | 가산 | twinkle00 |
| move00/01/02 `snow_solid00` | GPU, 2 | CircleDiv r 0.45, 220°, 10분할(primEmitType 1 → 무작위 칸), 위치 y −1 | 60 (50%) | (0.01 / 0.01·(0,1,0)), 중력 0.0003, 공기 1 | 0.8 (75%), 키 7개(01 은 3개) | 흰, 알파 1 | 알파 | snow01 4×2 무작위 칸 (+fakevolume00, CSDP 근사) |
| throw00/01/02 `snow_solid_leave00` | GPU, **1** | CircleDiv r 0.8, 180°, 위치 y −1 | 52/45/45 (50%) | (0.02 / 0.03·up), 중력 0.0015 | 1.25/1.0/0.6 (50%), 키 0→1@.5→0 | 흰 | 알파 | snow01 |
| fall00 `kotai` | GPU, **1** | SphereFill r 0.5 반구, 위치 y −0.8 (EAET −0.6→−0.8/106f) | 90 (50%), 운동량 ±0.5 | (0.01 / 0.08·(0,.25,.5)), velRandom 75, 중력 0.0015 | 0.6 (75%), 키 0→1→1@.81→0 | (0.57,0.64,0.75) × 1.3 | 알파 | snow01 |
| break00/01/02 `snow_solid00` | GPU, 2 | SphereFill r 0.1 반구, 위치 y −0.3/−0.4/−0.5 | 60 (50%), 운동량 ±0.5/±0.5/±0.75 | (0.06·0.11·0.14 / 0.07·0.06·0.06 up), velRandom 75/75/50, 중력 0.008/0.004/0.004, 공기 0.96 | 0.6 (75%), 키 0→1@.5→0 | 흰 | 알파 | snow01 |

- 모든 눈덩이 이미터: isFadeEmit 1. fall00·break·throw 는 정지 때 알파 페이드 아웃 30f.

### 7.2 무대 상시 (`INITIALIZE` → 4셋, 대상 `field` = 원점)

| 셋 / 이미터 | 볼륨 · 위치 | 방출 | 수명 | 낙하 속도(지정) | 크기 · 색 | 텍스처 | 하위 |
|---|---|---|---|---|---|---|---|
| snow00 `snow00_far / middle / near` | BoxFill 30×0×10 at (0,5,−10)/(0,7.5,0)/(0,10,10) | 9/6/4 f 마다 1 | 2000/1000/500 (50/50/0%) | 0.005/0.01/0.015 ↓ (50%) | 0.1/0.1/0.05 (50%), × 3, 알파 0→1@.2→1@.77→0, 흔들림 알파 0.75 주기 160 | snow07 | FRND 0.01/0.03/0.04, FSPN Y 0.000349/0.000524/0.000698 |
| `…_glare` ×3 | BoxFill 7×10 at x +5/6.2/7.5 | 27/18/12 f | 2000/1000/500 | 같음 | 0.15/0.1/0.1, × 4.5 | particle01 | 같음 |
| `near_side_right/left` | BoxFill 3.5×5 at (±7.5,5,10) | 25 f | 500 | 0.015 | 0.15/0.1 | particle01 / snow07 | 같음 |
| `near_near` | BoxFill 30×30×10 at (0,15,15), one-time 240 | 0 | 500 | 0.015 | 0.1 | snow07 | 같음 |
| `near_near2` | BoxFill 30×2×10 at (0,12.5,15) | 180f 부터 2f 마다 | 500 | 0.015 | 0.1 | snow07 | 같음 |
| `snow00/01/02_start` | BoxFill 30×0×30, Y 90°, y 10, z 10/9/8, one-time 200/100/100 | 0 | 1000/3000/3000 | 0.01/0.006/0.005 | 0.15/0.125/0.07 | snow07 | FRND(02 없음) |
| field00 `twinkle00` | CircleFill r 8.5 (얼음판), 깊이 끔 | 10 f | 30 (50%) | 0 | 0.5 (50%), × 2, 흔들림 | twinkle00 | — |
| star00 `star_a/b/c` | CircleFill r 1 × 이미터 배율 (100,1,14), X 90°, (0,−40,−115) | 0, 20/30/20 | **무한** | 0 | 1.0/0.8/0.6, color0Type 3 (4색 무작위), 흔들림 주기 20/25/30 | twinkle00 | — |
| star01 `Emitter1` (CPU) → 자식 `Emitter2` | BoxFill 120×2, (25,−20,−110) | 300 f 마다 1 / 부모 입자마다 매 f | 360 / 120 (75%) | 0.15·(−1,−0.5,0) / 0 | 0.3 × 4 / 0.2 키 →0, (0.6,0.6,0.29) | snow00 | 자식 |

### 7.3 캐릭터 공용 (`hs_system`, 대상 노드 ftrg +34)

| 트리거 → 셋 | 대상 | 이미터 |
|---|---|---|
| SNOW_MAKE00 → `fx_pc_snow_make00` | `NDcha_pos`(발밑 원점, 캐릭터 방향) | L/R(x ±0.75, 안쪽 위로 0.06, 중력 0.005, snow01 0.4), L/R_tubu(물방울 bdr001_water06_nuki01, 파랑), L/R_smoke(snow03, 2.0, 가산) |
| SNOW_BREATH00 → `fx_pc_snow_breath00` | `NDcha_pos` | breath00(fx_smoke00, 0.75 × 키, 위로 0.006, 수명 90, 가산, follow 1) |
| SNOW_FALL00 → `fx_pc_snow_fall00` | `attach_body`(+0.7085) | kotai(hsmg402 fall00 과 같은 값, 텍스처 hs_system/snow01) |

- `SNOW_BREATH00` 의 대상은 base·캐릭터별 ftrg 모두 `NDcha_pos`(오프셋 칸 +94~ 0) [데이터]. 이전 웹 근사는 입 위치(+1.1)였다 → 원본대로 발밑으로 정정.

### 7.4 텍스처 [데이터]

| 키 | 형식(comp) | 웹 색공간 |
|---|---|---|
| hsmg402_ring00, snow07, twinkle00, fakevolume00 | R8 / BC4 UNORM (RRRR) | 선형 |
| hsmg402_circle00 | BC1 SRGB(알파 없음) | sRGB |
| hsmg402_particle01, snow00, snow01 | BC3 / RGBA8 SRGB | sRGB |
| hs_system snow01 / snow03 / fx_smoke00(RRRG) / bdr001_water06_nuki01(RRRR) | RGBA8·BC1 SRGB / R8G8·BC4 UNORM | 형식대로 |

---

## 8. 다른 기능과의 상호작용

| 대상 | 내용 |
|---|---|
| 로직 | 이펙트는 시각 전용. 로직 사건 `fx{owner, index, name, op, pos}`(state.ts)만 받는다. 이펙트 난수는 로직 결정성과 무관(이미터 LCG 시드는 화면 쪽 카운터) |
| 소리 | 같은 FX 트리거 이름으로 SE 트리거(`se_hsmg402_snowball`)를 sound.ts 가 따로 낸다(변경 없음) |
| 시간 | 고정 60(01_core) → 웹은 로직 프레임 차이만큼 1프레임씩 진행(한 번에 최대 10) |
| 모델 | 공 모델(hsmg402_snowball·_break)은 balls.ts, 이펙트는 같은 슬롯의 state 값(pos·scale)에 붙는다. 캐릭터는 character.ts 의 노드(`NDcha_pos`·`attach_body`)를 읽기만 한다 |
| 후처리 | 가산 이펙트의 colorScale(최대 6)은 HDR 값 → 블룸·톤맵(post.ts) 영향 |

---

## 9. 웹 포팅 구조와 구현 순서

### 9.1 자료 변환

```
web/tools/analysis/effect_vfxb.py dump <effect.xml> <out> --png          (hsmg402, hs_system)
web/tools/analysis/hsmg402_web_assets.py [--only-effects]
  → web/assets/hsmg402/effect/sets.json  { triggers{이름: {target, sets, params}}, textures{키: {format, srgb}}, sets{이름: {source, emitters[summary+subsections+children]}} }
  → web/assets/hsmg402/effect/{hsmg402,hs_system}/*.png       (BNTX 디코드 그대로)
  → manifest.effects = { textures{키: 경로}, fxTriggers, seTriggers, sets: 'effect/sets.json' }
```

### 9.2 모듈

| 웹 파일 | 원본 대응 | 책임 |
|---|---|---|
| `script/view/vfx.ts` `VfxSystem` | nn::vfx2 시스템 | 셋 정의·텍스처·재질(블렌드·깊이 시험별), 인스턴스 목록, `update(frames)` |
| 〃 `VfxSetInstance` | 이미터셋 인스턴스 | `anchor`(월드 행렬), `stop()`(= _Stop), `kill()`, `done` |
| 〃 `EmitterInst` | 이미터 인스턴스(4.6) | 방출(6.1)·입자 초기값(6.2)·CPU 갱신(6.3)·그리기 값(6.4) |
| `games/hsmg402/view/effects.ts` `Effects` | FX 트리거 재생/정지 | 트리거 → 셋, `play(key, name, anchor)`, `stop(key)`, `spawn(name, anchor\|pos)`, `startField()` |
| `games/hsmg402/view/index.ts` | 트리거를 거는 모델·노드 | `fx` 사건 → 공 anchor(pos·scale) / 캐릭터 anchor(ftrg +34 노드), 모션 이벤트 SNOW_* |

### 9.3 원본 이름 ↔ 웹 이름

| 원본(오프셋) | 웹(`EmitterSummary`) |
|---|---|
| start/timing/duration/rate/rateRandom/interval/intervalRandom (+0x87C~+0x894) | `emission.*` |
| inst+0x50/+0x54/+0x58/+0x01 | `EmitState.timer/accum/step/emitted` |
| life/lifeRandom/momentumRandom (+0x940~) | `life`, `lifeRandom`, `momentumRandom` |
| airRes(+0xC0), 중력(+0x89C/+0x8A0) | `airRes`, `gravity.emissionGravityScale/Dir` |
| 키표·타입(+0x3C0~, +0xA5C~), colorScale(+0x3B0) | `color.color0Keys/alpha0Keys/types/colorScale` |
| FRND/FSPN | `subsections[{magic:'FRND', amp, interval, amps, periods}]`, `{magic:'FSPN', speed, axis}` |
| followType(+0x7D3) | `followType` |
| 페이드(+0x7D8~+0x7EC) | `fade.*` |

### 9.4 원본과 다른 근사 목록

| 항목 | 원본 | 웹 | 동등성 |
|---|---|---|---|
| GPU 이미터 운동 | 셰이더(GRSN, 미판독) | CPU 식(6.3) 그대로 | 셰이더 판독 뒤 확인 |
| 볼륨 표본 | 함수 표 16칸(미판독) | 이름대로 표본, 각도 기준 sin/cos(x,z) | 화면 대조 |
| 빌보드 | 종류별 정점 변환 | 0(카메라 정면) 하나만(hsmg402 는 전부 0) | — |
| 사각형 크기 | 미확인 | 한 변 = 크기(±0.5) | 화면 대조 |
| 색 합성(컴바이너) | 셰이더 | 텍스처 × color0 × colorScale, 알파 × alpha0 | — |
| 두 번째 텍스처·CSDP(move 의 fakevolume00) | 커스텀 셰이더 | 안 씀 | — |
| 흔들림 Fluctuation | 셰이더 | 1 − amp·(0.5 − 0.5 cos) | — |
| 회전 | 셰이더 | 초기 + 속도·나이(Z) | — |
| 이미터 애니 | EA** 14종 | EAET(이동)만 | hsmg402 는 kotai 하나 |
| 소프트 파티클·근거리 알파 | 있음 | 없음 | — |
| 자식 이미터 | 상속 플래그 | 부모 입자 월드 위치에서, 상속 없음 | 유성 꼬리 하나 |

### 9.5 구현 순서(한 일)

1. 파서 v40 표 → 전수 검사 0 오류. 2. 자료 변환(sets.json). 3. `vfx.ts`(방출·초기값·CPU 갱신·키·페이드·자식). 4. `effects.ts` + index.ts 연결. 5. 노드 검사(`check_vfx.ts`).

---

## 10. 검증 코드·실행 결과·기대값

| 검사 | 명령 | 결과 | 수준 |
|---|---|---|---|
| 전 파일 구조 | `.venv/Scripts/python web/tools/analysis/effect_vfxb.py check extracted/bea` | 125 파일, 이미터셋 1,089, 이미터 3,674(자식 227), **크기 불일치 0**, 텍스처 ID 4,190 모두 GTNT 에 있음(실패 0), 프리미티브 ID 417 모두 G3NT 에 있음, 이름 깨짐 0, **키표 18,370 시간 이상 0·꼬리 0** | 실행: 파서 |
| 전 파일 요약·JSON | 3,447 최상위 이미터(자식 포함 재귀) `emitter_json` + `json.dumps` | 예외 0 | 실행: 파서 |
| 하위 섹션 ↔ 필드 | 열 비교 | +0x9A4=1 ⇔ CSDP 1,156/1,156, +0xA10≠0 ⇔ CADP 126/126, +0x998≠−1 ⇔ calcType 2 181/181 | 데이터 |
| 오프셋 ↔ 코드 | `web/tools/analysis/vfx40_scan.py` + 디컴파일 | 4.3 의 C 표시 필드를 같은 폭·뜻으로 읽음 | 판독 |
| 런타임 방출 수 | `cd web && npx tsx tools/check_vfx.ts` | appear ring 2·circle 1, max ring 2·circle 1·twinkle 20, break 3/35/75, fall 50, make L·R 30·tubu 10·smoke 1, breath 1, snow00_far 600f 67, fall00 Stop 뒤 30f 에 끝 — **전부 6.1 손 계산과 일치**, NaN 0 | 재구현 계산(합성) |
| 무대 상시 600f 입자 | 같은 도구 | 눈보라 1,038, 별 70, 유성 77, 얼음판 반짝임 1 | 재구현 계산 |
| 타입·로직 | `npx tsc --noEmit`, `npx tsx tools/test_hsmg402.ts`, `npx tsx tools/check_hsmg402_assets.ts` | tsc 통과, 290/290, 에셋 오류 0 | 실행 |

검증되지 않은 범위: 원본 화면과의 대조(크기·색·운동 모양), WebGL 셰이더 컴파일·그리기(헤드리스 미실행), GPU 이미터 식이 CPU 식과 같은지.

---

## 11. 미확정 사항과 추가 분석에 필요한 근거

| # | 항목 | 영향 | 확인 방법 |
|---|---|---|---|
| 1 | GPU 이미터(calcType 1·2) 정점 셰이더 식 — CPU 식과 같은가, 크기·회전·흔들림·색 합성 | 모든 GPU 입자 모양 | 파일 안 GRSN(BNSH) → Ryujinx ShaderTools GLSL 변환 |
| 2 | 빌보드 사각형 크기(±0.5 / ±1), 이미터셋 행렬 배율이 입자 크기에 곱해지는지 | 고리·빛 크기 | 셰이더 판독 또는 원본 화면 |
| 3 | 볼륨 함수 표 `PTR_LAB_710155f028`(16칸)의 각도 기준·분할 순서·caliberRatio·SphereDiv64 표 | 방출 위치 분포 | 표의 함수 디컴파일 |
| 4 | followType 0/1/2 의 정확한 뜻(입자 행렬 저장 분기는 판독) | 공 따라가기 | FUN_71009f6b00·셰이더 |
| 5 | FX 트리거 +78~+90 칸(MOVE00 의 10.0), +58 플래그, +b8 | MOVE00 크기·방출률 | `hs::HsModel` 트리거 재생 함수 판독 |
| 6 | 트리거가 공 모델의 어느 행렬에 붙는가(굴림 회전 포함 여부) | 공 이펙트 방향 | HsModel 트리거·노드 판독 |
| 7 | 블렌드 2~5, 깊이 함수, displaySide | hsmg402 영향 없음 | 셰이더·렌더 상태 함수 |
| 8 | 텍스처 패턴 타입 1~3 식, repeat × 패턴 합성 | hsmg402 는 4(무작위)만 | 셰이더 |
| 9 | 이미터 애니 EA** 의 시간 단위(EAET t=106 을 프레임으로 봄)와 루프 | kotai 위치 | FUN_71009fc240 판독 |
| 10 | bex 이펙트 층(`bex::Effect2Mgr`·`SystemEffect2`)·트리거 재생 함수·공 삭제 때 이펙트 처리 | 정지 시점 | main 판독 |
| 11 | +0x9E8/+0x9EC, unknown6·7, Fluctuation 바이트 뜻 | — | 0 이 아닌 표본·코드 |

### 정정 기록

- web/docs/analysis/01 §2.12 의 "EmitterData 필드 [미확정]" → v40 배치 확정(4.2·4.3). `extracted/converted/hsmg402/effect/vfxb.json` 과 `effect/hsmg101/vfxb.json` 을 v40 배치로 다시 만들었다(이전 판은 v53 배치로 읽어 값이 밀려 있었다).
- hsmg402 웹의 `SNOW_BREATH00` 위치: 근사(입 높이) → 원본 대상 노드 `NDcha_pos`(발밑).
- hsmg402 웹의 THROW: 이전 근사는 1회 분출 → 원본은 **연속 방출**(isOneTime 0, followType 1)이라 굴러가는 동안 꼬리를 남기고 `_Stop` 에서 끝난다.
