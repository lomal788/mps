# mps 웹 — 마리오파티 슈퍼스타즈 웹 포팅

원본 분석([../README.md](../README.md), [docs/](docs/))을 근거로 미니게임을 브라우저에서 재현한다.
기반(페이지·루프·게임 계약·입력·오디오·렌더러·에셋·해제·레이아웃 재생기·시퀀서)은 잼버리 웹(`C:/dev/mpj/web`, 읽기 전용)에서 복사해 왔다. mps 엔진층(Bezel 1.55)과 다른 부분은 mps 판으로 바꿨다.

## 실행

```sh
cd F:/dev/mps/web
npm install
npm run dev                    # http://localhost:51821/  (?game=hsmg402)
npx tsc --noEmit               # 타입 검사
npx tsx tools/test_hsmg402.ts  # 로직 시험 (분석 기대값 대조)
npx tsx tools/smoke.ts         # 헤드리스 스모크
```

URL 옵션은 `script/main.ts` 머리 주석을 본다(`?seed=`, `?com=1111`, `?mute=1`, `?auto=1`, `?debug=1`).

## 조작 (hsmg402)

| 키 | 원본 | 동작 |
|---|---|---|
| K | B | 눈덩이 만들기(연타) |
| J | A | 굴려 보내기 |
| WASD / 방향키 | L 스틱 | 이동 |
| 게임패드 버튼 0 / 1 | B / A | |

## 구조

| 경로 | 내용 |
|---|---|
| `script/main.ts`, `game.ts` | 페이지, 60 Hz 고정 스텝, 게임 계약(logic/view 분리) |
| `script/core/` | f32·정규화(NEON frsqrte)·sdk sin/cos(`fmath.ts`), **mps 난수**(MT19937 + libc++ uniform_int, `rng.ts`), 입력 비트, 사건 |
| `script/view/` | 렌더러, 에셋 로더, 오디오·3D 소리, 시퀀서(`seq.ts`), 레이아웃 재생기(`lyt.ts`), **VFXB v40 이펙트 런타임(`vfx.ts`)**, 해제(`dispose.ts`) |
| `script/games/hsmg402/` | 데굴데굴 눈덩이: `state.ts`(계약), `logic/`(GameMgr·Player·SnowBall·PlayerCom 등 원본 클래스 단위), `view/`(무대·캐릭터·공·카메라·조명·후처리·재질·이펙트·소리·UI) |
| `assets/` | 웹 에셋 (`tools/analysis/hsmg402_web_assets.py`, `tools/analysis/hsmg402_mat_assets.py`로 만든다) |
| `tools/` | 개발 서버·빌드·스모크, `test_hsmg402.ts`, `check_hsmg402_assets.ts`, `check_hsmg402_material.ts`, `check_vfx.ts`, `check_logic.ts` |
| `tools/analysis/` | 원본 분석 도구 (추출·변환·판독·재구현 계산). 실행은 mps 루트에서 `.venv/Scripts/python web/tools/analysis/<도구>.py` |
| `docs/engine/` | mps 엔진 문서: [01_core](docs/engine/01_core.md), [03_graphics(재질)](docs/engine/03_graphics.md), [07_camera_lighting](docs/engine/07_camera_lighting.md), [08_effects](docs/engine/08_effects.md) |
| `docs/minigame/` | 미니게임 목록과 분석 문서 ([README](docs/minigame/README.md), [hsmg402](docs/minigame/hsmg402.md)) |
| `docs/analysis/` | 원본 구조 문서: [00 추출](docs/analysis/00_extraction_pipeline.md), [01 패키지·에셋](docs/analysis/01_package_and_assets.md), [02 코드 모듈](docs/analysis/02_code_modules.md), [03 게임 구조](docs/analysis/03_game_structure.md) |

## mpj(잼버리) 웹과 다른 점

| 항목 | mpj | mps |
|---|---|---|
| 시간 | 리듬 장면만 고정 60 | 고정 f32(1/60) |
| 동기 난수 분포 | (u·n)>>32 | libc++ uniform_int, RangeF 곱·합 분리 반올림 |
| 시드 | 장면마다 재시드 | 오프라인 재시드 없음(웹은 시드 주입) |
| 미니게임 흐름 | 파이버 | 장면 Update 한 걸음 |
| 이펙트 | VFXB v53 | VFXB v40 (`view/vfx.ts`) |
| 재질 | static_opt 체계 | 셰이더 팩(bnbshpk) 그래프별 레시피 (`games/hsmg402/view/material.ts`) |

## 상태 (2026-10-05)

| 게임 | 분석 | 웹 | 검증 |
|---|---|---|---|
| hsmg402 데굴데굴 눈덩이 | 1차 완료 | 로직·화면·소리·UI·재질·조명·이펙트 | 로직 시험 290 통과, 헤드리스 한 판 완주. **원본 실행 대조 없음** |

근사로 남은 것과 미확정은 각 view 파일 머리 주석과 [hsmg402.md 11절](docs/minigame/hsmg402.md)에 있다.
