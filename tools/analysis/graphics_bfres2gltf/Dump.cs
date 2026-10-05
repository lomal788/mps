using System.Text.Json.Nodes;
using BfresLibrary;
using BfresLibrary.Helpers;

namespace Gfx;

public static class Dump
{
    public static JsonNode UserData(ResDict<UserData> ud)
    {
        if (ud == null || ud.Count == 0) return null;
        var o = new JsonObject();
        foreach (var kv in ud)
        {
            var u = kv.Value;
            JsonNode v;
            try { v = J.Val(u.GetData()); } catch { v = null; }
            o[u.Name ?? kv.Key] = new JsonObject { ["type"] = u.Type.ToString(), ["value"] = v };
        }
        return o;
    }

    static JsonArray V3(Syroot.Maths.Vector3F v) => J.Arr(new[] { v.X, v.Y, v.Z });
    static JsonArray V4(Syroot.Maths.Vector4F v) => J.Arr(new[] { v.X, v.Y, v.Z, v.W });

    public static JsonObject Model(ResFile res, Model m, bool full = true)
    {
        var o = new JsonObject { ["name"] = m.Name };
        var sk = m.Skeleton;
        var bones = new JsonArray();
        int bi = 0;
        foreach (var b in sk.Bones.Values)
        {
            bones.Add(new JsonObject
            {
                ["i"] = bi++,
                ["name"] = b.Name,
                ["parent"] = b.ParentIndex,
                ["smooth"] = b.SmoothMatrixIndex,
                ["rigid"] = b.RigidMatrixIndex,
                ["billboard"] = b.FlagsBillboard.ToString(),
                ["billboardIndex"] = b.BillboardIndex,
                ["visible"] = b.Visible,
                ["rotMode"] = b.FlagsRotation.ToString(),
                ["transformFlags"] = b.FlagsTransform.ToString(),
                ["S"] = V3(b.Scale),
                ["R"] = V4(b.Rotation),
                ["T"] = V3(b.Position),
                ["userData"] = UserData(b.UserData),
            });
        }
        o["skeleton"] = new JsonObject
        {
            ["rotation"] = sk.FlagsRotation.ToString(),
            ["scaling"] = sk.FlagsScaling.ToString(),
            ["numSmooth"] = sk.NumSmoothMatrices,
            ["numRigid"] = sk.NumRigidMatrices,
            ["matrixToBone"] = J.Arr((sk.MatrixToBoneList ?? new List<ushort>()).Select(x => (int)x)),
            ["bones"] = bones,
        };
        var vbs = new JsonArray();
        foreach (var vb in m.VertexBuffers)
        {
            var at = new JsonArray();
            foreach (var a in vb.Attributes.Values)
                at.Add(new JsonObject { ["name"] = a.Name, ["format"] = a.Format.ToString(), ["buffer"] = a.BufferIndex, ["offset"] = a.Offset });
            var vo = new JsonObject { ["count"] = vb.VertexCount, ["skin"] = vb.VertexSkinCount, ["attribs"] = at };
            if (full)
            {
                // Value ranges of each attribute (for format interpretation checks).
                try
                {
                    var h = new VertexBufferHelper(vb, res.ByteOrder);
                    var rng = new JsonObject();
                    foreach (var a in h.Attributes)
                    {
                        if (a.Data.Length == 0) continue;
                        var mn = new float[4]; var mx = new float[4];
                        for (int c = 0; c < 4; c++) { mn[c] = float.MaxValue; mx[c] = float.MinValue; }
                        foreach (var d in a.Data)
                        {
                            float[] e = { d.X, d.Y, d.Z, d.W };
                            for (int c = 0; c < 4; c++) { mn[c] = Math.Min(mn[c], e[c]); mx[c] = Math.Max(mx[c], e[c]); }
                        }
                        rng[a.Name] = new JsonObject { ["min"] = J.Arr(mn), ["max"] = J.Arr(mx) };
                    }
                    vo["ranges"] = rng;
                }
                catch (Exception e) { vo["rangesError"] = e.Message; }
            }
            vbs.Add(vo);
        }
        o["vertexBuffers"] = vbs;

        var shapes = new JsonArray();
        foreach (var s in m.Shapes.Values)
        {
            var lods = new JsonArray();
            foreach (var me in s.Meshes)
                lods.Add(new JsonObject
                {
                    ["prim"] = me.PrimitiveType.ToString(),
                    ["indexFormat"] = me.IndexFormat.ToString(),
                    ["indexCount"] = me.IndexCount,
                    ["firstVertex"] = me.FirstVertex,
                    ["subMeshes"] = me.SubMeshes.Count,
                });
            shapes.Add(new JsonObject
            {
                ["name"] = s.Name,
                ["material"] = m.Materials[s.MaterialIndex].Name,
                ["bone"] = sk.BoneList[s.BoneIndex].Name,
                ["vb"] = s.VertexBufferIndex,
                ["skin"] = s.VertexSkinCount,
                ["skinBones"] = J.Arr((s.SkinBoneIndices ?? new List<ushort>()).Select(x => (int)x)),
                ["keyShapes"] = J.Arr(s.KeyShapes?.Keys ?? Enumerable.Empty<string>()),
                ["targetAttribCount"] = s.TargetAttribCount,
                ["radius"] = J.Arr(s.RadiusArray ?? new List<float>()),
                ["flags"] = s.Flags.ToString(),
                ["lods"] = lods,
            });
        }
        o["shapes"] = shapes;

        var mats = new JsonArray();
        foreach (var mt in m.Materials.Values) mats.Add(Material(mt));
        o["materials"] = mats;
        o["userData"] = UserData(m.UserData);
        return o;
    }

    public static JsonObject Material(Material mt)
    {
        var o = new JsonObject { ["name"] = mt.Name, ["visible"] = mt.Visible };
        var sa = mt.ShaderAssign;
        if (sa != null)
        {
            var aa = new JsonObject();
            foreach (var kv in sa.AttribAssigns) aa[kv.Key] = kv.Value?.ToString();
            var ss = new JsonObject();
            foreach (var kv in sa.SamplerAssigns) ss[kv.Key] = kv.Value?.ToString();
            var op = new JsonObject();
            foreach (var kv in sa.ShaderOptions) op[kv.Key] = kv.Value?.ToString();
            o["shader"] = new JsonObject
            {
                ["archive"] = sa.ShaderArchiveName,
                ["model"] = sa.ShadingModelName,
                ["revision"] = sa.Revision,
                ["attribAssign"] = aa,
                ["samplerAssign"] = ss,
                ["options"] = op,
            };
        }
        var ri = new JsonObject();
        foreach (var kv in mt.RenderInfos)
        {
            var r = kv.Value;
            JsonNode v;
            try
            {
                v = r.Type switch
                {
                    RenderInfoType.Int32 => J.Arr(r.GetValueInt32s()),
                    RenderInfoType.Single => J.Arr(r.GetValueSingles()),
                    _ => J.Arr(r.GetValueStrings()),
                };
            }
            catch { v = J.Val(r.Data); }
            ri[r.Name ?? kv.Key] = v;
        }
        o["renderInfo"] = ri;
        o["textures"] = J.Arr(mt.TextureRefs.Select(t => t.Name));
        var smp = new JsonArray();
        foreach (var kv in mt.Samplers)
        {
            var t = kv.Value.TexSampler;
            smp.Add(new JsonObject
            {
                ["name"] = kv.Value.Name ?? kv.Key,
                ["wrapU"] = t.ClampX.ToString(),
                ["wrapV"] = t.ClampY.ToString(),
                ["mag"] = t.MagFilter.ToString(),
                ["min"] = t.MinFilter.ToString(),
                ["mip"] = t.MipFilter.ToString(),
                ["aniso"] = t.MaxAnisotropicRatio.ToString(),
                ["lodBias"] = J.F(t.LodBias),
            });
        }
        o["samplers"] = smp;
        var pr = new JsonObject();
        foreach (var kv in mt.ShaderParams)
        {
            var p = kv.Value;
            pr[p.Name ?? kv.Key] = new JsonObject { ["type"] = p.Type.ToString(), ["value"] = J.Val(p.DataValue) };
        }
        o["params"] = pr;
        o["userData"] = UserData(mt.UserData);
        if (mt.VolatileFlags != null && mt.VolatileFlags.Length > 0) o["volatileFlags"] = Convert.ToHexString(mt.VolatileFlags);
        return o;
    }

    public static JsonObject Curve(AnimCurve c, bool keys)
    {
        var o = new JsonObject
        {
            ["target"] = "0x" + c.AnimDataOffset.ToString("X2"),
            ["type"] = c.CurveType.ToString(),
            ["frameType"] = c.FrameType.ToString(),
            ["keyType"] = c.KeyType.ToString(),
            ["n"] = c.Frames.Length,
            ["start"] = J.F(c.StartFrame),
            ["end"] = J.F(c.EndFrame),
            ["scale"] = J.F(c.Scale),
            ["offset"] = J.F((float)c.Offset),
            ["pre"] = c.PreWrap.ToString(),
            ["post"] = c.PostWrap.ToString(),
        };
        if (keys)
        {
            o["frames"] = J.Arr(c.Frames);
            var ks = new JsonArray();
            for (int i = 0; i < c.Keys.GetLength(0); i++)
            {
                var k = new float[c.Keys.GetLength(1)];
                for (int j = 0; j < k.Length; j++) k[j] = c.Keys[i, j];
                ks.Add(J.Arr(k));
            }
            o["keys"] = ks;
        }
        return o;
    }

    public static JsonObject Skeletal(SkeletalAnim a, bool keys)
    {
        var ba = new JsonArray();
        foreach (var b in a.BoneAnims)
        {
            ba.Add(new JsonObject
            {
                ["name"] = b.Name,
                ["base"] = b.FlagsBase.ToString(),
                ["curveFlags"] = b.FlagsCurve.ToString(),
                ["transform"] = b.FlagsTransform.ToString(),
                ["S"] = V3(b.BaseData.Scale),
                ["R"] = V4(b.BaseData.Rotate),
                ["T"] = V3(b.BaseData.Translate),
                ["curves"] = new JsonArray(b.Curves.Select(c => (JsonNode)Curve(c, keys)).ToArray()),
            });
        }
        return new JsonObject
        {
            ["name"] = a.Name,
            ["frames"] = a.FrameCount,
            ["loop"] = a.Loop,
            ["baked"] = a.Baked,
            ["scale"] = a.FlagsScale.ToString(),
            ["rotate"] = a.FlagsRotate.ToString(),
            ["boneAnims"] = ba,
            ["userData"] = UserData(a.UserData),
        };
    }

    public static JsonObject Visibility(VisibilityAnim a, bool keys)
    {
        return new JsonObject
        {
            ["name"] = a.Name,
            ["frames"] = a.FrameCount,
            ["loop"] = a.Loop,
            ["baked"] = a.Baked,
            ["names"] = J.Arr(a.Names ?? new List<string>()),
            ["base"] = new JsonArray((a.BaseDataList ?? Array.Empty<bool>()).Select(x => (JsonNode)JsonValue.Create(x)).ToArray()),
            ["curves"] = new JsonArray((a.Curves ?? new List<AnimCurve>()).Select(c => (JsonNode)Curve(c, keys)).ToArray()),
        };
    }

    public static JsonObject MaterialAnim(MaterialAnim a, bool keys)
    {
        var md = new JsonArray();
        foreach (var d in a.MaterialAnimDataList)
        {
            var pis = new JsonArray();
            foreach (var p in d.ParamAnimInfos ?? new List<ParamAnimInfo>())
                pis.Add(new JsonObject
                {
                    ["name"] = p.Name,
                    ["beginCurve"] = p.BeginCurve,
                    ["floatCurves"] = p.FloatCurveCount,
                    ["intCurves"] = p.IntCurveCount,
                    ["beginConstant"] = p.BeginConstant,
                    ["constants"] = p.ConstantCount,
                });
            var pat = new JsonArray();
            foreach (var p in d.PatternAnimInfos ?? new List<PatternAnimInfo>())
                pat.Add(new JsonObject { ["name"] = p.Name, ["curve"] = p.CurveIndex, ["beginConstant"] = p.BeginConstant });
            var cons = new JsonArray();
            foreach (var c in d.Constants ?? new List<AnimConstant>())
                cons.Add(new JsonObject { ["target"] = "0x" + c.AnimDataOffset.ToString("X2"), ["f"] = J.F((float)c.Value), ["i"] = (int)c.Value });
            md.Add(new JsonObject
            {
                ["material"] = d.Name,
                ["params"] = pis,
                ["patterns"] = pat,
                ["patternBase"] = J.Arr((d.BaseDataList ?? Array.Empty<ushort>()).Select(x => (int)x)),
                ["constants"] = cons,
                ["visCurve"] = d.VisalCurveIndex,
                ["visConstant"] = d.VisualConstantIndex,
                ["curves"] = new JsonArray((d.Curves ?? new List<AnimCurve>()).Select(c => (JsonNode)Curve(c, keys)).ToArray()),
            });
        }
        return new JsonObject
        {
            ["name"] = a.Name,
            ["frames"] = a.FrameCount,
            ["loop"] = a.Loop,
            ["baked"] = a.Baked,
            ["textureNames"] = J.Arr(a.TextureNames?.Keys ?? Enumerable.Empty<string>()),
            ["materials"] = md,
            ["userData"] = UserData(a.UserData),
        };
    }

    public static JsonObject Scene(SceneAnim s, bool keys)
    {
        var cams = new JsonArray();
        foreach (var c in s.CameraAnims.Values)
        {
            var b = c.BaseData;
            cams.Add(new JsonObject
            {
                ["name"] = c.Name,
                ["frames"] = c.FrameCount,
                ["flags"] = c.Flags.ToString(),
                ["base"] = new JsonObject
                {
                    ["near"] = J.F(b.ClipNear),
                    ["far"] = J.F(b.ClipFar),
                    ["aspect"] = J.F(b.AspectRatio),
                    ["fov"] = J.F(b.FieldOfView),
                    ["pos"] = V3(b.Position),
                    ["rot"] = V3(b.Rotation),
                    ["twist"] = J.F(b.Twist),
                },
                ["curves"] = new JsonArray(c.Curves.Select(x => (JsonNode)Curve(x, keys)).ToArray()),
                ["userData"] = UserData(c.UserData),
            });
        }
        var lights = new JsonArray();
        foreach (var l in s.LightAnims.Values)
            lights.Add(new JsonObject
            {
                ["name"] = l.Name,
                ["frames"] = l.FrameCount,
                ["type"] = l.LightTypeName,
                ["flags"] = l.Flags.ToString(),
                ["fields"] = l.AnimatedFields.ToString(),
                ["base"] = J.Val(l.BaseData),
                ["curves"] = new JsonArray(l.Curves.Select(x => (JsonNode)Curve(x, keys)).ToArray()),
            });
        var fogs = new JsonArray();
        foreach (var f in s.FogAnims.Values)
            fogs.Add(new JsonObject { ["name"] = f.Name, ["frames"] = f.FrameCount, ["base"] = J.Val(f.BaseData) });
        return new JsonObject { ["name"] = s.Name, ["cameras"] = cams, ["lights"] = lights, ["fogs"] = fogs, ["userData"] = UserData(s.UserData) };
    }

    public static JsonObject File(string path, bool keys)
    {
        var res = new ResFile(path);
        var o = new JsonObject
        {
            ["file"] = Path.GetFileName(path),
            ["version"] = $"{res.VersionMajor}.{res.VersionMajor2}.{res.VersionMinor}.{res.VersionMinor2}",
            ["name"] = res.Name,
        };
        if (res.Models.Count > 0) o["models"] = new JsonArray(res.Models.Values.Select(m => (JsonNode)Model(res, m)).ToArray());
        if (res.SkeletalAnims.Count > 0) o["skeletalAnims"] = new JsonArray(res.SkeletalAnims.Values.Select(a => (JsonNode)Skeletal(a, keys)).ToArray());
        if (res.BoneVisibilityAnims.Count > 0) o["visibilityAnims"] = new JsonArray(res.BoneVisibilityAnims.Values.Select(a => (JsonNode)Visibility(a, keys)).ToArray());
        if (res.MatAnims() != null && res.MatAnims().Count > 0) o["materialAnims"] = new JsonArray(res.MatAnims().Values.Select(a => (JsonNode)MaterialAnim(a, keys)).ToArray());
        if (res.SceneAnims.Count > 0) o["sceneAnims"] = new JsonArray(res.SceneAnims.Values.Select(a => (JsonNode)Scene(a, keys)).ToArray());
        if (res.ShapeAnims.Count > 0) o["shapeAnims"] = new JsonArray(res.ShapeAnims.Values.Select(a => (JsonNode)J.Val(new { a.Name, a.FrameCount, a.Flags, Shapes = a.VertexShapeAnims?.Select(v => new { v.Name, Curves = v.Curves?.Count ?? 0, Keys = v.KeyShapeAnimInfos?.Select(k => k.Name).ToArray() }).ToArray() })).ToArray());
        if (res.ExternalFiles.Count > 0) o["externalFiles"] = J.Arr(res.ExternalFiles.Keys);
        return o;
    }
}
