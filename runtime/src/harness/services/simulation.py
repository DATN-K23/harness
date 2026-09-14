import asyncio
from harness.modules.persistence.database import SessionLocal
from harness.modules.persistence.models import Run, RunStatus, ToolCall, ModelEvent, Verdict
from harness.modules.events.bus import event_bus


async def mock_agent_loop(run_id: str):
    """Giả lập Agent chạy audit và phát event real-time.

    Dual-write contract: persist mỗi event vào DB *trước* khi publish qua EventBus.
    Đảm bảo reconnecting clients có thể replay đầy đủ từ model_events / tool_calls.
    """
    await asyncio.sleep(1)

    with SessionLocal() as db:
        r = db.query(Run).filter(Run.id == run_id).first()
        if r:
            r.status = RunStatus.RUNNING
            db.commit()

    event_bus.publish(run_id, "status_changed", {"status": "RUNNING"})
    await asyncio.sleep(2)

    # --- Thought 1: Persist → Publish ---
    thought_1_id = f"thought_{run_id}_1"
    thought_1_content = "Analyzing repository for vulnerabilities..."
    with SessionLocal() as db:
        db.add(ModelEvent(
            run_id=run_id,
            step_index=1,
            event_type="thought",
            content=thought_1_content,
        ))
        db.commit()
    event_bus.publish(run_id, "thought", {
        "id": thought_1_id,
        "stepIndex": 1,
        "thought": thought_1_content,
    })
    await asyncio.sleep(2)

    # --- ToolCall 1: Persist → Publish ---
    tc_1_id = "tc-1"
    tc_1_args = "{\"path\": \"src/Vault.sol\"}"
    tc_1_result = "{\"content\": \"contract Vault { ... }\"}"
    with SessionLocal() as db:
        db.add(ToolCall(
            id=tc_1_id,
            run_id=run_id,
            step_index=1,
            tool_name="read_file",
            arguments_json=tc_1_args,
            result_json=tc_1_result,
            is_error=False,
            duration_ms=45,
            tokens_used=100,
        ))
        db.commit()
    event_bus.publish(run_id, "tool_call", {
        "id": tc_1_id,
        "stepIndex": 1,
        "toolName": "read_file",
        "argumentsJson": tc_1_args,
        "resultJson": tc_1_result,
        "isError": False,
        "durationMs": 45,
        "tokensUsed": 100,
    })
    await asyncio.sleep(2)

    # --- Thought 2: Persist → Publish ---
    thought_2_id = f"thought_{run_id}_2"
    thought_2_content = "Found reentrancy vulnerability in withdraw()."
    with SessionLocal() as db:
        db.add(ModelEvent(
            run_id=run_id,
            step_index=2,
            event_type="thought",
            content=thought_2_content,
        ))
        db.commit()
    event_bus.publish(run_id, "thought", {
        "id": thought_2_id,
        "stepIndex": 2,
        "thought": thought_2_content,
    })
    await asyncio.sleep(2)

    # --- Verdict: Persist → Publish ---
    verdict_evidence = [{"path": "src/Vault.sol", "start_line": 15, "end_line": 20}]
    with SessionLocal() as db:
        r = db.query(Run).filter(Run.id == run_id).first()
        if r:
            db.add(Verdict(
                run_id=run_id,
                schema_version="judge-verdict-v1",
                validity="valid",
                severity="high",
                confidence=0.95,
                rationale="Reentrancy vector identified.",
                evidence=verdict_evidence,
                verification_status="unverified",
                label_normalization_version="v1",
            ))
            db.commit()
    event_bus.publish(run_id, "verdict", {
        "schemaVersion": "judge-verdict-v1",
        "validity": "valid",
        "severity": "high",
        "confidence": 0.95,
        "rationale": "Reentrancy vector identified.",
        "evidence": verdict_evidence,
        "verificationStatus": "unverified",
        "labelNormalizationVersion": "v1.0",
    })
    await asyncio.sleep(1)

    with SessionLocal() as db:
        r = db.query(Run).filter(Run.id == run_id).first()
        if r:
            r.status = RunStatus.COMPLETED
            r.total_duration_ms = 8000
            db.commit()

    event_bus.publish(run_id, "completed", {"totalDurationMs": 8000})
