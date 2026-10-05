import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.Symbol;

import java.io.File;
import java.io.PrintWriter;
import java.util.LinkedHashSet;
import java.util.Set;

// args: out item...
//   d:<hex>        decompile the function containing <hex>
//   r:<hex>        list references to <hex>; decompile each referencing function
//   m:<hex>:<n>    dump n qwords at <hex> with symbol of each target
//   x:<hex>:<n>    disassemble n instructions from <hex>
//   f:<hex>        create a function at <hex> (in memory only, read-only project) and decompile it
public class CameraRefs extends GhidraScript {
    private DecompInterface ifc;
    private final Set<Function> done = new LinkedHashSet<>();

    private void decomp(PrintWriter w, Function f) {
        if (f == null || done.contains(f)) {
            return;
        }
        done.add(f);
        w.println("// ==== " + f.getEntryPoint() + " " + f.getName(true));
        DecompileResults r = ifc.decompileFunction(f, 180, monitor);
        w.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
    }

    private String sym(Address a) {
        Function f = getFunctionAt(a);
        if (f != null) {
            return f.getName(true);
        }
        Symbol s = getSymbolAt(a);
        return s != null ? s.getName(true) : "";
    }

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        out.getParentFile().mkdirs();
        ifc = new DecompInterface();
        ifc.setOptions(new DecompileOptions());
        ifc.openProgram(currentProgram);
        try (PrintWriter w = new PrintWriter(out, "UTF-8")) {
            for (int i = 1; i < args.length; i++) {
                String[] p = args[i].split(":");
                Address a = toAddr(Long.parseUnsignedLong(p[1], 16));
                if (p[0].equals("d")) {
                    decomp(w, getFunctionContaining(a));
                } else if (p[0].equals("r")) {
                    w.println("// ---- refs to " + a + " " + sym(a));
                    for (Reference ref : getReferencesTo(a)) {
                        Function f = getFunctionContaining(ref.getFromAddress());
                        w.println("//   from " + ref.getFromAddress() + " " + ref.getReferenceType() + " " + (f != null ? f.getName(true) : "(data) " + sym(ref.getFromAddress())));
                    }
                    for (Reference ref : getReferencesTo(a)) {
                        decomp(w, getFunctionContaining(ref.getFromAddress()));
                    }
                } else if (p[0].equals("x")) {
                    int n = Integer.parseInt(p[2]);
                    w.println("// ---- disasm " + a);
                    ghidra.program.model.listing.Instruction ins = getInstructionAt(a);
                    if (ins == null) {
                        disassemble(a);
                        ins = getInstructionAt(a);
                    }
                    for (int k = 0; k < n && ins != null; k++) {
                        w.println("//   " + ins.getAddress() + "  " + ins + "    " + sym(ins.getAddress()));
                        ins = ins.getNext();
                    }
                } else if (p[0].equals("f")) {
                    Function f = getFunctionAt(a);
                    if (f == null) {
                        disassemble(a);
                        f = createFunction(a, null);
                    }
                    decomp(w, f);
                } else if (p[0].equals("m")) {
                    int n = Integer.parseInt(p[2]);
                    w.println("// ---- mem " + a + " " + sym(a));
                    for (int k = 0; k < n; k++) {
                        Address q = a.add(8L * k);
                        long v = getLong(q);
                        String s = "";
                        try {
                            s = sym(toAddr(v));
                        } catch (Exception e) {
                            s = "";
                        }
                        w.println(String.format("//   %s +0x%03x: %016x %s", q, 8 * k, v, s));
                    }
                }
            }
        } finally {
            ifc.dispose();
        }
        println("CameraRefs -> " + out + " functions=" + done.size());
    }
}
