"""Database session handling (SQLAlchemy, sync engine, MVP).

Why sync, not async, for the skeleton: the MVP endpoints are
transaction-heavy (territory evaluation must run in one transaction),
and a sync engine keeps that code straightforward.

`pool_pre_ping=True` drops dead connections from the pool instead
of handing a stale connection to a request after a database restart.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=10,
    pool_timeout=30,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    """FastAPI dependency: one session per request, always closed."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
