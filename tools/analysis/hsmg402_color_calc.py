"""hsmg402 화면 색 단계별 재구현 계산 — 무대 눈 한 점·눈 그림자 한 점·오로라 한 점을 원본 판독 식과 웹 식으로 각각 계산한다.
  F:/dev/mps/.venv/Scripts/python web/tools/analysis/hsmg402_color_calc.py   → analysis/hsmg402_color_calc.json
근거: web/docs/engine/03_graphics.md 7.2·7.3(지면 p384·오로라 p128 SASS), 07_camera_lighting.md(평행광·IBL·톤맵·LUT).
참고 이미지 값(공식 사이트 스크린샷 1920×1080 을 930×523 로 줄여 잰 무대 중앙값)은 비교용일 뿐 식에 넣지 않는다.
"""
import json, math
from pathlib import Path
import numpy as np
from PIL import Image

from light_calc import ROOT, TEX, ENV, read_hdr, light_toward, tone5

MATS = {(m["file"].split("/")[-1], m["name"]): m for m in json.loads((ROOT / "analysis/mat/hsmg402_mats.json").read_text(encoding="utf-8"))}


def s2l(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    c = np.clip(np.asarray(c, float), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def tex(name):
    return np.asarray(Image.open(TEX / f"hsmg402_{name}.png").convert("RGBA")).astype(float) / 255


def sample_row(img, u, v=0.0, clamp=True):
    """u,v (0..1) 쌍선형, sRGB 텍스처는 텍셀을 선형으로 푼 뒤 섞는다(하드웨어 sRGB 표본)"""
    h, w = img.shape[:2]
    x = u * w - 0.5
    y = v * h - 0.5
    x0 = math.floor(x); y0 = math.floor(y); fx = x - x0; fy = y - y0
    def px(xx, yy):
        xx = min(max(xx, 0), w - 1) if clamp else xx % w
        yy = min(max(yy, 0), h - 1) if clamp else yy % h
        return s2l(img[yy, xx, :3])
    return (px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx) * (1 - fy) + (px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx) * fy


IRR = [read_hdr(TEX / f"hsmg402_irr_{i:02d}.hdr") for i in range(6)]


def cube(faces, d):
    """표준 큐브 면 선택(+X −X +Y −Y +Z −Z), 쌍선형"""
    d = np.asarray(d, float)
    ax = np.abs(d)
    if ax[0] >= ax[1] and ax[0] >= ax[2]:
        f, s, t, m = (0, -d[2], -d[1], ax[0]) if d[0] > 0 else (1, d[2], -d[1], ax[0])
    elif ax[1] >= ax[2]:
        f, s, t, m = (2, d[0], d[2], ax[1]) if d[1] > 0 else (3, d[0], -d[2], ax[1])
    else:
        f, s, t, m = (4, d[0], -d[1], ax[2]) if d[2] > 0 else (5, -d[0], -d[1], ax[2])
    img = faces[f]
    n = img.shape[0]
    x = ((s / m) + 1) / 2 * n - 0.5
    y = ((t / m) + 1) / 2 * n - 0.5
    x0, y0 = int(math.floor(x)), int(math.floor(y)); fx, fy = x - x0, y - y0
    g = lambda xx, yy: img[min(max(yy, 0), n - 1), min(max(xx, 0), n - 1)]
    return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy


def ibl(faces, w):
    """원본 조회 규약: 세계 방향 w 를 (x, y, −z) 로 큐브 조회 [판독 07 6.3]"""
    return cube(faces, [w[0], w[1], -w[2]])


LUT = np.asarray(Image.open(TEX / "hsmg402_lut.png").convert("RGB")).astype(float) / 255
LUT_AXIS = s2l(np.array([LUT[0, i, 0] for i in range(16)]))  # 축마다 같은 곡선(분리 가능, 데이터 확인)


def post(c, r_ndc=0.0):
    """합성 패스 변형 558: 노출 1 → 톤맵 5 → g = t^(1/2.2) → LUT(sRGB 형식, 선형으로 풀어 보간) → 비네트 → sRGB 출력 바이트"""
    p = ENV["post"]
    x = np.asarray(c, float) * p["exposure"] + p["exposure_offset"]
    t = np.array([tone5(v) for v in x]) * p["tonemap_output_scale"]
    g = np.abs(t) ** (1 / 2.2)
    i = np.clip(g * 15, 0, 15)
    lo = np.floor(i).astype(int); hi = np.minimum(lo + 1, 15); f = i - lo
    lin = LUT_AXIS[lo] * (1 - f) + LUT_AXIS[hi] * f
    lin = lin * (1 - p["vignette"] * r_ndc)
    return {"x": x.round(4).tolist(), "tone": t.round(4).tolist(), "g": g.round(4).tolist(), "lutLinear": lin.round(4).tolist(),
            "srgb8": (l2s(lin) * 255).round().astype(int).tolist()}


def snow_point():
    m = MATS[("hsmg402_fld.glb", "fld_snow_fluid_mt")]["params"]
    P = lambda k: m[k]["value"] if isinstance(m[k], dict) else m[k]
    L = light_toward(*ENV["light"]["lightRotation"])
    Lc = np.array(ENV["light"]["color"][:3], float)
    eye = np.array([0, 12.5, 27.17857]); tgt = np.zeros(3)
    N = np.array([0.0, 1.0, 0.0])
    V = eye - tgt; V /= np.linalg.norm(V)
    F = -V  # Camera::GetViewVector = −(카메라 행렬 +0xc0) = 눈→주시점 [판독 main @0x7100595ff0, View+0x1b0 ← @0x7100432dc4]
    alb = tex("fld_alb")[..., :3].reshape(-1, 3)
    alb = s2l(alb).mean(0) * np.array(P("blendColor")[:3])
    dif = tex("fld_dif")
    NL = float(N @ L)
    ramp_nl = sample_row(dif, NL * 0.5 + 0.5)
    ramp0 = sample_row(dif, 0.0)
    ramp06 = sample_row(dif, 0.6)
    sg = sample_row(tex("fld_sg_alb"), 0.0, 0.0, clamp=False)
    NV = float(N @ V)
    rim = np.array(P("rimLightColor")[:3]) * Lc * max(1 - NV, 1e-4) ** P("rimPower") * P("rimlightColorScale")
    irrN = ibl(IRR, N); irrF = ibl(IRR, F)
    k_irr = P("irradianceColorScale") * ENV["ibl"]["common_irradiance_scale"]
    F0 = 0.04
    fresnel_d = 1 - F0  # 확산 쪽 (1−F) 근사: 거칠기 ≈ 0.85 의 EnvBRDF 근사에서 F ≈ F0
    res = {"inputs": {"albedoLinear": alb.round(4).tolist(), "lightColor": Lc.tolist(), "L": L.round(4).tolist(), "NdotL": round(NL, 4),
                      "rampAtNL": ramp_nl.round(4).tolist(), "ramp0": ramp0.round(4).tolist(), "ramp06": ramp06.round(4).tolist(),
                      "sgAlb": sg.round(4).tolist(), "irrN": irrN.round(4).tolist(), "irrViewVec": irrF.round(4).tolist(),
                      "rim": rim.round(4).tolist(), "NdotV": round(NV, 4)}}
    for lit in (1.0, 0.0):
        direct_orig = alb * (ramp0 * (1 - lit) + ramp_nl * Lc * lit)
        ibl_orig = alb * fresnel_d * (irrN + ramp06 * irrF) * k_irr
        c_orig = (direct_orig + ibl_orig + rim) * sg
        direct_web = alb * ramp_nl * Lc * lit
        ibl_web = alb * fresnel_d * irrN * k_irr
        c_web = (direct_web + ibl_web + rim) * sg
        # 고친 웹(material.ts RAMP_DIRECT·IBL_SNOW): three 평행광 색 = π·Lc(조명 쪽), mpsShadow = |광색·그림자| / |광색|, BRDF_Lambert = 알베도/π
        pi_lc = math.pi * Lc
        mps_shadow = float(np.sum(pi_lc * lit) / np.sum(pi_lc))
        direct_after = (ramp_nl * pi_lc * mps_shadow + ramp0 * math.pi * (1 - mps_shadow)) * alb / math.pi
        ibl_after = alb * fresnel_d * (math.pi * k_irr * (irrN + ramp06 * irrF)) / math.pi
        c_after = (direct_after + ibl_after + rim) * sg
        key = "lit" if lit else "shadow"
        res[key] = {"original": {"direct": direct_orig.round(4).tolist(), "ibl": ibl_orig.round(4).tolist(), "radiance": c_orig.round(4).tolist(),
                                 "post": post(c_orig)},
                    "webBefore": {"direct": direct_web.round(4).tolist(), "ibl": ibl_web.round(4).tolist(), "radiance": c_web.round(4).tolist(),
                                  "post": post(c_web)},
                    "webAfter": {"direct": direct_after.round(4).tolist(), "ibl": ibl_after.round(4).tolist(), "radiance": c_after.round(4).tolist(),
                                 "post": post(c_after), "maxAbsDiffToOriginal": float(np.abs(c_after - c_orig).max())}}
    return res


def aurora_point():
    """오로라 커튼 아래쪽 한 점(aurora_mt, 정점색 (0.7,0.7,0.7,a)) — p128 FS 판독 식"""
    m = MATS[("hsmg402_aurora.glb", "aurora_mt")]["params"]
    P = lambda k: m[k]["value"] if isinstance(m[k], dict) else m[k]
    uc0 = np.clip(P("utilityColor0")[:3], 0, 1); uc1 = np.clip(P("utilityColor1")[:3], 0, 1)
    up1 = P("utilityParameter1")
    a0 = tex("aurora00"); g0 = tex("aurora_grad00"); g1 = tex("aurora_grad01")
    a0c = s2l(a0[460, 512, :3]); a0a = a0[460, 512, 3]
    vc = np.array([0.7, 0.7, 0.7])
    base = np.clip(a0c * vc * np.array(P("blendColor")[:3]) * uc0, 0, 1)
    out = []
    for u in (0.1, 0.5, 0.9):
        gr = np.clip(s2l(g0[200, int(u * 1023), :3]), 0, 1)
        e = s2l(g1[200, int(u * 511), :3])
        dodge = np.where(base >= 1, 1.0, np.minimum(gr / np.maximum(1 - base, 1e-4), 1.0))
        a = np.clip(dodge * up1[0], 0, 1)
        b = np.clip(np.clip(e, 0, 1) * uc1 * up1[1], 0, 1)
        ovl = np.where(a < 0.5, 2 * a * b, 1 - 2 * (1 - a) * (1 - b))
        ak = a0a * 1.0 * P("blendColor")[3]
        N = np.array([0.0, 0.0, 1.0])
        Lc = np.array(ENV["light"]["color"][:3]); L = light_toward(*ENV["light"]["lightRotation"])
        lit = dodge * (0.96 * P("irradianceColorScale") * ibl(IRR, N) + Lc * max(float(N @ L), 0))
        out.append({"u": u, "base": base.round(4).tolist(), "grad00": gr.round(4).tolist(), "dodge": dodge.round(4).tolist(),
                    "e_grad01": e.round(4).tolist(), "overlay": ovl.round(4).tolist(), "litNormalPlusZ": lit.round(4).tolist(),
                    "webBefore": {"rgb": dodge.round(4).tolist(), "alpha": round(float(ak), 4)},
                    "original": {"rgb": (lit + ovl).round(4).tolist(), "alpha": round(float(ak * (1 + e[0])), 4)}})
    return out


def sky_grad_edge():
    """sky_grad_mt 띠 윗변(정점 v = −0.206) 알파: 원본 샘플러 wrapV Clamp [데이터 fmdb] vs 고치기 전 웹 Repeat"""
    img = tex("sky_grad")
    h = img.shape[0]
    v = -0.206
    clamp_row = img[0, :, 3].mean()
    rep_row = img[int((v % 1.0) * h), :, 3].mean()
    return {"vTop": v, "alphaClamp": round(float(clamp_row), 4), "alphaRepeat": round(float(rep_row), 4)}


def main():
    r = {"snow": snow_point(), "aurora": aurora_point(), "skyGradTopEdge": sky_grad_edge(),
         "reference": {"note": "[참고 이미지] mariowiki MPS 스크린샷 2장 무대 영역(930×523 축소 194:412, 194:726) 중앙값 sRGB",
                       "stageMedian": [[138, 211, 234], [139, 211, 230]], "webBeforeMedian": [122, 197, 223]}}
    (ROOT / "analysis/hsmg402_color_calc.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(r, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
