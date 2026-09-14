from typing import List, Optional
from pydantic import BaseModel, Field, model_validator
from pydantic.alias_generators import to_camel


class EvidenceSchema(BaseModel):
    path: str
    start_line: int
    end_line: int
    content_digest: Optional[str] = None
    note: Optional[str] = None


class VerdictSchema(BaseModel):
    schema_version: str = "judge-verdict-v1"
    validity: str
    severity: str
    confidence: float
    rationale: str
    evidence: List[EvidenceSchema] = Field(default_factory=list)
    verification_status: str = "unverified"
    label_normalization_version: str = "v1"

    @model_validator(mode="after")
    def check_severity(self):
        if self.validity == "invalid" and self.severity != "none":
            raise ValueError("invalid findings SHALL use severity 'none'")
        return self

    class Config:
        alias_generator = to_camel
        populate_by_name = True


class RunSchema(BaseModel):
    id: str
    title: str
    target_repository: str
    finding_id: str
    status: str
    total_duration_ms: int
    verdict: Optional[VerdictSchema] = None

    class Config:
        alias_generator = to_camel
        populate_by_name = True


class ToolCallSchema(BaseModel):
    id: str
    step_index: int
    tool_name: str
    arguments_json: str
    result_json: str
    is_error: bool
    duration_ms: int
    tokens_used: Optional[int] = 0

    class Config:
        alias_generator = to_camel
        populate_by_name = True


class ModelEventSchema(BaseModel):
    id: str
    step_index: int
    event_type: str
    content: str

    class Config:
        alias_generator = to_camel
        populate_by_name = True


class JudgeRequestSchema(BaseModel):
    repository: str
    finding_id: str
    model_name: str
    token_budget: int = 150000

    class Config:
        alias_generator = to_camel
        populate_by_name = True


class JudgeResponseSchema(BaseModel):
    run_id: str

    class Config:
        alias_generator = to_camel
        populate_by_name = True
