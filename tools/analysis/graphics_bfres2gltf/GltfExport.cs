using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using BfresLibrary;
using BfresLibrary.Helpers;
using Syroot.Maths;

namespace Gfx;

// FRES model (.fmdb) [+ skeletal anims (.fskb) + shape anims (.fshb)] -> glTF 2.0 binary.
//
// Layout of the produced glb (consumed by three.js GLTFLoader):
//   node 0            = model root "<model>__model" (FRES root bones often use the model name itself)
//   node 1..N         = bones, same names / hierarchy / bind TRS as the FRES skeleton
//   "<shape>__mesh"   = one node per drawn shape. Skinned (skin count >= 1) -> child of root, uses skin 0.
//                       Rigid (skin count 0) -> child of its shape bone (FRES Shape.BoneIndex), no skin.
//   animations        = one per fskb, baked at every integer frame (t = frame / 60), LINEAR.
//   extras            = FRES data that glTF cannot carry (shader assign, options, params, render info, ...).
public static class GltfExport
{
    public class Opt
    {
        public string Model, Out, TexDir, TexUri = "", Meta;
        public List<string> Anims = new();
        public List<string> ShapeAnims = new();
        public bool All;
        public int Lod;
    }

    public static int Run(string[] args)
    {
        var o = new Opt { Model = args[0], Out = args[1] };
        for (int i = 2; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--anim": o.Anims.Add(args[++i]); break;
                case "--shapeanim": o.ShapeAnims.Add(args[++i]); break;
                case "--texdir": o.TexDir = args[++i]; break;
                case "--texuri": o.TexUri = args[++i]; break;
                case "--meta": o.Meta = args[++i]; break;
                case "--all": o.All = true; break;
                case "--lod": o.Lod = int.Parse(args[++i]); break;
                default: throw new ArgumentException(args[i]);
            }
        }
        var meta = Export(o);
        if (o.Meta != null) J.Write(o.Meta, meta);
        Console.WriteLine($"gltf: {Path.GetFileName(o.Out)} nodes={meta["nodeCount"]} meshes={meta["meshes"]!.AsArray().Count} verts={meta["vertexCount"]} tris={meta["triangleCount"]} clips={meta["clips"]!.AsArray().Count} bindErr={meta["bindCheck"]!["maxErr"]}");
        return 0;
    }

    static double[] V(Vector3F v) => new double[] { v.X, v.Y, v.Z };

    static double[] BoneQuat(Bone b) => b.FlagsRotation == BoneFlagsRotation.Quaternion
        ? new double[] { b.Rotation.X, b.Rotation.Y, b.Rotation.Z, b.Rotation.W }
        : Rot.EulerXYZ(b.Rotation.X, b.Rotation.Y, b.Rotation.Z);

    static M4 FromMatrix3x4(object mtx)
    {
        var r = M4.Identity();
        var t = mtx.GetType();
        for (int i = 0; i < 3; i++)
            for (int j = 0; j < 4; j++)
            {
                var name = $"M{i + 1}{j + 1}";
                var p = t.GetProperty(name);
                var f = t.GetField(name);
                r[i, j] = Convert.ToDouble(p != null ? p.GetValue(mtx) : f.GetValue(mtx));
            }
        return r;
    }

    static double MaxDiff(M4 a, M4 b)
    {
        double d = 0;
        for (int i = 0; i < 16; i++) d = Math.Max(d, Math.Abs(a.m[i] - b.m[i]));
        return d;
    }

    // Compare computed bind world matrices against the inverse bind matrices stored in the file.
    static JsonObject CheckBind(Skeleton sk, M4[] world)
    {
        var bones = sk.BoneList;
        // Alternative Euler hypothesis for comparison.
        var alt = new M4[bones.Count];
        for (int i = 0; i < bones.Count; i++)
        {
            var b = bones[i];
            var q = b.FlagsRotation == BoneFlagsRotation.Quaternion ? new double[] { b.Rotation.X, b.Rotation.Y, b.Rotation.Z, b.Rotation.W } : Rot.EulerXYZ_alt(b.Rotation.X, b.Rotation.Y, b.Rotation.Z);
            var l = M4.TRS(V(b.Position), q, V(b.Scale));
            alt[i] = b.ParentIndex >= 0 ? alt[b.ParentIndex] * l : l;
        }
        double err = 0, errAlt = 0; int n = 0;
        for (int i = 0; i < bones.Count; i++)
        {
            var b = bones[i];
            if (b.SmoothMatrixIndex < 0 && b.RigidMatrixIndex < 0) continue;
            if (sk.InverseModelMatrices == null || b.SmoothMatrixIndex < 0 || b.SmoothMatrixIndex >= sk.InverseModelMatrices.Count) continue;
            var inv = FromMatrix3x4(sk.InverseModelMatrices[b.SmoothMatrixIndex]);
            err = Math.Max(err, MaxDiff(world[i] * inv, M4.Identity()));
            errAlt = Math.Max(errAlt, MaxDiff(alt[i] * inv, M4.Identity()));
            n++;
        }
        var dbg = new JsonArray();
        for (int i = 0; i < bones.Count && dbg.Count < 3; i++)
        {
            var b = bones[i];
            if (b.SmoothMatrixIndex < 0 && b.RigidMatrixIndex < 0) continue;
            dbg.Add(new JsonObject { ["bone"] = b.Name, ["world"] = J.Arr(world[i].m.Select(x => (float)x)), ["fileInverse"] = sk.InverseModelMatrices != null && b.SmoothMatrixIndex >= 0 && b.SmoothMatrixIndex < sk.InverseModelMatrices.Count ? J.Arr(FromMatrix3x4(sk.InverseModelMatrices[b.SmoothMatrixIndex]).m.Select(x => (float)x)) : null,
                ["R"] = J.Arr(new[] { b.Rotation.X, b.Rotation.Y, b.Rotation.Z, b.Rotation.W }), ["T"] = J.Arr(new[] { b.Position.X, b.Position.Y, b.Position.Z }) });
        }
        return new JsonObject { ["bonesWithInverse"] = n, ["maxErr"] = J.F((float)err), ["maxErrAltEuler"] = J.F((float)errAlt), ["debug"] = dbg };
    }

    static string Opt1(Material mt, string key) => mt.ShaderAssign?.ShaderOptions != null && mt.ShaderAssign.ShaderOptions.ContainsKey(key) ? mt.ShaderAssign.ShaderOptions[key].ToString() : null;

    static object Param(Material mt, string name) => mt.ShaderParams.ContainsKey(name) ? mt.ShaderParams[name].DataValue : null;

    static float PF(Material mt, string name, float def)
    {
        var v = Param(mt, name);
        return v is float f ? f : def;
    }

    static float[] PFA(Material mt, string name, float[] def)
    {
        var v = Param(mt, name);
        return v is float[] a ? a : def;
    }

    // shader sampler slot -> texture name (through ShaderAssign.SamplerAssigns: slot -> material sampler name).
    static Dictionary<string, string> SlotTextures(Material mt)
    {
        var res = new Dictionary<string, string>();
        var names = mt.Samplers.Values.Select(s => s.Name).ToList();
        if (mt.ShaderAssign?.SamplerAssigns == null) return res;
        foreach (var kv in mt.ShaderAssign.SamplerAssigns)
        {
            var smp = kv.Value?.ToString();
            int i = names.IndexOf(smp);
            if (i >= 0 && i < mt.TextureRefs.Count) res[kv.Key] = mt.TextureRefs[i].Name;
        }
        return res;
    }

    class TexReg
    {
        public Glb G; public Opt O;
        public Dictionary<string, int> Images = new();
        public Dictionary<string, int> Tex = new();
        public Dictionary<string, int> Smp = new();
        public HashSet<string> Missing = new();
        public List<JsonObject> Combines = new();

        public string PngOf(string tex)
        {
            if (O.TexDir != null)
            {
                var mj = Path.Combine(O.TexDir, tex + ".json");
                if (File.Exists(mj))
                {
                    var n = JsonNode.Parse(File.ReadAllText(mj));
                    return n!["files"]![0]!.GetValue<string>();
                }
                Missing.Add(tex);
            }
            return tex + ".png";
        }

        public int Sampler(Sampler s)
        {
            var t = s.TexSampler;
            int Wrap(BfresLibrary.GX2.GX2TexClamp c) => c.ToString() switch { "Wrap" => 10497, "Mirror" => 33648, _ => 33071 };
            int wrapS = Wrap(t.ClampX), wrapT = Wrap(t.ClampY);
            int mag = t.MagFilter.ToString() == "Point" ? 9728 : 9729;
            int min = t.MipFilter.ToString() == "Linear" ? (t.MinFilter.ToString() == "Point" ? 9986 : 9987)
                    : t.MipFilter.ToString() == "Point" ? (t.MinFilter.ToString() == "Point" ? 9984 : 9985)
                    : (t.MinFilter.ToString() == "Point" ? 9728 : 9729);
            var key = $"{wrapS},{wrapT},{mag},{min}";
            if (!Smp.TryGetValue(key, out var idx))
            {
                idx = G.Add(G.Samplers, new JsonObject { ["wrapS"] = wrapS, ["wrapT"] = wrapT, ["magFilter"] = mag, ["minFilter"] = min });
                Smp[key] = idx;
            }
            return idx;
        }

        public int Texture(string png, int sampler)
        {
            var key = png + "|" + sampler;
            if (Tex.TryGetValue(key, out var t)) return t;
            if (!Images.TryGetValue(png, out var im))
            {
                im = G.Add(G.Images, new JsonObject { ["uri"] = O.TexUri + png, ["name"] = Path.GetFileNameWithoutExtension(png) });
                Images[png] = im;
            }
            t = G.Add(G.Textures, new JsonObject { ["source"] = im, ["sampler"] = sampler });
            Tex[key] = t;
            return t;
        }
    }

    static JsonObject BuildMaterial(Material mt, TexReg reg)
    {
        var slots = SlotTextures(mt);
        var samplerBySlotTex = new Dictionary<string, Sampler>();
        var smpNames = mt.Samplers.Values.ToList();
        int SamplerFor(string slot)
        {
            var smpName = mt.ShaderAssign.SamplerAssigns[slot].ToString();
            var s = smpNames.FirstOrDefault(x => x.Name == smpName);
            return s != null ? reg.Sampler(s) : reg.Sampler(smpNames[0]);
        }
        int pbrUv = int.TryParse(Opt1(mt, "static_opt_pbr_texture_uv_index"), out var pu) ? pu : 0;
        int bakeUv = int.TryParse(Opt1(mt, "static_opt_bake_texture_uv_index"), out var bu) ? bu : 0;

        var baseColor = PFA(mt, "material_base_color", new float[] { 1, 1, 1 });
        var opacity = PF(mt, "material_mul_opacity", 1);
        var pbr = new JsonObject
        {
            ["baseColorFactor"] = J.Arr(new[] { baseColor[0], baseColor[1], baseColor[2], opacity }),
        };
        // Shader-graph materials (characters) switch the fixed texture options off and read the same slots
        // through sg_utility_* samplers, so the slot textures are still used there. [추정]
        bool sg = Opt1(mt, "static_opt_shader_graph") == "1";
        bool On(string opt) => Opt1(mt, opt) != "0" || sg;
        bool hasR = slots.ContainsKey("_r0") && On("static_opt_roughness_texture");
        bool hasM = slots.ContainsKey("_m0") && On("static_opt_metallic_texture");
        float rough = PF(mt, "material_roughness", 1), metal = PF(mt, "material_metallic", 0);
        pbr["roughnessFactor"] = J.F(hasR ? 1 : rough);
        pbr["metallicFactor"] = J.F(hasM ? 1 : metal);
        var gm = new JsonObject { ["name"] = mt.Name, ["pbrMetallicRoughness"] = pbr };
        var used = new JsonObject();
        if (sg) used["shaderGraph"] = true;

        if (slots.TryGetValue("_a0", out var alb) && On("static_opt_base_color_texture"))
        {
            pbr["baseColorTexture"] = new JsonObject { ["index"] = reg.Texture(reg.PngOf(alb), SamplerFor("_a0")), ["texCoord"] = pbrUv };
            used["baseColor"] = alb;
        }
        if (hasR || hasM)
        {
            // glTF metallicRoughness: G = roughness, B = metallic. FRES keeps them in two single-channel textures,
            // so the pipeline builds one combined png (graphics_textures.py combine).
            var r = hasR ? slots["_r0"] : null; var m = hasM ? slots["_m0"] : null;
            var png = $"{r ?? "none"}__{m ?? "none"}.mr.png";
            reg.Combines.Add(new JsonObject { ["out"] = png, ["roughness"] = r == null ? null : reg.PngOf(r), ["metallic"] = m == null ? null : reg.PngOf(m) });
            pbr["metallicRoughnessTexture"] = new JsonObject { ["index"] = reg.Texture(png, SamplerFor(hasR ? "_r0" : "_m0")), ["texCoord"] = pbrUv };
            used["roughness"] = r; used["metallic"] = m;
        }
        if (slots.TryGetValue("_n0", out var nml) && On("static_opt_normal_texture"))
        {
            gm["normalTexture"] = new JsonObject { ["index"] = reg.Texture(reg.PngOf(nml), SamplerFor("_n0")), ["texCoord"] = pbrUv };
            used["normal"] = nml;
        }
        if (slots.TryGetValue("_e0", out var emi) && Opt1(mt, "static_opt_emissive_color_texture") == "1")
        {
            gm["emissiveTexture"] = new JsonObject { ["index"] = reg.Texture(reg.PngOf(emi), SamplerFor("_e0")), ["texCoord"] = pbrUv };
            used["emissive"] = emi;
        }
        if (Opt1(mt, "static_opt_emissive_color") == "1" || gm.ContainsKey("emissiveTexture"))
        {
            var ec = PFA(mt, "material_emissive_color", new float[] { 1, 1, 1 });
            var es = PF(mt, "material_emissive_color_scale", 1);
            var f = gm.ContainsKey("emissiveTexture") && Opt1(mt, "static_opt_emissive_color") != "1" ? new float[] { 1, 1, 1 } : ec.Select(x => x * es).ToArray();
            var mx = f.Max();
            if (mx > 1) { gm["extensions"] = new JsonObject { ["KHR_materials_emissive_strength"] = new JsonObject { ["emissiveStrength"] = J.F(mx) } }; f = f.Select(x => x / mx).ToArray(); }
            gm["emissiveFactor"] = J.Arr(f);
        }
        if (slots.TryGetValue("global_ao_texture2d", out var ao) && Opt1(mt, "static_opt_global_ao_texture") == "1")
        {
            gm["occlusionTexture"] = new JsonObject { ["index"] = reg.Texture(reg.PngOf(ao), SamplerFor("global_ao_texture2d")), ["texCoord"] = bakeUv };
            used["occlusion"] = ao;
        }
        if (Opt1(mt, "static_opt_punchthrough") == "1")
        {
            gm["alphaMode"] = "MASK";
            gm["alphaCutoff"] = J.F(PF(mt, "material_punchthrough_threshold", 0.5f));
        }
        else if (Opt1(mt, "static_opt_state_type") is string st && st != "0")
            gm["alphaMode"] = "BLEND"; // [추정] static_opt_state_type != 0 = non-opaque state
        if (Opt1(mt, "static_opt_two_side") == "1") gm["doubleSided"] = true;

        // Everything else is kept raw for a custom shader.
        var smp = new JsonArray();
        var names = mt.Samplers.Values.Select(s => s.Name).ToList();
        for (int i = 0; i < names.Count; i++)
        {
            var tex = i < mt.TextureRefs.Count ? mt.TextureRefs[i].Name : null;
            var slotsFor = new List<string>();
            if (mt.ShaderAssign?.SamplerAssigns != null)
                foreach (var kv in mt.ShaderAssign.SamplerAssigns) if (kv.Value?.ToString() == names[i]) slotsFor.Add(kv.Key);
            smp.Add(new JsonObject { ["sampler"] = names[i], ["texture"] = tex, ["png"] = tex == null ? null : reg.PngOf(tex), ["slots"] = J.Arr(slotsFor) });
        }
        var fres = Dump.Material(mt);
        fres.Remove("samplers"); fres.Remove("textures");
        fres["samplers"] = smp;
        fres["gltfUsed"] = used;
        fres["uv"] = new JsonObject { ["pbr"] = pbrUv, ["bake"] = bakeUv };
        gm["extras"] = new JsonObject { ["fres"] = fres };
        return gm;
    }

    static readonly Regex Packed = new(@"^_g3d_02_(u\d*)_(u\d*)$");

    public static JsonObject Export(Opt o)
    {
        var res = new ResFile(o.Model);
        var model = res.Models.Values.First();
        var sk = model.Skeleton;
        var bones = sk.BoneList;
        var g = new Glb();
        var reg = new TexReg { G = g, O = o };

        // ---- skeleton
        var world = new M4[bones.Count];
        var rootChildren = new JsonArray();
        int rootNode = g.Add(g.Nodes, new JsonObject { ["name"] = model.Name + "__model" }); // FRES root bones often carry the model name; keep bone names unique
        var boneNode = new int[bones.Count];
        var boneByName = new Dictionary<string, int>();
        for (int i = 0; i < bones.Count; i++)
        {
            var b = bones[i];
            var q = BoneQuat(b);
            var l = M4.TRS(V(b.Position), q, V(b.Scale));
            world[i] = b.ParentIndex >= 0 ? world[b.ParentIndex] * l : l;
            var n = new JsonObject
            {
                ["name"] = b.Name,
                ["translation"] = J.Arr(new[] { b.Position.X, b.Position.Y, b.Position.Z }),
                ["rotation"] = J.Arr(q.Select(x => (float)x)),
                ["scale"] = J.Arr(new[] { b.Scale.X, b.Scale.Y, b.Scale.Z }),
            };
            var ex = new JsonObject { ["boneIndex"] = i };
            if (!b.Visible) ex["visible"] = false;
            if (b.FlagsBillboard.ToString() != "None") ex["billboard"] = b.FlagsBillboard.ToString();
            if (b.UserData != null && b.UserData.Count > 0) ex["userData"] = Dump.UserData(b.UserData);
            n["extras"] = ex;
            boneNode[i] = g.Add(g.Nodes, n);
            boneByName[b.Name] = boneNode[i];
        }
        for (int i = 0; i < bones.Count; i++)
        {
            var p = bones[i].ParentIndex;
            var parent = p >= 0 ? g.Nodes[boneNode[p]]!.AsObject() : g.Nodes[rootNode]!.AsObject();
            if (!parent.ContainsKey("children")) parent["children"] = new JsonArray();
            parent["children"]!.AsArray().Add(boneNode[i]);
        }
        var bindCheck = CheckBind(sk, world);
        var m2b = sk.MatrixToBoneList ?? new List<ushort>();

        // skin (all bones are joints)
        int skin = -1;
        bool anySkinned = model.Shapes.Values.Any(s => s.VertexSkinCount > 0);
        if (anySkinned)
        {
            var ibm = new float[bones.Count * 16];
            for (int i = 0; i < bones.Count; i++) Array.Copy(world[i].Inverse().ColumnMajor(), 0, ibm, i * 16, 16);
            skin = g.Add(g.Skins, new JsonObject
            {
                ["name"] = model.Name + "_skin",
                ["joints"] = J.Arr(boneNode),
                ["skeleton"] = boneNode[0],
                ["inverseBindMatrices"] = g.Floats(ibm, 16, false, null),
            });
        }

        // ---- materials
        var matIndex = new Dictionary<int, int>();
        var mats = model.Materials.Values.ToList();

        // ---- shapes
        var meshInfo = new JsonArray();
        var skipped = new JsonArray();
        long vtxTotal = 0, triTotal = 0;
        var meshNodeByShape = new Dictionary<string, int>();
        foreach (var s in model.Shapes.Values)
        {
            var mt = mats[s.MaterialIndex];
            var shading = mt.ShaderAssign?.ShaderArchiveName ?? "";
            if (!o.All && (shading == "container" || shading == "fluid" || shading.StartsWith("bezel_") || shading == "d_buffer"))
            {
                skipped.Add(new JsonObject { ["shape"] = s.Name, ["shader"] = shading + "/" + mt.ShaderAssign?.ShadingModelName });
                continue;
            }
            var vb = model.VertexBuffers[s.VertexBufferIndex];
            var h = new VertexBufferHelper(vb, res.ByteOrder);
            var A = h.Attributes.ToDictionary(a => a.Name, a => a.Data);
            int nv = (int)vb.VertexCount;
            var lod = s.Meshes[Math.Min(o.Lod, s.Meshes.Count - 1)];
            var idx = lod.GetIndices().Select(x => x + lod.FirstVertex).ToArray();
            int skinCount = s.VertexSkinCount;
            var shapeBone = s.BoneIndex;

            var pos = new float[nv * 3];
            var nrm = A.ContainsKey("_n0") ? new float[nv * 3] : null;
            var tan = A.ContainsKey("_t0") ? new float[nv * 4] : null;
            var p0 = A["_p0"];
            for (int v = 0; v < nv; v++)
            {
                double[] P = { p0[v].X, p0[v].Y, p0[v].Z };
                double[] N = nrm != null ? new double[] { A["_n0"][v].X, A["_n0"][v].Y, A["_n0"][v].Z } : null;
                double[] T = tan != null ? new double[] { A["_t0"][v].X, A["_t0"][v].Y, A["_t0"][v].Z } : null;
                if (skinCount == 1)
                {
                    // rigid skinning: vertex is in the local space of its single bone
                    var bi = m2b[(int)A["_i0"][v].X];
                    var W = world[bi];
                    P = W.MulPoint(P[0], P[1], P[2]);
                    if (N != null) N = W.MulDir(N[0], N[1], N[2]);
                    if (T != null) T = W.MulDir(T[0], T[1], T[2]);
                }
                pos[v * 3] = (float)P[0]; pos[v * 3 + 1] = (float)P[1]; pos[v * 3 + 2] = (float)P[2];
                if (N != null)
                {
                    var l = Math.Sqrt(N[0] * N[0] + N[1] * N[1] + N[2] * N[2]); if (l == 0) l = 1;
                    nrm[v * 3] = (float)(N[0] / l); nrm[v * 3 + 1] = (float)(N[1] / l); nrm[v * 3 + 2] = (float)(N[2] / l);
                }
                if (T != null)
                {
                    var l = Math.Sqrt(T[0] * T[0] + T[1] * T[1] + T[2] * T[2]);
                    if (l == 0) { T = new double[] { 1, 0, 0 }; l = 1; }
                    float w = A["_t0"][v].W < 0 ? -1 : 1;
                    tan[v * 4] = (float)(T[0] / l); tan[v * 4 + 1] = (float)(T[1] / l); tan[v * 4 + 2] = (float)(T[2] / l); tan[v * 4 + 3] = w;
                }
            }
            var attrs = new JsonObject { ["POSITION"] = g.Floats(pos, 3, true) };
            if (nrm != null) attrs["NORMAL"] = g.Floats(nrm, 3);
            if (tan != null) attrs["TANGENT"] = g.Floats(tan, 4);

            // UV sets through the material attribute assignment (shader _uN <- vertex attribute).
            var uvs = new SortedDictionary<int, float[]>();
            var uvSrc = new JsonObject();
            void PutUv(int set, Vector4F[] d, bool zw, string src)
            {
                var a = new float[nv * 2];
                for (int v = 0; v < nv; v++) { a[v * 2] = zw ? d[v].Z : d[v].X; a[v * 2 + 1] = zw ? d[v].W : d[v].Y; }
                uvs[set] = a; uvSrc["TEXCOORD_" + set] = src + (zw ? ".zw" : ".xy");
            }
            var assigned = new HashSet<string>();
            if (mt.ShaderAssign?.AttribAssigns != null)
                foreach (var kv in mt.ShaderAssign.AttribAssigns)
                {
                    var sm = Regex.Match(kv.Key, @"^_u(\d)$");
                    var va = kv.Value?.ToString();
                    if (!sm.Success || va == null || !A.ContainsKey(va)) continue;
                    int set = int.Parse(sm.Groups[1].Value);
                    var pm = Packed.Match(va);
                    if (pm.Success)
                    {
                        if (pm.Groups[1].Value != "") PutUv(set, A[va], false, va);
                        if (pm.Groups[2].Value != "") PutUv(set + 1, A[va], true, va);
                    }
                    else PutUv(set, A[va], false, va);
                    assigned.Add(va);
                }
            foreach (var kv in A.Where(kv => Regex.IsMatch(kv.Key, @"^_u\d$") && !assigned.Contains(kv.Key)))
            {
                int set = kv.Key[2] - '0';
                if (!uvs.ContainsKey(set)) PutUv(set, kv.Value, false, kv.Key);
            }
            if (uvs.Count > 0)
            {
                int maxSet = uvs.Keys.Max();
                for (int set = 0; set <= maxSet; set++)
                    attrs["TEXCOORD_" + set] = g.Floats(uvs.TryGetValue(set, out var a) ? a : new float[nv * 2], 2);
            }

            // vertex colors and other attributes, kept as custom attributes (_C0, ...)
            var custom = new JsonObject();
            foreach (var kv in A)
            {
                var nm = kv.Key;
                if (nm is "_p0" or "_n0" or "_t0" or "_i0" or "_w0" or "_i1" or "_w1") continue;
                if (assigned.Contains(nm) || Regex.IsMatch(nm, @"^_u\d$")) continue;
                if (Regex.IsMatch(nm, @"^_[pn]\d+$")) continue; // key shape targets
                var a = new float[nv * 4];
                for (int v = 0; v < nv; v++) { a[v * 4] = kv.Value[v].X; a[v * 4 + 1] = kv.Value[v].Y; a[v * 4 + 2] = kv.Value[v].Z; a[v * 4 + 3] = kv.Value[v].W; }
                var gname = "_" + nm.TrimStart('_').ToUpperInvariant();
                attrs[gname] = g.Floats(a, 4);
                custom[gname] = nm + " " + vb.Attributes[nm].Format;
            }

            // skinning
            if (skinCount >= 1)
            {
                var jnt = new ushort[nv * 4];
                var wgt = new float[nv * 4];
                var I = A["_i0"]; A.TryGetValue("_w0", out var Wt);
                for (int v = 0; v < nv; v++)
                {
                    float[] ii = { I[v].X, I[v].Y, I[v].Z, I[v].W };
                    float[] ww = Wt != null ? new[] { Wt[v].X, Wt[v].Y, Wt[v].Z, Wt[v].W } : new float[] { 1, 0, 0, 0 };
                    if (skinCount == 1) ww = new float[] { 1, 0, 0, 0 };
                    float sum = 0;
                    for (int k = 0; k < Math.Min(4, skinCount); k++) sum += ww[k];
                    for (int k = 0; k < 4; k++)
                    {
                        if (k < skinCount)
                        {
                            jnt[v * 4 + k] = m2b[(int)ii[k]];
                            wgt[v * 4 + k] = sum > 0 ? ww[k] / sum : (k == 0 ? 1 : 0);
                        }
                    }
                }
                attrs["JOINTS_0"] = g.Joints(jnt);
                attrs["WEIGHTS_0"] = g.Floats(wgt, 4);
            }

            if (!matIndex.TryGetValue(s.MaterialIndex, out var gmi))
            {
                gmi = g.Add(g.Materials, BuildMaterial(mt, reg));
                matIndex[s.MaterialIndex] = gmi;
            }
            var prim = new JsonObject { ["attributes"] = attrs, ["indices"] = g.Indices(idx), ["material"] = gmi, ["mode"] = 4 };

            // key shapes -> morph targets (_p<k> - _p0)
            var targetNames = new JsonArray();
            if (s.KeyShapes != null && s.KeyShapes.Count > 1)
            {
                var targets = new JsonArray();
                var keys = s.KeyShapes.Keys.ToList();
                for (int k = 1; k < keys.Count; k++)
                {
                    if (!A.TryGetValue("_p" + k, out var pk)) continue;
                    var d = new float[nv * 3];
                    for (int v = 0; v < nv; v++) { d[v * 3] = pk[v].X - p0[v].X; d[v * 3 + 1] = pk[v].Y - p0[v].Y; d[v * 3 + 2] = pk[v].Z - p0[v].Z; }
                    targets.Add(new JsonObject { ["POSITION"] = g.Floats(d, 3, true) });
                    targetNames.Add(keys[k]);
                }
                if (targets.Count > 0) prim["targets"] = targets;
            }

            var meshObj = new JsonObject { ["name"] = s.Name, ["primitives"] = new JsonArray(prim) };
            if (targetNames.Count > 0)
            {
                meshObj["extras"] = new JsonObject { ["targetNames"] = targetNames };
                meshObj["weights"] = J.Arr(Enumerable.Repeat(0f, targetNames.Count));
            }
            int gmesh = g.Add(g.Meshes, meshObj);
            var node = new JsonObject
            {
                ["name"] = s.Name + "__mesh",
                ["mesh"] = gmesh,
                ["extras"] = new JsonObject
                {
                    ["shape"] = s.Name,
                    ["visBone"] = bones[shapeBone].Name,
                    ["skinCount"] = skinCount,
                    ["material"] = mt.Name,
                    ["lods"] = s.Meshes.Count,
                    ["uv"] = uvSrc,
                    ["custom"] = custom,
                },
            };
            if (skinCount >= 1) node["skin"] = skin;
            int ni = g.Add(g.Nodes, node);
            meshNodeByShape[s.Name] = ni;
            var parentNode = skinCount >= 1 ? g.Nodes[rootNode]!.AsObject() : g.Nodes[boneNode[shapeBone]]!.AsObject();
            if (!parentNode.ContainsKey("children")) parentNode["children"] = new JsonArray();
            parentNode["children"]!.AsArray().Add(ni);
            vtxTotal += nv; triTotal += idx.Length / 3;
            meshInfo.Add(new JsonObject
            {
                ["shape"] = s.Name, ["node"] = node["name"]!.GetValue<string>(), ["material"] = mt.Name, ["skin"] = skinCount,
                ["visBone"] = bones[shapeBone].Name, ["vertices"] = nv, ["triangles"] = idx.Length / 3, ["morphTargets"] = targetNames.Count,
                ["attributes"] = J.Arr(attrs.Select(kv => kv.Key)),
            });
        }

        // ---- animations
        var clips = new JsonArray();
        foreach (var ap in o.Anims)
        {
            var ar = new ResFile(ap);
            foreach (var a in ar.SkeletalAnims.Values)
                clips.Add(AddSkeletalAnim(g, a, bones, boneByName, Path.GetFileName(ap)));
        }
        foreach (var ap in o.ShapeAnims)
        {
            foreach (var a in Fsha.Read(ap))
                clips.Add(AddShapeAnim(g, a, meshNodeByShape, Path.GetFileName(ap)));
        }

        var scene = new JsonObject { ["name"] = model.Name + "__scene", ["nodes"] = new JsonArray(rootNode) };
        var extras = new JsonObject
        {
            ["source"] = Path.GetFileName(o.Model),
            ["fresVersion"] = $"{res.VersionMajor}.{res.VersionMajor2}.{res.VersionMinor}.{res.VersionMinor2}",
            ["units"] = "FRES model units (no conversion)",
            ["fps"] = 60,
            ["skeleton"] = new JsonObject { ["rotation"] = sk.FlagsRotation.ToString(), ["scaling"] = sk.FlagsScaling.ToString() },
            ["skippedShapes"] = JsonNode.Parse(skipped.ToJsonString()),
            ["modelUserData"] = Dump.UserData(model.UserData),
        };
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(o.Out)));
        g.Write(o.Out, scene, extras);

        return new JsonObject
        {
            ["glb"] = Path.GetFileName(o.Out),
            ["source"] = Path.GetFileName(o.Model),
            ["model"] = model.Name,
            ["bones"] = bones.Count,
            ["boneNames"] = J.Arr(bones.Select(b => b.Name)),
            ["nodeCount"] = g.Nodes.Count,
            ["meshes"] = meshInfo,
            ["skippedShapes"] = JsonNode.Parse(skipped.ToJsonString()),
            ["vertexCount"] = vtxTotal,
            ["triangleCount"] = triTotal,
            ["materials"] = J.Arr(mats.Select(m => m.Name)),
            ["clips"] = clips,
            ["bindCheck"] = bindCheck,
            ["missingTextures"] = J.Arr(reg.Missing),
            ["combine"] = new JsonArray(reg.Combines.Select(c => (JsonNode)c).ToArray()),
            ["images"] = J.Arr(reg.Images.Keys),
        };
    }

    // Value of one bone at a frame (S, R as quaternion, T).
    static (double[] s, double[] q, double[] t) SampleBone(BoneAnim ba, Bone bind, SkeletalAnim a, float f)
    {
        double[] S, Rv, T;
        var fb = ba.FlagsBase;
        var ft = ba.FlagsTransform.ToString();
        S = fb.HasFlag(BoneAnimFlagsBase.Scale) ? new double[] { ba.BaseData.Scale.X, ba.BaseData.Scale.Y, ba.BaseData.Scale.Z }
            : ft.Contains("ScaleOne") ? new double[] { 1, 1, 1 } : V(bind.Scale);
        bool quat = a.FlagsRotate == SkeletalAnimFlagsRotate.Quaternion;
        Rv = fb.HasFlag(BoneAnimFlagsBase.Rotate) ? new double[] { ba.BaseData.Rotate.X, ba.BaseData.Rotate.Y, ba.BaseData.Rotate.Z, ba.BaseData.Rotate.W }
            : ft.Contains("RotateZero") ? new double[] { 0, 0, 0, quat ? 1 : 0 }
            : bind.FlagsRotation == BoneFlagsRotation.Quaternion ? new double[] { bind.Rotation.X, bind.Rotation.Y, bind.Rotation.Z, bind.Rotation.W }
            : new double[] { bind.Rotation.X, bind.Rotation.Y, bind.Rotation.Z, 0 };
        T = fb.HasFlag(BoneAnimFlagsBase.Translate) ? new double[] { ba.BaseData.Translate.X, ba.BaseData.Translate.Y, ba.BaseData.Translate.Z }
            : ft.Contains("TranslateZero") ? new double[] { 0, 0, 0 } : V(bind.Position);
        foreach (var c in ba.Curves)
        {
            var v = Curves.Eval(c, f);
            switch (c.AnimDataOffset)
            {
                case 0x04: S[0] = v; break;
                case 0x08: S[1] = v; break;
                case 0x0C: S[2] = v; break;
                case 0x10: T[0] = v; break;
                case 0x14: T[1] = v; break;
                case 0x18: T[2] = v; break;
                case 0x20: Rv[0] = v; break;
                case 0x24: Rv[1] = v; break;
                case 0x28: Rv[2] = v; break;
                case 0x2C: Rv[3] = v; break;
            }
        }
        double[] q;
        if (quat)
        {
            var l = Math.Sqrt(Rv.Sum(x => x * x)); if (l == 0) l = 1;
            q = Rv.Select(x => x / l).ToArray();
        }
        else q = Rot.EulerXYZ(Rv[0], Rv[1], Rv[2]);
        return (S, q, T);
    }

    static JsonObject AddSkeletalAnim(Glb g, SkeletalAnim a, IList<Bone> bones, Dictionary<string, int> boneByName, string src)
    {
        int n = Math.Max(a.FrameCount, 0);
        int samples = n + 1;
        var times = new float[samples];
        for (int i = 0; i < samples; i++) times[i] = i / 60f;
        int input = g.Floats(times, 1, true, null);
        var channels = new JsonArray(); var samplers = new JsonArray();
        var missing = new JsonArray();
        var bindByName = bones.ToDictionary(b => b.Name, b => b);
        foreach (var ba in a.BoneAnims)
        {
            if (!boneByName.TryGetValue(ba.Name, out var node)) { missing.Add(ba.Name); continue; }
            var bind = bindByName[ba.Name];
            var T = new float[samples * 3]; var R = new float[samples * 4]; var S = new float[samples * 3];
            double[] prev = null;
            for (int i = 0; i < samples; i++)
            {
                var (s, q, t) = SampleBone(ba, bind, a, i);
                if (prev != null && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.Select(x => -x).ToArray();
                prev = q;
                for (int k = 0; k < 3; k++) { T[i * 3 + k] = (float)t[k]; S[i * 3 + k] = (float)s[k]; }
                for (int k = 0; k < 4; k++) R[i * 4 + k] = (float)q[k];
            }
            foreach (var (path, data, comps) in new[] { ("translation", T, 3), ("rotation", R, 4), ("scale", S, 3) })
            {
                samplers.Add(new JsonObject { ["input"] = input, ["output"] = g.Floats(data, comps, false, null), ["interpolation"] = "LINEAR" });
                channels.Add(new JsonObject { ["sampler"] = samplers.Count - 1, ["target"] = new JsonObject { ["node"] = node, ["path"] = path } });
            }
        }
        g.Animations.Add(new JsonObject
        {
            ["name"] = a.Name,
            ["channels"] = channels,
            ["samplers"] = samplers,
            ["extras"] = new JsonObject { ["source"] = src, ["frames"] = a.FrameCount, ["loop"] = a.Loop, ["fps"] = 60, ["scaleMode"] = a.FlagsScale.ToString(), ["missingBones"] = missing },
        });
        return new JsonObject { ["name"] = a.Name, ["kind"] = "skeletal", ["frames"] = a.FrameCount, ["loop"] = a.Loop, ["duration"] = J.F(a.FrameCount / 60f), ["boneAnims"] = a.BoneAnims.Count, ["missingBones"] = missing.Count, ["scaleMode"] = a.FlagsScale.ToString() };
    }

    static JsonObject AddShapeAnim(Glb g, Fsha a, Dictionary<string, int> meshNodeByShape, string src)
    {
        int samples = Math.Max(a.FrameCount, 0) + 1;
        var times = new float[samples];
        for (int i = 0; i < samples; i++) times[i] = i / 60f;
        int input = -1;
        var channels = new JsonArray(); var samplers = new JsonArray(); var missing = new JsonArray();
        foreach (var vs in a.Anims)
        {
            var key = meshNodeByShape.Keys.FirstOrDefault(k => k == vs.Shape || k.StartsWith(vs.Shape + "__"));
            if (key == null) { missing.Add(vs.Shape); continue; }
            var mesh = g.Meshes[g.Nodes[meshNodeByShape[key]]!["mesh"]!.GetValue<int>()]!.AsObject();
            var tn = mesh["extras"]?["targetNames"]?.AsArray().Select(x => x!.GetValue<string>()).ToList() ?? new List<string>();
            if (tn.Count == 0) { missing.Add(vs.Shape + "(no targets)"); continue; }
            var w = new float[samples * tn.Count];
            // key 0 is the base shape; weights exist for keys 1..n-1 (base value or curve)
            for (int k = 1; k < vs.Keys.Count; k++)
            {
                int ti = tn.IndexOf(vs.Keys[k]);
                if (ti < 0) { missing.Add(vs.Shape + ":" + vs.Keys[k]); continue; }
                float baseV = k - 1 < vs.Base.Length ? vs.Base[k - 1] : 0;
                int ci = vs.KeyCurve[k];
                var c = ci >= 0 && ci < vs.Curves.Count ? vs.Curves[ci] : null;
                for (int i = 0; i < samples; i++) w[i * tn.Count + ti] = c != null ? c.Eval(i) : baseV;
            }
            if (input < 0) input = g.Floats(times, 1, true, null);
            samplers.Add(new JsonObject { ["input"] = input, ["output"] = g.Floats(w, 1, false, null), ["interpolation"] = "LINEAR" });
            channels.Add(new JsonObject { ["sampler"] = samplers.Count - 1, ["target"] = new JsonObject { ["node"] = meshNodeByShape[key], ["path"] = "weights" } });
        }
        var ud = new JsonObject();
        foreach (var kv in a.UserData) ud[kv.Key] = kv.Value;
        if (channels.Count > 0)
            g.Animations.Add(new JsonObject { ["name"] = a.Name + "_shape", ["channels"] = channels, ["samplers"] = samplers,
                ["extras"] = new JsonObject { ["source"] = src, ["frames"] = a.FrameCount, ["loop"] = a.Loop, ["fps"] = 60, ["userData"] = ud } });
        return new JsonObject { ["name"] = a.Name + "_shape", ["kind"] = "shape", ["frames"] = a.FrameCount, ["loop"] = a.Loop, ["channels"] = channels.Count,
            ["curves"] = a.Anims.Sum(x => x.Curves.Count), ["missing"] = missing, ["userData"] = JsonNode.Parse(ud.ToJsonString()) };
    }
}
