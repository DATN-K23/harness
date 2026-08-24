import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

def generate_uuid() -> str:
    return str(uuid.uuid4())

def utc_now() -> datetime:
    return datetime.now(UTC)

class RunStatus(enum.StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

class VerdictStatus(enum.StrEnum):
    VALID = "VALID"
    INVALID = "INVALID"
    UNVERIFIED = "UNVERIFIED"

class Run(Base):
    __tablename__ = "runs"

    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String, nullable=False)
    target_repository = Column(String, nullable=False)
    finding_id = Column(String, nullable=False)
    status = Column(Enum(RunStatus), default=RunStatus.PENDING, nullable=False)
    started_at = Column(DateTime(timezone=True), default=utc_now)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    total_duration_ms = Column(Integer, default=0, nullable=False)
    total_tokens_used = Column(Integer, default=0, nullable=False)
    total_cost_usd = Column(Float, default=0.0, nullable=False)

    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    # Relationships
    config_snapshot = relationship(
        "RunConfigSnapshot", back_populates="run", uselist=False, cascade="all, delete"
    )
    tool_calls = relationship("ToolCall", back_populates="run", cascade="all, delete")
    model_events = relationship("ModelEvent", back_populates="run", cascade="all, delete")
    verdict = relationship(
        "Verdict", back_populates="run", uselist=False, cascade="all, delete"
    )

class RunConfigSnapshot(Base):
    __tablename__ = "run_config_snapshots"

    id = Column(String, primary_key=True, default=generate_uuid)
    run_id = Column(String, ForeignKey("runs.id", ondelete="CASCADE"), unique=True, nullable=False)
    model_provider = Column(String, nullable=False)
    model_name = Column(String, nullable=False)
    temperature = Column(Float, default=0.0, nullable=False)
    max_steps = Column(Integer, default=50, nullable=False)
    token_budget = Column(Integer, default=150000, nullable=False)
    enable_memory = Column(Boolean, default=True, nullable=False)
    enable_compaction = Column(Boolean, default=True, nullable=False)
    enable_verification = Column(Boolean, default=True, nullable=False)
    prompt_version = Column(String, nullable=False)
    config_hash = Column(String, nullable=False)

    run = relationship("Run", back_populates="config_snapshot")

class ToolCall(Base):
    __tablename__ = "tool_calls"

    id = Column(String, primary_key=True, default=generate_uuid)
    run_id = Column(String, ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    step_index = Column(Integer, nullable=False)
    tool_name = Column(String, nullable=False)
    arguments_json = Column(Text, nullable=False)
    result_json = Column(Text, nullable=False)
    is_error = Column(Boolean, default=False, nullable=False)
    duration_ms = Column(Integer, default=0, nullable=False)
    tokens_used = Column(Integer, default=0, nullable=False)
    timestamp = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    run = relationship("Run", back_populates="tool_calls")

class ModelEvent(Base):
    __tablename__ = "model_events"

    id = Column(String, primary_key=True, default=generate_uuid)
    run_id = Column(String, ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    step_index = Column(Integer, nullable=False)
    event_type = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    tokens_used = Column(Integer, default=0, nullable=False)
    timestamp = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    run = relationship("Run", back_populates="model_events")

class Verdict(Base):
    __tablename__ = "verdicts"

    id = Column(String, primary_key=True, default=generate_uuid)
    run_id = Column(String, ForeignKey("runs.id", ondelete="CASCADE"), unique=True, nullable=False)
    status = Column(Enum(VerdictStatus), nullable=False)
    severity = Column(String, nullable=False)
    confidence_score = Column(Float, nullable=False)
    explanation = Column(Text, nullable=False)
    poc_source_code = Column(Text, nullable=True)
    poc_result = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    run = relationship("Run", back_populates="verdict")
