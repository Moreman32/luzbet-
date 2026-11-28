#!/usr/bin/env python3
"""Verify real alpha, JSON paths and exact visible-pixel locks across animations."""
import argparse
import json
import subprocess
from pathlib import Path
from manifest import ROOT, build, write_json

def rgba(path):
    return subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
                                   '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])

def outside_differences(base, frame, roi):
    x, y, width, height = roi
    bad = 0
    for row in range(1080):
        offset = row * 1920 * 4
        spans = [(offset, offset + 1920 * 4)]
        if y <= row < y + height:
            spans = [(offset, offset + x * 4),
                     (offset + (x + width) * 4, offset + 1920 * 4)]
        for start, end in spans:
            if base[start:end] == frame[start:end]:
                continue
            for pos in range(start, end, 4):
                # Encoders may optimize hidden RGB under alpha=0. It has no visible effect.
                if (base[pos + 3] or frame[pos + 3]) and base[pos:pos + 4] != frame[pos:pos + 4]:
                    bad += 1
    return bad

def verify(complete):
    manifest = build(complete)
    checks = []
    catalog = json.loads((ROOT / 'source-catalog.json').read_text())
    for record in catalog:
        name = record['name']
        base_path = ROOT / 'assets' / 'host' / (name + '-idle.webp')
        if not base_path.exists() or not record.get('matte'):
            continue
        base = rgba(base_path)
        alpha = base[3::4]
        assert min(alpha) == 0 and max(alpha) == 255, 'Bad alpha: ' + name
        for state in ('talk', 'talk-wide', 'blink'):
            path = ROOT / 'assets' / 'host' / (name + '-' + state + '.webp')
            if not path.exists():
                continue
            frame = rgba(path)
            roi = record['eyesROI'] if state == 'blink' else record['mouthROI']
            bad = outside_differences(base, frame, roi)
            assert bad == 0, f'{name}-{state}: {bad} changed visible pixels outside ROI'
            assert alpha == frame[3::4], f'{name}-{state}: alpha matte changed'
            assert any(base[p:p+4] != frame[p:p+4] for row in range(roi[1], roi[1]+roi[3])
                       for p in range((row*1920+roi[0])*4, (row*1920+roi[0]+roi[2])*4, 4)), \
                       f'{name}-{state}: identical frame'
            checks.append(dict(pose=name, state=state, roi=roi,
                               changedVisiblePixelsOutsideROI=bad, identicalAlpha=True))
    if complete:
        assert len(checks) == 72, f'Expected 72 animation comparisons, got {len(checks)}'
    report = dict(complete=manifest['complete'], assetCount=manifest['assetCount'],
                  animationComparisons=len(checks), checks=checks,
                  limitations=['Semantic likeness, hands and aesthetic quality require visual review.'])
    write_json(ROOT / 'quality-report.json', report)
    print(json.dumps(dict(animationComparisons=len(checks), outsideROIDifferences=0)))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--complete', action='store_true')
    verify(parser.parse_args().complete)
