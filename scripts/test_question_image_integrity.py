#!/usr/bin/env python3
"""Deterministic PDF-to-WebP integrity checks for representative question art."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from statistics import fmean
from typing import Any

import pdfplumber
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat


ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "site" / "public" / "data" / "questions.json"
ASSET_ROOT = ROOT / "site" / "public"
SOURCES = ROOT / "sources"
RESOLUTION = 190


@dataclass(frozen=True)
class Case:
    question_id: str
    output_stem: str


CASES = (
    Case("standard-009", "standard-009"),
    Case("scenario-a-021", "scenario-a-021"),
    Case("scenario-b-027", "scenario-b-027"),
)


def bbox_for_question(page: pdfplumber.page.Page, question: dict[str, Any], page_questions: list[dict[str, Any]]) -> tuple[float, float, float, float]:
    if question["type"] == "scenario":
        candidates = list(page.images)
        if int(question["source"]["page"]) > 60:
            candidates = [
                item
                for item in candidates
                if not (
                    float(item["width"]) > float(page.width) * 0.9
                    and float(item["height"]) > float(page.height) * 0.9
                )
            ]
        selected = max(
            candidates,
            key=lambda item: len(item["stream"].get_rawdata()) * max(1.0, float(item["width"])),
        )
    else:
        expected_ids = {int(item["sourceId"]) for item in page_questions}
        anchors: dict[int, float] = {}
        for word in page.extract_words(x_tolerance=2, y_tolerance=2):
            text = str(word.get("text", ""))
            if text.isdigit() and float(word.get("x0", 999)) <= 110 and int(text) in expected_ids:
                anchors.setdefault(int(text), float(word["top"]))
        matches = []
        for image_info in page.images:
            center = (float(image_info["top"]) + float(image_info["bottom"])) / 2
            source_id = min(anchors, key=lambda item_id: abs(anchors[item_id] - center))
            if source_id == int(question["sourceId"]):
                matches.append(image_info)
        asset_index = int(Path(question["media"]["src"][0]).stem.rsplit("-", 1)[1]) - 1
        selected = matches[asset_index]
    return tuple(float(selected[key]) for key in ("x0", "top", "x1", "bottom"))


def visible_content_bbox(image: Image.Image, threshold: int = 12) -> tuple[int, int, int, int] | None:
    rgb = image.convert("RGB")
    corners = [rgb.getpixel(point) for point in ((0, 0), (rgb.width - 1, 0), (0, rgb.height - 1), (rgb.width - 1, rgb.height - 1))]
    reference = tuple(round(fmean(pixel[channel] for pixel in corners)) for channel in range(3))
    difference = ImageChops.difference(rgb, Image.new("RGB", rgb.size, reference)).convert("L")
    return difference.point(lambda value: 255 if value > threshold else 0).getbbox()


def comparison_sheet(source: Image.Image, asset: Image.Image, label: str, output: Path) -> None:
    preview_width = 520
    previews = []
    for image in (source, asset):
        copy = image.copy()
        copy.thumbnail((preview_width, 430), Image.Resampling.LANCZOS)
        previews.append(copy)
    label_height = 42
    canvas = Image.new("RGB", (preview_width * 2 + 36, max(item.height for item in previews) + label_height + 24), "white")
    draw = ImageDraw.Draw(canvas)
    draw.text((12, 10), f"{label} — source PDF crop", fill="#123f43", font=ImageFont.load_default())
    draw.text((preview_width + 24, 10), "generated WebP", fill="#123f43", font=ImageFont.load_default())
    canvas.paste(previews[0], (12, label_height))
    canvas.paste(previews[1], (preview_width + 24, label_height))
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--diagnostics", type=Path, help="Optional directory for source crops and comparison sheets")
    args = parser.parse_args()
    data = json.loads(DATASET.read_text(encoding="utf-8"))
    questions = {item["id"]: item for item in data["questions"]}
    pdf_cache: dict[Path, pdfplumber.pdf.PDF] = {}
    results = []

    try:
        for case in CASES:
            question = questions[case.question_id]
            source_path = SOURCES / question["source"]["file"]
            pdf = pdf_cache.setdefault(source_path, pdfplumber.open(source_path))
            page_number = int(question["source"]["page"])
            page = pdf.pages[page_number - 1]
            page_questions = [
                item
                for item in data["questions"]
                if item["source"]["file"] == question["source"]["file"]
                and int(item["source"]["page"]) == page_number
            ]
            bbox = bbox_for_question(page, question, page_questions)
            source_crop = page.crop(bbox).to_image(resolution=RESOLUTION, antialias=True).original.convert("RGB")
            asset_path = ASSET_ROOT / question["media"]["src"][0].lstrip("/")
            asset = Image.open(asset_path).convert("RGB")

            assert asset.size == source_crop.size, f"{case.question_id}: generated dimensions differ from the official PDF object"
            difference = ImageChops.difference(source_crop, asset)
            stats = ImageStat.Stat(difference)
            mean_absolute_error = fmean(stats.mean)
            assert mean_absolute_error < 3.0, f"{case.question_id}: generated pixels diverge from the official PDF crop ({mean_absolute_error:.3f})"

            edge_width = max(1, round(asset.width * 0.01))
            edge_height = max(1, round(asset.height * 0.01))
            edge_boxes = (
                (0, 0, asset.width, edge_height),
                (0, asset.height - edge_height, asset.width, asset.height),
                (0, 0, edge_width, asset.height),
                (asset.width - edge_width, 0, asset.width, asset.height),
            )
            edge_errors = [fmean(ImageStat.Stat(difference.crop(box)).mean) for box in edge_boxes]
            assert max(edge_errors) < 4.0, f"{case.question_id}: meaningful source-edge pixels were clipped or changed"

            content_bbox = visible_content_bbox(asset)
            assert content_bbox is not None, f"{case.question_id}: generated image has no visible artwork"
            results.append({
                "questionId": case.question_id,
                "source": f"{source_path.name}#page={page_number}",
                "pdfObjectBboxPoints": [round(value, 2) for value in bbox],
                "pixelDimensions": list(asset.size),
                "visibleContentBboxPixels": list(content_bbox),
                "meanAbsoluteError": round(mean_absolute_error, 3),
                "maxEdgeMeanAbsoluteError": round(max(edge_errors), 3),
            })

            if args.diagnostics:
                diagnostics = args.diagnostics.resolve()
                diagnostics.mkdir(parents=True, exist_ok=True)
                source_crop.save(diagnostics / f"{case.output_stem}-source-crop.png")
                asset.save(diagnostics / f"{case.output_stem}-direct-webp.png")
                comparison_sheet(source_crop, asset, case.question_id, diagnostics / f"{case.output_stem}-pdf-vs-webp.png")
    finally:
        for pdf in pdf_cache.values():
            pdf.close()

    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
