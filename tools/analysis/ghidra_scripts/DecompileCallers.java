import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;

import java.io.File;
import java.io.PrintWriter;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Pattern;

public class DecompileCallers extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        Pattern pat = Pattern.compile(String.join("|", args[1].split("~")));
        out.getParentFile().mkdirs();

        Set<Function> callers = new LinkedHashSet<>();
        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        while (it.hasNext()) {
            Function f = it.next();
            if (f.isExternal() || !pat.matcher(f.getName(true)).find()) {
                continue;
            }
            for (Function c : f.getCallingFunctions(monitor)) {
                if (!c.isThunk()) {
                    callers.add(c);
                }
            }
        }

        DecompInterface ifc = new DecompInterface();
        ifc.setOptions(new DecompileOptions());
        ifc.openProgram(currentProgram);
        try (PrintWriter w = new PrintWriter(out, "UTF-8")) {
            for (Function f : callers) {
                w.println("// ==== " + f.getEntryPoint() + " " + f.getName(true));
                DecompileResults r = ifc.decompileFunction(f, 120, monitor);
                w.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
            }
        } finally {
            ifc.dispose();
        }
        println("callers=" + callers.size() + " -> " + out);
    }
}
