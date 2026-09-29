from dataclasses import dataclass

@dataclass
class SmartPoCConfig:
    enabled: bool = False
    max_repair_retries: int = 5
