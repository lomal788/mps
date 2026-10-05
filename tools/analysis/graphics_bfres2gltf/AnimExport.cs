using System.Text.Json.Nodes;
using BfresLibrary;

namespace Gfx;

// Non-skeletal FRES animations -> baked JSON (one value per integer frame 0..FrameCount).
//   fvbb  bone visibility   { bones: { <bone>: [[frame, 0|1], ...] } }       (only change points, first entry = frame 0)
//   fmab  material anims    { materials: { <mat>: { params: { <param>: { "<offset>": [v0..vN] | const } }, patterns: { <sampler>: [[frame, texture], ...] } } } }
//   fsnb  scene anims       { cameras: [ { mode, projection, frames, near[], far[], aspect[], fovy[], pos[], rot[], twist[] } ] }
public static class AnimExport
{
    public static int Run(string[] args)
    {
        var res = new ResFile(args[0]);
        var o = new JsonObject { ["source"] = Path.GetFileName(args[0]), ["fps"] = 60 };
        if (res.BoneVisibilityAnims.Count > 0) o["boneVisibility"] = new JsonArray(res.BoneVisibilityAnims.Values.Select(a => (JsonNode)Vis(a)).ToArray());
        var ma = res.MatAnims();
        if (ma != null && ma.Count > 0) o["materialAnims"] = new JsonArray(ma.Values.Select(a => (JsonNode)Mat(a)).ToArray());
        if (res.SceneAnims.Count > 0) o["sceneAnims"] = new JsonArray(res.SceneAnims.Values.Select(a => (JsonNode)Scene(a)).ToArray());
        if (res.SkeletalAnims.Count > 0) o["skeletal"] = new JsonArray(res.SkeletalAnims.Values.Select(a => (JsonNode)new JsonObject { ["name"] = a.Name, ["frames"] = a.FrameCount, ["loop"] = a.Loop, ["note"] = "use gltf --anim" }).ToArray());
        J.Write(args[1], o);
        Console.WriteLine($"anim: {Path.GetFileName(args[0])} -> {args[1]}");
        return 0;
    }

    static JsonArray Steps(Func<int, float> f, int frames)
    {
        var a = new JsonArray();
        float? prev = null;
        for (int i = 0; i <= frames; i++)
        {
            var v = f(i);
            if (prev == null || v != prev) a.Add(new JsonArray(i, J.F(v)));
            prev = v;
        }
        return a;
    }

    static JsonObject Vis(VisibilityAnim a)
    {
        var bones = new JsonObject();
        var names = a.Names ?? new List<string>();
        var curveFor = new Dictionary<int, AnimCurve>();
        foreach (var c in a.Curves ?? new List<AnimCurve>()) curveFor[(int)c.AnimDataOffset] = c;
        for (int i = 0; i < names.Count; i++)
        {
            bool b = a.BaseDataList != null && i < a.BaseDataList.Length && a.BaseDataList[i];
            if (curveFor.TryGetValue(i, out var c)) bones[names[i]] = Steps(f => Curves.Eval(c, f), a.FrameCount);
            else bones[names[i]] = new JsonArray(new JsonArray(0, b ? 1 : 0));
        }
        return new JsonObject { ["name"] = a.Name, ["frames"] = a.FrameCount, ["loop"] = a.Loop, ["animatedBones"] = curveFor.Count, ["bones"] = bones };
    }

    static JsonObject Mat(MaterialAnim a)
    {
        var mats = new JsonObject();
        var texNames = a.TextureNames?.Keys.ToList() ?? new List<string>();
        foreach (var d in a.MaterialAnimDataList)
        {
            var ps = new JsonObject();
            foreach (var p in d.ParamAnimInfos ?? new List<ParamAnimInfo>())
            {
                var po = new JsonObject();
                for (int k = 0; k < p.ConstantCount; k++)
                {
                    var c = d.Constants[p.BeginConstant + k];
                    po["0x" + c.AnimDataOffset.ToString("X2")] = J.F((float)c.Value);
                }
                for (int k = 0; k < p.FloatCurveCount + p.IntCurveCount; k++)
                {
                    var c = d.Curves[p.BeginCurve + k];
                    var vals = new float[a.FrameCount + 1];
                    for (int f = 0; f <= a.FrameCount; f++) vals[f] = Curves.Eval(c, f);
                    po["0x" + c.AnimDataOffset.ToString("X2")] = J.Arr(vals);
                }
                ps[p.Name] = po;
            }
            var pats = new JsonObject();
            var pinfos = d.PatternAnimInfos ?? new List<PatternAnimInfo>();
            for (int k = 0; k < pinfos.Count; k++)
            {
                var p = pinfos[k];
                int baseIdx = d.BaseDataList != null && k < d.BaseDataList.Length ? d.BaseDataList[k] : 0;
                var arr = new JsonArray();
                if (p.CurveIndex >= 0 && p.CurveIndex < d.Curves.Count)
                {
                    var c = d.Curves[p.CurveIndex];
                    int? prev = null;
                    for (int f = 0; f <= a.FrameCount; f++)
                    {
                        int v = (int)Curves.Eval(c, f);
                        if (prev != v) arr.Add(new JsonArray(f, v >= 0 && v < texNames.Count ? texNames[v] : v.ToString()));
                        prev = v;
                    }
                }
                else arr.Add(new JsonArray(0, baseIdx < texNames.Count ? texNames[baseIdx] : baseIdx.ToString()));
                pats[p.Name] = arr;
            }
            var mo = new JsonObject { ["params"] = ps, ["patterns"] = pats };
            if (d.VisalCurveIndex >= 0 && d.VisalCurveIndex < (d.Curves?.Count ?? 0))
                mo["visibility"] = Steps(f => Curves.Eval(d.Curves[d.VisalCurveIndex], f), a.FrameCount);
            else if (d.VisualConstantIndex >= 0 && d.VisualConstantIndex < (d.Constants?.Count ?? 0))
                mo["visibility"] = new JsonArray(new JsonArray(0, (int)d.Constants[d.VisualConstantIndex].Value));
            mats[d.Name] = mo;
        }
        return new JsonObject { ["name"] = a.Name, ["frames"] = a.FrameCount, ["loop"] = a.Loop, ["textureNames"] = J.Arr(texNames), ["materials"] = mats };
    }

    static JsonObject Scene(SceneAnim s)
    {
        var cams = new JsonArray();
        foreach (var c in s.CameraAnims.Values)
        {
            int n = c.FrameCount;
            var b = c.BaseData;
            float[] baseV = { b.ClipNear, b.ClipFar, b.AspectRatio, b.FieldOfView, b.Position.X, b.Position.Y, b.Position.Z, b.Rotation.X, b.Rotation.Y, b.Rotation.Z, b.Twist };
            var tracks = new float[baseV.Length][];
            for (int k = 0; k < baseV.Length; k++) { tracks[k] = new float[n + 1]; for (int f = 0; f <= n; f++) tracks[k][f] = baseV[k]; }
            foreach (var cv in c.Curves)
            {
                int k = (int)cv.AnimDataOffset / 4;
                if (k < 0 || k >= tracks.Length) continue;
                for (int f = 0; f <= n; f++) tracks[k][f] = Curves.Eval(cv, f);
            }
            JsonArray Vec(int k0)
            {
                var a = new JsonArray();
                for (int f = 0; f <= n; f++) a.Add(J.Arr(new[] { tracks[k0][f], tracks[k0 + 1][f], tracks[k0 + 2][f] }));
                return a;
            }
            var flags = c.Flags;
            cams.Add(new JsonObject
            {
                ["name"] = c.Name,
                ["frames"] = n,
                ["loop"] = flags.HasFlag(CameraAnimFlags.Looping),
                ["mode"] = flags.HasFlag(CameraAnimFlags.EulerZXY) ? "EulerZXY" : "Aim",
                ["projection"] = flags.HasFlag(CameraAnimFlags.Perspective) ? "Perspective" : "Ortho",
                ["animated"] = J.Arr(c.Curves.Select(x => "0x" + x.AnimDataOffset.ToString("X2"))),
                ["near"] = J.Arr(tracks[0]),
                ["far"] = J.Arr(tracks[1]),
                ["aspect"] = J.Arr(tracks[2]),
                ["fovyRad"] = J.Arr(tracks[3]),
                ["pos"] = Vec(4),
                ["rotOrAim"] = Vec(7),
                ["twist"] = J.Arr(tracks[10]),
            });
        }
        return new JsonObject { ["name"] = s.Name, ["cameras"] = cams, ["lights"] = s.LightAnims.Count, ["fogs"] = s.FogAnims.Count };
    }
}
