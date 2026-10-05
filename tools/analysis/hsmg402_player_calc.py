"""hsmg402 데굴데굴 눈덩이 — 플레이어·CPU 식 재구현 계산 (원본 실행 아님).

판독 근거(hsmg402.nro, 베이스 0x7100000000; main = main.nso 같은 베이스):
  Player::Player            @0x7100004dec  기본값 e30=7.0 e34=0.42 e38=-37 e3c=68.5 e64=22 e08=-33
  Player::Update            @0x7100006cb0  넉백 감쇠, 낙하 판정(|p|^2>=67.24 또는 y<-0.5), B/A 트리거
  Player::ActionEX1         @0x7100007378  연타: 9회, 간격 0.5 s (TRIGGER_COUNT_END_TIME, CREATE_TRIGGER_COUNT)
  Player::ActionEX3         @0x7100007bf4  걷기 속도 = WalkSpeed(2.0) * 표[레벨]
  Player::MoveGroundEX      @0x71000081b4  회전 상한 = acos(dot(fwd, normalize(fwd + side*ws*dt)))
  Player::SetDamage         @0x710000a1cc  넉백 초속(DamageVecLen)·각(DamageVecDeg 68.5)·앞/뒤 판정
  Player::PostPhysics       @0x71000071dc  접지 && 피격 모션 프레임 >= DamageMoveAnimFrame 이면 정지
  PlayerCom::ThinkWait      @0x710000d47c  SyncRandMod(100) 분기, SHOT_PROBABILITY
  PlayerCom::ThinkActionCreateSnowBalll @0x710000ce74  CREATE_BUTTON_TRIG_TIME
  PlayerCom::SearchRandMovePosition     @0x710000d874  SyncRandRangeF(1,4), SyncRandRange(0,30)
  PlayerCom::ThinkWalk      @0x710000f410  SyncRandRange(1,101) <= 표[공 레벨]
  main hs::actor::Actor::controlVec @0x71000e95e0  y += dt*g, pos += (base+add)*dt
  main hs_actorparam.csv(행 2 WALK_SPEED=2) → ActorParam::WalkSpeed @0x71000e4f98 (0x71015eb118)
  sdk nn::util::detail::{Sin,Cos}Coefficients (sdk NSO 동적 심볼, @0xab263c/@0xab2650)

가정·스텁(판독 밖이라 원본과 다를 수 있음):
  - dt = f32(1/60) = 0x3C888889 (GetDeltaTime·ActorUtil::getDeltaTime 둘 다 고정).
  - 한 프레임 순서: Player::Update → ActorManager(controlPre→control(controlAction→controlVec)) → PostPhysics.
    엔티티 틱 순서는 [미확정]이라 연타 첫 입력은 두 경우를 모두 계산한다.
  - 지면: 평평한 원판 r<=7.4971, y=0 (assets 담당 충돌 판독). 원판 밖은 지면 없음(자유낙하)으로 단순화.
    실제 접지는 엔진 collisionGroundGeo/CastShape 라 재현하지 않았다.
  - 피격 모션 프레임은 맞은 프레임부터 1 프레임에 1 씩 증가(getFPSMotion=60, 속도 1.0)로 가정.
  - CalculateDirectionZ = (sin yaw, 0, cos yaw), acosf 는 math.acos 를 f32 로 반올림(1 ulp 차이 가능).
  - 최대 낙하 속도(Actor+0x2d4) -49 는 ResetJumpParamEx 가 불렸다는 [추정].

  .venv/Scripts/python web/tools/analysis/hsmg402_player_calc.py   → analysis/hsmg402_player_calc.json
"""
import json
import math
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import nro  # noqa: E402
from core_rand import BexRand  # noqa: E402
from hsmg402_calc import f32, bits, hx, DT, neon_normalize, lane_sq, neon_inv_len  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
IMG = nro.Image(os.path.join(ROOT, "extracted", "romfs", "nro", "NX_Release", "hsmg402.nro"))


def rd_f32(va, n=1):
    return [f32(IMG.f32(va + 4 * i)) for i in range(n)]


def rd_i32(va, n=1):
    return [IMG.i32(va + 4 * i) for i in range(n)]


# ---------------- 상수 (NRO 에서 직접 읽음, 심볼 이름 그대로) ----------------
DAMAGE_VEC_RES = rd_f32(0x7100030760, 8)        # Player::DamageVecRes
DAMAGE_VEC_LEN = rd_f32(0x7100030780, 8)        # Player::DamageVecLen
DAMAGE_VEC_DEG = rd_f32(0x71000307a0, 8)        # Player::DamageVecDeg
DAMAGE_MOVE_ANIM_FRAME = rd_f32(0x71000307c0, 8)  # Player::DamageMoveAnimFrame
TRIGGER_COUNT_END_TIME = rd_f32(0x71000307e0)[0]
CREATE_TRIGGER_COUNT = rd_i32(0x71000307e4)[0]
WALK_SPEED_FACTOR = rd_f32(0x71000307e8, 8)     # 무명 표, ActionEX3 @0x7100007db4
WALK_ANIM_SPEED = rd_f32(0x7100030808, 8)       # 무명 표, ActionEX3 @0x7100007e9c (×0.001)
WALK_STOP_PERCENT = rd_i32(0x7100030828, 8)     # 무명 표, ThinkWalk @0x710000f410
OUT_FIELD_LENGE = rd_f32(0x7100030848)[0]
MOVE_GOAL_LIMIT = rd_f32(0x710003084c)[0]
CREATE_BUTTON_TRIG_TIME = rd_f32(0x7100030850, 4)
SHOT_PROBABILITY = [rd_i32(0x7100030860 + 32 * lv, 8) for lv in range(4)]
WALK_SPEED = f32(2.0)                            # hs_actorparam.csv 행 2 (WALK_SPEED,2)
GRAVITY = bits(0xC2140000)                       # -37.0 Player+0xE38 (ctor 0xc2140000)
FALL_R2 = bits(0x42867AE1)                       # 67.24 Player::Update @0x7100006ee0
DEG = bits(0x42652EE1)                           # 57.29578
RAD = bits(0x3C8EFA35)                           # 0.017453292
TERMINAL = f32(-49.0)                            # Actor+0x2d4 [추정]
FLAT_R = f32(7.4971)                             # 지면 원판 반지름 [데이터: assets]

# sdk nn::util::detail
SIN_C = [bits(x) for x in (0x32D46A65, 0x36391B32, 0x39500FBD, 0x3C088896, 0x3E2AAAAB)]
COS_C = [bits(x) for x in (0x348CB96F, 0x37CFC9CF, 0x3AB60A5D, 0x3D2AAAA8, 0x3F000000)]
F1D2PI, FPID2, FPI, F2PI = bits(0x3E22F983), bits(0x3FC90FDB), bits(0x40490FDB), bits(0x40C90FDB)


def fma(a, b, c):
    """a*b + c 한 번 반올림(f32 곱은 f64 에서 정확)."""
    return f32(float(np.float64(a) * np.float64(b) + np.float64(c)))


def nn_sincos_vec(a):
    """SetDamage @0x710000a358~0x710000a47c 의 벡터 sin/cos(fmla/fmls 융합). 반환 (sin, cos)."""
    a = f32(a)
    t = f32(a * F1D2PI)
    t = f32(t + (f32(0.5) if t >= 0 else f32(-0.5)))
    n = f32(int(t))                                # fcvtzs (0 쪽 절삭)
    x = fma(-n, F2PI, a)                           # fmls v2, v3, F2PI
    flip = False
    if x > FPID2:
        x, flip = f32(FPI - x), True
    if x < -FPID2:
        x, flip = f32(-FPI - x), True
    x2 = f32(x * x)
    v6 = fma(-x2, SIN_C[0], SIN_C[1])
    v7 = fma(x2, v6, -SIN_C[2])
    v6 = fma(x2, v7, SIN_C[3])
    v7 = fma(x2, v6, -SIN_C[4])
    v6 = fma(x2, v7, f32(1.0))
    s = f32(x * v6)
    w7 = fma(-x2, COS_C[0], COS_C[1])
    w6 = fma(x2, w7, -COS_C[2])
    w16 = fma(x2, w6, COS_C[3])
    w6 = fma(x2, w16, -COS_C[4])
    c = fma(x2, w6, f32(1.0))
    c = f32(c * (f32(-1.0) if flip else f32(1.0)))
    return s, c


def acosf(x):
    x = f32(min(max(float(x), -1.0), 1.0))
    return f32(math.acos(float(x)))


def dot4(a, b):
    """fmul → ext #8 → fadd .2s → faddp : (x*x'+z*z') + (y*y'+w*w')."""
    p = [f32(a[i] * b[i]) for i in range(4)]
    return f32(f32(p[0] + p[2]) + f32(p[1] + p[3]))


def cross4(u, v):
    """tbl 표 0x6d8/0x6c0/0x6a8/0x6b8 + fmls: (u.y v.z - u.z v.y, u.z v.x - u.x v.z, u.x v.y - u.y v.x, 0)."""
    return [fma(-u[2], v[1], f32(u[1] * v[2])), fma(-u[0], v[2], f32(u[2] * v[0])),
            fma(-u[1], v[0], f32(u[0] * v[1])), f32(0)]


# ---------------- 1. 넉백 초속 (SetDamage) ----------------
def knock_velocity(src, pos, level):
    d = neon_normalize([f32(src[0] - pos[0]), f32(0), f32(src[2] - pos[2]), f32(0)])
    axis = neon_normalize(cross4(d, [f32(0), f32(1), f32(0), f32(0)]))
    th = f32(DAMAGE_VEC_DEG[level] * RAD)
    ang = [f32(c * th) for c in axis]
    sc = [nn_sincos_vec(x) for x in ang[:3]]
    (s0, c0), (s1, c1), (s2, c2) = sc
    v7 = [f32(-f32(s2 * c0)), f32(c2 * c0)]
    v6 = [f32(f32(c2 * s1) * s0), f32(f32(s2 * s1) * s0), f32(c1 * s0)]
    r = [f32(v7[0] + v6[0]), f32(v7[1] + v6[1]), f32(f32(0) + v6[2]), f32(0)]
    n = neon_normalize(r)
    v = [f32(c * DAMAGE_VEC_LEN[level]) for c in n]
    return d, v


def damage_side(d_to_src, yaw):
    """SetDamage 끝: acos(dot(d, fwd))*57.29578 < 90 → ActionEX6(앞, co_damage02) 아니면 EX7(뒤, co_damage03)."""
    fwd = [f32(math.sin(yaw)), f32(0), f32(math.cos(yaw)), f32(0)]
    a = f32(acosf(dot4(d_to_src, fwd)) * DEG)
    return ("EX6 front" if a < 90.0 else "EX7 back"), float(a)


def knock_sim(src, pos0, level, max_frames=600):
    """맞은 뒤 수평 이동·낙하. 순서 가정: Update(감쇠) → controlVec(중력·적분) → PostPhysics(정지 판정)."""
    d, v = knock_velocity(src, pos0, level)
    p = [f32(pos0[0]), f32(pos0[1]), f32(pos0[2])]
    v = list(v[:3])
    frame = 0                   # 피격 모션 프레임(가정)
    first = True                # e0E: SetDamage 직후 첫 PostPhysics 는 건너뜀
    knock = True
    grounded = True
    k = f32(DAMAGE_VEC_RES[level] * DT)
    out = None
    for t in range(1, max_frames + 1):
        if knock:               # Player::Update: add -= add*(e34*dt), 4 성분 모두
            v = [f32(c - f32(c * k)) for c in v]
        # controlVec
        if grounded and v[1] <= 0:
            v[1] = f32(DT * GRAVITY)
        else:
            v[1] = f32(v[1] + f32(DT * GRAVITY))
            if v[1] < TERMINAL:
                v[1] = TERMINAL
        p = [f32(f32(v[i] * DT) + p[i]) for i in range(3)]
        r = math.hypot(float(p[0]), float(p[2]))
        if r <= FLAT_R and p[1] <= 0:      # 지면 스텁
            p[1] = f32(0)
            grounded = True
        else:
            grounded = r <= FLAT_R and p[1] <= 0
        frame += 1
        if knock and not first and grounded and frame >= DAMAGE_MOVE_ANIM_FRAME[level]:
            knock = False
            v = [f32(0), f32(0), f32(0)]
            out = {"stop_frame": t, "pos": [float(c) for c in p], "dist_from_start": math.hypot(float(p[0] - pos0[0]), float(p[2] - pos0[2]))}
        first = False
        r2 = lane_sq([p[0], p[1], p[2], f32(0)])
        if r2 >= FALL_R2 or p[1] < -0.5:
            return {"level": level, "v0": [float(c) for c in knock_velocity(src, pos0, level)[1][:3]],
                    "fall_frame": t, "fall_pos": [float(c) for c in p], "stopped": out}
        if not knock and out:
            return {"level": level, "v0": [float(c) for c in knock_velocity(src, pos0, level)[1][:3]],
                    "fall_frame": None, "stopped": out}
    return {"level": level, "stopped": out, "fall_frame": None}


# ---------------- 2. 공 든 걷기 회전 (MoveGroundEX) ----------------
def move_ground_ex_step(yaw, lever_deg, ws):
    """한 프레임: 새 yaw(rad)·이동 속도 벡터. 판독식 그대로, 변환 행렬은 sin/cos 근사."""
    lr = f32(lever_deg * RAD)
    dir_l = neon_normalize([f32(math.sin(lr)), f32(0), f32(math.cos(lr)), f32(0)])
    fwd = [f32(math.sin(yaw)), f32(0), f32(math.cos(yaw)), f32(0)]
    a = acosf(dot4(dir_l, fwd))
    axis = neon_normalize(cross4(fwd, dir_l))
    if lane_sq(cross4(fwd, dir_l)) == 0:
        axis = [f32(0), f32(1), f32(0), f32(0)]
    a_deg = f32(a * DEG)
    right = [f32(math.cos(yaw)), f32(0), f32(-math.sin(yaw)), f32(0)]   # CalculateDirectionX 근사
    if axis[1] > 0:
        right = [f32(0 - c) for c in right]
    kk = f32(ws * DT)
    p = [f32(f32(right[i] * kk) + fwd[i]) for i in range(4)]
    n = neon_normalize(p)
    b = f32(acosf(dot4(fwd, n)) * DEG)
    turn = a_deg if a_deg < b else b
    turn = f32(-turn) if axis[1] < 0 else turn
    yaw_deg = f32(yaw * DEG)
    new_yaw = f32(f32(turn + yaw_deg) * RAD)
    fwd2 = [f32(math.sin(new_yaw)), f32(0), f32(math.cos(new_yaw))]
    vel = [f32(c * ws) for c in fwd2]
    return float(new_yaw), [float(c) for c in vel], float(b), float(a_deg)


def turn_sim(level, lever_deg, max_frames=400):
    ws = f32(WALK_SPEED * WALK_SPEED_FACTOR[level])
    yaw, frames = 0.0, 0
    target = lever_deg
    for t in range(1, max_frames + 1):
        yaw, vel, step, rem = move_ground_ex_step(yaw, target, ws)
        if rem <= step:
            frames = t
            break
    return {"level": level, "walk_speed": float(ws), "turn_step_deg_per_frame": float(step),
            "turn_deg_per_sec": float(step) * 60, "frames_to_face": frames, "lever_deg": lever_deg}


# ---------------- 3. 연타 (ActionEX1) ----------------
def mash_human(interval, presses=20, same_frame_count=True):
    """interval 프레임마다 B. 첫 입력이 대기/걷기(행동<2)에서 EX1 진입.
    same_frame_count=True: 같은 프레임에 controlAction 이 EX1(false) 를 또 불러 첫 입력도 센다(액터 틱이 Player::Update 뒤).
    반환: 공이 생기는 프레임(첫 입력=1) 또는 실패(타이머 0 이하로 Idle 복귀)."""
    timer = None
    count = 0
    active = False
    press_frames = {1 + i * interval for i in range(presses)}
    for t in range(1, 1 + interval * presses + 40):
        trig = t in press_frames
        entered = False
        if not active and trig:
            active, count, timer, entered = True, 0, f32(0.5), True
        if active and (not entered or same_frame_count):
            if trig:
                timer, count = TRIGGER_COUNT_END_TIME, count + 1
            if count < CREATE_TRIGGER_COUNT:
                timer = f32(timer - DT)
                if not timer > 0:
                    return {"interval": interval, "result": "fail(Idle 복귀)", "frame": t, "count": count}
            else:
                return {"interval": interval, "result": "CreateSnowBall", "frame": t,
                        "presses_used": sum(1 for f in press_frames if f <= t)}
    return {"interval": interval, "result": "none"}


def com_press_interval(T):
    """ThinkActionCreateSnowBalll 부속 2: timer -= dt; <=0 이면 B 누르고 timer = T."""
    timer, last, gaps = f32(0), None, []
    for t in range(1, 200):
        timer = f32(timer - DT)
        if not timer > 0:
            if last is not None:
                gaps.append(t - last)
            last, timer = t, T
        if len(gaps) >= 5:
            break
    return gaps


def max_gap_frames():
    t, k = TRIGGER_COUNT_END_TIME, 0
    while True:
        k += 1
        t = f32(t - DT)
        if not t > 0:
            return k


# ---------------- 4. CPU 판단 확률 (ThinkWait) ----------------
def think_wait_table():
    rows = {}
    for lv in range(4):
        r = {}
        if lv == 0:
            r["no_ball"] = {"create(2)": 20, "walk(1)": 40, "wait 0.4s": 40}
            r["ball"] = {"walk(1)": 40, "wait 0.4s": 60}
        elif lv == 1:
            r["no_ball"] = {"create(2)": 40, "walk(1)": 50, "wait 0.3s": 10}
            r["ball"] = {"walk(1)": 60, "wait 0.3s": 40}
        else:
            r["no_ball"] = "위험 공 있으면 SearchSafeArea→walk, 없으면 SearchFrontPlayer(30°,4.0) 있으면 walk 아니면 create (난수 없음)"
            r["ball"] = "SHOT 실패 시 위험 공 있으면 SearchSafeArea→walk, 없으면 walk (난수 1회만)"
        r["shot_percent_by_ball_level(p+1)"] = [p + 1 for p in SHOT_PROBABILITY[lv]]
        rows[lv] = r
    return rows


def think_wait_rng(seed, lv, ball_level, n=8):
    """ThinkWait 의 SyncRandMod(100) 소비만 재현(lv 0/1). 반환: 결정 목록."""
    rng = BexRand(seed)
    out = []
    for _ in range(n):
        if ball_level >= 0:
            r = rng.rand_mod(100)
            if r <= SHOT_PROBABILITY[lv][ball_level]:
                out.append(("shot", r))
                continue
            r2 = rng.rand_mod(100)
            if lv == 1:
                out.append(("walk" if r2 <= 59 else "wait0.3", r, r2))
            else:
                out.append(("walk" if r2 <= 39 else "wait0.4", r, r2))
        else:
            r = rng.rand_mod(100)
            if lv == 1:
                out.append(("create" if r < 40 else "walk" if r < 90 else "wait0.3", r))
            else:
                out.append(("create" if r < 20 else "walk" if r < 60 else "wait0.4", r))
    return out


def rand_move_sample(seed, self_pos, base_dir, lv, ball_radius=0.0, n=5):
    """SearchRandMovePosition 뒷부분: dist=RangeF(1,4), ang=Range(0,30)→Y 회전(ang-360)/2 반각 쿼터니언(=ang 도).
    회전은 표준 Y 회전으로 근사(원본은 쿼터니언 곱, 스칼라 sin/cos 다항식)."""
    rng = BexRand(seed)
    out = []
    for _ in range(n):
        dist = rng.rand_range_f(1.0, 4.0)
        ang = rng.rand_range(0, 0x1E)
        th = math.radians(ang - 360.0)
        bx, bz = base_dir
        rx = bx * math.cos(th) + bz * math.sin(th)
        rz = -bx * math.sin(th) + bz * math.cos(th)
        tx, tz = self_pos[0] + rx * dist, self_pos[2] + rz * dist
        lim = 8.0 - 5.0 * ball_radius if lv >= 2 else 8.0
        flipped = math.sqrt(tx * tx + self_pos[1] ** 2 + tz * tz) >= lim
        if flipped:
            tx, tz = self_pos[0] - rx * dist, self_pos[2] - rz * dist
        out.append({"dist": float(dist), "ang_deg": ang, "target": [round(tx, 5), round(tz, 5)], "flipped": flipped})
    return out


def fall_check(p):
    r2 = lane_sq([f32(p[0]), f32(p[1]), f32(p[2]), f32(0)])
    return bool(not (r2 < FALL_R2 and not (f32(p[1]) < -0.5)))


def main():
    out = {"note": "재구현 계산(원본 실행 없음). 가정·스텁은 파일 머리말 참고.",
           "dt": hx(DT)}
    out["constants"] = {
        "DamageVecRes": [float(x) for x in DAMAGE_VEC_RES], "DamageVecLen": [float(x) for x in DAMAGE_VEC_LEN],
        "DamageVecDeg": [float(x) for x in DAMAGE_VEC_DEG], "DamageMoveAnimFrame": [float(x) for x in DAMAGE_MOVE_ANIM_FRAME],
        "TRIGGER_COUNT_END_TIME": float(TRIGGER_COUNT_END_TIME), "CREATE_TRIGGER_COUNT": CREATE_TRIGGER_COUNT,
        "walk_speed_factor": [float(x) for x in WALK_SPEED_FACTOR], "walk_anim_speed_x0.001": [float(x) for x in WALK_ANIM_SPEED],
        "walk_stop_percent(ThinkWalk)": WALK_STOP_PERCENT, "OUT_FIELD_LENGE": float(OUT_FIELD_LENGE),
        "MOVE_GOAL_LIMIT": float(MOVE_GOAL_LIMIT), "CREATE_BUTTON_TRIG_TIME": [float(x) for x in CREATE_BUTTON_TRIG_TIME],
        "SHOT_PROBABILITY[comLv][ballLv]": SHOT_PROBABILITY, "WalkSpeed": float(WALK_SPEED), "gravity": float(GRAVITY),
        "fall_r2": float(FALL_R2)}
    out["mash"] = {
        "max_gap_frames(이 프레임 수 이상 쉬면 실패)": max_gap_frames(),
        "human_first_press_counted": [mash_human(i, same_frame_count=True) for i in (1, 2, 4, 8, 15, 29, 30)],
        "human_first_press_not_counted": [mash_human(i, same_frame_count=False) for i in (1, 2, 4, 8, 15, 29, 30)],
        "com_gaps_frames": {lv: com_press_interval(CREATE_BUTTON_TRIG_TIME[lv]) for lv in range(4)},
    }
    com_total = {}
    for lv in range(4):
        g = com_press_interval(CREATE_BUTTON_TRIG_TIME[lv])[0]
        com_total[lv] = {"gap": g, "counted": mash_human(g, same_frame_count=True),
                         "not_counted": mash_human(g, same_frame_count=False)}
    out["mash"]["com_create_frame"] = com_total
    out["walk_with_ball"] = [turn_sim(lv, 90.0) for lv in range(8)] + [turn_sim(lv, 180.0 - 1e-3) for lv in (0, 7)]
    src = [0.0, 0.0, 3.0]
    out["knock_v0"] = []
    for lv in range(8):
        d, v = knock_velocity([3.0, 0, 0], [0.0, 0, 0], lv)
        d2, v2 = knock_velocity([2.0, 0, 3.0], [0.0, 0, 0], lv)
        out["knock_v0"].append({"level": lv, "src(+X)": [float(c) for c in v[:3]], "hex": [hx(c) for c in v[:3]],
                                "src(2,0,3)": [float(c) for c in v2[:3]]})
    out["knock_sim_from_center(공이 +Z 쪽)"] = [knock_sim(src, [0.0, 0.0, 0.0], lv) for lv in range(8)]
    out["knock_sim_from_start_pos(-4.5,0,-4.5) 공이 원점 쪽"] = [knock_sim([0.0, 0, 0], [-4.5, 0.0, -4.5], lv) for lv in range(8)]
    out["damage_side"] = {
        "facing+Z, src ahead": damage_side(neon_normalize([f32(0), f32(0), f32(1), f32(0)]), 0.0),
        "facing+Z, src 89.9deg": damage_side(neon_normalize([f32(1), f32(0), f32(0.0017), f32(0)]), 0.0),
        "facing+Z, src behind": damage_side(neon_normalize([f32(0), f32(0), f32(-1), f32(0)]), 0.0)}
    out["fall_check"] = {str(p): fall_check(p) for p in ([8.19, 0, 0], [8.2, 0, 0], [5.8, 0, 5.8], [0, -0.5, 0], [0, -0.51, 0], [7.0, -0.3, 4.0])}
    out["com_think_wait"] = think_wait_table()
    out["com_think_wait_rng(seed=0x1234)"] = {"lv0_no_ball": think_wait_rng(0x1234, 0, -1), "lv1_ball3": think_wait_rng(0x1234, 1, 3)}
    out["com_rand_move(seed=0x1234, self(0,0,0), base(+X))"] = {"lv1": rand_move_sample(0x1234, [0, 0, 0], (1.0, 0.0), 1),
                                                               "lv3_r1.1_self(5,0,0)": rand_move_sample(0x1234, [5.0, 0, 0], (1.0, 0.0), 3, 1.1)}
    path = os.path.join(ROOT, "analysis", "hsmg402_player_calc.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print("wrote", path)
    print(json.dumps({k: out[k] for k in ("mash",)}, indent=1, ensure_ascii=False)[:3000])


if __name__ == "__main__":
    main()
