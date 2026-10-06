# 07. 카메라 aspect·조명·환경·후처리 — 평행광 규약, 그림자, IBL, 안개, 톤맵, LUT, 블룸, 비네트, FXAA (mps 판)

2026-10-05. 담당: light. 2026-10-06 color 담당 12절 추가(화면 색 대조). 상태: **판독 완료(hsmg402 값 기준) / 웹 반영 완료 / 화면 대조 없음**(헤드리스 확인은 메인이 마지막에 1회).
문서 형식은 [../분석.txt](../분석.txt). 확정 수준: **[실행]** 원본 실행(이 문서엔 없음), **[판독]** main 명령·디컴파일 또는 셰이더 SASS 판독, **[데이터]** 파일 값, **[재구현 계산]** 판독 식을 다시 계산, **[추정]**, **[미확정]**.

주소는 main NSO, 베이스 0x7100000000. 셰이더 근거는 `system_boot_bnsh.nx.bea/…/ndrender/*.bnsh`·`system_boot.nx.bea/…/ndrender/*.bfsha` 의 Maxwell(SM53) 코드를 nvdisasm 으로 디스어셈블한 것이다(`web/tools/analysis/bnsh_sass.py`, 결과 `analysis/decomp/light/sass_*.txt`).

> **mpj 와의 관계.** mpj([C:/dev/mpj/web/docs/engine/07_camera_lighting.md](C:/dev/mpj/web/docs/engine/07_camera_lighting.md))는 `directional_light_*`·`posteffect_*` 접두 이름 체계(bex::gfx)라 mps 의 `light_model/directional`·`container/environment`·`container/posteffect`(nd 렌더러, 이름 접두 없음)와 다르다. mpj 결론(빛 −Z 진행 추정, 톤맵 종류 1 미확정 등)은 여기서 쓰지 않는다. 카메라 애니 행렬·fovy 는 mps 도 같은 규약이다(hsmg402.md 7.4).

---

## 1. 결론 요약

| 항목 | 결론 | 수준 |
|---|---|---|
| lightRotation → 방향 | (x°, y°) 를 rad 로, 행 R = [(cy, 0, −sy), (sx·sy, cx, sx·cy), (cx·sy, −sx, cx·cy)]. 빛 객체 Z 축 = **−(R 행 2)** = L(면→광원) = **(−cx·sy, sx, −cx·cy)**. (30, −25) → **(0.3660, 0.5, −0.7849)**, 빛 진행 = −L | 판독 |
| 방향 검산 | lightPosition 방향 (0.311, 0.379, −0.872) 과 9.1°, IBL rad 큐브 가장 밝은 점(해)과 **7.9°**(z 반전 규약을 적용했을 때. 안 하면 111°) | 재구현 계산 + 데이터 |
| lightRotation 적용 조건 | 재질 `lightPositionEnable` ≠ 0 이고 SystemRender 플래그(위치 기본 1, 방향 기본 1)가 켜져 있을 때. 위치 = lightPosition | 판독 |
| 평행광 색 | `color`(0.570, 1.220, 1.5) 그대로 `NdLightObject::GetColor` → Env UBO +0x10 (세기 곱 없음, `0x710041f1ec`). 셰이더 확산 = albedo·color·N·L, **1/π 없음**(오로라 p128·눈 p384 FS 에서 확인. 눈 그래프는 N·L 대신 램프) | 판독 |
| 그림자 | 고정 정사영 l −17 r 15 t 12 b −8 n 1 f 30(`shadowAutoCameraEnable` 0, `shadowParamEnable` 1), 빛 행렬 기준(위치 lightPosition, Z = L, X = 세계 X 를 L 에 수직으로, Y = L×X). 캐스케이드 1. bias 0.5 / normalBias 1 의 단위·필터 [미확정] | 판독(축) + 데이터(값) |
| IBL | env_mt 샘플러: common_radiance=rad, common_irradiance=irr, char_radiance=chara_rad, char_irradiance=chara_irr, fog_cubemap=irr. 배율 4개 1, ibl_rotate_y 0. **큐브 조회 방향 = (x, y, −z)**(Y 축 회전 뒤). 반사 LOD = 거칠기계수 × 6.5 | 판독(셰이더) + 데이터 |
| 안개 (60, 1000, 0.95) | 시작·끝·**배율**. d = \|월드 − 카메라\|, T = sat( sat((끝 − d)/(끝 − 시작)·배율) + (1 − fog_color.a) ). 색 = mix(안개색, 표면, T). fog_cubemap 1 → 안개색 = irr 큐브(방향 (x,y,−z), LOD 7 − 7T), 아니면 fog_color.rgb. 안개 양 1−T: d = 10.53 에서 0, 29.9(무대) 0.020, 60 에서 0.05, 1000 에서 1 | 판독 + 재구현 계산 |
| 톤맵 타입 5 | 유리식 f(x) = x·(x·(x·(3.835061x − 0.7351529) + 0.1352372) + 0.03166371) / (x·(x·(x·(3.921293x − 1.517684) + 1.862026) − 0.395519) + 0.07032027), sat 후 × tonemap_output_scale. f(0.18)=0.179, f(1)=0.829, f(2)=0.978 | 판독(SASS 상수 풀) |
| 노출 | x = c·exposure + exposure_offset (**offset 은 더하기**). 값 1, 0 → x = c | 판독(UBO) |
| LUT | g = t^(1/2.2)(LG2·EX2) 로 16³ LUT(R8G8B8A8_SRGB)를 **그대로** 조회(반 텍셀 보정 없음), `lut_blend` = 둘째 LUT(color_lut1) 섞는 비율 → **0 = 첫 LUT(hsmg402_lut) 100%**. LUT 는 축마다 같은 S 곡선(0,12,24,…,241,255) | 판독 + 데이터 |
| 블룸 0.7 / 1 | bloom_filter_type 2 = v4(first → down_1..4 → up_3..0). first: L=(0.2125,0.7154,0.0721)·c, b = max(0, c·(L·scale·exposure − scale·threshold)) → **0.7 = 휘도 문턱, scale = 세기**. down 13탭, up_3·up_2 4탭 평균을 2/3, up_1 한 탭 2/3, up_0 한 탭 7/9 로 섞고 합성 때 장면에 그대로 더함 | 판독 |
| 비네트 0.2 | out·(1 − 0.2·\|(ndc.x·vignette_aspect, ndc.y)\|), 선형 값에, 자르지 않음. 모서리 0.717, 가장자리 중앙 0.8 | 판독 |
| FXAA | fxaa_filter_type 1: 상대 문턱 = 0.125·0.7152, 절대 문턱 0.0833, 녹색 채널을 x/(x+0.155)·1.019 로 눌러 대비 판정, 탐색 1.5·3·12 텍셀 | 판독 |
| 처리 순서 | posteffect_filter_order 1 + 블룸 켬: 블룸 → **합성 패스(장면+블룸 → 노출 → 톤맵 → LUT → 비네트)** → 마지막 패스 FXAA | 판독 |
| View UBO +0x1a0/+0x1b0/+0x1c0 | 카메라 위치 / `Camera::GetViewVector`(= −카메라 행렬 +0xc0 = 눈→주시점) / 위쪽 — `0x7100432d9c~0x7100432f9c`. 눈 그래프 IBL 이 +0x1b0 방향으로 irr 를 한 번 더 읽는다(12절) | 판독 |
| 화면 색 대조 | 무대 눈 한 점을 원본 식으로 계산하면 sRGB (144, 219, 242) — 공식 스크린샷 무대 중앙 (144, 220, 242). 원본 무대는 **수치로도 하늘색(R 이 낮다)** 이고 "흰색"이 아니다. 웹이 어두웠던 원인은 눈 그래프 식 차이(12절) | 재구현 계산 + 참고 이미지 |
| 카메라 aspect | 애니 user data `bezel_apply_aspect` = 1 일 때만 파일 aspect 사용. hsmg402(전체 fsnb 451개 모두) 키 없음 → **화면 비(16:9)** | 판독 + 데이터 |

## 2. 자료

| 자료 | 위치 |
|---|---|
| 조명 모델 | `extracted/bea/hsmg402.nx.bea/mg/hsmg402/env/hsmg402_dir_light00.fmdb`(`light_model/directional`, 재질 `light_mt`), 덤프 `extracted/converted/hsmg402/graphics/meta/hsmg402_dir_light00.dump.json` |
| 환경·포스트 | `…/env/hsmg402_env.fmdb` 재질 `env_mt`(`container/environment`), `post_mt`(`container/posteffect`), 덤프 `…/meta/hsmg402_env.dump.json` |
| 텍스처 | `…/env/textures/hsmg402_{rad,irr,chara_rad,chara_irr,lut,fld_clear}.ftxb` → `extracted/converted/hsmg402/graphics/tex/*.{png,hdr,json}` (rad 128² 밉 8, irr 32², BC6H_UFLOAT, lut 16³ R8G8B8A8_SRGB) |
| 후처리 셰이더 | `system_boot_bnsh.nx.bea/system_boot/kernel/shader/ndrender/posteffect_amalgam0.bnsh`(변형 1134), `posteffect_bloom_v4_*.bnsh` |
| 모델 셰이더 | `system_boot.nx.bea/system_boot/kernel/shader/ndrender/forward_plus*.bfsha`(BFSHA 안 BNSH 4개씩) |
| Ghidra | `ghidra_work/light/`(ghidra_proj/mps_main 복사), 실행기 `ghidra_work/light/core.sh`, 출력 `analysis/decomp/light/*.c` |
| 도구 | `web/tools/analysis/bnsh_sass.py`(+ `tools/nvdisasm_12.4/nvdisasm.exe`, CUDA 12.4 redist, SM53), `web/tools/analysis/light_calc.py` → `analysis/light_calc.json`, `web/tools/analysis/hsmg402_web_assets.py --only-env` |

## 3. 진입점과 호출 흐름

### 3.1 재질 이름 → 값 [판독]

- 이름 표: `0x71014b37b8` 부터 char* 배열(재배치 RELATIVE). 0x00~0x21 = renderInfo 이름(state_type … tonemap_type 0x13, bloom_filter_type 0x14, fxaa_filter_type 0x15, dof_filter_type, dof_buffer_type, posteffect_filter_timing 0x18, posteffect_filter_order 0x19 …), 0x22~0xC6 = 파라미터 이름, 0xC7~ = 셰이더 아카이브·샘플러 이름. GOT `0x7101594dc8` → 표 시작.
- `FUN_71003b7e04`: 컨테이너 종류(obj+0xF8, 0~9)별 renderInfo 범위를 찾아 obj+0x100+i·8 에 포인터 저장. posteffect = i 0x13~0x19 → obj+0x198 tonemap_type … obj+0x1C8 filter_order.
- `FUN_71003b8004`: 파라미터 색인 → obj+0x210+(i−0x22)·4, 샘플러 → obj+0x4A4~(environment: common_radiance_ibl … fog_cubemap 0x4B8, posteffect: color_lut 0x4E4, color_lut1 0x4E8). 종류 2 = environment(파라미터 0x28~0x58), 3 = posteffect(0x5C~0x91), 4 = skybox.

### 3.2 평행광 [판독]

1. NRO → `bex::SystemRender::SetGlobalDirectionalLightHook(entity, "dir_light", "light_mt") @0x7100343ccc`. 재질에 `lightPositionEnable` 이 있으면(`FUN_710032d588`) 엔티티 자체를, 아니면 뼈에 묶는다(`FUN_710032cf64`).
2. 매 갱신 `0x710032df90~0x710032ee30`(Ghidra 함수 미정의, capstone 판독): 빛 종류(`FUN_71003aaaf0`) 0 = 평행광 가지 `0x710032e57c`:
   - `lightPositionEnable`(int) ≠ 0 이면
   - 블록+0x36d(위치 허용, 기본 1 `@0x71003278a4`) → `lightPosition` → `FUN_710032b94c`(위치)
   - 블록+0x36e(방향 허용, 기본 1 `@0x71003278e4`) → `lightRotation`(Float2) → 아래 6.1 행렬 → `0x7100331464`
   - 허용 플래그 설정자: `SetGlobalDirectionalLightMaterialLightPositionEnable @0x7100343e18`(+0x3a5 = 블록+0x36d), `…DirectionEnable @0x7100343e50`(+0x3a6). hsmg402 는 부르지 않는다(NRO import 없음) [데이터].
3. `0x7100331464`: NdLightObject vt+0x40(행렬 R) → `FUN_71003ab008` = vt+0x48 행렬의 행 2 → 부호 반전 → `FUN_71003aab24`(방향 설정: 정규화, 기준축으로 직교 기저, 행 2 = 방향, vt+0x40 저장, +0x464 에 오일러) → `bex::ut::QuaternionFromMatrix` 로 ComTransform 회전.
4. 색은 `color`(Float4) 를 `FUN_71003aaaf8` 로 그대로(세기 곱 없음).

### 3.3 환경(env_mt) [판독]

- 설정 `FUN_71003b973c`: env 구조체 +0x00 fog_enable(u8), +0x01 fog_cubemap_enable, +0x04/+0x08 common rad/irr 배율, +0x0C/+0x10 char rad/irr, +0x14 ibl_rotate_y, +0x3C fog_color(4), +0x4C fog_param(3).
- 유니폼 `0x710041fbd0~0x710041fd4c`(View/Env 버퍼, 셰이더 c[0x8]): +0x1E0~0x1EC 배율 4개, +0x200/+0x204 = sin/cos((ibl_rotate_y + fmod(전역각, 360))·π/180), +0x210~0x218 fog_color.rgb, **+0x21C = max(1 − fog_color.a, 0)**, **+0x220 = 1/(끝 − 시작)**, **+0x224 = 끝**, **+0x228 = 배율(0.95)**, +0x22C = fog_enable ? (fog_cubemap_enable ? 2 : 1) : 0, +0x4C8 = 안개 큐브 텍스처 슬롯.

### 3.4 후처리 [판독]

- 설정 `FUN_71003ba5a4`: post 구조체(3.4 표) ← 재질값.
- 유니폼 `0x7100403f18~0x7100404264`(PostEffect 버퍼, 셰이더 c[0xb] 또는 c[0x3]): +0xD0 exposure, +0xD4 exposure_offset, +0xD8 tonemap_output_scale, +0xDC lut_blend, +0xE0 bloom_threshold, +0xE4 bloom_scale(**filter_order 1 이면 × exposure**), +0xE8 bloom_scale·bloom_threshold, +0xEC vignette_aspect, +0x108/+0x10C 1/해상도, +0x110~ 가우스 가중치, +0x150 luminance_color, +0x15C luminance_blend, +0x160 blend_color, +0x16C vignette, +0x170 add_color, +0x17C fxaa_threshold(fxaa_filter_type 1 이면 × 0.7152).
- 패스 분기 `0x7100404a00~0x7100404bc0`: filter_order 0 → 최종 패스가 모두 함. 1 → DOF/블룸이 있으면 그 합성 패스가 톤맵·LUT·비네트를, 최종 패스(`FUN_7100404da4`)는 FXAA 만. 블룸 종류: 3 → v3(`FUN_7100406778`), 2 → **v4(`FUN_710040657c`)**, 1 → 가우스(`FUN_7100405fa0`)+합성 20, 그 밖 → mgf(`FUN_7100406ab4`)+합성 20. 그다음 `FUN_7100406d1c`(블룸 합성 amalgam).
- 셰이더 표 `0x71014b67a8`(GOT `0x7101595208`): amalgam = 0xBD(189), bloom_v4_first 0x1F … up_3 0x27.

## 4. 구조체·상수

### 4.1 post 구조체(`FUN_71003ba5a4` 의 지역 객체 → 렌더러 사본) [판독]

| 오프셋 | 값 | 출처 | hsmg402 |
|---|---|---|---|
| +0x00 | enable | 파라미터 | 1 |
| +0x04 | posteffect_filter_timing | renderInfo | 0 |
| +0x08 | posteffect_filter_order | renderInfo | **1** |
| +0x0C | tonemap_type | renderInfo | **5** |
| +0x10/+0x14/+0x18/+0x1C | exposure / exposure_offset / tonemap_output_scale / effect_color_scale | 파라미터 | 1 / 0 / 1 / 1 |
| +0x20/+0x24/+0x28 | fxaa_enable / fxaa_filter_type / fxaa_threshold | 파라미터·renderInfo | 1 / 1 / 0.125 |
| +0x2C/+0x30/+0x34/+0x38 | bloom_enable / threshold / scale / bloom_filter_type | | 1 / 0.7 / 1 / 2 |
| +0x3C/+0x40 | lut_filter_enable / lut_blend | | 1 / 0 |
| +0x44/+0x50/+0x54 | luminance_color / luminance_blend / blend_color | | (1,1,1) / 0 / (1,1,1) |
| +0x60/+0x64/+0x68 | vignette / vignette_aspect / add_color | | 0.2 / 1 / (0,0,0) |
| +0x74/+0x78/+0x7C | dof_enable / dof_filter_type / dof_buffer_type | | 0 / 0 / 0 |
| +0x98/+0x99 | dof_debug / silhouette_enable | | 0 / 0 |

### 4.2 amalgam 변형 번호 [판독 + 데이터]

변형 k = 189·U + 27·T + 9·B(+3·D) + F, 1134 = 6·7·27.
- U(색 마무리): 그 패스가 마무리 담당이면 1 + lut_filter_enable + 3·silhouette_enable, 아니면 0.
- T(톤맵): tonemap_type + 1, 단 최종 패스에서 filter_order 1 이고 (dof 또는 bloom)이면 0.
- F(FXAA): fxaa 켬이면 1 + (fxaa_filter_type == 1), 아니면 0. B: 블룸 합성 9(종류 0·1) / 18(종류 2·3). D: DOF 합성 3/6.
- hsmg402: 블룸 합성 = 189·2 + 27·6 + 18 = **558**, 최종 = 0 + 0 + 2 = **2**.

### 4.3 톤맵 종류(T = 종류 + 1 블록의 코드·상수 풀) [판독 / 데이터]

| tonemap_type | 식 | 수준 |
|---|---|---|
| 0 | max(x, 0)·scale | 판독(SASS) |
| 1 | 상수 2.51·0.03·2.43·0.59·0.14(+ −0.004) → Narkowicz ACES 근사로 보임 | 데이터(상수) |
| 2 | 상수 0.22·0.30·0.03·0.002·0.06·1/30·1.153002 → Hable(A .22 B .3 C .1 D .2 E .01 F .3, W 11.2 → 1/f(W)=1.153) | 데이터(상수) + 재구현 계산 |
| 3 | x/(x+1)·scale | 판독(SASS) |
| 4 | 상수 0.22·0.532·0.468·1·1.33·3·−2 → Uchimura GT(m .22, l .4, c 1.33, P 1) | 데이터(상수) |
| **5** | 1절 유리식 f, sat | **판독(SASS)** |

## 5. 상태와 수명

- 조명·환경·포스트 값은 모델 재질에서 읽어 매 프레임 유니폼으로 올린다. hsmg402 NRO 는 값을 바꾸는 setter 를 부르지 않는다(SetGlobalDirectionalLightHook 하나) → 장면 내내 상수 [데이터: NRO import].
- 카메라 aspect 는 애니를 적용할 때마다 6.6 규칙으로 다시 정한다.

## 6. 계산식·의사코드

### 6.1 평행광 [판독 `0x710032e690~0x710032e898`, sin/cos = nn::util SinCoefficients/CosCoefficients 근사]

```ts
ax = rx·π/180; ay = ry·π/180               // FloatPi / FloatDegree180
R = [[cy, 0, −sy, 0], [sx·sy, cx, sx·cy, 0], [cx·sy, −sx, cx·cy, 0]]
lightSetMatrix(R); d = −R[2]                 // 0x7100331464
// SetDirection(d) @0x71003aab24
d = normalize(d)
if (|d.y| < 0.01) { 기준축 (0,1,0) 가지(이 판 미사용) }
else { Y = cross(d, (1,0,0)) = (0, d.z, −d.y); X = cross(Y, d) }   // 정규화 없이 저장된다
matrix rows = [X, Y, d, pos]
// three: light.position = lightPosition, target = lightPosition − d, shadow.camera.up = normalize(Y)
```

### 6.2 안개 [판독 forward_plus_simple bnsh#1 변형 40 정점·픽셀]

```glsl
// 정점
vec3 v = worldPos − cameraPos;  float d = length(v);
float T = sat(sat((fogEnd − d) * invRange * scale) + oneMinusAlpha);
dirOut = vec3(v.x, v.y, −v.z); TOut = T;     // 모드 0 이면 0
// 픽셀
if (mode >= 2) fogCol = textureLod(fogCube /*irr*/, dir/max|dir|, 7.0 − 7.0*T);
else if (mode >= 1) fogCol = fogColor.rgb;
color = fogCol + T * (color − fogCol);
```
three 직선 안개로는 near = 끝 − (끝 − 시작)/배율 = 10.526, far = 1000(반지름 거리, a = 1 일 때 같은 식).

### 6.3 IBL 조회 [판독 forward_plus_char bnsh#0 변형 0, `0x9498~0x97f0`]

방향을 env +0x200/+0x204(sin, cos) 로 Y 축 회전한 뒤 **z 부호를 뒤집어** 큐브를 조회(확산 LOD 0, 반사 LOD = 계수·6.5). 배율 c[0x8][0x1E0..0x1EC] 를 캐릭터/공용으로 골라 곱한다. three CubeTexture 조회는 (−x, y, z) 라 Y 180° 차이 → 웹은 면을 [−X, +X, 180°(+Y), 180°(−Y), −Z, +Z] 로 바꿔 굽는다.

### 6.4 블룸 v4 [판독 `posteffect_bloom_v4_*.bnsh`]

```glsl
// first (c[0x3][0xE4] = scale·exposure, [0xE8] = scale·threshold)
l = dot(c, vec3(0.2125, 0.7154, 0.0721)); k = l*E4 − E8;
b0 = max(0, min(c*k, tex2 + 0.5))            // tex2 = c[0x3][0x78] 텍스처(정체 미확정)
// down_i: 13탭 (0,±2)(±2,0)×0.0625, (±2,±2)×0.03125, (±1,±1)×0.125, (0,0)×0.125, 간격 = a[0x88..0x8c]
// up_3, up_2: low = 4탭(±1,±1) 평균, out = cur + (low − cur)·(2/3)
// up_1: low = 한 탭(LL), ·(2/3);  up_0: 한 탭, ·(7/9)   (cur = 같은 밉 체인의 지금 단 TLD)
// 합성: c = scene + bloom
```

### 6.5 합성 패스(변형 558)·마지막 패스(변형 2) [판독]

```glsl
c = scene + bloom
x = c * exposure + exposureOffset
t = sat(f5(x)) * outputScale
g = exp2(log2(|t|) * 0.45454544)               // 1/2.2
lut = lutBlend<1 ? (1−lutBlend)·tex3D(lut0, g) : 0  +  lutBlend>0 ? lutBlend·tex3D(lut1, g) : 0
ndc = 정점 위치 xy(−1..1); r = sqrt((ndc.x·vignetteAspect)² + ndc.y²)
out = lut − lut·(r·vignette)
// 변형 2: FXAA(녹색 대비 x/(x+0.155)·1.019·scale, 문턱 max(lumaMax·thr·0.7152, 0.0833), 탐색 1.5/3/12)
```
LUT 텍스처가 sRGB 형식이라 표본은 하드웨어가 선형으로 푼다. 마지막 렌더 타깃이 sRGB 라고 보면 화면 값 = LUT 바이트 [추정].

### 6.6 카메라 aspect [판독 `FUN_71006522ec`]

```ts
ud = anim.userData["bezel_apply_aspect"]
aspect = (ud && ud.int == 1) ? anim.aspect : camera.GetAspectRatio()
persp ? SetProjectionPerspectiveFovy(fovy, aspect, near, far) : 정사영(fovy·0.5 ...)
```

## 7. 에셋 연결

| 원본 | 웹(`web/assets/hsmg402/`) |
|---|---|
| dir_light00 `light_mt` 값 | `manifest.json` env.light(color, lightRotation, lightPosition, lightPositionEnable, shadow*) |
| env_mt 값 | env.fog(fog_enable, fog_cubemap_enable, fog_param, fog_color), env.ibl(배율 4, ibl_rotate_y) |
| post_mt 값 + renderInfo | env.post(… tonemap_type, bloom_filter_type, fxaa_filter_type, posteffect_filter_order/timing) |
| rad/irr/chara_rad/chara_irr | `tex/<이름>_0N.hdr`(env.cubesHdr, RGBE, BC6H 디코드) + png(env.cubes) |
| hsmg402_lut | `tex/hsmg402_lut.png`(256×16, x = z·16 + r, y = g) — env.lut |

재생성: `F:/dev/mps/.venv/Scripts/python web/tools/analysis/hsmg402_web_assets.py --only-env`(manifest 의 env 와 큐브·LUT 만).

## 8. 다른 기능과의 상호작용

- 재질(view/material.ts, 다른 담당)이 확산을 three 표준 BRDF 로 그리면 평행광 세기 π 보정(9.2)이 그대로 맞는다. 재질이 원본식(albedo·color·N·L)을 직접 짜면 `StageLighting.light.intensity / π` 를 써야 한다.
- 캐릭터 IBL 은 `Stage.charaEnv`(chara_rad PMREM, 면 회전 굽힘 포함)를 재질 쪽이 envMap 으로 건다. 눈덩이 자체 큐브(snowball_rad/irr)는 재질 담당.
- 안개 청크 교체는 three 전역(ShaderChunk)이라 무대가 살아 있는 동안 다른 게임 재질에도 걸린다(dispose 때 되돌림).

## 9. 웹 구현(반영됨)

### 9.1 파일

| 파일 | 책임 |
|---|---|
| `web/script/games/hsmg402/view/lighting.ts`(신규) | `StageLighting`: 평행광 방향·그림자 축, HDR 큐브 로드·면 회전·PMREM(scene.environment, charaEnv), 안개 청크·Fog. `lightToward`, `lightUp`, `fogRange` |
| `view/stage.ts`(조명 부분만) | `Stage.lighting` 생성·load·dispose, `EnvInfo extends LightingEnv` |
| `view/post.ts`(재작성) | `PostChain`: HDR → 블룸 v4 → 합성(노출·톤맵 5·LUT·비네트, sRGB 부호화) → FXAA → 화면. `loadLut3D`(png → Data3DTexture sRGB) |
| `view/index.ts` | PostChain 생성 뒤 `setLut(await loadLut3D(...))` |
| `view/camera.ts` | aspect 주석만(코드는 이미 16:9) |
| `web/tools/analysis/hsmg402_web_assets.py` | `build_env()`·`--only-env`, 큐브 4개 png+hdr, LUT, 값 확장 |

### 9.2 원본과 다르게 둔 것(동등성 메모)

| 항목 | 원본 | 웹 | 이유 |
|---|---|---|---|
| 직접광 세기 | color 그대로, 확산에 1/π 없음 [판독] | intensity = π·max(color) | three Lambert 의 1/π 상쇄 |
| IBL 확산 | irr 큐브 | 눈·오로라 그래프는 irr 큐브를 직접(`mpsSceneEnv`), 나머지 재질은 rad PMREM 의 거친 단 | 일반 재질은 three 표준 경로 [근사] |
| 안개 색 | irr 큐브 방향별(LOD 7−7T) | irr 전체 평균 한 색 | 재질마다 큐브 유니폼을 넣지 않으려고 |
| 그림자 | 고정 정사영 1장, bias 단위 미상 | three PCFSoft 2048², bias −0.0005, normalBias 0.02 | 단위 미판독 |
| 블룸 | 밉 체인, first 해상도·up 간격 미판독, first 상한 tex2+0.5 | 절반 해상도부터 5단, 간격 = 아랫단 1텍셀, 상한 없음 | 미판독 |
| FXAA | FXAA 3.11 계열(1.5/3/12) | three FXAAShader + 원본 문턱 | 근사 |
| 출력 | sRGB 타깃 [추정 + 참고 이미지 정합: 12절 계산이 공식 스크린샷과 ±1] | 합성 패스가 sRGB 로 부호화해 LDR 에 씀 | |

## 10. 검증

| 검증 | 종류 | 결과 |
|---|---|---|
| `web/tools/analysis/light_calc.py` → `analysis/light_calc.json` | 재구현 계산 + 데이터 | L = (0.366, 0.5, −0.785), lightPosition 방향과 9.11°, rad 큐브 해(면 4 화소 (87,34)) z 반전 방향 (0.316, 0.397, −0.862) 과 **7.89°**(반전 없으면 111.2°). 안개 양 d 29.9 → 0.0196, 60 → 0.05, 200 → 0.191. f5(0.18)=0.179, f5(1)=0.829. 합성 변형 번호 558 의 상수 풀 = 타입 5 상수(참). forward_plus 4개 1/π 정렬·32비트·20비트 즉치 0건 |
| SASS 판독본 | 판독 | `analysis/decomp/light/sass_amalgam_{558,002,T1..T6}.txt`, `sass_bloom_v4_*.txt`, `sass_fp_simple_40_fog_{fs,vs}.txt`, `sass_fp_char_0_uber.txt` |
| `npx tsc --noEmit` | 정적 | 통과 |
| `npx tsx tools/test_hsmg402.ts` | 로직 회귀 | 290/290 |
| 화면 | — | **하지 않음**(메인이 마지막에 헤드리스 1회) |

## 11. 미확정

| 항목 | 영향 | 필요한 근거 |
|---|---|---|
| 그림자 bias 0.5 / normalBias 1 의 단위, 필터(PCF·EVSM) | 그림자 경계 | shadowmap 셰이더·ShadowmapParamBuffer 판독 |
| 블룸 first 출력 해상도, down/up 텍셀 간격 a[0x88..0x8c], first 의 둘째 텍스처(c[0x3][0x78]) | 블룸 퍼짐·상한 | `FUN_710040657c` 렌더 타깃·정점 셰이더 판독 |
| 마지막 렌더 타깃 sRGB 여부 | 전체 감마(참고 이미지와는 sRGB 가정이 맞는다, 12절) | NdRender 프레임버퍼 형식 판독 |
| 기준축 (0,1,0) 가지(\|L.y\| < 0.01) 기저 | 다른 미니게임 그림자 방향 | `FUN_71003aab24` 앞 가지 정리 |
| ibl_rotate_y 회전 부호, 전역각 `FUN_71003c9fc0` | 다른 판 | 해당 함수 판독 |
| 톤맵 1·2·4 의 정확한 식 | 다른 판 | 각 블록 SASS 정리(상수만 확인) |
| LUT 샘플러 래핑(재질은 Wrap, 엔진 덮어쓰기 여부) | g≈1 근처 색 | RenderSampler 설정 판독 |

## 12. 화면 색 대조 — 무대가 "청록"으로 보이던 원인 (2026-10-06, 담당 color)

### 12.1 결론

- 원본 무대 눈은 **수치로도 하늘색**이다. 공식 스크린샷(아래 출처) 무대 영역 중앙값 sRGB (138, 211, 234), 중앙 한 점 (144, 220, 242) [참고 이미지]. 평행광 색 (0.57, 1.22, 1.5)·irr 큐브·fld_sg_alb 가 모두 파랑 쪽이라 원본 식 자체가 R 을 낮게 만든다 [판독 + 데이터]. 사람 눈에 "흰 눈"으로 보이는 것은 어두운 남색 배경과의 대비다.
- 고치기 전 웹이 어둡고 진했던 원인은 **눈 그래프 식 두 곳**과 IBL 원천이다(값은 `analysis/hsmg402_color_calc.json`, 도구 `web/tools/analysis/hsmg402_color_calc.py`):
  1. 그늘: 원본 직접광 = mix(알베도·램프(0,0), 알베도·램프(N·L·0.5+0.5)·광색, 그림자) — 그늘에도 알베도 × 0.171(램프 sRGB 115) 이 남는다. 웹(three)은 그림자에서 직접광이 0 [판독 p384 FS `0x1318~` 끝부분].
  2. 확산 IBL: 원본 = 알베도·(1−F)·(irr(N) + 램프(0.6, 0)·irr(View+0x1b0 = 카메라 시선)). 시선 방향(앞·아래)의 irr 는 (0.24, 0.52, 1.03) 으로 밝아서 확산 IBL 이 두 배 넘게 된다. 웹은 irr(N) 하나, 그것도 rad PMREM 으로 근사 [판독 p384 FS `0xcd0~0xec0`, View +0x1b0 = `Camera::GetViewVector` `0x7100432dc4`].
- 후처리(톤맵 5·LUT·sRGB 출력)·광색 단위는 원본 식대로 맞다 — 원본 식으로 계산한 값이 참고 이미지와 ±1 이내다.

### 12.2 무대 위 한 점(N = +Y, 카메라 (0, 12.5, 27.18) → 원점, 비네트 0) [재구현 계산]

| 단계 | 원본 식 (양지) | 고치기 전 웹 (양지) | 원본 식 (그늘) | 고치기 전 웹 (그늘) |
|---|---|---|---|---|
| 알베도 fld_alb(선형 평균) × blendColor 1 | 0.541 | 같음 | 0.541 | 같음 |
| 직접광 | 알베도·램프 0.772·광색 = (0.238, 0.512, 0.628) | 같음 | 알베도·램프(0,0) 0.171 = (0.093, 0.093, 0.093) | 0 |
| 확산 IBL | 알베도·0.96·(irr(N) (0.111, 0.249, 0.539) + 0.597·irr(시선) (0.239, 0.523, 1.027)) = (0.132, 0.295, 0.600) | 알베도·0.96·irr(N) = (0.058, 0.130, 0.280) | 같음(양지와 같다) | 같음 |
| 림 (rimLightColor 1 · 광색 · (1−N·V)^3 · 0.8, N·V 0.418) | (0.090, 0.193, 0.237) | 같음 | 같음 | 같음 |
| × fld_sg_alb (0.681, 0.714, 0.757) | **(0.314, 0.713, 1.108)** | (0.263, 0.596, 0.866) | **(0.215, 0.414, 0.703)** | (0.101, 0.230, 0.391) |
| 톤맵 5 | (0.312, 0.681, 0.864) | (0.263, 0.590, 0.772) | | |
| g = t^(1/2.2) → LUT(선형) | (0.278, 0.711, 0.884) | (0.223, 0.612, 0.800) | | |
| 화면 sRGB | **(144, 219, 242)** | (130, 205, 231) | **(115, 170, 218)** | (66, 120, 165) |
| 참고 이미지 | 중앙 (144, 220, 242), 무대 중앙값 (138, 211, 234) | 웹 화면 무대 중앙값 (122, 197, 223) | 발자국·그늘 (104~131, 159~186, 204~227) | |

반사(스펙큘러)는 양쪽 같은 근사로 빼고 계산했다(거칠기 ≈ 0.85, F0 0.04 → 영향 작음).

### 12.3 웹 반영

- `view/material.ts` 눈 레시피: RAMP_DIRECT(그늘 램프(0,0) 몫, 그림자 비율 = |그림자 곱한 광색| / |광색|), IBL_SNOW(irr(N) + 램프(0.6)·irr(시선), 큐브는 three 조회 (−x, y, z)), 램프 샘플러 Clamp(원본 fmdb). 눈덩이는 재질 국소 irr 큐브(snowball_irr, `material.json` textures 의 `cube`).
- `view/lighting.ts`: irr 큐브·평행광 원본 색·L 을 `mpsSceneEnv`(material.ts)로 넘긴다. 큐브 면 바꿈 로더는 `loadMpsHdrCube`(material.ts)로 옮겼다.
- 검산: `hsmg402_color_calc.py` 의 webAfter(고친 웹 GLSL 을 그대로 옮긴 식)가 원본 식과 최대 오차 0.

### 12.4 광원

- 장면에 해·달 같은 빛나는 메시는 없다(sky glb = sky·sky_grad·cloud_layer 3개) [데이터]. 평행광 방향(고도 30°)은 게임 카메라 화면 위쪽 끝(수평 아래 13.4°)보다 높아 화면 밖이다 [재구현 계산]. 화면의 반짝임은 이펙트(`hsmg402_map_snow00` 의 `snow00_*_glare`, `map_star00/01` 별·유성 — 08_effects.md)다.

### 12.5 참고 이미지 출처

- https://mario.wiki.gallery/images/5/50/Snowball_Summit_-_Mario_Party_Superstars.png (1920×1080, [Super Mario Wiki Snowball Summit](https://www.mariowiki.com/Snowball_Summit))
- https://mario.wiki.gallery/images/3/39/MPS_Snowball_Summit.png (공식 사이트 스크린샷, 1920×1080)
