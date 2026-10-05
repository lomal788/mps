using System;
using System.IO;
using System.Linq;
using BfresLibrary;

foreach (var path in args)
{
    try
    {
        var res = new ResFile(path);
        Console.WriteLine($"{Path.GetFileName(path)}: ver={res.VersionMajor}.{res.VersionMinor} name={res.Name} models={res.Models.Count} skel={res.SkeletalAnims.Count} mat={res.ShaderParamAnims.Count + res.TexPatternAnims.Count + res.ColorAnims.Count + res.TexSrtAnims.Count} vis={res.BoneVisibilityAnims.Count} shape={res.ShapeAnims.Count} scene={res.SceneAnims.Count} ext={res.ExternalFiles.Count}");
        foreach (var m in res.Models.Values)
            Console.WriteLine($"  model {m.Name}: bones={m.Skeleton.Bones.Count} shapes={m.Shapes.Count} mats={m.Materials.Count} verts={string.Join(",", m.VertexBuffers.Take(4).Select(v => v.VertexCount))}");
        foreach (var a in res.SkeletalAnims.Values)
            Console.WriteLine($"  skel {a.Name}: frames={a.FrameCount} bones={a.BoneAnims.Count} loop={a.Loop}");
        foreach (var s in res.SceneAnims.Values)
            Console.WriteLine($"  scene {s.Name}: cams={s.CameraAnims.Count} lights={s.LightAnims.Count}");
    }
    catch (Exception e)
    {
        Console.WriteLine($"{Path.GetFileName(path)}: FAIL {e.GetType().Name}: {e.Message}");
    }
}
