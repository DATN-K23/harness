import os
from ..domain.config import SmartPoCConfig
from ..domain.verdict import VerificationResult, VerificationVerdict
from .bce import BugContextExtractionModule
from .gre_engine import GenerateRepairExecuteEngine
from .dv import DifferentialVerificationModule
from .sanitizer import PreExecutionSanitizer
from ..ports.sandbox import ExecutionSandboxPort
from ..ports.trajectory import TrajectoryStorePort
from ..ports.llm import VerificationLLMPort

class VerificationRunner:
    """
    End-to-End Integration Engine for SmartPoC (Task 5.1).
    Orchestrates the pipeline: Bug-Context Extraction -> GRE Engine -> DV Module.
    """
    def __init__(
        self, 
        config: SmartPoCConfig, 
        sandbox: ExecutionSandboxPort, 
        llm: VerificationLLMPort,
        trajectory_store: TrajectoryStorePort
    ):
        self.config = config
        self.bce = BugContextExtractionModule()
        self.sanitizer = PreExecutionSanitizer()
        self.gre = GenerateRepairExecuteEngine(self.sanitizer, sandbox, llm, config.max_repair_retries)
        self.dv = DifferentialVerificationModule(llm)
        self.trajectory_store = trajectory_store

    def _get_project_tree(self, path: str):
        exclude_dirs = {"node_modules", "out", "cache", ".git", "lib", "artifacts", "broadcast"}
        sol_files = []
        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            for file in files:
                if file.endswith(".sol"):
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, path)
                    sol_files.append(rel_path.replace("\\", "/"))
        sol_files.sort()
        return sol_files

    def run_verification(self, run_id: str, finding_data: dict, project_path: str) -> VerificationResult:
        if getattr(self.config, 'enabled', False) is False:
            return VerificationResult(VerificationVerdict.UNVERIFIED, {"error": "SmartPoC verification is disabled"})

        def check_isolation(d):
            if isinstance(d, dict):
                for k, v in d.items():
                    if str(k).lower() in ["ground_truth", "groundtruthlabel", "scoring_metadata", "adjudication"]:
                        raise PermissionError(f"Access to ground truth labels is strictly forbidden.")
                    check_isolation(v)
            elif isinstance(d, list):
                for item in d:
                    check_isolation(item)
                    
        check_isolation(finding_data)

        # 1. BCE
        context = self.bce.extract_context(finding_data, project_path)
        
        # Extract base template
        base_template_code = None
        base_template_name = "Test"
        for sol_file in self._get_project_tree(project_path):
            if ("test/" in sol_file or "src/test/" in sol_file) and "BaseExploit" in sol_file:
                base_file_path = os.path.join(project_path, sol_file)
                try:
                    with open(base_file_path, "r", encoding="utf-8") as f:
                        base_template_code = f.read()
                    base_template_name = os.path.basename(sol_file).split(".")[0]
                    break
                except Exception:
                    continue
        
        raw_id = finding_data.get("finding_id", "Exploit")
        safe_report_name = raw_id.replace("-", "").replace(" ", "_")
        
        metadata = {
            "project_files": self._get_project_tree(project_path),
            "base_template_code": base_template_code,
            "base_template_name": base_template_name,
            "report_name": safe_report_name
        }

        # 2. GRE Engine
        script = self.gre.generate_initial_script(context, metadata, finding_data)
        
        initial_history = []

        def save_progress_initial(current_history):
            trajectory_data = {
                "run_id": run_id,
                "bce_slice": context,
                "initial_script": script,
                "status": "IN_PROGRESS",
                "history": current_history
            }
            self.trajectory_store.save_trajectory(run_id, trajectory_data)
        

        execution_result = self.gre.execute_and_repair(script, context, metadata, on_progress=save_progress_initial) or {}
        initial_history = list(execution_result.get("history", []))
        
        success = execution_result.get("success", False)
        working_script = execution_result.get("final_script", script)
        logs = execution_result.get("output", "")
        dv_action_state = {}
        instrumented_script = working_script
        
        if not success:
            verdict = VerificationVerdict.EXECUTION_FAILED
        else:
            # 3. DV Extraction 
            dv_action_state = self.dv.extract_action_state(finding_data, working_script)

            # 4. DV Insertion
            instrumented_script = self.dv.insert_instrumentation(working_script, dv_action_state)
            
            # 5. Execute instrumented script
            def save_progress_dv(current_history):
                trajectory_data = {
                    "run_id": run_id,
                    "bce_slice": context,
                    "dv_action_state": dv_action_state,
                    "initial_script": script,
                    "instrumented_script": instrumented_script,
                    "status": "IN_PROGRESS",
                    "history": initial_history + current_history
                }
                self.trajectory_store.save_trajectory(run_id, trajectory_data)
                
            final_execution = self.gre.execute_and_repair(instrumented_script, context, metadata, on_progress=save_progress_dv) or {}
            
            success = final_execution.get("success", False)
            logs = final_execution.get("output", "")
            
            # 6. Semantic evaluation
            if not success:
                verdict = VerificationVerdict.EXECUTION_FAILED
            else:
                pre_state, post_state = self.dv.parse_state_logs(logs)
                eval_str = self.dv.evaluate_verdict(pre_state, post_state)
                if eval_str == "CONFIRMED_VULNERABLE":
                    verdict = VerificationVerdict.CONFIRMED_VULNERABLE
                else:
                    verdict = VerificationVerdict.REJECTED_FALSE_POSITIVE

        # 7. Telemetry capture
        history = list(execution_result.get("history", []))
        if "final_execution" in locals() and final_execution:
            history.extend(final_execution.get("history", []))
            
        trajectory_data = {
            "run_id": run_id,
            "bce_slice": context,
            "dv_action_state": dv_action_state,
            "initial_script": script,
            "instrumented_script": instrumented_script,
            "execution_logs": logs,
            "verdict": verdict.value,
            "history": history
        }
        self.trajectory_store.save_trajectory(run_id, trajectory_data)

        return VerificationResult(verdict, {"execution_result": execution_result})
