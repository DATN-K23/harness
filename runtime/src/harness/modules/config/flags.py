import os
import yaml
from pathlib import Path
from typing import Dict, Any

_default_flags_path = Path(__file__).resolve().parents[5] / "config" / "flags.yaml"
FLAGS_PATH = Path(os.environ.get("HARNESS_FLAGS_PATH", str(_default_flags_path)))

FLAGS: Dict[str, Any] = {}

def load_flags():
    global FLAGS
    if FLAGS_PATH.exists():
        with open(FLAGS_PATH, "r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f)
            if loaded:
                FLAGS = loaded
    else:
        print(f"Warning: config/flags.yaml not found at {FLAGS_PATH}")

def get_flag(key: str, default: Any = False) -> Any:
    return FLAGS.get(key, default)
