#!/bin/sh
# usage: web/tools/analysis/ghidra_group.sh <group index>   (ghidra_proj/group#.txt 의 NRO 가져오기 + 분석 + 함수 목록)
cd F:/dev/mps
i=$1
args=""
for f in $(cat ghidra_proj/group$i.txt); do args="$args -import F:/dev/mps/extracted/romfs/nro/NX_Release/$f"; done
GHIDRA_HEADLESS_MAXMEM=6G MSYS_NO_PATHCONV=1 ./tools/ghidra_12.1.2_PUBLIC/support/analyzeHeadless.bat F:/dev/mps/ghidra_proj g$i $args -overwrite -scriptPath F:/dev/mps/web/tools/analysis/ghidra_scripts -postScript ExportFunctions.java F:/dev/mps/analysis/functions > ghidra_proj/g$i.log 2>&1
