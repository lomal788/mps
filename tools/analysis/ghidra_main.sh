#!/bin/sh
# usage: web/tools/analysis/ghidra_main.sh   (main.nso 가져오기 + 분석 + 함수 목록)
cd F:/dev/mps
GHIDRA_HEADLESS_MAXMEM=16G MSYS_NO_PATHCONV=1 ./tools/ghidra_12.1.2_PUBLIC/support/analyzeHeadless.bat F:/dev/mps/ghidra_proj mps_main -import F:/dev/mps/ghidra_proj/main.nso -overwrite -scriptPath F:/dev/mps/web/tools/analysis/ghidra_scripts -postScript ExportFunctions.java F:/dev/mps/analysis/functions > ghidra_proj/main.log 2>&1
