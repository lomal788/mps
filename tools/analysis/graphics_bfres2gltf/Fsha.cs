using System.Text;

namespace Gfx;

// FRES 9 shape (key shape / morph) animation reader.
// BfresLibrary's Switch ShapeAnimParser reads the v9 FSHA counters in the wrong order
// (FrameCount comes out as 65536 and no VertexShapeAnims), so FSHA is parsed here directly.
//
// FSHA block (offsets from the block start, LE, offsets are file-absolute u64):
//   +0x00 "FSHA"  +0x04 u32 flags (bit2 = loop)
//   +0x08 name  +0x10 path  +0x18 bind model  +0x20 bind indices  +0x28 VertexShapeAnim[]  +0x30 user data[]  +0x38 user data dict
//   +0x40 u32 frameCount  +0x44 u32 bakedSize  +0x48 u16 numUserData  +0x4A u16 numVertexShapeAnim  +0x4C u16 numKeyShapeAnim  +0x4E u16 numCurve
// VertexShapeAnim (0x30): +0 name, +8 curves, +0x10 base weights (f32 x (numKey-1), no base shape), +0x18 KeyShapeAnimInfo[],
//   +0x20 u16 numCurve, +0x22 u16 numKey, +0x24 i32 beginCurve, +0x28 i32 beginKey
// KeyShapeAnimInfo (0x10): +0 name, +8 s8 curveIndex, +9 s8 subBindIndex
// AnimCurve (0x30): +0 frames, +8 keys, +0x10 u16 flags, +0x12 u16 numKey, +0x14 u32 target, +0x18 f32 start, end, scale, offset, delta
public class MiniCurve
{
    public int CurveType, FrameType, KeyType;
    public float[] Frames;
    public float[][] Keys;
    public float Scale, Offset, Start, End;
    public uint Target;

    public float Eval(float f)
    {
        int n = Frames.Length;
        if (n == 0) return 0;
        float s = Scale == 0 ? 1 : Scale;
        int Seg()
        {
            int i = 0;
            while (i + 1 < n && Frames[i + 1] <= f) i++;
            return i;
        }
        if (CurveType >= 2) // baked / step: one value per key
        {
            var k = Keys[Seg()][0];
            return CurveType == 2 ? k * s + Offset : k + Offset;
        }
        if (f <= Frames[0]) return Keys[0][0] * s + Offset;
        if (f >= Frames[n - 1]) return Keys[n - 1][0] * s + Offset;
        int j = Seg();
        float t = (f - Frames[j]) / (Frames[j + 1] - Frames[j]);
        var c = Keys[j];
        if (CurveType == 0) return c[0] * s + Offset + (c[1] + (c[2] + c[3] * t) * t) * t * s;
        return c[0] * s + Offset + c[1] * s * t;
    }
}

public class FshaVertexAnim
{
    public string Shape;
    public List<string> Keys = new();
    public List<int> KeyCurve = new();
    public float[] Base;
    public List<MiniCurve> Curves = new();
}

public class Fsha
{
    public string Name, Path;
    public uint Flags;
    public int FrameCount;
    public bool Loop => (Flags & 4) != 0;
    public List<FshaVertexAnim> Anims = new();
    public Dictionary<string, string> UserData = new();

    public static List<Fsha> Read(string file)
    {
        var b = File.ReadAllBytes(file);
        var res = new List<Fsha>();
        for (int p = 0; p + 4 <= b.Length; p += 4)
            if (b[p] == 'F' && b[p + 1] == 'S' && b[p + 2] == 'H' && b[p + 3] == 'A')
                res.Add(Parse(b, p));
        return res;
    }

    static ulong U64(byte[] b, long o) => BitConverter.ToUInt64(b, (int)o);
    static string Str(byte[] b, ulong o)
    {
        if (o == 0) return null;
        int len = BitConverter.ToUInt16(b, (int)o);
        return Encoding.UTF8.GetString(b, (int)o + 2, len);
    }

    static MiniCurve Curve(byte[] b, long o)
    {
        var c = new MiniCurve();
        ulong fo = U64(b, o), ko = U64(b, o + 8);
        int flags = BitConverter.ToUInt16(b, (int)o + 0x10);
        int n = BitConverter.ToUInt16(b, (int)o + 0x12);
        c.Target = BitConverter.ToUInt32(b, (int)o + 0x14);
        c.Start = BitConverter.ToSingle(b, (int)o + 0x18);
        c.End = BitConverter.ToSingle(b, (int)o + 0x1C);
        c.Scale = BitConverter.ToSingle(b, (int)o + 0x20);
        c.Offset = BitConverter.ToSingle(b, (int)o + 0x24);
        c.FrameType = flags & 3; c.KeyType = (flags >> 2) & 3; c.CurveType = (flags >> 4) & 7;
        c.Frames = new float[n];
        for (int i = 0; i < n; i++)
            c.Frames[i] = c.FrameType switch
            {
                0 => BitConverter.ToSingle(b, (int)fo + i * 4),
                1 => BitConverter.ToInt16(b, (int)fo + i * 2) / 32f,
                _ => b[(int)fo + i],
            };
        int per = c.CurveType == 0 ? 4 : c.CurveType == 1 ? 2 : 1;
        c.Keys = new float[n][];
        for (int i = 0; i < n; i++)
        {
            c.Keys[i] = new float[per];
            for (int k = 0; k < per; k++)
            {
                int idx = i * per + k;
                c.Keys[i][k] = c.KeyType switch
                {
                    0 => c.CurveType >= 4 ? BitConverter.ToInt32(b, (int)ko + idx * 4) : BitConverter.ToSingle(b, (int)ko + idx * 4),
                    1 => BitConverter.ToInt16(b, (int)ko + idx * 2),
                    _ => (sbyte)b[(int)ko + idx],
                };
            }
        }
        return c;
    }

    static Fsha Parse(byte[] b, int p)
    {
        var a = new Fsha
        {
            Flags = BitConverter.ToUInt32(b, p + 4),
            Name = Str(b, U64(b, p + 8)),
            Path = Str(b, U64(b, p + 0x10)),
            FrameCount = (int)BitConverter.ToUInt32(b, p + 0x40),
        };
        int numUser = BitConverter.ToUInt16(b, p + 0x48);
        int numVsa = BitConverter.ToUInt16(b, p + 0x4A);
        ulong vsaOff = U64(b, p + 0x28);
        for (int i = 0; i < numVsa; i++)
        {
            long o = (long)vsaOff + i * 0x30;
            var v = new FshaVertexAnim { Shape = Str(b, U64(b, o)) };
            ulong curves = U64(b, o + 8), bases = U64(b, o + 0x10), infos = U64(b, o + 0x18);
            int nCurve = BitConverter.ToUInt16(b, (int)o + 0x20), nKey = BitConverter.ToUInt16(b, (int)o + 0x22);
            for (int k = 0; k < nKey; k++)
            {
                long io = (long)infos + k * 0x10;
                v.Keys.Add(Str(b, U64(b, io)));
                v.KeyCurve.Add((sbyte)b[io + 8]);
            }
            v.Base = new float[Math.Max(0, nKey - 1)];
            for (int k = 0; k < v.Base.Length; k++) v.Base[k] = bases == 0 ? 0 : BitConverter.ToSingle(b, (int)bases + k * 4);
            for (int k = 0; k < nCurve; k++) v.Curves.Add(Curve(b, (long)curves + k * 0x30));
            a.Anims.Add(v);
        }
        // user data (name -> first string value) e.g. "blink" -> "pc01_fcl_blink00.fshb"
        ulong ud = U64(b, p + 0x30);
        for (int i = 0; i < numUser && ud != 0; i++)
        {
            long o = (long)ud + i * 0x20;
            var name = Str(b, U64(b, o));
            ulong data = U64(b, o + 8);
            int count = BitConverter.ToInt32(b, (int)o + 0x10);
            int type = b[o + 0x14];
            string val = null;
            if (type == 2 && count > 0 && data != 0) val = Str(b, U64(b, (long)data)); // string table entry
            else val = $"type{type} x{count}";
            if (name != null) a.UserData[name] = val;
        }
        return a;
    }
}
