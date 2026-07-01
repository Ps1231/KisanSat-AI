#!/usr/bin/env python3
"""
Removes the OLD app.post("/api/chat", ...) handler from server.ts,
keeping the newer app.all("/api/chat", ...) FastAPI proxy.

Run from the folder containing server.ts:
    python3 fix_server_chat.py

Makes a backup at server.ts.bak first.
"""
import re, shutil, sys
from pathlib import Path

f = Path("server.ts")
if not f.exists():
    sys.exit("server.ts not found — run this from the folder that has server.ts")

src = f.read_text()
shutil.copy(f, "server.ts.bak")

lines = src.split("\n")
out = []
i = 0
removed = False
while i < len(lines):
    line = lines[i]
    # Detect the OLD handler: app.post("/api/chat"
    if re.search(r'app\.post\(\s*["\']/api/chat["\']', line):
        # Skip until the matching close of this app.post(...) block.
        # Track brace depth from this line onward.
        depth = 0
        started = False
        while i < len(lines):
            l = lines[i]
            depth += l.count("{") - l.count("}")
            if "{" in l:
                started = True
            i += 1
            # Block ends when braces balance after we've seen the first {
            if started and depth <= 0:
                break
        removed = True
        continue
    out.append(line)
    i += 1

if not removed:
    print("No app.post('/api/chat') found — nothing changed. (Maybe already removed.)")
else:
    f.write_text("\n".join(out))
    print("Removed old app.post('/api/chat') handler. Backup at server.ts.bak")
    # sanity: count remaining /api/chat routes
    remaining = len(re.findall(r'app\.(post|all|get)\(\s*["\']/api/chat["\']', "\n".join(out)))
    print(f"Remaining /api/chat routes: {remaining} (should be 1 — the app.all proxy)")