import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;

import java.io.File;
import java.io.PrintWriter;

public class ExportFunctions extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        if (out.isDirectory()) {
            out = new File(out, currentProgram.getName() + ".tsv");
        }
        out.getParentFile().mkdirs();
        int total = 0;
        int named = 0;
        try (PrintWriter w = new PrintWriter(out, "UTF-8")) {
            w.println("address\tsize\tname\tsignature");
            FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
            while (it.hasNext()) {
                Function f = it.next();
                total++;
                if (!f.getName().startsWith("FUN_")) {
                    named++;
                }
                w.println(f.getEntryPoint() + "\t" + f.getBody().getNumAddresses() + "\t" + f.getName(true) + "\t" + f.getSignature().getPrototypeString());
            }
        }
        println("functions=" + total + " named=" + named + " -> " + out);
    }
}
