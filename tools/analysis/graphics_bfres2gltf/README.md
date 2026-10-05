# graphics_bfres2gltf

FRES 9(Jamboree `.fmdb/.fskb/.fshb/.fmab/.fvbb/.fsnb`) → glTF 2.0(glb) + 베이크 JSON 변환기. [BfresLibrary](../../../../tools/oss/BfresLibrary)(수정하지 않음)를 참조하는 .NET 7 콘솔이다. 명세와 근거는 [web/docs/engine/03_graphics.md](../../../docs/engine/03_graphics.md).

## 빌드

```sh
cd c:/dev/mpj/tools/graphics_bfres2gltf
dotnet build -c Release          # → bin/Release/net7.0/graphics_bfres2gltf.exe
```

## 명령

| 명령 | 하는 일 |
|---|---|
| `gltf <x.fmdb> <out.glb> [옵션]` | 모델 하나 → glb. 옵션 아래 |
| `anim <x.fvbb\|x.fmab\|x.fsnb> <out.json>` | 비스켈레탈 애니를 정수 프레임 0..FrameCount 로 베이크한 JSON |
| `dump [--keys] <out.json> <fres 파일...>` | FRES 원자료 JSON(뼈·셰이프·버텍스 속성·재질 전부·애니 커브). `--keys` = 커브 키 원값 포함 |
| `stats <dir> <out.json>` | 디렉터리 아래 모든 FRES 통계(재질 옵션 분포, 속성 형식, 커브 형식 등) |

`gltf` 옵션:

| 옵션 | 뜻 |
|---|---|
| `--anim <x.fskb>` | 스켈레탈 클립 추가(여러 번). 뼈 이름으로 묶는다 |
| `--shapeanim <x.fshb>` | 셰이프(키셰이프) 클립 추가 → glTF morph `weights` 채널. FSHA 는 자체 파서(`Fsha.cs`) |
| `--texdir <dir>` | `web/tools/analysis/graphics_bntx.py png` 결과 폴더. `<tex>.json` 을 읽어 png 파일 이름(배열은 `_00`)을 정한다 |
| `--texuri <prefix>` | glb 안 이미지 URI 앞부분(예 `../tex/`). 이미지는 glb 에 넣지 않는다 |
| `--meta <out.json>` | 변환 결과 요약(메시·정점 수·클립·바인드 검사·필요한 합성 텍스처) |
| `--all` | `container/*`, `fluid/*`, `bezel_*`, `d_buffer` 셰이더의 비가시 셰이프도 넣는다(기본은 뺀다) |
| `--lod <n>` | 셰이프 LOD 번호(기본 0) |

## glb 규칙

- 노드 0 `<모델>__model`(장면 이름 `<모델>__scene`). FRES 루트 뼈가 모델 이름을 그대로 쓰는 일이 많아서 이름을 겹치지 않게 했다.
- 뼈 = 노드. 이름·부모·바인드 TRS 그대로. 회전은 FRES EulerXYZ(R = Rz·Ry·Rx)를 사원수로 바꿨다. three.js 로 직접 오일러를 쓰면 order `'ZYX'`.
- 메시 노드 `<셰이프 이름>__mesh`. `extras.visBone` = 그 셰이프의 가시성 뼈(FRES `Shape.BoneIndex`). 뼈 가시성(fvbb·로직)은 이 뼈 이름으로 메시를 켜고 끈다.
  - skin count ≥ 1 → 모델 루트 아래 SkinnedMesh, 스킨 하나(관절 = 모든 뼈, 역바인드 = 계산 바인드 월드의 역).
  - skin count 0 → 그 뼈 노드의 자식 강체 메시.
  - three.js 에서 SkinnedMesh 는 `frustumCulled = false` 를 권한다(경계구가 바인드 자세 기준).
- 속성: `POSITION NORMAL TANGENT TEXCOORD_n JOINTS_0 WEIGHTS_0`. UV 는 재질 attribAssign(`_uN` ← `_g3d_02_uA_uB` 이면 xy = N, zw = N+1)으로 풀었다. 나머지(`_c0..` 등)는 `_C0` 같은 사용자 속성(vec4 float)으로 원값 보존.
- 키셰이프 → morph target(`_pK − _p0`), `mesh.extras.targetNames`.
- 클립: 정수 프레임마다 키(시간 = 프레임/60), LINEAR. 끝 프레임까지 샘플하려면 three `LoopOnce + clampWhenFinished`. `animation.extras = {frames, loop, fps:60, scaleMode, missingBones}`.
- 재질: glTF PBR 근사 + `material.extras.fres`(셰이더 아카이브·모델·옵션 전부·render info·파라미터 전부·샘플러↔텍스처↔슬롯). 매핑 규칙은 03_graphics.md 5절.
  - metallicRoughness 는 두 장(rgh, mtl)을 합친 `<rgh>__<mtl>.mr.png`(G = 거칠기, B = 금속)가 필요하다. `--meta` 의 `combine` 목록대로 `web/tools/analysis/graphics_convert.py` 가 만든다.

## 일괄 변환과 검증

```sh
.venv/Scripts/python web/tools/analysis/graphics_convert.py mg1801 pc01        # → extracted/converted/graphics/<set>/{model,tex,anim,meta,manifest.json}
node web/tools/analysis/graphics_verify/run.mjs web/tools/analysis/graphics_verify/check.ts pc01 mg1801   # three GLTFLoader 로드·정점·뼈·바인드 스키닝·클립 길이
.venv/Scripts/python web/tools/analysis/graphics_verify/curve_check.py <set> <model> <fmdb> <fskb...>  # 원커브 재계산 vs three 샘플
node web/tools/analysis/graphics_verify/run.mjs web/tools/analysis/graphics_verify/shot.ts mario mg1801  # 헤드리스 스크린샷 → extracted/converted/graphics/shots/
```

다른 세트를 만들려면 `graphics_convert.py` 의 `SETS` 에 함수 하나를 더한다(텍스처 bntx 목록, 모델 + 클립, 비스켈레탈 애니 목록).

## 알려진 한계

- 원본 셰이더(BNSH/BFSHA)는 쓰지 않는다. 재질은 근사이고 셰이더 그래프 재질(캐릭터 등)은 텍스처 좌표 변환·레이어 선택이 셰이더 안에 있어 그대로는 맞지 않는다(03_graphics.md 5.4).
- 세그먼트 스케일 보정(Maya 스케일 모드) 클립은 glTF 로 표현하지 못한다(`scaleMode` 만 기록).
- BfresLibrary 의 v9 버그: `Bone.InverseMatrix` 가 0행렬로 읽힌다(대신 `Skeleton.InverseModelMatrices`), Switch FSHA 카운터 순서 오류(자체 파서로 대체), `ResFile.MaterialAnims` 가 internal(리플렉션).
