from ..ports.llm import VerificationLLMPort

class ModelGatewayLLMAdapter(VerificationLLMPort):
    def query(self, prompt: str) -> str:
        # TODO: Implement model gateway interaction for SmartPoC
        return ""
