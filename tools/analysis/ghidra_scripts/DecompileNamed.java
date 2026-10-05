import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;

import java.io.File;
import java.io.PrintWriter;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

public class DecompileNamed extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        Pattern pat = Pattern.compile(String.join("|", args[1].split("~")));
        int depth = args.length > 2 ? Integer.parseInt(args[2]) : 0;
        int limit = args.length > 3 ? Integer.parseInt(args[3]) : 400;
        out.getParentFile().mkdirs();

        Map<Function, Integer> picked = new LinkedHashMap<>();
        ArrayDeque<Function> queue = new ArrayDeque<>();
        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        while (it.hasNext()) {
            Function f = it.next();
            if (!f.isThunk() && !f.isExternal() && pat.matcher(f.getName(true)).find()) {
                picked.put(f, 0);
                queue.add(f);
            }
        }
        while (!queue.isEmpty() && picked.size() < limit) {
            Function f = queue.poll();
            int d = picked.get(f);
            if (d >= depth) {
                continue;
            }
            for (Function c : f.getCalledFunctions(monitor)) {
                if (c.isThunk() || c.isExternal() || picked.containsKey(c)) {
                    continue;
                }
                if (!c.getName().startsWith("FUN_")) {
                    continue;
                }
                picked.put(c, d + 1);
                queue.add(c);
            }
        }

        DecompInterface ifc = new DecompInterface();
        ifc.setOptions(new DecompileOptions());
        ifc.openProgram(currentProgram);
        try (PrintWriter w = new PrintWriter(out, "UTF-8")) {
            for (Map.Entry<Function, Integer> e : picked.entrySet()) {
                Function f = e.getKey();
                w.println("// ==== " + f.getEntryPoint() + " " + f.getName(true) + " (depth " + e.getValue() + ")");
                DecompileResults r = ifc.decompileFunction(f, 120, monitor);
                if (r != null && r.decompileCompleted()) {
                    w.println(r.getDecompiledFunction().getC());
                } else {
                    w.println("// decompile failed");
                }
            }
        } finally {
            ifc.dispose();
        }
        println("picked=" + picked.size() + " -> " + out);
    }
}
