from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from pydantic.alias_generators import to_camel
from typing import List, Optional
import asyncio
import json

from sqlalchemy.orm import Session
from harness.modules.persistence.database import SessionLocal, get_db
from harness.modules.persistence.models import Run, RunStatus, ToolCall, ModelEvent, Verdict
from harness.modules.events.bus import event_bus

router = APIRouter(prefix="/api/v1/runs", tags=["Runs"])

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

async def mock_agent_loop(run_id: str):
    """Giả lập Agent chạy audit và phát event real-time"""
    await asyncio.sleep(1)
    
    with SessionLocal() as db:
        r = db.query(Run).filter(Run.id == run_id).first()
        if r:
            r.status = RunStatus.RUNNING
            db.commit()
    
    event_bus.publish(run_id, "status_changed", {"status": "RUNNING"})
    await asyncio.sleep(2)
    
    event_bus.publish(run_id, "thought", {"stepIndex": 1, "thought": "Analyzing repository for vulnerabilities..."})
    await asyncio.sleep(2)
    
    event_bus.publish(run_id, "tool_call", {
        "id": "tc-1", "stepIndex": 1, "toolName": "read_file",
        "argumentsJson": "{\"path\": \"src/Vault.sol\"}",
        "resultJson": "{\"content\": \"contract Vault { ... }\"}",
        "isError": False, "durationMs": 45, "tokensUsed": 100
    })
    await asyncio.sleep(2)
    
    event_bus.publish(run_id, "thought", {"stepIndex": 2, "thought": "Found reentrancy vulnerability in withdraw()."})
    await asyncio.sleep(2)
    
    verdict_data = {
        "schemaVersion": "judge-verdict-v1",
        "validity": "valid",
        "severity": "high",
        "confidence": 0.95,
        "rationale": "Reentrancy vector identified.",
        "evidence": [{"path": "src/Vault.sol", "start_line": 15, "end_line": 20}],
        "verificationStatus": "unverified",
        "labelNormalizationVersion": "v1.0"
    }
    event_bus.publish(run_id, "verdict", verdict_data)
    await asyncio.sleep(1)
    
    with SessionLocal() as db:
        r = db.query(Run).filter(Run.id == run_id).first()
        if r:
            r.status = RunStatus.COMPLETED
            r.total_duration_ms = 8000
            db.commit()
    
    event_bus.publish(run_id, "completed", {"totalDurationMs": 8000})


@router.post("/judge", response_model=JudgeResponseSchema)
def start_judge(request: JudgeRequestSchema, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
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
    
    # Launch mock agent
    background_tasks.add_task(mock_agent_loop, new_run.id)
    
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
    """SSE endpoint cho live timeline (EventBus)"""
    async def event_generator():
        # Lấy lịch sử từ DB trước
        db = SessionLocal()
        try:
            r = db.query(Run).filter(Run.id == run_id).first()
            if not r:
                yield f"event: error\ndata: {json.dumps({'detail': 'Run not found'})}\n\n"
                return
                
            yield f"event: status_changed\ndata: {json.dumps({'status': str(r.status)})}\n\n"
            
            events = db.query(ModelEvent).filter(
                ModelEvent.run_id == run_id,
                ModelEvent.step_index >= from_step,
                ModelEvent.event_type == 'thought'
            ).order_by(ModelEvent.step_index.asc()).all()
            for ev in events:
                yield f"event: thought\ndata: {json.dumps({'stepIndex': ev.step_index, 'thought': ev.content})}\n\n"
                
            tcs = db.query(ToolCall).filter(
                ToolCall.run_id == run_id,
                ToolCall.step_index >= from_step
            ).order_by(ToolCall.step_index.asc()).all()
            for tc in tcs:
                schema = ToolCallSchema(
                    id=tc.id, step_index=tc.step_index, tool_name=tc.tool_name,
                    arguments_json=tc.arguments_json, result_json=tc.result_json,
                    is_error=tc.is_error, duration_ms=tc.duration_ms, tokens_used=tc.tokens_used
                )
                yield f"event: tool_call\ndata: {schema.model_dump_json(by_alias=True)}\n\n"
            
            if r.verdict:
                v_schema = _map_verdict(r.verdict)
                yield f"event: verdict\ndata: {v_schema.model_dump_json(by_alias=True) if v_schema else '{}'}\n\n"
                
            if r.status in [RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED]:
                yield f"event: completed\ndata: {json.dumps({'totalDurationMs': r.total_duration_ms})}\n\n"
                return
        finally:
            db.close()
            
        # Đợi các event mới realtime từ EventBus
        async for msg in event_bus.subscribe(run_id):
            yield msg
            if "event: completed" in msg:
                break
                
    return StreamingResponse(event_generator(), media_type="text/event-stream")
