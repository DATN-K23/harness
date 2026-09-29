class ExecutionSandboxPort:
    """
    Port for the isolated Foundry execution wrapper.
    Responsible for running `forge test` and `forge compile` inside network-disabled containers.
    """
    def run_isolated(self, test_script: str, metadata: dict = None) -> dict:
        raise NotImplementedError
