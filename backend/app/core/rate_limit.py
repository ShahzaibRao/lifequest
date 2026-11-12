"""Redis-backed login rate limiting (fail-open: if Redis is down, allow).

Two limits, both in Redis so they are shared across uvicorn workers:
1. Per-email FAILED attempts: 10 failed logins / 15 min -> 429.
   Only FAILED attempts count, so a legitimate user who logs in
   fine is never blocked. A successful login clears the counter.
2. Per-IP attempts: 1000 login attempts / min -> 429.
   A flood guard. Set high enough that the load test (peak ~600/min
   from localhost at spawn-rate 10) stays under it.

The login endpoint calls check_login_allowed() BEFORE doing bcrypt,
record_login_failure() on a wrong password / unknown user, and
record_login_success() on a good login.
"""

import logging

import redis as redis_lib

from app.core.config import settings

log = logging.getLogger(__name__)

_redis_conn = None


def _redis():
    """Lazy Redis client (created on first use, never at import time)."""
    global _redis_conn
    if _redis_conn is None:
        try:
            _redis_conn = redis_lib.Redis.from_url(
                settings.redis_url,
                socket_connect_timeout=0.5,
                socket_timeout=0.5,
                decode_responses=True,
            )
        except Exception:
            log.warning("redis client init failed, rate limiting disabled", exc_info=True)
            return None
    return _redis_conn


# Limits (tune here, not in the endpoint).
EMAIL_FAIL_LIMIT = 10  # failed logins per email before a block
EMAIL_FAIL_WINDOW = 15 * 60  # 15 minutes
IP_LIMIT = 1000  # login attempts per IP per minute
IP_WINDOW = 60  # 1 minute


def _incr(key: str, window_seconds: int):
    """Atomically increment a counter; set its expiry on first hit.
    Returns the new count, or None if Redis is unavailable."""
    r = _redis()
    if r is None:
        return None
    try:
        count = r.incr(key)
        if count == 1:
            r.expire(key, window_seconds)
        return count
    except Exception:
        return None


def check_login_allowed(email: str, client_ip: str):
    """Return (allowed, retry_after_seconds). Call BEFORE bcrypt.
    Fail-open: any Redis error -> allow (rate limiting must never
    break login when Redis is down)."""
    r = _redis()
    if r is None:
        return True, 0
    try:
        fails = r.get(f"rl:login:email:{email}")
        if fails is not None and int(fails) >= EMAIL_FAIL_LIMIT:
            ttl = r.ttl(f"rl:login:email:{email}")
            return False, max(ttl, 1)
        count = _incr(f"rl:login:ip:{client_ip}", IP_WINDOW)
        if count is not None and count > IP_LIMIT:
            return False, IP_WINDOW
    except Exception:
        return True, 0
    return True, 0


def record_login_failure(email: str) -> None:
    """Increment the per-email failed-login counter. Call ONLY when a
    login attempt actually failed (wrong password / unknown user)."""
    _incr(f"rl:login:email:{email}", EMAIL_FAIL_WINDOW)


def record_login_success(email: str) -> None:
    """Clear the per-email failure counter after a good login."""
    r = _redis()
    if r is None:
        return
    try:
        r.delete(f"rl:login:email:{email}")
    except Exception:
        return
