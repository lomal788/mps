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
import java.util.LinkedHashSet;
import java.util.Set;

/*
 * 여러 명령을 한 번에 처리한다. args[0] = 출력 파일, 나머지 = 명령.
 *   dec:ADDR[:DEPTH]   ADDR 를 포함하는 함수 디컴파일(+ FUN_ 피호출 DEPTH 단계)
 *   range:A-B          [A,B) 안에서 시작하는 함수 전부 디컴파일
 *   dis:A-B            [A,B) 디스어셈블리
 *   disf:ADDR          ADDR 를 포함하는 함수 전체 디스어셈블리
 *   refs:ADDR          ADDR 로 오는 참조(위치, 함수, 명령)
 *   callers:ADDR       ADDR 함수를 부르는 함수 디컴파일
 *   ptrs:ADDR:N        ADDR 부터 8바이트 포인터 N 개(가리키는 심볼)
 *   srch:A-B:IMM       [A,B) 명령 중 피연산자 문자열에 IMM 이 들어간 것
 *   vtdec:ADDR:N[:D]   vtable ADDR 의 포인터 N 개가 가리키는 함수 디컴파일(-readOnly 라 새 함수는 저장 안 됨)
 *   vtgot:GOT:N[:D]    GOT 칸이 가리키는 값 + 0x10 을 vtable 시작으로 보고 vtdec
 *   fdec:ADDR[:DEPTH]  ADDR 에 함수가 없으면 만들어(-readOnly 라 저장 안 됨) dec
 */
public class CoreTool extends GhidraScript {
    private DecompInterface ifc;
    private PrintWriter w;
    private final Set<Function> done = new LinkedHashSet<>();

    private Address a(String s) {
        if (!s.startsWith("0x")) s = "0x" + s;
        return toAddr(s);
    }

    private String fname(Address ad) {
        Function f = getFunctionContaining(ad);
        if (f != null) return f.getName(true) + "+0x" + Long.toHexString(ad.subtract(f.getEntryPoint()));
        Symbol s = getSymbolAt(ad);
        return s != null ? s.getName(true) : "?";
    }

    private void decomp(Function f, int depth, String tag) throws Exception {
        if (f == null || done.contains(f)) return;
        done.add(f);
        w.println("// ==== " + f.getEntryPoint() + " " + f.getName(true) + " (" + tag + ")");
        DecompileResults r = ifc.decompileFunction(f, 180, monitor);
        w.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
        if (depth > 0) {
            for (Function c : f.getCalledFunctions(monitor)) {
                if (c.isExternal()) continue;
                if (c.isThunk()) c = c.getThunkedFunction(true);
                if (c == null || !c.getName().startsWith("FUN_")) continue;
                decomp(c, depth - 1, tag + ">");
            }
        }
    }

    private void dis(Address s, Address e) {
        InstructionIterator it = currentProgram.getListing().getInstructions(s, true);
        while (it.hasNext()) {
            Instruction ins = it.next();
            if (ins.getAddress().compareTo(e) >= 0) break;
            StringBuilder sb = new StringBuilder();
            sb.append(ins.getAddress()).append("  ").append(ins.toString());
            for (Reference r : ins.getReferencesFrom()) {
                sb.append("   ; -> ").append(r.getToAddress()).append(" ").append(fname(r.getToAddress()));
            }
            w.println(sb);
        }
    }

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        File out = new File(args[0]);
        out.getParentFile().mkdirs();
        ifc = new DecompInterface();
        ifc.setOptions(new DecompileOptions());
        ifc.openProgram(currentProgram);
        Memory mem = currentProgram.getMemory();
        try (PrintWriter pw = new PrintWriter(out, "UTF-8")) {
            w = pw;
            for (int i = 1; i < args.length; i++) {
                String cmd = args[i];
                String[] p = cmd.split(":");
                w.println("// ######## " + cmd);
                try {
                    switch (p[0]) {
                        case "dec": {
                            int d = p.length > 2 ? Integer.parseInt(p[2]) : 0;
                            Function f = getFunctionContaining(a(p[1]));
                            if (f == null) { w.println("// no function at " + p[1]); break; }
                            done.remove(f);
                            decomp(f, d, "dec");
                            break;
                        }
                        case "fdec": {
                            int d = p.length > 2 ? Integer.parseInt(p[2]) : 0;
                            Function f = getFunctionContaining(a(p[1]));
                            if (f == null) {
                                disassemble(a(p[1]));
                                try { f = createFunction(a(p[1]), null); } catch (Exception ex) { f = null; }
                            }
                            if (f == null) { w.println("// cannot create function at " + p[1]); break; }
                            done.remove(f);
                            decomp(f, d, "fdec");
                            break;
                        }
                        case "range": {
                            String[] r = p[1].split("-");
                            Address s = a(r[0]), e = a(r[1]);
                            FunctionIterator it = currentProgram.getFunctionManager().getFunctions(s, true);
                            while (it.hasNext()) {
                                Function f = it.next();
                                if (f.getEntryPoint().compareTo(e) >= 0) break;
                                if (f.isThunk()) continue;
                                decomp(f, 0, "range");
                            }
                            break;
                        }
                        case "dis": {
                            String[] r = p[1].split("-");
                            dis(a(r[0]), a(r[1]));
                            break;
                        }
                        case "disf": {
                            Function f = getFunctionContaining(a(p[1]));
                            if (f == null) { w.println("// no function"); break; }
                            w.println("// function " + f.getName(true) + " " + f.getBody());
                            dis(f.getBody().getMinAddress(), f.getBody().getMaxAddress().add(1));
                            break;
                        }
                        case "refs": {
                            ReferenceIterator it = currentProgram.getReferenceManager().getReferencesTo(a(p[1]));
                            int n = 0;
                            while (it.hasNext() && n < 2000) {
                                Reference r = it.next();
                                Instruction ins = getInstructionAt(r.getFromAddress());
                                w.println(r.getFromAddress() + "  " + r.getReferenceType() + "  " + fname(r.getFromAddress())
                                        + "  " + (ins != null ? ins.toString() : ""));
                                n++;
                            }
                            w.println("// refs=" + n);
                            break;
                        }
                        case "callers": {
                            Function t = getFunctionContaining(a(p[1]));
                            if (t == null) break;
                            for (Function c : t.getCallingFunctions(monitor)) {
                                done.remove(c);
                                decomp(c, 0, "caller of " + t.getName(true));
                            }
                            break;
                        }
                        case "ptrs": {
                            Address s = a(p[1]);
                            int n = Integer.parseInt(p[2]);
                            for (int k = 0; k < n; k++) {
                                Address ad = s.add(8L * k);
                                long v = mem.getLong(ad);
                                Address t = toAddr(v);
                                w.println(ad + "  [+0x" + Long.toHexString(8L * k) + "]  0x" + Long.toHexString(v) + "  " + (v != 0 ? fname(t) : ""));
                            }
                            break;
                        }
                        case "vtgot":
                        case "vtdec": {
                            Address s = a(p[1]);
                            if (p[0].equals("vtgot")) {
                                s = toAddr(mem.getLong(s) + 0x10);
                                w.println("// vtable " + s);
                            }
                            int n = Integer.parseInt(p[2]);
                            int d = p.length > 3 ? Integer.parseInt(p[3]) : 0;
                            for (int k = 0; k < n; k++) {
                                long v = mem.getLong(s.add(8L * k));
                                if (v == 0) continue;
                                Address t = toAddr(v);
                                Function f = getFunctionAt(t);
                                if (f == null) {
                                    try { f = createFunction(t, null); } catch (Exception ex) { f = null; }
                                }
                                w.println("// vt[+0x" + Long.toHexString(8L * k) + "] -> " + t + " " + (f != null ? f.getName(true) : "(no function)"));
                                if (f != null) { done.remove(f); decomp(f, d, "vt+0x" + Long.toHexString(8L * k)); }
                            }
                            break;
                        }
                        case "srch": {
                            String[] r = p[1].split("-");
                            Address s = a(r[0]), e = a(r[1]);
                            String imm = p[2];
                            InstructionIterator it = currentProgram.getListing().getInstructions(s, true);
                            int n = 0;
                            while (it.hasNext() && n < 5000) {
                                Instruction ins = it.next();
                                if (ins.getAddress().compareTo(e) >= 0) break;
                                String t = ins.toString();
                                if (t.contains(imm)) {
                                    w.println(ins.getAddress() + "  " + fname(ins.getAddress()) + "  " + t);
                                    n++;
                                }
                            }
                            w.println("// hits=" + n);
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
        println("CoreTool done -> " + out);
    }
}
