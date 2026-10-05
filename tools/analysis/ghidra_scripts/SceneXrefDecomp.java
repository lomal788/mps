import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;

import java.io.File;
import java.io.PrintWriter;
import java.util.LinkedHashMap;
import java.util.Map;

// 인자: <출력.c> <주소~주소...>  주소(데이터)를 참조하는 함수를 모아 디컴파일한다.
public class SceneXrefDecomp extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        out.getParentFile().mkdirs();
        Map<Function, String> picked = new LinkedHashMap<>();
        for (String a : args[1].split("~")) {
            Address addr = toAddr(Long.parseUnsignedLong(a.replace("0x", ""), 16));
            for (Reference r : getReferencesTo(addr)) {
                Function f = getFunctionContaining(r.getFromAddress());
                if (f != null && !picked.containsKey(f)) {
                    picked.put(f, a + " <- " + r.getFromAddress());
                }
            }
        }
        DecompInterface ifc = new DecompInterface();
        ifc.setOptions(new DecompileOptions());
        ifc.openProgram(currentProgram);
        try (PrintWriter w = new PrintWriter(out, "UTF-8")) {
            for (Map.Entry<Function, String> e : picked.entrySet()) {
                Function f = e.getKey();
                w.println("// ==== " + f.getEntryPoint() + " " + f.getName(true) + " (xref " + e.getValue() + ")");
                DecompileResults r = ifc.decompileFunction(f, 120, monitor);
                w.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
            }
        } finally {
            ifc.dispose();
        }
        println("picked=" + picked.size() + " -> " + out);
    }
}
