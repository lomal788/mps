"""bex::Fiber::Sleep 재개 프레임 수와 f32 시간 누적 재구현 계산.

원본 판독(main): Fiber 틱(impl vt+0x10 @0x710012f9bc)
  sleep = impl+0x44
  if sleep > 0: sleep = max(sleep + f32(-1/60) [0xBC888889], 0); return      # 이번 틱은 재개 안 함
  if sleep < 0: return                                                        # 영원히
  sleep == 0: SwitchToFiber (재개)
Sleep(t) = impl+0x44 = t 후 양보. Change() = sleep 그대로(0) 양보 → 다음 틱 재개.

  .venv/Scripts/python web/tools/analysis/core_fiber_sleep.py  → analysis/core/fiber_sleep.json
"""
import json, os
import numpy as np

f32 = np.float32
STEP = np.frombuffer(np.uint32(0xBC888889).tobytes(), dtype=np.float32)[0]   # -1/60
DT = np.frombuffer(np.uint32(0x3C888889).tobytes(), dtype=np.float32)[0]     # +1/60 (GetDeltaTime Fixed60)


def sleep_frames(t):
    """Sleep(t) 를 부른 틱을 0으로 두고, 재개되는 틱 번호."""
    s = f32(t)
    if s < 0:
        return None
    n = 0
    while True:
        n += 1
        if s > 0:
            s = max(f32(s + STEP), f32(0.0))
            continue
        return n


def accumulate_until(limit):
    """acc += GetDeltaTime 를 매 프레임 하고 acc > limit 이 처음 참이 되는 호출 횟수."""
    acc = f32(0.0); n = 0
    while True:
        acc = f32(acc + DT); n += 1
        if acc > f32(limit):
            return n, float(acc)


def main():
    out = {"step_bits": "0xBC888889", "dt_bits": "0x3C888889", "sleep": {}, "accumulate": {}}
    for t in [0.0, 1 / 60, 2 / 60, 0.083333336, 0.33333397, 0.5, 1.0, 3.0]:
        out["sleep"][repr(float(f32(t)))] = sleep_frames(t)
    for lim in [1.0, 3.0]:
        out["accumulate"][str(lim)] = accumulate_until(lim)
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    p = os.path.join(root, "analysis", "core", "fiber_sleep.json")
    json.dump(out, open(p, "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
