using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using BfresLibrary;

namespace Gfx;

// Aggregate statistics over every FRES file under a directory (extracted BEA tree).
public static class Stats
{
    static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, int>> T = new();
    static readonly ConcurrentDictionary<string, string> Example = new();

    static void Inc(string table, string key, string example = null)
    {
        var d = T.GetOrAdd(table, _ => new ConcurrentDictionary<string, int>());
        d.AddOrUpdate(key, 1, (_, v) => v + 1);
        if (example != null) Example.TryAdd(table + "|" + key, example);
    }

    static string Suffix(string tex)
    {
        // texture name rule: <prefix>_<kind>, kind = last token (alb, nml, rgh, ...)
        var i = tex.LastIndexOf('_');
        return i < 0 ? tex : tex[(i + 1)..];
    }

    static string Bucket(int n)
    {
        if (n <= 1) return n.ToString();
        int b = 1; while (b < n) b <<= 1;
        return $"<={b}";
    }

    public static int Run(string[] args)
    {
        var root = args[0];
        var outPath = args[1];
        var exts = new[] { ".fmdb", ".fskb", ".fmab", ".fvbb", ".fshb", ".fsnb" };
        var files = Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).Where(f => exts.Contains(Path.GetExtension(f))).ToList();
        // texture name index per archive (top folder under root) and global, to see where material texture refs resolve
        foreach (var t in Directory.EnumerateFiles(root, "*.bntx", SearchOption.AllDirectories))
        {
            var arc = Path.GetRelativePath(root, t).Split(Path.DirectorySeparatorChar, '/')[0];
            var nm = Path.GetFileNameWithoutExtension(t);
            TexByArchive.GetOrAdd(arc, _ => new ConcurrentDictionary<string, byte>())[nm] = 1;
            TexGlobal.AddOrUpdate(nm, arc, (_, v) => v);
        }
        Console.WriteLine($"stats: {files.Count} files");
        int done = 0, fail = 0;
        Parallel.ForEach(files, new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount }, f =>
        {
            var ext = Path.GetExtension(f);
            var rel = Path.GetRelativePath(root, f).Replace('\\', '/');
            try
            {
                var res = new ResFile(f);
                Inc("file.version", $"{ext} {res.VersionMajor}.{res.VersionMajor2}.{res.VersionMinor}.{res.VersionMinor2}");
                foreach (var m in res.Models.Values) Model(m, rel);
                foreach (var a in res.SkeletalAnims.Values) Skel(a, rel);
                foreach (var a in res.BoneVisibilityAnims.Values)
                {
                    Inc("vis.loop", a.Loop.ToString());
                    Inc("vis.frames", Bucket(a.FrameCount));
                    foreach (var c in a.Curves ?? new List<AnimCurve>()) Inc("vis.curve", c.CurveType.ToString());
                }
                var ma = res.MatAnims();
                if (ma != null)
                    foreach (var a in ma.Values)
                    {
                        Inc("mat.loop", a.Loop.ToString());
                        foreach (var d in a.MaterialAnimDataList)
                        {
                            foreach (var p in d.ParamAnimInfos ?? new List<ParamAnimInfo>()) Inc("mat.param", p.Name, rel);
                            foreach (var p in d.PatternAnimInfos ?? new List<PatternAnimInfo>()) Inc("mat.pattern.sampler", p.Name, rel);
                            if (d.VisalCurveIndex >= 0 || d.VisualConstantIndex >= 0) Inc("mat.kind", "visibility");
                            foreach (var c in d.Curves ?? new List<AnimCurve>()) Inc("mat.curve", c.CurveType.ToString());
                        }
                    }
                foreach (var s in res.SceneAnims.Values)
                {
                    foreach (var c in s.CameraAnims.Values)
                    {
                        Inc("cam.flags", c.Flags.ToString(), rel);
                        Inc("cam.fovDeg", Math.Round(c.BaseData.FieldOfView * 180 / Math.PI, 1).ToString());
                        Inc("cam.near/far", $"{c.BaseData.ClipNear}/{c.BaseData.ClipFar}");
                        foreach (var cv in c.Curves) Inc("cam.curveTarget", "0x" + cv.AnimDataOffset.ToString("X2") + " " + cv.CurveType);
                    }
                    foreach (var l in s.LightAnims.Values) Inc("light.type", l.LightTypeName ?? "?", rel);
                    foreach (var fg in s.FogAnims.Values) Inc("fog", fg.Name, rel);
                }
                if (ext == ".fshb")
                    foreach (var fa in Fsha.Read(f))
                    {
                        Inc("shapeanim.loop", fa.Loop.ToString());
                        Inc("shapeanim.frames", Bucket(fa.FrameCount));
                        Inc("shapeanim.withCurves", fa.Anims.Any(x => x.Curves.Count > 0) ? "curves" : "constant only");
                        foreach (var v in fa.Anims) foreach (var k in v.Keys.Skip(1)) Inc("shapeanim.key", k, rel);
                        foreach (var kv in fa.UserData) Inc("shapeanim.userData", kv.Key, rel + " -> " + kv.Value);
                    }
            }
            catch (Exception e)
            {
                Interlocked.Increment(ref fail);
                Inc("fail", ext + " " + e.GetType().Name + ": " + e.Message.Split('\n')[0], rel);
            }
            var n = Interlocked.Increment(ref done);
            if (n % 5000 == 0) Console.WriteLine($"  {n}/{files.Count}");
        });
        var o = new JsonObject { ["root"] = root, ["files"] = files.Count, ["failed"] = fail };
        foreach (var kv in T.OrderBy(k => k.Key))
        {
            var t = new JsonObject();
            foreach (var e in kv.Value.OrderByDescending(x => x.Value).ThenBy(x => x.Key))
            {
                Example.TryGetValue(kv.Key + "|" + e.Key, out var ex);
                t[e.Key] = ex == null ? e.Value : new JsonArray(e.Value, ex);
            }
            o[kv.Key] = t;
        }
        J.Write(outPath, o);
        Console.WriteLine($"stats: done {done}, failed {fail} -> {outPath}");
        return 0;
    }

    static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> TexByArchive = new();
    static readonly ConcurrentDictionary<string, string> TexGlobal = new();

    static void Model(Model m, string rel)
    {
        var arc = rel.Split('/')[0];
        foreach (var mt0 in m.Materials.Values)
            foreach (var tr in mt0.TextureRefs)
            {
                if (TexByArchive.TryGetValue(arc, out var set) && set.ContainsKey(tr.Name)) Inc("tex.resolve", "same archive");
                else if (TexGlobal.TryGetValue(tr.Name, out var other)) Inc("tex.resolve", "other archive", rel + ":" + tr.Name + " <- " + other);
                else Inc("tex.resolve", "not found", rel + ":" + tr.Name);
            }
        Inc("model.count", "models");
        var sk = m.Skeleton;
        Inc("skel.rotation", sk.FlagsRotation.ToString());
        Inc("skel.scaling", sk.FlagsScaling.ToString());
        Inc("skel.bones", Bucket(sk.Bones.Count));
        foreach (var b in sk.Bones.Values)
        {
            if (b.FlagsBillboard.ToString() != "None") Inc("bone.billboard", b.FlagsBillboard.ToString(), rel + ":" + b.Name);
            if (!b.Visible) Inc("bone.hiddenAtBind", "count");
            if (b.UserData != null) foreach (var u in b.UserData.Keys) Inc("bone.userData", u, rel);
        }
        if (m.UserData != null) foreach (var u in m.UserData.Keys) Inc("model.userData", u, rel);
        foreach (var vb in m.VertexBuffers)
            foreach (var a in vb.Attributes.Values) Inc("vtx.attrib", a.Name + " " + a.Format);
        foreach (var s in m.Shapes.Values)
        {
            Inc("shape.skin", s.VertexSkinCount.ToString(), rel);
            Inc("shape.lods", s.Meshes.Count.ToString(), rel);
            Inc("shape.prim", s.Meshes[0].PrimitiveType + " " + s.Meshes[0].IndexFormat);
            if (s.KeyShapes != null && s.KeyShapes.Count > 0) Inc("shape.keyShapes", s.KeyShapes.Count.ToString(), rel);
            if (s.VertexSkinCount > 0 && sk.MatrixToBoneList != null)
                Inc("shape.skinIndexSpace", s.SkinBoneIndices != null && s.SkinBoneIndices.Count > 0 ? "hasSkinBoneIndices" : "noSkinBoneIndices");
        }
        foreach (var mt in m.Materials.Values)
        {
            var sa = mt.ShaderAssign;
            var shading = sa == null ? "?" : sa.ShaderArchiveName + "/" + sa.ShadingModelName;
            Inc("mat.shading", shading, rel + ":" + mt.Name);
            if (sa != null)
            {
                foreach (var kv in sa.ShaderOptions)
                    Inc("mat.option." + kv.Key, kv.Value?.ToString() ?? "null");
                foreach (var kv in sa.SamplerAssigns) Inc("mat.samplerAssign", kv.Key + "=" + kv.Value);
                foreach (var kv in sa.AttribAssigns) Inc("mat.attribAssign", kv.Key + "=" + kv.Value);
            }
            foreach (var kv in mt.RenderInfos)
            {
                var r = kv.Value;
                string v;
                try
                {
                    v = r.Type switch
                    {
                        RenderInfoType.Int32 => string.Join(",", r.GetValueInt32s()),
                        RenderInfoType.Single => string.Join(",", r.GetValueSingles()),
                        _ => string.Join(",", r.GetValueStrings()),
                    };
                }
                catch { v = "?"; }
                Inc("mat.renderInfo", r.Name + "=" + v);
            }
            var names = mt.Samplers.Values.Select(x => x.Name).ToList();
            for (int i = 0; i < mt.TextureRefs.Count; i++)
            {
                var tex = mt.TextureRefs[i].Name;
                var smp = i < names.Count ? names[i] : "?";
                Inc("tex.suffix", Suffix(tex), tex);
                Inc("tex.sampler->suffix", smp + " -> " + Suffix(tex), rel + ":" + tex);
            }
            foreach (var p in mt.ShaderParams.Values) Inc("mat.param", p.Name + " " + p.Type);
            if (sa?.SamplerAssigns != null)
                foreach (var kv in sa.SamplerAssigns)
                {
                    int i = names.IndexOf(kv.Value?.ToString());
                    if (i >= 0 && i < mt.TextureRefs.Count) Inc("tex.slot->suffix", kv.Key + " -> " + Suffix(mt.TextureRefs[i].Name), rel + ":" + mt.TextureRefs[i].Name);
                }
        }
    }

    static void Skel(SkeletalAnim a, string rel)
    {
        Inc("ska.loop", a.Loop.ToString());
        Inc("ska.baked", a.Baked.ToString());
        Inc("ska.scale", a.FlagsScale.ToString());
        Inc("ska.rotate", a.FlagsRotate.ToString());
        Inc("ska.frames", Bucket(a.FrameCount));
        foreach (var b in a.BoneAnims)
        {
            foreach (var c in b.Curves)
            {
                Inc("ska.curve", c.CurveType + " " + c.FrameType + " " + c.KeyType);
                Inc("ska.wrap", c.PreWrap + "/" + c.PostWrap);
                if (c.Frames.Length > 1 && c.Frames.Any(f => f != Math.Floor(f))) Inc("ska.fractionalFrames", "curves", rel + ":" + b.Name);
            }
            if (b.ApplySegmentScaleCompensate) Inc("ska.segmentScaleCompensate", "bones", rel + ":" + b.Name);
        }
    }
}
