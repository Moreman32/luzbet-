#!/usr/bin/env python3
"""Convert imagegen outputs, build manifests and verify TV assets (stdlib + ffmpeg)."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / '.cache' / 'conversion-records.json'

def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

def ingest(records):
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    existing = json.loads(CATALOG.read_text()) if CATALOG.exists() else []
    by_path = {r['relativePath']: r for r in existing}
    for r in records:
        destination = ROOT / 'assets' / r['category'] / (r['name'] + '.webp')
        destination.parent.mkdir(parents=True, exist_ok=True)
        previous = by_path.get(destination.relative_to(ROOT).as_posix(), {})
        if not destination.exists() or previous.get('path') != r['path']:
            run(['ffmpeg', '-y', '-v', 'error', '-i', r['path'], '-vf',
                 'scale=1920:1080:flags=lanczos,setsar=1', '-frames:v', '1',
                 '-c:v', 'libwebp', '-quality', '92', '-compression_level', '6', str(destination)])
        record = dict(r, relativePath=destination.relative_to(ROOT).as_posix())
        record['bytes'] = destination.stat().st_size
        record['sha256'] = hashlib.sha256(destination.read_bytes()).hexdigest()
        by_path[record['relativePath']] = record
    CATALOG.write_text(json.dumps(list(by_path.values()), ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--ingest', type=Path, required=True)
    args = parser.parse_args()
    ingest(json.loads(args.ingest.read_text()))
