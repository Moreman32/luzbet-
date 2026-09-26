#!/usr/bin/env python3
"""Stamp one cache-busting version on index.html and on EVERY relative ES-module import.
Browsers/CDN cache modules by URL: if only app.js gets a new ?v=, stale copies of memes.js/ui.js
can be mixed with new code and the site fails to boot. Run before each deploy:
    python3 scripts/bump_version.py 2.1.2
"""
import re, sys, pathlib
v = sys.argv[1]
root = pathlib.Path(__file__).resolve().parent.parent
imp = re.compile(r'((?:from|import)\s*\(?\s*"(?:\.{1,2}/)[^"?]+\.js)(?:\?v=[^"]*)?(")')
for p in (root / "assets/js").rglob("*.js"):
    if "vendor" in p.parts: continue
    s = p.read_text(encoding="utf-8")
    n = imp.sub(lambda m: f"{m.group(1)}?v={v}{m.group(2)}", s)
    if n != s: p.write_text(n, encoding="utf-8")
idx = root / "index.html"
s = idx.read_text(encoding="utf-8")
s = re.sub(r'(assets/(?:css/app\.css|js/app\.js|js/boot-guard\.js))(\?v=[^"]*)?"', lambda m: f'{m.group(1)}?v={v}"', s)
idx.write_text(s, encoding="utf-8")
print("version", v)
