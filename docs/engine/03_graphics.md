# 03. 그래픽 — mps 재질 옵션 체계와 웹 three.js 재질 규칙

2026-10-05. 담당: mat. 상태: **hsmg402 무대·눈덩이·캐릭터 재질 판독 / 웹 규칙 구현(view/material.ts) / 화면 대조 없음**(헤드리스 확인은 메인이 마지막에 1회).
문서 형식은 [../분석.txt](../분석.txt). 확정 수준: **[판독]** 원본 셰이더 바이너리(bfsha 리플렉션·Maxwell 코드)나 main 명령, **[데이터]** 파일 값·상관, **[재구현 계산]**, **[추정]**, **[미확정]**.

포맷(FRES/BNTX/glb 변환)은 [../analysis/01_package_and_assets.md](../analysis/01_package_and_assets.md) §2, 조명·안개·IBL·후처리는 [07_camera_lighting.md](07_camera_lighting.md)가 맡는다. 이 문서는 **재질(셰이더 옵션·샘플러·파라미터) → 웹 재질** 만 다룬다.

---

## 1. 결론 요약

| 항목 | 결론 | 수준 |
|---|---|---|
| 재질 셰이더가 있는 곳 | 엔진 공용 `system_boot.nx.bea/…/ndrender/*.bfsha`는 옵션이 **유니폼 분기**(flag 3, `Option` UBO)인 우버셰이더 몇 개(프로그램 3~4)뿐이다. 실제로 그리는 변형은 **장면·캐릭터별 셰이더 팩 `.bnbshpk`**(216개, 예 `hsmg402.nx.bea/_hsmg402.bnbshpk`, `chara~pc~pc01_mario.nx.bea/_chara/pc/pc01_mario.bnbshpk`) 안의 FSHA 들이며 옵션이 **정적 컴파일**(flag 2)이다. 셰이더 그래프 해시(`main_fragment_shader_graph`)도 팩에만 있다 | 판독 |
| `.bnbshpk` 형식 | `BEZSHAPK` + u32 0x00010000 … +0x28 u64 개수, +0x30 u64[개수] FSHA 오프셋. 안의 FSHA = 버전 8.0(0x00080000), BfshaLibrary 로 읽힌다 | 데이터 + 실행 |
| `.bnsh`(211개) | 재질용이 아니라 엔진 계산 셰이더(fluid_*, copy_texture, light_primitive …) | 데이터 |
| 재질 옵션 뜻의 근거 | ① 옵션 이름 ② 재질 옵션으로 고른 **프로그램이 실제로 묶는 샘플러·UBO**(bfsha 위치표, −1 = 안 씀) ③ 그 프로그램 **VS/FS Maxwell 코드**(envydis gm107 로 디스어셈블, 유니폼·샘플러 이름 주석). 표는 4·5절 | 판독 |
| 바인딩 규칙 | UBO 위치 L → `c[L+3]`, 샘플러 위치 L → 텍스처 핸들 `8 + 2L`, 정점 속성 위치 = bfsha attributes(`_u0`=10 등), varying = `a[0x80 + 16i]` | 판독(전 프로그램에서 일관) |
| `use_*`·`basecolor_source0..3`·`material_layer_count` | **두 체계가 섞여 있다.** `use_*`·`texture_srt_*`·`tangent_*` 등은 forward_plus 계열(map/custom/simple/char/plant…) 옵션이다. `basecolor_source0..3`·`material_layer_count`·`*_map_uv_index*`·`layered_occlusion_mode*` 등 154개는 **`bezel_pbr`(System.nx.bea `_BezelSystemResources/pbr`) 전용**이며 게임 전체에서 재질 20개만 쓴다(모두 `material_layer_count` 1, `basecolor_source0` 2). **hsmg402 와 캐릭터 재질에는 하나도 없다** | 데이터 |
| 기본색 | `_a0`(GLSL `s_BaseColor0`) × `blendColor`(rgba). forward_plus_simple 은 이것이 그대로 출력 | 판독(simple·map·cloud·snow FS) |
| UV | 샘플러마다 셰이더 입력 `_uK`(= glb TEXCOORD_K, 변환기가 attribAssign 반영)와 `texsrtK`(2×3 행렬, VS 에서 곱함)를 **프로그램마다 다르게** 쓴다 → 웹은 프로그램 판독 표(`material.json` rules)를 따른다 | 판독(VS·FS 자료흐름, web/tools/analysis/mat_uvmap.py) |
| 라이트맵 | forward_plus_map `use_lightmap` 1: `_l0`(TEXCOORD_1, srt 없음), 확산 = albedo·(1−metallic)·lm.rgb·`lightMapScale`·`lightmap_color_scale`(env), lm.a 는 IBL 가림. `directional_light_off` 1 이면 평행광 계산이 아예 없다 | 판독 |
| IBL 배율 | 확산 IBL × `irradianceColorScale`, 반사 IBL × `radianceColorScale`. hsmg402 의 bg·ice·절벽은 irradianceColorScale 0(확산 IBL 없음) | 판독 |
| 셰이더 그래프 | hsmg402 팩에 5개(구름·지면/눈덩이 2종·오로라·절벽). 구름·오로라 FS 전체, 눈 2종은 직접광(그늘 램프 포함)·확산 IBL(시선 irr)·림·최종 곱까지, 절벽은 일부 판독(7절) | 판독(절벽 일부) |
| texsrt 행렬 | 셰이더는 u′ = M0·u + M2·v + M4, v′ = M1·u + M3·v + M5 [판독]. 값 = nn::g3d Maya 식(8절): u′ = sx·(c·u + s·v − 0.5c − 0.5s + 0.5 − tx). u 쪽은 눈꺼풀 셀 이동 데이터와 맞음 [데이터], v 부호·회전 부호 [추정] | 판독 + 추정 |
| renderInfo | `state_type` 0 불투명 / 1 컷아웃 / 2 알파 섞기 / 3 더하기, `face_cull_type` 0 뒷면 / 1 앞면 / 2 양면 — 모두 쓰는 재질 상관으로 [추정](main 해시 키 참조처를 못 찾음) | 추정 |

---

## 2. 자료·도구 위치

| 무엇 | 위치 |
|---|---|
| 재질 원값 | glb `materials[].extras.fres`(`web/tools/analysis/graphics_bfres2gltf`): shader{archive, model, options, samplerAssign, attribAssign}, renderInfo, params, samplers |
| 재질 조사 | `web/tools/analysis/mat_survey.py` → `analysis/mat/hsmg402_mats.json`(재질 77개: 무대 19 + 캐릭터 10명 58), `hsmg402_options.tsv`(옵션 98종 × 재질) |
| 셰이더 팩 분리 | `web/tools/analysis/bnbshpk_split.py` → `analysis/mat/shpk/<hsmg402|pcNN_*>/<archive>.bfsha` |
| bfsha 덤프 | `web/tools/analysis/bfsha_dump/`(C#, BfshaLibrary·Syroot 를 Switch-Toolbox 에서 복사, net7) — `model` : 셰이딩 모델별 정적/동적 옵션·샘플러·UBO 필드 오프셋(오프셋은 저장값 −1)·속성 위치 → `analysis/mat/shpk/**/*.json`, `analysis/mat/bfsha/*.json`(공용). `match` : 재질 옵션으로 프로그램을 고르고(`ShaderModel.GetProgramIndex`) 쓰는 샘플러·UBO 위치, 리플렉션 이름(`s_BaseColor0` …), VS/FS 코드 → `analysis/mat/prog/` |
| 디스어셈블 | envytools `envydis -m gm107`(소스 `tools/oss/envytools`, `zig cc` 로 빌드 → `tools/envydis_build/envydis.exe`). `web/tools/analysis/sass_dis.py` 가 코드(+0x80, 앞 0x30 NVN 머리 + 0x50 SPH)를 풀고 `cN[off]`→UBO 필드, 핸들→샘플러, `a[]`→varying 주석 → `analysis/mat/sass/<팩>__<archive>__p<번호>.{vs,fs}.txt`(72 프로그램). Windows 표준입력 바이너리 모드는 0x1A 에서 끊겨 32비트 단어 hex 텍스트로 넘긴다 |
| UV 표 | `web/tools/analysis/mat_uvmap.py`(VS: 입력 → texsrt → varying, FS: varying → 샘플 좌표 자료흐름) → `analysis/mat/hsmg402_uvmap.json` |
| 웹 자료 | `web/tools/analysis/hsmg402_mat_assets.py` → `web/assets/hsmg402/material/material.json`(rules 76, glb 밖 텍스처 9 = 6.9 MB, env) + `material/tex/`. `hsmg402_web_assets.py` 가 지우는 폴더 밖이다 |
| 웹 코드 | `web/script/games/hsmg402/view/material.ts`(게임 비의존), 연결 stage.ts·balls.ts·character.ts |
| 노드 검사 | `web/tools/check_hsmg402_material.ts`(77 재질 변환·셰이더 치환 0 실패) |

조명 담당은 같은 SASS 를 nvdisasm 으로 풀었다(`web/tools/analysis/bnsh_sass.py`, 07 문서). 두 디스어셈블러는 같은 코드를 읽는다.

---

## 3. 셰이더 아카이브 구조 [판독 + 데이터]

### 3.1 공용 vs 팩

| | 공용 `system_boot…/forward_plus_map.bfsha` | 팩 `_hsmg402.bnbshpk` 안 `forward_plus_map` |
|---|---|---|
| 정적 옵션 | 61, flag 3(분기 오프셋 9~269 → `Option` UBO 272 B 의 필드) | 61, **flag 2**(키 비트) |
| 프로그램 | 3 | 384 |
| 그래프 해시 선택지 | `main_fragment_shader_graph` = {0} | {0, 474410661, 746197195, 2263802738, 2978185753, 4268919678}(custom) |

`_hsmg402.bnbshpk` 의 FSHA 8개: light_model, container(environment·posteffect·fluid), **forward_plus_custom(1152 프로그램)**, forward_plus_map(384), forward_plus_water(6), forward_plus_simple(144), forward_plus(96), forward_plus_fluid(12). 캐릭터 팩: forward_plus_fluid + forward_plus_custom(256, 그래프 = 몸·눈·눈썹) [+ forward_plus_char(피치·데이지·로제타·와루이지)].

### 3.2 UBO (forward_plus_color_custom)

`Option`(272), `Material`(608: utilityColor0~3, utilityParameter0~7, utilityIntegerParameter0, texsrt0~3, blendColor, baseColor, rimLightColor, outlineColor, reflectionColor, parallaxCorrectedCubemap*, cloudShadowUvScale, metallic, roughness, bumpScale, emissionScale, detailMetallic, rimlightShadow, rimPower, rimlightColorScale, IblDensity, distortion*, radianceColorScale, irradianceColorScale, vat*, outline*, backgraoundMode, lightGrid*, normalDirectionOffsetScale, punchThroughThreshold*, materialId), `Shape`(64, 모델 행렬), `Skeleton`(6144), `View`(496, 카메라 위치 +0x1a0), `EnvironmentParamBuffer`(1392: 평행광 색 +0x10, 방향 +0x20, IBL 배율 +0x1e0/+0x1e4, IBL 회전 cos/sin +0x200/+0x204, 안개 색 +0x210, 안개 모드 +0x22c, **라이트맵 배율 +0x264 [추정: env `lightmap_color_scale`]**, 유체 높이장 +0x3f0~ / 핸들 +0x540), `ModelParamBuffer`(608: 국소 IBL 큐브 핸들 +0x1c0~, 두 탐침 섞기 +0x124 …), `DynamicOptionBuffer`.

### 3.3 샘플러 (리플렉션 GLSL 이름)

| 재질 샘플러 | GLSL | 뜻 |
|---|---|---|
| `_a0` | s_BaseColor0 | 기본색 |
| `_n0` | s_Normal | 노멀(rg, z 재구성) |
| `_r0` | s_Roughness | 거칠기(r) |
| `_m0` | s_Metallic | 금속(r) |
| `_e0` | s_Emission | 발광 |
| `_l0` | s_LightMap | 라이트맵(map) |
| `_r1`/`_n1`(custom), `_r3`/`_n3`(map) | s_DetailRoughness / s_DetailNormal | 디테일 |
| `_a1`·`_a2`·`_n1`·`_n2`·`_r2`(map) | s_BaseColor1/2 … | `use_layer_tex` 층(hsmg402 미사용) |
| radianceIbl / irradianceIbl | s_LocalIbl0/1 | 재질 국소 IBL 큐브(`use_local_ibl`) |
| parallaxCorrectedCubemap | s_ParallaxCorrectedCubemap | 시차 보정 큐브 |
| utilitySampler0~7, …Array0~3, …Cube0~1, …3D0~1 | s_UtilitySamplerN | **셰이더 그래프 입력**(뜻은 그래프마다) |
| vatPostiton … | | 정점 애니 텍스처 |

재질 샘플러 이름 ≠ 셰이더 샘플러일 수 있다(`samplerAssign` = 셰이더 이름 → 재질 이름). 예: ice_mt 는 `_n0 → hsmg402_ice_mt_rgh`(거칠기 텍스처를 노멀 자리에 묶음 — 원본 데이터 그대로) [데이터].

---

## 4. 옵션 뜻 표

수준 표기: 이름 = 옵션 이름에서, P = 프로그램 샘플러/UBO 사용 여부로, S = SASS 식으로.

| 옵션 | 뜻 | 근거 | hsmg402 값 |
|---|---|---|---|
| `global_lighting` | 평행광·IBL 등 조명 계산 켬 | 이름 + S(0 인 sky 계열은 조명 없음) | 무대·캐릭터 1 |
| `global_ambient` | 주변(IBL 확산) | 이름 [추정] | 1 |
| `local_lighting` / `light_grid_enable` | 점·스포트 광원 루프 / 라이트 그리드 | 이름 + S(`c8[...]` 광원 목록 읽음, 캐릭터) | 캐릭터 1 |
| `directional_light_off`(map) | 평행광을 뺀다 | **S: map p0/p96/p192 FS 에 평행광 색(Env+0x10) 참조 0건** | bg·ice·tree 1 |
| `use_lightmap`(map) | `_l0` 라이트맵 | S(위 식) | bg·ice·tree 1 |
| `receive_shadow` | 그림자맵 읽음 | S(`tex … array t2d dc` 비교 샘플) | 대부분 1 |
| `shadowmap_pcf_type` / `shadowmap_receive_type` | 그림자 필터 / 받는 방식 | 이름 | 1 / 캐릭터 2 |
| `cloud_shadow` | 구름 그림자 텍스처(Env 핸들 +0x4c0, UV = v0.w·v1.w) | S. env `cloud_enable` 0 이라 효과 없음 | 무대 1 |
| `use_vertex_color` / `vertex_color_index` | 정점색 곱 | 이름. 그래프는 이 옵션과 별개로 `_c0` 를 직접 읽는다(오로라·눈) | 오로라 1 |
| `use_base_color_value` | `baseColor` 상수로 기본색 | 이름 [추정] | 0 |
| `use_metallic_value` / `use_roughness_value` | 텍스처 대신 `metallic` / `roughness` 상수 | 이름 + S(fld: 거칠기 = min(노이즈, roughness)) | 혼재 |
| `use_normal_map` | `_n0` 노멀 | P | 대부분 1 |
| `use_emission` | `_e0` × emissionScale 을 마지막에 더함 | **S(ice p192)** | ice 1 |
| `use_fog` | 안개 적용 | S(fog 분기 Env+0x22c) | map·캐릭터 1, 지면·눈덩이 0 |
| `use_local_ibl` | 재질 국소 IBL 큐브(radianceIbl/irradianceIbl) | P | 눈덩이 1 |
| `use_parallax_corrected_cubemap` | 시차 보정 큐브 | P | 절벽 1 |
| `use_reflection_buffer` | 반사 버퍼(물) | 이름 | ocean 1 |
| `rim_lighting` | 림 = rimLightColor·광색·pow(1−N·V, rimPower)·rimlightColorScale(+rimlightShadow 항) 을 더함 | **S(fld p768 끝부분)** | 오로라·지면·눈덩이·와루이지 1 |
| `use_detail_map`, `use_detail_color/roughness/metallic`(0~3), `use_detail_metallic_value` | 디테일 맵과 섞는 방식(값 = 섞기 모드) | P(`_r3/_n3`·`_r1/_n1` 사용). 모드별 식 [미확정] | bg·ice 1·2 |
| `texture_srt_enable0..3` | texsrtK 사용 | 이름 + S | 혼재 |
| `texture_srt_base_color/normal/…/lightmap/detail_map`(0~3) | 그 맵이 쓰는 texsrt 번호 | S(bg: `texture_srt_detail_map` 2 → 디테일 UV = texsrt2) | |
| `tangent_normal` / `tangent_detail_map` | 접선 공간 해석 | 이름 | 0 |
| `normal_flip` | 뒷면 노멀 뒤집기 | 이름 | 0 |
| `ibl_type` | IBL 종류(캐릭터 1) | 이름 [미확정] | 캐릭터 1 |
| `ambient_lighting_type` | 0~2 | 이름 [미확정] | 0 |
| `vat_*`, `uv_index_vat_*` | 정점 애니 텍스처 | 이름 | 0 |
| `use_geo_decal*`, `use_decal_normal` | 지오메트리 데칼 | 이름 | 0 |
| `use_dstortion_blend_value` | 왜곡 섞기 상수 | 이름 | 1 |
| `main_fragment_shader_graph` / `main_vertex_shader_graph` | 셰이더 그래프 해시(팩에만 코드) | 데이터 | 7절 |
| 동적 옵션 `use_punchthrough`, `alpha_lighting`, `use_dither`, `shader_type`, `bezel_skinning_count_option`, `instancing_mode` | 그릴 때 엔진이 고름(재질 옵션에 없음) | 이름 | — |
| forward_plus_water `use_wave_texture`, `distortion_mode`, `muddy_mode`, `use_caustics` … | 물 | 이름 | ocean |
| bezel_pbr `material_layer_count` 1~4, `basecolor_source0..3`(0~3), `smoothness/metalness_source*`, `normal_map_mode*`, `layered_occlusion_mode*`, `*_map_uv_index*`(0~5), `uv_slot_*`, `vertex_uv_index*`, `mask_mode*`, `sss_*`, `specular_aa_mode` … | 4층 레이어 PBR(층마다 기본색 원천·UV 슬롯·마스크). 원천 값 0~3 의 뜻(텍스처/정점색/상수) [미확정] | 이름 + 데이터(20 재질) | **hsmg402 미사용** |

## 5. renderInfo [데이터 + 추정]

| 키 | hsmg402 값 → 뜻 |
|---|---|
| `render_color` | 0 → 그리지 않음(색 패스 제외) [추정] |
| `state_type` | 0 대부분(불투명) / **1 DK `body_alpha_m`**(털 가장자리 → 컷아웃, `punchThroughThresholdColor` 0.5) / **2 구름·눈덩이 부서짐·속눈썹 `alfa_m`**(알파 섞기) / **3 오로라·하늘띠 `sky_grad_mt`**(더하기) — 모두 [추정] |
| `face_cull_type` | 0 대부분 / 1 `snowball_fluid`(유체 붓 — 높이장에만 그림) / 2 오로라 띠·DK 털 → 0 뒷면 컬링, 1 앞면 컬링, 2 양면 [추정] |
| `cast_shadow` | 1 → 그림자 드리움 |
| `render_water` / `read_water_buffer` / `render_reflection` / `reflection_flip_flag` | 물 반사 패스 참여·읽기 |
| `fluid_type` | 유체 붓 셰이더 |
| `priority`, `write/test_stencil_id`, `render_outline` | 정렬·스텐실·외곽선(모두 기본값) |

renderInfo 이름은 main 에 (이름, 전역 해시 주소, 0x403) 표(`0xfc9e88`~)로 등록돼 있으나 그 전역(0x14b37c0 …)을 읽는 코드를 ADRP 스캔으로 못 찾았다 → 뜻은 [추정]으로 둔다.

---

## 6. hsmg402 재질별 판독 (UV = glb TEXCOORD, srt = texsrt 번호, — = 변환 없음)

| 모델:재질 | 아카이브 / 그래프 | 샘플 (UV·srt) | 식 요지 |
|---|---|---|---|
| sky:`sky_mt` | simple | `_a0` sky_alb (0·—) | **out = tex·blendColor**, 조명·안개 없음 [판독 FS 전체] |
| sky:`sky_grad_mt` | simple | `_a0` sky_grad (0·srt0) | 같은 식, blendColor.a 0.55, state 3 |
| sky:`cloud_mt` | custom 2978185753 | `_a0` cloud_alb (0·0), util0 cloud_mask (1·1)·(2·2), `_e0` aurora_grad02 (3·3) | **rgb = _e0.rgb·emissionScale, a = _a0.a·blendColor.a·mask₁.a·mask₂.a**, 조명 없음 [판독 FS 전체] |
| bg:`bg_mt`·`tree_mt`, ice_*:`ice_mt` | map | `_a0`·`_n0`·`_r0` (0·—), `_l0` base_lmp (1·—), `_r3`·`_n3` 디테일 (0·srt2), ice `_e0` = ice_mt_alb (0·—) | 평행광 없음. 확산 = alb·blend·(1−m)·lm.rgb·lightMapScale·Env+0x264, + lm.a·(반사 IBL·radianceColorScale + 확산 IBL·irradianceColorScale) + `_e0`·emissionScale, 안개 [판독] |
| bg:`ocean_mt` | water | `_n0` 두 번(흐름), flowmap (0·srt1), `_rad` | 물 셰이더 — 미반영(일반 PBR 근사) |
| fld:`fld_snow_mt` | custom 746197195 | `_a0` fld_alb·`_n0` (0·—), util1 fld_noise 3면 투영(월드 ×10), util2 fld_dif 램프, util0 fld_sg_alb | 7.2 |
| fld:`fld_snow_fluid_mt` | custom 746197195 | 위 + `_r0` (0·—), `_r1`·`_n1` 디테일 (1·srt1) | 7.2 |
| fld_cliff:`fld_cliff_mt` | custom 2263802738 | `_a0`·`_n0`·`_r0` (0·srt0), `_r1`·`_n1` (1·srt1), util0 cliff_lmp·util1 cliff_ao·util2 cliff_gi (2·—), pal_rad 시차 큐브 | 7.4 |
| aurora:`aurora*_mt` | custom 474410661 (+정점 그래프 942998815) | `_a0` aurora00 (0·0), util0 grad00 (1·1), `_e0` grad01·util2 mask (0·srt2), util1 noise(VS) | 7.3 |
| snowball:`fld_snow_mt` | custom 4268919678 | `_a0`·`_n0`·`_r0` (0·—), `_r1`·`_n1` (1·srt1), util1 3면 노이즈, util2 fld_dif, util0 snowball_alb, 국소 IBL snowball_rad/irr | 7.2 |
| snowball_break:`fld_snow(_fluid)_mt` | custom 4268919678 | `_a0`·`_n0` (0·srt0) … | 7.2, state 2, blendColor.a 애니 |
| snowball:`fld_snow_fluid_mt`, pcNN:`*fluid_m` | fluid | 높이·속도 붓 | 장면에서는 숨기고 fluid.ts 가 높이장 붓으로 그림(7.6) |
| pcNN:`body_m` | custom(캐릭터마다 다른 해시) | `_a0`·`_n0`·`_r0`·`_m0` (0·—), util1 cvt(곡률, ga), util0 lut(산란 LUT, 여러 번), 3D 텍스처(t3d) | 7.5 |
| pcNN:`eye_m` | custom | 눈꺼풀 `_a0`·`_n0`·`_r0` (0·srt0), 홍채 util2 eye_alb (1·srt1)·(2·srt2) | 7.5 |
| pcNN:`alfa_m`(속눈썹) | char | `_a0` | state 2 |

---

## 7. 셰이더 그래프 판독

### 7.1 구름 2978185753 [판독: FS 23줄 전체]
위 표 그대로. 조명·안개·정점색 없음.

### 7.2 눈(지면 746197195 / 눈덩이 4268919678) [판독: p384·p768·p512 FS, 2026-10-06 color 담당 보강]
- 기본색 = `_a0`·blendColor, 노멀 = `_n0`·bumpScale(+ 지면은 유체 높이장 텍스처(Env 핸들 +0x540, UV = (월드 xz − Env+0x3f0)·Env+0x3f8)로 노멀 변형 [판독]).
- 거칠기(지면) = min(util1 노이즈 3면 투영(월드 좌표 ×10, 법선 가중), `roughness`) [판독].
- **평행광 확산 = mix(알베도·램프(0, 0), (알베도·램프(N·L·0.5 + 0.5, 0) + 반사)·광색, 그림자)** — N·L 을 곱하지 않고 램프가 대신한다. 그늘(그림자 0)에서도 알베도 × 램프(0,0)(sRGB 115 → 0.171) 가 남고 광색은 곱하지 않는다. 지면·눈덩이 모두 같다 [판독: p384 `0x1318~` 끝, p512 끝부분]. 램프 샘플러는 Clamp [데이터 fmdb].
- **확산 IBL = 알베도·(1−metallic)·(1−F)·(irr(N) + 램프(0.6, 0)·irr(V))·irradianceColorScale·Env+0x1e4**, V = View+0x1b0 = `Camera::GetViewVector`(눈→주시점) — 큐브 조회는 둘 다 (x, y, −z)(지면은 IBL 회전 뒤). 지면은 장면 irr(ModelParamBuffer +0x230 핸들), 눈덩이는 재질 국소 `irradianceIbl`(snowball_irr) [판독: p384 `0xcd0~0xec0`, p512 142~245행]. 반사 IBL = rad(R, LOD 거칠기·6.5)·EnvBRDF 근사(c1 상수 1.04·0.0425·0.04 …)·radianceColorScale. IBL 전체에 AO = _r0.a·mix(1, _r1.a, _a0.a) (hsmg402 텍스처 a = 1).
- 화면 수치 대조(무대 한 점 원본 식 sRGB (144, 219, 242) vs 공식 스크린샷 (144, 220, 242))는 [07_camera_lighting.md](07_camera_lighting.md) 12절.
- 림 = rimLightColor·광색(Env+0x10)·pow(1 − N·V, rimPower)·rimlightColorScale, rimlightShadow 항 [미확정 세부].
- **출력 rgb × util0(u, v = 0)**. u 는 프로그램마다 다르다: 지면 윗면 `fld_snow_fluid_mt`(p384, 정점 입력에 `_c0` 없음)는 **VS 의 a[v6.w] = −(유체 높이장 표본)**(눈 자국 깊이), 가장자리 `fld_snow_mt`(p768)·눈덩이는 정점 속성 6(`_c0`).w — 메시에 정점색이 없어 미바인드 값 [미확정]. 다만 fld_sg_alb 는 거의 한 색(sRGB 206~222·211~223·214~231)이고 Wrap 이라 u 가 무엇이든 결과는 같다 → 웹은 (1, 0), 지면 윗면만 MPS_FLUID 로 (−h, 0)(7.6) [판독 + 데이터].
- 국소 IBL(눈덩이 `use_local_ibl` 1: snowball_rad/irr), irradianceColorScale 2.5.

### 7.3 오로라 474410661 [판독: p128 FS 전체, VS 일부]
- base = sat(`_a0`.rgb·정점색.rgb·blendColor.rgb·sat(utilityColor0.rgb)) (`_a0` uv0·srt0, 정점색 aurora01·04 = 0.5, 02·03 = 0.7).
- D = dodge(base, sat(util0 grad00(uv1·srt1))) = base ≥ 1 ? 1 : min(grad/(1−base), 1).
- E = sat(`_e0` grad01(uv2·srt2))·sat(utilityColor1)·utilityParameter1.y (sat), A = sat(D·utilityParameter1.x).
- **rgb = D·(1−m)·[(1−F0)·irr(N)·irradianceColorScale·Env+0x1e4 + (1 + 반사)·광색·sat(N·L)] + 반사 IBL + overlay(A, E)**, overlay = A < 0.5 ? 2AE : 1 − 2(1−A)(1−E). 노멀은 정점 노멀(노멀 맵 없음), 앞뒷면 구분 없음. 구름 그림자 곱은 Env+0x1c = 0 이라 1.
- **a = `_a0`.a·정점색.a·blendColor.a·util2(mask, uv2·srt2).r·(1 + `_e0`.r)** (`ffma r3 = e.r·α + α`).
- 정점 그래프 942998815: 월드 위치 += util1(noise_alb, uv3·srt3).r·utilityParameter0.xyz (aurora_mt (1, 1.3, 0), aurora_01 (0.5, 1.2, 0)) [판독 VS]. noise_alb 는 웹 자료에 없어 옮기지 않았다 [근사].
- renderInfo state_type 3(더하기 [추정]), face_cull 2(양면).

### 7.4 절벽 2263802738 [판독 일부]
lmp(util0) 와 gi(util2) 를 어떤 계수로 섞고(mix(gi, lmp, k)), ao(util1), 시차 보정 큐브(pal_rad) 반사, 평행광·광원 루프. 계수 k 의 출처 [미확정].

### 7.5 캐릭터 [판독 일부]
- 몸: PBR(`_a0`,`_n0`,`_r0`,`_m0`) + util1 곡률(cvt, g·a) + util0 산란 LUT 를 광원마다 읽음 + 3D 텍스처 다수(t3d) → 피부·옷 산란 셰이딩. 식 미옮김.
- 눈(pc01): 홍채₁ = eye_alb(TEXCOORD_2·srt2), 홍채₂ = eye_alb(TEXCOORD_1·srt1). 홍채 = mix(홍채₁, 홍채₂, 홍채₂.a), a = sat(a₁ + a₂). 눈 = mix(**utilityColor0**(흰자, 0.815·0.776·0.776), 홍채, a). 결과 = mix(눈, 눈꺼풀 `_a0`(TEXCOORD_0·srt0), 눈꺼풀.a) [판독]. 캐릭터마다 그래프 해시가 다르고 요시·캐서린은 샘플러 배치가 다르다(요시 `_a0` = body_alb + util0 eye, 캐서린 `_a0` = eye_alb).

### 7.6 유체 높이장(눈 자국) — bex `NdRenderPassModelFluid` [판독 + 데이터, 2026-10-06 fluid 담당]

근거: main 디컴파일 `analysis/decomp/fluid_render.c`(FUN_71003ee4d0 패스, FUN_71003ee0a0 add, FUN_71003ed854 준비), `fluid_rt.c`(RT 생성), `fluid_prep.c`(붓 카메라), `fluid_blendtab.c`(블렌드 표), 디스어셈블 main 0x7100421374(Env 칸)·0x71003c0414(모델 파라미터)·0x71003ec2bc(붓 블렌드), 셰이더 `analysis/mat/sass/`(붓 `*forward_plus_fluid*`, 지면 `hsmg402__forward_plus_custom__p384`, 엔진 `system_boot__fluid_*.fs.sass`). 검증 `web/tools/check_hsmg402_fluid.ts`(원본 기계어 에뮬레이트 대조).

**자료.** 유체 설정은 장면 모델의 `container/fluid` 재질 파라미터(hsmg402: `hsmg402_fluid.fmdb` 재질 `fld_fluid`) — `fluid_render_enable` 1, `fluid_clear_enable` 0, `fluid_texture_clear_enable` 1(초기 텍스처 `height_clear_texture` = `hsmg402_fld_clear`), `fluid_generate_normal_enable` 1, 512², `fluid_world_width` 19, `fluid_world_height` 0.3, `fluid_world_position` (0,0,0), `fluid_simulation_enable` 0, `fluid_heightmap_add_value` 0.00015 [데이터]. main 의 유체 설정 객체(게터 0x71003be6e4~0x71003be818): +0 render, +1 clear, +2 normal, +3 texture_clear, +4 simulation(바이트), +8 위치, +0x14 폭, +0x18 높이, +0x1c 감쇠, +0x20 소산, +0x24 add, +0x28/+0x2c 텍스처 크기 [판독].

**Env(EnvironmentParamBuffer) 칸 [판독: 0x7100421374].** W = 폭, D = W·H/Wtex.
| 칸 | 값 | hsmg402 |
|---|---|---|
| +0x3f0 / +0x3f4 | 위치.x − W·0.5 / 위치.z − D·0.5 | −9.5 / −9.5 |
| +0x3f8 / +0x3fc | 1/W, 1/D | 1/19 |
| +0x400 | fluid_world_height(깊이) | 0.3 |
| +0x408 / +0x40c | W/Wtex, D/Htex (텍셀 월드 크기 A·B) | 0.0371 |
| +0x410 / +0x418 / +0x41c / +0x420~ | 프레임 계수 s12, 감쇠, 1/(소산·s12+1), s12/폭… (시뮬레이션용) | — |
| +0x428 / +0x42c | 1/Wtex, 1/Htex | 1/512 |
| +0x538 / +0x540 / +0x548 … | 높이·노멀·속도… RT 의 bindless 핸들 | — |

월드 → 높이장 UV: **u = (x − (+0x3f0))·(+0x3f8), v = (z − (+0x3f4))·(+0x3fc)** — v 는 +z 쪽으로 커진다.

**한 프레임(뷰포트마다) — FUN_71003ee4d0 [판독].** Engine+0x210 ≠ 0(일시정지)이면 붓·add 를 건너뛴다.
1. 처음(또는 크기 바뀜·clear_enable) → 높이·속도 RT 0 으로 지움, texture_clear 면 `fluid_clear`(out = clear_tex.r, 블렌드 0 = 끔)로 높이 = fld_clear. hsmg402 는 clear_enable 0 → **첫 프레임 한 번만**.
2. 붓: 높이 RT + 속도 RT 두 타깃, 블렌드 = 두 타깃 모두 **src·1 + dst·1 (Add)** [판독: 0x71003ec310 BlendTargetStateInfo 바이트 01 01 00 01 / 01 00]. 붓 목록 = 뷰포트의 모델 중 재질 `fluid_type` 이 있는 것(람다 0x71003d20c0 → 0x71003ed7b4). 컬링 = 재질 face_cull_type. 카메라 = 정사영 x ∈ 위치 ± W/2, z ∈ 위치 ± D/2, y ± 1000(FUN_71003ed964). 셰이더 FS 는 깊이를 쓰지 않으므로 붓 메시의 위에서 본 실루엣이 한 번 칠해진다.
3. simulation 0 → FUN_71003ee0a0: add ≠ 0 이면 `fluid_add`(out = add) 를 블렌드 0xf(**Add**)로, 이어 `fluid_clear`(clear 텍스처)를 블렌드 0xd(**Min**, add > 0) / 0xe(Max, add ≤ 0)로 → **h = min(h + 0.00015, fld_clear)**. 블렌드 표(FUN_7100416b90): 0 끔, 2·3 알파, 0xd = One·One·Min, 0xe = One·One·Max, 0xf = One·One·Add [판독, nn::gfx BlendFunction 순서 Add/Subtract/ReverseSubtract/Min/Max].
4. normal_enable → `fluid_normal` 로 노멀 RT.

**붓 셰이더 [판독].** 출력 RT0.r = 높이 증분, RT1.rg = 속도(시뮬레이션 꺼짐이라 화면 영향 없음).
- 기본(그래프 없음, system_boot forward_plus_fluid): h += height_tex.r·Material.heightScale·M160.
- ModelParamBuffer(0x190 부터 0x228 B 복사, 0x71003c0414): **M[0x0~0x8] = 모델 현재 위치**, **M[0x8c] = |현재 위치 − 이전 위치|**(프레임 이동 거리), M[0x80~0x88] = 회전 행 내적, **M[0x160] = 모델 유체 높이 배율**(`bex::Model::SetModelFluidHeightMapScale`, 기본값 [추정 1: Get 의 모델 없음 반환값], hsmg402 는 설정 호출 없음), M[0x164] = 속도 배율, **M[0x170~0x178] = 뼈 `NDinput_0` 위치 xyz**, +0x180~ = NDinput_1~3.
- 눈덩이 `fld_snow_fluid_mt`(그래프 2315590677, p6): **h += −fluid0_hgt(x − M0.x + 0.5, 0.5 − (z − M0.z))·sat(10·M[0x8c])·M160** (x, z = 붓 메시 월드 위치, 텍스처 BC1_SRGB → 선형, Clamp). 붓 메시 = `snowball_fluid`(반지름 1.12 구 × 노드 0.6 × 공 배율), face_cull 1. heightScale(−10)은 그래프가 쓰지 않는다.
- 캐릭터 `L_footfluid_m`·`R_footfluid_m`·`bodyfluid_m`(pc01 p0/p6/p12): w = M[0x174]·M[0x178]·M[0x170](= NDinput_0.y·z·x), s = sat(10·M[0x8c]), t = utilitySampler0(UV0).r(**BC4_SNORM**, 발 중심 −0.787, 몸 중심 −0.321·가장자리 +0.28), **h += t·w·(w ≥ 1.01 ? 1 : s·utilityParameter0.x)·utilityParameter1.x·M160** — 1.01 은 프로그램 제어 섹션 끝 상수(c1[0x0], `analysis/mat/prog/*.fs1.bin` +0x400). utilityParameter1.x = 0.5(피치·와리오 몸 0.35) [데이터]. NDinput_0 이동 채널이 모션마다 붓 켬/끔을 담는다(걷기 y·z 0/1 교대 = 발 디딤, 대기 (1,1,1), 피격·승리 최대 3) [데이터: chara glb 애니]. 붓 메시 = 발 판(0.36×0.49, 노드 fluid_L/R_foot 애니로 디딘 자리 고정)·몸 원판(지름 1.21, 배율 애니).
- `hs::actor::Actor::SetMaterialUtilityScaleFoot(v)` = 재질 `L_footfluid_m`·`R_footfluid_m` 의 utilityParameter0 = v, `…Body` = `bodyfluid_m` [판독 0x71000ea3c0]. hsmg402 `FluidMaterialParamChange` 는 Foot 만 부른다.
- 높이장 RT 형식(인덱스 0x15 설정표) [미확정]. 웹은 float + [−1, 1] 자르기 [추정: SNORM].

**fluid_normal [판독: 반정밀도 기호 풀이 + 에뮬 대조].** 9 텍셀(TLD4 4번, 마스크 0xa·0x6·0xd·0x3)로 **n = normalize(B·S·[(h₋₁,₋₁ + 2h₋₁,₀ + h₋₁,₁) − (h₁,₋₁ + 2h₁,₀ + h₁,₁)], 8·A·B, A·S·[(h₋₁,₋₁ + 2h₀,₋₁ + h₁,₋₁) − (h₋₁,₁ + 2h₀,₁ + h₁,₁)])**, h_{i,j} = 텍셀 (u+i, v+j), S = +0x400, A·B = +0x408·+0x40c. TLD4 성분 순서는 GL gather 순서로 [추정].

**지면 `fld_snow_fluid_mt`(정점 그래프 2881520328, p384) [판독].** VS: 월드 위치로 위 UV, **h = 높이 RT(LOD 0).r, 월드 y += h·(+0x400)**, v6.w = −h(반사 뒤집기 M[0x128]·M[0x15c] 는 y 에 곱·더함). FS: n_f = normalize(노멀 RT(+0x540).rgb), **N = normalize(N_면(노멀 맵 적용) + n_f)**, 3면 투영 거칠기 노이즈의 가중치도 n_f², 최종 rgb × fld_sg_alb(**−h**, 0)(Wrap). 메시: 윗면 y 0.196(r < 7.5), 정점 간격 0.127 m(17,233 정점) — 정점 변위로 실제 파인다. 바로 아래 `fld_snow_mt` 지면이 y 0(간격 0.6 m)이라 h < −0.653 이면 그 면이 홈 바닥으로 보인다 [데이터].

**그림자 맵(지면 자기 그림자) [판독 + 추정, 2026-10-06 fluid-depth 담당].** 같은 정적 키의 동적 옵션 `shader_type` 0~3 = p384~p387(`analysis/mat/prog_st/` — `bfsha_dump match` 에 옵션 `shader_type` 을 더한 입력 `st_mats_in.json`, SASS 는 `analysis/mat/sass/…p385~p387`, `sass_dis.PROG` 를 그 폴더로 바꿔 풂). **p385(shader_type 1) = 샘플러 0개, FS 는 상수 1 출력, VS 는 월드 위치(+ 법선·normalDirectionOffsetScale(0), + View+0x1a0·backgraoundMode(0)) → Env+0x538 높이장 LOD 0 → y += h·Env+0x400 → View+0x70 행렬** — 깊이 전용 변형도 p384 와 같은 변위를 한다(`check_hsmg402_fluid.ts` 에뮬 대조 최대 오차 7.1e-7). p386·p387 VS 도 변위. nd 셰이더 폴더에 별도 그림자 아카이브 없음(classic/pbr 의 shadowmap*.bfsha 는 nn::bezel 구 렌더러용) [판독]. 동적 옵션 이름표(main 0x14b7418~, `shader_type` = 0x14b7498)는 GOT 0x15952e8 → 0x710042ef9c(셰이딩 모델별 옵션 색인 초기화)에서만 읽혀 패스별 값은 미판독 → "그림자 = shader_type 1" 은 [추정]. 캐스터: `fld_snow_fluid_mt` cast_shadow 1, `fld_snow_mt` 0 [데이터] — 위를 보는 한 겹 윗면이 그림자를 드리우려면 앞면을 그려야 하므로 그림자 패스 컬링 = 재질 face_cull_type [추정 + 참고 이미지]. 홈 단면 재구현(`web/tools/analysis/hsmg402_fluid_groove_calc.py`): 원본 식 홈/평지 sRGB 비 (0.62, 0.60, 0.75), 자기 그림자 없는 웹 (0.76, 0.82, 0.91) [재구현 계산] — 대비 차이는 거의 전부 이 그림자다(노멀·Sobel·N 합·RT 하한·붓·램프·AO 는 원본과 같음, hsmg402.md 7.5).

---

## 8. texsrt [판독 + 추정]

- 저장: 재질 `texsrtN` = TexSrt(Mode, Scaling X/Y, Rotation, Translation X/Y), fmab 성분 오프셋 0x0 모드, 0x4 sx, 0x8 sy, 0xC r, 0x10 tx, 0x14 ty [데이터].
- `bex::Model::SetMaterialTexSrt @0x7100160fc4` 는 이 6값을 그대로 재질 파라미터에 쓴다. 행렬 변환은 업로드 쪽(nn::g3d)에서 한다 — 함수 위치 [미확정].
- 셰이더(VS): u′ = M[0]·u + M[2]·v + M[4], v′ = M[1]·u + M[3]·v + M[5] [판독].
- 행렬 값 = nn::g3d Maya 식 [추정]:
  - u′ = sx·(c·u + s·v + (−0.5c − 0.5s + 0.5) − tx)
  - v′ = sy·(−s·u + c·v + (0.5s − 0.5c + 0.5) + ty) + 1 − sy
- 검산 [데이터]: 마리오 eye_m texsrt0 = S(0.125, 1) → u′ = 0.125·(u − tx). ftsb 애니 tx = 0, −2, −4, −6 가 눈꺼풀 아틀라스 8칸 중 2칸씩을 고른다(캐릭터 화면에서 확인된 동작). 다른 식(u′ = sx·u + tx)이면 정수 이동이라 칸이 바뀌지 않는다.

---

## 9. mpj(잼버리)와의 차이

| | mpj | mps |
|---|---|---|
| 재질 셰이더 | 공용 `forward_plus.bfsha` 하나, 옵션 `static_opt_*` 약 120 | 공용은 분기 우버셰이더, 실제 변형은 **장면·캐릭터 팩 `.bnbshpk`**. 아카이브가 map/custom/simple/char/plant/fluid/water/fur/dbuffer… 로 갈라짐 |
| 옵션 이름 | `static_opt_base_color_texture`, `static_opt_gi_diffuse_texture` … | `use_normal_map`, `use_lightmap`, `texture_srt_*`, `rim_lighting` …(+ bezel_pbr 의 `basecolor_source*`) |
| 셰이더 슬롯 | `_a0 _n0 _r0 _m0 _e0` + `gi_diffuse_texture2d`·`global_ao_texture2d`·`sg_utility_texture2d*` | `_a0 _n0 _r0 _m0 _e0 _l0`, 디테일 `_r1/_n1·_r3/_n3`, 그래프 입력 `utilitySampler*` |
| UV 선택 | `static_opt_pbr/bake_texture_uv_index` | 옵션이 아니라 **프로그램 코드**(attribAssign + VS) → 판독 표 |
| 라이트맵 | gi_diffuse(lmp/gi) + ao, BC6H | map `_l0`(lmp, BC6H), 그래프는 utilitySampler 로 직접 |
| 셰이더 그래프 | `static_opt_shader_graph` + `fragment_shader_graph_color` 해시, 식 미확인 | `main_fragment/vertex_shader_graph` 해시, **팩의 코드로 판독 가능**(이 문서 7절) |
| 판독 방법 | 렌더 관측(마리오 몸 v′ = 0.5 + 0.5v) | 리플렉션 + Maxwell 디스어셈블(envydis/nvdisasm) |

---

## 10. 웹 규칙 (`view/material.ts`)

`FresLibrary`(material.json + glb 밖 텍스처, `Stage.load` 가 만들고 `setActiveFresLibrary`) → `convert(src, glb 이름)`:

1. `render_color` 0 또는 아카이브 forward_plus_fluid → 숨김(null).
2. 조명 없음(MeshBasicMaterial): forward_plus_simple, `global_lighting` 0, 구름·오로라 그래프. 그 밖은 glb MeshStandardMaterial 복제.
3. `color` = blendColor.rgb(선형), `opacity` = blendColor.a.
4. 슬롯 텍스처(map·normalMap·roughnessMap·metalnessMap·emissiveMap·lightMap)는 복제해 `channel` = 규칙 UV, `matrix` = texsrt 행렬(matrixAutoUpdate 끔). 재질 애니는 `MpsMaterialCtl.setAnim(파라미터, 오프셋, 값)` 이 행렬·색을 고친다(stage.ts `ModelInst.applyMatAnim`).
5. normalScale × bumpScale, `use_roughness_value`/`use_metallic_value` 1 → 맵을 빼고 상수.
6. map `use_emission` → emissiveMap(`_e0`), emissive 1, intensity = emissionScale.
7. map `use_lightmap` → lightMap = `_l0`(HDR), channel 1, intensity = π·lightMapScale·lightmap_color_scale(three 확산 ÷π 상쇄). 절벽 → cliff_lmp(channel 2), π [근사].
8. `directional_light_off` 1 → three `lights_fragment_begin` 의 평행광 블록을 끔.
9. IBL: `lights_fragment_maps` 의 확산 IBL × irradianceColorScale, 반사 IBL × radianceColorScale(장면 큐브는 조명 쪽이 건 것 그대로).
10. `rim_lighting` 1 → outgoingLight += rimLightColor·(평행광 색 ÷ π)·pow(1−N·V, rimPower)·rimlightColorScale. (조명 쪽이 평행광 세기에 π 를 곱해 두어서 ÷π 로 원본 광색을 쓴다.)
11. 눈 그래프 → 평행광 확산 = (램프(N·L)·광색 + 램프(0,0)·π·(1 − 그림자 비율))·알베도/π(`RAMP_DIRECT`, 그림자 비율 = |그림자 곱한 광색| / |광색|), 확산 IBL = irr(N) + 램프(0.6)·irr(카메라 시선)(`IBL_SNOW`, irr 큐브 = 조명 쪽 `mpsSceneEnv` 또는 재질 국소 큐브), 마지막에 outgoingLight × util0(1, 0).
12. 구름 → 7.1 식 그대로. 오로라 → 7.3 식(반사·정점 변위 뺌), 조명값은 `mpsSceneEnv`(irr 큐브·평행광 원본 색·L).
13. 샘플러 래핑: glb 샘플러(원본 fmdb wrapU/V)를 그대로 둔다(고치기 전에는 모두 Repeat 로 덮어써 sky_grad(wrapV Clamp) 윗변 v = −0.206 이 0.794 로 감겨 알파 0.84 의 딱딱한 띠가 됐다 → Clamp 면 0.004) [데이터 + 재구현 계산].
14. `state_type` 1 → alphaTest(punchThroughThresholdColor), 2 → 투명(깊이 쓰기 끔), 3 → 투명 + 더하기. `face_cull_type` 0/1/2 → Front/Back/Double side. `use_fog` → fog.
15. 캐릭터 눈은 character.ts 의 기존 셰이더(눈꺼풀 repeat/offset + 홍채 겹침)를 유지하고 흰자만 utilityColor0 으로 바꿨다(눈꺼풀 맵 복제본은 matrixAutoUpdate 를 다시 켠다).
16. 정점 그래프 2881520328(지면 fld_snow_fluid_mt) + `mpsFluidEnv`(높이·노멀 텍스처가 있을 때) → `MPS_FLUID`: begin_vertex 뒤 월드 y += h·깊이, normal_fragment_maps 뒤 N = normalize(N + 뷰 공간 n_f), 최종 곱 u = −h(7.6). 그림자: 재질 `shadowSide` = 재질 면(앞면), `userData.mpsDepth` = `mpsFluidDepthMaterial()`(MeshDepthMaterial RGBA 패킹 + 같은 FLUID_VERTEX) → stage.ts 가 그 메시 `customDepthMaterial` 로 건다(three 기본은 FrontSide 재질의 그림자를 뒷면으로 그려 한 겹 지면이 그림자를 못 드리운다). 높이장·붓은 게임 쪽 `games/hsmg402/view/fluid.ts`(SnowFluid)가 굴린다 — 유체 붓 재질(forward_plus_fluid)은 장면에서 숨기고 그 메시를 별도 붓 장면에서 원본 식으로 그린다.

원본 텍스처에 틴트·외곽선을 더하지 않는다. 지면 최종 곱(fld_sg_alb)과 blendColor 는 원본 셰이더가 하는 곱이다.

### 10.1 옮기지 않은 것 [근사]
디테일 맵, 클리어코트, 층 텍스처(`use_layer_tex`), 구름 그림자(env 에서 꺼짐), 라이트 그리드, 국소 반사 IBL(눈덩이 snowball_rad → 장면 rad PMREM 으로 대신, 확산 snowball_irr 는 씀), 시차 보정 큐브, 라이트맵 알파(IBL 가림), 물(ocean flowmap·반사), 유체 노멀 3면 투영 가중치, 지면 거칠기 노이즈, 눈 림의 rimlightShadow 항(눈덩이 0.15), 오로라 반사 항·정점 변위(noise_alb), 오로라 노멀의 스키닝, 절벽 gi·ao 섞기, 캐릭터 피부·옷 산란(cvt·LUT·3D), 요시·캐서린 등 눈 그래프 차이. 일반 재질의 확산 IBL 은 irr 큐브 대신 rad PMREM.

---

## 11. 검증 (실제로 돌린 것)

| 무엇 | 결과 |
|---|---|
| `web/tools/analysis/bfsha_dump match` | 재질 77개 모두 프로그램을 찾음(오류 0), VS/FS 코드 72 프로그램 저장 |
| envydis 디스어셈블 | 72 프로그램 × VS/FS. 알 수 없는 명령은 무대 ≤ 2줄·캐릭터 ≤ 11줄/파일(전부 `mufu` 한 변형 — 노멀 z = sqrt 자리) |
| UBO·샘플러 바인딩 규칙 | sky(Material 위치 9 → c12, 샘플러 위치 0 → 핸들 0x8), tree(위치 2/5/7 → 0xc/0x12/0x16) 에서 확인 후 전 프로그램에 적용, 이름이 의미와 맞음 |
| `web/tools/check_hsmg402_material.ts` | 77 재질 변환, 셰이더 치환 실패 0, material.json 텍스처 파일 누락 0 |
| `web/tools/check_hsmg402_fluid.ts` (7.6) | 원본 기계어 에뮬 vs 웹 식 최대 오차: 눈덩이 붓 1.0e-7(2000), 캐릭터 붓 p0·p6·p12 ≤ 7.3e-8(각 3000), 지면 VS 변위·UV 3.2e-7(500), fluid_normal 5.6e-16(300), 깊이 전용 VS p385 변위 7.1e-7(500), 지면 그림자 깊이 재질(선언·변위 위치·shadowSide·uniform 공유). Env 칸·블렌드 표(Add/Min/Max)·붓 블렌드 바이트·fmdb 파라미터·붓 텍스처 부호·지면 훅 선언 — 오류 0 |
| `npx tsc --noEmit`, `test_hsmg402.ts`(290/290), `check_hsmg402_assets.ts`(오류 0) | 통과 |
| 화면 | 하지 않음(메인이 마지막 1회) |

## 12. 미확정 사항과 필요한 근거

| 항목 | 필요한 근거 |
|---|---|
| state_type·face_cull_type 값의 뜻 | main 에서 renderInfo 해시 전역(0x14b37c0 …)을 읽는 렌더 상태 설정 코드(Ghidra 참조 검색) |
| texsrt 행렬 식(v 부호·회전 부호, 3dsMax/Softimage 모드) | main 의 nn::g3d TexSrt 변환 함수 |
| 정점색 미바인드 시 읽는 값(눈 그래프 최종 곱 — fld_sg_alb 가 거의 한 색이라 화면 결과에는 영향 없음) | NVN 기본 속성 값 문서 또는 실행 화면 |
| 절벽·캐릭터 몸 그래프 나머지 식(오로라는 7.3 으로 닫힘), 눈 림 rimlightShadow 의 sat() 안 값 | 해당 FS 전체 판독(`analysis/mat/sass/`) |
| 디테일 맵 섞기 모드(use_detail_* 0~3) | map p0/p192 FS 판독 |
| bezel_pbr `basecolor_source` 0~3 뜻 | bezel_pbr.bfsha 프로그램 코드(쓰는 재질 20개) |
| Env+0x264 = lightmap_color_scale | EnvironmentParamBuffer 를 채우는 main 코드 |
| 유체: 높이 RT 형식(설정표 인덱스 0x15 — SNORM/float, 값 범위; 화면 영향 작음), M[0x160] 기본값(1 추정), TLD4 성분 순서, fld_clear 행 0 = z −9.5 여부, 그림자 패스의 shader_type 값·래스터(컬링) 상태 | NdRender+0x50 RT 설정표를 채우는 코드, 모델 렌더 자료 생성자, 원본 실행 화면(홈 깊이·방향) |
| Pillow BC4S 디코드 오류 — `graphics_bntx.py` 의 BC4/BC5 SNORM png(예 pcNN_foot_hgt)는 부호 끝점 보간이 틀린 raw 비트다. 유체 붓은 `hsmg402_fluid_assets.py` 가 직접 디코드 | graphics_bntx.py 를 직접 디코드로 바꾸기(다른 담당) |
