from ..ports.llm import VerificationLLMPort
import json
import re

class DifferentialVerificationModule:
    """
    Action-State Differential Verification (DV) Module.
    Extracts pre/post trigger state checks, instruments PoCs with structured state logging,
    and performs semantic sanity evaluation.
    """
    def __init__(self, llm: VerificationLLMPort):
        self.llm = llm

    def extract_action_state(self, finding_data: dict, poc: str) -> dict:
        """
        Derives trigger actions and observable state variables from public ABIs and report narratives.
        """
        prompt = f"""
        Given the public ABIs, report narrative, and the generated PoC, identify the trigger action (contract and function) 
        and the observable state variables to check pre and post exploit.
        Return ONLY a JSON object in this format:
        {{
            "trigger": {{"contract": "ContractName", "function": "functionName(uint256)"}},
            "states": [{{"contract": "ContractName", "function": "balanceOf(address)"}}]
        }}
        
        ABIs: {finding_data.get('public_abis', '')}
        Narrative: {finding_data.get('report_narrative', '')}
        PoC: {poc}
        """
        response = self.llm.query(prompt)
        
        # Extract JSON by matching outermost braces
        start = response.find('{')
        if start != -1:
            count = 0
            for i in range(start, len(response)):
                if response[i] == '{':
                    count += 1
                elif response[i] == '}':
                    count -= 1
                    if count == 0:
                        try:
                            return json.loads(response[start:i+1])
                        except json.JSONDecodeError:
                            break
        return {}

    def insert_instrumentation(self, test_code: str, action_state: dict) -> str:
        """
        Injects pre-action queries, trigger executions, post-action queries, and structured logs using the LLM.
        """
        prompt = f"""
        System: Please insert identical action and state-query operations from the differential description before and after the PoC's critical attacker action, compare the results, and log both the state values and each executed step.
        Ensure you use `emit log_named_uint("pre_state_N", value)` and `emit log_named_uint("post_state_N", value)` so the logs can be parsed.
        
        Input:
        ## PoC
        {test_code}
        
        ## Differential Description
        {json.dumps(action_state, indent=2)}
        
        Respond ONLY with the complete, modified Solidity code for the PoC script (no markdown blocks, just the raw source code).
        """
        
        return self.llm.query(prompt)

    def parse_state_logs(self, logs: str) -> tuple[dict, dict]:
        """
        Parses structured state logging from PoC execution output.
        """
        pre_state = {}
        post_state = {}
        
        for match in re.finditer(r'pre_state_(\d+):\s*(\d+)', logs):
            pre_state[f"state_{match.group(1)}"] = int(match.group(2))
            
        for match in re.finditer(r'post_state_(\d+):\s*(\d+)', logs):
            post_state[f"state_{match.group(1)}"] = int(match.group(2))
            
        return pre_state, post_state

    def evaluate_verdict(self, pre_state: dict, post_state: dict) -> str:
        """
        Compares pre/post states and queries the LLM to confirm exploit semantics.
        """
        prompt = f"""
        Given the pre-exploit state and post-exploit state, determine if the exploit was successful.
        Pre-state: {pre_state}
        Post-state: {post_state}
        If the states indicate a successful exploit (e.g., balance shifted unexpectedly), yield 'CONFIRMED_VULNERABLE'.
        Otherwise, yield 'REJECTED_FALSE_POSITIVE'.
        Reply with ONLY the verdict string.
        """
        response = self.llm.query(prompt)
        if "CONFIRMED_VULNERABLE" in response:
            return "CONFIRMED_VULNERABLE"
        return "REJECTED_FALSE_POSITIVE"
