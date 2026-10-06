import json
import os
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v1/demo", tags=["Demo"])

_default_fixtures = Path(__file__).resolve().parents[4] / "demo-fixtures"
FIXTURES_DIR = Path(os.environ.get("HARNESS_FIXTURES_DIR", str(_default_fixtures)))

@router.get("/runs/{run_id}/timeline")
def get_demo_timeline(run_id: str) -> Dict[str, Any]:
    """Lấy danh sách các sự kiện (timeline) cho Offline Demo Mode"""
    # Nếu không phải demo-run-01 thì trả về 404 (chỉ có 1 fixture)
    if run_id != "demo-run-01":
        raise HTTPException(status_code=404, detail="Demo run not found")
        
    fixture_path = FIXTURES_DIR / "run-01.json"
    if not fixture_path.exists():
        raise HTTPException(status_code=404, detail="Fixture file not found")
        
    try:
        with open(fixture_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading fixture: {str(e)}")
