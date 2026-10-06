"""hsmg402 눈 자국 홈 단면 재구현 계산 — 홈 한 단면을 원본 식과 웹 식(고치기 전·후)으로 각각 칠해 그늘·대비가 어디서 빠지는지 단계별로 잰다.
  F:/dev/mps/.venv/Scripts/python web/tools/analysis/hsmg402_fluid_groove_calc.py   → analysis/hsmg402_fluid_groove_calc.json
근거: web/docs/engine/03_graphics.md 7.2(눈 그래프 p384·p768 FS)·7.6(유체), web/docs/minigame/hsmg402.md 7.5.
  - 붓: h += −fluid0_hgt(x − mx + 0.5, 0.5 − (z − mz))·sat(10·d)·M160, 붓 메시 실루엣 반경 1.12·0.6·공 배율 [판독]
  - 지면 윗면 fld_snow_fluid_mt: y = 0.196 + 0.3·h(정점 간격 0.127 m, 선형 보간), N = normalize(N_면 + n_유체), 최종 × fld_sg_alb(−h, 0) [판독]
  - 아래 fld_snow_mt(y 0): 유체 노멀 없음, blendColor 0.76, rimPower 2·rimlightColorScale 1·rimLightColor 0.75, cast_shadow 0 [데이터]
  - 그림자: 윗면만 cast_shadow 1 [데이터], 깊이 전용 변형 p385(shader_type 1) VS 가 같은 변위를 한다 [판독]
가정: 홈은 세계 x 방향으로 곧게(공이 x 로 굴러감), 단면은 z. 카메라 = color_calc 와 같은 눈 (0, 12.5, 27.18) 정사영 근사.
"""
import json, math
import numpy as np

from hsmg402_color_calc import ROOT, ENV, MATS, s2l, l2s, tex, sample_row, IRR, ibl, post
from light_calc import light_toward

DEPTH = 0.3
TOP_Y = 0.196
VSTEP = 0.127
TEXEL = 19 / 512
CLEAR = 0.2
L = light_toward(*ENV["light"]["lightRotation"])
LC = np.array(ENV["light"]["color"][:3], float)
EYE = np.array([0, 12.5, 27.17857])
VDIR = EYE / np.linalg.norm(EYE)
FVIEW = -VDIR
BRUSH = s2l(tex("fluid0_hgt")[..., 0])
DIF = tex("fld_dif")
SG = tex("fld_sg_alb")
ALB = s2l(tex("fld_alb")[..., :3].reshape(-1, 3)).mean(0)
RAMP0 = sample_row(DIF, 0.0)
RAMP06 = sample_row(DIF, 0.6)
IRR_F = ibl(IRR, FVIEW)


def mat(name):
    m = MATS[("hsmg402_fld.glb", name)]["params"]
    return lambda k: m[k]["value"] if isinstance(m[k], dict) else m[k]


TOPM = mat("fld_snow_fluid_mt")
BASEM = mat("fld_snow_mt")
K_IRR = TOPM("irradianceColorScale") * ENV["ibl"]["common_irradiance_scale"]


def brush(du, dz):
    """fluid0_hgt 선형값(쌍선형, Clamp). du = x − mx, dz = z − mz"""
    n = BRUSH.shape[0]
    u = du + 0.5
    v = 0.5 - dz
    x = u * n - 0.5
    y = v * n - 0.5
    x0 = math.floor(x); y0 = math.floor(y); fx = x - x0; fy = y - y0
    g = lambda xx, yy: BRUSH[min(max(yy, 0), n - 1), min(max(xx, 0), n - 1)]
    return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy


def groove_sum(z, scale, d):
    """홈 가운데 x = 0 텍셀이 공 한 번 지나가는 동안 받는 붓 합 Σ(z) (공 중심 z = 0, 프레임마다 x 로 d 이동)"""
    r = 1.12 * 0.6 * scale
    s = 0.0
    k = min(10 * d, 1.0)
    for i in range(-int(1.5 / d), int(1.5 / d) + 1):
        mx = i * d
        if mx * mx + z * z < r * r:
            s += brush(-mx, z) * k
    return s


def profile(scale, d, clamp):
    zs = np.arange(-1.5, 1.5 + 1e-9, TEXEL)
    h = np.array([CLEAR - groove_sum(z, scale, d) for z in zs])
    if clamp:
        h = np.clip(h, -1, 1)
    return zs, h


def h_at(zs, h, z):
    return float(np.interp(z, zs, h))


def top_y(zs, h, z):
    """정점(간격 0.127 m)에서 높이장 표본 → 삼각형 선형 보간"""
    k = math.floor(z / VSTEP)
    z0, z1 = k * VSTEP, (k + 1) * VSTEP
    y0 = TOP_Y + DEPTH * h_at(zs, h, z0)
    y1 = TOP_Y + DEPTH * h_at(zs, h, z1)
    t = (z - z0) / VSTEP
    return y0 * (1 - t) + y1 * t


def fluid_normal(zs, h, z):
    """fluid_normal Sobel(홈이 x 로 균일): n ∝ (0, 8A², 4·A·S·(h(z−A) − h(z+A)))"""
    a = TEXEL
    nz = 4 * a * DEPTH * (h_at(zs, h, z - a) - h_at(zs, h, z + a))
    n = np.array([0.0, 8 * a * a, nz])
    return n / np.linalg.norm(n)


def surf(zs, h, z):
    yt = top_y(zs, h, z)
    return (yt, "top") if yt >= 0 else (0.0, "floor")


def lit(zs, h, z, y, bias):
    """광원 쪽으로 직선 진행 — 윗면(변위, 캐스터)이 광선 위면 그늘. bias = (법선 방향 올림, 광선 방향 여유)"""
    up, slack = bias
    p = np.array([z, y + up])
    dirv = np.array([L[2], L[1]])
    t = slack
    while t < 3.0:
        q = p + dirv * t
        if q[1] > TOP_Y + DEPTH * 1.0 + 0.01:
            return 1.0
        if top_y(zs, h, q[0]) > q[1]:
            return 0.0
        t += 0.004
    return 1.0


def shade(N, sh, kind, hval):
    P = TOPM if kind == "top" else BASEM
    alb = ALB * np.array(P("blendColor")[:3])
    nl = float(N @ L)
    ramp = sample_row(DIF, nl * 0.5 + 0.5)
    direct = alb * (RAMP0 * (1 - sh) + ramp * LC * sh)
    iblc = alb * 0.96 * (ibl(IRR, N) + RAMP06 * IRR_F) * K_IRR
    nv = float(N @ VDIR)
    rim = np.array(P("rimLightColor")[:3]) * LC * max(1 - nv, 1e-4) ** P("rimPower") * P("rimlightColorScale")
    sg = sample_row(SG, -hval if kind == "top" else 1.0, 0.0, clamp=False)
    return (direct + iblc + rim) * sg, nl


def camera_rays(zs, h, n=400, span=(-1.2, 1.2)):
    """카메라 쪽에서 −V 로 쏜 평행 광선의 첫 교점(가려진 바닥은 안 보인다)"""
    hits = []
    vz, vy = VDIR[2], VDIR[1]
    for z0 in np.linspace(span[0], span[1], n):
        p = np.array([z0 + vz * 2.0 / vy, 2.0])
        while p[1] > -0.2:
            y, kind = surf(zs, h, p[0])
            if p[1] <= y:
                hits.append((float(p[0]), y, kind))
                break
            p = p - np.array([vz, vy]) * 0.003
    return hits


def run_case(scale, d, clamp):
    zs, h = profile(scale, d, clamp)
    rows = []
    sums = {"original": [], "webBefore": [], "webAfter": []}
    bias_web = (0.02, 0.0005 * 29)
    for z, y, kind in camera_rays(zs, h):
        hz = h_at(zs, h, z)
        N = np.array([0.0, 1.0, 0.0])
        if kind == "top":
            N = N + fluid_normal(zs, h, z)
            N /= np.linalg.norm(N)
        s_orig = lit(zs, h, z, y, (0.0, 0.01))
        s_after = lit(zs, h, z, y, bias_web)
        c_o, nl = shade(N, s_orig, kind, hz)
        c_b, _ = shade(N, 1.0, kind, hz)
        c_a, _ = shade(N, s_after, kind, hz)
        for k, c in (("original", c_o), ("webBefore", c_b), ("webAfter", c_a)):
            sums[k].append(c)
        rows.append({"z": round(z, 3), "y": round(y, 3), "kind": kind, "h": round(hz, 3), "NdotL": round(nl, 3),
                     "litOriginal": s_orig, "litWebAfter": s_after,
                     "srgbOriginal": post(c_o)["srgb8"], "srgbWebBefore": post(c_b)["srgb8"]})
    flat, _ = shade(np.array([0.0, 1.0, 0.0]), 1.0, "top", CLEAR)
    flat_s = np.array(post(flat)["srgb8"], float)
    inside = [i for i, r in enumerate(rows) if r["h"] < CLEAR - 0.3]
    summ = {}
    for k, cs in sums.items():
        m = np.mean([cs[i] for i in inside], 0) if inside else np.zeros(3)
        s8 = np.array(post(m)["srgb8"], float)
        summ[k] = {"grooveMeanSrgb": s8.astype(int).tolist(), "ratioToFlat": (s8 / flat_s).round(3).tolist()}
    deep = float(h.min())
    wall = [r for r in rows if r["kind"] == "top" and r["h"] < CLEAR - 0.3]
    return {"scale": scale, "framestep": d, "clampMinus1": clamp, "hMin": round(deep, 3),
            "floorWidth": round(float(np.sum(TOP_Y + DEPTH * h < 0) * TEXEL), 3),
            "flatSrgb": flat_s.astype(int).tolist(), "visibleSamplesInGroove": len(inside),
            "visibleWallSamples": len(wall), "shadowedFractionOriginal": round(float(np.mean([rows[i]["litOriginal"] == 0 for i in inside])), 3) if inside else 0,
            "summary": summ, "rows": rows[::8]}


def acne_margin():
    """평평한 윗면이 캐스터·리시버를 겸할 때 three 여유(bias·normalBias) vs PCF 소프트(−1..+2 텍셀) 깊이 기울기"""
    X = np.array([0.931, -0.197, 0.309]); Y = np.array([0, -0.843, -0.537])
    up = np.array([0.0, 1.0, 0.0])
    lz = float(up @ L)
    tex_x = 32 / 2048; tex_y = 20 / 2048
    slope_x = abs(float(up @ X)) / lz * tex_x
    slope_y = abs(float(up @ Y)) / lz * tex_y
    margin = 0.02 / lz + 0.0005 * 29
    return {"depthPerTexelX": round(slope_x, 4), "depthPerTexelY": round(slope_y, 4), "pcfSoftNeed(1.5texel)": round(1.5 * max(slope_x, slope_y), 4),
            "threeMargin": round(margin, 4)}


def main():
    cases = [run_case(1.0, 0.1, True), run_case(1.0, 0.1, False), run_case(0.6, 0.0333, True)]
    r = {"light": L.round(4).tolist(), "lightColor": LC.tolist(), "eye": EYE.tolist(), "clear": CLEAR, "cases": cases, "acne": acne_margin(),
         "reference": {"note": "[참고 이미지] 사용자 원본 캡처 1280×720 — 홈 안 (830,330)(680,515)(1000,440), 평지 (600,600)(300,450)(900,520)",
                       "groove": [[71, 121, 174], [68, 118, 177], [67, 112, 169]], "flat": [[131, 236, 255], [127, 235, 245], [134, 241, 249]]}}
    (ROOT / "analysis/hsmg402_fluid_groove_calc.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    for c in cases:
        print(c["scale"], c["framestep"], c["clampMinus1"], "hMin", c["hMin"], "floorW", c["floorWidth"], "shadowFrac", c["shadowedFractionOriginal"],
              {k: v for k, v in c["summary"].items()}, "flat", c["flatSrgb"])
    print(r["acne"])


if __name__ == "__main__":
    main()
