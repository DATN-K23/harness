from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional
import asyncio
import json

from sqlalchemy.orm import Session
from harness.modules.persistence.database import SessionLocal, get_db
from harness.modules.persistence.models import Run, RunStatus, ToolCall, ModelEvent, Verdict

router = APIRouter(prefix="/api/v1/runs", tags=["Runs"])

from pydantic.alias_generators import to_camel

# --- Pydantic Schemas ---
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


# --- Routes ---

def _map_verdict(db_verdict: Verdict) -> Optional[VerdictSchema]:
    if not db_verdict:
        return None
    return VerdictSchema(
        schema_version=db_verdict.schema_version,
        validity=db_verdict.validity,
        severity=db_verdict.severity,
        confidence=db_verdict.confidence,
        rationale=db_verdict.rationale,
        evidence=db_verdict.evidence or [],
        verification_status=db_verdict.verification_status,
        label_normalization_version=db_verdict.label_normalization_version
    )

@router.post("/judge", response_model=JudgeResponseSchema)
def start_judge(request: JudgeRequestSchema, db: Session = Depends(get_db)):
    """Khởi tạo một Audit Run mới"""
    new_run = Run(
        title=f"Audit {request.finding_id}",
        target_repository=request.repository,
        finding_id=request.finding_id,
        status=RunStatus.PENDING
    )
    db.add(new_run)
    db.commit()
    db.refresh(new_run)
    return JudgeResponseSchema(run_id=new_run.id)


@router.get("", response_model=List[RunSchema])
def get_runs(db: Session = Depends(get_db)):
    """Lấy danh sách tất cả các phiên Audit"""
    runs = db.query(Run).order_by(Run.created_at.desc()).all()
    result = []
    for r in runs:
        result.append(RunSchema(
            id=r.id,
            title=r.title,
            target_repository=r.target_repository,
            finding_id=r.finding_id,
            status=r.status,
            total_duration_ms=r.total_duration_ms,
            verdict=_map_verdict(r.verdict)
        ))
    return result

@router.get("/{run_id}", response_model=RunSchema)
def get_run(run_id: str, db: Session = Depends(get_db)):
    """Lấy thông tin của một phiên Audit"""
    r = db.query(Run).filter(Run.id == run_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Run not found")
    
    return RunSchema(
        id=r.id,
        title=r.title,
        target_repository=r.target_repository,
        finding_id=r.finding_id,
        status=r.status,
        total_duration_ms=r.total_duration_ms,
        verdict=_map_verdict(r.verdict)
    )

@router.get("/{run_id}/tool-calls", response_model=List[ToolCallSchema])
def get_tool_calls(run_id: str, from_step: int = Query(0), limit: int = Query(500), db: Session = Depends(get_db)):
    """Lấy lịch sử gọi công cụ"""
    tool_calls = db.query(ToolCall).filter(
        ToolCall.run_id == run_id, 
        ToolCall.step_index >= from_step
    ).order_by(ToolCall.step_index.asc()).limit(limit).all()
    
    return [
        ToolCallSchema(
            id=tc.id,
            step_index=tc.step_index,
            tool_name=tc.tool_name,
            arguments_json=tc.arguments_json,
            result_json=tc.result_json,
            is_error=tc.is_error,
            duration_ms=tc.duration_ms,
            tokens_used=tc.tokens_used
        ) for tc in tool_calls
    ]

@router.get("/{run_id}/stream")
async def stream_run(run_id: str, from_step: int = Query(0)):
    """SSE endpoint cho live timeline (Polling DB)"""
    async def event_generator():
        # Tạo session riêng vì request depend db có thể bị đóng sau khi return StreamingResponse
        db = SessionLocal()
        try:
            last_event_step = from_step - 1
            last_tc_step = from_step - 1
            has_sent_verdict = False
            last_status = None
            
            while True:
                r = db.query(Run).filter(Run.id == run_id).first()
                if not r:
                    break
                    
                # 1. Phát sự kiện đổi status
                if r.status != last_status:
                    yield f"event: status_changed\ndata: {json.dumps({'status': str(r.status)})}\n\n"
                    last_status = r.status
                
                # 2. Phát thoughts (model events)
                events = db.query(ModelEvent).filter(
                    ModelEvent.run_id == run_id,
                    ModelEvent.step_index > last_event_step,
                    ModelEvent.event_type == 'thought'
                ).order_by(ModelEvent.step_index.asc()).all()
                
                for ev in events:
                    yield f"event: thought\ndata: {json.dumps({'stepIndex': ev.step_index, 'thought': ev.content})}\n\n"
                    last_event_step = max(last_event_step, ev.step_index)
                    
                # 3. Phát tool calls
                tcs = db.query(ToolCall).filter(
                    ToolCall.run_id == run_id,
                    ToolCall.step_index > last_tc_step
                ).order_by(ToolCall.step_index.asc()).all()
                
                for tc in tcs:
                    schema = ToolCallSchema(
                        id=tc.id,
                        step_index=tc.step_index,
                        tool_name=tc.tool_name,
                        arguments_json=tc.arguments_json,
                        result_json=tc.result_json,
                        is_error=tc.is_error,
                        duration_ms=tc.duration_ms,
                        tokens_used=tc.tokens_used
                    )
                    yield f"event: tool_call\ndata: {schema.model_dump_json(by_alias=True)}\n\n"
                    last_tc_step = max(last_tc_step, tc.step_index)
                
                # 4. Phát Verdict nếu có
                if r.verdict and not has_sent_verdict:
                    v_schema = _map_verdict(r.verdict)
                    yield f"event: verdict\ndata: {v_schema.model_dump_json(by_alias=True) if v_schema else '{}'}\n\n"
                    has_sent_verdict = True
                
                # 5. Dừng loop nếu run kết thúc
                if r.status in [RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED]:
                    yield f"event: completed\ndata: {json.dumps({'totalDurationMs': r.total_duration_ms})}\n\n"
                    break
                    
                # Đợi trước khi poll tiếp
                await asyncio.sleep(1.0)
                
                # Làm mới session để lấy dữ liệu cập nhật
                db.expire_all()
        finally:
            db.close()
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

