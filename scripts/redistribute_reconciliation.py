#!/usr/bin/env python3

import argparse
import json
import os
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path

STANDARD_GAMES = [
    "slots",
    "wheel",
    "blackjack",
    "crash",
    "higher_lower",
    "horse",
    "plinko",
    "mines",
    "tower",
    "dice",
    "coinflip",
]


def load_env() -> None:
    env_path = Path(".env")
    if not env_path.exists():
        raise SystemExit(".env not found")
    for line in env_path.read_text().splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value)


def request_json(method: str, url: str, headers: dict[str, str], payload=None):
    data = None
    request_headers = dict(headers)
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
        request_headers["Prefer"] = "return=representation"
    req = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read()
        return json.loads(body) if body else None


def fetch_all(base: str, headers: dict[str, str], table: str, order: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    limit = 1000
    while True:
        query = urllib.parse.urlencode(
            {
                "select": "*",
                "order": order,
                "limit": str(limit),
                "offset": str(offset),
            }
        )
        batch = request_json("GET", f"{base}/{table}?{query}", headers)
        rows.extend(batch)
        if len(batch) < limit:
            return rows
        offset += limit


def split_evenly(total: int, parts: int) -> list[int]:
    if parts <= 0:
        return []
    base = int(total / parts)
    remainder = total - (base * parts)
    shares = [base] * parts
    step = 1 if remainder > 0 else -1
    for idx in range(abs(remainder)):
        shares[idx] += step
    return shares


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def choose_targets(events: list[dict], code: str, cutoff: str) -> list[dict]:
    cutoff_dt = parse_dt(cutoff)
    by_game: dict[str, dict] = {}

    for row in events:
        if str(row.get("code") or "").strip().lower() != code:
            continue
        if str(row.get("event_type") or "") != "round":
            continue
        game = str(row.get("game") or "")
        if game == "system":
            continue
        if str((row.get("meta") or {}).get("status") or "") != "finished":
            continue
        if parse_dt(str(row.get("created_at") or "")) >= cutoff_dt:
            continue

        existing = by_game.get(game)
        if existing is None or int(row.get("id") or 0) > int(existing.get("id") or 0):
            by_game[game] = row

    return [by_game[game] for game in sorted(by_game)]


def build_plan(events: list[dict]) -> list[dict]:
    plan: list[dict] = []
    recon_rows = [
        row
        for row in events
        if str((row.get("meta") or {}).get("source") or "") == "balance_reconciliation"
        and int(row.get("delta") or 0) != 0
    ]

    for recon in recon_rows:
        code = str(recon.get("code") or "").strip().lower()
        delta = int(recon.get("delta") or 0)
        targets = choose_targets(events, code, str(recon.get("created_at") or ""))

        if targets:
            shares = split_evenly(delta, len(targets))
            plan.append(
                {
                    "recon_event_id": int(recon["id"]),
                    "code": code,
                    "delta": delta,
                    "mode": "patch_existing_rounds",
                    "targets": [
                        {
                            "event_id": int(target["id"]),
                            "game": str(target.get("game") or ""),
                            "share": share,
                        }
                        for target, share in zip(targets, shares)
                        if share != 0
                    ],
                }
            )
            continue

        shares = split_evenly(delta, len(STANDARD_GAMES))
        plan.append(
            {
                "recon_event_id": int(recon["id"]),
                "code": code,
                "delta": delta,
                "mode": "insert_synthetic_rounds",
                "targets": [
                    {"game": game, "share": share}
                    for game, share in zip(STANDARD_GAMES, shares)
                    if share != 0
                ],
            }
        )

    return plan


def apply_plan(base: str, headers: dict[str, str], events_by_id: dict[int, dict], plan: list[dict]) -> None:
    for entry in plan:
        recon_id = entry["recon_event_id"]
        code = entry["code"]
        if entry["mode"] == "patch_existing_rounds":
            for target in entry["targets"]:
                row = events_by_id[target["event_id"]]
                share = int(target["share"])
                payload = {
                    "payout": int(row.get("payout") or 0) + share,
                    "delta": int(row.get("delta") or 0) + share,
                }
                query = urllib.parse.urlencode({"id": f"eq.{target['event_id']}"})
                request_json("PATCH", f"{base}/casino_events?{query}", headers, payload)
        else:
            for idx, target in enumerate(entry["targets"], start=1):
                share = int(target["share"])
                payload = {
                    "code": code,
                    "game": target["game"],
                    "event_type": "round",
                    "bet": 0,
                    "payout": max(share, 0),
                    "delta": share,
                    "round_id": f"recon_{recon_id}_{target['game']}_{idx}",
                    "meta": {
                        "status": "finished",
                        "source": "balance_reconciliation_redistributed",
                        "original_reconciliation_event_id": recon_id,
                    },
                }
                request_json("POST", f"{base}/casino_events", headers, payload)

        recon_query = urllib.parse.urlencode({"id": f"eq.{recon_id}"})
        request_json(
            "PATCH",
            f"{base}/casino_events?{recon_query}",
            headers,
            {
                "payout": 0,
                "delta": 0,
                "meta": {
                    **(events_by_id[recon_id].get("meta") or {}),
                    "redistributed": True,
                    "redistribution_mode": entry["mode"],
                },
            },
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Redistribute balance_reconciliation into player game transactions.")
    parser.add_argument("--apply", action="store_true", help="Apply the redistribution to live Supabase data.")
    args = parser.parse_args()

    load_env()
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    events = fetch_all(base, headers, "casino_events", "id.asc")
    events_by_id = {int(row["id"]): row for row in events}
    plan = build_plan(events)
    print(json.dumps({"plan": plan}, ensure_ascii=False, indent=2))

    if args.apply and plan:
        apply_plan(base, headers, events_by_id, plan)
        print("Applied redistribution.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
