import subprocess
import os
from typing import Tuple, List
from ..ports.sandbox import ExecutionSandboxPort

class DockerExecutionSandboxAdapter(ExecutionSandboxPort):
    """
    Isolated Foundry execution wrapper.
    Runs `forge test` and `forge compile` inside network-disabled Docker containers.
    """
    def __init__(self, workdir: str, image: str = "ghcr.io/foundry-rs/foundry:latest", network_disabled: bool = True):
        self.workdir = workdir
        self.image = image
        self.network_disabled = network_disabled

    def _execute(self, command: List[str]) -> Tuple[int, str, str]:
        """
        Executes a command inside the docker container.
        Returns (exit_code, stdout, stderr)
        """
        docker_cmd = ["docker", "run", "--rm"]
        if self.network_disabled:
            docker_cmd.append("--network=none")
            
        docker_cmd.extend(["-v", f"{os.path.abspath(self.workdir)}:/workspace", "-w", "/workspace"])
        
        # Map a local cache for SVM (Solidity Version Manager) to prevent re-downloading solc every loop
        svm_cache_dir = os.path.join(os.path.abspath(self.workdir), ".svm_cache")
        os.makedirs(svm_cache_dir, exist_ok=True)
        docker_cmd.extend(["-v", f"{svm_cache_dir}:/root/.svm", "-v", f"{svm_cache_dir}:/home/foundry/.svm"])
        
        docker_cmd.append(self.image)
        
        # FIX: The Foundry docker image entrypoint is `/bin/sh -c`, so we must pass the command as a single string.
        docker_cmd.append(" ".join(command))
        
        result = subprocess.run(docker_cmd, capture_output=True, text=True, encoding="utf-8")
        return result.returncode, result.stdout or "", result.stderr or ""

    def run_isolated(self, test_script: str, metadata: dict = None) -> dict:
        """
        Writes the script to the workspace and runs forge test.
        """
        metadata = metadata or {}
        report_name = metadata.get("report_name", "Exploit")
        test_contract_name = f"{report_name}Test"
        test_file_name = f"{test_contract_name}.t.sol"

        test_path = os.path.join(self.workdir, "test", test_file_name)
        os.makedirs(os.path.dirname(test_path), exist_ok=True)
        with open(test_path, "w", encoding="utf-8") as f:
            f.write(test_script)

        exit_code, stdout, stderr = self._execute(["forge", "test", "--mc", test_contract_name, "-vvvv"])
        success = (exit_code == 0) and ("No tests found" not in stdout) and ("No tests found" not in stderr)
        
        compiler_error = ""
        execution_error = ""
        
        if "Compiler run failed" in stdout or "compiler_error" in stderr.lower():
            compiler_error = stdout if "Compiler run failed" in stdout else stderr
        elif not success:
            execution_error = stdout

        return {
            "success": success,
            "compiler_error": compiler_error.strip(),
            "execution_error": execution_error.strip(),
            "error": stderr.strip(),
            "output": stdout.strip()
        }
