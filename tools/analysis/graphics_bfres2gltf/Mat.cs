namespace Gfx;

// 4x4 matrix, row-major storage, column-vector convention (p' = M * p, translation in column 3).
public struct M4
{
    public double[] m;

    public static M4 Identity()
    {
        var r = new M4 { m = new double[16] };
        r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1;
        return r;
    }

    public double this[int r, int c] { get => m[r * 4 + c]; set => m[r * 4 + c] = value; }

    public static M4 operator *(M4 a, M4 b)
    {
        var r = new M4 { m = new double[16] };
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++)
            {
                double s = 0;
                for (int k = 0; k < 4; k++) s += a[i, k] * b[k, j];
                r[i, j] = s;
            }
        return r;
    }

    public static M4 Translate(double x, double y, double z)
    {
        var r = Identity(); r[0, 3] = x; r[1, 3] = y; r[2, 3] = z; return r;
    }

    public static M4 Scale(double x, double y, double z)
    {
        var r = Identity(); r[0, 0] = x; r[1, 1] = y; r[2, 2] = z; return r;
    }

    public static M4 FromQuat(double x, double y, double z, double w)
    {
        var r = Identity();
        r[0, 0] = 1 - 2 * (y * y + z * z); r[0, 1] = 2 * (x * y - z * w); r[0, 2] = 2 * (x * z + y * w);
        r[1, 0] = 2 * (x * y + z * w); r[1, 1] = 1 - 2 * (x * x + z * z); r[1, 2] = 2 * (y * z - x * w);
        r[2, 0] = 2 * (x * z - y * w); r[2, 1] = 2 * (y * z + x * w); r[2, 2] = 1 - 2 * (x * x + y * y);
        return r;
    }

    public static M4 TRS(double[] t, double[] q, double[] s) => Translate(t[0], t[1], t[2]) * FromQuat(q[0], q[1], q[2], q[3]) * Scale(s[0], s[1], s[2]);

    public double[] MulPoint(double x, double y, double z) => new[] {
        this[0,0]*x + this[0,1]*y + this[0,2]*z + this[0,3],
        this[1,0]*x + this[1,1]*y + this[1,2]*z + this[1,3],
        this[2,0]*x + this[2,1]*y + this[2,2]*z + this[2,3] };

    public double[] MulDir(double x, double y, double z) => new[] {
        this[0,0]*x + this[0,1]*y + this[0,2]*z,
        this[1,0]*x + this[1,1]*y + this[1,2]*z,
        this[2,0]*x + this[2,1]*y + this[2,2]*z };

    // General inverse (Gauss-Jordan).
    public M4 Inverse()
    {
        var a = (double[])m.Clone();
        var inv = Identity().m;
        for (int c = 0; c < 4; c++)
        {
            int p = c;
            for (int r = c + 1; r < 4; r++) if (Math.Abs(a[r * 4 + c]) > Math.Abs(a[p * 4 + c])) p = r;
            if (p != c)
                for (int k = 0; k < 4; k++)
                {
                    (a[c * 4 + k], a[p * 4 + k]) = (a[p * 4 + k], a[c * 4 + k]);
                    (inv[c * 4 + k], inv[p * 4 + k]) = (inv[p * 4 + k], inv[c * 4 + k]);
                }
            double d = a[c * 4 + c];
            for (int k = 0; k < 4; k++) { a[c * 4 + k] /= d; inv[c * 4 + k] /= d; }
            for (int r = 0; r < 4; r++)
            {
                if (r == c) continue;
                double f = a[r * 4 + c];
                for (int k = 0; k < 4; k++) { a[r * 4 + k] -= f * a[c * 4 + k]; inv[r * 4 + k] -= f * inv[c * 4 + k]; }
            }
        }
        return new M4 { m = inv };
    }

    // glTF wants column-major float[16].
    public float[] ColumnMajor()
    {
        var r = new float[16];
        for (int c = 0; c < 4; c++)
            for (int rr = 0; rr < 4; rr++) r[c * 4 + rr] = (float)this[rr, c];
        return r;
    }
}

public static class Rot
{
    // Quaternion (x,y,z,w) of an axis rotation.
    static double[] Axis(int axis, double a)
    {
        var q = new double[] { 0, 0, 0, Math.Cos(a / 2) };
        q[axis] = Math.Sin(a / 2);
        return q;
    }

    // Hamilton product a*b (apply b first, then a).
    public static double[] Mul(double[] a, double[] b) => new[] {
        a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
        a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
        a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
        a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2] };

    // FRES "EulerXYZ": X applied first, then Y, then Z  =>  R = Rz * Ry * Rx (column vectors).
    // Verified against the inverse bind matrices stored in the file (see GltfExport.CheckBind).
    public static double[] EulerXYZ(double x, double y, double z) => Mul(Axis(2, z), Mul(Axis(1, y), Axis(0, x)));

    // Alternative hypothesis (R = Rx * Ry * Rz), only used for the consistency check.
    public static double[] EulerXYZ_alt(double x, double y, double z) => Mul(Axis(0, x), Mul(Axis(1, y), Axis(2, z)));
}
