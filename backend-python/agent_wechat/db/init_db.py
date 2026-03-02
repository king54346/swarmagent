"""Database initialization - create tables."""

from .engine import get_engine
from .models import Base


def ensure_schema():
    """Create all tables if they don't exist."""
    engine = get_engine()
    Base.metadata.create_all(bind=engine)


def drop_all_tables():
    """Drop all tables - use with caution!"""
    engine = get_engine()
    Base.metadata.drop_all(bind=engine)
