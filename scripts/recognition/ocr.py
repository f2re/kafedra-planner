#!/usr/bin/env python3
"""Managed OCR adapter for Kafedra Planner.

The script deliberately has no third-party Python dependencies. Tesseract and
Poppler are installed as target-OS packages; the bundled CPython only provides
a predictable orchestration/runtime layer and isolates recognition from the
system Python environment.
"""
from __future__ import print_function

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def language_candidates(languages):
    requested = str(languages or "rus+eng").strip() or "rus+eng"
    result = [requested]
    if "+" in requested:
        result.extend([requested.split("+", 1)[0], "eng"])
    elif requested != "eng":
        result.append("eng")
    unique = []
    for item in result:
        if item and item not in unique:
            unique.append(item)
    return unique


def parse_tsv(tsv, page=1):
    rows = str(tsv or "").replace("\r\n", "\n").split("\n")
    if len(rows) < 2:
        return {"blocks": [], "text": "", "confidence": None}
    headers = rows[0].split("\t")
    index = dict((value, position) for position, value in enumerate(headers))
    required = {"level", "text", "page_num", "block_num", "par_num", "line_num", "left", "top", "width", "height", "conf"}
    if not required.issubset(set(index)):
        raise RuntimeError("Некорректный TSV Tesseract: отсутствуют обязательные столбцы")
    groups = {}
    order = []
    for row in rows[1:]:
        if not row.strip():
            continue
        columns = row.split("\t")
        if len(columns) < len(headers):
            columns += [""] * (len(headers) - len(columns))
        try:
            level = int(columns[index["level"]] or 0)
        except ValueError:
            continue
        if level != 5:
            continue
        text = clean_text(columns[index["text"]])
        if not text:
            continue
        try:
            page_number = int(columns[index["page_num"]] or page) or page
        except ValueError:
            page_number = page
        key = "%s:%s:%s:%s" % (
            page_number,
            columns[index["block_num"]] or "0",
            columns[index["par_num"]] or "0",
            columns[index["line_num"]] or "0",
        )
        try:
            confidence = float(columns[index["conf"]] or -1)
        except ValueError:
            confidence = -1.0
        word = {
            "text": text,
            "left": int(float(columns[index["left"]] or 0)),
            "top": int(float(columns[index["top"]] or 0)),
            "width": int(float(columns[index["width"]] or 0)),
            "height": int(float(columns[index["height"]] or 0)),
            "confidence": confidence,
        }
        if key not in groups:
            groups[key] = {"page": page_number, "words": []}
            order.append(key)
        groups[key]["words"].append(word)

    raw = [groups[key] for key in order]
    page_bounds = {}
    for group in raw:
        bounds = page_bounds.setdefault(group["page"], {"width": 1, "height": 1})
        for word in group["words"]:
            bounds["width"] = max(bounds["width"], word["left"] + word["width"])
            bounds["height"] = max(bounds["height"], word["top"] + word["height"])

    blocks = []
    page_line = {}
    for group in raw:
        words = group["words"]
        left = min(word["left"] for word in words)
        top = min(word["top"] for word in words)
        right = max(word["left"] + word["width"] for word in words)
        bottom = max(word["top"] + word["height"] for word in words)
        confidences = [word["confidence"] for word in words if word["confidence"] >= 0]
        page_line[group["page"]] = page_line.get(group["page"], 0) + 1
        bounds = page_bounds[group["page"]]
        blocks.append({
            "type": "ocr_line",
            "text": " ".join(word["text"] for word in words),
            "locator": {"kind": "ocr_bbox", "page": group["page"], "line": page_line[group["page"]]},
            "geometry": {
                "x": left,
                "y": top,
                "width": max(1, right - left),
                "height": max(1, bottom - top),
                "pageWidth": bounds["width"],
                "pageHeight": bounds["height"],
            },
            "metadata": {
                "ocr": True,
                "confidence": round(sum(confidences) / len(confidences), 2) if confidences else None,
            },
        })
    confidence_values = [block["metadata"]["confidence"] for block in blocks if block["metadata"]["confidence"] is not None]
    return {
        "blocks": blocks,
        "text": "\n".join(block["text"] for block in blocks),
        "confidence": round(sum(confidence_values) / len(confidence_values), 2) if confidence_values else None,
    }


def command_error(exc):
    if isinstance(exc, FileNotFoundError):
        return "command_not_found"
    stderr = getattr(exc, "stderr", None)
    return clean_text(stderr or str(exc) or "ocr_failed")


def run_tesseract(path, languages, dpi, page):
    last_error = None
    for language in language_candidates(languages):
        try:
            completed = subprocess.run(
                ["tesseract", path, "stdout", "-l", language, "--dpi", str(dpi), "tsv"],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True,
                timeout=180,
            )
            parsed = parse_tsv(completed.stdout, page=page)
            return {
                "status": "used" if parsed["blocks"] else "empty",
                "engine": "tesseract-python",
                "languages": language,
                "confidence": parsed["confidence"],
                "text": parsed["text"],
                "blocks": parsed["blocks"],
                "error": None if parsed["blocks"] else "ocr_text_empty",
            }
        except (OSError, subprocess.SubprocessError) as exc:
            last_error = exc
            if isinstance(exc, FileNotFoundError):
                break
    return {
        "status": "unavailable" if isinstance(last_error, FileNotFoundError) else "failed",
        "engine": "tesseract-python",
        "languages": str(languages or ""),
        "confidence": None,
        "text": "",
        "blocks": [],
        "error": command_error(last_error),
    }


def recognize_image(path, languages, dpi):
    return run_tesseract(path, languages, dpi, 1)


def recognize_pdf(path, languages, dpi, max_pages):
    if not shutil.which("pdftoppm"):
        return {
            "status": "unavailable", "engine": "tesseract-python", "languages": languages,
            "confidence": None, "text": "", "blocks": [], "error": "pdftoppm:command_not_found"
        }
    with tempfile.TemporaryDirectory(prefix="kafedra-ocr-") as directory:
        prefix = os.path.join(directory, "page")
        try:
            subprocess.run(
                ["pdftoppm", "-png", "-r", str(dpi), "-f", "1", "-l", str(max_pages), path, prefix],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True,
                timeout=300,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return {
                "status": "unavailable" if isinstance(exc, FileNotFoundError) else "failed",
                "engine": "tesseract-python", "languages": languages, "confidence": None,
                "text": "", "blocks": [], "error": "pdftoppm:%s" % command_error(exc),
            }
        pages = []
        for name in os.listdir(directory):
            match = re.match(r"^page-(\d+)\.png$", name, re.I)
            if match:
                pages.append((int(match.group(1)), name))
        pages.sort()
        blocks = []
        results = []
        for page_number, name in pages:
            result = run_tesseract(os.path.join(directory, name), languages, dpi, page_number)
            results.append(result)
            blocks.extend(result["blocks"])
            if result["status"] == "unavailable":
                break
        confidences = [item["confidence"] for item in results if item["confidence"] is not None]
        failed = next((item for item in results if item["status"] in ("unavailable", "failed")), None)
        used = bool(blocks)
        return {
            "status": "used" if used else (failed["status"] if failed else "empty"),
            "engine": "tesseract-python",
            "languages": next((item["languages"] for item in results if item.get("languages")), languages),
            "confidence": round(sum(confidences) / len(confidences), 2) if confidences else None,
            "text": "\n".join(block["text"] for block in blocks),
            "blocks": blocks,
            "error": None if used else (failed["error"] if failed else "ocr_text_empty"),
        }


def tesseract_languages():
    try:
        completed = subprocess.run(
            ["tesseract", "--list-langs"], check=True, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, universal_newlines=True, timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return [], command_error(exc)
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    return [line for line in lines if not line.lower().startswith("list of available")], None


def doctor(languages):
    requested = [item for item in str(languages or "rus+eng").split("+") if item]
    available, error = tesseract_languages()
    missing = [item for item in requested if item not in available]
    checks = {
        "python": True,
        "tesseract": bool(shutil.which("tesseract")) and error is None,
        "pdftoppm": bool(shutil.which("pdftoppm")),
        "pdftotext": bool(shutil.which("pdftotext")),
        "languages": not missing,
    }
    return {
        "status": "ready" if all(checks.values()) else "blocked",
        "pythonVersion": "%s.%s.%s" % sys.version_info[:3],
        "pythonExecutable": sys.executable,
        "checks": checks,
        "requestedLanguages": requested,
        "availableLanguages": available,
        "missingLanguages": missing,
        "error": error,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Локальное OCR Kafedra Planner")
    sub = parser.add_subparsers(dest="command")
    image = sub.add_parser("image")
    image.add_argument("path")
    pdf = sub.add_parser("pdf")
    pdf.add_argument("path")
    doctor_parser = sub.add_parser("doctor")
    parse_parser = sub.add_parser("parse-tsv")
    parse_parser.add_argument("path", nargs="?", default="-")
    for target in (image, pdf, doctor_parser):
        target.add_argument("--languages", default="rus+eng")
    for target in (image, pdf):
        target.add_argument("--dpi", type=int, default=250)
    pdf.add_argument("--max-pages", type=int, default=50)
    args = parser.parse_args(argv)
    if not args.command:
        parser.error("не указана команда")
    if args.command == "image":
        result = recognize_image(args.path, args.languages, args.dpi)
    elif args.command == "pdf":
        result = recognize_pdf(args.path, args.languages, args.dpi, args.max_pages)
    elif args.command == "doctor":
        result = doctor(args.languages)
    else:
        if args.path == "-":
            content = sys.stdin.read()
        else:
            with open(args.path, "r", encoding="utf-8") as stream:
                content = stream.read()
        result = parse_tsv(content)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0 if result.get("status") != "blocked" else 3


if __name__ == "__main__":
    raise SystemExit(main())
