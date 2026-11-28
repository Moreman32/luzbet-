#!/usr/bin/env python3
"""Finalize imagegen RGB frames with its alpha matte; keep RGB source pixels intact."""
import json
import subprocess
import argparse
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def finalize(source, matte, destination, variant=None, roi=None, keep_components=1, matte_is_gray=False):
    # RGB comes from the approved photographic source. Imagegen supplies the matte.
    # This avoids photographic texture changes introduced by background extraction.
    destination.parent.mkdir(parents=True, exist_ok=True)
    cache = ROOT / '.cache' / 'alpha'
    cache.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(Path(matte).read_bytes()).hexdigest()[:20] + '-' + str(keep_components)
    if matte_is_gray:
        key += '-gray'
    clean = cache / (key + '.raw')
    if not clean.exists():
        raw = cache / (key + '-unclean.raw')
        alpha_filter = ('scale=1920:1080:flags=lanczos,format=gray' if matte_is_gray else
                        'format=rgba,scale=1920:1080:flags=lanczos,format=rgba,alphaextract')
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', matte, '-vf', alpha_filter,
                        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', str(raw)],
                       check=True, stderr=subprocess.PIPE)
        subprocess.run(['node', str(ROOT / 'tools' / 'cleanup-alpha.mjs'), str(raw), str(clean), str(keep_components)],
                       check=True, stderr=subprocess.PIPE)
        raw.unlink()
    inputs = ['-i', source, '-f', 'rawvideo', '-pixel_format', 'gray',
              '-video_size', '1920x1080', '-i', str(clean)]
    rgb_filter = '[0:v]scale=1920:1080:flags=lanczos,format=rgb24[rgb];'
    if variant:
        inputs += ['-i', variant]
        x, y, w, h = roi
        rgb_filter = ('[0:v]scale=1920:1080:flags=lanczos,format=rgb24[base];'
            f'[2:v]scale=1920:1080:flags=lanczos,format=rgba,crop={w}:{h}:{x}:{y},'
            "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':"
            "a='255*clip(min(min(X,W-1-X),min(Y,H-1-Y))/8,0,1)'[patch];"
            f'[base][patch]overlay={x}:{y}:format=rgb,format=rgb24[rgb];')
    command = ['ffmpeg', '-y', '-v', 'error'] + inputs + ['-filter_complex', rgb_filter +
        '[1:v]format=gray[alpha];'
        '[rgb][alpha]alphamerge[out]', '-map', '[out]', '-frames:v', '1',
        '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', str(destination)]
    subprocess.run(command, check=True, stderr=subprocess.PIPE)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--pose')
    args = parser.parse_args()
    catalog = json.loads((ROOT / 'source-catalog.json').read_text())
    for record in catalog:
        if args.pose and record['name'] != args.pose:
            continue
        if record.get('matte'):
            matte = record.get('refinedMatte', record['matte'])
            refined = bool(record.get('refinedMatte'))
            finalize(record['source'], matte,
                     ROOT / 'assets' / 'host' / (record['name'] + '-idle.webp'),
                     matte_is_gray=refined)
            for state, variant in record.get('variants', {}).items():
                roi = record['eyesROI'] if state == 'blink' else record['mouthROI']
                finalize(record['source'], matte,
                         ROOT / 'assets' / 'host' / (record['name'] + '-' + state + '.webp'),
                         variant, roi, matte_is_gray=refined)
