# LuzBet TV

Live television at `/tv/`: read-only analytics, fictional newsroom stories, and authorized office-only reconstructions of recorded outcomes.

- `/tv/` — anonymous broadcast.
- `/tv/?office=1` — personalized pages only for a signed-in allowlisted office viewer.
- `/tv/?office=1&preview=1` — preview controls, with identical authorization requirements.

The dashboard rotates every 25 seconds within the existing 8-minute analytical break. News and Replay Engine retain their established timing. No balance, ledger, game mathematics, RNG, RTP or winner-selection changes are made.

See [TV-STATS.md](TV-STATS.md) for API, data provenance, financial limitations, authorization and validation. Presenter assets and newsroom appearance are documented in [ASSETS_README.md](ASSETS_README.md).

Run analytics tests with `node --test tests/tv/*.test.mjs`. Serve the repository with `python3 -m http.server 4173 --bind 127.0.0.1` to preview against the live read-only API. Stress fixtures are available using `python3 tests/tv/preview-server.py`; they are local and explicitly fictional.
