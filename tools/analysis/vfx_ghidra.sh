#!/bin/sh
# usage: web/tools/analysis/vfx_ghidra.sh <출력파일> <CoreTool 명령...>   (ghidra_work/vfx 복사본의 main.nso 대상, 읽기 전용)
out=$1; shift
cd F:/dev/mps
MSYS_NO_PATHCONV=1 ./tools/ghidra_12.1.2_PUBLIC/support/analyzeHeadless.bat F:/dev/mps/ghidra_work/vfx mps_main -process main.nso -noanalysis -readOnly -scriptPath F:/dev/mps/web/tools/analysis/ghidra_scripts -postScript CoreTool.java F:/dev/mps/analysis/decomp/$out "$@" > ghidra_work/vfx/last.log 2>&1
grep -E "CoreTool done|ERROR|Exception" ghidra_work/vfx/last.log | head -5
