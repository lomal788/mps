import re
import sys

path, *names = sys.argv[1:]
text = open(path, encoding="utf-8").read()
blocks = re.split(r"(?m)^// ==== ", text)
for b in blocks[1:]:
    head = b.split("\n", 1)[0]
    nm = re.sub(r" \((depth \d+|dec>?|caller of .*)\)$", "", head.split(" ", 1)[1].strip()) if " " in head else head
    if any(nm == n or nm.endswith("::" + n) and "::" in n for n in names):
        print("// ==== " + b.rstrip() + "\n")
