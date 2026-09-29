import json
import sys
import os
import logging
from dotenv import load_dotenv

load_dotenv()

# Suppress external warnings
logging.getLogger("CryticCompile").setLevel(logging.CRITICAL)
logging.getLogger("ContractSolcParsing").setLevel(logging.CRITICAL)
logging.getLogger("google_genai.models").setLevel(logging.ERROR)

# Inject Foundry path so Slither can always find 'forge' on Windows
foundry_path = os.path.expanduser("~/.foundry/bin")
if foundry_path not in os.environ.get("PATH", ""):
    os.environ["PATH"] = f"{foundry_path};{os.environ.get('PATH', '')}"

# Add src to path
sys.path.append(r"C:\Code\DATN\harness\runtime\src")

from harness.modules.verification.application.runner import VerificationRunner
from harness.modules.verification.domain.config import SmartPoCConfig
from harness.modules.verification.ports.sandbox import ExecutionSandboxPort
from harness.modules.verification.ports.llm import VerificationLLMPort
from harness.modules.verification.adapters.docker_sandbox import DockerExecutionSandboxAdapter
from harness.modules.verification.adapters.db_trajectory import DatabaseTrajectoryStoreAdapter
from google import genai
from google.genai import errors
import time

# 1. Concrete Adapter for LLM using Google SDK
class GeminiLLMAdapter(VerificationLLMPort):
    def query(self, prompt: str) -> str:
        print("\n[LLM] Querying Gemini model (gemini-3.5-flash-lite)...")
        client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
        
        max_retries = 10
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model='gemini-3.5-flash-lite',
                    contents=prompt,
                    config={'automatic_function_calling': {'disable': True}}
                )
                return response.text if response.text is not None else ""
            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"\n[LLM] Connection or API Error detected ({type(e).__name__}). Waiting 35 seconds and retrying ({attempt + 1}/{max_retries})...")
                    time.sleep(35)
                else:
                    raise

# 2. Concrete Adapter for LLM using Groq
class GroqLLMAdapter(VerificationLLMPort):
    def query(self, prompt: str) -> str:
        print("\n[LLM] Querying Groq model (openai/gpt-oss-120b)...")
        import groq
        client = groq.Groq(api_key=os.environ.get("GROQ_API_KEY"))
        
        max_retries = 10
        for attempt in range(max_retries):
            try:
                chat_completion = client.chat.completions.create(
                    messages=[{"role": "user", "content": prompt}],
                    model="openai/gpt-oss-120b",
                    temperature=0
                )
                return chat_completion.choices[0].message.content or ""
            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"\n[LLM] Groq API Error detected. Waiting 35 seconds and retrying ({attempt + 1}/{max_retries})...")
                    time.sleep(35)
                else:
                    raise

def run_end_to_end():
    # Setup paths to your megapot test data
    megapot_dir = r"C:\Code\DATN\harness-verification-data\2025-11-megapot\src"
    finding_path = r"C:\Code\DATN\harness-verification-data\2025-11-megapot\finding\valid\H01.json"

    # Load finding
    with open(finding_path, 'r') as f:
        finding_data = json.load(f)

    # Initialize Runner
    config = SmartPoCConfig(enabled=True, max_repair_retries=30)
    llm_adapter = GeminiLLMAdapter()
    sandbox_adapter = DockerExecutionSandboxAdapter(workdir=megapot_dir, network_disabled=False)
    store = DatabaseTrajectoryStoreAdapter()
    
    runner = VerificationRunner(config, sandbox_adapter, llm_adapter, store)

    import datetime
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = f"run_megapot_01_{timestamp}"

    print("=== Starting SmartPoC Verification ===")
    result = runner.run_verification(run_id, finding_data, megapot_dir)
    
    print("\n=== FINAL VERDICT ===")
    print(f"Verdict: {result.verdict.name}")

if __name__ == "__main__":
    run_end_to_end()
