from enum import Enum

class VerificationVerdict(Enum):
    CONFIRMED_VULNERABLE = "CONFIRMED_VULNERABLE"
    REJECTED_FALSE_POSITIVE = "REJECTED_FALSE_POSITIVE"
    EXECUTION_FAILED = "EXECUTION_FAILED"
    UNVERIFIED = "UNVERIFIED"

class VerificationResult:
    def __init__(self, verdict: VerificationVerdict, evidence: dict):
        self.verdict = verdict
        self.evidence = evidence
