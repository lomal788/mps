using System.Text;
using System.Text.Json.Nodes;

namespace Gfx;

// Minimal glTF 2.0 binary writer.
public class Glb
{
    public readonly JsonObject Root = new();
    readonly MemoryStream bin = new();
    readonly JsonArray views = new(), accessors = new();
    public readonly JsonArray Nodes = new(), Meshes = new(), Skins = new(), Materials = new(), Textures = new(),
        Images = new(), Samplers = new(), Animations = new();

    public const int FLOAT = 5126, U8 = 5121, U16 = 5123, U32 = 5125;

    int AddView(byte[] data, int? target)
    {
        while (bin.Length % 4 != 0) bin.WriteByte(0);
        var off = bin.Length;
        bin.Write(data, 0, data.Length);
        var v = new JsonObject { ["buffer"] = 0, ["byteOffset"] = off, ["byteLength"] = data.Length };
        if (target.HasValue) v["target"] = target.Value;
        views.Add(v);
        return views.Count - 1;
    }

    static string TypeOf(int comps) => comps switch { 1 => "SCALAR", 2 => "VEC2", 3 => "VEC3", 4 => "VEC4", 16 => "MAT4", _ => throw new ArgumentException() };

    public int Floats(float[] data, int comps, bool minmax = false, int? target = 34962)
    {
        var bytes = new byte[data.Length * 4];
        Buffer.BlockCopy(data, 0, bytes, 0, bytes.Length);
        var a = new JsonObject
        {
            ["bufferView"] = AddView(bytes, target),
            ["componentType"] = FLOAT,
            ["count"] = data.Length / comps,
            ["type"] = TypeOf(comps),
        };
        if (minmax)
        {
            var mn = new float[comps]; var mx = new float[comps];
            for (int c = 0; c < comps; c++) { mn[c] = float.MaxValue; mx[c] = float.MinValue; }
            for (int i = 0; i < data.Length; i++) { int c = i % comps; mn[c] = Math.Min(mn[c], data[i]); mx[c] = Math.Max(mx[c], data[i]); }
            a["min"] = new JsonArray(mn.Select(x => (JsonNode)(double)x).ToArray());
            a["max"] = new JsonArray(mx.Select(x => (JsonNode)(double)x).ToArray());
        }
        accessors.Add(a);
        return accessors.Count - 1;
    }

    public int Indices(uint[] idx)
    {
        bool small = idx.Length == 0 || idx.Max() < 65535;
        byte[] bytes;
        if (small) { bytes = new byte[idx.Length * 2]; for (int i = 0; i < idx.Length; i++) BitConverter.TryWriteBytes(bytes.AsSpan(i * 2), (ushort)idx[i]); }
        else { bytes = new byte[idx.Length * 4]; Buffer.BlockCopy(idx, 0, bytes, 0, bytes.Length); }
        accessors.Add(new JsonObject
        {
            ["bufferView"] = AddView(bytes, 34963),
            ["componentType"] = small ? U16 : U32,
            ["count"] = idx.Length,
            ["type"] = "SCALAR",
        });
        return accessors.Count - 1;
    }

    public int Joints(ushort[] j)
    {
        bool small = j.All(x => x < 256);
        byte[] bytes;
        if (small) bytes = j.Select(x => (byte)x).ToArray();
        else { bytes = new byte[j.Length * 2]; Buffer.BlockCopy(j, 0, bytes, 0, bytes.Length); }
        accessors.Add(new JsonObject
        {
            ["bufferView"] = AddView(bytes, 34962),
            ["componentType"] = small ? U8 : U16,
            ["count"] = j.Length / 4,
            ["type"] = "VEC4",
        });
        return accessors.Count - 1;
    }

    public int Add(JsonArray arr, JsonNode n) { arr.Add(n); return arr.Count - 1; }

    public void Write(string path, JsonObject scene, JsonObject extras = null)
    {
        Root["asset"] = new JsonObject { ["version"] = "2.0", ["generator"] = "mpj tools/graphics_bfres2gltf (BfresLibrary)" };
        Root["scene"] = 0;
        Root["scenes"] = new JsonArray(scene);
        void Put(string k, JsonArray a) { if (a.Count > 0) Root[k] = a; }
        Put("nodes", Nodes); Put("meshes", Meshes); Put("skins", Skins); Put("materials", Materials);
        Put("textures", Textures); Put("images", Images); Put("samplers", Samplers); Put("animations", Animations);
        Put("accessors", accessors); Put("bufferViews", views);
        while (bin.Length % 4 != 0) bin.WriteByte(0);
        Root["buffers"] = new JsonArray(new JsonObject { ["byteLength"] = bin.Length });
        if (extras != null) Root["extras"] = extras;
        var json = Encoding.UTF8.GetBytes(Root.ToJsonString(J.Compact));
        int jsonPad = (4 - json.Length % 4) % 4;
        using var fs = File.Create(path);
        using var w = new BinaryWriter(fs);
        int total = 12 + 8 + json.Length + jsonPad + 8 + (int)bin.Length;
        w.Write(0x46546C67); w.Write(2); w.Write(total);
        w.Write(json.Length + jsonPad); w.Write(0x4E4F534A); w.Write(json); for (int i = 0; i < jsonPad; i++) w.Write((byte)0x20);
        w.Write((int)bin.Length); w.Write(0x004E4942); w.Write(bin.ToArray());
    }
}
