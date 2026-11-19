import asyncio
import os
import sys
from typing import Any
from pymongo import AsyncMongoClient

from app.core.config import get_settings

_probe_result: dict[str, Any] | None = None


async def check_live_atlas_availability() -> dict[str, Any]:
    """
    Checks whether a live MongoDB Atlas cluster is reachable within 3 seconds.
    Skips gracefully if unconfigured or blocked by IP allowlist, or throws hard if REQUIRE_LIVE_TESTS=true.
    """
    global _probe_result
    if _probe_result is not None:
        return _probe_result

    settings = get_settings()
    uri = settings.MONGODB_URI

    placeholders = ["<password>", "YOURPASSWORD", "cluster0.xxxxx", "<cluster>", "<user>"]
    if not uri or any(p in uri for p in placeholders):
        reason = "MONGODB_URI is unconfigured or contains placeholder values."
        _handle_unreachable(reason, settings.REQUIRE_LIVE_TESTS)
        _probe_result = {"available": False, "reason": reason}
        return _probe_result

    # Safety check on database name
    if not settings.MONGODB_TEST_DB_NAME.endswith("_test"):
        raise ValueError("SAFETY VIOLATION: MONGODB_TEST_DB_NAME must end with '_test'")

    client = AsyncMongoClient(uri, serverSelectionTimeoutMS=2000, connectTimeoutMS=2000)
    try:
        async def do_ping():
            await client[settings.MONGODB_TEST_DB_NAME].command("ping")

        await asyncio.wait_for(do_ping(), timeout=3.0)
        _probe_result = {"available": True}
        return _probe_result
    except Exception as err:
        reason = f"Live MongoDB Atlas connection failed ({err})"
        _handle_unreachable(reason, settings.REQUIRE_LIVE_TESTS)
        _probe_result = {"available": False, "reason": reason}
        return _probe_result
    finally:
        await client.close()


def _handle_unreachable(reason: str, require_live_config: bool) -> None:
    require_live = (
        os.environ.get("REQUIRE_LIVE_TESTS", "").lower() in ("true", "1")
        or require_live_config
    )

    if require_live:
        raise RuntimeError(
            f"\n❌ REQUIRE_LIVE_TESTS=true is set, but live MongoDB Atlas is unreachable:\n   {reason}\n"
        )

    sys.stderr.write(
        f"\n"
        f"====================================================================================\n"
        f"⚠️  LOUD WARNING: Skipping Live MongoDB Atlas Test Suites\n"
        f"   Reason: {reason}\n"
        f"   Skipped suite: Live Atlas index integration tests\n"
        f"   All unit and mocked index tests will continue running.\n"
        f"====================================================================================\n"
    )


async def skip_if_atlas_unavailable() -> None:
    """
    Helper for live integration tests: skips the test gracefully if Atlas
    is unreachable, or raises loudly if REQUIRE_LIVE_TESTS=true.
    Call at the top of any async test that needs a live Atlas connection.
    """
    import pytest
    result = await check_live_atlas_availability()
    if not result.get("available"):
        pytest.skip(f"Live Atlas unavailable: {result.get('reason', 'unknown')}")

