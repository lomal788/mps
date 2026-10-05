using BfresLibrary;

namespace Gfx;

// FRES AnimCurve evaluation. Coefficient layout follows BfresLibrary CurveConvert:
// cubic  v = (k0*s + o) + k1*s*t + k2*s*t^2 + k3*s*t^3, t = (f - f_i) / (f_{i+1} - f_i)
// linear v = (k0*s + o) + k1*s*t
// step   v = k0 (+ o for int)
public static class Curves
{
    public static float Scale(AnimCurve c) => c.Scale == 0 ? 1f : c.Scale;

    public static float OffsetF(AnimCurve c)
    {
        bool intCurve = c.CurveType == AnimCurveType.StepInt || c.CurveType == AnimCurveType.BakedInt;
        return intCurve ? (float)(int)c.Offset : (float)c.Offset;
    }

    public static int Segment(AnimCurve c, float frame)
    {
        var fr = c.Frames;
        if (fr.Length == 0) return -1;
        if (frame <= fr[0]) return 0;
        int i = 0;
        while (i + 1 < fr.Length && fr[i + 1] <= frame) i++;
        return i;
    }

    public static float Eval(AnimCurve c, float frame)
    {
        var fr = c.Frames;
        int n = fr.Length;
        if (n == 0) return 0;
        float s = Scale(c), o = OffsetF(c);
        switch (c.CurveType)
        {
            case AnimCurveType.StepBool:
            case AnimCurveType.BakedBool:
                {
                    int i = Segment(c, frame);
                    if (c.KeyStepBoolData != null && i < c.KeyStepBoolData.Length) return c.KeyStepBoolData[i] ? 1 : 0;
                    return c.Keys[i, 0] != 0 ? 1 : 0;
                }
            case AnimCurveType.StepInt:
            case AnimCurveType.BakedInt:
                {
                    int i = Segment(c, frame);
                    return (int)c.Keys[i, 0] + (int)o;
                }
            case AnimCurveType.BakedFloat:
                {
                    int i = Segment(c, frame);
                    return c.Keys[i, 0] * s + o;
                }
        }
        if (frame <= fr[0]) return c.Keys[0, 0] * s + o;
        int k = Segment(c, frame);
        if (k >= n - 1 || frame >= fr[n - 1])
        {
            // At or after the last key: value of the last key (its constant term).
            if (frame >= fr[n - 1]) k = n - 1;
            if (k == n - 1) return c.Keys[k, 0] * s + o;
        }
        float span = fr[k + 1] - fr[k];
        float t = span > 0 ? (frame - fr[k]) / span : 0;
        if (c.CurveType == AnimCurveType.Cubic)
            return c.Keys[k, 0] * s + o + (c.Keys[k, 1] + (c.Keys[k, 2] + c.Keys[k, 3] * t) * t) * t * s;
        // Linear
        return c.Keys[k, 0] * s + o + c.Keys[k, 1] * s * t;
    }
}
