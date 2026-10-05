"""PhysX 4.1.2 바이너리 직렬화 컬렉션(.apx, 매직 SEBD, 플랫폼 NX64) 읽기.

PhysX 소스(tools/oss/PhysX-4.1, SnBinarySerialization.cpp)의 쓰기 순서를 그대로 거꾸로 읽는다.
  헤더 0x30: SEBD, u32 PX_PHYSICS_VERSION(0x04010200), char[32] PX_BINARY_SERIAL_VERSION, char[4] 플랫폼, u32 markedPadding
  align16 -> u32 객체 수 -> align16 -> u32 manifest 수, {u32 offset, u16 PxConcreteType, u16 pad}[], u32 객체 버퍼 크기
  align16 -> u32 import 수, {u64 id, u16 type, pad}[] (16 B)
  align16 -> u32 export 수, {u64 id, u32 objIndex, u32 pad}[] (16 B)
  align16 -> u32 내부 포인터 참조 수, {u64 ref, u32 objIndex, u32 pad}[] (16 B), u32 handle16 수, {u16, u16, u32}[] (8 B)
  align16 -> 객체 버퍼(manifest offset 기준) -> 객체마다 align16 후 exportExtraData
markedPadding=1 이면 패딩이 0xCD / 0x42, 포인터 자리는 0x12345678 표지값이다(NULL 은 0).

삼각 메시(BVH33=3, BVH34=4) 객체 필드(NX64 = LP64, 실측):
  +0x08 u16 concreteType, +0x0A u16 baseFlags, +0x18 i32 refCount, +0x1C u32 nbVertices, +0x20 u32 nbTriangles,
  +0x28 ptr vertices, +0x30 ptr triangles, +0x38 f32[6] AABB(center, extents), +0x50 ptr extraTrigData,
  +0x58 f32 geomEpsilon, +0x5C u8 flags(bit1 = 16비트 인덱스), +0x60 ptr materialIndices, +0x68 ptr faceRemap, +0x70 ptr adjacencies
BVH33 은 RTree 페이지(align128, 112 B x mTotalPages(@+0xF0))가 먼저 오고, 이어서 Gu::TriangleMesh::exportExtraData: vertices(f32x3 x nV) / triangles(u16|u32 x3 x nT) / extraTrigData(u8 x nT)
  / materialIndices(u16 x nT) / faceRemap(u32 x nT) / adjacencies(u32 x3 x nT), 각 항목 앞 align16.
첫 객체가 삼각 메시인 경우만 추가 데이터 시작을 확정할 수 있다(앞 객체의 추가 데이터 크기를 모르면 위치를 못 구한다).

사용: python web/tools/analysis/scene_apx.py <apx...>             요약 출력
      python web/tools/analysis/scene_apx.py --all                전체 통계 + 삼각 메시 OBJ 덤프(extracted/converted/scene/apx/)
      python web/tools/analysis/scene_apx.py <apx> --obj out.obj  첫 삼각 메시를 OBJ로
"""
import argparse
import json
import struct
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "extracted/converted/scene/apx"
TYPES = {0: "UNDEFINED", 1: "HEIGHTFIELD", 2: "CONVEX_MESH", 3: "TRIANGLE_MESH_BVH33", 4: "TRIANGLE_MESH_BVH34",
         5: "RIGID_DYNAMIC", 6: "RIGID_STATIC", 7: "SHAPE", 8: "MATERIAL", 9: "CONSTRAINT", 10: "AGGREGATE",
         11: "ARTICULATION", 12: "ARTICULATION_REDUCED_COORDINATE", 13: "ARTICULATION_LINK",
         14: "ARTICULATION_JOINT", 15: "ARTICULATION_JOINT_REDUCED_COORDINATE", 16: "PRUNING_STRUCTURE",
         17: "BVH_STRUCTURE"}


def a16(o):
    return (o + 15) & ~15


def tname(t):
    return TYPES.get(t, "USER_%d" % t if t >= 1024 else "EXT_%d" % t)


class Apx:
    def __init__(self, b):
        if b[:4] != b"SEBD":
            raise ValueError("not SEBD")
        self.b = b
        self.version = struct.unpack_from("<I", b, 4)[0]
        if self.version >> 24 == 3:
            # [mps] PhysX 3.4 헤더 0x18: SEBD, u32 version(0x03040000), u32 binaryVersion, u32 buildNumber, char[4] 플랫폼, u32 markedPadding
            bv, bn = struct.unpack_from("<II", b, 8)
            self.build = "binVer=%d build=%d" % (bv, bn)
            self.platform = b[16:20].decode("ascii")
            self.marked = struct.unpack_from("<I", b, 20)[0]
            o = a16(24)
        else:
            self.build = b[8:40].decode("ascii")
            self.platform = b[40:44].decode("ascii")
            self.marked = struct.unpack_from("<I", b, 44)[0]
            o = a16(48)
        self.nb_objects = self.u32(o)
        o = a16(o + 4)
        n = self.u32(o)
        o += 4
        self.manifest = [struct.unpack_from("<IH", b, o + 8 * i) for i in range(n)]
        o += 8 * n
        self.obj_buffer_size = self.u32(o)
        o = a16(o + 4)
        n = self.u32(o)
        self.imports = [struct.unpack_from("<QH", b, o + 4 + 16 * i) for i in range(n)]
        o = a16(o + 4 + 16 * n)
        n = self.u32(o)
        self.exports = [struct.unpack_from("<QI", b, o + 4 + 16 * i) for i in range(n)]
        o = a16(o + 4 + 16 * n)
        n = self.u32(o)
        self.int_ptr = [struct.unpack_from("<QI", b, o + 4 + 16 * i) for i in range(n)]
        o = o + 4 + 16 * n
        n = self.u32(o)
        self.int_h16 = [struct.unpack_from("<HHI", b, o + 4 + 8 * i) for i in range(n)]
        o = a16(o + 4 + 8 * n)
        self.obj_base = o
        self.extra_base = a16(o + self.obj_buffer_size)

    def u32(self, o):
        return struct.unpack_from("<I", self.b, o)[0]

    def u64(self, o):
        return struct.unpack_from("<Q", self.b, o)[0]

    def obj(self, i):
        return self.obj_base + self.manifest[i][0]

    def triangle_mesh(self, i, extra):
        o = self.obj(i)
        b = self.b
        nv, nt = struct.unpack_from("<II", b, o + 0x1C)
        flags = b[o + 0x5C]
        has = {k: self.u64(o + off) != 0 for k, off in
               (("vertices", 0x28), ("triangles", 0x30), ("extra", 0x50), ("material", 0x60), ("remap", 0x68), ("adj", 0x70))}
        m = {"index": i, "type": tname(self.manifest[i][1]), "nbVertices": nv, "nbTriangles": nt, "flags": flags,
             "aabb": [round(x, 5) for x in struct.unpack_from("<6f", b, o + 0x38)],
             "geomEpsilon": struct.unpack_from("<f", b, o + 0x58)[0], "present": has}
        e = extra
        if self.manifest[i][1] == 3:
            # RTreeTriangleMesh: mRTree @+0xA0 (mTotalPages @+0xF0), RTree::exportExtraData 가 먼저 쓴다(align128, RTreePage 112 B)
            pages = self.u32(o + 0xF0)
            m["rtreePages"] = pages
            e = ((e + 127) & ~127) + 112 * pages
        else:
            m["bv4"] = "BV4 노드 크기 미확정"
            return m
        if has["vertices"]:
            e = a16(e)
            m["vertices"] = [struct.unpack_from("<3f", b, e + 12 * k) for k in range(nv)]
            e += 12 * nv
        if has["triangles"]:
            e = a16(e)
            if flags & 2:
                idx = struct.unpack_from("<%dH" % (3 * nt), b, e)
                e += 6 * nt
            else:
                idx = struct.unpack_from("<%dI" % (3 * nt), b, e)
                e += 12 * nt
            m["triangles"] = [idx[3 * k:3 * k + 3] for k in range(nt)]
        if has["extra"]:
            e = a16(e)
            m["extraTrigData"] = list(b[e:e + nt])
            e += nt
        if has["material"]:
            e = a16(e)
            m["materialIndices"] = list(struct.unpack_from("<%dH" % nt, b, e))
            e += 2 * nt
        if has["remap"]:
            e = a16(e) + 4 * nt
        if has["adj"]:
            e = a16(e) + 12 * nt
        m["extra_end"] = e
        return m

    def summary(self):
        return {"version": hex(self.version), "build": self.build, "platform": self.platform, "marked": self.marked,
                "objects": [tname(t) for _, t in self.manifest], "exports": self.exports, "imports": self.imports}


def mesh_check(m):
    nv = m["nbVertices"]
    ok_idx = all(0 <= v < nv for t in m.get("triangles", []) for v in t)
    vs = m.get("vertices", [])
    if not vs:
        return ok_idx, False
    c, ext = m["aabb"][:3], m["aabb"][3:]
    inside = all(abs(v[k] - c[k]) <= ext[k] + 1e-3 + abs(ext[k]) * 1e-4 for v in vs for k in range(3))
    return ok_idx, inside


def write_obj(path, meshes):
    with open(path, "w", encoding="utf-8") as f:
        base = 1
        for m in meshes:
            f.write("o mesh%d\n" % m["index"])
            for v in m["vertices"]:
                f.write("v %.6f %.6f %.6f\n" % v)
            for t in m["triangles"]:
                f.write("f %d %d %d\n" % (t[0] + base, t[1] + base, t[2] + base))
            base += len(m["vertices"])


def convex_mesh(a, i, extra):
    """Gu::ConvexMesh(NX64 실측): +0x20 CenterExtents, +0x38 centerOfMass, +0x44 u16 nbEdges(bit15=GRB),
    +0x46 u8 nbHullVertices, +0x47 u8 nbPolygons, +0x48 ptr polygons, +0x68 u32 mNb(vertexData8 수, bit31=메모리 소유 아님),
    +0x70 ptr bigConvexData. 추가 데이터 = computeBufferSize 버퍼(4 정렬):
    HullPolygonData 20 B x nP {plane n,d, u16 vref8, u8 nbVerts, u8 minIndex}, PxVec3 x nV, u8 x 2nE, u8 x 3nV, [u16 x 2nE], u8 x mNb."""
    b = a.b
    o = a.obj(i)
    ne_raw = struct.unpack_from("<H", b, o + 0x44)[0]
    ne = ne_raw & 0x7FFF
    nv, npoly = b[o + 0x46], b[o + 0x47]
    nb = struct.unpack_from("<I", b, o + 0x68)[0] & 0x7FFFFFFF
    big = struct.unpack_from("<Q", b, o + 0x70)[0] != 0
    e = a16(extra)
    polys = []
    for k in range(npoly):
        nx, ny, nz, d, vref, nverts, minidx = struct.unpack_from("<4fHBB", b, e + 20 * k)
        polys.append((nx, ny, nz, d, vref, nverts))
    vo = e + 20 * npoly
    verts = [struct.unpack_from("<3f", b, vo + 12 * k) for k in range(nv)]
    vd8 = vo + 12 * nv + 2 * ne + 3 * nv + (4 * ne if ne_raw & 0x8000 else 0)
    size = (vd8 + nb) - e
    size += (-size) % 4
    m = {"index": i, "type": "CONVEX_MESH", "nbVertices": nv, "nbPolygons": npoly, "nbEdges": ne, "bigConvex": big,
         "extra_end": e + size}
    faces = []
    err = 0.0
    for nx, ny, nz, d, vref, nverts in polys:
        idx = list(b[vd8 + vref:vd8 + vref + nverts])
        if len(idx) < 3 or any(x >= nv for x in idx):
            m["ok"] = False
            return m
        for x in idx:
            v = verts[x]
            err = max(err, abs(nx * v[0] + ny * v[1] + nz * v[2] + d))
        for k in range(1, nverts - 1):
            faces.append((idx[0], idx[k], idx[k + 1]))
    m.update({"vertices": verts, "triangles": faces, "planeError": err, "ok": err < 1e-2})
    return m


GEOM = {0: "sphere", 1: "plane", 2: "capsule", 3: "box", 4: "convex", 5: "trimesh", 6: "heightfield"}


def shapes(a):
    """SHAPE(7) 객체(NX64 실측, 전체 분포로 검증): +0x70 f32 quat(x,y,z,w) 로컬 포즈, +0x80 f32 pos, +0x8C f32 contactOffset(추정),
    +0x98 u32 PxGeometryType, +0x9C 형상 값(box 반폭 3f / sphere 반지름 / capsule 반지름·반높이 / mesh scale 3f + rot 4f),
    +0xC0 메시 참조(내부 참조 값 → 객체 인덱스)."""
    b = a.b
    ref = {r: i for r, i in a.int_ptr}
    out = []
    for i, (_, t) in enumerate(a.manifest):
        if t != 7:
            continue
        o = a.obj(i)
        gt = struct.unpack_from("<I", b, o + 0x98)[0]
        s = {"index": i, "geometry": GEOM.get(gt, gt),
             "quat": [round(v, 6) for v in struct.unpack_from("<4f", b, o + 0x70)],
             "pos": [round(v, 6) for v in struct.unpack_from("<3f", b, o + 0x80)]}
        if gt == 3:
            s["halfExtents"] = [round(v, 6) for v in struct.unpack_from("<3f", b, o + 0x9C)]
        elif gt == 0:
            s["radius"] = round(struct.unpack_from("<f", b, o + 0x9C)[0], 6)
        elif gt == 2:
            s["radius"], s["halfHeight"] = [round(v, 6) for v in struct.unpack_from("<2f", b, o + 0x9C)]
        elif gt in (4, 5):
            s["scale"] = [round(v, 6) for v in struct.unpack_from("<3f", b, o + 0x9C)]
            s["mesh"] = ref.get(struct.unpack_from("<Q", b, o + 0xC0)[0])
        out.append(s)
    return out


def leading_meshes(a):
    """추가 데이터를 앞에서부터 읽는다. 삼각 메시·볼록체·재질(추가 데이터 없음)만 연속될 동안 위치를 확정할 수 있다."""
    out = []
    e = a.extra_base
    for i, (_, t) in enumerate(a.manifest):
        e = a16(e)
        if t == 3:
            m = a.triangle_mesh(i, e)
            out.append(m)
            e = m["extra_end"]
        elif t == 8:
            continue
        elif t == 2:
            m = convex_mesh(a, i, e)
            out.append(m)
            if not m["ok"] or m["bigConvex"]:
                break
            e = m["extra_end"]
        else:
            break
    return out


def first_mesh(a):
    return leading_meshes(a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--obj")
    a = ap.parse_args()
    if a.all:
        paths = sorted((ROOT / "extracted/bea").glob("*/**/*.apx"))
        OUT.mkdir(parents=True, exist_ok=True)
        combo, types, hdr, res = Counter(), Counter(), Counter(), Counter()
        index = []
        meshes_total = [0]
        geo = Counter()
        for p in paths:
            x = Apx(p.read_bytes())
            s = x.summary()
            hdr[(s["version"], s["build"], s["platform"], s["marked"])] += 1
            combo[tuple(s["objects"])] += 1
            types.update(s["objects"])
            rel = str(p.relative_to(ROOT / "extracted/bea")).replace("\\", "/")
            row = {"file": rel, "objects": s["objects"], "shapes": shapes(x)}
            for sh in row["shapes"]:
                geo[sh["geometry"]] += 1
                if sh.get("mesh") is not None and x.manifest[sh["mesh"]][1] not in (2, 3):
                    geo["mesh_ref_mismatch"] += 1
            ms = first_mesh(x)
            good = []
            row["meshes"] = []
            for m in ms:
                if m["type"] == "CONVEX_MESH":
                    ok = m["ok"]
                    res[("CONVEX_MESH", ok)] += 1
                    row["meshes"].append({"type": "CONVEX_MESH", "ok": ok, "nbVertices": m.get("nbVertices"), "planeError": m.get("planeError")})
                else:
                    ok_idx, inside = mesh_check(m)
                    ok = ok_idx and inside
                    res[(m["type"], ok)] += 1
                    row["meshes"].append({"type": m["type"], "ok": ok, "nbVertices": m["nbVertices"], "nbTriangles": m["nbTriangles"],
                                          "materials": sorted(set(m.get("materialIndices", [])))})
                if ok:
                    good.append(m)
            meshes_total[0] += sum(1 for t in s["objects"] if t in ("TRIANGLE_MESH_BVH33", "CONVEX_MESH"))
            if good:
                write_obj(OUT / (rel.replace("/", "__").replace(".nx.bea", "")[:-4] + ".obj"), good)
            index.append(row)
        (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=0), encoding="utf-8")
        print(len(paths), "files")
        print("header", dict(hdr))
        print("object types", dict(types))
        print("collections", combo.most_common(15))
        print("mesh objects in files", meshes_total[0])
        print("shape geometry", dict(geo))
        print("extracted check (type, ok)", dict(res))
        return
    for p in a.files:
        x = Apx(Path(p).read_bytes())
        print("#", p)
        print(json.dumps(x.summary(), ensure_ascii=False))
        print("obj_base=0x%x extra_base=0x%x" % (x.obj_base, x.extra_base))
        for sh in shapes(x):
            print("shape", sh)
        ms = first_mesh(x)
        for m in ms:
            print({k: v for k, v in m.items() if k not in ("vertices", "triangles", "extraTrigData", "materialIndices")}, mesh_check(m))
        if a.obj and ms:
            write_obj(a.obj, ms)
            print("->", a.obj)


if __name__ == "__main__":
    main()
