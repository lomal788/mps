"""hsmg402 조명·후처리 재구현 계산 — web/docs/engine/07_camera_lighting.md 10절의 숫자를 다시 만든다.
  F:/dev/mps/.venv/Scripts/python web/tools/analysis/light_calc.py   → analysis/light_calc.json
"""
import json, math, re, struct
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
TEX = ROOT / "extracted/converted/hsmg402/graphics/tex"
NDR = ROOT / "extracted/bea/system_boot_bnsh.nx.bea/system_boot/kernel/shader/ndrender"
FPS = ROOT / "extracted/bea/system_boot.nx.bea/system_boot/kernel/shader/ndrender"
ENV = json.loads((ROOT / "web/assets/hsmg402/manifest.json").read_text(encoding="utf-8"))["env"]


def light_toward(rx, ry):
    ax, ay = math.radians(rx), math.radians(ry)
    return np.array([-math.cos(ax) * math.sin(ay), math.sin(ax), -math.cos(ax) * math.cos(ay)])


def read_hdr(p):
    d = p.read_bytes()
    rest = d[d.find(b"\n\n") + 2:]
    j = rest.find(b"\n")
    h, w = int(rest[:j].split()[1]), int(rest[:j].split()[3])
    a = np.frombuffer(rest[j + 1:], dtype=np.uint8)
    out = np.zeros((h, w, 4))
    if len(a) == w * h * 4:
        out = a.reshape(h, w, 4).astype(float)
    else:
        pos = 0
        for y in range(h):
            pos += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = a[pos]; pos += 1
                    if n > 128:
                        n -= 128; out[y, x:x + n, c] = a[pos]; pos += 1
                    else:
                        out[y, x:x + n, c] = a[pos:pos + n]; pos += n
                    x += n
    e = out[..., 3]
    return out[..., :3] * np.where(e > 0, np.ldexp(1.0, (e - 136).astype(int)), 0)[..., None]


def face_dir(fi, x, y, n):
    s, t = (x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1
    d = {0: (1, -t, -s), 1: (-1, -t, s), 2: (s, 1, t), 3: (s, -1, -t), 4: (s, -t, 1), 5: (-s, -t, -1)}[fi]
    d = np.array(d, float)
    return d / np.linalg.norm(d)


def tone5(x):
    num = x * (x * (x * (3.835061073 * x - 0.7351529002) + 0.1352372020) + 0.03166370839)
    den = x * (x * (x * (3.921293020 * x - 1.517683983) + 1.862025976) - 0.3955189884) + 0.07032027096
    return min(max(num / den, 0.0), 1.0)


def bnsh_variants(path, idx=0):
    d = path.read_bytes()
    b = d[[m.start() for m in re.finditer(b"BNSH", d)][idx]:]
    n = struct.unpack_from("<I", b, 0x7C)[0]
    out = []
    for k in range(n):
        prog = struct.unpack_from("<Q", b, 0xC0 + k * 0x40 + 0x10)[0]
        si = struct.unpack_from("<Q", b, prog + 0x28)[0]
        pa, pc = struct.unpack_from("<QI", b, si + 0x10)
        out.append(b[pa + 0x80: pa + pc])
    return out


def has_f32(blob, v):
    w = struct.pack("<f", v)
    return any(blob[i:i + 4] == w for i in range(0, len(blob) - 3, 4))


def main():
    r = {}
    L = light_toward(*ENV["light"]["lightRotation"])
    lp = np.array(ENV["light"]["lightPosition"], float)
    up = np.array([0, L[2], -L[1]]); up /= np.linalg.norm(up)
    r["light"] = {"toward": L.round(6).tolist(), "lightPositionDir": (lp / np.linalg.norm(lp)).round(6).tolist(),
                  "angleToPositionDeg": round(math.degrees(math.acos(float(L @ lp) / np.linalg.norm(lp))), 3),
                  "shadowUp": up.round(6).tolist(), "shadowRight": np.cross(up, L).round(6).tolist()}
    faces = [read_hdr(TEX / f"hsmg402_rad_{i:02d}.hdr") for i in range(6)]
    fi = int(np.argmax([f.sum(-1).max() for f in faces]))
    y, x = np.unravel_index(np.argmax(faces[fi].sum(-1)), faces[fi].shape[:2])
    sun = face_dir(fi, x, y, faces[fi].shape[0]) * [1, 1, -1]
    r["iblSun"] = {"face": fi, "px": [int(x), int(y)], "worldDirZFlip": sun.round(4).tolist(),
                   "angleToLightDeg": round(math.degrees(math.acos(float(sun @ L))), 3),
                   "angleWithoutFlipDeg": round(math.degrees(math.acos(float((sun * [1, 1, -1]) @ L))), 3)}
    s, e, k = ENV["fog"]["fog_param"]
    r["fog"] = {"near": e - (e - s) / k, "far": e,
                "amount": {d: round(1 - min(max(k * (e - d) / (e - s), 0), 1), 5) for d in (10, 29.915, 60, 100, 200, 500, 1000)}}
    r["tone5"] = {x: round(tone5(x), 5) for x in (0, 0.05, 0.18, 0.5, 1, 2, 4, 8, 1000)}
    from PIL import Image
    im = Image.open(TEX / "hsmg402_lut.png").convert("RGB")
    px = im.load()
    r["lut"] = {"size": list(im.size), "rAxis": [px[i, 0][0] for i in range(16)], "gAxis": [px[0, i][1] for i in range(16)],
                "bAxis": [px[i * 16, 0][2] for i in range(16)]}
    am = bnsh_variants(NDR / "posteffect_amalgam0.bnsh")
    p = ENV["post"]
    U = 1 + p["lut_filter_enable"] + 3 * 0
    idx = 189 * U + 27 * (p["tonemap_type"] + 1) + (18 if (p["bloom_filter_type"] & ~1) == 2 else 9)
    sig = {"T%d" % t: [v for v in (2.51, 0.22, 0.468, 3.921293, 0.0333) if has_f32(am[27 * t], v)] for t in range(7)}
    r["amalgam"] = {"variants": len(am), "combineIndex": idx, "combineHasTone5Pool": has_f32(am[idx], 3.921293), "poolByT": sig}
    cnt = {}
    for f in ("forward_plus_simple.bfsha", "forward_plus_custom.bfsha", "forward_plus_char.bfsha", "forward_plus.bfsha"):
        d = (FPS / f).read_bytes()
        q0 = np.frombuffer(d[:len(d) // 8 * 8], dtype="<u8")
        q4 = np.frombuffer(d[4:4 + (len(d) - 4) // 8 * 8], dtype="<u8")
        w = struct.unpack("<I", struct.pack("<f", 1 / math.pi))[0]
        a = np.frombuffer(d[:len(d) // 4 * 4], dtype="<u4")
        cnt[f] = {"aligned": int((a == w).sum()),
                  "imm32": int(sum((((q >> np.uint64(20)) & np.uint64(0xFFFFFFFF)) == w).sum() for q in (q0, q4))),
                  "imm20": int(sum((((q >> np.uint64(20)) & np.uint64(0x7FFFF)) == ((w >> 12) & 0x7FFFF)).sum() for q in (q0, q4)))}
    r["invPiCount"] = cnt
    (ROOT / "analysis/light_calc.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(r, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
