import logging
import re
from typing import Any

import httpx

from gpu_index.models import PriceSnapshot

logger = logging.getLogger(__name__)

RUNCRATE_PRICING_URL = "https://www.runcrate.ai/api/gpu-pricing"

_VRAM_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*GB\s*$", re.IGNORECASE)


def _request_with_retry(max_attempts: int = 2) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(max_attempts):
        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.get(RUNCRATE_PRICING_URL)
                response.raise_for_status()
                return response.json()
        except Exception as exc:
            last_error = exc
            if attempt < max_attempts - 1:
                logger.warning("Runcrate request failed (attempt %d): %s", attempt + 1, exc)
    raise RuntimeError(f"Runcrate fetch failed after {max_attempts} attempts") from last_error


def _memory_gb(vram: Any) -> float | None:
    match = _VRAM_RE.match(str(vram or ""))
    return float(match.group(1)) if match else None


def parse_runcrate_prices(data: dict[str, Any]) -> list[PriceSnapshot]:
    """Turn the public pricing feed into one on-demand snapshot per GPU type in stock."""
    snapshots: list[PriceSnapshot] = []
    for gpu in data.get("gpus") or []:
        price = gpu.get("min_price_hr")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        if (gpu.get("available_options") or 0) < 1:
            continue
        gpu_id = gpu.get("gpu_type")
        if not gpu_id:
            continue

        snapshots.append(
            PriceSnapshot(
                provider="runcrate",
                gpu_id=gpu_id,
                display_name=gpu.get("name") or gpu_id,
                memory_gb=_memory_gb(gpu.get("vram")),
                instance_type="ondemand",
                price_per_hour=float(price),
                stock_status="in_stock",
                raw_json={
                    "available_options": gpu.get("available_options"),
                    "gpu_counts": gpu.get("gpu_counts"),
                    "min_price_hr": price,
                },
            )
        )

    return snapshots


def fetch_runcrate_prices() -> list[PriceSnapshot]:
    """Fetch Runcrate's lowest on-demand price per GPU type. The feed is public, so no API key is needed."""
    data = _request_with_retry()
    snapshots = parse_runcrate_prices(data)
    logger.info("Runcrate: fetched %d price snapshots from %d GPU types", len(snapshots), len(data.get("gpus") or []))
    return snapshots
