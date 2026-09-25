#!/usr/bin/env python3

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path


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


def canonicalize_events(events: list[dict]) -> list[dict]:
    standalone: list[dict] = []
    rounds: dict[str, dict] = {}

    for event in events:
        code = str(event.get("code") or "").strip().lower()
        round_id = str(event.get("round_id") or "").strip()
        if not code or not round_id:
            standalone.append(event)
            continue

        key = f"{code}|{round_id}"
        current = rounds.get(key)
        if current is None:
            rounds[key] = event
            continue

        current_finished = str((current.get("meta") or {}).get("status") or "") == "finished"
        next_finished = str((event.get("meta") or {}).get("status") or "") == "finished"

        if current_finished != next_finished:
            rounds[key] = event if next_finished else current
            continue

        if int(event.get("id") or 0) >= int(current.get("id") or 0):
            rounds[key] = event

    return sorted(
        [*standalone, *rounds.values()],
        key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)),
    )


def build_expected_state(events: list[dict]) -> dict[str, dict[str, int]]:
    expected: dict[str, dict[str, int]] = defaultdict(lambda: {"coins": 1000, "spent": 0})

    for event in canonicalize_events(events):
        code = str(event.get("code") or "").strip().lower()
        if not code:
            continue
        expected[code]["coins"] += int(event.get("delta") or 0)
        expected[code]["spent"] += int(event.get("bet") or 0)

    return expected


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit and reconcile casino balances against casino_events.")
    parser.add_argument("--apply", action="store_true", help="Write corrected coins/spent back to the casino table.")
    args = parser.parse_args()

    load_env()
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }

    casino_rows = fetch_all(base, headers, "casino", "code.asc")
    event_rows = fetch_all(base, headers, "casino_events", "id.asc")
    expected = build_expected_state(event_rows)

    mismatches: list[dict] = []
    for row in casino_rows:
        code = str(row.get("code") or "").strip().lower()
        target = expected.get(code, {"coins": 1000, "spent": 0})
        current_coins = int(row.get("coins") or 0)
        current_spent = int(row.get("spent") or 0)
        if current_coins == target["coins"] and current_spent == target["spent"]:
            continue
        mismatches.append(
            {
                "code": row.get("code"),
                "name": row.get("name"),
                "current_coins": current_coins,
                "expected_coins": target["coins"],
                "applied_coins": max(0, target["coins"]),
                "current_spent": current_spent,
                "expected_spent": target["spent"],
            }
        )

    print(json.dumps({"mismatches": mismatches}, ensure_ascii=False, indent=2))

    if not args.apply or not mismatches:
        return 0

    for row in mismatches:
        payload = {
            "coins": row["applied_coins"],
            "spent": row["expected_spent"],
        }
        query = urllib.parse.urlencode({"code": f"eq.{row['code']}"})
        request_json("PATCH", f"{base}/casino?{query}", headers, payload)

        if row["applied_coins"] != row["expected_coins"]:
            request_json(
                "POST",
                f"{base}/casino_events",
                headers,
                {
                    "code": row["code"],
                    "game": "system",
                    "event_type": "bonus",
                    "bet": 0,
                    "payout": row["applied_coins"] - row["expected_coins"],
                    "delta": row["applied_coins"] - row["expected_coins"],
                    "meta": {
                        "source": "balance_reconciliation",
                        "reason": "reconcile_casino_nonnegative_clamp",
                    },
                },
            )

    print("Applied reconciliation updates.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
