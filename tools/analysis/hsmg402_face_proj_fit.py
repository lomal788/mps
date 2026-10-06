"""hsmg402 상태 UI 얼굴(x_face_pc128 재질 맵 1, texCoordGen source 4 = 페인 기준 평행 투영) 식 고르기 — 원본 캡처와 오차 비교.
  F:/dev/mps/.venv/Scripts/python web/tools/analysis/hsmg402_face_proj_fit.py <원본 캡처 png(1280×720)>
후보: 투영 크기 기준(텍스처 128 px / 페인 108 px) × texSrt 배율 1.3 을 곱으로·나눔으로·안 씀. 캡처 좌상 마리오 아이콘(가운데 (71,57),
게임 영역 x 18~1262 [추정])을 64×64 로 잘라, 원 마스크(반지름 46 레이아웃 px) 안 RGB 평균 절대 오차를 ±3 px 이동 중 최소로 낸다 [참고 이미지].
결과(2026-10-06): 텍스처 128 × 1.3 = 0.101, 페인 108 × 1 = 0.169, 페인 108 × 1.3 = 0.214, 텍스처 128 × 1 = 0.253, 페인 108 / 1.3 = 0.279, 텍스처 128 / 1.3 = 0.314.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
FACE = ROOT / "web/assets/hsmg402/ui/tex/face_128_pc01_u.png"
S = 1244 / 1920
N = 64
CX, CY = 71, 57


def main(cap_path):
    cap = Image.open(cap_path).convert("RGB")
    face = np.asarray(Image.open(FACE).convert("RGBA")).astype(float) / 255

    def sample(u, v):
        x = np.clip(u * 128 - 0.5, 0, 127)
        y = np.clip(v * 128 - 0.5, 0, 127)
        x0 = np.floor(x).astype(int)
        y0 = np.floor(y).astype(int)
        x1 = np.minimum(x0 + 1, 127)
        y1 = np.minimum(y0 + 1, 127)
        fx = (x - x0)[..., None]
        fy = (y - y0)[..., None]
        return face[y0, x0] * (1 - fx) * (1 - fy) + face[y0, x1] * fx * (1 - fy) + face[y1, x0] * (1 - fx) * fy + face[y1, x1] * fx * fy

    xs = np.arange(N) - N / 2 + 0.5
    X, Y = np.meshgrid(xs, xs)
    px, py = X / S, Y / S
    crop = np.asarray(cap.crop((CX - N // 2, CY - N // 2, CX + N // 2, CY + N // 2))).astype(float) / 255
    out = []
    for name, base, s in [("텍스처 128 × 1.3", 128, 1.3), ("텍스처 128 / 1.3", 128, 1 / 1.3), ("페인 108 × 1.3", 108, 1.3),
                          ("페인 108 / 1.3", 108, 1 / 1.3), ("텍스처 128 × 1", 128, 1.0), ("페인 108 × 1", 108, 1.0)]:
        f = sample(px / base * s + 0.5, py / base * s + 0.5)
        m = np.hypot(px, py) < 46
        best = 9.0
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                c = crop[max(0, dy):N + min(0, dy), max(0, dx):N + min(0, dx)]
                ff = f[max(0, -dy):N - max(0, dy), max(0, -dx):N - max(0, dx)]
                mm = m[max(0, -dy):N - max(0, dy), max(0, -dx):N - max(0, dx)]
                rgb = ff[..., :3] * ff[..., 3:4]
                best = min(best, float(np.mean(np.abs(rgb[mm] - c[mm]))))
        out.append((best, name))
    for e, name in sorted(out):
        print(f"{name}: {e:.3f}")


if __name__ == "__main__":
    main(sys.argv[1])
