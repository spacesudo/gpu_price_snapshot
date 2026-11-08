import logging
import sys

import click
import psycopg
import uvicorn

from gpu_index.api import app
from gpu_index.config import Config
from gpu_index.db import get_connection, get_latest_prices, get_recent_prices
from gpu_index.pipeline import init_database, run_fetch
from gpu_index.scheduler import start_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


@click.group()
def cli() -> None:
    """Fetch GPU rental prices from RunPod and Vast.ai."""


@cli.command("init-db")
def init_db_cmd() -> None:
    """Create or migrate the PostgreSQL database schema."""
    config = Config.from_env()
    if not config.database_url or config.database_url.startswith("postgresql://user:password"):
        click.echo("Missing DATABASE_URL. Copy .env.example to .env and set your Neon connection string.", err=True)
        sys.exit(1)

    try:
        init_database(config)
    except psycopg.Error as exc:
        click.echo(f"Database connection failed: {exc}", err=True)
        sys.exit(1)

    click.echo(f"Database ready at {config.database_host()}")


@cli.command()
def fetch() -> None:
    """Fetch prices once and save to the database."""
    config = Config.from_env()
    missing = config.validate_keys()
    if missing:
        click.echo(f"Missing configuration: {', '.join(missing)}", err=True)
        click.echo("Copy .env.example to .env and set your keys.", err=True)
        sys.exit(1)

    results = run_fetch(config)
    click.echo(
        f"Saved {results['total']} snapshots "
        f"(runpod={results['runpod']}, vast={results['vast']}, runcrate={results['runcrate']})"
    )


@cli.command("list")
@click.option("--latest", is_flag=True, help="Show only the most recent fetch.")
def list_prices(latest: bool) -> None:
    """List stored GPU prices from the database."""
    config = Config.from_env()
    if not config.database_url:
        click.echo("Missing DATABASE_URL. Run 'init-db' after configuring .env.", err=True)
        sys.exit(1)

    try:
        with get_connection(config.database_url) as conn:
            rows = get_latest_prices(conn) if latest else get_recent_prices(conn)
    except psycopg.Error as exc:
        click.echo(f"Database connection failed: {exc}", err=True)
        sys.exit(1)

    if not rows:
        click.echo("No price data found. Run 'fetch' first.")
        return

    click.echo(f"{'Provider':<8} {'GPU':<30} {'Type':<15} {'$/hr':<10} {'Stock':<8} {'Fetched'}")
    click.echo("-" * 95)
    for row in rows:
        name = row["display_name"] or row["gpu_id"]
        if len(name) > 28:
            name = name[:25] + "..."
        fetched_at = row["fetched_at"]
        if hasattr(fetched_at, "isoformat"):
            fetched_at = fetched_at.isoformat()
        click.echo(
            f"{row['provider']:<8} {name:<30} {row['instance_type']:<15} "
            f"${row['price_per_hour']:<9.4f} {str(row['stock_status'] or ''):<8} "
            f"{fetched_at}"
        )


@cli.command()
def run() -> None:
    """Start the scheduler to fetch prices on an interval."""
    config = Config.from_env()
    missing = config.validate_keys()
    if missing:
        click.echo(f"Missing configuration: {', '.join(missing)}", err=True)
        click.echo("Copy .env.example to .env and set your keys.", err=True)
        sys.exit(1)

    click.echo(
        f"Starting scheduler (every {config.fetch_interval_hours}h, "
        f"db={config.database_host()})"
    )
    start_scheduler(config)


@cli.command()
@click.option("--host", default="0.0.0.0", help="Host to bind the server to.")
@click.option("--port", default=8000, type=int, help="Port to bind the server to.")
def serve(host: str, port: int) -> None:
    """Start the FastAPI web server for the dashboard."""
    config = Config.from_env()
    if not config.database_url:
        click.echo("Missing DATABASE_URL. Configure .env first.", err=True)
        sys.exit(1)

    click.echo(f"Starting API server at http://{host}:{port}")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    cli()
