#!/bin/sh
# usage: web/tools/analysis/sound_ghidra.sh <출력파일> <CoreTool 명령...>   (main.nso 복사본 ghidra_work/sound, 병렬 작업 잠금 회피)
out=$1; shift
cd F:/dev/mps
unset JAVA_HOME
MSYS_NO_PATHCONV=1 ./tools/ghidra_12.1.2_PUBLIC/support/analyzeHeadless.bat F:/dev/mps/ghidra_work/sound mps_main -process main.nso -noanalysis -readOnly -scriptPath F:/dev/mps/web/tools/analysis/ghidra_scripts -postScript CoreTool.java F:/dev/mps/analysis/decomp/$out "$@" > ghidra_work/sound/last.log 2>&1
grep -E "CoreTool done|ERROR|Exception" ghidra_work/sound/last.log | head -5
