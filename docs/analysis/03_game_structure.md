# 03. 게임 구조 — 모드·장면 흐름·보드·미니게임 분류·데이터 표

2026-10-05. 담당: structure. 상태: **구조 분석 1차 완료**. 세부 로직(보드 이벤트, 미니게임 선택 규칙, 모드 진행)은 다음 단계에서 판독한다. 미확정 항목은 11절에 모았다.

확정 수준 표기:
- **[실행]**: 이 문서의 도구를 실제로 돌려 확인했다. 원본 게임을 실행한 것은 없다.
- **[판독]**: main/NRO 명령을 capstone으로 디스어셈블해 읽었다. Ghidra 디컴파일은 쓰지 않았다.
- **[데이터]**: 추출 파일(복호한 CSV, 메시지, 장면 목록)에서 확인했다.
- **[추정]**: 근거는 있지만 코드로 닫지 못했다.
- **[미확정]**: 근거가 없거나 서로 맞지 않는다.

주소 규칙: `main+0x46980`은 `extracted/exefs/main.decomp.bin` 평면 이미지의 오프셋이다. Ghidra(SwitchLoader 기본 베이스)에서는 `0x7100046980`이다. NRO 주소는 모듈 이름을 함께 쓴다.

---

## 1. 요약

| 질문 | 결론 | 근거 | 수준 |
|---|---|---|---|
| 데이터 표는 어디 있나 | `.nkn` 1,044개 = AES-128-CBC 암호화 CSV. 복호하면 미니게임·캐릭터·장면·보드 표가 다 나온다 | main `bex::DataCSV::Load` +0x12d1dc | 판독+실행 |
| 미니게임 분류 기준 | `hs_mglist.csv` 열1 = 분류 7종(0~6), 코인·쿠파는 별도 플래그 | main `MGList::GetType` +0x46dcc 외 | 판독+데이터 |
| 코드 앞자리 | 1xx=1 vs 3, 2xx=2 vs 2, 4xx=4인, 5xx=2 vs 2 스포츠, 6xx=퍼즐, 7xx=듀얼, 8xx=코인(인원 혼합), 9xx=아이템 | 4.2절 | 데이터 |
| hsmg901~905 | **아이템 미니게임**. 보드 아이템 칸에 멈추면 1인이 플레이해 아이템을 얻는다. 미니게임 목록(100개)에는 들어가지 않는다 | `hs_bd00` 메시지 `bd00_map_c03_details00`, hsbd01 `event::ItemMgCall` | 데이터 |
| 원작 출처 | 데이터는 **N64/GC 팩 소속**만 알려준다(N64 51, GC 28). 마리오 파티 1·2·3 중 어느 것인지는 데이터에 없다 | 4.6절 | 데이터 / 세부는 미확정 |
| 장면 전환 | Bezel 장면 스택. `CallScene`(넣기)·`ReturnScene`(빼기)·`ChangeScene`(교체). 시작 장면은 `hsmn00` | main +0x25830, +0x34b408~ | 판독 |
| 보드 5종 | NRO 하나(`hsbd01`)가 다섯 보드를 모두 돌린다. 장면 이름만 다르고 클래스는 `hsbd01::SceneHsbd01` 하나 | `bex_scenelist.csv` | 데이터 |
| 플레이어블 | 10명(마리오·루이지·피치·데이지·와리오·와루이지·요시·로젤리나·동키콩·캐서린) | `characterlist.csv` | 데이터 |

---

## 2. 분석 대상과 자료

| 자료 | 위치 | 비고 |
|---|---|---|
| 원본 | Mario Party Superstars US v0 | [00_extraction_pipeline.md](00_extraction_pipeline.md) |
| main 평면 이미지 | `extracted/exefs/main.decomp.bin` | 동적 심볼 3,505개 |
| NRO | `extracted/romfs/nro/NX_Release/*.nro` | 126개 |
| BEA 해제본 | `extracted/bea/<아카이브>.nx.bea/` | |
| 복호 CSV | `extracted/nkn/<아카이브>.nx.bea/<경로>.csv` | 3절 |
| 메시지 | `extracted/message/{KRko,USen}/*.json` | |
| 미니게임 카탈로그 | `analysis/minigame_catalog.tsv` | 이번에 열 추가(4.10절) |

새로 만든 도구:

| 도구 | 용도 |
|---|---|
| `web/tools/analysis/nkn.py` | `.nkn` 복호. 처음 판은 structure가 썼고, assets 담당이 같은 출력 규칙으로 다시 썼다(SHARED.md 기록). `nkn.py all` → `extracted/nkn/` + `analysis/nkn_catalog.tsv` |
| `web/tools/analysis/build_mg_catalog.py` | `minigame_catalog.tsv` 열 보강(4.10절) |

---

## 3. 데이터 표(.nkn)

### 3.1 형식 [판독+실행]

`bex::DataCSV::Load(const char*)` main+0x12d1dc가 읽는다.

1. 경로 끝 3글자(`csv`)를 잘라 내고 `nkn`을 붙인다. 문자열 `"nkn"`은 main+0x114e19e다.
2. 파일 전체를 읽는다.
3. `nn::crypto::CbcDecryptor<AesDecryptor<16>>`를 키(main+0x117af09, 16 B)와 IV(main+0x11427be, 16 B)로 초기화한다. 이어서 `Update`(main+0x12e148)를 반복해 전부 푼다.
4. 결과를 `strlen`까지 CSV로 파싱한다(main+0x12d674).

- 평문은 CSV 텍스트, NUL 1바이트, PKCS#7 패딩 순서다. 1,044개 전부 패딩이 정상이고 UTF-8이다(`analysis/nkn_catalog.tsv`) [실행].
- 키·IV 값은 문서와 로그에 적지 않는다. 도구가 main 이미지에서 직접 읽는다.
- 게임 코드는 경로를 `.csv`로 부른다. 예: `"hs_system/data/hs_mglist.csv"`(main+0x1168960).

CSV 읽기 API는 `bex::DataCSV::GetStr(row, col)`(+0x12dd60), `GetInt`(+0x12ddbc), `GetFloat`(+0x12de94)다. 첫 줄은 콤마만 있는 빈 헤더다. 그래서 **열 이름은 파일에 없다. 읽는 코드에서 알아내야 한다.** 행 번호는 헤더를 포함해 센다. `hs_mglist`의 데이터 행 i는 row i+1이다.

### 3.2 게임 구조에 쓰이는 표 [데이터]

| 파일 (`extracted/nkn/…`) | 내용 | 행 | 이 문서 |
|---|---|---|---|
| `hs_system.nx.bea/hs_system/data/hs_mglist.csv` | 미니게임 마스터(분류·플래그·팩·일본어 이름) | 105 | 4절 |
| `hs_system…/hs_mgsetting.csv` | MINIGAME_ID별 설정 15열 | 75+ | 열 의미 미확정 |
| `hs_system…/hs_instsetting.csv` | MINIGAME_ID별 설명 화면 설정(열1 = 1~10) | 105 | 열 의미 미확정 |
| `hs_system…/characterlist.csv` | 캐릭터(PC 10, NPC 50) 이름·아카이브·모델·모션·수치 | 60 | 7절 |
| `hs_system…/hs_objectlist.csv` | 보드 오브젝트·아이템 모델 | 40 | 8절 |
| `hs_system…/hs_house_booklist.csv` | 데이터 하우스 도감(캐릭터 49·시리즈 10·맵 5·팁 34) | 98 | 6·7절 |
| `hs_system…/hs_house_musiclist.csv` | 뮤직 목록. 미니게임 BGM과 코드가 연결된다 | | 카탈로그 `bgm` 열 |
| `hs_system…/hs_shoplist.csv` | 상점 상품(스탬프 등) | | 범위 밖 |
| `system.nx.bea/system/data/bex_scenelist.csv` | **장면 목록**: 장면 이름 → 아카이브·클래스 | 160 | 5절 |
| `hsmm00.nx.bea/scene/hsmm00/data/hsmm01mglist.csv` | 프리 플레이 목록 순서(코드·MINIGAME_ID·장르 2열) | 101 | 4.9절 |
| `hsmm00…/hsmmmgpack.csv` | 데일리 트라이얼 팩(3게임 묶음) | 21 | 4.9절 |
| `hsmm00…/hsmmvs3pack.csv` | 3인 챌린지 단계별 1 vs 3 5게임 | 6 | 4.9절 |
| `hsmm00…/hsmmruleinfo.csv` | 미니게임 마운틴 코스 ↔ 장면 ↔ 설명 메시지 | 8 | 5.3절 |
| `hsbd0N.nx.bea/scene/hsbd0N/data/hsbd0N_map.csv` | 보드 N의 칸 그래프 | 67~137 | 6.3절 |
| `hsbd00.nx.bea/scene/hsbd00/data/*.csv` | 보드 공통 표(아이템 칸·상점·럭키/쿠파 룰렛·팀 편성 등) 30개 | | 6.2절 |
| `hsmn09.nx.bea/flow/hsmn09/data/achieve_list.csv` | 업적 화면 | | 범위 밖 |

---

## 4. 미니게임 분류

### 4.1 `hs::MGList` — 마스터 표의 메모리 구조 [판독]

로더는 main+0x46980(심볼 없음)이고, hs 초기화 함수 main+0x254c8에서 불린다. 이 로더가 `hs_mglist.csv`를 읽어 전역 배열에 채운다.

- 배열은 main+0x15cfac0(.bss)이다. 항목 0x69(105)개, 한 항목 0x1C4 B다.
- 채우기 전에 0xB964 B를 0으로 지운다.
- **MINIGAME_ID는 CSV 데이터 행 번호(0부터)다.** 그래서 ID 0 = hsmg401 … 48 = hsmg449, 49 = hsmg101 … 104 = hsmg905다. `hsmm01mglist.csv` 열1의 ID와도 맞는다(예: hsmg419 = 18) [데이터].

| 오프셋 | 형 | CSV 열 | 내용 | writer | reader |
|---|---|---|---|---|---|
| +0x000 | char[0x20] | 0 | 코드 `hsmgNNN` | 로더 | `GetNameFromID` +0x46d50 |
| +0x020 | char[0x20] | 0 | 아카이브 이름(코드와 같음) | 로더 | `GetArchiveName` +0x46d8c |
| +0x040 | char[0x20] | — | `sprintf("im_%s_name", 코드)` (형식 main+0x1130ebf) | 로더 | `GetNameLabel(id, false)` +0x46e10 |
| +0x060 | char[0x20] | — | 대체 이름 라벨. 로더가 쓰지 않아 비어 있다 → `GetNameLabel(id, true)`는 null | — | `GetNameLabel(id, true)` |
| +0x080 | s32 | 1 | **분류(type)** 0~6 | 로더 `GetInt(r,1)` | `GetType` +0x46dcc, `IsPuzzleMg` |
| +0x084 | s32 | 2 | 전부 0 | 로더 | 미확인 |
| +0x088 | char[0x134] | 16 | 디버그 이름(일본어) | 로더 | `GetDebugName` +0x4733c |
| +0x1BC | u32 | 0 | 코드 문자열 해시(main+0x370f20) | 로더 | `FindIDFromName` +0x46cb8 |
| +0x1C0 | u32 | 3~15 | 플래그(아래 표) | 로더 | 각 Is 함수 |

플래그 비트 (+0x1C0):

| 비트 | CSV 열 | 값 분포 | reader | 의미 | 수준 |
|---|---|---|---|---|---|
| 0 | 3 | 105개 모두 1 | `IsBdPlayAvailable` +0x46e64, `IsMmPlayAvailable` +0x46eac(같은 비트를 읽는다), `GetMmPlayAvailableList` +0x47190 | 보드·마운틴 사용 가능 | 판독 |
| 1 | 4 | 모두 0 | `IsNo2Players` +0x46ef4 | 2인 플레이 불가 | 판독(이름) |
| 2 | 5 | 모두 0 | 무명 +0x46f3c ← `RewardMgr::GetMaripaLevel` +0x7e6d4 | 미확정 | 판독 |
| 5 | 6 | 29개 | 무명 +0x46f84 ← `GameWork::DecideParamInstToMiniGameMain` +0x35e0c | 1이면 설명 화면 → 본편 전환 때 플레이어 순서(GW_ORDER)를 섞는다(main+0x32b68 Fisher–Yates). 0이면 순서 0,1,2,3 고정 | 판독 |
| 6 | 7 | hsmg803만 | 무명 +0x46fcc ← `UIMGStatus::Create`·`CreateTeam` | 상태 UI 변형 | 판독(용도 미확정) |
| 8 | 8 | 801~810 | `IsCoinMg` +0x47014 | **코인 미니게임** | 판독 |
| 9 | 9 | 431·435·436 | `IsKoopaMg` +0x4705c | **쿠파 미니게임** | 판독 |
| 10~15 | 10~15 | 4.5절 | `IsCurrentMgPack` +0x47104 | 미니게임 팩 0~5 소속 | 판독 |

그 밖의 판정 함수:
- `IsPuzzleMg`(+0x470a4): `id == 0x61`(hsmg601)이거나 `type == 4`이면 참이다 [판독].
- 무명 함수 +0x47180: `(id − 0x5E) < 6`이면 참이다. ID 94~99 = 501·502·503·601·602·603, 곧 "스포츠 & 퍼즐" 판정이다. `SceneMiniGameBase::MainLoop`·`CleanupGame`에서 부른다 [판독].
- 범위 밖 ID(≥ 0x69)는 모든 getter가 abort(main+0xf9f9b0)한다 [판독].

### 4.2 분류(type) 값 [판독+데이터]

| type | 분류 | 인원 구성 | 코드 | 개수 | 근거 메시지 |
|---|---|---|---|---|---|
| 0 | 4인 대전 | 1:1:1:1 | 401~449, 801~804, 601 | 54 | `im_hsmm_mgtype01` 4인 대전 미니게임 |
| 1 | 2 vs 2 | 2:2 | 201~215, 808~810 | 18 | `im_hsmm_mgtype02` |
| 2 | 1 vs 3 | 1:3 | 101~115, 805~807 | 18 | `im_hsmm_mgtype03` |
| 3 | 2 vs 2 스포츠 | 2:2 | 501~503 | 3 | `im_hsmm_mgtype10` 2 vs 2 스포츠 |
| 4 | 대전 퍼즐 | 개인 대전 | 602, 603 | 2 | `im_hsmm_mgtype11` 대전 퍼즐 |
| 5 | 듀얼 | 1:1 | 701~705 | 5 | `im_hsmm_mgtype05`, `hsmm06_mw_mg01` "1 vs 1 듀얼 미니게임" |
| 6 | 아이템 | 1인 | 901~905 | 5 | `hsmg_item.json`, 4.7절 |

- 메시지 이름과 type 숫자는 **데이터에서 짝지은 것**이다. 숫자→문자열 표를 코드에서 찾지는 않았다.
- 601(마리오의 퍼즐 파티)은 type 0이지만 `IsPuzzleMg`가 따로 참으로 판정한다. 스코어 어택용(`hsmg601_tlp_win_condition00` "3분간 하이 스코어") [데이터].
- 코인 미니게임(`im_hsmm_mgtype04`)은 type이 아니라 **비트 8**이다. 801~804는 4인, 805~807은 1 vs 3, 808~810은 2 vs 2다.
- 쿠파 미니게임은 type 0에 **비트 9**를 더한 것이다. 쿠파 칸 룰렛 `im_c07_roulette11` "쿠파 미니게임"이 부른다 [데이터].
- "배틀 미니게임"(`hsmm_tlp_battleMg`)과 "보너스 미니게임"(`hsmm_tlp_bonusMg`, 코인 2배)은 **표에 분류가 없다.** 코인 배틀 모드(hsmm03)의 진행 이벤트다. `hsmm03::SequenceBattleMg`·`SequenceBonusMg`·`SequenceCoinMg`가 있다 [데이터: NRO 심볼]. 고르는 규칙은 미확정이다.

### 4.3 코드 앞자리 결론 [데이터]

| 앞자리 | 개수 | 분류 |
|---|---|---|
| 1xx | 15 | 1 vs 3 |
| 2xx | 15 | 2 vs 2 |
| 4xx | 49 | 4인 대전 (431·435·436 = 쿠파 미니게임) |
| 5xx | 3 | 2 vs 2 스포츠 (비치 발리볼·아이스하키·등껍질 축구) |
| 6xx | 3 | 퍼즐 (601 = 4인형 스코어 어택, 602·603 = 대전 퍼즐) |
| 7xx | 5 | 듀얼 1 vs 1 |
| 8xx | 10 | 코인 미니게임 (801~804 4인, 805~807 1 vs 3, 808~810 2 vs 2) |
| 9xx | 5 | 아이템 미니게임 (보드 전용) |

### 4.4 미니게임 수 "100개"

`hsmmet_mw_crs01_rule00` "미니게임은 모두 100개!"와 `im_hsmg` 이름 100개가 같다. 9xx 다섯 개는 이름 메시지가 없고 프리 플레이 목록 `hsmm01mglist.csv`(100행)에도 없다. 그래서 **105 = 100(선택 가능) + 아이템 5**다 [데이터].

### 4.5 미니게임 팩 (GW_MINIGAME_PACK) [판독+데이터]

`IsCurrentMgPack(id)`의 동작은 다음과 같다.
- `pack = GameWork::GetMiniGamePack()`(+0x36194)를 읽는다.
- 마스크 표 main+0x118da0c = `{0x400, 0x800, 0x1000, 0x2000, 0x4000, 0x8000}`에서 `mask[pack]`을 꺼낸다.
- `flags & mask[pack]`이 0이 아니면 참이다. `pack ≥ 6`이면 abort한다.

| pack | 비트 | 이름(`im_mn_packName0N`) | 설명(`mn_bdM_mw_pack_details0N`) | 소속 수 |
|---|---|---|---|---|
| 0 | 10 | 노멀 / All Types | 모든 미니게임 | 100 (5xx·602·603 제외) |
| 1 | 11 | 패밀리 / Family | 간단한 조작 | 55 |
| 2 | 12 | 액션 / Action | 액션 | 58 |
| 3 | 13 | Nintendo 64 | N64에 수록되었던 미니게임 | 64 |
| 4 | 14 | GameCube | GameCube에 수록되었던 미니게임 | 41 |
| 5 | 15 | 테크닉 / Skill | 테크닉 | 48 |

- 7xx 듀얼, 9xx 아이템, 쿠파 3종(431·435·436)은 여섯 팩 **모두**에 들어 있다. 팩과 무관하게 쓰는 특수 게임으로 보인다 [추정].
- 팩은 보드 게임 설정 화면(hsmn02 `UISelectMgPack`, `mn_bdM_mw_pack_select` "마지막으로 미니게임 팩을 선택해 봐!")에서 고른다 [데이터].

### 4.6 원작 출처 [데이터 / 세부 미확정]

- 데이터가 주는 출처 정보는 **N64 팩(비트 13)과 GC 팩(비트 14) 소속**뿐이다. 둘 중 하나에만 속하는 게임이 N64 51개, GC 28개다. 카탈로그의 `era_pack` 열이 이 값이다.
- 13개는 둘 다 0이다. 110, 113, 214, 438, 447, 448, 449, 808, 501~503, 602, 603이다. 앞의 8개는 원작 시대를 데이터로 정할 수 없다. 스포츠·퍼즐 5개는 팩 대상이 아니다.
- 13개는 둘 다 1이다(전 팩 소속: 7xx·9xx·쿠파 3종). 이것도 판별할 수 없다.
- **마리오 파티 1·2·3 중 어느 작품인지는 데이터에 없다.** 찾아본 곳은 다음과 같다.
  - `hs_house_booklist.csv`의 시리즈 열(MP1~MP10 10열)은 캐릭터·맵에만 있고 미니게임 항목이 없다.
  - 뮤직 목록(`hs_house_musiclist.csv`)의 미니게임 BGM은 시리즈 헤더 없이 `im_mn_mu_category03`(미니게임) 하나로 묶여 있다.
  - 메시지에서 "마리오 파티 N"이 나오는 키는 뮤직·도감 페이지뿐이다.
  - 그래서 작품별 출처 열은 만들지 않았다. 외부 지식으로 채우면 [추정]이 된다.

### 4.7 hsmg901~905 = 아이템 미니게임 [데이터]

| 근거 | 내용 |
|---|---|
| `hs_bd00.json` `bd00_map_c03_details00` | (아이템 칸 설명) "아이템 미니게임으로 아이템을 획득하자" |
| `bd00_map_c03_details01`, `bd00_c04_mw_lastTurn` | 마지막 턴에는 아이템 미니게임을 하지 않는다 |
| `hsmg_item.json` | 공통 `hsmg900_tlp_gotItem` "GOT ITEM!", `hsmg900_tlp_miss` "MISS!", 게임별 규칙·조작 |
| hsbd01 NRO 심볼 | `hsbd01::event::ItemMass`, `ItemMgCall`, `ItemMgResult`, `ItemMassResult` |
| `hs_mglist.csv` | type 6, 전 팩 소속 |
| `GameWork::SetMgGetItem(GW_ITEM)` +0x35768, `SetMgEntryItem(int, GW_ITEM)` +0x35778 | 미니게임 결과로 얻은 아이템을 넘기는 자리 [판독: 심볼 이름] |

| 코드 | ID | 일본어 디버그 이름 | 규칙(`hsmg90N_tlp_smallRule`) | 조작(`pop_ctrl`) | 추가 아카이브 |
|---|---|---|---|---|---|
| hsmg901 | 100 | シャトルハンマー | 로켓으로 노려라! | {E000}연타하여 들어올리기 / {E003}내리치기 | npc021_koopa_jr |
| hsmg902 | 101 | ねらってバルーン | 풍선을 터뜨려라! | {E000}화살 쏘기 | — |
| hsmg903 | 102 | アイテムルーレット | 룰렛을 멈춰라! | {E000}스위치 누르기 | — |
| hsmg904 | 103 | タルタルブランコ | 뛰어들어라! | {E000}점프 | — |
| hsmg905 | 104 | たるたるゴロゴロ | 놓치지 마라! / 나무통을 부숴라! | {E015}이동 / {E003}펀치 | npc021_koopa_jr |

- 한·영 표시 이름은 메시지에 없다. 화면에는 규칙 문구만 나오는 것으로 보인다 [추정].
- 1인 플레이는 메시지("아이템 칸 … 획득")와 아이템 칸이 1인 정지 이벤트라는 점에서 나온 [추정]이다.
- 어떤 조건에서 901~905 중 하나를 고르는지는 미확정이다(hsbd01 `ItemMgCall` 판독 필요).

### 4.8 조작 설명 메시지 구조 (`hsmg_inst.json`) [데이터]

| 키 | 내용 | 수 |
|---|---|---|
| `inst_hsmgNNN_rule` (+`_rule2`) | 규칙 문장 | 100 (+3) |
| `inst_hsmgNNN_ctrl0K` | 공통 조작 줄 K | 88개 게임 |
| `inst_hsmgNNN_ctrl1K` | 1명 쪽 조작(`inst_ctrl_side01` "1명 쪽") | 1 vs 3 |
| `inst_hsmgNNN_ctrl3K` | 3명 쪽 조작(`inst_ctrl_side03` "3명 쪽") | 1 vs 3 |

조작 문구 안의 버튼 아이콘은 사용자 정의 영역 문자(U+E000~)다. 카탈로그에는 `{E000}` 꼴로 남겼다. 아래 대응은 문구에서 끌어낸 **[추정]**이고 폰트 글리프로 확인하지 않았다.

| 코드 | 쓰임 예 | 추정 |
|---|---|---|
| E000 | 점프, 결정 | A 버튼 |
| E001~E003 | "E001E002E003E000 숨을 장소 선택", E003 펀치·연타 | 나머지 얼굴 버튼(B·X·Y 계열, 순서 미확정) |
| E004~E007 | "순서대로 눌러 회전" | 방향 버튼 4방향 |
| E008 / E009 | 홍기/백기, 좌/우 회전 | L / R |
| E00E / E00F | "E00F/E00E 스타트!" | + / − |
| E015 | 이동 | L 스틱 |
| E025~E02A, E038 | 전진/후진, 좌/우, 방향, 회전 | 스틱 방향 표시 |

### 4.9 미니게임 마운틴 모드용 목록 [데이터]

- `hsmm01mglist.csv`: 프리 플레이 나열 순서. 열 = 코드, MINIGAME_ID, 정수(1~), 0/1 플래그다. 열2·3의 의미(장르 구분으로 보임)는 미확정이다. 100행이고 9xx가 없다.
- `hsmmmgpack.csv`: 데일리 트라이얼(hsmm07) 팩 21개. 열 = 일본어 이름, 이름 라벨 `im_hsmm_mgpkNN`, 미니게임 3개(코드 뒷자리), 인원(4 또는 2), 오프닝 메시지 `hsmm07_mw_op_mgpkNN`. 예: "2人でけっとう" = 701·702·704, 2인.
- `hsmmvs3pack.csv`: 3인 챌린지(hsmm05) 단계 Lv.1~3(두 벌). 1 vs 3 게임 5개와 숫자 5열(적 강도로 보이나 미확정).

### 4.10 카탈로그 보강 (`analysis/minigame_catalog.tsv`) [실행]

기존 열 `code nro_size defined_syms name_ko name_en`은 그대로 두고 아래 열을 붙였다. 재생성은 `.venv/Scripts/python web/tools/analysis/build_mg_catalog.py`다.

| 열 | 출처 | 내용 |
|---|---|---|
| `mg_id` | hs_mglist 행 순서 | MINIGAME_ID |
| `type` | 열1 | 0~6 (4.2절) |
| `category` | type + 코인/쿠파 비트 | 한글 분류 |
| `players` | type | 인원 구성 |
| `coin_mg`, `koopa_mg` | 비트 8, 9 | 0/1 |
| `order_shuffle` | 비트 5 | 설명→본편 때 순서 섞기 |
| `flag_b6` | 비트 6 | 803만 1, 용도 미확정 |
| `packs` | 비트 10~15 | 소속 팩 목록 |
| `era_pack` | 비트 13/14 | N64 / GC / 판별불가(전팩) / — |
| `name_jp` | 열16 | 일본어 디버그 이름(9xx 이름은 이것뿐) |
| `rule_ko` | `inst_*_rule` 또는 `hsmg90N_tlp_smallRule` | 규칙 문장 |
| `ctrl_ko` | `inst_*_ctrl*` 또는 `hsmg90N_pop_ctrl*` | 조작. `1명쪽:`·`3명쪽:` 구분 |
| `scene_archives` | `bex_scenelist.csv` | 장면이 추가로 싣는 NPC·오브젝트 아카이브 |
| `bgm` | `hs_house_musiclist.csv` | 뮤직 목록의 BGM ID(여러 게임이 공유) |

---

## 5. 장면 시스템과 모드 흐름

### 5.1 장면 목록 `bex_scenelist.csv` [데이터]

열: `0 장면이름, 1 플래그, 2·3 빈칸, 4 아카이브 목록('|' 구분), 5 클래스(모듈::클래스), 6 0`.

- 플래그 0인 장면은 클래스가 **main 안**에 있다. `boot::SceneBoot`, `hs_matching::SceneHs_matching`, `test_mg_practice::…`, `bex_tool_modelviewer…`가 그렇고, 이 클래스 이름 문자열이 main 바이너리에 있다. 플래그 1인 장면은 클래스 네임스페이스와 같은 이름의 **NRO**를 싣는다고 본다 [추정, 강함].
- 아카이브 목록이 비어 있으면 장면 이름과 같은 아카이브 하나로 보인다(예: `hsbd01`) [추정].
- 테스트·디버그 장면(`test_*`, `testsss`, `DbgUnlockSet`, `FxtriggerTest`, `hsmm_ui_test`, `hs_actor_test`, `hsmg_test1`)도 남아 있다. 해당 NRO는 출시판에 없다.

게임 장면 (테스트 제외). 역할 열은 NRO 클래스 이름과 메시지 키에서 읽었다 [데이터]:

| 장면 | 클래스 | 싣는 아카이브 | 역할 |
|---|---|---|---|
| boot | `boot::SceneBoot` (main) | — | 부팅 |
| hsmn00 | `hsmn00::SceneHsmn00` | hsmn00 | 시작 메뉴: 로컬/온라인, 인원, 유저 어카운트, 로비(`StateFrontmenuLocal`, `UISelectConnection`, `UISettingAccount`, `UILobby`) |
| op | `op::SceneOp` | op | 오프닝 연출(`hsmn_OP` 메시지 "시작의 토관") |
| hsmn01 | `hsmn01::SceneHsmn01` | hsmn01 | 타이틀 + 메인 메뉴 광장(`StateTitle`, `StateMainmenu`, `mn_mainM_*`) |
| hsmn02 | `hsmn02::SceneHsmn02` | hsmn02 | 보드 게임 설정: 보드·규칙·핸디캡·COM 레벨·미니게임 팩, 온라인 매치메이킹(`UISelectBoard`, `UISettingRule`, `UISelectMgPack`, `UISelectBoardMatchMaking`) |
| hsmn03 | `hsmn03::SceneHsmn03` | hsmn03 | 설정: BGM 전환·스탬프·메시지 속도·중단 데이터 삭제(`mn_dSetting_*`) |
| hsmn04 | `hsmn04::SceneHsmn04` | hsmn04 | 친구와 온라인 방 만들기·찾기(`StateFriend`, `hsmn04_friend_*`) |
| hsmn05 | `hsmn05::SceneHsmn05` | hsmn05 | 상점: 스탬프·카드 디자인·도감·뮤직(`mn_dStore_*`, 키노피오) |
| hsmn06 | `hsmn06::SceneHsmn06` | hsmn06 | 데이터 하우스: 마리오 파티 카드·도감·뮤직·기록(`mn_dRoom_*`) |
| hsmn07 | `hsmn07::SceneHsmn07` | hsmn07 | 미니게임 마운틴행 배 승선·캐릭터 선택(`mn_mgM_*`, `ModelShip`) |
| hsmn08 | `hsmn08::SceneHsmn08` | hsmn08 | 온라인 미니게임 마운틴 랭킹·마리오 파티 카드 표시(`UIOnlineMgMountainRankingWindow`) |
| hsmn09 | `hsmn09::SceneHsmn09` | hsmn09 | 업적(별자리) 화면(`achieve_list.csv`, `hsmn09_achievement_*`) |
| hsmmet | `hsmmet::SceneHsmmet` | hsmmet | 미니게임 마운틴 허브(코스 crs01~07 선택, `hsmmet_mw_crs*`) |
| hsmm01 | `hsmm01::SceneHsmm01` | hsmm01, hsmm00, npc022 | 프리 플레이 |
| hsmm02 | `hsmm02::SceneHsmm02` | hsmm02, hsmm00, npc022 | 스포츠 & 퍼즐(오프라인 / 온라인 랭크) |
| hsmm03 | `hsmm03::SceneHsmm03` | hsmm03, hsmm00, npc017, obj03_coin | 코인 배틀 |
| hsmm04 | `hsmm04::SceneHsmm04` | hsmm04, hsmm00, npc053, obj06_star | 태그 매치(2 vs 2, 선승) |
| hsmm05 | `hsmm05::SceneHsmm05` | hsmm05, hsmm00, npc051 | 3인 챌린지(1 vs 3 5연승, 스테이지 1~6) |
| hsmm06 | `hsmm06::SceneHsmm06` | hsmm06, hsmm00, npc021, npc102 | 서바이벌(온라인 연승, 듀얼 포함) |
| hsmm07 | `hsmm07::SceneHsmm07` | hsmm07, hsmm00, npc017, obj06_star | 데일리 트라이얼(온라인 1인, 오늘의 팩) |
| hs_matching | `hs_matching::SceneHs_matching` (main) | hs_matching | 온라인 매칭 |
| hsbd00 | `hsbd01::SceneHsbd01` | hsbd00, **hsbd01**, NPC 9종, objbd_pack, emote | 보드 1 피치의 생일 케이크 |
| hsbd02~05 | `hsbd01::SceneHsbd01` | hsbd00, hsbd0N, NPC, objbd_pack, emote | 보드 2~5 (6.1절) |
| hsbd01 | `hsbd01::SceneHsbd01` | (빈칸) | 아카이브 없는 행. 쓰임 미확정 |
| hsbd10, hsbd99 | `hsbd10::…`, `hsbd99::…` | 각 이름 | 아카이브는 208 B 빈 BEA이고 NRO도 없다 → 개발 잔재 [데이터] |
| hsmgNNN | `hsmgNNN::SceneHsmgNNN` | hsmgNNN + NPC/오브젝트 | 미니게임(카탈로그 `scene_archives`) |
| ed | `ed::SceneEd` | ed | 엔딩·크레디트(`Credit`, `ThankYou`, `Book`) |

- `hsmm00`은 NRO가 없는 **공용 아카이브**다(트럭 모델, 마운틴 목록 표).
- hsmm01~07 NRO는 저마다 `hsmm::` 공용 라이브러리를 정적으로 포함한다. 심볼 약 3,300개 중 대부분이 `hsmm::HSMMGameWork`, `HSMMStageMan`, `HSMMUIRuleSetting` 등이다 [데이터].
- `hsmn_bg`는 메뉴 공용 배경 아카이브다. 장면 목록에는 없다 [데이터].

### 5.2 장면 전환 API [판독: 심볼·호출]

| 함수 | main 주소 | 의미 |
|---|---|---|
| `bex::SceneList::FindEntry(name)` | +0x34b1e4 | 장면 목록에서 행 찾기 |
| `bex::SystemScene::ChangeScene(name)` | +0x34b408 | 현재 장면 교체 |
| `bex::SystemScene::PushSceneHistory(name)` | +0x34b5b4 | 기록 쌓기 |
| `bex::SystemScene::CallScene(name)` | +0x34b764 | 호출(돌아올 수 있음) |
| `bex::SystemScene::ReturnScene()` | +0x34b8a0 | 호출한 장면으로 복귀 |
| `bex::SystemScene::ReturnSceneTo(name)` | +0x34ba9c | 지정 장면까지 복귀 |
| `bex::SystemScene::RebootScene()` | +0x34bcf8 | 재시작 |
| `bex::SceneGameBase::RequestExitGame()` | +0x391800 | 장면 쪽 "끝내고 돌아가기" 요청 |
| `bex::SceneGameBase::RequestCallGame(name)` | +0x3918b8 | 장면 쪽 호출 요청 |
| `bex::SceneGameBase::RequestChangeGame(name)` | +0x391920 | 장면 쪽 교체 요청 |
| `hs::SceneBdGameBase::RequestCallMiniGame()` | +0x10e868 | 보드 → 미니게임 호출 |

- 시작: hs 초기화(main+0x25830)가 `CallScene("hsmn00")`을 부른다 [판독].
- 장면 수명 콜백은 Lua 기반 `gm_scene_game_base.lua`의 `Begin/Load/Setup/Update/Cleanup`(→ C++ `BeginGame/LoadGame/SetupGame/UpdateGame/CleanupGame`)이다. 기반 클래스는 `hs::SceneHsFlowBase`(메뉴형, +0x88128~), `hs::SceneHsGameBase`(+0x88990~), `hs::SceneBdGameBase`(보드), `hs::SceneMiniGameBase`(미니게임)다 [데이터: lua 문자열 + 심볼].
- 보드 장면 이름 표: 온라인 매칭 함수(main+0x28fbc 부근)가 `GameWork::GetBoardNo()`(+0x36084) 값으로 지역 배열 `{hsbd00, hsbd02, hsbd03, hsbd04, hsbd05}`를 고르고 `SceneList::FindEntry`로 아카이브를 미리 확인한다 [판독]. 그래서 **GW_BOARD_NO 0~4 ↔ 장면목록 행 hsbd00, hsbd02~05**다.
  - **정정(코드 모듈 판독):** 보드 장면으로 실제 전환할 때는 항상 `ChangeScene("hsbd01")`이다. 장면목록의 hsbd00·hsbd02~05 행은 그 보드의 아카이브 목록을 미리 싣는 데만 쓰인다 [판독: main `FUN_71000282a4`, hsbd01 `PrepareLoadArchive_game` — web/docs/analysis/02, SHARED.md]. 이전 판은 이 행들을 실제 장면 이름으로 보았다.
- 매칭 실패·종료 같은 분기에서 `ReturnSceneTo("hsmmet")`가 있다(main+0x29294, 모드 값 5 또는 9일 때). 모드 값의 뜻은 미확정 [판독].

### 5.3 모듈별 전환 대상 [데이터: NRO 문자열·임포트]

NRO마다 가져다 쓰는 전환 함수와, 안에 든 장면 이름 문자열이다. 문자열이 있다고 그 장면으로 간다고 단정할 수는 없다(이름 비교에만 쓸 수도 있다). 그래서 아래 흐름은 [추정]이고, 확정에는 호출 지점 판독이 필요하다.

| 모듈 | 임포트 | 장면 이름 문자열 |
|---|---|---|
| hsmn00 | RequestCallGame | hsmn00, op |
| hsmn01 | RequestCallGame | hsmn00~07, op |
| hsmn02 | ChangeScene, RequestCallGame | hsbd00~05, hs_matching, hsmn01, hsmn02, hsmn04, op, ed |
| hsmn03 / hsmn05 | RequestExitGame | hsmn01 |
| hsmn04 | — | hsmn00, hsmn01, hsmn04 |
| hsmn06 | RequestCallGame, RequestExitGame | hsmn00, hsmn01, hsmn08, hsmn09, hsmm00, ed |
| hsmn07 | ChangeScene, RequestCallGame, RequestExitGame | hsmmet, hsmn01, hsmn04 |
| hsmn08 / hsmn09 | — | hsmn01, hsmn06 / hsmn01 |
| op | **RequestChangeGame** | hsmn01 |
| ed | RequestExitGame | hsmn01 |
| hsmmet | RequestCallGame, RequestExitGame | hsmm01~07, hs_matching, hsmn00/01/08 |
| hsmm01~07 | RequestCallGame, RequestExitGame | hsmm00~07, hsmmet, hs_matching, hsmn00 |
| hsbd01 | RequestCallMiniGame, RequestExitGame | hsbd00~05, hsmn01, op, ed |
| hsmgNNN | (없음) | — |

미니게임 마운틴 코스 표 `hsmmruleinfo.csv`는 다음과 같다. 열 = 일본어 이름, 장면, 변형(−1 또는 2), 설명 메시지 4, 이미지 4, NPC 모션 8.

| 코스 메시지 | 장면 | 이름 |
|---|---|---|
| crs01 | hsmm01 | 프리 플레이 |
| crs02b | hsmm02 | 스포츠 & 퍼즐(오프라인) |
| crs03 | hsmm03 | 코인 배틀 |
| crs04 | hsmm04 | 태그 매치 |
| crs05 | hsmm05 | 3인 챌린지 |
| crs06 | hsmm06 | 서바이벌 |
| crs07 | hsmm07 | 데일리 트라이얼 |
| crs02 (변형 2) | hsmm02 | 스포츠 & 퍼즐 온라인(실력 랭크) |

### 5.4 장면 흐름 (요약)

```
boot ─(main+0x25830 CallScene)→ hsmn00 시작 메뉴(로컬/온라인·인원·어카운트)   [판독]
  hsmn00 → op 오프닝 → (ChangeGame) hsmn01                                   [추정: 문자열]
  hsmn01 메인 메뉴 광장 ─Call→
      hsmn02 보드 게임 설정 ─ChangeScene→ hsbd01 (보드 장면 하나, 보드 번호별 아카이브는 장면목록 hsbd00|02~05 행으로 미리 싣는다)  [판독]
            보드 ─RequestCallMiniGame→ hsmgNNN ─Exit→ 보드 복귀                  [판독: 심볼]
            보드 종료 → 결과 → hsmn01 (또는 ed)                                   [추정]
      hsmn07 배 승선 ─Change→ hsmmet 미니게임 마운틴 ─Call→ hsmm01~07 ─Call→ hsmgNNN
      hsmn03 설정 / hsmn05 상점 / hsmn06 데이터 하우스(→ hsmn08, hsmn09) / hsmn04 온라인 방
  온라인 경로: hs_matching 을 거친다(hsmn02, hsmmet, hsmm*)                       [추정]
```

---

## 6. 보드

### 6.1 보드 목록 [판독+데이터]

| GW_BOARD_NO | 장면 | 맵 아카이브 | 이름 라벨 | 한국어 | 영어 | 원작(도감 열) | 보드 고유 NPC 아카이브 | 칸 그래프 행 |
|---|---|---|---|---|---|---|---|---|
| 0 | hsbd00 | hsbd01 | im_bd01_name | 피치의 생일 케이크 | Peach's Birthday Cake | MP1 | npc001 굼바, npc005 뻐끔플라워, npc017 김수한무 | 72 |
| 1 | hsbd02 | hsbd02 | im_bd02_name | 스페이스 랜드 | Space Land | MP2 | npc012 쿵쿵, npc027 꽈당꽈당, npc067 무우쵸 | 118 |
| 2 | hsbd03 | hsbd03 | im_bd03_name | 빙글빙글 숲 | Woody Woods | MP3 | npc005 뻐끔플라워, npc009 쪼르뚜, npc079 밤바, npc010 스우푸 | 113 |
| 3 | hsbd04 | hsbd04 | im_bd04_name | 요시의 트로피컬 아일랜드 | Yoshi's Tropical Island | MP1 | npc012 쿵쿵, npc036 집게바, npc071 요시, npc007 뽀꾸뽀꾸, npc035 성게돌이, npc062 우걱우걱, npc101 KOOPA_CLOWN | 67 |
| 4 | hsbd05 | hsbd05 | im_bd05_name | 호러 랜드 | Horror Land | MP2 | npc051 마귀, npc049 아이군, npc027 꽈당꽈당, npc032 킹부끄, npc048 안부끄, npc010 스우푸 | 137 |

- GW_BOARD_NO와 장면의 대응은 main+0x28fbc 배열에서 판독했다. 보드 0의 장면 이름은 `hsbd00`이고 맵 아카이브는 `hsbd01`이다. 이름이 어긋나는 데 주의한다.
- 원작은 `hs_house_booklist.csv` MAP 행의 시리즈 열에서 왔다. bd04·bd01 = MP1, bd02·bd05 = MP2, bd03 = MP3 [데이터].
- 모든 보드가 공통으로 싣는 것: `hsbd00`(보드 공통), npc000 쿠파, npc003 엉금엉금, npc022 키노피오, npc088 키노피코, npc025 부끄부끄, npc026 멍멍이, `object/objbd_pack`, `emote` [데이터].
- hsbd01 NRO의 맵별 클래스(`event::Map01_*`~`Map05_*`, `map::Map01Mgr`~`Map05Mgr`)도 보드 번호와 내용이 맞는다. Map01 = Packun·Kuribo·KoopaSpot·Warp, Map02 = Police·Runaway·KoopaCount, Map03 = Choropoo·Tree·Arrow·Kuribon, Map04 = Dossun·Float, Map05 = KingTeresa·WizardsHouse·PartyVenue·ChangeTime·Eyekun [데이터: 심볼].

### 6.2 보드 공통 표 (`hsbd00/data`, 30개) [데이터]

| 파일 | 형태 | 내용 |
|---|---|---|
| `hsbd00_item_mass_map01~05` | `!N` 블록 × 아이템 ID | 맵별 아이템 칸(미니게임) 후보. 블록 번호의 의미(순위·턴 등)는 미확정 |
| `hsbd00_item_shop_map01~05` | `!N` 블록 × (아이템 ID, 가격) | 맵별 아이템 숍 품목·가격. 예: map01 블록0 = KINOKO 3, SLOW_DICE 3, DOUBLE_DICE 5, WARP_BOX 7, JUST_DICE 12 |
| `hsbd00_event_mass_map01~05` | `!N` 블록 × (가중치, EV_RLT_xx) | 럭키 칸 룰렛 항목 가중치. EV_RLT_00~18의 19종이 `im_c06_roulette00~18`(럭키 칸) 19개와 수가 맞는다 |
| `hsbd00_koopa_mass` | `!N` 블록 × (가중치, KP_RLT_xx) | 쿠파 칸 룰렛 가중치. KP_RLT 12종 ↔ `im_c07_roulette00~11` 12개 |
| `hsbd00_hidden_block` | `!N` × (값, 값) | 숨겨진 블록 |
| `hsbd00_mg_team` | `!N` × 5열 | 미니게임 팀 편성 관련(블록마다 3행, 예 `4,0,,830,1`/`3,1,,70,0`/`2,2,,100,0`). 미확정 |
| `hsbd00_mass_camera_map01~05`, `hsbd00_camera`, `_camera_fsnb` | | 카메라 |
| `hsbd00_player_parameter` | 항목 × 캐릭터 10열 | 캐릭터별 보드 연출 높이 등(행동 선택 카메라 Y, UI 높이, 쿠파 칸 스타 강탈 높이 …) |
| `hsbd00_player_head`, `hsbd00_emote*`, `hsbd00_mess_random` | | 머리 위치, 스탬프, 랜덤 대사 |

블록 `!N`을 고르는 규칙과 가중치 추첨 방식은 hsbd01 `CsvItemMass`·`CsvEventMass`·`CsvKoopaMass`·`CsvItemShop`·`CsvMgTeam`의 판독이 필요하다(다음 단계).

### 6.3 칸 종류 (`hsbd0N_map.csv` 열5) [데이터]

맵 CSV 열: `0 노드, 1 다음 노드, 5 칸 종류, 6~11 종류별 인자, 13 노드 이름 x_NNN, 14 스폿 이름`. 800번대는 경로 연결용 무형 노드, 500번대는 스폿이다.

| 맵 라벨 | 메시지 | 대응 근거 | bd01 | bd02 | bd03 | bd04 | bd05 |
|---|---|---|---|---|---|---|---|
| START | im_c00 스타트 지점 | 이름 | 1 | 1 | 1 | 1 | 1 |
| PLUS | im_c01 플러스 칸 | 이름 | 21 | 32 | 25 | 23 | 26 |
| MINUS | im_c02 마이너스 칸 | 이름 | 6 | 9 | 7 | 5 | 8 |
| ITEM | im_c03 아이템 칸(→ 아이템 미니게임) | `map::ItemMass`, `event::ItemMgCall` | 0 | 16 | 14 | 3 | 7 |
| HATENA_1~3 | im_c04 이벤트 칸 (? 칸) | `map::HatenaMass` [추정] | 11 | 5 | 9 | 7 | 7 |
| CHANCE | im_c05 찬스 칸 | `event::ChanceMass` | 2 | 2 | 2 | 1 | 2 |
| EVENT | im_c06 럭키 칸 | `event_mass` → EV_RLT ↔ c06 룰렛 [추정] | 9 | 15 | 15 | 11 | 25 |
| KOOPA | im_c07 쿠파 칸 | `event::KoopaMass` | 2 | 3 | 3 | 4 | 4 |
| VS | im_c08 VS 칸 | `event::VSMass`, `VSMgCall` | 2 | 4 | 3 | 2 | 4 |
| BANK | im_c09 엉금엉금 뱅크 | `event::BankMass` | 0 | 2 | 3 | 0 | 3 |
| MARK_STAR | 스타 출현 후보(im_s00) | `map::StarSpot` | 1 | 8 | 10 | 1 | 8 |
| MARK_PC | 플레이어 시작 표시 | | 4 | 4 | 4 | 4 | 4 |
| SPOT_ITEM_SHOP(_MAP) | im_s01 아이템 숍 | `event::ItemShopSpot` | 1 | 1 | 3 | 1 | 3 |
| SPOT_BRANCH(_KEY) | im_s02 갈림길 / im_s05 철벽 게이트 | `BranchSpot(Key)` | 0 | 5 | 4 | 0 | 4 |
| SPOT_NOKONOKO | im_s03 엉금엉금 | `NokonokoSpot` | 1 | 0 | 0 | 1 | 0 |
| SPOT_KOOPA | im_s04 쿠파 | `Map01_KoopaSpot` 등 | 1 | 0 | 0 | 0 | 0 |
| SPOT_TERESA | im_s06 부끄부끄 | `event::TeresaSpot` | 0 | 2 | 1 | 1 | 0 |
| SPOT_EVENT_1~6 | 보드 고유 장치(gmk) | Map0N 클래스 | 1 | 7 | 4 | 2 | 11 |

(칸 수는 열5 값의 개수다. bd01의 HATENA 11 = HATENA_1 10 + HATENA_2 1.)

### 6.4 보드 진행 구조 (hsbd01 NRO) [데이터: 심볼 / 순서는 추정]

- `hsbd01::flow::` 클래스: `TurnBegin`, `PlayerBegin`, `Command`, `Dice`, `Moving`, `StopEvent`, `PlayerEnd`, `TurnEnd`, `MinigameBegin`, `MinigameEnd`, `Save`, `Result`, `Inst`. 이름 순서로 보면 한 턴은 `TurnBegin → (플레이어마다 PlayerBegin → Command → Dice → Moving → StopEvent → PlayerEnd) → TurnEnd → MinigameBegin → MinigameEnd → Save`이고, 마지막에 `Result`다 [추정].
- 미니게임 호출 이벤트(`hsbd01::event::`):

| 이벤트 | 미니게임 | 계기 [추정: 이름·메시지] |
|---|---|---|
| `MgCall` / `MgCallBase` / `MgResult` | 4인·1 vs 3·2 vs 2 (턴 끝) | 칸 색 기반 팀 나눔(`bd00_tlp_hsmg1VS3`, `hsmg2VS2`) [추정] |
| `ItemMgCall` / `ItemMgResult` | 9xx 아이템 | 아이템 칸 |
| `VSMgCall` / `VSMgResult` / `VSSlot` | (미확정) | VS 칸 |
| `DuelMgCall` / `DuelItemMgCall` / `DuelResult` | 7xx 듀얼 | 결투 장갑·듀얼 칸 정지 |
| `KoopaMgCall` / `KoopaMgResult` | 쿠파 3종 | 쿠파 칸 룰렛 11 |

- 그 밖의 이벤트: `LastSpurt`(라스트 스퍼트, `im_lastSpBonus`), `BonusStarAppear/Get`(보너스 스타 9종 `im_bonusStar00~08`), `HiddenBlock`, `Teresa`, `ChanceSlot`, `BankMass`, `StarSpot*`, `ItemUse*`(아이템 16종별), `Claypipe*`, `WarpStar`, `BoardInst`(보드 설명), `BoardResult(Praise)`.
- 컴퓨터 사고는 `hsbd01::ComThink`, 네트워크 동기는 `NetMgr`, `NetMsgReceiver(Sync)`다.

---

## 7. 캐릭터 [데이터]

`characterlist.csv` 열: `0 ID 이름, 1 번호, 2·3 아카이브, 4 모델, 5 모션 접두, 9 모델 접두, 10~16 effect/se/vo/mfa/anim_transit 파일 이름, 17 이름 라벨, 18 구분(0/1, 미확정), 19~ 수치(크기·카메라·눈 텍스처 SRT 등)`.

플레이어블 10명 (`characterlist` 앞 10행, `hs_house_booklist` 0~9행, `hsbd00_player_parameter` 10열이 같은 순서다):

| 순서 | ID | 번호 | 아카이브 | 모델 | 한국어 | 영어 | 도감 등장 시리즈(MP1~10) |
|---|---|---|---|---|---|---|---|
| 0 | MARIO | 1 | chara/pc/pc01_mario | model/pc01_mario.fmdb | 마리오 | Mario | 1~10 |
| 1 | LUIGI | 2 | chara/pc/pc02_luigi | model/pc02_luigi.fmdb | 루이지 | Luigi | 1~10 |
| 2 | PEACH | 3 | chara/pc/pc03_peach | model/pc03_peach.fmdb | 피치 | Peach | 1~10 |
| 3 | DAISY | 4 | chara/pc/pc04_daisy | model/pc04_daisy.fmdb | 데이지 | Daisy | 3~10 |
| 4 | WARIO | 5 | chara/pc/pc05_wario | model/pc05_wario.fmdb | 와리오 | Wario | 1~10 |
| 5 | WALUIGI | 6 | chara/pc/pc06_waluigi | model/pc06_waluigi.fmdb | 와루이지 | Waluigi | 3~10 |
| 6 | YOSHI | 7 | chara/pc/pc07_yoshi | model/pc07_yoshi.fmdb | 요시 | Yoshi | 1~10 |
| 7 | ROSETTA | 11 | chara/pc/pc11_rosetta | model/pc11_rosetta.fmdb | 로젤리나 | Rosalina | 10 |
| 8 | DK | 12 | chara/pc/pc12_dk | model/pc12_dk.fmdb | 동키콩 | Donkey Kong | 1~10 |
| 9 | CATHERINE | 13 | chara/pc/pc13_catherine | model/pc13_catherine.fmdb | 캐서린 | Birdo | 7~9 |

- 이 "순서"가 `GW_CHARA_ID` 값과 같은지는 코드로 확인하지 않았다 [추정].
- NPC는 50행이다(쿠파 npc000 … 쿠파주니어 클라운 npc102). 변형 ID(KURIBO_GOLD, HEYHO_PROPELLER 등)는 같은 아카이브를 쓴다.
- 표정 7종은 `hs_character_face.csv`에 있다(fcl_notice00 … fcl_close_tight00).
- `chara~pc~*` 아카이브마다 `effect`·`se` CSV 2개씩이 있다(nkn 집계).

---

## 8. 아이템 [데이터]

| GW_ITEM | 메시지 라벨 | 한국어 | 보드 표 ID | 오브젝트 | 효과(`im_itemNN_details` 요약) |
|---|---|---|---|---|---|
| 0 | im_item00 | 버섯 | KINOKO | MUSHROOM (obj05) | 주사위 +5 |
| 1 | im_item01 | 더블 주사위 | DOUBLE_DICE | DICE_2 (obj92) | 주사위 2개 합 |
| 2 | im_item02 | 트리플 주사위 | TRIPLE_DICE | DICE_3 (obj93) | 주사위 3개 합 |
| 3 | im_item03 | 저주 주사위 | SLOW_DICE | DICE_CURSE (obj94) | 1~3만 나옴 |
| 4 | im_item04 | 워프블록 | WARP_BOX | WARP_BOX (obj90) | 라이벌 1명과 자리 교환 |
| 5 | im_item05 | 내 맘대로 주사위 | JUST_DICE | DICE_EXACTLY (obj80) | 1~10 선택 |
| 6 | im_item06 | 금 토관 | GOLD_PIPE | CRAYPIPE_GOLD (obj12) | 스타 앞으로 워프 |
| 7 | im_item07 | 게이트 키 | KEY | AKAZU_KEY (obj81) | 철벽 게이트 열기 |
| 8 | im_item08 | 빼앗기박스 | STEAL_BOX | STEAL_BOX (obj82) | 아이템 빼앗기 |
| 9 | im_item09 | 투명블록 카드 | HIDDEN_BLOCK | HIDDEN_BLOCK_CARD (obj83) | 숨겨진 블록 출현 |
| 10 | im_item10 | 결투 장갑 | DUEL_GLOVE | DUEL_GLOVE (obj84) | 결투 신청(→ 듀얼 미니게임) |
| 11 | im_item11 | 멍멍이 호루라기 | WANWAN | WANWAN_WHISTLE (obj85) | 스타 위치 변경 |
| 12 | im_item12 | 부끄 벨 | TERE_BELL | TERE_BELL (obj86) | 부끄부끄 호출(코인 무료 / 스타 50코인) |
| 13 | im_item13 | 2배카드 | 2_CARD | 2_CARD (obj87) | 스타 2배 교환 |
| 14 | im_item14 | 아이템 주머니 | (숍·칸 표에 없음) | ITEM_BAG (obj88) | 아이템 가득 |
| 15 | im_item15 | 슈퍼워프블록 | SUPER_WARP_BOX | WARP_BOX_SUPER (obj91) | 고른 라이벌과 자리 교환 |

- 번호 0~15의 근거는 두 가지다. `hs_objectlist.csv` 열5/7의 아이템 번호(MUSHROOM 0, DICE_2_DISPLAY 1, DICE_3_DISPLAY 2, DICE_CURSE_DISPLAY 3, WARP_BOX 4, DICE_EXACTLY 5, CRAYPIPE_GOLD_DISPLAY 6, AKAZU_KEY 7 … WARP_BOX_SUPER 15)와 `im_itemNN` 번호가 일치한다 [데이터].
- 보드 표 ID(KINOKO 등) ↔ 번호 대응은 이름으로 맞춘 [추정]이다. 아이템 주머니는 럭키 칸 룰렛(`im_c06_roulette11`)으로만 나온다 [데이터: 메시지].
- hsbd01의 `event::ItemUse*` 클래스가 16종(Kinoko, DoubleDice, TripleDice, SlowDice, WarpBox, JustDice, GoldPipe, Key, StealBox, HiddenBlock, DuelGlove, Wanwan, TereBell, 2Card, ItemBag, SuperWarpBox)으로 아이템마다 하나씩 있다.

---

## 9. 웹 포팅 구조 (이 문서 범위)

| 모듈(웹 권장 이름) | 책임 | 원본 대응 |
|---|---|---|
| `data/nkn` (빌드 단계) | `.nkn` → CSV/JSON 변환. 런타임에는 평문만 싣는다 | `bex::DataCSV::Load` |
| `MgList` | 105행 표. `getType`, `isCoin`, `isKoopa`, `isPuzzle`(601 특례), `isSportsPuzzle`(ID 94~99), `inPack(pack)`, `shuffleOrderOnStart` | `hs::MGList` (4.1절) |
| `SceneStack` | `call/ret/retTo/change`, 장면 목록(아카이브 사전 로드) | `bex::SystemScene`, `bex_scenelist` |
| `BoardRegistry` | GW_BOARD_NO 0~4 → 장면 이름·맵 아카이브·NPC 목록 | 6.1절 |
| `CharacterList` / `ItemTable` | 7·8절 표 | `characterlist.csv`, `im_item*` |

- MINIGAME_ID는 **CSV 행 순서** 그대로 둔다. 401이 0번이다. 코드 숫자 순서로 다시 매기면 원본 ID와 어긋난다.
- 원본과 같게 유지할 것:
  - 팩 판정은 비트 마스크다(`0x400 << pack`).
  - `IsPuzzleMg`는 601을 특례로 처리한다.
  - `order_shuffle`이 1인 게임만 순서를 섞는다. 난수 원본(main+0x19bc90 / 0x19b7f0)은 미판독이다.

---

## 10. 검증

| 항목 | 방법 | 결과 | 구분 |
|---|---|---|---|
| nkn 복호 | 1,044개 전부 복호 → PKCS#7·NUL·UTF-8 검사(assets 담당 재실행 포함) | 전부 정상 | 실행 |
| MINIGAME_ID = 행 순서 | `hsmm01mglist.csv` 열1(ID)과 `hs_mglist` 행 번호를 대조 | 100행 전부 일치 | 데이터 |
| 분류 수 | 카탈로그 type 집계 | 0:54, 1:18, 2:18, 3:3, 4:2, 5:5, 6:5 = 105 | 실행 |
| 팩 수 | 비트 10~15 집계 | 100/55/58/64/41/48 | 실행 |
| 보드 장면 배열 | main+0x28fbc 스택 저장 순서 판독 | sp+0x220.. = hsbd00, 02, 03, 04, 05 | 판독 |
| 원본 실행 대조 | — | 하지 않음 | — |

---

## 11. 미확정과 다음 단계

| 항목 | 이유 / 필요한 근거 |
|---|---|
| 미니게임별 원작 작품(MP1/2/3/4~7) | 데이터에 없음. 팩 비트로 N64/GC 시대만 확정 |
| hs_mglist 열2·4·5(비트1·2)·7(비트6) 의미 | 값이 모두 0이거나 1개뿐. 비트2 reader는 `RewardMgr::GetMaripaLevel` |
| `GetMmPlayAvailableList(mode)` 의 mode 사용 | 판독 범위에서는 비트0만 검사. 인자를 실제로 쓰는지 다시 확인 |
| 턴 끝 미니게임 선택 규칙(팩·플레이 기록·팀 편성) | hsbd01 `MgCallBase`, `GameWork::ResetPlayedMiniGameFlag`(+0x36128), `hsbd00_mg_team.csv` 판독 필요 |
| 아이템 미니게임 901~905 선택 규칙 | hsbd01 `ItemMgCall` 판독 필요 |
| 럭키·쿠파·아이템 칸 표의 블록 `!N` 선택 규칙과 가중치 추첨 | hsbd01 `CsvEventMass`·`CsvKoopaMass`·`CsvItemMass` |
| EVENT=럭키 칸, HATENA=이벤트 칸 대응 | 이름·룰렛 수로 맞춘 추정. 칸 처리 클래스 판독으로 확정 필요 |
| 메뉴 간 실제 전환 순서(hsmn00 ↔ op ↔ hsmn01 등) | NRO 문자열 존재만 확인. 각 `RequestCallGame` 호출 지점 판독 필요 |
| `ReturnSceneTo("hsmmet")` 분기의 모드 값 5·9 | GW_GAME_MODE 열거값 표 미확보 |
| 장면 목록 열1 의미 | main 내장/NRO 구분으로 추정(근거: main 안 클래스 이름) |
| GW_CHARA_ID = characterlist 순서 여부 | 코드 미확인 |
| 버튼 아이콘 E0xx 대응 | 폰트 글리프 확인 필요(assets 담당 BFFNT 변환 후) |
| `hs_mgsetting.csv`, `hs_instsetting.csv` 열 의미 | 읽는 코드 미판독 |
| 보드 장면 `hsbd01`(아카이브 빈칸) 행의 용도 | 호출처 미확인 |
