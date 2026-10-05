# 01. 패키지 구성과 에셋 형식 (마리오파티 슈퍼스타즈, mps)

추출 방법은 [00_extraction_pipeline.md](00_extraction_pipeline.md)에 있다. 이 문서는 다음을 다룬다.

- 원본에 무엇이 어떤 형식으로 들어 있는지
- mpj(잼버리)에서 만든 변환기를 어디까지 그대로 쓸 수 있는지(실제로 돌려 본 결과)

게임 구조(장면·미니게임 분류·데이터 표의 의미)는 [03_game_structure.md](03_game_structure.md)에서, 코드 모듈은 02_code_modules.md에서 다룬다.

확정 수준 표지는 다음과 같다.

| 표지 | 뜻 |
|---|---|
| **[실행]** | 도구를 실제로 돌려 확인함 |
| **[판독]** | main 코드를 디스어셈블해 읽음 |
| **[데이터]** | 파일 내용을 직접 봄 |
| **[추정]** | 근거가 부분적임 |
| **[미확정]** | 아직 모름 |

---

## 0. 결론 요약

### 0.1 형식별 결론

| 형식 | 파일 수 | mps 버전 | mpj 대비 | 읽기 수단 | 상태 |
|---|---|---|---|---|---|
| BEA (`SCNE`) | 477 아카이브 | 0x00010100 | mpj v6과 헤더·ASST 배치가 다름 | `web/tools/analysis/bea.py`(v1 지원 추가) | **[실행]** 전부 해제 |
| FRES `.fmdb/.fskb/.fmab/.fvbb/.fsnb/.fshb` | 23,057 | **9.0.0.0** | mpj 9.1 | BfresLibrary, `graphics_bfres2gltf` | **[실행]** 전량 로드 실패 0, glb 변환·three 로드 오류 0 |
| BNTX | 488 파일 / 9,332 텍스처 | 0x00040100 | 같음 | `graphics_bntx.py` | **[실행]** 헤더 전량, 표본 디코드 정상 |
| `.ftxb` | 9,332 | 경로 문자열 | 같음 | 그대로 읽음 | **[데이터]** |
| BFFNT (`FFNT`) | 26 | 4.1.0 | 같음 | `ui_font.py` | **[실행]** BC7 컬러 폰트 지원 추가 |
| `.lyt` (SARC + FLYT/FLAN) | 74 | FLYT/FLAN 9.0 | FLAN에 `pat1` 없는 판이 있음 | `ui_lyt.py` | **[실행]** 949 bflyt·2,533 bflan 검사 문제 0 |
| `.ftrg` (`FTRG`) | 968 | 0x02160000 | mpj 0x021A0000 | `ui_ftrg.py` | **[실행]** 968개 bad 0 |
| `.mpat` | 66 | 매직 `mpbs`, `AnimTransitTable_1.0.0` | mpj `tapm`과 **다른 형식** | `scene_mpat.py`(mpbs 파서 추가) | **[실행]** 66개 꼬리 0 |
| `.apx` (`SEBD`) | 315 | **PhysX 3.4.0** | mpj 4.1.2 | `scene_apx.py`(3.4 헤더 추가) | 헤더·목록 **[실행]**, 메시 본문 **[미확정]** |
| `.nbmap`/`.entity` (`BEEGENTY`) | 145 + 1 | 0x000C0000 | 같음 | `scene_nbmap.py` | **[실행]** 145개 |
| FSAR `.fspj`/`.fsst` | 1 / 217 | 0x00020500 | mpj 0x00020600 | `sound_fsar.py`, `sound_seq.py` | **[실행]** 목록·시퀀스 역어셈블·렌더 |
| BFSTM | 209 | 0x00060400 | 같음 | `sound_bfstm.py` + vgmstream | **[실행]** 디코드 |
| `.bspp` | 10 | `BSPP` 1 / `snsp` 9 | 비슷 | `sound_preset.py` | **[실행]** 194 프리셋 목록 |
| VFXB (`effect.xml`) | 125 | **vfx 40** | mpj 53 | `effect_vfxb.py`(V40 표) | 섹션·텍스처·프리미티브·**이미터 필드(0xB80 B) [판독+실행]** — web/docs/engine/08_effects.md |
| **`.nkn`** | **1,044** | — | **mps에만 있음** | `web/tools/analysis/nkn.py` | **[판독+실행]** AES-128-CBC로 암호화한 CSV, 전량 복호 |
| `.msbt`/`.msbp`/`.mstl` | 615 / 1 / 30 | MsgStdBn | 같음 | `msbt.py`, `ui_msbp.py` | **[실행]** |
| `.lua` (`BZLA`) | 25 | Lua 5.2 바이트코드 | mpj에 없음 | (디컴파일러 필요) | **[데이터]** |
| `.bnbshpk`·`.bfsha`·`.bnsh` | 216 / 35 / 211 | BEZSHAPK·FSHA 8.0·BNSH | — | 웹에서는 재작성 | **[데이터]** |
| `.ctga` | 70 | 무압축 TGA(type 2) | — | 그대로 읽음 | **[데이터]** |
| `.bnvib` | 259 | — | 같음 | `ui_bnvib.py` | **[실행]** 표본 3개 |

### 0.2 핵심 사실

- **.nkn은 새 형식이 아니다.** mpj의 `.json`·`.csv` 데이터가 mps에서는 CSV 텍스트를 AES-128-CBC로 암호화한 `.nkn`으로 바뀌었다.
  - 키와 IV는 main 실행 파일 안의 상수다.
  - `bex::DataCSV::Load`가 경로 끝 `csv`를 `nkn`으로 바꿔 읽고 복호한다.
  - 1,044개 전부 복호에 성공했다. 결과는 `extracted/nkn/`에 있다(§3).
- **그래픽 변환기는 거의 그대로 쓴다.**
  - FRES 9.0 파일 23,057개 전부가 BfresLibrary와 `graphics_bfres2gltf`에서 로드 실패 없이 읽혔다.
  - mario와 hsmg101 표본 glb는 three.js GLTFLoader에서 오류 0이다.
  - 다만 **재질 옵션 이름 체계가 다르다**(mpj `static_opt_*` → mps `use_normal_map`, `basecolor_source0` 같은 다층 재질). 그래서 재질 근사 규칙은 mps용으로 다시 만들어야 한다(§2.2).
- **mpj와 형식이 다른 것**:
  - PhysX 3.4(apx)
  - `mpbs` 모션 전이표(mpat)
  - VFXB v40
  - FTRG 0x0216
  - BEA v1
- **사운드는 RomFS `stream/`과 BEA 안의 FSAR 둘로 나뉜다.**
  - 공용 사운드 프로젝트는 `Resident.nx.bea`의 `_Resident/AddonAudioProject.fspj`(67.5 MB)다. 사운드 6,566개, 뱅크 107개, 파형 아카이브 108개가 들어 있다.
  - 장면별 사운드는 `sound~subarc_*.nx.bea`의 `.fsst`다.
- **이펙트는 각 장면 아카이브 안 `<장면>/effect/effect.xml`(VFXB)에 있다**(125개). mpj의 `_Vfx/**/ConvertList.xml` 구조가 아니다.

---

## 1. 아카이브 체계

### 1.1 RomFS 최상위 [데이터]

| 경로 | 수 | 크기 | 내용 |
|---|---|---|---|
| `Archive/*.bea` | 476 | 2.48 GB | 거의 모든 에셋 |
| `System.nx.bea` | 1 | 2.4 MB | 엔진 기본 리소스: `_BezelSystemResources/*` 셰이더(bfsha), 기본 라이트 엔티티 |
| `stream/*.bfstm` | 209 | 349 MB | 스트림 BGM·징글 |
| `nro/NX_Release/*.nro` | 126 | 44 MB | 코드 모듈(web/docs/analysis/02) |
| `boot.lua` | 1 | — | 엔진 초기화. **평문 Lua 소스**(아카이브 안 `.lua`는 바이트코드) |
| `.nrr/hs.nrr` | 1 | — | NRO 등록 |

mpj에 있던 `boot.nbinit`·`ac.nx.archiveconfig`·`movie/`는 없다(web/docs/analysis/00 §8).

### 1.2 이름 규칙 [데이터 + 판독]

```
파일   = "Archive/" + 논리이름('/' → '~') + ".nx.bea"
예     chara/npc/npc023_gesso  →  Archive/chara~npc~npc023_gesso.nx.bea
```

근거:

- **[데이터]** 장면 목록 `system/data/bex_scenelist.csv`(nkn 복호) 열 4의 아카이브 이름. 예: `hsmg406|chara/npc/npc023_gesso`.
- **[데이터]** `characterlist.csv` 열 2. 예: `chara/pc/pc01_mario`.
- **[판독]** main 문자열 `"./Archive/"` @0x11433d0, `".nx"` @0x11606cb.
- mpj의 `/` → `~` 치환 규칙과 같은 계열이다.

| 범주(파일 이름 앞부분) | 아카이브 수 | 파일 수 | BEA 크기 (MB) | 해제 크기 (MB) | 주요 확장자 |
|---|---|---|---|---|---|
| `hsmgNNN` 미니게임 | 105 | 12,056 | 1,497.6 | 3,452.1 | ftxb 6,480, fmdb 1,786, fskb 857, nkn 573, fmab 474 |
| `hsmg406_stage1~3` | 3 | 137 | 33.9 | 58.6 | 미니게임 406의 스테이지별 추가분 |
| `hsbdNN` 보드 | 8 | 1,656 | 242.8 | 564.5 | 00=공통, 01~05=맵. 10·99는 파일 0개짜리 208 B 빈 BEA |
| `hsmn*` 메뉴 흐름 | 11 | 815 | 134.5 | 353.3 | hsmn00~09 + hsmn_bg |
| `hsmm*` 모드 | 9 | 786 | 106.1 | 209.8 | hsmm00~07 + hsmmet |
| `chara~pc~pcNN_<이름>` | 10 | 17,075 | 108.6 | 245.6 | 모델 + **모션 전부**(아래 1.3) |
| `chara~pc~pcNN_<이름>_443` | 10 | 40 | 0.0 | 0.2 | 캐릭터마다 `ftrg443/{fx,se,vb,vo}_*_443.ftrg` 4개뿐 |
| `chara~npc~npcNNN_<이름>` | 42 | 2,097 | 96.4 | 266.3 | NPC |
| `object~objNN_<이름>` | 30 | 636 | 18.8 | 80.2 | 블록·코인·주사위·아이템. `objbd_pack`은 보드용 묶음(경로 256개가 개별 object 아카이브와 중복) |
| `sound~subarc_hsmg*` | 104 | 104 | 51.8 | 59.4 | 미니게임별 `.fsst`(hsmg426 없음) |
| `sound~subarc_amb_*` | 40 | 40 | 28.1 | 30.2 | 환경음 `.fsst` |
| `sound~subarc_se_*` | 36 | 36 | 2.2 | 2.4 | 캐릭터·NPC 효과음 `.fsst` |
| `sound~subarc_sysvoi_<로캘>` | 15 | 15 | 6.2 | 6.8 | 시스템 보이스(로캘별) |
| `sound~subarc_(그 밖)` | 22 | 22 | 18.3 | 20.5 | hsbd01·hsbd01_map0N·hsmn0N·op·ed 등 |
| `sound~snd_sp_*` | 9 | 9 | 0.0 | 0.0 | 사운드 공간 `.bspp`(`snsp`) |
| `Resident` | 1 | 5 | 55.7 | 67.6 | **`AddonAudioProject.fspj`**, `WaitingScreen.lyt`, 정의 nkn 3개 |
| `hs_system` | 1 | 347 | 22.2 | 113.1 | 공용 데이터 표(nkn 30), bnvib 259, 공용 레이아웃(`layout.lyt` 80.9 MB) |
| `system` / `system_boot` / `system_boot_bnsh` | 3 | 36 / 41 / 211 | 0.0 / 3.0 / 0.6 | — | 장면 목록·gm Lua / bex Lua·셰이더 / BNSH 211 |
| `audio` | 1 | 117 | 0.1 | 0.3 | `jump_setting/*.nkn` 115, `mgsound_setting.nkn`, `sound_settingpreset.bspp` |
| `mess` | 1 | 646 | 2.2 | 8.3 | 15개 언어 msbt 615 + mstl 30 + `hs.msbp` |
| `Parts{,_cn,_jpuseu,_kr,_tw}.lyt` | 5 | 26 | 13.1 | 110.1 | 로캘별 폰트(bffnt) |
| `font_holder{,_cn,_kr,_tw}` | 4 | 4 | 0.0 | 0.0 | `holder_layout.lyt` |
| `op`, `ed`, `emote`, `thumbnail`, `fxtrigger_base_443` | 각 1 | 50 / 320 / 1 / 1 / 4 | — | — | 오프닝·엔딩, 이모트(`layout.lyt` 18 MB), 썸네일 레이아웃, 443 공통 트리거 |
| `hs_matching` | 1 | **0** | — | — | 빈 아카이브 |
| **합계** | **477** | **37,333** | **2,480** | **5,827** | |

- 출처: `analysis/asset_inventory.tsv`(`web/tools/analysis/pkg_inventory.py`). 열은 아카이브, 경로, 확장자, 크기, 앞 16바이트, 엔트로피다 **[실행]**.
- 확장자별 수는 해제한 파일 기준이다. `.ftsb.fmab`는 fmab에 넣어 셌다.

### 1.3 아카이브 안 논리 경로 [데이터]

- 파일 이름은 전역 가상 경로다. 앞 디렉터리별 파일 수는 다음과 같다.
  - `chara/` 19,169
  - `mg/` 12,082
  - `scene/` 2,429
  - `flow/` 1,172
  - `mess/` 646
  - `object/` 608
  - `audio/` 343
  - `hs_system/` 341
  - `system_boot/` 251
  - `_chara/`·`_object/` 셰이더 팩, `_BezelSystemResources/`, `Parts.lyt/`, `_Resident/` 등
- **같은 경로가 여러 아카이브에 있는 경우는 260개(28.7 MB)**다.
  - 256개는 `object~objbd_pack`과 개별 `object~*`가 겹친다.
  - 나머지: `hsmg406_stage2/3`의 LUT, `hsmm00`/`hsmn06`의 `scene/hsmm00/data/*.nkn`, `hsmn06`/`hsmn08`의 `flow/hsmn06/layout.lyt`.
  - mpj(1,531개)보다 훨씬 적다.
- 캐릭터 모션은 **캐릭터 아카이브 하나에 다 들어 있다**. 예: `chara/pc/pc01_mario/motion/`에 클립 562개가 있다. 클립마다 다음 파일이 짝을 이룬다.
  - `.fskb`(뼈)
  - `.fvbb`(뼈 가시성)
  - `.ftsb.fmab`(텍스처 SRT, 눈·입 UV)

  mpj처럼 `chara~pcMot_*`로 나뉘지 않는다.
- 셰이더 팩: 아카이브마다 `_<아카이브>.bnbshpk` 또는 `_chara/pc/<캐릭터>.bnbshpk`가 하나씩 있다(216개, 1.17 GB).
- 텍스처 참조 `.ftxb`의 내용은 짝 `.bntx`를 가리키는 역슬래시 경로 문자열이다. 예: `chara\pc\pc01_mario\model\textures_chara/pc/pc01_mario.bntx`. 캐릭터는 텍스처 전부가 BNTX 하나에 들어 있다.

### 1.4 로캘 변형 [데이터 + 판독]

| 대상 | 변형 | 비고 |
|---|---|---|
| 폰트 | `Parts.lyt`(공통: hsfont_mario, *_extension), `Parts_jpuseu.lyt`(일·미·유럽: newrodin·rodinntlg·ruby·emote), `Parts_kr`·`Parts_cn`·`Parts_tw` | main 문자열에 5개 이름이 그대로 있다 **[판독: 문자열]** |
| 폰트 홀더 | `font_holder`, `_cn`, `_kr`, `_tw` | 각 `holder_layout.lyt` 하나 |
| 시스템 보이스 | `sound~subarc_sysvoi_{deeu,eneu,enus,eseu,esus,freu,frus,iteu,jajp,kokr,nleu,ptbr,rueu,zhcn,zhtw}` | 15개 |
| 메시지 | **로캘별 아카이브 없음.** `mess.nx.bea` 하나에 `mess/bin/<로캘>/` 15개(CNzh EUde EUen EUes EUfr EUit EUnl EUru JPja KRko TWzh USbr USen USes USfr) | mpj의 `message~<locale>`·`bq.nx.<locale>.bea`와 다름 |

어느 로캘에서 어떤 `Parts_*`를 고르는지 정하는 코드는 **[미확정]**이다(문자열 위치만 확인).

### 1.5 미니게임 하나가 쓰는 묶음 — hsmg101(ウェーブウェーブ) 예

| 묶음 | 파일 | 크기 | 근거 |
|---|---|---|---|
| 본 아카이브 | `Archive/hsmg101.nx.bea` | 13.2 MB(해제 30.5 MB, 83 파일) | `bex_scenelist.csv` `hsmg101,1,,,hsmg101,hsmg101::SceneHsmg101` **[데이터]** |
| 코드 | `nro/NX_Release/hsmg101.nro` | 160 KB | 같은 행 열 1 = 1(NRO) **[데이터]** |
| 효과음 서브아카이브 | `sound~subarc_hsmg101.nx.bea` → `audio/sounddata/subarc_hsmg101/subarc_hsmg101.fsst` | 327 KB | main 문자열 `audio/sounddata/subarc_%s/subarc_%s.fsst` **[판독: 문자열]**. 장면 이름으로 자동으로 고르는지는 **[추정]** |
| 사운드 프리셋 | `audio.nx.bea` `sound_settingpreset.bspp`의 프리셋 `hsmg101` | — | 아래 항목을 참조한다 **[실행: sound_preset.py show]** |
| ㄴ 환경음 | `sound~subarc_amb_slt_1`, `sound~subarc_amb_wtrstm_1`(`SQ_AMB_SLT_1`, `SQ_AMB_WTRSTM_1`) | 0.6 + 0.8 MB | 프리셋 레코드 |
| ㄴ 사운드 공간 | `sound~snd_sp_hsmg101` → `snd_sp_hsmg101.bspp` | 799 B | 프리셋 레코드 |
| ㄴ 징글 치환 | `SM_JIN_MG_WIN` → `SM_JIN_MG_WIN_MP03`, `SM_JIN_MG_LOSE`/`DRAW` → `SM_JIN_MG_DRAW_MP03` | 0.2 + 0.3 MB | 프리셋 레코드. `_MP03`은 원작 MP3 출처로 **[추정]** |
| BGM | `stream/SM_BGM_HSMG101_102_701_JMP.dspadpcm.bfstm`(39.6 s, 리전 3개) | 2.2 MB | `audio/data/mgsound_setting.csv` 행 `hsmg101,ウェーブウェーブ,…,scene_start,SM_BGM_HSMG101_102_701_JMP,…,REG_SEQ_MAIN,155` **[데이터]** |
| BGM 점프 설정 | `audio/jump_setting/SM_BGM_HSMG101_102_701_JMP.nkn`(→ CSV) | — | **[데이터]** |
| 캐릭터 | 플레이어 4명의 `chara~pc~pcNN_*`(각 약 11 MB) | — | 어떤 범주(로더)로 싣는지는 **[미확정]**(web/docs/analysis/02·03) |
| 상주 | `Resident`(공용 사운드 fspj), `hs_system`, `system`, `system_boot` | — | **[추정]** |

hsmg101 본 아카이브 구성(83 파일) **[데이터]**:

| 폴더 | 파일 수 | 내용 |
|---|---|---|
| `model/` | 60 | fmdb 8(bg, boat, clouds, col, fld, pond, pos_op, pos_end3), fskb 5, fmab 9, `_fxdb.nkn`, `textures/*.ftxb`, `textures_hsmg101.bntx` |
| `env/` | 14 | 카메라 fsnb 3, `hsmg101_env.fmdb/.fmab`, `_dir_light.fmdb`, `_fluid.fmdb`, env 텍스처 |
| `map/` | 4 | `hsmg101_col.nbmap`, `hsmg101_boat_col.nbmap`, apx 2(해시 이름) |
| `effect/` | 1 | `effect.xml` (VFXB, 10 MB) |
| `ftrg/` | 2 | `fx_hsmg101_pond.ftrg`, `se_hsmg101_pond.ftrg` |
| `data/` | 1 | `hsmg101_data.nkn`(→ 숫자 35행 CSV, 헤더 없음) |
| 루트 | 1 | `_hsmg101.bnbshpk` (6.3 MB) |

### 1.6 함정 [실행]

- **대소문자 충돌**: Windows에서 `romfs/System.nx.bea`(28 파일, `_BezelSystemResources/*`)와 `Archive/system.nx.bea`(8 파일, `system/*`)가 `extracted/bea/system.nx.bea` 한 폴더로 합쳐졌다. 경로는 겹치지 않는다.
- **파일·폴더 같은 이름**: `hs_system/layout.lyt`(묶음)와 `hs_system/layout.lyt/sys_*.lyt`가 함께 있다. 묶음 쪽은 `layout.lyt.__file__`로 저장했다(web/docs/analysis/00 §6).
- `hsmn08.nx.bea`에는 `flow/hsmn06/layout.lyt`가 들어 있다(hsmn06과 같은 경로, 같은 크기).

---

## 2. 형식별 버전과 구조

### 2.1 전체 확장자 표 [실행: pkg_inventory.py]

| 확장자 | 수 | 합계 크기 | 매직 |
|---|---|---|---|
| ftxb | 9,332 | 0.4 MB | (경로 문자열) |
| fskb | 7,398 | 151 MB | `FRES` |
| fmab | 6,596 | 7.6 MB | `FRES` |
| fvbb | 6,172 | 16 MB | `FRES` |
| fmdb | 2,406 | 520 MB | `FRES` |
| nkn | 1,044 | 0.97 MB | (암호문, 크기가 16의 배수) |
| ftrg | 968 | 9.0 MB | `FTRG` |
| msbt | 615 | 7.2 MB | `MsgStdBn` |
| bntx | 488 | 3.01 GB | `BNTX` |
| fsnb | 451 | 0.5 MB | `FRES` |
| apx | 315 | 23 MB | `SEBD` |
| bnvib | 259 | 0.3 MB | u32 4 또는 12 |
| fsst | 217 | 119 MB | `FSAR` |
| bnbshpk | 216 | 1.17 GB | `BEZSHAPK` |
| bnsh | 211 | 6.8 MB | `BNSH` |
| nbmap | 145 | 0.8 MB | `BEEGENTY` |
| xml | 125 | 226 MB | `VFXB` |
| lyt | 74 | 272 MB | `SARC` |
| ctga | 70 | 15 MB | TGA 헤더 |
| mpat | 66 | 14 KB | `mpbs` |
| bfsha | 35 | 88 MB | `FSHA` |
| fshb | 34 | 51 KB | `FRES` |
| mstl | 30 | 1.1 MB | |
| bffnt | 26 | 110 MB | `FFNT` |
| lua | 25 | 77 KB | `BZLA` |
| bspp | 10 | 0.2 MB | `snsp` 9, `BSPP` 1 |
| ftsb | 2 | 2 KB | `FRES` |
| msbp | 1 | 30 KB | `MsgPrjBn` |
| fspj | 1 | 67.5 MB | `FSAR` |
| entity | 1 | 1 KB | `BEEGENTY` |

- 작업 지시·SHARED.md 초기 메모의 개수(예: ".nkn 239개", "fskb 6209")는 이 표와 세는 기준이 다르다. 이 표는 `extracted/bea` 아래 해제 파일 전부를 확장자로 센 값이다. 정정 근거는 `analysis/asset_inventory.tsv`다.
- mpj에 있던 `.json`(393)·`.csv`(258)·`.msgpack`(174)은 mps에 **하나도 없다**. 그 자리를 `.nkn`이 대신한다(§3).

### 2.2 FRES (모델·애니) [실행]

- 버전: 23,057개 **전부 9.0.0.0**이다.
  - 내역: fskb 7,398 / fmab 6,596 / fvbb 6,172 / fmdb 2,406 / fsnb 451 / fshb 34.
  - `graphics_bfres2gltf stats extracted/bea`가 **failed 0**으로 끝났다(`extracted/converted/graphics/stats/all.json`). BfresLibrary가 9.0과 9.1을 같은 경로로 읽는다.
- 분리 파일 구조는 mpj와 같다: 모델(fmdb), 뼈 애니(fskb), 재질 애니(fmab, 텍스처 SRT는 `.ftsb.fmab`), 뼈 가시성(fvbb), 카메라·라이트(fsnb), 키셰이프(fshb).
- 애니:
  - 뼈 애니 회전은 전부 EulerXYZ다.
  - 스케일은 Standard 6,479, **Maya(세그먼트 스케일 보정) 919**다.
  - 베이크 애니는 없다.
  - 스켈레톤 회전은 Euler 2,393, Quaternion 13이다.
- 프리미티브: 삼각형 인덱스 u16 11,523, u32 92.
- **셰이더 아카이브가 mpj보다 다양하다** (재질 수):

  | 셰이더 아카이브 | 재질 수 |
  |---|---|
  | `forward_plus_map` | 1,924 |
  | `forward_plus_custom/forward_plus_color_custom` | 1,657 |
  | `forward_plus` | 842 |
  | `forward_plus_simple` | 631 |
  | `container/environment`·`posteffect` | 각 184 |
  | `light_model/directional·point·spot` | 156·55·29 |
  | `forward_plus_char` | 144 |
  | `forward_plus_plant` | 106 |
  | `forward_plus_fluid` | 60 |
  | `bezel_pbr` | 20 |
  | `forward_plus_water` | 16 |
  | `forward_plus_fur` | 13 |
  | `forward_plus_dbuffer` | 7 |
  | `container/fluid·gaussian·art·skybox` | 소수 |

  mpj는 `forward_plus` 하나다.
- **재질 옵션 이름이 다르다** **[데이터]**:
  - mpj의 `static_opt_*`가 하나도 없다. 옵션 키 257종이 다른 체계를 쓴다. 예: `use_normal_map`, `basecolor_source0~3`, `basecolor_map_uv_index0~3`, `material_layer_count`, `layered_occlusion_mode0~3`, `normal_map_mode0~3`, `use_shader_graph`.
  - **최대 4층 레이어 재질**로 보인다 **[추정]**.
  - mpj 변환기(`GltfExport.cs`)는 옵션이 없으면 켜진 것으로 보고, 슬롯(`_a0` `_n0` `_r0` `_m0`)으로 텍스처를 붙인다. 그래서 glb는 만들어지고 텍스처도 붙는다.
  - 하지만 UV 인덱스·레이어·알파 모드·양면·발광은 mps 옵션을 반영하지 않는다. **mps 재질 근사 규칙은 새로 정해야 한다** **[미확정]**.
- 뼈 userData `BEZ_ANIM_TRANSIT`(캐릭터 모델)과 모델 userData `LightAutoSetup`·`bezel_physics_animation_path`·`FLOWER_GEO_NUM`이 관측된다 **[데이터]**.
- 충돌 모델 `*_col.fmdb`가 FRES로 따로 있다. 예: hsmg101_col은 정점 4,800, 삼각형 600이다. 그래서 apx를 못 읽어도 웹 충돌 근사에 쓸 수 있다 **[데이터]**.

### 2.3 BNTX [실행: graphics_bntx.py stats]

- 9,332 텍스처가 전부 BNTX 0x00040100이다.
  - BRTI `flags` 0x09
  - tileMode 0
  - 레이어 stride 정확
  - mpj와 같은 형식
- 형식 분포:

  | 형식 | 수 |
  |---|---|
  | BC1_SRGB | 1,998 |
  | BC5_SNORM | 1,634 |
  | BC4_UNORM | 1,608 |
  | BC6H_UFLOAT | 1,314 |
  | BC3_SRGB | 652 |
  | BC5_UNORM | 515 |
  | ASTC8x8_SRGB | 331 |
  | BC7_SRGB | 327 |
  | ASTC12x12_SRGB | 291 |
  | 그 밖 | 소수 |
  | `0x15`(R16G16B16A16 FLOAT, mpj 판독) | 40 |
  | `0x0F`(R11G11B10 FLOAT) | 8 |

- 차원: 2D 8,211, **Cube 1,062**(`*_rad`·`*_irr`), 3D 58(LUT), 2DArray 1.
- 실제 디코드는 pc01_mario 16장과 hsmg101 40장으로 확인했다. 실패 0이고 BC6H 큐브도 포함한다. `pc01_body_alb` 영상을 눈으로 확인했다.
- `0x15`·`0x0F` 형식은 `graphics_bntx.py`의 FORMATS 표에 이름이 없다. png 디코드는 시험하지 않았다 **[미확정]**.

### 2.4 BFFNT [실행]

- 26개, FFNT 4.1.0.
- 시트 형식은 BC4(단색)와 **BC7_SRGB(컬러 폰트 `hsfont_mario`: 노랑·주황 그라데이션 + 보라 테두리)**다.
- `ui_font.py`가 BC7을 지원하지 않아 `fmt 0x20` 분기를 추가했다. 이후 `export`로 시트 23장과 메트릭을 냈다.
- `hsfont_middle_kr` 한글 렌더 시험은 정상이다(`extracted/converted/ui/font/hsfont_middle_kr_test.png`).
- 컬러 폰트의 `text` 렌더는 단색 시트를 전제한 코드라서 실패한다("illegal image mode"). 웹에서는 시트 png를 RGBA 그대로 쓰면 된다.

### 2.5 셰이더 [데이터]

| 파일 | 수 | 매직·버전 | 위치 |
|---|---|---|---|
| `.bnbshpk` | 216 | `BEZSHAPK`, 0x00010000 | 아카이브마다 하나(모델 셰이더 변형 묶음) |
| `.bfsha` | 35 | `FSHA` 0x00080000 | `System.nx.bea` `_BezelSystemResources/*/shader/`(pbr, ssg, water, ui, line …), `system_boot` |
| `.bnsh` | 211 | `BNSH` 0x0002010B | `system_boot_bnsh` |

웹에서는 원본 셰이더를 쓰지 않고 three.js 재질로 근사한다(mpj 03_graphics §7.3과 같은 방침).

### 2.6 레이아웃 `.lyt` [실행: ui_lyt.py survey]

- `.lyt`는 SARC다. 안에 `blyt/*.bflyt`, `anim/*.bflan`, `timg/__Combined.bntx`, `fcpx/*.bfcpx`가 있다. mpj와 같다.
- 74개 전부를 검사했다.
  - bflyt 949개(FLYT 9.0.0.0), bflan 2,533개
  - 섹션 크기 검증 **문제 0**
  - 섹션 종류: lyt1 txl1 mat1 pan1 pas1 pic1 pae1 grp1 usd1 fnl1 ali1 txt1 prt1 cnt1 bnd1 grs1 gre1 ctl1 wnd1 scr1
- **차이**: 일부 bflan은 `pat1`(태그 섹션) 없이 `pai1`만 있다(hsmg104의 3개 전부, 섹션 수 1). mpj 파서는 이때 `KeyError 'tag'`를 낸다. 그래서 프레임 범위를 `[0, frameSize]`로 대신 쓰도록 고쳤다.
- 레이아웃 텍스처는 mpj에서 BNTX-Extractor로 목록만 냈다. mps에서는 자체 `graphics_bntx`로 목록을 내고 png도 쓰게 고쳤다(`timg/`).
- 큰 레이아웃:

  | 파일 | 크기 |
  |---|---|
  | `hs_system/layout.lyt` | 80.9 MB |
  | `hsmn06`(=hsmn08) | 26 MB |
  | `hsmn02` | 24 MB |
  | `hsmn01` | 21 MB |
  | `emote` | 18 MB |
  | `thumbnail` | 16 MB |

### 2.7 FX 트리거 `.ftrg` [실행: ui_ftrg.py]

- 968개 전부 버전 **0x02160000**이다.
  - mpj는 0x021A0000이다.
  - mpj의 로더는 0x02180000~0x021A0000만 받았다. 그러니 mps가 더 옛 판이다.
- 객체 직렬화 규칙(슬롯 `{u32 종류, s32 오프셋}`, 0x91xx 타입)은 그대로 통한다. `survey` bad 0.
- 객체 타입: 0x9100~0x9108, 0x910a, 0x9114, 0x9115, 0x9116.
  - 루트 0x9100은 968개가 모두 같은 레이아웃이다.
  - 트리거 0x9101은 레이아웃 5종이다.
- 예: `se_hsmg101_pond.ftrg`는 트리거 `POND_WEAK/MID/STRONG`이다. 각각 0x9105 `{"mg/hsmg101/ftrg/SQ_SE_HSMG101_POND_WEAK", 50.0}`과 속성 `ParentGroupName`, `NdSoundNoneVisiblePlay`, `NdSoundNoneStop`을 가진다.
- `_fxdb.nkn`(→ CSV)이 모델별로 어떤 ftrg를 쓰는지 정한다(§3.3).

### 2.8 모션 전이표 `.mpat` — 새 형식 `mpbs` [데이터 + 실행]

mpj `tapm`(항목 0x30 B)과 다르다.

| 오프셋 | 형식 | 내용 |
|---|---|---|
| 0x00 | char[4] | `mpbs` |
| 0x04 | u32 | 헤더 끝 오프셋(관측 0x24) |
| 0x08 | u32 | 이름 길이(0x16) |
| 0x0C | char[] | `AnimTransitTable_1.0.0` + NUL |
| 헤더 끝 | u32, u32 | 표 오프셋, 항목 수 |
| 그 뒤 | 문자열 풀 | NUL 종결 |
| 표 | {u32 from, u32 to, u32 a, u32 b} × n | 오프셋 = 파일 절대, 0 = 이름 없음(아무 모션에서나) |

- 66개 전부 이 배치로 읽었고 꼬리 0바이트다(`extracted/converted/scene/mpat.json`).
- 예(`hs_system/data/chara_pc_anim_transit.mpat`, 35항목):
  - `(*) → bd_fall00 a=90 b=8`
  - `(*) → co_groggy_dmg00 a=5`
  - `co_hip_drop00a → co_hip_drop00b a=0`
- a는 블렌드 프레임 수로, b는 플래그로 **[추정]**한다. 의미는 **[미확정]**이다.
- 위치:
  - 공용: `hs_system/data/chara_{pc,npc}_anim_transit.mpat`
  - NPC 8개: `model/*_anim_transit.mpat`
  - 보드: `scene/hsbd00/mpat/*`

### 2.9 PhysX `.apx` — 3.4.0 [데이터 + 실행]

```
+0x00 'SEBD'  +0x04 u32 0x03040000 (PhysX 3.4.0)  +0x08 u32 binaryVersion 0  +0x0C u32 buildNumber 22121302
+0x10 'NX64'  +0x14 u32 markedPadding 1          → 0x20 부터 컬렉션(객체 수, manifest, import/export, 내부 참조)
```

- mpj(4.1.2)의 헤더는 0x30 B(빌드 해시 char[32])이고 mps는 0x18 B다. `scene_apx.py`에 3.4 헤더 분기를 넣었더니 manifest·export 목록까지 읽혔다.
  - 예: hsmg101 apx 하나는 `TRIANGLE_MESH_BVH33, MATERIAL, SHAPE, RIGID_STATIC, USER_1024` 순서다.
  - 3.4의 PxConcreteType 번호: 3 = BVH33, 6 = RIGID_DYNAMIC, 7 = RIGID_STATIC, 8 = SHAPE, 9 = MATERIAL. 단, **도구의 이름표는 4.1 기준이라 한 칸 밀려 출력된다**. 출력의 CONSTRAINT는 실제로 MATERIAL이다.
- 삼각 메시 객체의 본문 필드 배치(3.4 `Gu::TriangleMesh`)는 4.1과 달라 정점을 못 읽는다. PhysX 3.4 소스가 있어야 한다 **[미확정]**.
- 파일 이름은 32자리 해시(`ac7c9b86…apx`)다. `.nbmap` 충돌 컴포넌트가 이 경로를 가리킨다.

### 2.10 엔티티 배치 `.nbmap` [실행]

- `BEEGENTY` 0x000C0000은 mpj와 같다. `scene_nbmap.py --all`로 145개 전부 읽었다(`extracted/converted/scene/nbmap/`).
  - 엔티티 910, 트랜스폼 757, 충돌 531, 모델 287, 경로 20.
  - 충돌 속성 상위: (0,3,3,0) 197, (0,1,3,0) 113, (1,3,3,0) 44.
- 예: `hsmg101_boat_col.nbmap`은 엔티티 `hsmg101_boat`를 담는다(모델 `mg/hsmg101/model/hsmg101_boat.fmdb` + 충돌 `mg/hsmg101/map/09f5….apx`, 속성 (0,6,3,0)).

### 2.11 사운드 [실행]

| 파일 | 위치 | 내용 |
|---|---|---|
| `AddonAudioProject.fspj` (FSAR 0x00020500, 67.5 MB) | `Resident.nx.bea/_Resident/` | **메인 사운드 아카이브.** 문자열 8,298, 사운드 6,566, 사운드 그룹 122, 뱅크 107, 파형 아카이브 108, 플레이어 1,503, 파일 540 |
| `subarc_*.fsst` (FSAR, 217) | `sound~subarc_*.nx.bea/audio/sounddata/subarc_*/` | 장면별 서브아카이브. 예 `subarc_hsmg101`: 사운드 3(`SQ_SE_HSMG101_POND_WEAK/MID/STRONG`, 시퀀스), 뱅크 `BNK_SE_HSMG101`, FSEQ·FBNK·FWAR 각 1 |
| `*.bfstm` (FSTM 0x00060400, 209) | RomFS `stream/` | 48 kHz 201, 32 kHz 8(`*_MP1~3` 등). 2채널 205, 4채널 3, 8채널 1. 루프 84. 리전 있는 것 71. 합계 111.1분. DSP-ADPCM |
| `sound_settingpreset.bspp` (`BSPP`) | `audio.nx.bea/audio/settingpreset/` | 프리셋 194개(장면 이름별), 아카이브 이름 218, 공간 이름 9 |
| `snd_sp_*.bspp` (`snsp`, 9) | `sound~snd_sp_*.nx.bea` | 사운드 공간(형식 **[미확정]**) |
| `jump_setting/*.nkn` (115) | `audio.nx.bea` | **BGM 리전 점프 표(CSV)**. 열 `;Key,Label,Prm1..23`. 예: `reg_seq,REG_SEQ_A,9,TRUE,REG_A_START,REG_A_1…` / `jump,JMP_TO_MAIN,REG_SEQ_B`. mpj는 msgpack |
| `mgsound_setting.nkn` | `audio.nx.bea/audio/data/` | 미니게임별 BGM·징글·재생 위치 표. 헤더 행이 주석으로 있다(`;id,mg_name,inst_bgm_label,op_jingle_label,…,mg_bgm_label,…,mg_bgm_intro_skip,mg_bgm_play_offset,…,whistle_entry_type`) |

- FSAR 버전은 0x00020500이다(mpj 0x00020600). 그래도 `sound_fsar.py dump`가 메인·서브 모두 오류 없이 읽었다.
- `sound_seq.py`로 다음을 확인했다.
  - `disasm`: `opentrack/volume/prg/note/wait/fin`
  - `bank`: 악기 6, `waveArchive:0`
  - `render`: `SQ_SE_HSMG101_POND_WEAK` 2.23 s, 최대 0.134
- `sound_bfstm.py decode`(vgmstream)로 `SM_BGM_HSMG101_102_701_JMP`를 39.6 s, 7.6 MB wav로 풀었다. 리전은 `REG_INTRO_00`, `REG_MAIN_00` 등이다.
- `sound_preset.py`는 경로가 mpj와 같아 그대로 동작한다. 단 Windows 콘솔(cp949)에서는 `PYTHONIOENCODING=utf-8`이 필요하다.
  - 프리셋 레코드 타입 문자(`j e a b { ^ 0x87` …)와 슬롯 뜻은 **[미확정]**이다.
  - 데이터로 보면 환경음·공간·징글 치환·진동 이름이 들어 있다.

### 2.12 이펙트 VFXB [실행 + 데이터 + 판독]

- 위치: 장면 아카이브의 `<장면>/effect/effect.xml` 89개 + `hsmg80N_effect.xml` 등. 합계 125개, 226 MB.
  - mpj의 `_Vfx/<이름>/ConvertList.xml` 체계가 아니다. 그래서 `effect_vfxb.py check`의 파일 찾기 패턴에 `**/effect/*.xml`을 더했다.
- 헤더: `VFXB`, gfxApi 0x400, **vfx 버전 40**(125개 전부). mpj는 53이다.
- 섹션 트리는 그대로 읽힌다: ESTA/ESET/EMTR/GRTF/PRMA/TRMA/G3PR/GRSN.
  - 전체: 이미터셋 1,089, 이미터 3,674(자식 227).
  - 하위 섹션: CSDP 1,156, FSPN 331, FRND 222, CADP 126 …
  - `dump --png`로 hsmg101의 텍스처 22장 png와 `primitives.bfres`가 나왔다.
- **정정: EmitterData v40 배치 확정**(2026-10-05, vfx 담당). 이전 판은 "공개 소스의 어느 판과도 맞지 않는다 [미확정]"이었다.
  - 이미터 바이너리는 3,674개 전부 **0xB80 B**다. mpj v53 파서(0x1100 B 전제)와 EffectLibrary v40 분기(이름 96 B)는 둘 다 밀린다.
  - 실제 v40 = 이름 64 B(v39 꼴) + Static 0x780 B(v39 + unknown6·unknown7 f32×16) + EmitterInfo 0x88 + Inherit 0x20(+0x868 칸) + Emission 0x48 + Shape 0x60 + Render 0x10 + Particle 0x50 + 0x10 + ShaderRef 0x80 + Action 4 + Velocity 0x30 + f32×4 + Color 0x2C + Scale 0x24 + Fluc 0x0C + Sampler 0x20×3 + TexAnim 0x10×3 + reserved 0x40.
  - 근거: main nn::vfx2 판독(최대 입자 수 FUN_71009e8920, 이미터 갱신 FUN_71009f60d4, 방출 간격 FUN_71009f5788, 입자 초기값 FUN_71009f82a4, CPU 입자 갱신 FUN_71009fe0e0) + 전수 열 비교. `effect_vfxb.py check`: 크기 불일치 0, 텍스처 ID 4,190/4,190, 프리미티브 ID 417/417, 키표 18,370 이상 0 **[판독+실행]**.
  - 필드 표·계산식·웹 런타임: [web/docs/engine/08_effects.md](../engine/08_effects.md). 셰이더(파일 안 GRSN)는 미판독이라 GPU 이미터 운동식은 **[추정]**(CPU 식과 같다고 봄).

### 2.13 그 밖 [데이터]

| 형식 | 내용 |
|---|---|
| `.lua` 25 | `BZLA` + 16 B(해시로 보임 **[추정]**) + **Lua 5.2 바이트코드**(`\x1bLuaR`, 리틀엔디언, int 4·size_t 8·instr 4·number 8). 위치: `system_boot/kernel/libbex/script/{bex,bex_scene_base,bezel}.lua`, `system/script/gm*.lua`·`nd.lua`, 미니게임 7개(`hsmg206/411/423/435/436/703/705` `script/*.lua`). 루트의 `boot.lua`만 평문 |
| `.ctga` 70 | 무압축 TGA(type 2, 32bpp, 바닥→위) + TGA 2.0 꼬리(26 B). hsmg208·214 등 잉크 칠하기 게임의 CPU쪽 마스크로 **[추정]** |
| `.msbt` 615 | 15언어 × 41파일. 이름 키 `im_hsmgNNN_name` 등. `ui_msbp.py`로 `hs.msbp`를 읽음 **[실행]**: 속성(Position, WindowType, GuideMotion, Character `VC_PC01…`, VoiceKey), 스타일 616, 원본 소스 72 |
| `.bnvib` 259 | `hs_system/vib/*`. `ui_bnvib.py`로 표본 3개 변환 **[실행]** |
| `.entity` 1 | `System.nx.bea` 기본 글로벌 라이트(`BEEGENTY`) |

---

## 3. `.nkn` — 암호화 CSV [판독 + 실행]

### 3.1 형식

```
파일   = AES-128-CBC( CSV 텍스트(UTF-8) + 0x00 + PKCS#7 패딩 )      헤더 없음, 크기 = 16의 배수
키·IV  = main 이미지 상수 (rodata 0x117af09 16 B, 0x11427be 16 B — 값은 기록하지 않는다)
```

- 1,044개 **전부** 패딩이 맞고 UTF-8로 풀렸다(`analysis/nkn_catalog.tsv`).
- 결과는 `extracted/nkn/<아카이브>/<경로>.csv`다. 확장자만 `.nkn` → `.csv`로 바꿨다.
- 도구: `web/tools/analysis/nkn.py`. [structure] 담당이 먼저 같은 결과를 냈고, 이 판이 같은 출력을 바이트 단위로 재현한다.

### 3.2 누가 읽는가 [판독: main 디스어셈블]

| 함수 (main, 0x7100000000 +) | 하는 일 |
|---|---|
| `bex::DataCSV::Load(char const*)` @0x12d1dc | ① 경로 문자열의 끝 3글자를 지운다(`csv`). ② `"nkn"`(@0x114e19e)을 붙인다. ③ 파일 시스템 객체(0x5fbf00)로 읽는다. ④ `CbcDecryptor<AesDecryptor<16>>`를 키 @0x117af09·길이 0x10으로 초기화하고 IV @0x11427be를 둔다. ⑤ `Update`(@0x12e148)를 입력이 다 소비될 때까지 반복한다. ⑥ `strlen`으로 NUL까지 자른다. ⑦ CSV 파서(@0x12d674)에 넘긴다 |
| `bex::PropertyDict::Load(char const*)` @0x2bc004 | 같은 `csv→nkn` 치환을 쓴다(@0x2bc3d4). `*.mppd.nkn` 9개(형식 `key,type,values...`, 예 `CAGE_RADIUS,float,1.55`)를 읽는 쪽으로 **[추정]** |
| `hs::HsModel::Create` @0x63fa0 → 0x63fe0 | 모델 경로(가상 함수 +0x330)에 `"%s.nkn"`(@0x114a98b)을 붙여 있는지 본다. 있으면 `"%s.csv"`(@0x116be6e)로 이름을 바꿔 로드 함수(0x71890)에 넘긴다. 모델 옆 `_fxdb.nkn`의 진입으로 **[추정]**. `hs::HsModel::GetFxDBPath` @0x64210이 `"%s/%s_fxdb"`·`"%s/%s_443_fxdb"`를 만든다 |

즉 게임 코드는 언제나 `….csv` 경로로 요청하고, 디스크에는 `.nkn`만 있다. 예: main 문자열 `hs_system/data/characterlist.csv`.

### 3.3 내용 분류 [데이터]

| 분류 | 수 | 형식 | 예 |
|---|---|---|---|
| `*_fxdb.nkn` | 604 | `REGIDENT_FILE` / `PARENT_FILE` 블록, `TYPE_{OTHER,SE,VFX,VB,VO,PG},<ftrg 경로>` | `hsmg101_pond_fxdb` → `TYPE_SE,mg/hsmg101/ftrg/se_hsmg101_pond.ftrg` |
| `*/data/*.nkn` | 309 | 게임 데이터 표. 첫 행이 콤마만 있는 빈 헤더인 것이 많다(열 이름은 코드에 있음) | `characterlist`, `hs_mglist`, `hs_objectlist`, `hsmg101_data`(숫자 35행), `bex_scenelist` |
| `audio/jump_setting/*.nkn` | 115 | `;Key,Label,Prm1..` 주석 헤더 | §2.11 |
| `*.mppd.nkn` | 9 | `key,type,values...` | `hsmg106_property.mppd` |
| 그 밖 | 7 | `flow/hsmn06` 4, `_Resident/{CollisionLabel,FrameAttrTrack,PhysicsAttribute}Define` | |

표의 열 의미는 [03_game_structure.md](03_game_structure.md)를 본다(characterlist, hs_mglist, bex_scenelist 등).

---

## 4. 변환기 재사용 시험 [실행]

mpj 도구를 `F:/dev/mps/tools/`로 복사해 돌렸다. mpj 원본은 손대지 않았다. 출력은 `extracted/converted/` 아래다.

| 대상(표본) | 도구 | 결과 | 고친 점 (mps 사본만) |
|---|---|---|---|
| 캐릭터 pc01_mario: fmdb + 클립 4(`co_idle00`, `co_run00`, `co_win00a`, `co_jump00a`) + fvbb/ftsb.fmab 8 | `graphics_bfres2gltf`(재빌드) + `graphics_bntx.py` + `graphics_convert.py mps_pc01` | **성공.** 노드 90, 뼈 84, 메시 5, 정점 6,839, 삼각형 5,060, 스킨 1. 바인드 오차 2.9e-7. 텍스처 16장 png. `combine` mr.png 2장. three GLTFLoader 오류 0(bindErr 1.1e-7, clips 4) | `graphics_convert.py`에 `mps_pc01`·`mps_hsmg101` 세트 추가(mps 경로) |
| 미니게임 hsmg101 모델 8개 + 비뼈 애니 14 + env 3 | 같음 `mps_hsmg101` | **성공.** bg(정점 63,424), boat(+클립 4), clouds(+1), col, fld, pond, pos_op/end3. 텍스처 40장(BC6H 큐브 5 포함) 실패 0. three 로드 오류 0 | — |
| FRES 전량 23,057 | `graphics_bfres2gltf stats` | **로드 실패 0**(`stats/all.json`) | — |
| 재질 근사 | `GltfExport.cs` | **부분.** mps 옵션 이름(`use_*`, `*_source0..3`)을 모르니 슬롯 기본값으로만 붙는다 | 미수정. mps 규칙 필요 |
| 텍스처 BNTX 전량 헤더 | `graphics_bntx.py stats` | 9,332 전부 읽음 | — |
| 레이아웃 hsmg104 | `ui_lyt.py dump` | **성공**(bflyt 1, bflan 3, 텍스처 4 png, 페인 트리) | ① `pat1` 없는 bflan 허용 ② 텍스처 목록을 BNTX-Extractor 대신 자체 `graphics_bntx`로 + png 출력 |
| 레이아웃 전량 74 | `ui_lyt.py survey` | bflyt 949·bflan 2,533 **문제 0** | — |
| 폰트 hsfont_mario, hsfont_middle_kr | `ui_font.py` | **성공**(BC7 컬러 시트 23장, 한글 텍스트 렌더) | ① BC7 시트 디코드 추가 ② `tools/oss/BNTX-Extractor` 복사(의존성). 컬러 폰트 `text` 렌더는 미지원 |
| 사운드 subarc_hsmg101.fsst, AddonAudioProject.fspj | `sound_fsar.py dump` | **성공**(JSON) | — |
| 시퀀스 `SQ_SE_HSMG101_POND_WEAK` | `sound_seq.py disasm/bank/render` | **성공**(wav 2.23 s, 렌더러는 mpj와 같은 근사 **[추정]**) | — |
| 스트림 `SM_BGM_HSMG101_102_701_JMP` | `sound_bfstm.py info/decode` + vgmstream | **성공**(39.6 s wav, 리전 3) | — |
| BFSTM 전량 209 | `sound_bfstm.info` | 전부 읽음 | — |
| 사운드 프리셋 | `sound_preset.py list/show` | **성공**(194 프리셋) | 콘솔 인코딩만(`PYTHONIOENCODING=utf-8`) |
| 이펙트 hsmg101 `effect.xml` | `effect_vfxb.py tree/dump --png` | **성공**(v40 표 추가 뒤). 섹션 트리·텍스처 22 png·`primitives.bfres`·이미터 필드 | `check`가 `**/effect/*.xml`도 찾게, **EmitterData V40 표** |
| 이펙트 같은 파일 | EffectLibrary EffectConverter(빌드) | **부분.** 파싱은 끝나지만 v40 필드가 밀림. 버전 39로 바꿔 읽혀도 EmitterInfo부터 어긋남 | `using EffectLibrary.EFT2;`, 출력 폴더 이름에서 NUL·제어 문자 제거 |
| FX 트리거 hsmg101 2개 + 전량 968 | `ui_ftrg.py dump/survey` | **성공**(bad 0) | — |
| 모션 전이표 66 | `scene_mpat.py` | mpj 파서 **실패**(`not tapm`) → `mpbs` 파서 추가 후 **성공** | `parse_mpbs` 추가 |
| PhysX apx hsmg101 2개 | `scene_apx.py` | 헤더 **실패**(ascii) → 3.4 헤더 추가 후 manifest·export **성공**, 메시 본문 **실패** | 3.4 헤더 분기 |
| 엔티티 nbmap 145 | `scene_nbmap.py --all` | **성공** | — |
| 진동 bnvib 3 | `ui_bnvib.py` | **성공** | — |
| 메시지 프로젝트 `hs.msbp` | `ui_msbp.py` | **성공** | — |
| 데이터 `.nkn` 1,044 | `nkn.py`(신규) | **성공** | — |

### 4.1 산출물 위치

| 경로 | 내용 |
|---|---|
| `extracted/converted/graphics/mps_pc01/` | `model/pc01_mario.glb`, `tex/*.png+json`, `anim/*.json`, `meta/`, `manifest.json`, `verify_three.json` |
| `extracted/converted/graphics/mps_hsmg101/` | 같은 구성(모델 8, env 덤프 3) |
| `extracted/converted/graphics/pc01_mario/` | 처음 손으로 돌린 같은 변환(중복본, 지워도 됨) |
| `extracted/converted/graphics/stats/` | `all.json`(FRES 전량), `pc01_mario.json`, `hsmg101.json`, `bntx_stats.json` |
| `extracted/converted/ui/hsmg104/` | 레이아웃 JSON·트리·`timg/*.png` |
| `extracted/converted/ui/font/` | `hsfont_mario/`(시트 23 + 메트릭), 한글 렌더 시험 png |
| `extracted/converted/ui/ftrg/`, `ui/bnvib/`, `ui/msbp.json` | |
| `extracted/converted/sound/` | `AddonAudioProject.json`, `subarc_hsmg101.json`, `SQ_SE_HSMG101_POND_WEAK.wav/.json`, `SM_BGM_HSMG101_102_701_JMP.wav` |
| `extracted/converted/effect/hsmg101/`, `effect/hs_system/` | `vfxb.json`(v40 배치), `tex/*.png`, `textures.bntx`, `primitives.bfres` |
| `extracted/converted/effect/effectlib/` | EffectLibrary 시험 출력(원판과 v39 강제판) |
| `extracted/converted/scene/` | `mpat.json`, `nbmap/*.json|txt` |
| `extracted/nkn/` | 복호한 CSV 1,044 |

---

## 5. 캐릭터 목록 [데이터: `hs_system/data/characterlist.csv`]

60행, 열 76개. 첫 행은 빈 헤더다.

확인한 열:

| 열 | 내용 |
|---|---|
| 0 | 이름 키 |
| 1 | 번호 |
| 2·3 | 아카이브 논리이름 |
| 4 | 모델 |
| 5 | 모션 접두 |
| 9 | 모델 접두 |
| 10~13 | `effect.csv`, `effect_cut.csv`, `se.csv`, `vo.csv` |
| 14·15 | `mfa.nmfa`, `mfa_cut.nmfa` |
| 16 | `anim_transit.mpat` |
| 17 | 이름 메시지 키 |

- 열 10~15가 가리키는 `.csv`/`.nmfa`는 캐릭터 아카이브에 **없다**(nmfa는 전체에 0개). 대신 `model/<캐릭터>_fxdb.nkn`이 있다. 옛 열로 **[추정]**한다.
- 나머지 열(크기·카메라·눈 UV SRT `eye_m,texsrt1…`, `attach_head` 등)의 의미는 web/docs/analysis/03·후속 캐릭터 문서에서 다룬다.

| 키 | 번호 | 아카이브 | 모델 |
|---|---|---|---|
| MARIO | 1 | `chara~pc~pc01_mario` | `pc01_mario.fmdb` |
| LUIGI | 2 | `chara~pc~pc02_luigi` | `pc02_luigi.fmdb` |
| PEACH | 3 | `chara~pc~pc03_peach` | `pc03_peach.fmdb` |
| DAISY | 4 | `chara~pc~pc04_daisy` | `pc04_daisy.fmdb` |
| WARIO | 5 | `chara~pc~pc05_wario` | `pc05_wario.fmdb` |
| WALUIGI | 6 | `chara~pc~pc06_waluigi` | `pc06_waluigi.fmdb` |
| YOSHI | 7 | `chara~pc~pc07_yoshi` | `pc07_yoshi.fmdb` |
| ROSETTA | 11 | `chara~pc~pc11_rosetta` | `pc11_rosetta.fmdb` |
| DK | 12 | `chara~pc~pc12_dk` | `pc12_dk.fmdb` |
| CATHERINE | 13 | `chara~pc~pc13_catherine` | `pc13_catherine.fmdb` |

NPC 50행이 아카이브 42개를 쓴다(변형이 아카이브를 같이 쓴다).

| NPC 키 (번호) | 아카이브 `chara~npc~` | 비고 |
|---|---|---|
| KOOPA 0 | npc000_koopa | |
| KURIBO 1, KURIBO_GOLD 1, KURIBO_PAINT 1 | npc001_kuribo | 모델 `npc001`, `npc001gd`, `npc001pt` |
| HEYHO 2, _PROPELLER, _ZENMAI, _POSTMAN | npc002_heyho | 모델 a/b/c 변형 |
| NOKONOKO 3, BOMBHEI 4 | npc003, npc004 | |
| PACKUNFLOWER 5, GOOLINDAI 6 | npc005_packunflower | GOOLINDAI 모델 `npc005a_goolindai` |
| KILLER 6, PUKUPUKU 7, PAIPO 8 | npc006, npc007, npc008_togezo | PAIPO 모델 `npc008a_paipo` |
| CHOROPOO 9, BASABASA 10, PENGUIN 11, DOSSUN 12, MET 13, JUGEMU 17 | npc009~013, npc017 | |
| HANACHAN_BUTTERFLY 20 | `npc020_hanachan` | **아카이브·모델 파일이 없다** |
| KOOPA_JR 21, KINOPIO 22, GESSO 23, TERESA 25, WANWAN 26, BATTAN 27 | npc021~027 | |
| KING_TERESA 32, BILIKYU 33, UNIRA 35, KANIBO 36, HAMMER_BROS 44 | npc032~044 | |
| SAMBO 46, SAMBO_BODY 47 | npc046_sambo | 머리·몸 모델 분리 |
| TEREN 48, EYEKUN 49, KAMECK 51, PATAPATA 53, BAKUBAKU 62, MUCHO 67 | npc048~067 | |
| YOSHI(NPC) 71, BOSS_PACKUN 72, KURIBON 79, KINOPICO 88, KOPENGUIN 91, UKKEY 92 | npc071~092 | |
| KOOPA_SUITS 100, KOOPA_CLOWN 101, JR_CLOWN 102 | npc100~102 | |

- `chara~pc~*_443` 10개는 목록에 없다. 이름과 내용(`ftrg443/`)으로 보아 미니게임 hsmg443 전용 FX 트리거다 **[추정]**. `hs::HsModel::GetFxDBPath`의 `"%s/%s_443_fxdb"`와 `fxtrigger_base_443`이 짝이다.
- 캐릭터 아카이브 하나의 구성은 pc01_mario를 예로 들면 다음과 같다(1,709 파일).

  | 파일 | 수 |
  |---|---|
  | fmdb | 1 |
  | bntx | 1(텍스처 16) |
  | ftxb | 16 |
  | 모션 | 562 클립(fskb 562, fvbb 561, ftsb.fmab 561) |
  | ftrg | 4(fx/se/vb/vo) |
  | `_fxdb.nkn` | 2 |
  | `.bnbshpk` | 1 |

  모션 접두 상위: `co_` 83, `bd_` 63, `mm_` 24, `sys_` 13 …

---

## 6. 웹 포팅용 에셋 파이프라인 (권장)

| 단계 | 입력 | 도구 | 출력 | 원본과 같게 지킬 것 |
|---|---|---|---|---|
| 1 | `.nkn` | `nkn.py` | CSV(UTF-8) | 행 순서 = ID(예: MINIGAME_ID = hs_mglist 행 순서, web/docs/analysis/03). 빈 헤더 행 유지 |
| 2 | fmdb + fskb/fvbb/ftsb.fmab/fsnb | `graphics_convert.py`(세트 함수 추가) | glb + 베이크 JSON | 시간 = 프레임/60, EulerXYZ(three order `'ZYX'`), Maya 스케일 클립은 `scaleMode`만 남음(mpj 03 §7) |
| 3 | bntx | `graphics_bntx.py png` | png / hdr | BC6H는 `.hdr`도 냄. SNORM은 `v·0.5+0.5` |
| 4 | 재질 | (새로 만들 것) | three 재질 | mps 옵션 체계(`*_source0..3`, `material_layer_count`)를 판독한 뒤 근사 |
| 5 | lyt | `ui_lyt.py dump` | JSON + png | 1920×1080 기준, pat1 없는 애니는 0..frameSize |
| 6 | bffnt | `ui_font.py export` | 시트 png + 메트릭 | 컬러 폰트(BC7)는 RGBA 그대로 |
| 7 | 사운드 | `sound_bfstm.py decode`, `sound_seq.py render`, `sound_fsar.py dump` | wav/ogg + 라벨 매니페스트 | BGM 리전·점프는 `jump_setting` CSV, 미니게임별 선택은 `mgsound_setting` CSV |
| 8 | 충돌 | `*_col.fmdb`(glb) 또는 apx(3.4 판독 필요) + `scene_nbmap.py` | 메시 + 배치 JSON | nbmap 트랜스폼 그대로 |
| 9 | 이펙트 | `effect_vfxb.py dump --png` → 게임별 웹 변환(예 `hsmg402_web_assets.py --only-effects`) | png + 이미터셋 JSON(v40 summary) | 런타임 `web/script/view/vfx.ts`, 식은 web/docs/engine/08_effects.md 6 |

---

## 7. 재현 명령

```sh
cd F:/dev/mps
P=.venv/Scripts/python
X=web/tools/analysis/graphics_bfres2gltf/bin/Release/net7.0/graphics_bfres2gltf.exe
export PYTHONIOENCODING=utf-8

$P web/tools/analysis/pkg_inventory.py                                     # analysis/asset_inventory.tsv (느림: 37k 파일)
$P web/tools/analysis/nkn.py all                                           # extracted/nkn + analysis/nkn_catalog.tsv
(cd web/tools/analysis/graphics_bfres2gltf && dotnet build -c Release)
$P web/tools/analysis/graphics_convert.py mps_pc01 mps_hsmg101
WEB_MODULES=C:/dev/mpj/web/node_modules node web/tools/analysis/graphics_verify/run.mjs web/tools/analysis/graphics_verify/check.ts mps_pc01 mps_hsmg101
$X stats extracted/bea extracted/converted/graphics/stats/all.json
$P web/tools/analysis/graphics_bntx.py stats extracted/bea extracted/converted/graphics/stats/bntx_stats.json
$P web/tools/analysis/ui_lyt.py dump extracted/bea/hsmg104.nx.bea/mg/hsmg104/layout.lyt extracted/converted/ui/hsmg104
$P web/tools/analysis/ui_font.py export extracted/bea/Parts.lyt.nx.bea/Parts.lyt/Font/hsfont_mario.bffnt extracted/converted/ui/font/hsfont_mario
F="extracted/bea/sound~subarc_hsmg101.nx.bea/audio/sounddata/subarc_hsmg101/subarc_hsmg101.fsst"
$P web/tools/analysis/sound_fsar.py dump "$F" extracted/converted/sound/subarc_hsmg101.json
$P web/tools/analysis/sound_seq.py render "$F" SQ_SE_HSMG101_POND_WEAK extracted/converted/sound/SQ_SE_HSMG101_POND_WEAK.wav 5
$P web/tools/analysis/sound_bfstm.py decode extracted/romfs/stream/SM_BGM_HSMG101_102_701_JMP.dspadpcm.bfstm extracted/converted/sound/SM_BGM_HSMG101_102_701_JMP.wav
$P web/tools/analysis/effect_vfxb.py dump extracted/bea/hsmg101.nx.bea/mg/hsmg101/effect/effect.xml extracted/converted/effect/hsmg101 --png
$P web/tools/analysis/effect_vfxb.py check extracted/bea
$P web/tools/analysis/scene_nbmap.py --all --out extracted/converted/scene/nbmap
$P web/tools/analysis/scene_apx.py extracted/bea/hsmg101.nx.bea/mg/hsmg101/map/*.apx
```

- main 주소를 볼 때는 `web/tools/analysis/xref_scan.py <bin> <주소>`(ADRP+ADD/LDR 참조 찾기)와 `web/tools/analysis/asm_dis.py <bin> <시작> <개수>`(capstone)를 쓴다. 둘 다 이번에 만든 작은 도구다.
- 복사한 외부 소스: `tools/oss/BfresLibrary`, `tools/oss/EffectLibrary`(2곳 수정), `tools/oss/BNTX-Extractor`, `tools/vgmstream`. 모두 mpj `tools/oss`에서 가져왔다.

---

## 8. 미확정 사항과 필요한 근거

| 항목 | 현재 | 필요한 근거 |
|---|---|---|
| mps 재질 옵션(`*_source0..3`, `material_layer_count`, `lighting_mode` 등) → 웹 재질 근사 | 옵션 키 257종 목록만 있음(`stats/all.json` `mat.option.*`) | `forward_plus_*` 셰이더 옵션 표 판독 또는 값별 재질 표본 비교 |
| VFXB v40 GPU 셰이더 식(운동·빌보드 크기·색 합성) | **EmitterData 배치는 확정**(2026-10-05, 08_effects.md 4.3). CPU 입자 식 판독, GPU 쪽은 CPU 식과 같다고 [추정] | 파일 안 `GRSN`(BNSH) GLSL 변환 판독 |
| PhysX 3.4 삼각 메시 본문 | 헤더·manifest·export까지 | PhysX 3.4 `GuMeshData`/`TriangleMesh` 직렬화 소스(oss에 없음) |
| `mpbs` 항목 a·b 의미 | a = 블렌드 프레임, b = 플래그로 **[추정]** | 모션 전이 코드(main `BEZ_ANIM_TRANSIT` 사용처) 판독 |
| `snsp` 사운드 공간, BSPP 레코드 타입 | 파서 동작, 의미 미상 | bex sound 코드 판독 |
| 로캘별 `Parts_*`·`font_holder_*` 선택 규칙 | 문자열만 확인 | 로더 함수 판독(web/docs/analysis/02) |
| 장면 → 사운드 서브아카이브·캐릭터 아카이브 적재 경로 | scenelist·preset·mgsound_setting 데이터로 묶음 추정 | 장면 로더 판독(web/docs/analysis/02·03) |
| BNTX `0x15`·`0x0F` FLOAT 48장 디코드 | 미시험 | `graphics_bntx.py` FORMATS 추가 후 표본 확인 |
| `BZLA` 16 B 필드 의미, Lua 5.2 디컴파일 | 형식만 확인 | unluac 등으로 디컴파일 시험 |
| `.ctga` 쓰임 | 이름으로 추정 | hsmg208·214 코드 |
| characterlist 열 10~15(`effect.csv` 등)의 쓰임 | 파일 없음 | 캐릭터 생성 코드 판독 |
