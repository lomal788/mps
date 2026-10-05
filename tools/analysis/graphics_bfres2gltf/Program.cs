using System.Text.Json.Nodes;
using Gfx;

static int Usage()
{
    Console.Error.WriteLine("usage:\n  dump [--keys] <out.json> <fres files...>\n  gltf <model.fmdb> <out.glb> [--anim a.fskb]... [--texuri prefix] [--meta out.json]\n  anim <fres anim file> <out.json>   (fvbb / fmab / fsnb baked per frame)\n  stats <root dir> <out.json>");
    return 1;
}

if (args.Length < 1) return Usage();
switch (args[0])
{
    case "dump":
        {
            bool keys = args.Contains("--keys");
            var rest = args.Skip(1).Where(a => a != "--keys").ToList();
            var outPath = rest[0];
            var arr = new JsonArray();
            foreach (var f in rest.Skip(1))
            {
                try { arr.Add(Dump.File(f, keys)); }
                catch (Exception e) { arr.Add(new JsonObject { ["file"] = Path.GetFileName(f), ["error"] = e.GetType().Name + ": " + e.Message + " @ " + (e.StackTrace ?? "").Split((char)10).FirstOrDefault(l => l.Contains("Gfx.")) }); }
            }
            J.Write(outPath, arr);
            Console.WriteLine($"dump: {arr.Count} files -> {outPath}");
            return 0;
        }
    case "gltf":
        return GltfExport.Run(args.Skip(1).ToArray());
    case "anim":
        return AnimExport.Run(args.Skip(1).ToArray());
    case "stats":
        return Stats.Run(args.Skip(1).ToArray());
}
return Usage();
