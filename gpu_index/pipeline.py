import logging

from gpu_index.config import Config
from gpu_index.db import get_connection, init_db, save_snapshots
from gpu_index.fetchers.runcrate import fetch_runcrate_prices
from gpu_index.fetchers.runpod import fetch_runpod_prices
from gpu_index.fetchers.vast import fetch_vast_prices

logger = logging.getLogger(__name__)


def run_fetch(config: Config) -> dict[str, int]:
    init_db(config.database_url)

    results: dict[str, int] = {"runpod": 0, "vast": 0, "runcrate": 0, "total": 0}

    with get_connection(config.database_url) as conn:
        try:
            runpod_snapshots = fetch_runpod_prices(config.runpod_api_key)
            results["runpod"] = save_snapshots(conn, runpod_snapshots)
        except Exception:
            logger.exception("Failed to fetch RunPod prices")

        try:
            vast_snapshots = fetch_vast_prices(config.vast_api_key)
            results["vast"] = save_snapshots(conn, vast_snapshots)
        except Exception:
            logger.exception("Failed to fetch Vast.ai prices")

        try:
            runcrate_snapshots = fetch_runcrate_prices()
            results["runcrate"] = save_snapshots(conn, runcrate_snapshots)
        except Exception:
            logger.exception("Failed to fetch Runcrate prices")

    results["total"] = results["runpod"] + results["vast"] + results["runcrate"]
    logger.info(
        "Fetch complete: runpod=%d, vast=%d, runcrate=%d, total=%d",
        results["runpod"],
        results["vast"],
        results["runcrate"],
        results["total"],
    )
    return results


def init_database(config: Config) -> None:
    init_db(config.database_url)
    logger.info("Database initialized at %s", config.database_host())
