#!/usr/bin/env python3
"""Finalize reaction cutouts from approved photographic sources and generated mattes."""
import json
from layered import ROOT, finalize

for record in json.loads((ROOT / 'reaction-catalog.json').read_text()):
    finalize(record['source'], record['matte'],
             ROOT / 'assets' / 'reactions' / (record['name'] + '.webp'),
             keep_components=2 if record['name'] == 'cat-assistant' else 1)
