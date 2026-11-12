"""Redis cache for hot reads (pool-exhaustion fix, 2026-11-07).

Why: every read hit Postgres and held a pool connection; at 500 users the
30-connection pool exhausted (QueuePool TimeoutError, run9). Caching the
hot reads means they never touch the DB, so the pool stops saturating.
Fail-open: if Redis is down/slow, every op returns None / no-ops and the
endpoint falls back to the DB. The cache must never break the API.
TTL only (no explicit invalidation); staleness window is 30-60 s.
Eviction is LRU (redis maxmemory-policy allkeys-lru in compose).
"""
import logging

import redis as redis_lib

from app.core.config import settings

log = logging.getLogger(__name__)

_redis_client = None


def _get_client():
    """Lazy Redis client (created on first use, never at import time, so
    the jobs worker — which never calls the cache — never connects).
    NOTE: the global MUST NOT share the function's name — the first version
    named both `_client`, so the function returned itself and every
    c.set/c.get raised AttributeError, silently swallowed by fail-open."""
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = redis_lib.Redis.from_url(
                settings.redis_url,
                socket_connect_timeout=0.5,
                socket_timeout=0.5,
                decode_responses=True,
            )
        except Exception:
            log.warning("redis client init failed, caching disabled", exc_info=True)
            return None
    return _redis_client


def cache_get(key: str):
    """Return the cached JSON string, or None on miss / any Redis error."""
    c = _get_client()
    if c is None:
        return None
    try:
        return c.get(key)
    except Exception:
        return None


def cache_set(key: str, value: str, ttl_seconds: int) -> None:
    """Store a JSON string with a TTL. Silent no-op on any Redis error."""
    c = _get_client()
    if c is None:
        return
    try:
        c.set(key, value, ex=ttl_seconds)
    except Exception:
        return
