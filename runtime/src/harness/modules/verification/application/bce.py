import tempfile
import os
import re
from typing import Dict, Any, Set, List
from collections import defaultdict

class BugContextExtractionModule:
    """
    Bug-Context Extraction (BCE) Module.
    Responsible for utilizing Slither AST and call-graph analysis to construct 
    pruned function slices with semantic/structural link expansion.
    """

    def extract_context(self, finding_data: dict, project_path: str) -> dict:
        """
        Extracts the context slice using Slither call-graph and AST extractor.
        """

        # 1. Load Slither
        try:
            from slither.slither import Slither
        except ImportError:
            raise ImportError("slither-analyzer is not installed")

        slither = Slither(project_path)

        # 2. Map JSON target names into actual Slither AST objects (Contracts and Functions)
        implicated = finding_data.get('implicated_functions', [])
        target_contracts = set()
        target_functions = set()

        for imp in implicated:
            c_name = imp.get('contract')
            f_name = imp.get('function')
            
            if not c_name:
                raise ValueError("Missing 'contract' name in implicated_functions entry.")
                
            t_contract = None
            for contract in slither.contracts:
                if contract.name == c_name:
                    t_contract = contract
                    break
                    
            if not t_contract:
                raise ValueError(f"Contract '{c_name}' not found in the parsed project. Halting verification.")
                    
            if t_contract:
                target_contracts.add(t_contract)
                if f_name:
                    for func in t_contract.functions_and_modifiers:
                        if func.name == f_name:
                            target_functions.add(func)
        
        if not target_contracts:
            raise ValueError("No contract found in source code")

        # 3. Recursively grab the vulnerable function AND all of its internal helper functions.
        reachable_functions = set()
        for func in target_functions:
            self._extract_reachable(func, reachable_functions)

        # 4. Semantic and structural link expansion rules
        expanded_functions = set(reachable_functions)

        for target_contract in target_contracts:
            self._expand_semantic_structural(target_contract, expanded_functions)
        
        # 5. Context slice assembler
        context_slice = self._assemble_slice(target_contracts, expanded_functions)
        
        # 6. Extract Pragma
        pragma_str = "pragma solidity ^0.8.20;"
        pragma_pattern = re.compile(r"pragma\s+solidity\s+[^;]+;")
        found_pragma = False
        for contract in target_contracts:
            if hasattr(contract, 'source_mapping') and hasattr(contract.source_mapping, 'filename'):
                filename = getattr(contract.source_mapping.filename, 'absolute', None)
                if filename:
                    try:
                        with open(filename, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            # Remove comments to avoid matching commented-out pragmas
                            content = re.sub(r'/\*[\s\S]*?\*/', '', content)
                            content = re.sub(r'//.*', '', content)
                            match = pragma_pattern.search(content)
                            if match:
                                pragma_str = match.group(0)
                                found_pragma = True
                                break
                    except Exception:
                        pass
            if found_pragma:
                break
        
        return {
            "bce_slice": context_slice,
            "target_contracts": [c.name for c in target_contracts],
            "included_functions": [f.name for f in expanded_functions if getattr(f, 'name', None)],
            "pragma_directive": pragma_str
        }

    def _extract_reachable(self, func, reachable_set: Set):
        if func in reachable_set:
            return
        reachable_set.add(func)
        # Add internal calls
        for call in getattr(func, 'internal_calls', []):
            if hasattr(call, 'internal_calls'):
                self._extract_reachable(call, reachable_set)
            elif hasattr(call, 'function'):
                self._extract_reachable(call.function, reachable_set)
            
    def _expand_semantic_structural(self, contract, expanded_set: Set):
        # Pre-load all state variables touched by current functions
        current_state_vars = set()
        for f in list(expanded_set):
            if hasattr(f, 'all_state_variables_read'):
                current_state_vars.update(f.all_state_variables_read())
            if hasattr(f, 'all_state_variables_written'):
                current_state_vars.update(f.all_state_variables_written())

        changed = True
        while changed:
            changed = False
            
            for func in contract.functions_and_modifiers:
                if func in expanded_set:
                    continue
                
                added = False
                
                # 1. Grab any function that reads or writes to the same state variables as our target functions.
                func_vars = set()
                if hasattr(func, 'all_state_variables_read'):
                    func_vars.update(func.all_state_variables_read())
                if hasattr(func, 'all_state_variables_written'):
                    func_vars.update(func.all_state_variables_written())

                if current_state_vars.intersection(func_vars):
                    expanded_set.add(func)
                    current_state_vars.update(func_vars)
                    added = True
                    changed = True
                    
                # 2. Grab any public wrapper function that calls one of our target internal functions.
                if not added:
                    called_funcs = []
                    for call in getattr(func, 'internal_calls', []):
                        if hasattr(call, 'function'):
                            called_funcs.append(call.function)
                        else:
                            called_funcs.append(call)
                    
                    if any(c in expanded_set for c in called_funcs):
                        expanded_set.add(func)
                        current_state_vars.update(func_vars)
                        added = True
                        changed = True

            # 3. Grab any modifiers attached to our collected functions.
            for f in list(expanded_set):
                if hasattr(f, 'modifiers'):
                    for mod in f.modifiers:
                        if mod not in expanded_set:
                            expanded_set.add(mod)
                            changed = True

    def _assemble_slice(self, target_contracts: Set, functions: Set) -> str:
        # Filter out the functions that don't have source mapping (automatically generated getters)
        valid_functions = [
            f for f in functions 
            if hasattr(f, 'source_mapping') and f.source_mapping 
            and getattr(f, 'name', '') not in ('slitherConstructorVariables', 'slitherConstructorConstantVariables')
        ]
        
        snippets = []
        
        def extract_code(slither_object, code_bytes):
            if not hasattr(slither_object, 'source_mapping') or not slither_object.source_mapping:
                return ""
            start = slither_object.source_mapping.start
            length = slither_object.source_mapping.length
            
            # Slither's source_mapping for StateVariable doesn't include the trailing semicolon
            if type(slither_object).__name__ == 'StateVariable':
                next_semi = code_bytes.find(b';', start + length)
                # also ensure we don't grab too much (e.g. if semicolon is missing or far away)
                if next_semi != -1 and (next_semi - (start + length)) < 200:
                    length = next_semi - start + 1
                    
            snippet = code_bytes[start:start+length].decode('utf-8', errors='ignore')
            # Remove comments
            snippet = re.sub(r'/\*[\s\S]*?\*/', '', snippet)
            snippet = re.sub(r'//.*', '', snippet)
            # Remove empty lines
            snippet = "\n".join([line for line in snippet.splitlines() if line.strip()])
            return snippet

        file_cache = {}
        def get_file_content(filename):
            if not filename:
                return b""
            if filename not in file_cache:
                try:
                    with open(filename, 'rb') as f:
                        file_cache[filename] = f.read().replace(b'\r\n', b'\n')
                except Exception:
                    file_cache[filename] = b""
            return file_cache[filename]

        def get_filename(slither_object):
            return getattr(getattr(slither_object.source_mapping, 'filename', None), 'absolute', None) if hasattr(slither_object, 'source_mapping') else None
        
        processed_functions = set()
        
        for contract in target_contracts:
            contract_filename = get_filename(contract)
            if not contract_filename:
                continue
                
            contract_snippet = f"// File: {contract_filename}\ncontract {contract.name} {{\n"
            
            # Helper to extract a list of items
            def extract_items(items):
                nonlocal contract_snippet
                # Sort items by their start line to maintain readable order
                valid_items = [i for i in items if hasattr(i, 'source_mapping') and i.source_mapping]
                valid_items.sort(key=lambda x: x.source_mapping.start)
                for item in valid_items:
                    item_filename = get_filename(item)
                    if item_filename:
                        item_bytes = get_file_content(item_filename)
                        if item_bytes:
                            code = extract_code(item, item_bytes)
                            if code:
                                contract_snippet += "    " + "\n    ".join(code.splitlines()) + "\n\n"
                                
            # 1. State variables
            extract_items(getattr(contract, 'state_variables', []))
            
            # 2. Structs
            extract_items(getattr(contract, 'structures', []))
            
            # 3. Enums
            extract_items(getattr(contract, 'enums', []))
            
            # 4. Constructors
            constructors = getattr(contract, 'constructors', [])
            extract_items(constructors)
            for c in constructors:
                processed_functions.add(c)
                
            # 5. Functions belonging to this contract
            contract_funcs = [f for f in valid_functions if getattr(f, 'contract_declarer', None) == contract and f not in processed_functions]
            contract_funcs.sort(key=lambda f: f.source_mapping.start)
            
            for func in contract_funcs:
                func_filename = get_filename(func)
                if func_filename:
                    func_bytes = get_file_content(func_filename)
                    if func_bytes:
                        code = extract_code(func, func_bytes)
                        if code:
                            contract_snippet += "    " + "\n    ".join(code.splitlines()) + "\n\n"
                processed_functions.add(func)
                
            # 6. Remaining function signatures
            all_contract_funcs = [
                f for f in getattr(contract, 'functions_and_modifiers', [])
                if hasattr(f, 'source_mapping') and f.source_mapping
                and getattr(f, 'name', '') not in ('slitherConstructorVariables', 'slitherConstructorConstantVariables')
            ]
            all_contract_funcs.sort(key=lambda f: f.source_mapping.start)
            
            for func in all_contract_funcs:
                if func not in processed_functions:
                    func_filename = get_filename(func)
                    if func_filename:
                        func_bytes = get_file_content(func_filename)
                        if func_bytes:
                            start = func.source_mapping.start
                            idx_brace = func_bytes.find(b'{', start)
                            idx_semi = func_bytes.find(b';', start)
                            
                            end_idx = -1
                            if idx_brace != -1 and idx_semi != -1:
                                end_idx = min(idx_brace, idx_semi)
                            else:
                                end_idx = max(idx_brace, idx_semi)
                                
                            if end_idx != -1:
                                is_brace = (func_bytes[end_idx] == ord('{'))
                                sig_bytes = func_bytes[start:end_idx+1]
                                sig_str = sig_bytes.decode('utf-8', errors='ignore')
                                sig_str = re.sub(r'/\*[\s\S]*?\*/', '', sig_str)
                                sig_str = re.sub(r'//.*', '', sig_str)
                                sig_str = "\n".join([line for line in sig_str.splitlines() if line.strip()])
                                
                                if is_brace:
                                    sig_str += " ... }"
                                    
                                if sig_str:
                                    contract_snippet += "    " + "\n    ".join(sig_str.splitlines()) + "\n\n"
                    processed_functions.add(func)
                    
            contract_snippet += "}"
            snippets.append(contract_snippet)
            
        # Add remaining functions that don't belong to the target_contracts
        remaining_funcs = [f for f in valid_functions if f not in processed_functions]
        funcs_by_file = defaultdict(list)
        for f in remaining_funcs:
            filename = get_filename(f)
            if filename:
                funcs_by_file[filename].append(f)
                
        for filename, funcs in funcs_by_file.items():
            code_bytes = get_file_content(filename)
            if not code_bytes:
                continue
                
            funcs.sort(key=lambda f: f.source_mapping.start)
            
            for func in funcs:
                code = extract_code(func, code_bytes)
                if code:
                    snippets.append(f"// File: {filename}\n" + code)
                    
        return "\n\n".join(snippets)
