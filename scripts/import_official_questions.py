#!/usr/bin/env python3
"""Import the current official motorcycle question artifacts without guessing.

The source snapshot is deliberately pinned to 806 standard, 126 hazard-video,
and 120 scenario/image questions (1,052 total). Text is extracted verbatim apart
from joining PDF line wraps and normalizing whitespace. Embedded image regions
are rendered to local WebP assets; hazard videos remain official hosted links.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
DATA_DIR = SITE / "public" / "data"
ASSET_DIR = SITE / "public" / "assets" / "questions"
SOURCE_DIR = ROOT / "sources"

STANDARD_PDF = SOURCE_DIR / "standard-1150218.pdf"
HAZARD_PDF = SOURCE_DIR / "hazard-1130816.pdf"
SCENARIO_PDF = SOURCE_DIR / "scenario-all.pdf"

EXPECTED_COUNTS = {"standard": 806, "hazard": 126, "scenario": 120, "total": 1052}
OPTION_MARKER = re.compile(r"(?:\(|（)\s*([123])\s*(?:\)|）)")
STANDARD_ANCHOR = re.compile(r"(?m)^\s*(\d{1,3})\s+([123])(?:\s+|$)")
HAZARD_ANCHOR = re.compile(r"(?m)^\s*(\d{3})\s+([123])\s+")

SECTION_TITLES = {
    "貨物裝載",
    "事故預防及處理",
    "禁止不當行為（酒駕、不使用手機、危險駕駛）",
    "行車檢查（設備、燈光）",
    "平交道、強制險、環保駕駛、特殊天候、駕駛道德",
    "路口安全（有號誌路口、無號誌路口、停讓行人）",
    "注意大型車行駛及轉彎（內輪差、視野死角、不並行）",
    "轉彎（左右轉、迴轉）",
    "行駛中應注意事項（保持安全車距、注意前車狀況）",
    "正確使用燈光（頭燈、霧燈、方向燈）",
}

FURNITURE = {
    "機車駕照筆試題庫 115.1",
    "機車駕照筆試題庫",
    "【 題庫索引 】",
    "分類",
    "正確觀念與態度",
    "主動停讓文化",
    "安全駕駛能力",
    "題號 答案 題目內容",
    "題號 答案 題目 影片編號",
    *SECTION_TITLES,
}


def compact_lines(value: str) -> str:
    lines = [re.sub(r"\s+", " ", line.strip()) for line in value.splitlines() if line.strip()]
    return "".join(lines).strip()


def clean_pdf_text(value: str) -> str:
    kept: list[str] = []
    for line in value.replace("\r", "").splitlines():
        stripped = line.strip()
        if not stripped or stripped in FURNITURE:
            continue
        if "━" in stripped or re.fullmatch(r"—\s*\d+\s*—", stripped):
            continue
        if re.fullmatch(r"\d+", stripped):
            continue
        kept.append(line)
    return "\n".join(kept)


def split_prompt_options(body: str) -> tuple[str, list[str]]:
    parts = OPTION_MARKER.split(body)
    if len(parts) < 7:
        return compact_lines(body), []
    prompt = compact_lines(parts[0])
    options_by_number = {
        parts[index]: compact_lines(parts[index + 1])
        for index in range(1, len(parts) - 1, 2)
        if parts[index] in {"1", "2", "3"}
    }
    return prompt, [options_by_number.get(str(number), "") for number in (1, 2, 3)]


def standard_major_category(source_id: int) -> str:
    if source_id <= 480:
        return "正確觀念與態度"
    if source_id <= 572:
        return "主動停讓文化"
    return "安全駕駛能力"


def classify_tags(prompt: str, options: list[str], has_image: bool) -> list[str]:
    combined = prompt + "".join(options)
    tags: list[str] = []
    if re.search(r"\d|％|%|罰鍰|公尺|公里|公斤|排氣量|速限|年齡|幾日|幾點", combined):
        tags.append("numeric")
    if has_image:
        tags.append("visual")
    return tags


def parse_numbered_items(pages: list[str], anchor: re.Pattern[str]) -> list[dict[str, Any]]:
    text = "\n".join(clean_pdf_text(page) for page in pages)
    matches = list(anchor.finditer(text))
    items: list[dict[str, Any]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        items.append(
            {
                "source_id": int(match.group(1)),
                "answer": int(match.group(2)),
                "body": text[match.end() : end].strip(),
            }
        )
    return items


def question_pages(reader: PdfReader, anchor: re.Pattern[str]) -> dict[int, int]:
    result: dict[int, int] = {}
    for page_number, page in enumerate(reader.pages, start=1):
        text = clean_pdf_text(page.extract_text() or "")
        for match in anchor.finditer(text):
            result[int(match.group(1))] = page_number
    return result


def standard_sections(reader: PdfReader) -> dict[int, str]:
    current = "貨物裝載"
    result: dict[int, str] = {}
    for page in reader.pages:
        raw = page.extract_text() or ""
        positions: list[tuple[int, str, int | None]] = []
        for title in SECTION_TITLES:
            found = raw.find(title)
            if found >= 0:
                positions.append((found, "section", title))
        for match in STANDARD_ANCHOR.finditer(raw):
            positions.append((match.start(), "question", int(match.group(1))))
        for _, kind, value in sorted(positions):
            if kind == "section":
                current = str(value)
            else:
                result[int(value)] = current
    return result


def find_anchor_tops(page: pdfplumber.page.Page, expected_ids: set[int]) -> dict[int, float]:
    words = page.extract_words(x_tolerance=2, y_tolerance=2)
    result: dict[int, float] = {}
    for word in words:
        text = str(word.get("text", ""))
        if not text.isdigit() or float(word.get("x0", 999)) > 110:
            continue
        source_id = int(text)
        if source_id in expected_ids:
            result.setdefault(source_id, float(word["top"]))
    return result


def render_crop(page: pdfplumber.page.Page, bbox: tuple[float, float, float, float], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    image = page.crop(bbox).to_image(resolution=190, antialias=True).original.convert("RGB")
    image.save(output, "WEBP", quality=84, method=6)


def extract_standard_images(page_ids: dict[int, int]) -> dict[int, list[str]]:
    result: dict[int, list[str]] = defaultdict(list)
    ids_by_page: dict[int, set[int]] = defaultdict(set)
    for source_id, page_number in page_ids.items():
        ids_by_page[page_number].add(source_id)

    output_root = ASSET_DIR / "standard"
    output_root.mkdir(parents=True, exist_ok=True)
    with pdfplumber.open(STANDARD_PDF) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            if not page.images:
                continue
            tops = find_anchor_tops(page, ids_by_page[page_number])
            if not tops:
                raise ValueError(f"standard page {page_number}: images found without question anchors")
            for image_index, image_info in enumerate(page.images, start=1):
                image_center = (float(image_info["top"]) + float(image_info["bottom"])) / 2
                source_id = min(tops, key=lambda item_id: abs(tops[item_id] - image_center))
                item_index = len(result[source_id]) + 1
                filename = f"standard-{source_id:03d}-{item_index}.webp"
                output = output_root / filename
                bbox = (
                    float(image_info["x0"]),
                    float(image_info["top"]),
                    float(image_info["x1"]),
                    float(image_info["bottom"]),
                )
                render_crop(page, bbox, output)
                result[source_id].append(f"/assets/questions/standard/{filename}")
    return result


def hazard_links(reader: PdfReader) -> dict[int, str]:
    links: dict[int, str] = {}
    for page in reader.pages:
        page_text = clean_pdf_text(page.extract_text() or "")
        question_ids = [int(match.group(1)) for match in HAZARD_ANCHOR.finditer(page_text)]
        annotations: list[tuple[float, str]] = []
        for annotation_ref in page.get("/Annots", []):
            annotation = annotation_ref.get_object()
            action = annotation.get("/A")
            uri = str(action.get("/URI")) if action and action.get("/URI") else ""
            if "space2.thb.gov.tw" not in uri:
                continue
            rect = annotation.get("/Rect")
            annotations.append((float(rect[3]), uri))
        urls = [uri for _, uri in sorted(annotations, key=lambda pair: pair[0], reverse=True)]
        if len(question_ids) != len(urls):
            raise ValueError(
                f"hazard page link mismatch: {len(question_ids)} questions, {len(urls)} official links"
            )
        links.update(zip(question_ids, urls, strict=True))
    return links


def hazard_video_ids(reader: PdfReader) -> dict[int, str]:
    result: dict[int, str] = {}
    for page in reader.pages:
        raw = page.extract_text() or ""
        question_ids = [int(match.group(1)) for match in HAZARD_ANCHOR.finditer(clean_pdf_text(raw))]
        video_ids = re.findall(r"(?m)^\s*(4\d{3})\s*$", raw)
        if len(question_ids) != len(video_ids):
            raise ValueError(
                f"hazard page video-id mismatch: {len(question_ids)} questions, {len(video_ids)} ids"
            )
        result.update(zip(question_ids, video_ids, strict=True))
    return result


def import_standard() -> list[dict[str, Any]]:
    reader = PdfReader(str(STANDARD_PDF))
    pages = [page.extract_text() or "" for page in reader.pages]
    page_map = question_pages(reader, STANDARD_ANCHOR)
    sections = standard_sections(reader)
    images = extract_standard_images(page_map)
    questions: list[dict[str, Any]] = []
    for item in parse_numbered_items(pages, STANDARD_ANCHOR):
        source_id = int(item["source_id"])
        prompt, options = split_prompt_options(str(item["body"]))
        image_paths = images.get(source_id, [])
        questions.append(
            {
                "id": f"standard-{source_id:03d}",
                "sourceId": str(source_id),
                "type": "standard",
                "category": standard_major_category(source_id),
                "subcategory": sections.get(source_id, ""),
                "prompt": prompt,
                "options": options,
                "answerIndex": int(item["answer"]) - 1,
                "media": {"kind": "image", "src": image_paths} if image_paths else None,
                "tags": classify_tags(prompt, options, bool(image_paths)),
                "source": {"file": STANDARD_PDF.name, "page": page_map[source_id]},
            }
        )
    return questions


def import_hazard() -> list[dict[str, Any]]:
    reader = PdfReader(str(HAZARD_PDF))
    pages = [page.extract_text() or "" for page in reader.pages]
    page_map = question_pages(reader, HAZARD_ANCHOR)
    links = hazard_links(reader)
    video_ids = hazard_video_ids(reader)
    questions: list[dict[str, Any]] = []
    for item in parse_numbered_items(pages, HAZARD_ANCHOR):
        source_id = int(item["source_id"])
        body = str(item["body"])
        video_id = video_ids[source_id]
        prompt, options = split_prompt_options(body)
        questions.append(
            {
                "id": f"hazard-{source_id:03d}",
                "sourceId": f"{source_id:03d}",
                "type": "hazard",
                "category": "危險感知能力",
                "subcategory": "危險感知影片",
                "prompt": prompt,
                "options": options,
                "answerIndex": int(item["answer"]) - 1,
                "media": {
                    "kind": "video-link",
                    "videoId": video_id,
                    "url": links[source_id],
                    "requiresNetwork": True,
                },
                "tags": classify_tags(prompt, options, False),
                "source": {"file": HAZARD_PDF.name, "page": page_map[source_id]},
            }
        )
    return questions


def scenario_image(page: pdfplumber.page.Page, page_number: int, normalized_id: str) -> str:
    candidates = list(page.images)
    if page_number > 60:
        candidates = [
            item
            for item in candidates
            if not (
                float(item["width"]) > float(page.width) * 0.9
                and float(item["height"]) > float(page.height) * 0.9
            )
        ]
    if not candidates:
        raise ValueError(f"scenario page {page_number}: no question image found")
    image_info = max(
        candidates,
        key=lambda item: len(item["stream"].get_rawdata()) * max(1.0, float(item["width"])),
    )
    filename = f"{normalized_id}.webp"
    output = ASSET_DIR / "scenario" / filename
    bbox = (
        float(image_info["x0"]),
        float(image_info["top"]),
        float(image_info["x1"]),
        float(image_info["bottom"]),
    )
    render_crop(page, bbox, output)
    return f"/assets/questions/scenario/{filename}"


def import_scenario() -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    with pdfplumber.open(SCENARIO_PDF) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            if page_number <= 60:
                source_match = re.search(r"【情境式題目】\s*(\d{3})", text)
                answer_match = re.search(r"(?:\(|（)\s*([123])\s*(?:\)|）)", text)
                if not source_match or not answer_match:
                    raise ValueError(f"scenario page {page_number}: missing first-bank id or answer")
                source_id = int(source_match.group(1))
                bank = "a"
                body = text[answer_match.end() :]
            else:
                source_match = re.search(r"(?m)^\s*(\d{1,2})[.．]", text)
                answer_match = re.search(r"答案\s*[：:]\s*([123])", text)
                if not source_match or not answer_match:
                    raise ValueError(f"scenario page {page_number}: missing second-bank id or answer")
                source_id = int(source_match.group(1))
                bank = "b"
                body = text[source_match.end() : answer_match.start()]
            normalized_id = f"scenario-{bank}-{source_id:03d}"
            prompt, options = split_prompt_options(body)
            image_path = scenario_image(page, page_number, normalized_id)
            questions.append(
                {
                    "id": normalized_id,
                    "sourceId": str(source_id),
                    "sourceBank": bank,
                    "type": "scenario",
                    "category": "危險感知能力",
                    "subcategory": "情境圖片",
                    "prompt": prompt,
                    "options": options,
                    "answerIndex": int(answer_match.group(1)) - 1,
                    "media": {"kind": "image", "src": [image_path]},
                    "tags": classify_tags(prompt, options, True),
                    "source": {"file": SCENARIO_PDF.name, "page": page_number},
                }
            )
    return questions


def validate(questions: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {
        kind: sum(question["type"] == kind for question in questions)
        for kind in ("standard", "hazard", "scenario")
    }
    counts["total"] = len(questions)
    ids = [str(question["id"]) for question in questions]
    errors: list[str] = []
    if counts != EXPECTED_COUNTS:
        errors.append(f"snapshot count mismatch: expected {EXPECTED_COUNTS}, found {counts}")
    if len(ids) != len(set(ids)):
        errors.append("duplicate normalized IDs found")
    for question in questions:
        if len(question["options"]) != 3 or any(not option for option in question["options"]):
            errors.append(f"{question['id']}: expected exactly three non-empty options")
        if question["answerIndex"] not in {0, 1, 2}:
            errors.append(f"{question['id']}: invalid answerIndex")
        if not question["prompt"] and not question["media"]:
            errors.append(f"{question['id']}: no text prompt or media")
    return {"valid": not errors, "counts": counts, "errors": errors}


def main() -> int:
    for path in (STANDARD_PDF, HAZARD_PDF, SCENARIO_PDF):
        if not path.is_file():
            print(f"Missing official source: {path}", file=sys.stderr)
            return 2
    if ASSET_DIR.exists():
        shutil.rmtree(ASSET_DIR)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)

    questions = import_standard() + import_hazard() + import_scenario()
    validation = validate(questions)
    payload = {
        "meta": {
            "title": "澎湖騎士｜3-Day License Rush",
            "language": "zh-Hant-TW",
            "snapshotDate": "2026-09-02",
            "counts": validation["counts"],
            "officialAnnouncementTotal": 1050,
            "artifactCountWarning": "2026年1月公告為1,050題；目前下載之官方中文題庫組件共1,052題。此處保留全部官方題目。",
        },
        "questions": questions,
    }
    output = DATA_DIR / "questions.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    precache = sorted(
        {
            src
            for question in questions
            if question["media"] and question["media"]["kind"] == "image"
            for src in question["media"]["src"]
        }
    )
    (SITE / "public" / "precache-assets.json").write_text(
        json.dumps(precache, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps(validation, ensure_ascii=False, indent=2))
    print(f"Wrote {output} ({output.stat().st_size} bytes)")
    return 0 if validation["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
