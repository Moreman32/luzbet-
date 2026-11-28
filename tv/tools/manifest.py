#!/usr/bin/env python3
"""Build truthful manifests from existing assets. --complete requires all 137 files."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATES = {'idle': 'idle', 'talk': 'talk', 'talkWide': 'talk-wide', 'blink': 'blink'}

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def build(complete=False):
    spec = json.loads((ROOT / 'asset-spec.json').read_text())
    host, assets, missing = {}, [], []
    for category, items in spec.items():
        for item in items:
            states = STATES.items() if category == 'host' else [(None, None)]
            for key, suffix in states:
                name = item['name'] + ('-' + suffix if suffix else '')
                path = ROOT / 'assets' / category / (name + '.webp')
                relative = path.relative_to(ROOT).as_posix()
                if not path.exists():
                    missing.append(relative)
                    continue
                metadata = json.loads(subprocess.check_output([
                    'ffprobe', '-v', 'error', '-select_streams', 'v:0',
                    '-show_entries', 'stream=width,height,pix_fmt', '-of', 'json', str(path)
                ]))['streams'][0]
                assert (metadata['width'], metadata['height']) == (1920, 1080), relative
                alpha = metadata['pix_fmt'] in ('argb', 'rgba', 'bgra', 'yuva420p')
                assert category not in ('host', 'reactions') or alpha, 'Missing alpha: ' + relative
                entry = dict(id=name, category=category, relativePath=relative,
                             purpose=item['purpose'], width=1920, height=1080,
                             format='webp', alpha=alpha, bytes=path.stat().st_size,
                             sha256=hashlib.sha256(path.read_bytes()).hexdigest())
                if key:
                    entry.update(pose=item['name'], state=key)
                    host.setdefault(item['name'], {})[key] = relative
                if category == 'intros':
                    entry['overlayTitle'] = item['purpose']
                    entry['titleSafeArea'] = [0.15, 0.35, 0.70, 0.30]
                assets.append(entry)
    write_json(ROOT / 'host.json', host)
    result = dict(schemaVersion=1, canvas=dict(width=1920, height=1080, aspectRatio='16:9'),
                  layering=dict(background='studios', foreground='host', blending='source-over',
                                sharedCanvas=True, hostHasAlpha=True),
                  generator='built-in image_gen; deterministic FFmpeg finalization',
                  expectedAssetCount=137, assetCount=len(assets),
                  complete=not missing, missing=missing, assets=assets)
    write_json(ROOT / 'assets-manifest.json', result)
    if complete:
        assert not missing, 'Missing assets: ' + ', '.join(missing)
        assert len(host) == 24 and all(len(v) == 4 for v in host.values())
    print(json.dumps(dict(created=len(assets), expected=137, missing=len(missing),
                          bytes=sum(a['bytes'] for a in assets))))
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--complete', action='store_true')
    build(parser.parse_args().complete)
