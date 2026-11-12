"""Jobs worker (LLD Section 6, deployment Section 9).

Same codebase as the API, separate process in Docker Compose
(`worker` service, command `python -m app.worker`). No broker, no
separate queue service in MVP — the jobs table is the queue.

What one pass (`process_once`) does, in order:
1. Claims due `pending` jobs (attempts < MAX, next_run_at <= now),
   marks them `running`, and executes them. `evaluate_session`
   jobs: the session is evaluated in its own transaction (same
   function the API uses synchronously); a failure re-queues the
   job with backoff instead of half-awarding anything.
2. Sweeps orphaned `pending_evaluation` sessions — sessions whose
   synchronous evaluation failed before a job row was written, or
   that predate the worker (e.g. Rao's Step 5 test session). Only
   sessions untouched for ORPHAN_AGE are swept, so a session that
   is pending only because its upload request is still running is
   never raced. A sweep failure queues a job row for the retry loop.
3. Housekeeping: flips long-expired live ownership rows to
   superseded (tidiness only; map/leaderboard queries already
   filter by expiry).

`python -m app.worker --once` runs a single pass and exits — the
form used for testing and for a one-off catch-up run.
"""

import argparse
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.session import WalkingSession
from app.models.territory import HexOwnership, Job
from app.services.evaluation import evaluate_session

logger = logging.getLogger("lifequest.worker")

MAX_ATTEMPTS = 5
BATCH_SIZE = 200
ORPHAN_AGE = timedelta(minutes=5)
HOUSEKEEPING_INTERVAL = timedelta(hours=1)
BACKOFF_CAP_SECONDS = 600


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _backoff_seconds(attempts: int) -> int:
    return min(BACKOFF_CAP_SECONDS, 60 * 2 ** max(0, attempts - 1))


def _claim_due_jobs(db: Session, now: datetime) -> list[uuid.UUID]:
    query = (
        db.query(Job)
        .filter(Job.status == "pending", Job.next_run_at <= now, Job.attempts < MAX_ATTEMPTS)
        .order_by(Job.created_at)
        .limit(BATCH_SIZE)
    )
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        query = query.with_for_update(skip_locked=True)
    jobs = query.all()
    ids = []
    for job in jobs:
        job.status = "running"
        job.attempts += 1
        ids.append(job.id)
    db.commit()
    return ids


def _process_job(db: Session, job_id: uuid.UUID) -> None:
    job = db.query(Job).filter(Job.id == job_id).first()
    if job is None:
        return
    if job.job_type != "evaluate_session":
        logger.warning("unknown job type %s (job %s); failing without retry", job.job_type, job_id)
        job.status = "failed"
        db.commit()
        return
    try:
        session_uuid = uuid.UUID((job.payload or {}).get("session_uuid", ""))
    except (ValueError, TypeError, AttributeError):
        logger.warning("job %s has an unusable session_uuid payload; failing", job_id)
        job.status = "failed"
        db.commit()
        return
    session = db.query(WalkingSession).filter(WalkingSession.session_uuid == session_uuid).first()
    if session is None:
        logger.warning("job %s: session %s not found; failing", job_id, session_uuid)
        job.status = "failed"
        db.commit()
        return
    if session.status != "pending_evaluation":
        # Already evaluated, flagged, or rejected by another path —
        # nothing left for this job to do.
        job.status = "done"
        db.commit()
        return
    try:
        evaluate_session(db, session)
    except Exception:
        logger.exception("evaluation failed for job %s session %s", job_id, session_uuid)
        db.rollback()
        job = db.query(Job).filter(Job.id == job_id).first()
        if job is None:
            return
        if job.attempts >= MAX_ATTEMPTS:
            job.status = "failed"
        else:
            job.status = "pending"
            job.next_run_at = _now() + timedelta(seconds=_backoff_seconds(job.attempts))
        db.commit()
        return
    job = db.query(Job).filter(Job.id == job_id).first()
    if job is not None:
        job.status = "done"
        db.commit()
    logger.info("job %s: session %s evaluated", job_id, session_uuid)


def _sweep_orphans(db: Session, now: datetime) -> int:
    cutoff = now - ORPHAN_AGE
    sessions = (
        db.query(WalkingSession)
        .filter(WalkingSession.status == "pending_evaluation", WalkingSession.updated_at < cutoff)
        .all()
    )
    if not sessions:
        return 0
    open_jobs = (
        db.query(Job)
        .filter(Job.job_type == "evaluate_session", Job.status.in_(["pending", "running"]))
        .all()
    )
    covered = {(job.payload or {}).get("session_uuid") for job in open_jobs}
    swept = 0
    for session in sessions:
        if str(session.session_uuid) in covered:
            continue
        try:
            evaluate_session(db, session)
            swept += 1
        except Exception:
            logger.exception("orphan sweep failed for session %s", session.session_uuid)
            db.rollback()
            db.add(
                Job(
                    job_type="evaluate_session",
                    payload={"session_uuid": str(session.session_uuid)},
                    status="pending",
                    next_run_at=now + timedelta(seconds=60),
                )
            )
            db.commit()
    return swept


def _housekeeping(db: Session, now: datetime) -> int:
    rows = (
        db.query(HexOwnership)
        .filter(HexOwnership.superseded_at.is_(None), HexOwnership.expires_at <= now)
        .all()
    )
    for row in rows:
        row.superseded_at = now
    db.commit()
    return len(rows)


def process_once(session_factory, run_housekeeping: bool = True) -> dict:
    """One full worker pass. Returns counts for logging/tests."""
    db = session_factory()
    try:
        now = _now()
        job_ids = _claim_due_jobs(db, now)
        for job_id in job_ids:
            _process_job(db, job_id)
        swept = _sweep_orphans(db, _now())
        cleaned = _housekeeping(db, _now()) if run_housekeeping else 0
        return {"jobs": len(job_ids), "orphans_swept": swept, "housekeeping": cleaned}
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="LifeQuest jobs worker")
    parser.add_argument("--once", action="store_true", help="run a single pass and exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.once:
        result = process_once(SessionLocal)
        logger.info("worker --once done: %s", result)
        return
    poll = int(os.environ.get("WORKER_POLL_SECONDS", "5"))
    last_housekeeping = datetime.min.replace(tzinfo=timezone.utc)
    logger.info("worker loop started, polling every %ss", poll)
    while True:
        try:
            now = _now()
            run_hk = now - last_housekeeping >= HOUSEKEEPING_INTERVAL
            result = process_once(SessionLocal, run_housekeeping=run_hk)
            if run_hk:
                last_housekeeping = now
            if result["jobs"] or result["orphans_swept"] or result["housekeeping"]:
                logger.info("worker pass: %s", result)
        except Exception:
            logger.exception("worker pass failed; continuing")
        time.sleep(poll)


if __name__ == "__main__":
    main()
