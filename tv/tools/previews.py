#!/usr/bin/env python3
"""Build a local layered viewer, contact sheets and animation previews."""
import argparse
import json
import math
from pathlib import Path
import subprocess
import tempfile
from manifest import ROOT

FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
OUT = ROOT / 'assets' / 'previews'

def run(args):
    subprocess.run(['ffmpeg', '-y', '-v', 'error'] + args,
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

def sheets(manifest):
    with tempfile.TemporaryDirectory(prefix='luzbet-thumbs-') as temporary:
        temp = Path(temporary)
        selected = [a for a in manifest['assets'] if a['category'] != 'host' or a['state'] == 'idle']
        for i, asset in enumerate(selected):
            label = asset['category'] + ' / ' + asset['id'].removesuffix('-idle')
            filters = '[0:v]scale=320:180[fg];color=c=0x101b2d:s=320x180[bg];' \
                      '[bg][fg]overlay=0:0:shortest=1,' \
                      f"drawtext=fontfile={FONT}:text='{label}':x=8:y=8:fontsize=13:" \
                      'fontcolor=white:box=1:boxcolor=black@0.7[out]'
            run(['-i', str(ROOT / asset['relativePath']), '-filter_complex', filters,
                 '-map', '[out]', '-frames:v', '1', str(temp / f'{i:03}.png')])
        run(['-framerate', '1', '-i', str(temp / '%03d.png'), '-vf',
             f'tile=5x{math.ceil(len(selected)/5)}', '-frames:v', '1',
             '-q:v', '2', str(OUT / 'contact-sheet.jpg')])

def animations(manifest):
    animation_dir = OUT / 'animations'
    animation_dir.mkdir(exist_ok=True)
    poses = sorted({a['pose'] for a in manifest['assets'] if a['category'] == 'host'})
    order = [('idle', .7), ('talk', .14), ('talk-wide', .14), ('talk', .14),
             ('idle', .6), ('blink', .12), ('idle', .7)]
    with tempfile.TemporaryDirectory(prefix='luzbet-animation-') as temporary:
        listing = Path(temporary) / 'frames.txt'
        for pose in poses:
            paths = [(ROOT / 'assets' / 'host' / f'{pose}-{state}.webp', duration)
                     for state, duration in order]
            if not all(path.exists() for path, _ in paths):
                continue
            listing.write_text(''.join(f"file '{path}'\nduration {duration}\n" for path, duration in paths)
                               + f"file '{paths[-1][0]}'\n")
            filters = '[0:v]scale=640:360[fg];color=c=0x101b2d:s=640x360:r=10[bg];' \
                      '[bg][fg]overlay=0:0:shortest=1,fps=10[out]'
            run(['-f', 'concat', '-safe', '0', '-i', str(listing),
                 '-filter_complex', filters, '-map', '[out]', '-c:v', 'libwebp_anim',
                 '-lossless', '1', '-loop', '0', str(animation_dir / f'{pose}.webp')])

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--animations', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'assets-manifest.json').read_text())
    OUT.mkdir(exist_ok=True)
    template = (ROOT / 'tools' / 'preview.template.html').read_text()
    data = json.dumps(manifest, ensure_ascii=False).replace('</', '<\\/')
    (ROOT / 'preview.html').write_text(template.replace('__MANIFEST__', data))
    sheets(manifest)
    if args.animations:
        animations(manifest)
    print('Built preview.html and contact sheets' + (' and animations' if args.animations else ''))
