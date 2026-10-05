import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Symbol;

import java.io.File;
import java.io.PrintWriter;
import java.util.LinkedHashSet;
import java.util.Set;

// args: out.c  item...
//   item = hex address            -> decompile the function containing it
//   item = ptr:hexaddr:count      -> print count 8-byte pointers at hexaddr (vtable dump) and decompile each target
//   item = name:exact::name       -> decompile all functions with that exact full name
public class CharacterDecompAddr extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        out.getParentFile().mkdirs();
        Set<Function> funcs = new LinkedHashSet<>();
        StringBuilder head = new StringBuilder();
        for (int i = 1; i < args.length; i++) {
            String a = args[i];
            if (a.startsWith("ptr:")) {
                String[] p = a.split(":");
                Address base = toAddr(Long.parseUnsignedLong(p[1], 16));
                int n = Integer.parseInt(p[2]);
                head.append("// ptr table ").append(base).append("\n");
                for (int k = 0; k < n; k++) {
                    Address at = base.add(8L * k);
                    long v = getLong(at);
                    Address t = toAddr(v);
                    Function f = getFunctionAt(t);
                    if (f == null) f = getFunctionContaining(t);
                    head.append("//   [").append(k).append("] +0x").append(Integer.toHexString(8 * k)).append(" ")
                        .append(Long.toHexString(v)).append(" ").append(f == null ? "-" : f.getName(true)).append("\n");
                    if (f != null && !f.isExternal()) funcs.add(f);
                }
            } else if (a.startsWith("name:")) {
                String n = a.substring(5);
                for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
                    if (f.getName(true).equals(n)) funcs.add(f);
                }
            } else {
                Function f = getFunctionContaining(toAddr(Long.parseUnsignedLong(a, 16)));
                if (f != null) funcs.add(f);
                else head.append("// no function at ").append(a).append("\n");
            }
        }
        DecompInterface ifc = new DecompInterface();
        ifc.setOptions(new DecompileOptions());
        ifc.openProgram(currentProgram);
        try (PrintWriter w = new PrintWriter(out, "UTF-8")) {
            w.print(head);
            for (Function f : funcs) {
                w.println("// ==== " + f.getEntryPoint() + " " + f.getName(true));
                DecompileResults r = ifc.decompileFunction(f, 120, monitor);
                w.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
            }
        } finally {
            ifc.dispose();
        }
        println("decomp " + funcs.size() + " -> " + out);
    }
}
