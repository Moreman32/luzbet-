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


def cleaned_reconciliation_meta(meta: dict | None) -> dict:
    next_meta = dict(meta or {})
    next_meta.pop("redistributed", None)
    next_meta.pop("redistribution_mode", None)
    return next_meta


def build_plan(events: list[dict]) -> dict:
    by_id = {int(row["id"]): row for row in events if row.get("id") is not None}

    redistributed_rows = [
        row for row in events
        if str((row.get("meta") or {}).get("source") or "") == "balance_reconciliation_redistributed"
    ]
    redistributed_by_original: dict[int, list[dict]] = defaultdict(list)
    for row in redistributed_rows:
        original_id = int((row.get("meta") or {}).get("original_reconciliation_event_id") or 0)
        if original_id:
            redistributed_by_original[original_id].append(row)

    reconciliation_rows = [
        row for row in events
        if str((row.get("meta") or {}).get("source") or "") == "balance_reconciliation"
        and bool((row.get("meta") or {}).get("redistributed"))
    ]

    original_restores = []
    unresolved_patch_existing = []
    for row in reconciliation_rows:
        event_id = int(row["id"])
        meta = row.get("meta") or {}
        mode = str(meta.get("redistribution_mode") or "")
        linked_rows = redistributed_by_original.get(event_id, [])
        restored_delta = sum(int(item.get("delta") or 0) for item in linked_rows)
        restored_payout = sum(int(item.get("payout") or 0) for item in linked_rows)

        if linked_rows:
            original_restores.append(
                {
                    "event_id": event_id,
                    "mode": mode,
                    "code": row.get("code"),
                    "restore_delta": restored_delta,
                    "restore_payout": restored_payout if restored_payout or restored_delta >= 0 else 0,
                    "meta": cleaned_reconciliation_meta(meta),
                }
            )
        elif mode == "patch_existing_rounds":
            unresolved_patch_existing.append(
                {
                    "event_id": event_id,
                    "code": row.get("code"),
                    "mode": mode,
                    "created_at": row.get("created_at"),
                }
            )

    profit_shift_rows = [
        row for row in events
        if str((row.get("meta") or {}).get("source") or "") == "profit_shift_to_crash"
    ]

    return {
        "delete_profit_shift_ids": [int(row["id"]) for row in profit_shift_rows],
        "delete_redistributed_ids": [int(row["id"]) for row in redistributed_rows],
        "restore_reconciliation_rows": original_restores,
        "unresolved_patch_existing": unresolved_patch_existing,
        "summary": {
            "profit_shift_rows": len(profit_shift_rows),
            "profit_shift_total_delta": sum(int(row.get("delta") or 0) for row in profit_shift_rows),
            "redistributed_rows": len(redistributed_rows),
            "redistributed_total_delta": sum(int(row.get("delta") or 0) for row in redistributed_rows),
            "reconciliation_rows_to_restore": len(original_restores),
            "patch_existing_rows_unresolved": len(unresolved_patch_existing),
        },
        "event_exists_check": {
            "profit_shift_missing": [event_id for event_id in [int(row["id"]) for row in profit_shift_rows] if event_id not in by_id],
        },
    }


def apply_plan(base: str, headers: dict[str, str], plan: dict) -> None:
    for item in plan["restore_reconciliation_rows"]:
        query = urllib.parse.urlencode({"id": f"eq.{item['event_id']}"})
        payload = {
            "payout": int(item["restore_payout"]),
            "delta": int(item["restore_delta"]),
            "meta": item["meta"],
        }
        request_json("PATCH", f"{base}/casino_events?{query}", headers, payload)

    for event_id in plan["delete_redistributed_ids"]:
        query = urllib.parse.urlencode({"id": f"eq.{event_id}"})
        request_json("DELETE", f"{base}/casino_events?{query}", headers)

    for event_id in plan["delete_profit_shift_ids"]:
        query = urllib.parse.urlencode({"id": f"eq.{event_id}"})
        request_json("DELETE", f"{base}/casino_events?{query}", headers)


def main() -> int:
    parser = argparse.ArgumentParser(description="Rollback tagged manual casino adjustments.")
    parser.add_argument("--apply", action="store_true", help="Apply the rollback to live Supabase data.")
    args = parser.parse_args()

    load_env()
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    events = fetch_all(base, headers, "casino_events", "id.asc")
    plan = build_plan(events)
    print(json.dumps(plan, ensure_ascii=False, indent=2))

    if args.apply:
        apply_plan(base, headers, plan)
        print("Applied rollback of tagged manual casino adjustments.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
