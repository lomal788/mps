"""hsmg402 데굴데굴 눈덩이 — 흐름·눈덩이·판정 식 재구현 계산 (원본 실행 아님).

판독 근거(hsmg402.nro, 베이스 0x7100000000):
  SnowBall::UpdateHandTransform @0x71000110a4   손에 든 공의 성장(레벨·스케일)·위치·낙하 전환
  SnowBall::UpdatePosition      @0x7100010cdc   공 위치 = 손 + dirZ*r, y = r (r = 1.1*scale)
  SnowBall::UpdateShotTransform @0x7100011e2c   굴러가는 공 가속·최고속·중력·삭제(y<-11)
  SnowBall::HitMessage          @0x7100013eb4   공끼리: (자기 level-2 <= 상대 level) 이면 자기 Crash
  SnowBall::EventCrash/PlayFallSe               소리 크기 변수 (r-0.44)/0.66*127
  GameMgr::Update               @0x7100001fac   탈락(y<=-1)·순위·종료
  GameMgr::Result               @0x7100002720   결과 단계(3단계에서 2.0초 누적)
  GameMgr::EntryPlayer          @0x7100000c3c   시작 위치 = pos_op 뼈 cha_pos0N (y=1.0), 방향(도)
main:
  hs::mg::Util::ResultRank(int*,float*,int,bool) @0x710010b908
  bex::ut::TimeCounter::Tick @0x7100371664, hs::UITimer::IsEndTimer/RemainSecond @0x71000d79ec/0x71000d7a20
  bex::ut::IsNearlyZero/IsNearlyEqual @0x7100371020/0x7100371040 (eps 0x34000000)

가정(판독 밖): GetDeltaTime 과 엔진 델타(engine+0x18) 가 모두 f32(1/60)=0x3C888889 (web/docs/engine/01_core.md §4).
지면 충돌(CastShape/CastRay) 결과는 엔진 내부라 재현하지 않는다. 굴러가는 공은 XZ 이동과 '지면 없음' 자유낙하만 계산한다.

  .venv/Scripts/python web/tools/analysis/hsmg402_calc.py   → analysis/hsmg402_calc.json
"""
import json
import math
import os

import numpy as np

f32 = np.float32


def bits(u):
    return np.frombuffer(np.uint32(u).tobytes(), dtype=np.float32)[0]


def hx(x):
    return "0x%08x" % np.frombuffer(f32(x).tobytes(), dtype=np.uint32)[0]


DT = bits(0x3C888889)                       # GetDeltaTime (고정 60)
SIZE_SCALE = [f32(v) for v in (0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)]   # @0x71000308ec
MAX_LEVEL = 7                               # @0x71000308e0
MAX_SIZE = f32(1.1)                         # @0x71000308e4 (반지름 = MAX_SIZE*scale)
SIZE_CHANGE_TIME = f32(1.0)                 # @0x71000308e8
MIN_SIZE = f32(0.44)                        # @0x710003090c (0x3ee147af)
MAX_MOVE_SPEED = f32(0.1)                   # @0x7100030910
DOWN_SPEED = bits(0xBF7AE148)               # -0.98 @0x7100030914
DELETE_LIMIT_Y = f32(-11.0)                 # @0x7100030918
SPEED_SQ_LIMIT = bits(0x3C23D70B)           # 즉시값 = f32(0.1f*0.1f)
GAME_TIME = f32(60.0)                       # GameMgr::GameTime @0x7100030668
EPS = bits(0x34000000)                      # 1.1920929e-07


# ---------- AArch64 frsqrte / frsqrts (FEAT_RPRES 없음) ----------
def _recip_sqrt_estimate(a):
    if a < 256:
        a = a * 2 + 1
    else:
        a = (a >> 1) << 1
        a = (a + 1) * 2
    b = 512
    while a * (b + 1) * (b + 1) < (1 << 28):
        b += 1
    return (b + 1) // 2


def frsqrte(x):
    x = f32(x)
    u = int(np.frombuffer(x.tobytes(), dtype=np.uint32)[0])
    if x == 0:
        return f32(np.inf)
    if x < 0 or np.isnan(x):
        return f32(np.nan)
    if np.isinf(x):
        return f32(0.0)
    exp = (u >> 23) & 0xFF
    frac = u & 0x7FFFFF
    if exp == 0:                               # 비정규수 정규화
        while not (frac & 0x400000):
            frac <<= 1
            exp -= 1
        frac = (frac << 1) & 0x7FFFFF
    frac64 = frac << 29                        # fraction<51:0>
    if exp & 1 == 0:
        scaled = (1 << 8) | (frac64 >> 44)
    else:
        scaled = (1 << 7) | (frac64 >> 45)
    est = _recip_sqrt_estimate(scaled)
    rexp = (380 - exp) // 2
    r = ((rexp & 0xFF) << 23) | ((est & 0xFF) << 15)
    return bits(r)


def frsqrts(a, b):
    """(3 - a*b)/2, 한 번만 반올림(fused)."""
    p = float(np.float64(a) * np.float64(b))
    return f32((3.0 - p) / 2.0)


def neon_inv_len(sq):
    """원본 정규화 순서: e=frsqrte(sq); t=e*sq; e*=frsqrts(e,t); t=sq*e; e*=frsqrts(e,t)."""
    e = frsqrte(sq)
    t = f32(e * sq)
    e = f32(e * frsqrts(e, t))
    t = f32(sq * e)
    e = f32(e * frsqrts(e, t))
    return e


def lane_sq(v):
    """fmul v,v → ext #8 → fadd .2s → faddp : (x²+z²)+(y²+w²)."""
    s = [f32(c * c) for c in v]
    return f32(f32(s[0] + s[2]) + f32(s[1] + s[3]))


def neon_normalize(v):
    sq = lane_sq(v)
    if sq == 0:
        return [f32(0)] * 4
    k = neon_inv_len(sq)
    return [f32(c * k) for c in v]


# ---------- 1. 시간·타이머 ----------
def timecounter_frames(t, d=DT):
    """TimeCounter::Set(t) 후 Tick() 이 처음 참이 되는 호출 번호와 그때까지의 남은 값 기록."""
    v = f32(t)
    n = 0
    while True:
        n += 1
        if v <= 0:
            return n
        v = f32(v - d)
        if not v > 0:
            return n


def guide_out_frame():
    """GameMgr::Update: !guide.out && 10.0 <= 60 - RemainSecond 이면 guide.Out().
    타이머 Tick 이 같은 프레임에서 GameMgr::Update 보다 먼저라고 가정한 k(감소 횟수) 값."""
    v = f32(60.0)
    k = 0
    while True:
        k += 1
        v = f32(v - DT)
        if f32(GAME_TIME - v) >= f32(10.0):
            return {"ticks": k, "remain": float(v), "elapsed": float(f32(GAME_TIME - v))}


def accumulate_until(limit):
    acc = f32(0.0)
    n = 0
    while True:
        acc = f32(DT + acc)                    # Result case3: fadd s0(dt), s1(acc)
        n += 1
        if acc > f32(limit):
            return {"frames": n, "acc": float(acc)}


# ---------- 2. 손에 든 공의 성장 ----------
def grow_while_moving(frames=500):
    """플레이어가 매 프레임 움직인다(위치 변화 >= 1.19e-7)고 볼 때의 level/scale/timer.
    @0x710001158c~0x7100011858: timer -= dt; level<=6 이면 scale = (S[l+1]-S[l])*dt + scale;
    timer<=0 이면 level++, scale = S[level], 충돌구 재생성(r=1.1*S), timer = 1.0."""
    level, scale, timer = 0, SIZE_SCALE[0], SIZE_CHANGE_TIME
    ups = []
    trace = []
    for n in range(1, frames + 1):
        timer = f32(timer - DT)
        if level <= 6:
            scale = f32(f32(f32(SIZE_SCALE[level + 1] - SIZE_SCALE[level]) * DT) + scale)
            if level <= 6 and not timer > 0:
                level += 1
                scale = SIZE_SCALE[level]
                timer = f32(1.0)
                ups.append({"frame": n, "level": level, "scale": float(scale),
                            "radius": float(f32(MAX_SIZE * scale))})
        if n in (1, 30, 59, 60, 61, 120, 420, 421):
            trace.append({"frame": n, "level": level, "scale": float(scale), "scale_bits": hx(scale),
                          "timer": float(timer)})
    return {"level_ups": ups, "trace": trace}


def ball_position(player_pos, dir_z, scale):
    """SnowHandPos::UpdatePos: hand = dirZ*0.5 + playerPos (fmul 후 fadd).
    SnowBall::UpdatePosition: r = 1.1*scale; p = hand + (dz.x,0,dz.z,dz.w)*r; p.y = r."""
    hand = [f32(f32(d * f32(0.5)) + p) for d, p in zip(dir_z, player_pos)]
    r = f32(MAX_SIZE * scale)
    dz = [dir_z[0], f32(0), dir_z[2], dir_z[3]]
    p = [f32(h + f32(c * r)) for h, c in zip(hand, dz)]
    p[1] = r
    return {"hand": [float(c) for c in hand[:3]], "ball": [float(c) for c in p[:3]], "radius": float(r)}


# ---------- 3. 굴러가는 공 ----------
def shot_xz(d0, frames=12):
    """Shot(d0): +0x104=1, vel=0. 매 프레임: vel += d0*dt; |vel|²>=0.010000001 이면
    d0 = normalize(d0), vel = d0*0.1, 가속 끝. 위치 += vel (지면 처리 제외, XZ)."""
    d = [f32(c) for c in d0]
    vel = [f32(0)] * 4
    acc = True
    pos = [f32(0)] * 4
    out = []
    for n in range(1, frames + 1):
        if acc:
            vel = [f32(v + f32(c * DT)) for v, c in zip(vel, d)]
            if lane_sq(vel) >= SPEED_SQ_LIMIT:
                acc = False
                d = neon_normalize(d)
                vel = [f32(c * MAX_MOVE_SPEED) for c in d]
        pos = [f32(p + v) for p, v in zip(pos, vel)]
        out.append({"frame": n, "accelerating": acc, "vel": [float(c) for c in vel[:3]],
                    "pos": [float(c) for c in pos[:3]], "speed": float(math.sqrt(float(lane_sq(vel))))})
    return out


def free_fall(y0, fy0=0.0, vy=0.0, limit=DELETE_LIMIT_Y, max_frames=2000):
    """CastShape 실패 프레임: pos = pos + vel + (이전 낙하벡터), 낙하.y = 낙하.y + dt*(-0.98).
    y < -11 (DELETE_LIMIT_Y) 이면 state=-1 → 다음 GameMgr::Update 에서 삭제."""
    y, fy = f32(y0), f32(fy0)
    for n in range(1, max_frames + 1):
        new_fy = f32(fy + f32(DT * DOWN_SPEED))
        y = f32(f32(y + f32(vy)) + fy)
        fy = new_fy
        if y < limit:
            return {"frames": n, "y": float(y), "fall_vy": float(fy)}
    return None


# ---------- 4. 충돌 규칙 ----------
def ball_vs_ball():
    """HitMessage: 받은 공 A 는 (A.level - 2 <= B.level) 이면 Crash. 양쪽이 서로 메시지를 받는다."""
    m = {}
    for a in range(8):
        for b in range(8):
            m[f"{a}v{b}"] = {"A_crash": a - 2 <= b, "B_crash": b - 2 <= a}
    return m


def size_sound_param(scale):
    """(r - 0.44000003) 가 IsNearlyZero 면 0; /0.65999997 가 IsNearlyZero 면 0;
    IsNearlyEqual(x,1.1) 이거나 비율>1 이면 127, 아니면 int(비율*127)."""
    r = f32(MAX_SIZE * f32(scale))
    x = f32(r + bits(0xBEE147AF))
    if abs(x) < EPS:
        x = f32(0)
    q = f32(x / bits(0x3F28F5C2))
    if abs(q) < EPS:
        q = f32(0)
    if abs(f32(x - MAX_SIZE)) < EPS or q > 1.0:
        return 127
    return int(f32(q * f32(127.0)))


# ---------- 5. 순위·종료 ----------
def result_rank(vals, n=4, desc=True):
    """hs::mg::Util::ResultRank(int*,float*,int,bool) @0x710010b908. N=GetPlayerNum.
    모두 0.0 이면 전원 N-1. desc: r = N-1 - #{j≠i : !(v[i] < v[j])} (동점은 좋은 쪽)."""
    v = [f32(x) for x in vals]
    if all(x == 0.0 for x in v):
        return [n - 1] * n
    out = []
    for i in range(n):
        r = n - 1
        for j in range(n):
            if i == j:
                continue
            if desc:
                if not (v[i] < v[j]):
                    r -= 1
            else:
                if not (v[i] > v[j]):
                    r -= 1
        out.append(r)
    return out


FLT_MAX = bits(0x7F7FFFFF)


class Game:
    """GameMgr::Update 의 탈락·순위·종료 부분만. players: id 0..3 (리스트 순서 = id, Start 의 정렬 결과)."""

    def __init__(self, coms=(False, True, True, True)):
        self.t = [f32(0)] * 4          # Player+0xe4c
        self.rank = [None] * 4         # Player+0xe58 (EntryPlayerRank 값)
        self.alive_y = [0.0] * 4
        self.coms = coms
        self.com_boost = False
        self.done = False
        self.end_reason = None

    def update(self, ys, remain, timer_end=False):
        if self.done:
            return False
        if timer_end:
            arr = [x if x != 0 else FLT_MAX for x in self.t]
            self.rank = result_rank(arr)
            self.done, self.end_reason = True, "timer"
            return True
        fallen, alive = [], 0
        elapsed = f32(GAME_TIME - f32(remain))
        for i in range(4):
            if self.t[i] <= 0:
                if ys[i] > -1.0:
                    alive += 1
                else:
                    self.t[i] = elapsed
                    fallen.append(i)
        if fallen:
            if all(self.t[k] == self.t[k + 1] for k in range(3)):
                self.t = [f32(0)] * 4
                arr = list(self.t)
            else:
                arr = [x if x != 0 else FLT_MAX for x in self.t]
            r = result_rank(arr)
            for i in fallen:
                self.rank[i] = r[i]
        if alive > 1:
            humans = [i for i in range(4) if not self.coms[i]]
            if humans and all(self.t[i] > 0 for i in humans):
                self.com_boost = True          # SetComLevel(3) 전원
            return False
        if len(fallen) < 4:
            for i in range(4):
                if self.t[i] <= 0:
                    self.rank[i] = 0
        self.done, self.end_reason = True, "survivors<=1"
        return True


def scenario(events, timer_frames):
    """events: {frame: [player ids that reach y<=-1 that frame]}. 매 프레임 remain 은 Tick 후 값을 쓴다고 가정."""
    g = Game()
    ys = [0.0] * 4
    v = f32(60.0)
    for n in range(1, timer_frames + 2):
        v = f32(v - DT) if v > 0 else v
        end = not v > 0
        for p in events.get(n, []):
            ys[p] = -1.5
        if g.update(ys, max(v, f32(0)), timer_end=end):
            return {"end_frame": n, "reason": g.end_reason, "fall_time": [float(x) for x in g.t],
                    "rank": g.rank, "com_boost": g.com_boost,
                    "result_path": "draw(telop type6)" if all(r == 3 for r in g.rank) else
                    "winners=%s" % [i for i in range(4) if g.rank[i] == 0]}
    return None


# ---------- 6. 시작 위치 ----------
def start_pose():
    """pos_op.fmdb 뼈 cha_pos0N (데이터: graphics_bfres2gltf dump), 위치 y 는 1.0 으로 덮어씀.
    방향(도) = 쿼터니언 → yaw(rad) * 57.29578 (0x42652EE1). nn::util atan 다항식 대신 math.atan2 근사."""
    bones = {0: (-4.5, -4.5, 0.7853982), 1: (4.5, -4.5, -0.7853982), 2: (-4.5, 4.5, 2.3561945), 3: (4.5, 4.5, 3.9269907)}
    out = {}
    for k, (x, z, ry) in bones.items():
        yaw = math.atan2(math.sin(ry), math.cos(ry))
        out[f"cha_pos0{k}"] = {"pos": [x, 1.0, z], "yaw_deg": float(f32(f32(yaw) * bits(0x42652EE1)))}
    return out


def main():
    out = {"note": "재구현 계산. 원본 실행 대조 없음. dt=f32(1/60) 가정.",
           "dt_bits": hx(DT)}
    tf = timecounter_frames(60.0)
    out["timer_60s_tick_true_at"] = tf
    out["guide_out"] = guide_out_frame()
    out["result_state3_over_2s"] = accumulate_until(2.0)
    out["growth"] = grow_while_moving()
    out["ball_pos_examples"] = {
        "lv0_face+Z": ball_position([f32(0), f32(0), f32(0), f32(0)], [f32(0), f32(0), f32(1), f32(0)], SIZE_SCALE[0]),
        "lv7_face+X": ball_position([f32(1), f32(0), f32(2), f32(0)], [f32(1), f32(0), f32(0), f32(0)], SIZE_SCALE[7]),
    }
    s, c = f32(math.sin(math.radians(30))), f32(math.cos(math.radians(30)))
    out["shot_throw_unit_dirZ_+Z"] = shot_xz([f32(0), f32(0), f32(1), f32(0)])
    out["shot_throw_unit_dir_30deg"] = shot_xz([s, f32(0), c, f32(0)])
    out["edge_fall_dir_x1.1"] = shot_xz([f32(1.1), f32(0), f32(0), f32(0)])
    out["free_fall_to_delete"] = {f"lv{l}": free_fall(f32(MAX_SIZE * SIZE_SCALE[l])) for l in (0, 3, 7)}
    out["ball_vs_ball"] = ball_vs_ball()
    out["size_sound_param"] = {f"lv{l}": size_sound_param(SIZE_SCALE[l]) for l in range(8)}
    out["frsqrte_check"] = {"x=1.0": float(frsqrte(1.0)), "x=0.25": float(frsqrte(0.25)),
                            "inv_len(1.21)": float(neon_inv_len(f32(1.21))), "1/1.1": float(f32(1 / 1.1))}
    out["rank_examples"] = {
        "[10,20,20,MAX]": result_rank([10, 20, 20, FLT_MAX]),
        "[5,5,3,MAX]": result_rank([5, 5, 3, FLT_MAX]),
        "all0": result_rank([0, 0, 0, 0]),
        "[MAX,MAX,12,MAX]": result_rank([FLT_MAX, FLT_MAX, 12, FLT_MAX]),
    }
    T = tf
    out["scenarios"] = {
        "one_by_one": scenario({600: [1], 1200: [2], 1800: [3]}, T),
        "two_same_frame_then_last": scenario({600: [1, 2], 900: [3]}, T),
        "last_three_same_frame": scenario({600: [0], 900: [1, 2, 3]}, T),
        "all_four_same_frame": scenario({600: [0, 1, 2, 3]}, T),
        "time_up_two_survivors": scenario({600: [1], 1200: [2]}, T),
        "human_out_com_boost": scenario({300: [0], 1500: [1], 2000: [2]}, T),
    }
    out["start_pose"] = start_pose()
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    p = os.path.join(root, "analysis", "hsmg402_calc.json")
    json.dump(out, open(p, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps({k: out[k] for k in ("timer_60s_tick_true_at", "guide_out", "result_state3_over_2s",
                                           "free_fall_to_delete", "size_sound_param", "rank_examples",
                                           "scenarios", "start_pose", "frsqrte_check")}, indent=1, ensure_ascii=False))
    print("growth level-ups:", out["growth"]["level_ups"])
    for k in ("shot_throw_unit_dirZ_+Z", "edge_fall_dir_x1.1"):
        print(k, [(r["frame"], r["accelerating"], round(r["speed"], 7), [round(c, 7) for c in r["pos"]]) for r in out[k][:8]])


if __name__ == "__main__":
    main()
