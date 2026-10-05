// 리듬 분석용 다목적 headless 스크립트.
// args: <out file> <command file>   (out 경로의 {prog} 는 프로그램 이름으로 바뀐다)
// command file 한 줄에 명령 하나:
//   disasm <addr> <end|+len>      주소 범위 디스어셈블리
//   disasmfn <addr|exact name>    함수 전체 디스어셈블리
//   decomp <addr|exact name>      함수 디컴파일 (주소면 그 주소를 포함하는 함수)
//   decompre <regex>              이름이 정규식에 맞는 함수 전부 디컴파일
//   refs <addr>                   주소로의 참조(호출·데이터) 목록과 참조하는 함수
//   refsfn <addr|exact name>      함수 입구로의 참조
//   grepins <regex>               디스어셈블리 문자열이 정규식에 맞는 명령 전부(최대 400)
//   decomprange <start> <end>     입구가 범위 안인 함수 전부 디컴파일
//   callers <regex>               이름이 맞는 함수의 호출자 디컴파일
//   strref <text>                 문자열(정확히 일치하는 C 문자열) 위치와 참조 함수
//   bytes <addr> <len>            원시 바이트
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.Symbol;

import java.io.File;
import java.io.PrintWriter;
import java.nio.file.Files;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

public class RhythmTool extends GhidraScript {
    private DecompInterface ifc;
    private PrintWriter w;

    private Address addr(String s) {
        return currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseUnsignedLong(s.replace("0x", ""), 16));
    }

    private Function fn(String s) {
        if (s.matches("(0x)?[0-9a-fA-F]{8,}")) {
            return getFunctionContaining(addr(s));
        }
        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        while (it.hasNext()) {
            Function f = it.next();
            if (f.getName(true).equals(s)) {
                return f;
            }
        }
        return null;
    }

    private String label(Address a) {
        Symbol s = getSymbolAt(a);
        return s == null ? "" : s.getName(true);
    }

    private void disasm(Address a, Address end) {
        InstructionIterator it = currentProgram.getListing().getInstructions(a, true);
        while (it.hasNext()) {
            Instruction ins = it.next();
            if (ins.getAddress().compareTo(end) >= 0) {
                break;
            }
            String lab = label(ins.getAddress());
            StringBuilder refs = new StringBuilder();
            for (Reference r : ins.getReferencesFrom()) {
                Address to = r.getToAddress();
                String n = label(to);
                Function f = getFunctionAt(to);
                if (f != null) {
                    n = f.getName(true);
                }
                refs.append(" ->").append(to).append(n.isEmpty() ? "" : "(" + n + ")");
            }
            w.println((lab.isEmpty() ? "" : lab + ":\n") + "  " + ins.getAddress() + "  " + ins + refs);
        }
    }

    private void decomp(Function f) {
        if (f == null) {
            w.println("// function not found");
            return;
        }
        w.println("// ==== " + f.getEntryPoint() + " " + f.getName(true));
        DecompileResults r = ifc.decompileFunction(f, 180, monitor);
        w.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
    }

    private void refs(Address a) {
        ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(a);
        while (it.hasNext()) {
            Reference r = it.next();
            Function f = getFunctionContaining(r.getFromAddress());
            w.println("  " + r.getFromAddress() + " " + r.getReferenceType() + " in " + (f == null ? "?" : f.getEntryPoint() + " " + f.getName(true)));
        }
    }

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0].replace("{prog}", currentProgram.getName().replace(".nro", "").replace(".nso", "")));
        out.getParentFile().mkdirs();
        List<String> cmds = Files.readAllLines(new File(args[1]).toPath());
        ifc = new DecompInterface();
        ifc.setOptions(new DecompileOptions());
        ifc.openProgram(currentProgram);
        Memory mem = currentProgram.getMemory();
        try (PrintWriter pw = new PrintWriter(out, "UTF-8")) {
            w = pw;
            for (String line : cmds) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) {
                    continue;
                }
                String[] p = line.split("\\s+", 3);
                w.println("\n######## " + line);
                try {
                    switch (p[0]) {
                        case "disasm": {
                            Address a = addr(p[1]);
                            Address e = p[2].startsWith("+") ? a.add(Long.parseLong(p[2].substring(1).replace("0x", ""), 16)) : addr(p[2]);
                            disasm(a, e);
                            break;
                        }
                        case "disasmfn": {
                            Function f = fn(p[1]);
                            if (f == null) {
                                w.println("// not found");
                            } else {
                                w.println("// " + f.getEntryPoint() + " " + f.getName(true) + " body=" + f.getBody().getMaxAddress());
                                disasm(f.getEntryPoint(), f.getBody().getMaxAddress().add(1));
                            }
                            break;
                        }
                        case "decomp":
                            decomp(fn(p.length > 2 ? p[1] + " " + p[2] : p[1]));
                            break;
                        case "decompre": {
                            Pattern pat = Pattern.compile(p.length > 2 ? p[1] + " " + p[2] : p[1]);
                            FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
                            while (it.hasNext()) {
                                Function f = it.next();
                                if (!f.isExternal() && !f.isThunk() && pat.matcher(f.getName(true)).find()) {
                                    decomp(f);
                                }
                            }
                            break;
                        }
                        case "refs":
                            refs(addr(p[1]));
                            break;
                        case "decomprange": {
                            Address a = addr(p[1]);
                            Address e = addr(p[2]);
                            FunctionIterator it = currentProgram.getFunctionManager().getFunctions(a, true);
                            while (it.hasNext()) {
                                Function f = it.next();
                                if (f.getEntryPoint().compareTo(e) >= 0) {
                                    break;
                                }
                                if (!f.isThunk()) {
                                    decomp(f);
                                }
                            }
                            break;
                        }
                        case "callsite": {
                            // callsite <regex> : 이름이 맞는 함수를 부르는 지점마다 앞 8개 명령
                            Pattern pat = Pattern.compile(p.length > 2 ? p[1] + " " + p[2] : p[1]);
                            FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
                            while (it.hasNext()) {
                                Function f = it.next();
                                if (!pat.matcher(f.getName(true)).find()) {
                                    continue;
                                }
                                ReferenceIterator ri = currentProgram.getReferenceManager().getReferencesTo(f.getEntryPoint());
                                while (ri.hasNext()) {
                                    Reference r = ri.next();
                                    if (!r.getReferenceType().isCall()) {
                                        continue;
                                    }
                                    Function c = getFunctionContaining(r.getFromAddress());
                                    w.println("-- call " + f.getName(true) + " at " + r.getFromAddress() + " in " + (c == null ? "?" : c.getName(true)));
                                    Instruction ins = getInstructionAt(r.getFromAddress());
                                    java.util.ArrayList<String> prev = new java.util.ArrayList<>();
                                    Instruction q = ins;
                                    for (int k = 0; k < 8 && q != null; k++) {
                                        q = q.getPrevious();
                                        if (q != null) {
                                            prev.add(0, "  " + q.getAddress() + "  " + q);
                                        }
                                    }
                                    for (String s2 : prev) {
                                        w.println(s2);
                                    }
                                    w.println("  " + ins.getAddress() + "  " + ins);
                                }
                            }
                            break;
                        }
                        case "grepins": {
                            Pattern pat = Pattern.compile(line.substring(line.indexOf(' ') + 1));
                            InstructionIterator it = currentProgram.getListing().getInstructions(true);
                            int n = 0;
                            while (it.hasNext() && n < 400) {
                                Instruction ins = it.next();
                                String s = ins.toString();
                                if (pat.matcher(s).find()) {
                                    Function f = getFunctionContaining(ins.getAddress());
                                    w.println("  " + ins.getAddress() + "  " + s + "  in " + (f == null ? "?" : f.getEntryPoint() + " " + f.getName(true)));
                                    n++;
                                }
                            }
                            break;
                        }
                        case "refsfn": {
                            Function f = fn(p.length > 2 ? p[1] + " " + p[2] : p[1]);
                            if (f != null) {
                                w.println("// refs to " + f.getEntryPoint() + " " + f.getName(true));
                                refs(f.getEntryPoint());
                            }
                            break;
                        }
                        case "callers": {
                            Pattern pat = Pattern.compile(p.length > 2 ? p[1] + " " + p[2] : p[1]);
                            Set<Function> cs = new LinkedHashSet<>();
                            FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
                            while (it.hasNext()) {
                                Function f = it.next();
                                if (pat.matcher(f.getName(true)).find()) {
                                    for (Function c : f.getCallingFunctions(monitor)) {
                                        cs.add(c);
                                    }
                                }
                            }
                            for (Function c : cs) {
                                w.println("// caller " + c.getEntryPoint() + " " + c.getName(true));
                            }
                            for (Function c : cs) {
                                decomp(c);
                            }
                            break;
                        }
                        case "strref": {
                            String text = line.substring(line.indexOf(' ') + 1);
                            byte[] pat = (text + "\0").getBytes("UTF-8");
                            Address a = mem.getMinAddress();
                            while (true) {
                                a = mem.findBytes(a, pat, null, true, monitor);
                                if (a == null) {
                                    break;
                                }
                                w.println("string @" + a);
                                refs(a);
                                a = a.add(1);
                            }
                            break;
                        }
                        case "bytes": {
                            Address a = addr(p[1]);
                            int n = Integer.parseInt(p[2].replace("0x", ""), 16);
                            byte[] b = new byte[n];
                            mem.getBytes(a, b);
                            StringBuilder sb = new StringBuilder();
                            for (int i = 0; i < n; i++) {
                                if (i % 16 == 0) {
                                    sb.append("\n  ").append(a.add(i)).append(": ");
                                }
                                sb.append(String.format("%02x ", b[i] & 0xff));
                            }
                            w.println(sb);
                            break;
                        }
                        default:
                            w.println("// unknown command");
                    }
                } catch (Exception ex) {
                    w.println("// error " + ex);
                }
                w.flush();
            }
        } finally {
            ifc.dispose();
        }
        println("RhythmTool done -> " + out);
    }
}
