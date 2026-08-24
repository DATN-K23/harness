from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional
import asyncio
import json

router = APIRouter(prefix="/api/v1/runs", tags=["Runs"])

from pydantic.alias_generators import to_camel

# --- Pydantic Schemas ---
class VerdictSchema(BaseModel):
    status: str
    severity: str
    confidence_score: float
    explanation: str
    poc_source_code: Optional[str] = None
    
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

# --- Mock Data ---
MOCK_RUN = RunSchema(
    id="demo-run-01",
    title="Demo Audit Run",
    target_repository="https://github.com/demo/project",
    finding_id="FINDING-001",
    status="COMPLETED",
    total_duration_ms=5200,
    verdict=VerdictSchema(
        status="VALID",
        severity="HIGH",
        confidence_score=0.95,
        explanation="Found CEI violation."
    )
)

MOCK_TOOL_CALLS = [
    ToolCallSchema(
        id="tc-1",
        step_index=1,
        tool_name="read_file",
        arguments_json='{"path": "Vault.sol"}',
        result_json='{"content": "..."}',
        is_error=False,
        duration_ms=45
    )
]

# --- Routes ---

@router.get("/{run_id}", response_model=RunSchema)
def get_run(run_id: str):
    """Lấy thông tin của một phiên Audit"""
    if run_id != "demo-run-01":
        raise HTTPException(status_code=404, detail="Run not found")
    return MOCK_RUN

@router.get("/{run_id}/tool-calls", response_model=List[ToolCallSchema])
def get_tool_calls(run_id: str, from_step: int = Query(0), limit: int = Query(500)):
    """Lấy lịch sử gọi công cụ"""
    if run_id != "demo-run-01":
        return []
    return [tc for tc in MOCK_TOOL_CALLS if tc.stepIndex >= from_step][:limit]

@router.get("/{run_id}/stream")
async def stream_run(run_id: str, from_step: int = Query(0)):
    """SSE endpoint cho live timeline"""
    async def event_generator():
        # Giả lập luồng sự kiện
        events = [
            {"event": "status_changed", "data": json.dumps({"status": "RUNNING"})},
            {"event": "thought", "data": json.dumps({"stepIndex": 1, "thought": "Analyzing Vault.sol..."})},
            {"event": "tool_call", "data": MOCK_TOOL_CALLS[0].model_dump_json(by_alias=True)},
            {"event": "verdict", "data": MOCK_RUN.verdict.model_dump_json(by_alias=True) if MOCK_RUN.verdict else "{}"},
            {"event": "completed", "data": json.dumps({"totalDurationMs": 5200})}
        ]
        
        for e in events:
            yield f"event: {e['event']}\ndata: {e['data']}\n\n"
            await asyncio.sleep(1.0)
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")
