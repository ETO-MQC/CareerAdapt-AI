"""Isolated localhost PaddleOCR-VL sidecar for CareerAdapt resume imports.

The process never writes recognized resume text to logs. It loads the model from
PADDLEOCR_VL_MODEL_DIR and exposes only /health and /v1/ocr on localhost.
"""

from __future__ import annotations

import importlib.util
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Header, HTTPException, UploadFile

ENGINE = "paddleocr-vl-local"
MODEL_NAME = "PaddleOCR-VL-1.6"
MAX_BYTES = 30 * 1024 * 1024
ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg"}

app = FastAPI(title="CareerAdapt local OCR", docs_url=None, redoc_url=None)
_pipeline: Any | None = None
_pipeline_lock = threading.Lock()


@app.get("/health")
def health() -> dict[str, Any]:
    model_dir = configured_model_dir()
    runtime_available = importlib.util.find_spec("paddleocr") is not None and importlib.util.find_spec("paddle") is not None
    device = os.environ.get("PADDLEOCR_VL_DEVICE", "gpu")
    ready = model_dir is not None and runtime_available
    return {
        "ok": ready,
        "engine": ENGINE,
        "configured": bool(os.environ.get("PADDLEOCR_VL_MODEL_DIR")),
        "modelAvailable": model_dir is not None,
        "runtimeAvailable": runtime_available,
        "device": device,
        "message": "PaddleOCR-VL 本地运行时已就绪。" if ready else health_message(model_dir, runtime_available),
    }


@app.post("/v1/ocr")
async def recognize(
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    require_token(authorization)
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="OCR 仅接收 PDF、PNG 或 JPG。")
    data = await file.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="OCR 文件为空或超过 30 MB。")

    suffix = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg"}[file.content_type]
    temporary_path: Path | None = None
    started = time.perf_counter()
    try:
        with tempfile.NamedTemporaryFile(prefix="careeradapt-ocr-", suffix=suffix, delete=False) as handle:
            handle.write(data)
            temporary_path = Path(handle.name)
        pipeline = get_pipeline()
        raw_results = list(pipeline.predict(input=str(temporary_path)))
        blocks, page_count, warnings = normalize_results(raw_results)
        text = "\n".join(block["text"] for block in blocks if block["text"].strip())
        return {
            "ok": True,
            "engine": ENGINE,
            "engineVersion": runtime_version(),
            "modelName": MODEL_NAME,
            "elapsedMs": max(0, round((time.perf_counter() - started) * 1000)),
            "pageCount": max(1, page_count),
            "text": text,
            "blocks": blocks,
            "warnings": warnings,
        }
    except HTTPException:
        raise
    except Exception:
        # Do not expose model traces, file paths, or recognized source text.
        raise HTTPException(status_code=502, detail="PaddleOCR-VL 识别失败；未保存不完整结果。") from None
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass


def get_pipeline() -> Any:
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    with _pipeline_lock:
        if _pipeline is not None:
            return _pipeline
        model_dir = configured_model_dir()
        if model_dir is None:
            raise HTTPException(status_code=503, detail="PADDLEOCR_VL_MODEL_DIR 不可用。")
        try:
            from paddleocr import PaddleOCRVL
        except ImportError:
            raise HTTPException(status_code=503, detail="PaddleOCR 运行时未安装。") from None
        _pipeline = PaddleOCRVL(
            pipeline_version="v1.6",
            vl_rec_model_dir=str(model_dir),
            device=os.environ.get("PADDLEOCR_VL_DEVICE", "gpu"),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_layout_detection=True,
        )
        return _pipeline


def normalize_results(results: list[Any]) -> tuple[list[dict[str, Any]], int, list[str]]:
    blocks: list[dict[str, Any]] = []
    page_count = 0
    warnings: list[str] = []
    for result_index, result in enumerate(results):
        payload = result_payload(result)
        page_index = payload.get("page_index", payload.get("pageIndex"))
        page = positive_int(page_index, zero_based=True) if page_index is not None else result_index + 1
        page_count = max(page_count, page)
        candidates = payload.get("parsing_res_list") or payload.get("parsingResList") or payload.get("blocks") or []
        if not isinstance(candidates, list):
            candidates = []
        page_blocks = []
        for candidate_index, candidate in enumerate(candidates):
            if not isinstance(candidate, dict):
                candidate = result_payload(candidate)
            text = first_string(candidate, "block_content", "content", "text", "rec_text", "blockContent")
            if not text:
                continue
            label = first_string(candidate, "block_label", "label", "type", "blockLabel")
            bbox = normalize_bbox(candidate.get("block_bbox") or candidate.get("bbox") or candidate.get("coordinate"))
            confidence = normalize_confidence(candidate.get("score") or candidate.get("confidence"))
            page_blocks.append({
                "id": f"ocr:{page}:block:{candidate_index}",
                "page": page,
                "text": text,
                "rawText": text,
                "blockType": block_type(label),
                **({"position": bbox} if bbox else {}),
                "order": len(blocks) + len(page_blocks),
                "confidence": confidence,
            })
        if not page_blocks:
            markdown = getattr(result, "markdown", None)
            if callable(markdown):
                markdown = markdown()
            fallback_text = first_string(payload, "markdown", "text", "rec_text", "content")
            if not fallback_text and isinstance(markdown, dict):
                fallback_text = first_string(markdown, "markdown_texts", "markdown", "text")
            if fallback_text:
                page_blocks.append({
                    "id": f"ocr:{page}:block:0",
                    "page": page,
                    "text": fallback_text,
                    "rawText": fallback_text,
                    "blockType": "text_block",
                    "order": len(blocks),
                    "confidence": 0.5,
                })
                warnings.append(f"ocr_layout_fallback:{page}")
        blocks.extend(page_blocks)
    if not blocks:
        warnings.append("ocr_empty_output")
    return blocks, max(1, page_count), warnings


def result_payload(value: Any) -> dict[str, Any]:
    payload = getattr(value, "json", None)
    if callable(payload):
        payload = payload()
    if isinstance(payload, dict) and isinstance(payload.get("res"), dict):
        return payload["res"]
    if isinstance(payload, dict):
        return payload
    return dict(value) if isinstance(value, dict) else {}


def normalize_bbox(value: Any) -> dict[str, float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        left, top, right, bottom = (float(item) for item in value)
    except (TypeError, ValueError):
        return None
    if right < left or bottom < top:
        return None
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def normalize_confidence(value: Any) -> float:
    try:
        return min(1.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return 0.7


def block_type(label: str) -> str:
    normalized = label.lower()
    if "title" in normalized or "heading" in normalized:
        return "heading"
    if "table" in normalized:
        return "table_cell"
    if "list" in normalized:
        return "list_item"
    if "image" in normalized or "figure" in normalized:
        return "image_region"
    return "paragraph"


def configured_model_dir() -> Path | None:
    raw = os.environ.get("PADDLEOCR_VL_MODEL_DIR", "").strip()
    if not raw:
        return None
    path = Path(raw).expanduser().resolve()
    return path if path.is_dir() and (path / "config.json").is_file() else None


def require_token(authorization: str | None) -> None:
    expected = os.environ.get("PADDLEOCR_VL_TOKEN", "").strip()
    if expected and authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="OCR sidecar token 无效。")


def runtime_version() -> str:
    try:
        import paddleocr
        return str(getattr(paddleocr, "__version__", "unknown"))
    except ImportError:
        return "unknown"


def health_message(model_dir: Path | None, runtime_available: bool) -> str:
    if model_dir is None:
        return "PADDLEOCR_VL_MODEL_DIR 未配置或模型目录无效。"
    if not runtime_available:
        return "PaddleOCR/PaddlePaddle 运行时未安装。"
    return "本地 OCR 尚未就绪。"


def first_string(value: dict[str, Any], *keys: str) -> str:
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return ""


def positive_int(value: Any, zero_based: bool = False) -> int:
    try:
        parsed = int(value) + (1 if zero_based else 0)
        return max(1, parsed)
    except (TypeError, ValueError):
        return 1


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("PADDLEOCR_VL_PORT", "8765")),
        log_level="warning",
        access_log=False,
    )
