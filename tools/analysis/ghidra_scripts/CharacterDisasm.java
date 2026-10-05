import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.symbol.Reference;

import java.io.File;
import java.io.PrintWriter;

public class CharacterDisasm extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        out.getParentFile().mkdirs();
        try (PrintWriter w = new PrintWriter(out, "UTF-8")) {
            for (int i = 1; i < args.length; i++) {
                Address a = toAddr(Long.parseUnsignedLong(args[i], 16));
                Function f = getFunctionContaining(a);
                if (f == null) {
                    w.println("// ==== " + args[i] + " no function");
                    continue;
                }
                w.println("// ==== " + f.getEntryPoint() + " " + f.getName(true));
                InstructionIterator it = currentProgram.getListing().getInstructions(f.getBody(), true);
                while (it.hasNext()) {
                    Instruction ins = it.next();
                    StringBuilder sb = new StringBuilder();
                    sb.append(ins.getAddress()).append("  ").append(ins.toString());
                    for (Reference r : ins.getReferencesFrom()) {
                        if (r.getReferenceType().isCall()) {
                            Function c = getFunctionAt(r.getToAddress());
                            if (c != null) {
                                sb.append("    ; ").append(c.getName(true));
                            }
                        } else if (r.getReferenceType().isData()) {
                            sb.append("    ; ->").append(r.getToAddress());
                        }
                    }
                    w.println(sb);
                }
            }
        }
        println("disasm -> " + out);
    }
}
