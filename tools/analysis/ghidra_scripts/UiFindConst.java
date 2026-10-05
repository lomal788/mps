import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.Reference;

import java.io.File;
import java.io.PrintWriter;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * 32비트 상수(AArch64 movz/movk 두 반쪽) 또는 메모리의 ASCII 문자열을 쓰는 함수를 찾아 디컴파일한다.
 * 인자: out.c  값들(~ 구분; 0x로 시작하면 32비트 상수, 아니면 문자열)  [최대 함수 수]
 */
public class UiFindConst extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        String[] vals = args[1].split("~");
        int limit = args.length > 2 ? Integer.parseInt(args[2]) : 60;
        Map<Function, String> hits = new LinkedHashMap<>();
        for (String v : vals) {
            if (v.startsWith("0x")) {
                long c = Long.parseLong(v.substring(2), 16);
                long lo = c & 0xFFFF, hi = (c >> 16) & 0xFFFF;
                Map<Function, Integer> seen = new LinkedHashMap<>();
                InstructionIterator it = currentProgram.getListing().getInstructions(true);
                while (it.hasNext() && !monitor.isCancelled()) {
                    Instruction ins = it.next();
                    for (int i = 0; i < ins.getNumOperands(); i++) {
                        Scalar s = ins.getScalar(i);
                        if (s == null) continue;
                        long u = s.getUnsignedValue();
                        int bit = 0;
                        if (u == lo) bit = 1;
                        if (u == hi || u == (hi << 16)) bit = 2;
                        if (u == c) bit = 3;
                        if (bit == 0) continue;
                        Function f = getFunctionContaining(ins.getAddress());
                        if (f == null) continue;
                        seen.merge(f, bit, (a, b) -> a | b);
                    }
                }
                for (Map.Entry<Function, Integer> e : seen.entrySet()) {
                    if (e.getValue() == 3) hits.merge(e.getKey(), v, (a, b) -> a + "," + b);
                }
            } else {
                byte[] pat = v.getBytes("ASCII");
                Address a = currentProgram.getMinAddress();
                int n = 0;
                while (a != null && n < 50) {
                    a = currentProgram.getMemory().findBytes(a, pat, null, true, monitor);
                    if (a == null) break;
                    for (Reference r : getReferencesTo(a)) {
                        Function f = getFunctionContaining(r.getFromAddress());
                        if (f != null) hits.merge(f, "\"" + v + "\"@" + a, (x, y) -> x + "," + y);
                    }
                    a = a.add(1);
                    n++;
                }
            }
        }
        DecompInterface ifc = new DecompInterface();
        ifc.setOptions(new DecompileOptions());
        ifc.openProgram(currentProgram);
        out.getParentFile().mkdirs();
        int k = 0;
        try (PrintWriter w = new PrintWriter(out, "UTF-8")) {
            for (Map.Entry<Function, String> e : hits.entrySet()) {
                w.println("// ==== " + e.getKey().getEntryPoint() + " " + e.getKey().getName(true) + " hits " + e.getValue());
                if (k++ >= limit) continue;
                DecompileResults r = ifc.decompileFunction(e.getKey(), 120, monitor);
                w.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
            }
        } finally {
            ifc.dispose();
        }
        println("hits=" + hits.size() + " -> " + out);
    }
}
