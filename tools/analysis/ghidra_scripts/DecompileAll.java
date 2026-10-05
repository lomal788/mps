import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;

import java.io.File;
import java.io.PrintWriter;

public class DecompileAll extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        if (out.isDirectory()) {
            out = new File(out, currentProgram.getName() + ".c");
        }
        out.getParentFile().mkdirs();
        int timeout = args.length > 1 ? Integer.parseInt(args[1]) : 60;
        DecompInterface ifc = new DecompInterface();
        ifc.setOptions(new DecompileOptions());
        ifc.openProgram(currentProgram);
        int ok = 0;
        int fail = 0;
        try (PrintWriter w = new PrintWriter(out, "UTF-8")) {
            FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
            while (it.hasNext() && !monitor.isCancelled()) {
                Function f = it.next();
                if (f.isThunk() || f.isExternal()) {
                    continue;
                }
                w.println("// ==== " + f.getEntryPoint() + " " + f.getName(true));
                DecompileResults r = ifc.decompileFunction(f, timeout, monitor);
                if (r != null && r.decompileCompleted()) {
                    w.println(r.getDecompiledFunction().getC());
                    ok++;
                } else {
                    w.println("// decompile failed: " + (r == null ? "null" : r.getErrorMessage()));
                    fail++;
                }
            }
        } finally {
            ifc.dispose();
        }
        println("decompiled=" + ok + " failed=" + fail + " -> " + out);
    }
}
