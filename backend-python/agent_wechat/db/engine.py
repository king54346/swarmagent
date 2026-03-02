"""SQLAlchemy engine and session management."""

import os
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from ..config import get_settings

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_database_url() -> str:
    """Get the database URL from settings."""
    settings = get_settings()
    db_path = settings.database_url

    # Remove 'file:' prefix if present
    if db_path.startswith("file:"):
        db_path = db_path[5:]

    # Ensure directory exists
    if not db_path.startswith(":memory:"):
        path = Path(db_path)
        if not path.is_absolute():
            # Relative to current working directory
            path = Path.cwd() / db_path
        path.parent.mkdir(parents=True, exist_ok=True)
        db_path = str(path)

    return f"sqlite:///{db_path}"


def get_engine() -> Engine:
    """Get or create the SQLAlchemy engine."""
    global _engine
    if _engine is None:
        database_url = get_database_url()
        _engine = create_engine(
            database_url,
            connect_args={"check_same_thread": False},  # Required for SQLite
            echo=False,
        )

        # Enable WAL mode for better concurrency
        @event.listens_for(_engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return _engine


def get_session_maker() -> sessionmaker[Session]:
    """Get or create the session maker."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=get_engine(),
        )
    return _SessionLocal


def get_session() -> Generator[Session, None, None]:
    """Dependency that provides a database session."""
    SessionLocal = get_session_maker()
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def create_session() -> Session:
    """Create a new database session directly."""
    SessionLocal = get_session_maker()
    return SessionLocal()
