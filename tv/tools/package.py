#!/usr/bin/env python3
"""Package the verified deliverables, excluding caches and abandoned drafts."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from manifest import ROOT

manifest = json.loads((ROOT / 'assets-manifest.json').read_text())
assert manifest['complete'] and manifest['assetCount'] == 137
files = {ROOT / a['relativePath'] for a in manifest['assets']}
files.update(p for p in (ROOT / 'assets' / 'previews').rglob('*') if p.is_file())
files.update(p for p in (ROOT / 'tools').rglob('*')
             if p.is_file() and '__pycache__' not in p.parts)
files.update(p for p in ROOT.iterdir() if p.is_file() and p.suffix in ('.json', '.md', '.html'))
archive = ROOT / 'luzbet-tv-assets.zip'
with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=2) as output:
    for file in sorted(files):
        output.write(file, 'tv/' + file.relative_to(ROOT).as_posix())
with ZipFile(archive) as check:
    assert check.testzip() is None
print(json.dumps(dict(archive=str(archive), files=len(files), bytes=archive.stat().st_size)))
