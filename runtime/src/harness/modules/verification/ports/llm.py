class VerificationLLMPort:
    """
    Port for querying the LLM for PoC script generation and semantic sanity-checks.
    """
    def query(self, prompt: str) -> str:
        raise NotImplementedError
