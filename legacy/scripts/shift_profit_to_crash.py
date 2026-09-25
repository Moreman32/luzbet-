#!/usr/bin/env python3

import argparse
import json
import os
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

    for row in events:
        code = str(row.get("code") or "").strip().lower()
        round_id = str(row.get("round_id") or "").strip()
        if not code or not round_id:
            standalone.append(row)
            continue

        key = f"{code}|{round_id}"
        current = rounds.get(key)
        if current is None:
            rounds[key] = row
            continue

        current_finished = str((current.get("meta") or {}).get("status") or "") == "finished"
        next_finished = str((row.get("meta") or {}).get("status") or "") == "finished"
        if current_finished != next_finished:
            rounds[key] = row if next_finished else current
            continue

        if int(row.get("id") or 0) >= int(current.get("id") or 0):
            rounds[key] = row

    return [*standalone, *rounds.values()]


def build_plan(events: list[dict]) -> dict:
    canonical = canonicalize_events(events)
    by_code_game: dict[str, dict[str, list[dict]]]=defaultdict(lambda: defaultdict(list))

    for row in canonical:
        if str(row.get("event_type") or "") != "round":
            continue
        if str(row.get("game") or "") == "system":
            continue
        if str((row.get("meta") or {}).get("status") or "") != "finished":
            continue
        code = str(row.get("code") or "").strip().lower()
        game = str(row.get("game") or "")
        if not code or not game:
            continue
        by_code_game[code][game].append(row)

    event_map = {int(row["id"]): row for row in canonical if row.get("id") is not None}
    reductions = []
    crash_additions = defaultdict(int)
    synthetic_crash = []

    for code, games in by_code_game.items():
        for game, rows in games.items():
            if game == "crash":
                continue
            game_delta = sum(int(row.get("delta") or 0) for row in rows)
            if game_delta <= 0:
                continue

            remaining = game_delta
            payout_rows = sorted(
                [row for row in rows if int(row.get("payout") or 0) > 0],
                key=lambda row: int(row.get("id") or 0),
                reverse=True,
            )
            if not payout_rows:
                raise RuntimeError(f"No payout rows available to reduce for {code}/{game}")

            for row in payout_rows:
                if remaining <= 0:
                    break
                payout = int(row.get("payout") or 0)
                shift = min(remaining, payout)
                reductions.append(
                    {
                        "event_id": int(row["id"]),
                        "code": code,
                        "game": game,
                        "shift": shift,
                    }
                )
                remaining -= shift

            if remaining != 0:
                raise RuntimeError(f"Unable to fully shift profit for {code}/{game}: {remaining}")

            crash_additions[code] += game_delta

    crash_updates = []
    for code, amount in crash_additions.items():
        crash_rows = sorted(
            by_code_game.get(code, {}).get("crash", []),
            key=lambda row: int(row.get("id") or 0),
            reverse=True,
        )
        if crash_rows:
            crash_updates.append(
                {
                    "event_id": int(crash_rows[0]["id"]),
                    "code": code,
                    "shift": amount,
                }
            )
        else:
            synthetic_crash.append(
                {
                    "code": code,
                    "shift": amount,
                }
            )

    per_game_before = defaultdict(int)
    for row in canonical:
        if str(row.get("event_type") or "") != "round":
            continue
        game = str(row.get("game") or "")
        if game == "system":
            continue
        per_game_before[game] += int(row.get("delta") or 0)

    per_game_after = dict(per_game_before)
    for item in reductions:
        per_game_after[item["game"]] -= item["shift"]
    for item in crash_updates:
        per_game_after["crash"] = per_game_after.get("crash", 0) + item["shift"]
    for item in synthetic_crash:
        per_game_after["crash"] = per_game_after.get("crash", 0) + item["shift"]

    return {
        "reductions": reductions,
        "crash_updates": crash_updates,
        "synthetic_crash": synthetic_crash,
        "per_game_before": dict(sorted(per_game_before.items())),
        "per_game_after": dict(sorted(per_game_after.items())),
        "total_shift": sum(item["shift"] for item in crash_updates) + sum(item["shift"] for item in synthetic_crash),
    }


def apply_plan(base: str, headers: dict[str, str], events_by_id: dict[int, dict], plan: dict) -> None:
    for item in plan["reductions"]:
        row = events_by_id[item["event_id"]]
        shift = int(item["shift"])
        payload = {
            "payout": int(row.get("payout") or 0) - shift,
            "delta": int(row.get("delta") or 0) - shift,
        }
        query = urllib.parse.urlencode({"id": f"eq.{item['event_id']}"})
        request_json("PATCH", f"{base}/casino_events?{query}", headers, payload)

    for item in plan["crash_updates"]:
        row = events_by_id[item["event_id"]]
        shift = int(item["shift"])
        payload = {
            "payout": int(row.get("payout") or 0) + shift,
            "delta": int(row.get("delta") or 0) + shift,
        }
        query = urllib.parse.urlencode({"id": f"eq.{item['event_id']}"})
        request_json("PATCH", f"{base}/casino_events?{query}", headers, payload)

    for index, item in enumerate(plan["synthetic_crash"], start=1):
        shift = int(item["shift"])
        request_json(
            "POST",
            f"{base}/casino_events",
            headers,
            {
                "code": item["code"],
                "game": "crash",
                "event_type": "round",
                "bet": 0,
                "payout": shift,
                "delta": shift,
                "round_id": f"profit_shift_crash_{item['code']}_{index}",
                "meta": {
                    "status": "finished",
                    "source": "profit_shift_to_crash",
                },
            },
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Shift all positive non-crash game profit into crash.")
    parser.add_argument("--apply", action="store_true", help="Apply the shift to live data.")
    args = parser.parse_args()

    load_env()
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    events = fetch_all(base, headers, "casino_events", "id.asc")
    plan = build_plan(events)
    print(json.dumps(plan, ensure_ascii=False, indent=2))

    if args.apply:
        canonical = canonicalize_events(events)
        events_by_id = {int(row["id"]): row for row in canonical if row.get("id") is not None}
        apply_plan(base, headers, events_by_id, plan)
        print("Applied crash profit shift.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
