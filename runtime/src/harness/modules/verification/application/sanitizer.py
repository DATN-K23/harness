import json
import re

class PreExecutionSanitizer:
    """
    Deterministic Pre-Execution Sanitizer and Anti-Cheating Filter.
    Normalizes compiler versions, rewrites relative import paths, stubs missing dependency interfaces, 
    and inspects generated test to reject non-faithful overrides.
    """

    def sanitize(self, test_code: str, metadata: dict) -> str:
        """
        Injects the LLM generated test function directly into the base template.
        """
        if test_code is None:
            return ""
        test_code = test_code.strip()
        
        # Try to strip markdown JSON wrapping if present
        if test_code.startswith("```json"):
            test_code = test_code[len("```json"):].strip()
        elif test_code.startswith("```"):
            test_code = test_code[len("```"):].strip()
        if test_code.endswith("```"):
            test_code = test_code[:-3].strip()

        # Parse JSON
        inside_code = test_code
        outside_code = ""
        try:
            parsed = json.loads(test_code)
            test_fn = parsed.get("test_function", "").strip()
            helper_fns = parsed.get("helper_functions", "").strip()
            inside_code = test_fn + ("\n\n" + helper_fns if helper_fns else "")
            outside_code = parsed.get("helper_contracts", "")
        except json.JSONDecodeError:
            # Fallback for LLMs that failed to output JSON
            pass
        
        base_template_code = metadata.get("base_template_code", "")
        base_template_name = metadata.get("base_template_name", "Test")
        report_name = metadata.get("report_name", "Exploit")
        
        test_contract_name = f"{report_name}Test"
        
        # Rename the base contract to the test contract name
        new_template = re.sub(
            rf'\bcontract\s+{re.escape(base_template_name)}\b', 
            f'contract {test_contract_name}', 
            base_template_code, 
            count=1
        )
        
        # 1. Extract and hoist any import statements from helper contracts
        imports = re.findall(r'^\s*import\s+.*?;', outside_code, flags=re.MULTILINE)
        if imports:
            outside_code = re.sub(r'^\s*import\s+.*?;', '', outside_code, flags=re.MULTILINE)
            new_template = re.sub(r'(pragma solidity[^;]+;)', r'\1\n' + '\n'.join(imports), new_template, count=1)
            
        # 2. Inject test_function inside, and helper_contracts outside
        last_brace_index = new_template.rfind('}')
        if last_brace_index != -1:
            if outside_code.strip():
                new_template = (
                    new_template[:last_brace_index] + 
                    f"\n    // --- INJECTED BY GRE ENGINE ---\n{inside_code}\n" + 
                    new_template[last_brace_index:] + 
                    f"\n\n// --- HELPER CONTRACTS ---\n{outside_code}\n"
                )
            else:
                new_template = new_template[:last_brace_index] + f"\n    // --- INJECTED BY GRE ENGINE ---\n{inside_code}\n" + new_template[last_brace_index:]
            
        return new_template

    def filter_anti_cheating(self, test_code: str) -> bool:
        """
        Detects and rejects/strips test contracts that redeclare or override target contract functions.
        Also blocks malicious cheatcodes like `ffi`.
        Returns True if safe, False if cheating detected.
        """
        def strip_comments_and_strings(text: str) -> str:
            result = []
            i = 0
            n = len(text)
            while i < n:
                if text[i:i+2] == '//':
                    while i < n and text[i] != '\n':
                        i += 1
                elif text[i:i+2] == '/*':
                    i += 2
                    while i < n and text[i:i+2] != '*/':
                        i += 1
                    # Skip the '*/'
                    if i < n:
                        i += 2
                elif text[i] in '"\'':
                    quote = text[i]
                    i += 1
                    while i < n and text[i] != quote:
                        if text[i] == '\\':
                            i += 2
                        else:
                            i += 1
                    i += 1
                else:
                    result.append(text[i])
                    i += 1
            return "".join(result)
            
        clean_code = strip_comments_and_strings(test_code)
        
        # 1. Reject malicious cheatcodes like ffi (e.g. vm.ffi)
        if re.search(r'\bffi\b', clean_code):
            return False
            
        # 2. Reject test contracts that override target contract functions.
        # Without target contract ABI, we block the 'override' keyword 
        # which prevents non-faithful fake-exploit overrides.
        if re.search(r'\boverride\b', clean_code):
            return False
            
        return True
