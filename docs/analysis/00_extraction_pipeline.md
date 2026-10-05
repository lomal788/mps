# 00. 추출 파이프라인

원본 NSP에서 분석 가능한 파일을 꺼내는 과정과 검증 결과. 모든 산출물은 `extracted/` 아래에 있고, 이 문서의 명령으로 다시 만들 수 있다.

## 1. 원본

| 파일 | 크기 | 비고 |
|---|---|---|
| `F:/dev/mps/original/Mario Party Superstars[01006FE013472000][US][v0].nsp` | 2,924,620,736 | 분석 대상 |
| `F:/dev/mps/original/prod.keys`, `title.keys` | — | 사용자 제공. 값은 문서·로그에 옮기지 않는다 |

원본 폴더에는 쓰지 않는다. 모든 출력은 `F:/dev/mps/` 아래다.

## 2. NSP (PFS0) 구성 [데이터]

| 이름 | NSP 내 오프셋 | 크기 | Content Type | SDK |
|---|---|---|---|---|
| `01006fe013472000000000000000000b.cert` | 0x8000 | 1,792 | | |
| `01006fe013472000000000000000000b.tik` | 0x8700 | 704 | 티켓 (`extracted/nsp/ticket.tik`로 저장) | |
| `7315ffadad68b414a26fd46e0e82d915.nca` | 0x89C0 | 2,922,774,528 | Program | 11.4.4 |
| `645d5af86cb506225a140f8ef46bd5f3.nca` | 0xAE3689C0 | 231,424 | Manual | 11.4.4 |
| `c18c446f19205743363c6d08807134cd.cnmt.nca` | 0xAE3A11C0 | 3,584 | Meta | 13.2.0 |
| `32ec02fa4709c28a099d6670590e025b.nca` | 0xAE3A1FC0 | 1,575,936 | Control | 11.4.4 |

- 모든 NCA는 NCA3다. 배포 형식은 Download, ProgID는 `0x01006fe013472000`이다 [데이터: nstool].
- NSP 파싱은 PFS0 헤더(16 B + 항목 24 B × n + 문자열 표)를 직접 읽었다. 자른 파일은 `extracted/nsp/`에 있다 [실행].

## 3. Program NCA 섹션 [데이터: nstool, `web/tools/analysis/nca_romfs.py info`]

| 섹션 | NCA 오프셋 | 크기 | FS | 해시 | 암호 |
|---|---|---|---|---|---|
| 0 ExeFS | 0xACAA0000 | 0x18C0000 | PFS0 | HierarchicalSha256 (블록 0x8000) | AES-CTR |
| 1 RomFS | 0x1C000 | 0xACA84000 | RomFS | IVFC (6레벨) | AES-CTR, **압축 없음** |
| 2 Logo | 0x4000 | 0x18000 | PFS0 | HierarchicalSha256 (블록 0x1000) | 없음 |

### RomFS IVFC 레벨 (섹션 기준 오프셋)

| 레벨 | 오프셋 | 크기 | 블록 |
|---|---|---|---|
| 0 | 0x0 | 0x4000 | 0x4000 |
| 1 | 0x4000 | 0x4000 | 0x4000 |
| 2 | 0x8000 | 0x4000 | 0x4000 |
| 3 | 0xC000 | 0x4000 | 0x4000 |
| 4 | 0x10000 | 0x564000 | 0x4000 |
| 5 (데이터) | 0x574000 | 0xAC50D9A4 | 0x4000 |

- mpj(잼버리)와 달리 **NCA 압축(BucketTree + LZ4)이 없다**. FS 헤더에 CompressionInfo가 없고, `nca_romfs.py info`도 압축 표를 내지 않았다 [데이터].

## 4. 무결성 검증 [실행 — 자체 스크립트]

`web/tools/analysis/nca_romfs.py verify`로 IVFC 전 레벨을 SHA-256 검증했다. 로그는 `extracted/verify_romfs.log`이고 키 줄은 들어 있지 않다.

| 레벨 | 블록 수 | 불일치 |
|---|---|---|
| 0~3 | 각 1 | 0 |
| 4 | 345 | 0 |
| 5 (데이터) | 176,452 | **0** |

- 전 레벨이 해시 일치한다.
- mpj에서 본 "레벨 4 미사용 꼬리 블록 불일치"는 이 NCA에는 없다.

## 5. 도구

| 도구 | 출처 | 용도 | 결과 |
|---|---|---|---|
| nstool 1.9.2 | [jakcron/nstool](https://github.com/jakcron/nstool) | NCA 헤더·티켓 판독, 콘텐츠 키, ExeFS 추출 | 동작 |
| `web/tools/analysis/nca_romfs.py` | 자체 (mpj에서 복사) | NCA 헤더 XTS, AES-CTR, IVFC 검증, RomFS 목록·추출 | 동작 |
| `web/tools/analysis/nso.py` | 자체 (이번에 작성) | NSO0 세 세그먼트 LZ4 해제 → 평면 이미지 | 동작 |
| `web/tools/analysis/bea.py` | 자체 (mpj에서 복사 후 **구버전 지원 추가**) | BEA(SCNE) 목록·추출, Zstd 해제 | 동작 (6절) |
| `web/tools/analysis/msbt.py` | 자체 (mpj에서 복사) | MSBT → JSON | 동작 |
| `web/tools/analysis/nro.py` | 자체 (mpj에서 복사) | NRO 동적 심볼·재배치 | 동작 |

- mpj 원본 도구는 수정하지 않았다. 모두 `F:/dev/mps/tools/`의 복사본을 쓴다.
- 콘텐츠 키는 nstool이 티켓에서 풀어 낸 값을 셸 변수로만 `--content-key`에 넘긴다. 화면과 로그에서는 키 줄을 걸러 낸다.

## 6. BEA 구버전 형식 (SCNE 0x00010100) [데이터 + 참고 소스]

이 게임의 BEA는 모두 버전 `0x00010100`(VersionMajor2 = 1)이다. mpj의 `bea.py`는 v6 이상만 읽었다.

헤더 공통부(0x00~0x27)는 mpj와 같다: `SCNE`, 버전 @0x8, BOM @0xC, 정렬 @0xE, 파일 수 @0x20, 참조 수 @0x24.

| 오프셋 | v6 이상 (mpj) | v1 (mps) |
|---|---|---|
| 0x28 | asset offset | **FileInfo offset** |
| 0x30 | FileInfo offset | Dict offset |
| 0x38 | Dict offset | (미상 u64, 표본 0) |
| 0x40 | Name offset | **Name offset** |
| 0x48 | Compression name | 없음 |
| 0x50 | Reference list | 없음 |

ASST 항목 (항목 시작 기준):

| 오프셋 | v6 이상 | v1 |
|---|---|---|
| 0x10 | unk u16, unk2 u16, FileSize u32, UncompressedSize u32 | 같음 |
| 0x1C | FileType char[8] | **Unknown3 u32** |
| 0x24 | Unknown3 u32, FileID1/2 u64×2 | — |
| 0x20 | — | **FileOffset i64** |
| 0x28 | — | **FileName offset u64** |

- 근거: BEA-Library-Editor `BevelEngineArchive.cs`·`ASST.cs`의 `VersionMajor2 < 5` 분기(mpj `tools/oss`, 읽기만 함). 실제 파일 476개를 모두 이 배치로 읽어 크기 검사까지 통과했다 [실행].
- 압축은 Zstd(`28 B5 2F FD`)다. FileSize ≠ UncompressedSize이면 압축이다 [데이터].
- **같은 이름의 파일과 폴더**: 한 아카이브 안에 `hs_system/layout.lyt`(80,858,368 B 묶음)와 `hs_system/layout.lyt/sys_tlp.lyt` 같은 항목이 함께 있다. `System.nx.bea`의 `DefaultGlobalLighting.entity`도 같다. 파일 쪽을 `<이름>.__file__`로 저장한다. 해당 항목은 `extracted/bea_extract.err`에 2건 기록돼 있다 [실행].

## 7. 재현 명령

```sh
cd F:/dev/mps
P=.venv/Scripts/python
NCA=extracted/nsp/7315ffadad68b414a26fd46e0e82d915.nca
K=original/prod.keys
CK=$(MSYS_NO_PATHCONV=1 tools/nstool.exe -v -k $K --tik extracted/nsp/ticket.tik $NCA 2>&1 \
     | grep -i -A1 "content key" | grep -o -i -E "[0-9a-f]{32}" | head -1)   # 화면에 내지 않는다

$P web/tools/analysis/nca_romfs.py $NCA --keys $K --content-key $CK verify > extracted/verify_romfs.log
$P web/tools/analysis/nca_romfs.py $NCA --keys $K --content-key $CK list   > extracted/romfs_list.txt
$P web/tools/analysis/nca_romfs.py $NCA --keys $K --content-key $CK extract --out extracted/romfs
MSYS_NO_PATHCONV=1 tools/nstool.exe -k $K --tik extracted/nsp/ticket.tik --part0 extracted/exefs $NCA
$P web/tools/analysis/nso.py extracted/exefs/main extracted/exefs/main.decomp.bin
$P web/tools/analysis/bea.py extract extracted/romfs/Archive/*.bea extracted/romfs/System.nx.bea --out extracted/bea
$P web/tools/analysis/msbt.py extracted/message/KRko extracted/bea/mess.nx.bea/mess/bin/KRko/*.msbt
$P web/tools/analysis/msbt.py extracted/message/USen extracted/bea/mess.nx.bea/mess/bin/USen/*.msbt
```

파이썬 환경: `.venv`(Python 3.14.2). capstone, cryptography, lz4, zstandard, numpy, pillow, texture2ddecoder, xxhash, msgpack, imagecodecs, fonttools.

## 8. 산출물 요약 [데이터]

| 항목 | 값 |
|---|---|
| RomFS | 814 파일, 2,890,924,278 B (`extracted/romfs_list.txt`) |
| RomFS 최상위 | `Archive/`(BEA 476, 2.4 GB), `stream/`(bfstm 209, 349 MB), `nro/NX_Release/`(NRO 126, 44 MB), `System.nx.bea`, `boot.lua`, `.nrr/hs.nrr` |
| BEA 해제 | 477 아카이브(System 포함), 37,333 파일, 약 5.6 GB (`extracted/bea/`) |
| ExeFS | `main`(NSO 11.8 MB → 평면 이미지 0x164F000), `sdk`, `subsdk0`, `subsdk1`, `rtld`, `main.npdm` |
| 메시지 | 15개 언어. KRko·USen을 JSON으로 (`extracted/message/`) |

mpj와 다른 점:
- mpj에 있던 `boot.nbinit`·`ac.nx.archiveconfig`·`movie/`가 없다.
- 대신 `boot.lua`가 엔진 초기화를 한다. `BezelEngineInitializer`, 기본 문화권 `jaJP`, 기준 해상도 1920×1080, GPU 힙 크기 등을 정한다 [데이터].
