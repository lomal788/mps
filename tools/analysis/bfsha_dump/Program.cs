// bfsha_dump — mps 셰이더 아카이브(FSHA 8) 덤프. BfshaLibrary(Switch-Toolbox, mpj 에서 복사) 사용.
//   bfsha_dump model <x.bfsha> <out.json>            : 셰이딩 모델별 정적/동적 옵션·샘플러·유니폼 블록·속성
//   bfsha_dump match <dir_of_bfsha> <mats.json> <outdir> : 재질(web/tools/analysis/mat_survey.py 출력)마다 프로그램 찾기 + 쓰는 샘플러·블록 + 셰이더 코드(bin) 저장
using System.Text.Json;
using BfshaLibrary;

static object Opt(ShaderOption o) => new {
  name = o.Name, @default = o.defaultChoice, choices = o.choices,
  branchOffset = o.branchOffset, flag = o.flag, keyOffset = o.keyOffset, bit32Index = o.bit32Index, bit32Shift = o.bit32Shift, bit32Mask = o.bit32Mask };

static object Model(ShaderModel m) => new {
  name = m.Name, programs = m.Programs.Count, staticKeyLength = m.StaticKeyLength, dynamicKeyLength = m.DynamicKeyLength,
  staticOptions = m.StaticOptions.Values.Select(Opt).ToArray(),
  dynamicOptions = m.DynamiOptions.Values.Select(Opt).ToArray(),
  samplers = m.Samplers.Values.Select(s => new { name = m.Samplers.GetKey(s.Index), alt = s.AltAnnotation, index = s.Index }).ToArray(),
  attributes = m.Attributes.Values.Select(s => new { name = m.Attributes.GetKey(s.Index), location = s.Location, index = s.Index }).ToArray(),
  uniformBlocks = m.UniformBlocks.Values.Select(b => new { name = m.UniformBlocks.GetKey(b.Index), size = b.Size, type = b.Type.ToString(), index = b.Index,
    uniforms = b.Uniforms.Values.Select((u, i) => new { name = b.Uniforms.GetKey(i), offset = u.Offset }).ToArray() }).ToArray(),
};
var jo = new JsonSerializerOptions { WriteIndented = true, IncludeFields = true };

if (args[0] == "model") {
  var f = new BfshaFile(args[1]);
  File.WriteAllText(args[2], JsonSerializer.Serialize(f.ShaderModels.Values.Select(Model).ToArray(), jo));
  return;
}
if (args[0] == "match") {
  var mats = JsonDocument.Parse(File.ReadAllText(args[2])).RootElement;
  Directory.CreateDirectory(args[3]);
  var cache = new Dictionary<string, BfshaFile>();
  var results = new List<object>();
  foreach (var mat in mats.EnumerateArray()) {
    var arch = mat.GetProperty("archive").GetString(); var model = mat.GetProperty("model").GetString();
    if (arch == null) continue;
    var dir = mat.TryGetProperty("shpk", out var sp) ? sp.GetString() : args[1]; var path = Path.Combine(dir, arch + ".bfsha");
    if (!File.Exists(path)) { results.Add(new { file = mat.GetProperty("file").GetString(), name = mat.GetProperty("name").GetString(), error = "no bfsha" }); continue; }
    if (!cache.TryGetValue(path, out var bf)) cache[path] = bf = new BfshaFile(path);
    var sm = bf.ShaderModels.Values.First(x => x.Name == model);
    var opts = new Dictionary<string, string>();
    foreach (var p in mat.GetProperty("options").EnumerateObject()) opts[p.Name] = p.Value.GetString();
    var unknown = opts.Keys.Where(k => !sm.StaticOptions.ContainsKey(k)).ToArray();
    int idx = -1; string err = null;
    try { idx = sm.GetProgramIndex(opts); } catch (Exception e) { err = e.Message; }
    object used = null;
    if (idx >= 0) {
      var prog = sm.GetShaderProgram(idx);
      var samp = sm.Samplers.Values.Select(s => new { name = sm.Samplers.GetKey(s.Index), v = prog.SamplerLocations[s.Index].VertexLocation, f = prog.SamplerLocations[s.Index].FragmentLocation })
        .Where(x => x.v >= 0 || x.f >= 0).ToArray();
      var ubs = sm.UniformBlocks.Values.Select(b => new { name = sm.UniformBlocks.GetKey(b.Index), v = prog.UniformBlockLocations[b.Index].VertexLocation, f = prog.UniformBlockLocations[b.Index].FragmentLocation })
        .Where(x => x.v >= 0 || x.f >= 0).ToArray();
      var tag = $"{Path.GetFileName(dir)}__{arch}__p{idx}";
      try {
        var vari = sm.GetShaderVariation(prog);
        var bp = vari.BinaryProgram;
        void Save(ShaderCodeData c, string st) {
          if (c is ShaderCodeDataBinary b) for (int i = 0; i < b.BinaryData.Count; i++) {
            var fn = Path.Combine(args[3], $"{tag}.{st}{i}.bin");
            if (!File.Exists(fn)) { using var o = File.Create(fn); b.BinaryData[i].Position = 0; b.BinaryData[i].CopyTo(o); }
          }
        }
        Save(bp.ShaderInfoData.VertexShaderCode, "vs"); Save(bp.ShaderInfoData.PixelShaderCode, "fs");
      } catch (Exception e) { err = "code: " + e.Message; }
      string[] K(ResDict d) => d == null ? new string[0] : d.Keys.ToArray();
      var refl = sm.GetShaderVariation(prog).BinaryProgram.ShaderReflection;
      var fsS = K(refl?.PixelShaderCode?.ShaderSamplerDictionary); var vsS = K(refl?.VertexShaderCode?.ShaderSamplerDictionary);
      var samp2 = samp.Select(x => new { x.name, x.v, x.f, glslF = x.f >= 0 && x.f < fsS.Length ? fsS[x.f] : null, glslV = x.v >= 0 && x.v < vsS.Length ? vsS[x.v] : null }).ToArray();
      used = new { samplers = samp2, blocks = ubs, tag, vsIn = K(refl?.VertexShaderCode?.ShaderInputDictionary), vsOut = K(refl?.VertexShaderCode?.ShaderOutputDictionary),
        fsIn = K(refl?.PixelShaderCode?.ShaderInputDictionary), fsOut = K(refl?.PixelShaderCode?.ShaderOutputDictionary), fsSamplers = fsS, vsSamplers = vsS };
    }
    results.Add(new { file = mat.GetProperty("file").GetString(), name = mat.GetProperty("name").GetString(), arch, model, program = idx, err, unknown, used });
  }
  File.WriteAllText(Path.Combine(args[3], "match.json"), JsonSerializer.Serialize(results, jo));
  return;
}
