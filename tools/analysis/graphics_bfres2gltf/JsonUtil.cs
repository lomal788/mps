using System.Collections;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Gfx;

public static class J
{
    public static readonly JsonSerializerOptions Opts = new() { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    public static readonly JsonSerializerOptions Compact = new() { WriteIndented = false, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static JsonNode F(float v)
    {
        if (float.IsNaN(v) || float.IsInfinity(v)) return JsonValue.Create(v.ToString());
        return JsonValue.Create(double.Parse(v.ToString("R", System.Globalization.CultureInfo.InvariantCulture), System.Globalization.CultureInfo.InvariantCulture)); // shortest round-trip float
    }

    public static JsonArray Arr(IEnumerable<float> vs)
    {
        var a = new JsonArray();
        foreach (var v in vs) a.Add(F(v));
        return a;
    }

    public static JsonArray Arr(IEnumerable<int> vs)
    {
        var a = new JsonArray();
        foreach (var v in vs) a.Add(v);
        return a;
    }

    public static JsonArray Arr(IEnumerable<string> vs)
    {
        var a = new JsonArray();
        foreach (var v in vs) a.Add(v);
        return a;
    }

    // Generic value -> JSON (primitives, arrays, Syroot vectors, SRT structs).
    public static JsonNode Val(object o, int depth = 0)
    {
        if (o == null) return null;
        switch (o)
        {
            case string s: return JsonValue.Create(s);
            case bool b: return JsonValue.Create(b);
            case float f: return F(f);
            case double d: return F((float)d);
            case int i: return JsonValue.Create(i);
            case uint u: return JsonValue.Create(u);
            case short sh: return JsonValue.Create(sh);
            case ushort us: return JsonValue.Create(us);
            case byte by: return JsonValue.Create(by);
            case sbyte sb: return JsonValue.Create(sb);
            case long l: return JsonValue.Create(l);
            case Enum e: return JsonValue.Create(e.ToString());
        }
        if (o is IEnumerable en)
        {
            var a = new JsonArray();
            foreach (var x in en) a.Add(Val(x, depth + 1));
            return a;
        }
        if (depth > 4) return JsonValue.Create(o.ToString());
        var t = o.GetType();
        var obj = new JsonObject();
        foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (p.GetIndexParameters().Length > 0) continue;
            if (p.Name is "Length" or "LengthSquared" or "Normalized" or "Count") continue;
            try { obj[p.Name] = Val(p.GetValue(o), depth + 1); } catch { }
        }
        foreach (var fi in t.GetFields(BindingFlags.Public | BindingFlags.Instance))
        {
            try { obj[fi.Name] = Val(fi.GetValue(o), depth + 1); } catch { }
        }
        return obj;
    }

    public static void Write(string path, JsonNode n, bool indent = true)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
        File.WriteAllText(path, n.ToJsonString(indent ? Opts : Compact));
    }
}

public static class ResExt
{
    public static BfresLibrary.ResDict<BfresLibrary.MaterialAnim> MatAnims(this BfresLibrary.ResFile r)
    {
        var p = typeof(BfresLibrary.ResFile).GetProperty("MaterialAnims", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        return (BfresLibrary.ResDict<BfresLibrary.MaterialAnim>)p.GetValue(r);
    }
}
