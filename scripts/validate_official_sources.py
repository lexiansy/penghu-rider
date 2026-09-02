#!/usr/bin/env python3
"""Preflight the official Taiwan motorcycle written-test PDF sources.

This script intentionally stops with a non-zero exit code when the current
official component counts do not reconcile with the announced 1,050-item pool.
It does not attempt to guess which official items should be excluded.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "standard": ROOT / "sources" / "standard-1150218.pdf",
    "hazard": ROOT / "sources" / "hazard-1130816.pdf",
    "scenario": ROOT / "sources" / "scenario-all.pdf",
}
ANNOUNCED_TOTAL = 1050
EXPECTED_ARTIFACT_COUNTS = {"standard": 806, "hazard": 126, "scenario": 120, "total": 1052}
OPTION_PATTERN = re.compile(r"(?:\(|（)\s*([123])\s*(?:\)|）)")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def page_texts(path: Path) -> list[str]:
    reader = PdfReader(str(path))
    return [(page.extract_text() or "").replace("\r", "") for page in reader.pages]


def strip_repeated_furniture(text: str) -> str:
    kept: list[str] = []
    for line in text.splitlines():
        value = line.strip()
        if value in {"機車駕照筆試題庫 115.1", "題號 答案 題目內容", "題號 答案 題目 影片編號"}:
            continue
        if re.fullmatch(r"—\s*\d+\s*—", value):
            continue
        if re.fullmatch(r"\d+", value):
            # Standalone PDF page numbers. Question and video IDs are retained
            # because they share a line with other fields.
            continue
        kept.append(line)
    return "\n".join(kept)


def split_numbered_items(texts: list[str], padded: bool) -> list[dict[str, object]]:
    text = "\n".join(strip_repeated_furniture(page) for page in texts)
    if padded:
        anchor = re.compile(r"(?m)^\s*(\d{3})\s+([123])\s+")
    else:
        anchor = re.compile(r"(?m)^\s*(\d{1,3})\s+([123])(?:\s+|$)")
    matches = list(anchor.finditer(text))
    items: list[dict[str, object]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[match.end() : end].strip()
        option_numbers = OPTION_PATTERN.findall(body)
        items.append(
            {
                "source_id": int(match.group(1)),
                "answer": int(match.group(2)),
                "option_numbers": option_numbers,
                "body": body,
            }
        )
    return items


def validate_numbered_source(name: str, items: list[dict[str, object]]) -> dict[str, object]:
    ids = [int(item["source_id"]) for item in items]
    duplicate_ids = sorted({item_id for item_id in ids if ids.count(item_id) > 1})
    expected = list(range(1, max(ids, default=0) + 1))
    bad_options = [
        int(item["source_id"])
        for item in items
        if set(item["option_numbers"]) != {"1", "2", "3"}
    ]
    bad_answers = [
        int(item["source_id"])
        for item in items
        if int(item["answer"]) not in {1, 2, 3}
    ]
    return {
        "name": name,
        "count": len(items),
        "first_id": min(ids, default=None),
        "last_id": max(ids, default=None),
        "ids_are_contiguous": ids == expected,
        "duplicate_source_ids": duplicate_ids,
        "invalid_option_items": bad_options,
        "invalid_answer_items": bad_answers,
    }


def parse_scenarios(texts: list[str]) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    items: list[dict[str, object]] = []
    parse_failures: list[dict[str, object]] = []
    for page_index, text in enumerate(texts, start=1):
        if page_index <= 60:
            id_match = re.search(r"【情境式題目】\s*(\d{3})", text)
            answer_match = re.search(r"(?:\(|（)\s*([123])\s*(?:\)|）)", text)
            bank = "a"
        else:
            id_match = re.search(r"(?m)^\s*(\d{1,2})[.．]", text)
            answer_match = re.search(r"答案\s*[：:]\s*([123])", text)
            bank = "b"
        options = OPTION_PATTERN.findall(text)
        if not id_match or not answer_match:
            parse_failures.append({"page": page_index, "reason": "missing id or answer"})
            continue
        source_id = int(id_match.group(1))
        items.append(
            {
                "id": f"scenario-{bank}-{source_id:03d}",
                "source_local_id": source_id,
                "bank": bank,
                "answer": int(answer_match.group(1)),
                "option_numbers": options[-3:],
                "page": page_index,
            }
        )
    return items, parse_failures


def validate_scenarios(items: list[dict[str, object]], parse_failures: list[dict[str, object]]) -> dict[str, object]:
    ids = [str(item["id"]) for item in items]
    local_ids = [int(item["source_local_id"]) for item in items]
    return {
        "name": "scenario",
        "count": len(items),
        "bank_counts": {
            "scenario-a": sum(item["bank"] == "a" for item in items),
            "scenario-b": sum(item["bank"] == "b" for item in items),
        },
        "normalized_ids_unique": len(ids) == len(set(ids)),
        "source_local_ids_overlap_across_banks": sorted(
            {item_id for item_id in local_ids if local_ids.count(item_id) > 1}
        ),
        "invalid_option_items": [
            str(item["id"])
            for item in items
            if set(item["option_numbers"]) != {"1", "2", "3"}
        ],
        "invalid_answer_items": [
            str(item["id"])
            for item in items
            if int(item["answer"]) not in {1, 2, 3}
        ],
        "parse_failures": parse_failures,
    }


def main() -> int:
    missing = [str(path) for path in SOURCES.values() if not path.is_file()]
    if missing:
        print(json.dumps({"error": "missing official source files", "files": missing}, ensure_ascii=False, indent=2))
        return 2

    standard_pages = page_texts(SOURCES["standard"])
    hazard_pages = page_texts(SOURCES["hazard"])
    scenario_pages = page_texts(SOURCES["scenario"])

    standard = validate_numbered_source(
        "standard", split_numbered_items(standard_pages, padded=False)
    )
    hazard = validate_numbered_source(
        "hazard", split_numbered_items(hazard_pages, padded=True)
    )
    scenario_items, scenario_failures = parse_scenarios(scenario_pages)
    scenario = validate_scenarios(scenario_items, scenario_failures)

    imported_total = int(standard["count"]) + int(hazard["count"]) + int(scenario["count"])
    artifact_counts = {
        "standard": int(standard["count"]),
        "hazard": int(hazard["count"]),
        "scenario": int(scenario["count"]),
        "total": imported_total,
    }
    structural_errors = (
        standard["duplicate_source_ids"]
        or standard["invalid_option_items"]
        or standard["invalid_answer_items"]
        or not standard["ids_are_contiguous"]
        or hazard["duplicate_source_ids"]
        or hazard["invalid_option_items"]
        or hazard["invalid_answer_items"]
        or not hazard["ids_are_contiguous"]
        or scenario["invalid_option_items"]
        or scenario["invalid_answer_items"]
        or scenario["parse_failures"]
        or not scenario["normalized_ids_unique"]
    )
    matches_snapshot = artifact_counts == EXPECTED_ARTIFACT_COUNTS
    result = {
        "files": {
            name: {
                "path": str(path.relative_to(ROOT)).replace("\\", "/"),
                "sha256": sha256(path),
                "pages": len(page_texts(path)),
            }
            for name, path in SOURCES.items()
        },
        "components": {"standard": standard, "hazard": hazard, "scenario": scenario},
        "announced_total": ANNOUNCED_TOTAL,
        "artifact_counts": artifact_counts,
        "expected_artifact_counts": EXPECTED_ARTIFACT_COUNTS,
        "matches_source_snapshot": matches_snapshot,
        "metadata_drift_warning": "January 2026 announcement states 1,050; current published artifacts contain 1,052.",
        "valid": matches_snapshot and not structural_errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
