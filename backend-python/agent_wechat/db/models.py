"""SQLAlchemy ORM models - matches existing Drizzle schema exactly."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


class Workspace(Base):
    """Workspace table - top-level container for agents and groups."""

    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Store as Unix timestamp (integer) to match existing SQLite schema
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)

    # Relationships
    agents: Mapped[list["Agent"]] = relationship(
        "Agent", back_populates="workspace", cascade="all, delete-orphan"
    )
    groups: Mapped[list["Group"]] = relationship(
        "Group", back_populates="workspace", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="workspace", cascade="all, delete-orphan"
    )


class Agent(Base):
    """Agent table - represents an AI agent or human user."""

    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String, ForeignKey("workspaces.id"), nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    parent_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    llm_history: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)

    # Relationships
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="agents")


class Group(Base):
    """Group table - chat groups containing agents."""

    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String, ForeignKey("workspaces.id"), nullable=False
    )
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    context_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)

    # Relationships
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="groups")
    members: Mapped[list["GroupMember"]] = relationship(
        "GroupMember", back_populates="group", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="group", cascade="all, delete-orphan"
    )


class GroupMember(Base):
    """Group member table - junction table for group membership."""

    __tablename__ = "group_members"

    group_id: Mapped[str] = mapped_column(
        String, ForeignKey("groups.id"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    last_read_message_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    joined_at: Mapped[int] = mapped_column(Integer, nullable=False)

    # Relationships
    group: Mapped["Group"] = relationship("Group", back_populates="members")


class Message(Base):
    """Message table - chat messages in groups."""

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String, ForeignKey("workspaces.id"), nullable=False
    )
    group_id: Mapped[str] = mapped_column(
        String, ForeignKey("groups.id"), nullable=False
    )
    sender_id: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    send_time: Mapped[int] = mapped_column(Integer, nullable=False)

    # Relationships
    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="messages")
    group: Mapped["Group"] = relationship("Group", back_populates="messages")
