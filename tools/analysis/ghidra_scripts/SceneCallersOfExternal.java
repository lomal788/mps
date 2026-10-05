import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.symbol.Reference;

import java.io.File;
import java.io.PrintWriter;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Pattern;

// 인자: <출력.c> <패턴~패턴>  이름이 패턴에 맞는 함수(썽크·외부 포함)를 부르는 함수를 디컴파일한다.
public class SceneCallersOfExternal extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        out.getParentFile().mkdirs();
        Pattern pat = Pattern.compile(String.join("|", args[1].split("~")));
        Set<Function> picked = new LinkedHashSet<>();
        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        while (it.hasNext()) {
            Function f = it.next();
            if (!pat.matcher(f.getName(true)).find()) continue;
            for (Reference r : getReferencesTo(f.getEntryPoint())) {
                Function c = getFunctionContaining(r.getFromAddress());
                if (c != null && !c.isThunk()) picked.add(c);
            }
            for (Function c : f.getCallingFunctions(monitor)) {
                if (!c.isThunk()) picked.add(c);
            }
        }
        DecompInterface ifc = new DecompInterface();
        ifc.setOptions(new DecompileOptions());
        ifc.openProgram(currentProgram);
        try (PrintWriter w = new PrintWriter(out, "UTF-8")) {
            for (Function f : picked) {
                w.println("// ==== " + f.getEntryPoint() + " " + f.getName(true));
                DecompileResults r = ifc.decompileFunction(f, 120, monitor);
                w.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
            }
        } finally {
            ifc.dispose();
        }
        println("picked=" + picked.size() + " -> " + out);
    }
}
