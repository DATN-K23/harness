import json
import os
from ..ports.trajectory import TrajectoryStorePort

class DatabaseTrajectoryStoreAdapter(TrajectoryStorePort):
    def __init__(self, output_dir: str = "."):
        self.output_dir = output_dir

    def save_trajectory(self, run_id: str, data: dict):
        file_path = os.path.join(self.output_dir, f"trajectory_{run_id}.json")
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        print(f"\\n[Telemetry] Saved trajectory to {file_path}")
