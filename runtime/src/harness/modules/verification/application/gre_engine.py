from ..ports.sandbox import ExecutionSandboxPort
from ..ports.llm import VerificationLLMPort

class GenerateRepairExecuteEngine:
    """
    Generate-Repair-Execute (GRE) Engine.
    Handles generating initial PoC script via LLM, and orchestrates an iterative 
    repair loop with isolated Foundry execution.
    """
    def __init__(self, sanitizer, sandbox: ExecutionSandboxPort, llm: VerificationLLMPort, max_retries: int = 5):
        self.sanitizer = sanitizer
        self.sandbox = sandbox
        self.llm = llm
        self.max_retries = max_retries

    def generate_initial_script(self, bce_slice: dict, metadata: dict, static_finding: dict = None) -> str:
        """
        Constructs the initial PoC script generation prompt payload.
        """
        pragma_directive = bce_slice.get("pragma_directive", "pragma solidity ^0.8.20;")
        base_template_code = metadata.get("base_template_code")
        if not base_template_code:
            raise ValueError("base_template_code is missing or empty in metadata. A base test template is required.")
        base_template_name = metadata.get("base_template_name", "Test")

        report_name = metadata.get("report_name", "Exploit")
        finding_desc = static_finding.get('description', '') if static_finding else ''
        finding_desc = static_finding.get('description', '') if static_finding else ''
        invariants = static_finding.get('expected_invariants', []) if static_finding else []
        invariants_str = '\n'.join([f"- {inv}" for inv in invariants])

        prompt = (
            "You are an expert smart contract security researcher.\n"
            "Your task is to write a Foundry test function to exploit the vulnerability described below. A full testing environment is already provided in the base template.\n\n"
            "### Vulnerability Description\n"
            f"{finding_desc}\n\n"
            "### The Goal (Expected Invariants to Break)\n"
            "To successfully demonstrate this bug, your exploit MUST break the following invariant(s):\n"
            f"{invariants_str}\n\n"
            "### Instructions\n"
            f"1. Write ONLY the specific `test{report_name}()` function to trigger the vulnerability.\n"
            "2. DO NOT add any import statements. They are already imported in the base template.\n"
            "3. Make sure your function actually performs the necessary steps (e.g. minting tokens, calling vulnerable functions, manipulating state) to violate the invariant above.\n"
            "4. CRITICAL REQUIREMENT: You MUST output ONLY a valid JSON object. Do not wrap it in markdown. Do not include any other text.\n"
            "Your JSON MUST perfectly match this schema:\n"
            "{\n"
            '  "test_function": "The raw Solidity code for the test function. e.g., `function test() public { ... }`",\n'
            '  "helper_functions": "The raw Solidity code for any internal helper functions needed inside the test contract. Use an empty string if none.",\n'
            '  "helper_contracts": "The raw Solidity code for any malicious helper contracts, interfaces, or libraries you need. Use an empty string if none are needed."\n'
            "}\n\n"
            "### Base Template Context\n"
            "Here is the base template for your reference (so you know what variables/functions/setup are available):\n"
            "```solidity\n"
            f"{base_template_code}\n"
            "```\n"
            "## BCE Slice (Relevant Context)\n"
            f"{bce_slice}\n\n"
            "Respond ONLY with the JSON object."
        )
            
        return self.llm.query(prompt)

    def execute_and_repair(self, script: str, bce_slice: dict = None, metadata: dict = None, on_progress: callable = None) -> dict:
        """
        Runs the isolated Foundry execution wrapper and iteratively repairs if compilation/execution fails.
        """
        bce_slice = bce_slice or {}
        metadata = metadata or {}
        if not metadata.get("base_template_code"):
            raise ValueError("base_template_code is missing or empty in metadata. A base test template is required.")
        pragma_directive = bce_slice.get("pragma_directive", "pragma solidity ^0.8.20;")
        
        current_script = script
        last_result = None
        history = []

        for attempt in range(self.max_retries + 1):
            raw_script = current_script
            if self.sanitizer:
                current_script = self.sanitizer.sanitize(current_script, metadata)

            result = self.sandbox.run_isolated(current_script, metadata)
            last_result = result
            last_result["final_script"] = current_script
            
            # Format structured error logs
            error_logs = ""
            if result.get("compiler_error"):
                error_logs += f"### Compiler Error\n{result['compiler_error']}\n\n"
            if result.get("execution_error"):
                error_logs += f"### Execution Error\n{result['execution_error']}\n\n"
            if result.get("error"):
                error_logs += f"### Error (Stderr)\n{result['error']}\n\n"
            if result.get("output"):
                error_logs += f"### Execution Traces (Stdout)\n{result['output']}\n\n"
                
            if not error_logs:
                error_logs = "Unknown error"
                
            history.append({
                "attempt": attempt,
                "raw_script": raw_script,
                "script": current_script,
                "error_logs": error_logs
            })
            
            if on_progress:
                on_progress(history)
            
            # If it succeeded, or if we ran out of retries, break early
            if result.get("success", False) or attempt == self.max_retries:
                break
                
            import sys
            old_kwargs = {}
            try:
                if hasattr(sys.stdout, "reconfigure"):
                    old_kwargs['encoding'] = getattr(sys.stdout, 'encoding', None)
                    old_kwargs['errors'] = getattr(sys.stdout, 'errors', None)
                    sys.stdout.reconfigure(encoding="utf-8")
            except Exception:
                pass
                

            print(f"\n[GRE Engine] Attempt {attempt} failed! Errors from Foundry:")
            if result.get("compiler_error"):
                print(f"--- Compiler Error ---\n...{result['compiler_error'][-500:]}")
            elif result.get("execution_error"):
                print(f"--- Execution Error ---\n...{result['execution_error'][-500:]}")
            elif result.get("error"):
                print(f"--- Docker/System Error ---\n...{result['error'][-500:]}")
                
            try:
                if hasattr(sys.stdout, "reconfigure"):
                    kwargs = {k: v for k, v in old_kwargs.items() if v is not None}
                    if kwargs:
                        sys.stdout.reconfigure(**kwargs)
            except Exception:
                pass
                
            import time
            time.sleep(4)
            # Otherwise, ask the LLM for a repair
            base_template_code = metadata.get("base_template_code")
            base_template_name = metadata.get("base_template_name", "Test")
            
            report_name = metadata.get("report_name", "Exploit")
            repair_prompt = (
                "The following Foundry PoC script failed to execute or compile.\n"
                "CRITICAL REQUIREMENT: You MUST output ONLY a valid JSON object matching this schema. Do not include markdown blocks or any other text.\n"
                "{\n"
                '  "test_function": "The raw Solidity code for the test function. e.g., `function test() public { ... }`",\n'
                '  "helper_functions": "The raw Solidity code for any internal helper functions needed inside the test contract. Use an empty string if none.",\n'
                '  "helper_contracts": "The raw Solidity code for any malicious helper contracts, interfaces, or libraries you need. Use an empty string if none are needed."\n'
                "}\n"
                "DO NOT add any import statements for the protocol contracts. They are already imported and available in the base template.\n"
                "Here is the base template for your reference (so you know what variables/functions are available):\n"
                "```solidity\n"
                f"{base_template_code}\n"
                "```\n\n"
                "## Project Metadata\n"
                f"Repo: {metadata.get('repo', 'unknown')}\n"
                f"Files: {metadata.get('project_files', [])}\n\n"
                "## BCE Slice (Relevant Context)\n"
                f"{bce_slice}\n\n"
                "## Failing Script\n"
                f"{raw_script}\n\n"
                "## Error Logs\n"
                f"{error_logs.strip()}\n\n"
                "Please provide a repaired script that fixes the errors. "
                "Respond ONLY with the Solidity code for the repaired PoC script."
            )
            current_script = self.llm.query(repair_prompt)
            
        if last_result is not None:
            last_result["history"] = history
        return last_result
